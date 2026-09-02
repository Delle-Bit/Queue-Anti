// ── PHONE-LESS WALK-IN INTAKE ───────────────────────────────────────────────
// This clinic's queue is phone-first: a customer registers on their own device,
// picks a service and joins the queue from it, and their phone is what shows
// them their ticket, their place in the line and their results afterwards. A
// patient who arrives without one cannot do any of that, and before this they
// could not be queued at all.
//
// So the front desk does it for them. A walk-in is created here as an ordinary
// customer row - not a parallel queue - because queue_sequences.customer_id is
// a NOT NULL foreign key into `users` and every mechanism in the system keys
// off it: priority scoring, ticket minting, /complete-step routing, the front
// desk's re-insertion, hold and resume, finalisation, the station dashboards,
// the patient file panel and the medical record. A separate walk-in table would
// mean a second implementation of all of that, and the two would drift.
//
// What the patient gets instead of a phone is paper: the printed intake form
// this endpoint returns the data for, and the diagnosis form printed once they
// have paid. The forms are rendered client-side (public/walkin-forms.js) from
// the same jsPDF letterhead as the medical record export.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../database');
const { startPackageQueue, getPackageSteps } = require('../queue_start');
const { recordAudit } = require('../audit');
const { stationDisplayName } = require('./queue');

// The front desk owns intake, and the elevated roles keep their override so an
// administrator can book a patient in when nobody is on the desk.
const WALKIN_ROLES = ['frontdesk', 'admin', 'admintechnical', 'owner'];

function requireWalkInAuthority(req, res, next) {
    if (!req.user || !WALKIN_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'Only the front desk can register a walk-in patient.' });
    }
    next();
}

const CATEGORIES = ['Regular', 'Senior', 'PWD', 'Pregnant'];
const GENDERS = ['Male', 'Female', 'Other'];

function makeCustomerUid(insertId) {
    return `MC-${new Date().getFullYear()}-${String(insertId).padStart(6, '0')}`;
}

// A walk-in account is created by staff and never claimed by the person, so it
// must not be signable-in to. The hash is of 32 random bytes nobody holds:
// bcrypt.compare then behaves normally and simply never matches, rather than
// being handed a malformed hash it could throw on. routes/auth.js also refuses
// these accounts outright before it gets that far - see the is_walk_in guard.
async function unusablePasswordHash() {
    return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
}

function composeFullName({ first_name, middle_name, surname }) {
    return [first_name, middle_name, surname].map(v => String(v || '').trim()).filter(Boolean).join(' ');
}

function ageFromBirthday(birthday) {
    if (!birthday) return null;
    const dob = new Date(birthday);
    if (Number.isNaN(dob.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
    return age >= 0 && age < 130 ? age : null;
}

// ── CREATE ──────────────────────────────────────────────────────────────────
// Registers the patient and puts them in the queue in one action, because at a
// counter with somebody standing at it those are not two separate decisions.
router.post('/', requireWalkInAuthority, async (req, res) => {
    const {
        first_name, middle_name, surname, no_middle_name,
        category, gender, birthday, phone, address, package_id
    } = req.body || {};

    const first = String(first_name || '').trim();
    const last = String(surname || '').trim();
    if (!first || !last) {
        return res.status(400).json({ error: 'First name and surname are required.' });
    }
    if (category && !CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Unknown priority category.' });
    }
    if (gender && !GENDERS.includes(gender)) {
        return res.status(400).json({ error: 'Unknown gender.' });
    }
    if (!package_id) {
        return res.status(400).json({ error: 'Pick the service the patient is availing.' });
    }

    // A deactivated service is not on sale at the counter either, so the same
    // is_active gate the customer-facing catalogue applies is applied here.
    const [pkgs] = await pool.query(
        'SELECT * FROM service_packages WHERE id = ? AND is_active = true AND archived = false',
        [package_id]
    );
    if (pkgs.length === 0) return res.status(404).json({ error: 'That service is not available.' });

    let customerId = null;
    try {
        const resolvedCategory = category || 'Regular';
        const fullName = composeFullName({ first_name: first, middle_name, surname: last });

        // username is UNIQUE NOT NULL and needed at insert time, so it goes in
        // random and is rewritten to the readable form once the id exists.
        const provisional = `walkin_tmp_${crypto.randomUUID()}`;
        const [userResult] = await pool.query(
            `INSERT INTO users
                (username, password_hash, role, customer_category, full_name, surname, first_name,
                 middle_name, no_middle_name, gender, birthday, is_walk_in, walk_in_created_by)
             VALUES (?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, true, ?)`,
            [provisional, await unusablePasswordHash(), resolvedCategory, fullName, last, first,
             String(middle_name || '').trim(), (no_middle_name || !String(middle_name || '').trim()) ? 1 : 0,
             gender || null, birthday || null, req.user.id]
        );
        customerId = userResult.insertId;
        await pool.query(
            'UPDATE users SET username = ?, customer_uid = ? WHERE id = ?',
            [`walkin-${customerId}`, makeCustomerUid(customerId), customerId]
        );

        // The medical record is created now, mostly empty. It has to exist -
        // /start-package treats a missing one as "complete your medical form
        // first", and the patient file panel, the doctor's view and the PDF
        // export all read from it - and the printed intake form is how the rest
        // of it gets filled in, on paper, for the desk to transcribe afterwards.
        await pool.query(
            `INSERT INTO medical_records (customer_id, phone, address)
             VALUES (?, ?, ?)`,
            [customerId, String(phone || '').trim(), String(address || '').trim()]
        );

        const started = await startPackageQueue({
            customerId,
            packageId: package_id,
            category: resolvedCategory,
            intakeChannel: 'walkin'
        });
        if (started.unavailable || started.notFound) {
            // Nothing was queued, so the patient row we just made would be an
            // orphan. Removed rather than archived: it holds nothing yet, and a
            // half-made patient in the archive is worse than none.
            await pool.query('DELETE FROM users WHERE id = ? AND is_walk_in = true', [customerId]);
            return res.status(400).json({
                error: 'That service has no stations configured, so it cannot be queued. Ask an administrator to check its station route.'
            });
        }

        await recordAudit({
            req,
            action: 'create',
            entityType: 'walkin',
            entityId: customerId,
            summary: `Registered walk-in patient ${fullName} (${started.ticket}) for ${pkgs[0].name}`,
            reason: 'Phone-less patient registered at the front desk counter',
            after: {
                customer_id: customerId, ticket: started.ticket, sequence_id: started.sequence_id,
                category: resolvedCategory, package: pkgs[0].name
            }
        });

        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});

        res.json({
            success: true,
            ticket: started.ticket,
            sequence_id: started.sequence_id,
            customer_id: customerId,
            customer_uid: makeCustomerUid(customerId),
            package_name: pkgs[0].name
        });
    } catch (err) {
        console.error('Walk-in create error:', err);
        // Same reasoning as above: an insert that failed part-way leaves a
        // patient row with no visit attached to it.
        if (customerId) {
            await pool.query('DELETE FROM users WHERE id = ? AND is_walk_in = true', [customerId])
                .catch(e => console.error('Walk-in rollback failed:', e.message));
        }
        res.status(500).json({ error: 'Failed to register the walk-in patient.' });
    }
});

// ── LIST ────────────────────────────────────────────────────────────────────
// The walk-in dashboard's data: every phone-less visit with where it currently
// is. `scope=active` is the working list; `scope=today` includes the ones that
// have already closed, for the desk to reprint from.
router.get('/', requireWalkInAuthority, async (req, res) => {
    const scope = req.query.scope === 'today' ? 'today' : 'active';
    try {
        const where = scope === 'today'
            ? 'AND DATE(qs.started_at) = CURDATE()'
            : "AND qs.status = 'in_progress'";

        const [rows] = await pool.query(
            `SELECT qs.id AS sequence_id, qs.customer_id, qs.status AS visit_status,
                    qs.current_step, qs.total_steps, qs.started_at, qs.paid_at,
                    qs.outcome, qs.outcome_reason,
                    u.full_name, u.customer_uid, u.customer_category, u.gender, u.birthday,
                    mr.phone, mr.address,
                    sp.id AS package_id, sp.name AS package_name, sp.price, sp.category AS package_category,
                    q.id AS queue_id, q.number AS ticket, q.status AS queue_status,
                    q.station_type, q.station_id, q.step_index, q.hold_reason, q.timestamp AS queued_at
             FROM queue_sequences qs
             JOIN users u ON qs.customer_id = u.id
             JOIN service_packages sp ON qs.package_id = sp.id
             LEFT JOIN medical_records mr ON mr.customer_id = u.id AND mr.archived = false
             LEFT JOIN queue q
                    ON q.sequence_id = qs.id AND q.archived = false
                   AND q.status IN ('waiting','serving','on-hold')
             WHERE qs.intake_channel = 'walkin' AND qs.archived = false ${where}
             ORDER BY qs.started_at DESC, q.timestamp DESC`,
            []
        );

        // A visit has at most one live row, but the LEFT JOIN cannot promise it -
        // keep the first (the ORDER BY puts the most recent first) so a stale row
        // never doubles a patient up on the dashboard.
        const seen = new Set();
        const visits = [];
        for (const row of rows) {
            if (seen.has(row.sequence_id)) continue;
            seen.add(row.sequence_id);
            row.age = ageFromBirthday(row.birthday);
            row.station_name = row.queue_id
                ? await stationDisplayName(row.station_type, row.station_id)
                : null;
            row.paid = !!row.paid_at;
            visits.push(row);
        }
        res.json(visits);
    } catch (err) {
        console.error('Walk-in list error:', err);
        res.status(500).json({ error: 'Failed to load walk-in patients.' });
    }
});

// ── FORM DATA ───────────────────────────────────────────────────────────────
// Everything both printed documents need, for one visit. One endpoint rather
// than two because the intake form and the diagnosis form differ in layout, not
// in what they are about: the same patient, ticket and service route.
//
// The result-form fields come from the service's own test structure, which is
// what makes the diagnosis form render per service rather than as one fixed
// template - a structured panel prints its parameters with units and reference
// ranges as rows to be written into, and a freeform one prints ruled space.
router.get('/:sequenceId/forms', requireWalkInAuthority, async (req, res) => {
    try {
        const [seqRows] = await pool.query(
            `SELECT qs.*, u.full_name, u.customer_uid, u.customer_category, u.gender, u.birthday,
                    u.is_walk_in, mr.phone, mr.address, mr.birthplace, mr.occupation,
                    mr.emergency_contact, mr.status AS civil_status,
                    sp.id AS package_id, sp.name AS package_name, sp.description AS package_description,
                    sp.price, sp.category AS package_category, sp.test_structure_id
             FROM queue_sequences qs
             JOIN users u ON qs.customer_id = u.id
             JOIN service_packages sp ON qs.package_id = sp.id
             LEFT JOIN medical_records mr ON mr.customer_id = u.id AND mr.archived = false
             WHERE qs.id = ? AND qs.archived = false`,
            [req.params.sequenceId]
        );
        if (seqRows.length === 0) return res.status(404).json({ error: 'Visit not found.' });
        const seq = seqRows[0];

        // The ticket lives on the queue rows, and the live one is gone once the
        // visit closes - so fall back to any row of this visit for a reprint.
        const [ticketRows] = await pool.query(
            `SELECT number, status, station_type, station_id, step_index
             FROM queue WHERE sequence_id = ?
             ORDER BY (status IN ('waiting','serving','on-hold')) DESC, step_index DESC
             LIMIT 1`,
            [req.params.sequenceId]
        );
        const live = ticketRows[0] || null;

        // The visit's route, named the way the patient will see it on the doors.
        const steps = (await getPackageSteps(seq.package_id)).map((step, index) => ({
            index,
            name: step.name,
            type: step.type,
            station_id: step.station_id || null,
            est_time_minutes: step.est_time_minutes || null,
            is_final: !!step.is_final,
            is_current: index === seq.current_step
        }));

        // The result form the service expects, if it names one.
        let testStructure = null;
        if (seq.test_structure_id) {
            const [tsRows] = await pool.query(
                'SELECT id, name, description, input_mode FROM test_structures WHERE id = ? AND archived = false',
                [seq.test_structure_id]
            );
            if (tsRows.length) {
                testStructure = tsRows[0];
                const [fields] = await pool.query(
                    `SELECT label, unit, reference_range, field_type, options, default_value
                     FROM test_structure_fields
                     WHERE structure_id = ? AND archived = false
                     ORDER BY sort_order, id`,
                    [testStructure.id]
                );
                testStructure.fields = fields;
            }
        }

        let doctor = null;
        if (seq.doctor_id) {
            const [doctorRows] = await pool.query(
                'SELECT name, specialty FROM doctors WHERE id = ?', [seq.doctor_id]);
            doctor = doctorRows[0] || null;
        }

        // Results already on file for this visit, so a form reprinted later
        // carries what has been recorded instead of coming out blank again.
        const [results] = await pool.query(
            `SELECT record_type, data, notes, created_at
             FROM clinical_records
             WHERE sequence_id = ? AND archived = false
             ORDER BY created_at`,
            [req.params.sequenceId]
        );

        res.json({
            sequence_id: seq.id,
            intake_channel: seq.intake_channel,
            visit_status: seq.status,
            current_step: seq.current_step,
            total_steps: seq.total_steps,
            started_at: seq.started_at,
            paid_at: seq.paid_at,
            paid: !!seq.paid_at,
            ticket: live ? live.number : null,
            queue_status: live ? live.status : null,
            patient: {
                id: seq.customer_id,
                name: seq.full_name,
                uid: seq.customer_uid,
                category: seq.customer_category || 'Regular',
                gender: seq.gender,
                birthday: seq.birthday,
                age: ageFromBirthday(seq.birthday),
                phone: seq.phone || '',
                address: seq.address || '',
                birthplace: seq.birthplace || '',
                occupation: seq.occupation || '',
                civil_status: seq.civil_status || '',
                emergency_contact: seq.emergency_contact || '',
                is_walk_in: !!seq.is_walk_in
            },
            service: {
                id: seq.package_id,
                name: seq.package_name,
                description: seq.package_description || '',
                category: seq.package_category || '',
                price: seq.price
            },
            steps,
            doctor,
            test_structure: testStructure,
            results
        });
    } catch (err) {
        console.error('Walk-in form data error:', err);
        res.status(500).json({ error: 'Failed to load the form data.' });
    }
});

module.exports = router;
