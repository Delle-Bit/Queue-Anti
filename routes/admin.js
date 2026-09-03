const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { requireStaff, requireAdmin } = require('../config');
const aiServices = require('../ai_services');
const appointmentAutomation = require('../appointment_automation');
const sessionActivity = require('../session_activity');
const { recordAudit, requireReason, snapshotRow } = require('../audit');
const { archiveRecord, ARCHIVE_TABLE_MAP } = require('../archive');
const { sanitizeRichText, richTextToPlain } = require('../rich_text');

const ELEVATED_ROLES = ['admin', 'admintechnical', 'owner'];

// --- USERS ---
// Free-text search across the columns an operator would actually type into a
// search box. Built as a parameterised OR block rather than string-concatenated
// SQL, so a search term can never reach the query text.
function buildSearchClause(term, columns) {
    const q = String(term || '').trim();
    if (!q) return { clause: '', params: [] };
    const like = `%${q}%`;
    return {
        clause: `(${columns.map(c => `${c} LIKE ?`).join(' OR ')})`,
        params: columns.map(() => like)
    };
}

router.get('/users/staff', requireAdmin, async (req, res) => {
    try {
        // id is cast so a search for "12" matches the account number as readily
        // as it matches a name.
        const search = buildSearchClause(req.query.q, [
            'CAST(u.id AS CHAR)', 'u.username', 'u.full_name', 'u.email', 'u.role'
        ]);
        const params = [];
        let where = `u.role != 'customer' AND u.archived = false`;
        if (search.clause) { where += ` AND ${search.clause}`; params.push(...search.params); }
        if (req.query.role) { where += ' AND u.role = ?'; params.push(req.query.role); }
        const [rows] = await pool.query(
            `SELECT u.id, u.username, u.role, u.full_name, u.email, u.created_at
             FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT 500`,
            params
        );
        res.json(rows);
    } catch (err) {
        console.error('Staff list error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.get('/users/customers', requireAdmin, async (req, res) => {
    try {
        const search = buildSearchClause(req.query.q, [
            'CAST(u.id AS CHAR)', 'u.customer_uid', 'u.username', 'u.full_name', 'u.email', 'u.customer_category'
        ]);
        const params = [];
        let where = `u.role = 'customer' AND u.archived = false`;
        if (search.clause) { where += ` AND ${search.clause}`; params.push(...search.params); }
        if (req.query.category) { where += ' AND u.customer_category = ?'; params.push(req.query.category); }
        const [rows] = await pool.query(
            `SELECT u.id, u.customer_uid, u.username, u.full_name, u.email, u.customer_category, u.created_at,
                    COUNT(qs.id) as total_services
             FROM users u LEFT JOIN queue_sequences qs ON u.id = qs.customer_id AND qs.status='completed'
             WHERE ${where} GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`,
            params
        );
        res.json(rows);
    } catch (err) {
        console.error('Customer list error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.post('/users', requireAdmin, requireReason, async (req, res) => {
    const { username, password, role, email, full_name } = req.body;
    try {
        // Admin role cannot create other admins
        if (req.user.role === 'admin' && ELEVATED_ROLES.includes(role)) {
            return res.status(403).json({ error: 'Admin cannot create other Admin accounts' });
        }
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO users (username, password_hash, role, email, full_name) VALUES (?, ?, ?, ?, ?)',
            [username, hash, role, email || '', full_name || '']
        );
        await recordAudit({
            req, action: 'create', entityType: 'user', entityId: result.insertId,
            summary: `Created ${role} account "${username}"`,
            after: { id: result.insertId, username, role, email: email || '', full_name: full_name || '' }
        });
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

router.put('/users/:id', requireAdmin, requireReason, async (req, res) => {
    const { password, role, email, full_name } = req.body;
    try {
        const before = await snapshotRow('users', 'id', req.params.id);
        if (!before) return res.status(404).json({ error: 'User not found' });
        const targetRole = before.role;

        // Plain admins must not modify elevated accounts or grant elevated roles
        if (req.user.role === 'admin') {
            if (ELEVATED_ROLES.includes(targetRole)) {
                return res.status(403).json({ error: 'Admins cannot modify other admin accounts' });
            }
            if (role && ELEVATED_ROLES.includes(role)) {
                return res.status(403).json({ error: 'Admins cannot grant admin roles' });
            }
            if (Number(req.params.id) === req.user.id) {
                return res.status(403).json({ error: 'You cannot change your own role' });
            }
        }

        if (password) {
            const hash = await bcrypt.hash(password, 10);
            await pool.query('UPDATE users SET password_hash=?, role=?, email=?, full_name=? WHERE id=?',
                [hash, role, email || '', full_name || '', req.params.id]);
        } else {
            await pool.query('UPDATE users SET role=?, email=?, full_name=? WHERE id=?',
                [role, email || '', full_name || '', req.params.id]);
        }
        const after = await snapshotRow('users', 'id', req.params.id);
        await recordAudit({
            req, action: 'update', entityType: 'user', entityId: req.params.id,
            summary: `Updated account "${before.username}"${password ? ' (password reset)' : ''}`,
            before, after
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

router.delete('/users/:id', requireAdmin, requireReason, async (req, res) => {
    const reason = req.auditReason;
    try {
        if (Number(req.params.id) === req.user.id) {
            return res.status(403).json({ error: 'You cannot delete your own account' });
        }
        const [targetRows] = await pool.query('SELECT role FROM users WHERE id=?', [req.params.id]);
        if (targetRows.length === 0) return res.status(404).json({ error: 'User not found' });
        if (req.user.role === 'admin' && ELEVATED_ROLES.includes(targetRows[0].role)) {
            return res.status(403).json({ error: 'Admins cannot delete admin accounts' });
        }
        const [userRows] = await pool.query('SELECT username, full_name FROM users WHERE id=?', [req.params.id]);
        if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userRows[0];

        const archived = await archiveRecord('users', 'id', req.params.id, 'user', req, reason);
        if (!archived) return res.status(400).json({ error: 'This account is already archived.' });
        await pool.query(
            `INSERT INTO account_deletion_logs (account_id, account_name, deleted_by, deleted_by_name, reason)
             VALUES (?, ?, ?, ?, ?)`,
            [req.params.id, user.full_name || user.username, req.user.id, req.user.username, reason]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

router.get('/users/deletion-logs', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM account_deletion_logs ORDER BY deleted_at DESC LIMIT 100');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- LABORATORIES ---
router.get('/laboratories', requireStaff, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT l.*, u.username as staff_name FROM laboratories l
            LEFT JOIN users u ON l.assigned_staff_id = u.id WHERE l.archived = false ORDER BY l.name
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/laboratories', requireAdmin, requireReason, async (req, res) => {
    const { name, service_type, assigned_staff_id, start_time, cutoff_time } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO laboratories (name, service_type, assigned_staff_id, start_time, cutoff_time) VALUES (?, ?, ?, ?, ?)',
            [name, service_type || '', assigned_staff_id || null, start_time || null, cutoff_time || null]
        );
        await recordAudit({
            req, action: 'create', entityType: 'laboratory', entityId: result.insertId,
            summary: `Added laboratory "${name}"`,
            after: await snapshotRow('laboratories', 'id', result.insertId)
        });
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Create laboratory error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.put('/laboratories/:id', requireAdmin, requireReason, async (req, res) => {
    const { name, service_type, assigned_staff_id, is_open, start_time, cutoff_time } = req.body;
    try {
        const before = await snapshotRow('laboratories', 'id', req.params.id);
        if (!before) return res.status(404).json({ error: 'Laboratory not found' });
        await pool.query(
            'UPDATE laboratories SET name=?, service_type=?, assigned_staff_id=?, is_open=?, start_time=?, cutoff_time=? WHERE id=?',
            [name, service_type, assigned_staff_id || null, is_open !== false, start_time || null, cutoff_time || null, req.params.id]
        );
        await recordAudit({
            req, action: 'update', entityType: 'laboratory', entityId: req.params.id,
            summary: `Updated laboratory "${before.name}"`,
            before, after: await snapshotRow('laboratories', 'id', req.params.id)
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Update laboratory error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.delete('/laboratories/:id', requireAdmin, requireReason, async (req, res) => {
    try {
        const archived = await archiveRecord('laboratories', 'id', req.params.id, 'laboratory', req);
        if (!archived) return res.status(400).json({ error: 'This laboratory is already archived.' });
        res.json({ success: true });
    } catch (err) {
        console.error('Archive laboratory error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

// --- DOCTORS ---
router.get('/doctors', requireStaff, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT d.*, u.username as staff_name FROM doctors d
            LEFT JOIN users u ON d.assigned_staff_id = u.id WHERE d.archived = false ORDER BY d.name
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/doctors', requireAdmin, requireReason, async (req, res) => {
    const { name, specialty, assigned_staff_id } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO doctors (name, specialty, assigned_staff_id) VALUES (?, ?, ?)',
            [name, specialty || '', assigned_staff_id || null]
        );
        await recordAudit({
            req, action: 'create', entityType: 'doctor', entityId: result.insertId,
            summary: `Added doctor "${name}"`,
            after: await snapshotRow('doctors', 'id', result.insertId)
        });
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Create doctor error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.put('/doctors/:id', requireAdmin, requireReason, async (req, res) => {
    const { name, specialty, assigned_staff_id, is_open } = req.body;
    try {
        const before = await snapshotRow('doctors', 'id', req.params.id);
        if (!before) return res.status(404).json({ error: 'Doctor not found' });
        await pool.query(
            'UPDATE doctors SET name=?, specialty=?, assigned_staff_id=?, is_open=? WHERE id=?',
            [name, specialty || '', assigned_staff_id || null, is_open !== false, req.params.id]
        );
        await recordAudit({
            req, action: 'update', entityType: 'doctor', entityId: req.params.id,
            summary: `Updated doctor "${before.name}"`,
            before, after: await snapshotRow('doctors', 'id', req.params.id)
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Update doctor error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.delete('/doctors/:id', requireAdmin, requireReason, async (req, res) => {
    try {
        const archived = await archiveRecord('doctors', 'id', req.params.id, 'doctor', req);
        if (!archived) return res.status(400).json({ error: 'This doctor is already archived.' });
        res.json({ success: true });
    } catch (err) {
        console.error('Archive doctor error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});


// --- APPOINTMENTS ---
// Both lists sweep first so a slot that has just gone past its grace period is
// never rendered as if it were still upcoming. The sweep is also on a timer in
// server.js, so this is only about the freshness of the list being served.
router.get('/appointments', requireStaff, async (req, res) => {
    try {
        await appointmentAutomation.sweepQuietly();
        // archived = false excludes no-shows: once swept, a missed appointment
        // leaves the staff and admin working lists entirely. It stays visible to
        // the owner under Archives, where it can be restored.
        // appointment_date/time are formatted in SQL. A DATE column comes back as
        // a JS Date and res.json serialises it to UTC, which shifted the day by
        // one for every timezone east of UTC - a 5 Sep booking rendered as
        // "2026-09-04T16:00:00.000Z" in all four appointment tables.
        let query = `SELECT a.*,
                            DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
                            TIME_FORMAT(a.appointment_time, '%H:%i') AS appointment_time,
                            sp.name as package_name, sp.price, u.username, u.full_name
                     FROM appointments a
                     JOIN service_packages sp ON a.package_id = sp.id
                     JOIN users u ON a.customer_id = u.id
                     WHERE a.archived = false
                     ORDER BY a.appointment_date, a.appointment_time`;
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/appointments/my', async (req, res) => {
    try {
        await appointmentAutomation.sweepQuietly();
        // The customer keeps seeing their own no-shows, marked "Did Not Arrive".
        // Archiving them out of here too would make a missed appointment appear
        // to have silently vanished from their own history.
        const [rows] = await pool.query(
            `SELECT a.*,
                    DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
                    TIME_FORMAT(a.appointment_time, '%H:%i') AS appointment_time,
                    sp.name as package_name, sp.price
             FROM appointments a
             JOIN service_packages sp ON a.package_id = sp.id
             WHERE a.customer_id = ? AND (a.archived = false OR a.status = 'no-show')
             ORDER BY a.appointment_date DESC, a.appointment_time DESC`, [req.user.id]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Appointments may only be booked into the future. The calendar disables past
// dates and elapsed slots, but the endpoint takes the date and time straight
// from the request body, so a client-side-only rule is bypassable. Comparison
// uses the server's local clock, the same one CURDATE()/NOW() read elsewhere.
const APPOINTMENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const APPOINTMENT_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function appointmentSlotError(dateStr, timeStr) {
    const date = String(dateStr || '');
    // TIME columns come back as HH:MM:SS, so accept a seconds suffix.
    const time = String(timeStr || '').slice(0, 5);
    if (!APPOINTMENT_DATE_PATTERN.test(date)) return 'Please choose a valid appointment date.';
    if (!APPOINTMENT_TIME_PATTERN.test(time)) return 'Please choose a valid appointment time.';

    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const slot = new Date(y, m - 1, d, hh, mm, 0, 0);
    // Date rolls impossible calendar dates over (2026-02-31 -> March 3), so
    // check the parts survived the round trip.
    if (slot.getFullYear() !== y || slot.getMonth() !== m - 1 || slot.getDate() !== d) {
        return 'Please choose a valid appointment date.';
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const slotDay = new Date(y, m - 1, d);
    if (slotDay.getTime() < today.getTime()) {
        return 'Appointments cannot be booked for a past date.';
    }
    // On today the slot must be strictly later than now - a slot at exactly the
    // current time has already started.
    if (slotDay.getTime() === today.getTime() && slot.getTime() <= now.getTime()) {
        return 'That time slot has already passed. Please choose a later time today or another date.';
    }
    return null;
}

router.post('/appointments', async (req, res) => {
    // payment_method/payment_ref are deliberately not read from the body any
    // more: appointments are settled on site at the front desk, so the server
    // decides the method and the amount rather than trusting a client that used
    // to post a mock online payment.
    const { package_id, appointment_date, appointment_time, notes } = req.body;
    try {
        const slotError = appointmentSlotError(appointment_date, appointment_time);
        if (slotError) return res.status(400).json({ error: slotError });
        const [medical] = await pool.query('SELECT id FROM medical_records WHERE customer_id=? AND archived=false', [req.user.id]);
        if (medical.length === 0) return res.status(409).json({ error: 'Please complete your medical form before booking.', medical_form_required: true });

        // One service at a time. Every check above this line is about the slot -
        // whether the date is full, whether that time is taken - and none of
        // them asked whether this patient is already availing something. So a
        // customer could hold as many appointments as there were free slots,
        // and each one mints its own ticket and its own place in the queue on
        // check-in. The queue path has always refused a second concurrent visit
        // (startPackageQueue returns alreadyActive); the appointment path never
        // did.
        //
        // 'scheduled' and 'checked-in' are the two statuses that are still
        // ahead of the patient. 'completed', 'cancelled' and 'no-show' are
        // finished and must not block a new booking.
        const [openAppt] = await pool.query(
            `SELECT id, DATE_FORMAT(appointment_date, '%Y-%m-%d') AS date_text, appointment_time
             FROM appointments
             WHERE customer_id = ? AND status IN ('scheduled', 'checked-in') AND archived = false
             ORDER BY appointment_date, appointment_time LIMIT 1`,
            [req.user.id]
        );
        if (openAppt.length > 0) {
            return res.status(409).json({
                error: `You already have an appointment on ${openAppt[0].date_text} at ${openAppt[0].appointment_time}.`
                    + ' Cancel it first if you want to book a different service.',
                already_booked: true
            });
        }

        // Mid-visit counts too: a patient standing at a station is availing a
        // service, and the same 'in_progress' row is what startPackageQueue
        // checks, so the two doors agree.
        const [activeVisit] = await pool.query(
            `SELECT id FROM queue_sequences WHERE customer_id = ? AND status = 'in_progress' AND archived = false LIMIT 1`,
            [req.user.id]
        );
        if (activeVisit.length > 0) {
            return res.status(409).json({
                error: 'You are in the queue right now. Finish that visit before booking another service.',
                already_active: true
            });
        }
        const [labCount] = await pool.query(
            `SELECT COUNT(*) as cnt FROM package_laboratories pl JOIN laboratories l ON pl.laboratory_id = l.id
             WHERE pl.package_id = ? AND pl.archived = false AND l.archived = false`, [package_id]
        );
        const [pkgRows] = await pool.query('SELECT doctor_id, price FROM service_packages WHERE id = ? AND archived = false', [package_id]);
        if (pkgRows.length === 0) return res.status(404).json({ error: 'Package not found' });
        if (labCount[0].cnt === 0 && !pkgRows[0].doctor_id) return res.status(400).json({ error: 'This service is currently unavailable.' });
        const [slotCount] = await pool.query(
            `SELECT COUNT(*) as cnt FROM appointments WHERE appointment_date=? AND status != 'cancelled' AND archived=false`,
            [appointment_date]
        );
        if (slotCount[0].cnt >= 6) return res.status(400).json({ error: 'This date is fully booked.' });
        const [slotTaken] = await pool.query(
            `SELECT id FROM appointments WHERE appointment_date=? AND appointment_time=? AND status != 'cancelled' AND archived=false`,
            [appointment_date, appointment_time]
        );
        if (slotTaken.length > 0) return res.status(400).json({ error: 'This appointment slot is already booked.' });

        // Priority surcharge on the package price, stored on the row so a later
        // price change cannot alter what this patient was quoted. Left 'pending':
        // the front desk collects it when they clear the cashier step.
        const surchargePct = appointmentAutomation.APPOINTMENT_SURCHARGE_PCT;
        const amountDue = appointmentAutomation.appointmentPrice(pkgRows[0].price, surchargePct);

        const [ins] = await pool.query(
            `INSERT INTO appointments (customer_id, package_id, appointment_date, appointment_time,
                                       payment_status, payment_method, payment_ref, notes,
                                       amount_due, surcharge_pct)
             VALUES (?, ?, ?, ?, 'pending', 'onsite', '', ?, ?, ?)`,
            [req.user.id, package_id, appointment_date, appointment_time, notes || '', amountDue, surchargePct]
        );
        res.json({
            success: true,
            id: ins.insertId,
            base_price: Number(pkgRows[0].price),
            surcharge_pct: surchargePct,
            amount_due: amountDue,
            payment_status: 'pending'
        });
    } catch (err) {
        console.error('Book appointment error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

// A patient cancelling their own booking.
//
// This has to exist. The one-service rule above refuses a second appointment
// and tells the customer to cancel the first, and there was no customer-facing
// way to cancel one - only staff routes - so booking once would have locked
// them out of booking ever again. The rule created the requirement.
//
// No reason is collected and nothing is audited, matching POST /queue/cancel:
// a patient dropping their own appointment is routine, not a configuration
// change. Left as 'cancelled' rather than archived so the slot frees up
// (every slot query excludes cancelled rows) and the history still shows it
// happened.
router.post('/appointments/:id/cancel', async (req, res) => {
    try {
        // Scoped to the caller's own row, so an id belonging to somebody else
        // is indistinguishable from one that does not exist.
        const [rows] = await pool.query(
            'SELECT id, status FROM appointments WHERE id = ? AND customer_id = ? AND archived = false',
            [req.params.id, req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Appointment not found' });

        const status = rows[0].status;
        if (status === 'checked-in') {
            // They are already in the queue; the front desk owns the visit now.
            return res.status(409).json({ error: 'You have already checked in. Ask the front desk to close this visit.' });
        }
        if (status !== 'scheduled') {
            return res.status(409).json({ error: `This appointment is already ${status}.` });
        }

        await pool.query("UPDATE appointments SET status='cancelled' WHERE id = ?", [req.params.id]);
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true });
    } catch (err) {
        console.error('Cancel appointment error:', err);
        res.status(500).json({ error: 'Failed to cancel' });
    }
});

router.post('/appointments/:id/qr', requireStaff, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, sp.name as package_name, u.full_name, u.username
             FROM appointments a
             JOIN service_packages sp ON a.package_id = sp.id
             JOIN users u ON a.customer_id = u.id
             WHERE a.id=? AND a.archived=false`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Appointment not found' });
        let token = rows[0].qr_token;
        if (!token) {
            token = crypto.randomBytes(24).toString('hex');
            await pool.query('UPDATE appointments SET qr_token=? WHERE id=?', [token, req.params.id]);
        }
        const url = `${req.protocol}://${req.get('host')}/checkin/${token}`;
        const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
        res.json({ success: true, token, url, qrDataUrl: dataUrl, appointment: rows[0] });
    } catch (err) {
        console.error('QR generation error:', err);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// --- ANALYTICS ---
router.get('/analytics/frontdesk', requireStaff, async (req, res) => {
    try {
        const [avg] = await pool.query(`SELECT AVG(TIMESTAMPDIFF(MINUTE,serve_time,complete_time)) as v FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`);
        const [perHour] = await pool.query(`SELECT COUNT(*)/GREATEST(1,TIMESTAMPDIFF(HOUR,MIN(serve_time),MAX(complete_time))) as v FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`);
        const [total] = await pool.query(`SELECT COUNT(*) as v FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`);
        // serve_time is required alongside complete_time: a ticket completed without ever being
        // called has no measurable duration, and TIMESTAMPDIFF returns NULL for it — which sorts
        // first ascending and would steal the "fastest" slot from a real ticket.
        const [fastest] = await pool.query(`SELECT ticket_number, package_name, TIMESTAMPDIFF(MINUTE,serve_time,complete_time) as mins FROM queue_logs WHERE station_type='frontdesk' AND serve_time IS NOT NULL AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE() ORDER BY mins ASC LIMIT 1`);
        const [slowest] = await pool.query(`SELECT ticket_number, package_name, TIMESTAMPDIFF(MINUTE,serve_time,complete_time) as mins FROM queue_logs WHERE station_type='frontdesk' AND serve_time IS NOT NULL AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE() ORDER BY mins DESC LIMIT 1`);
        const [dist] = await pool.query(`SELECT type, COUNT(*) as cnt FROM queue_logs WHERE station_type='frontdesk' AND DATE(join_time)=CURDATE() GROUP BY type`);
        const [logs] = await pool.query(`SELECT * FROM queue_logs WHERE station_type='frontdesk' ORDER BY join_time DESC LIMIT 50`);
        res.json({
            avg_time: parseFloat(avg[0].v || 0).toFixed(1),
            per_hour: parseFloat(perHour[0].v || 0).toFixed(1),
            total: total[0].v,
            fastest: fastest[0] || null, slowest: slowest[0] || null,
            distribution: dist, logs
        });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/analytics/laboratory/:id', requireStaff, async (req, res) => {
    try {
        const sid = req.params.id;
        const [avg] = await pool.query(`SELECT AVG(TIMESTAMPDIFF(MINUTE,serve_time,complete_time)) as v FROM queue_logs WHERE station_type='laboratory' AND station_id=? AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`, [sid]);
        const [waiting] = await pool.query(`SELECT COUNT(*) as v FROM queue WHERE station_type='laboratory' AND station_id=? AND status='waiting'`, [sid]);
        const [perHour] = await pool.query(`SELECT COUNT(*)/GREATEST(1,TIMESTAMPDIFF(HOUR,MIN(serve_time),MAX(complete_time))) as v FROM queue_logs WHERE station_type='laboratory' AND station_id=? AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`, [sid]);
        const [dist] = await pool.query(`SELECT type, COUNT(*) as cnt FROM queue_logs WHERE station_type='laboratory' AND station_id=? AND DATE(join_time)=CURDATE() GROUP BY type`, [sid]);
        const estFinish = (waiting[0].v) * (parseFloat(avg[0].v) || 10);
        const [logs] = await pool.query(`SELECT * FROM queue_logs WHERE station_type='laboratory' AND station_id=? ORDER BY join_time DESC LIMIT 50`, [sid]);
        res.json({
            avg_time: parseFloat(avg[0].v || 0).toFixed(1),
            waiting_count: waiting[0].v,
            per_hour: parseFloat(perHour[0].v || 0).toFixed(1),
            est_finish: Math.ceil(estFinish),
            distribution: dist, logs
        });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/analytics/doctor/:id', requireStaff, async (req, res) => {
    try {
        const sid = req.params.id;
        const [avg] = await pool.query(`SELECT AVG(TIMESTAMPDIFF(MINUTE,serve_time,complete_time)) as v FROM queue_logs WHERE station_type='doctor' AND station_id=? AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`, [sid]);
        const [waiting] = await pool.query(`SELECT COUNT(*) as v FROM queue WHERE station_type='doctor' AND station_id=? AND status='waiting'`, [sid]);
        const [perHour] = await pool.query(`SELECT COUNT(*)/GREATEST(1,TIMESTAMPDIFF(HOUR,MIN(serve_time),MAX(complete_time))) as v FROM queue_logs WHERE station_type='doctor' AND station_id=? AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`, [sid]);
        const estFinish = (waiting[0].v) * (parseFloat(avg[0].v) || 10);
        const [logs] = await pool.query(`SELECT ql.*, u.full_name, u.customer_category FROM queue_logs ql LEFT JOIN users u ON ql.customer_id=u.id WHERE ql.station_type='doctor' AND ql.station_id=? AND DATE(ql.join_time)=CURDATE() ORDER BY ql.join_time DESC`, [sid]);
        res.json({
            avg_time: parseFloat(avg[0].v || 0).toFixed(1),
            waiting_count: waiting[0].v,
            per_hour: parseFloat(perHour[0].v || 0).toFixed(1),
            est_finish: Math.ceil(estFinish),
            logs
        });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/analytics/admin', requireAdmin, async (req, res) => {
    try {
        const [userCounts] = await pool.query(`SELECT role, COUNT(*) as cnt FROM users WHERE archived=false GROUP BY role`);
        const [catCounts] = await pool.query(`SELECT customer_category, COUNT(*) as cnt FROM users WHERE role='customer' AND archived=false GROUP BY customer_category`);
        const [sessions] = await pool.query(`SELECT ss.*, u.username FROM staff_sessions ss JOIN users u ON ss.user_id=u.id ORDER BY ss.login_time DESC LIMIT 20`);
        const [labVolume] = await pool.query(`SELECT station_id, COUNT(*) as cnt FROM queue_logs WHERE station_type='laboratory' AND DATE(join_time)=CURDATE() GROUP BY station_id`);
        const [fdVolume] = await pool.query(`SELECT COUNT(*) as cnt FROM queue_logs WHERE station_type='frontdesk' AND DATE(join_time)=CURDATE()`);
        res.json({ userCounts, catCounts, sessions, labVolume, fdVolume: fdVolume[0].cnt });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/analytics/owner', requireAdmin, async (req, res) => {
    try {
        const [revenue] = await pool.query(`SELECT SUM(sp.price) as total FROM queue_sequences qs JOIN service_packages sp ON qs.package_id=sp.id WHERE qs.status='completed'`);
        const [totalServices] = await pool.query(`SELECT COUNT(*) as v FROM queue_sequences WHERE status='completed'`);
        const [dist] = await pool.query(`SELECT type, COUNT(*) as cnt FROM queue_logs WHERE DATE(join_time)=CURDATE() GROUP BY type`);
        const [sessions] = await pool.query(`SELECT ss.*, u.username, u.role FROM staff_sessions ss JOIN users u ON ss.user_id=u.id ORDER BY ss.login_time DESC LIMIT 50`);
        const [audits] = await pool.query(`SELECT al.*, u.username FROM audit_logs al LEFT JOIN users u ON al.performed_by=u.id ORDER BY al.created_at DESC LIMIT 50`);
        res.json({
            total_revenue: parseFloat(revenue[0].total || 0),
            total_services: totalServices[0].v,
            distribution: dist, sessions, audits
        });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- STAFF SESSIONS ---
router.post('/staff-sessions/logout', async (req, res) => {
    try {
        // Also drops the in-memory idle clock, so the token cannot be replayed
        // after the user has signed out (session_activity.js).
        await sessionActivity.terminate(req.user.id, 'logout');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- AUDIT LOGS ---
// Every row answers What / Who / When / Why. actor_name is read from the log
// itself rather than joined live, so an entry still names the person who made
// the change after their account is renamed or archived; the join is only a
// fallback for rows written before that column existed.
router.get('/audit-logs', requireAdmin, async (req, res) => {
    try {
        const params = [];
        const filters = [];
        const search = buildSearchClause(req.query.q, [
            'al.action', 'al.entity_type', 'al.summary', 'al.reason', 'al.details',
            'al.actor_name', 'u.username'
        ]);
        if (search.clause) { filters.push(search.clause); params.push(...search.params); }
        if (req.query.action) { filters.push('al.action = ?'); params.push(req.query.action); }
        if (req.query.entity_type) { filters.push('al.entity_type = ?'); params.push(req.query.entity_type); }
        if (req.query.from) { filters.push('al.created_at >= ?'); params.push(`${req.query.from} 00:00:00`); }
        if (req.query.to) { filters.push('al.created_at <= ?'); params.push(`${req.query.to} 23:59:59`); }

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
        const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
        const [rows] = await pool.query(
            `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.summary, al.reason,
                    al.before_snapshot, al.after_snapshot, al.created_at,
                    COALESCE(NULLIF(al.actor_name, ''), u.username, 'System') AS actor_name,
                    COALESCE(NULLIF(al.actor_role, ''), u.role, '')          AS actor_role,
                    COALESCE(NULLIF(al.actor_name, ''), u.username, 'System') AS username
             FROM audit_logs al LEFT JOIN users u ON al.performed_by = u.id
             ${where} ORDER BY al.created_at DESC, al.id DESC LIMIT ${limit}`,
            params
        );
        res.json(rows);
    } catch (err) {
        console.error('Audit log error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

// The distinct values present, so the log's filter dropdowns only ever offer
// options that will actually match something.
router.get('/audit-logs/facets', requireAdmin, async (req, res) => {
    try {
        const [actions] = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
        const [types] = await pool.query("SELECT DISTINCT entity_type FROM audit_logs WHERE entity_type <> '' ORDER BY entity_type");
        res.json({
            actions: actions.map(r => r.action),
            entity_types: types.map(r => r.entity_type)
        });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- SETTINGS ---
// GET /settings is served publicly from server.js (branding for unauthenticated pages)

// Allowlist - also the source of the SET clause's column names, so nothing from
// the request body can reach the SQL text.
const SETTINGS_FIELDS = {
    site_name: 255,
    logo_path: 255,
    theme: 20,
    navbar_color: 50,
    background_image: 255
};
const SETTINGS_THEMES = ['light', 'dark'];

// Partial update: only the fields actually present in the body are written.
// This used to be an unconditional full-row UPDATE, so saving the two fields the
// Customize form sent (navbar_color + background_image) nulled out site_name and
// logo_path and reset theme - which also silently broke the branding on the
// customer's exported medical-record PDF, the one place those two were read.
router.put('/settings', requireAdmin, requireReason, async (req, res) => {
    const body = req.body || {};
    const fields = Object.keys(SETTINGS_FIELDS).filter(f => body[f] !== undefined && body[f] !== null);
    if (fields.length === 0) return res.status(400).json({ error: 'No settings provided' });

    const values = [];
    for (const field of fields) {
        const value = String(body[field]).trim();
        if (value.length > SETTINGS_FIELDS[field]) {
            return res.status(400).json({ error: `${field} must be ${SETTINGS_FIELDS[field]} characters or fewer` });
        }
        if (field === 'theme' && !SETTINGS_THEMES.includes(value)) {
            return res.status(400).json({ error: `theme must be one of: ${SETTINGS_THEMES.join(', ')}` });
        }
        if (field === 'navbar_color' && value && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
            return res.status(400).json({ error: 'navbar_color must be a hex colour such as #24303A' });
        }
        if (field === 'site_name' && !value) {
            return res.status(400).json({ error: 'Site name cannot be empty' });
        }
        values.push(value);
    }

    try {
        const before = await snapshotRow('settings', 'id', 1);
        const setClause = fields.map(f => `${f}=?`).join(', ');
        await pool.query(`UPDATE settings SET ${setClause} WHERE id=1`, values);
        const after = await snapshotRow('settings', 'id', 1);

        await recordAudit({
            req, action: 'update', entityType: 'settings', entityId: 1,
            summary: `Updated appearance settings: ${fields.join(', ')}`,
            before, after
        });

        // Let every open page re-apply the branding without a manual reload.
        const io = req.app.get('io');
        if (io) io.emit('settingsUpdate', {});

        res.json({ success: true, updated: fields });
    } catch (err) {
        console.error('Update settings error:', err);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// --- MEDICAL RECORDS ---
router.get('/medical-records/my', async (req, res) => {
    try {
        const [user] = await pool.query('SELECT id, customer_uid, full_name, surname, first_name, middle_name, no_middle_name, gender, birthday, customer_category, verification_method, is_underage, guardian_name, guardian_contact, guardian_relationship FROM users WHERE id = ?', [req.user.id]);
        const [rows] = await pool.query('SELECT * FROM medical_records WHERE customer_id = ? AND archived=false', [req.user.id]);

        if (rows.length > 0) {
            res.json({ ...rows[0], user: user[0] });
        } else {
            res.json({ user: user[0] }); // No medical record yet, but send user info
        }
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/medical-records/my', async (req, res) => {
    const { full_name, surname, first_name, middle_name, no_middle_name, gender, birthday, birthplace, address, house_number, street, barangay, city, province, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions } = req.body;
    const customer_id = req.user.id;
    try {
        const missing = [];
        // house_number is intentionally absent: many rural Philippine addresses
        // have no house number, so it stays optional.
        const required = { surname, first_name, gender, birthday, birthplace, status, address, street, barangay, city, province, phone, occupation, emergency_contact };
        Object.entries(required).forEach(([key, value]) => {
            if (!String(value || '').trim()) missing.push(key);
        });
        if (!no_middle_name && !String(middle_name || '').trim()) missing.push('middle_name');
        if (missing.length > 0) return res.status(400).json({ error: 'Missing required fields', fields: missing });

        await pool.query(
            'UPDATE users SET full_name=?, surname=?, first_name=?, middle_name=?, no_middle_name=?, gender=?, birthday=? WHERE id=?',
            [full_name, surname || '', first_name || '', middle_name || '', no_middle_name ? 1 : 0, gender || null, birthday || null, customer_id]
        );

        const [existing] = await pool.query('SELECT id FROM medical_records WHERE customer_id = ? AND archived=false', [customer_id]);
        if (existing.length > 0) {
            await pool.query(
                `UPDATE medical_records SET birthplace=?, address=?, house_number=?, street=?, barangay=?, city=?, province=?, phone=?, status=?, occupation=?, retiree=?, emergency_contact=?, current_health=?, past_conditions=? WHERE customer_id=?`,
                [birthplace, address, house_number || '', street, barangay, city, province, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions, customer_id]
            );
        } else {
            await pool.query(
                `INSERT INTO medical_records (customer_id, birthplace, address, house_number, street, barangay, city, province, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [customer_id, birthplace, address, house_number || '', street, barangay, city, province, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions]
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/medical-records/:customerId', requireStaff, async (req, res) => {
    try {
        const [user] = await pool.query('SELECT id, customer_uid, full_name, surname, first_name, middle_name, no_middle_name, gender, birthday, customer_category, verification_method, is_underage, guardian_name, guardian_contact, guardian_relationship FROM users WHERE id = ?', [req.params.customerId]);
        const [rows] = await pool.query('SELECT * FROM medical_records WHERE customer_id = ? AND archived=false', [req.params.customerId]);

        if (rows.length > 0) {
            res.json({ ...rows[0], user: user[0] });
        } else {
            res.json(null);
        }
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/medical-records', requireStaff, async (req, res) => {
    const { customer_id, full_name, surname, first_name, middle_name, no_middle_name, gender, birthday, customer_category, birthplace, address, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions } = req.body;
    try {
        await pool.query(
            'UPDATE users SET full_name=?, surname=?, first_name=?, middle_name=?, no_middle_name=?, gender=?, birthday=?, customer_category=? WHERE id=?',
            [full_name, surname || '', first_name || '', middle_name || '', no_middle_name ? 1 : 0, gender || null, birthday || null, customer_category || 'Regular', customer_id]
        );

        const [existing] = await pool.query('SELECT id FROM medical_records WHERE customer_id = ? AND archived=false', [customer_id]);
        if (existing.length > 0) {
            await pool.query(
                `UPDATE medical_records SET birthplace=?, address=?, phone=?, status=?, occupation=?, retiree=?, emergency_contact=?, current_health=?, past_conditions=? WHERE customer_id=?`,
                [birthplace, address, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions, customer_id]
            );
        } else {
            await pool.query(
                `INSERT INTO medical_records (customer_id, birthplace, address, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [customer_id, birthplace, address, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating patient record:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

// --- LAB NOTES ---
router.get('/lab-notes/:customerId', requireStaff, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT ln.*, u.username as staff_name FROM lab_notes ln
             LEFT JOIN users u ON ln.staff_id = u.id
             WHERE ln.customer_id = ? AND ln.archived=false ORDER BY ln.created_at DESC`,
            [req.params.customerId]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/lab-notes', requireStaff, async (req, res) => {
    const { customer_id, note } = req.body;
    try {
        await pool.query(
            `INSERT INTO lab_notes (customer_id, staff_id, note) VALUES (?, ?, ?)`,
            [customer_id, req.user.id, note]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- CLINICAL RECORDS ---
router.post('/clinical-records', requireStaff, async (req, res) => {
    const { customer_id, sequence_id, record_type, data, notes } = req.body;
    try {
        // A freeform result ("Other Diagnostics") arrives as HTML from the
        // laboratory's notepad and is rendered back to the patient as markup,
        // so it is sanitised here rather than trusted from the browser. The
        // flattened copy keeps `notes` plain text for everything that already
        // reads it - the PDF export, the AI summaries, the assistant.
        let payload = data || null;
        let plainNotes = notes || null;
        if (payload && payload.rich_notes) {
            const clean = sanitizeRichText(payload.rich_notes);
            payload = { ...payload, rich_notes: clean };
            if (!plainNotes) plainNotes = richTextToPlain(clean);
        }

        await pool.query(
            `INSERT INTO clinical_records (customer_id, sequence_id, record_type, data, notes, staff_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [customer_id, sequence_id || null, record_type, payload ? JSON.stringify(payload) : null, plainNotes, req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Clinical record save error:', err);
        res.status(500).json({ error: 'Failed to save clinical record' });
    }
});

router.get('/clinical-records/my', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT cr.*, u.username as staff_name, u.full_name as staff_full_name
             FROM clinical_records cr
             LEFT JOIN users u ON cr.staff_id = u.id
             WHERE cr.customer_id = ? AND cr.archived = false
             ORDER BY cr.created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/clinical-records/:customerId', requireStaff, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT cr.*, u.username as staff_name, u.full_name as staff_full_name
             FROM clinical_records cr
             LEFT JOIN users u ON cr.staff_id = u.id
             WHERE cr.customer_id = ? AND cr.archived = false
             ORDER BY cr.created_at DESC`,
            [req.params.customerId]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});


// --- ANNOUNCEMENTS ---
const ANNOUNCEMENT_DEPARTMENT_NAMES = { frontdesk: 'Front Desk', laboratory: 'Laboratory', doctor: 'Doctor' };

router.get('/announcements/draft', requireStaff, async (req, res) => {
    const stationType = ['frontdesk', 'laboratory', 'doctor'].includes(req.query.station_type) ? req.query.station_type : 'frontdesk';
    const stationId = req.query.station_id || null;
    try {
        const waitingParams = [stationType];
        let waitingSql = `SELECT COUNT(*) as v FROM queue WHERE station_type=? AND status='waiting'`;
        if (stationId) { waitingSql += ' AND station_id=?'; waitingParams.push(stationId); }
        const [waitingRows] = await pool.query(waitingSql, waitingParams);

        const nextParams = [stationType];
        let nextSql = `SELECT number FROM queue WHERE station_type=? AND status IN ('waiting','serving')`;
        if (stationId) { nextSql += ' AND station_id=?'; nextParams.push(stationId); }
        nextSql += ` ORDER BY (status='serving') DESC, timestamp ASC LIMIT 1`;
        const [nextRows] = await pool.query(nextSql, nextParams);

        const avgParams = [stationType];
        let avgSql = `SELECT AVG(TIMESTAMPDIFF(MINUTE,serve_time,complete_time)) as v FROM queue_logs WHERE station_type=? AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`;
        if (stationId) { avgSql += ' AND station_id=?'; avgParams.push(stationId); }
        const [avgRows] = await pool.query(avgSql, avgParams);

        const output = await aiServices.announcementGen({
            waitingCount: waitingRows[0].v,
            nextServing: nextRows[0]?.number || null,
            department: ANNOUNCEMENT_DEPARTMENT_NAMES[stationType] || stationType,
            avgWaitMinutes: avgRows[0].v
        });
        res.json(output);
    } catch (err) { res.status(500).json({ error: 'Failed to draft announcement' }); }
});

router.post('/announcements', requireStaff, async (req, res) => {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required' });
    try {
        const [result] = await pool.query(
            'INSERT INTO announcements (message, created_by) VALUES (?, ?)',
            [message, req.user.id]
        );
        if (req.app.get('io')) req.app.get('io').emit('announcementUpdate', {});
        res.json({ success: true, id: result.insertId });
    } catch (err) { res.status(500).json({ error: 'Failed to send announcement' }); }
});

router.get('/announcements', requireStaff, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, u.username as sender_name FROM announcements a
             LEFT JOIN users u ON a.created_by = u.id
             WHERE a.archived = false ORDER BY a.timestamp DESC LIMIT 50`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/announcements/active', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, message, timestamp FROM announcements WHERE archived = false ORDER BY timestamp DESC LIMIT 10`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/announcements/:id', requireStaff, async (req, res) => {
    try {
        const ok = await archiveRecord('announcements', 'id', req.params.id, 'announcement', req, 'Announcement withdrawn by staff');
        if (!ok) return res.status(404).json({ error: 'Not found' });
        if (req.app.get('io')) req.app.get('io').emit('announcementUpdate', {});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to archive' }); }
});

// --- FAQS / SERVICE PRICE REFERENCE ---
router.get('/faqs', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM pricing_faqs');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// The recoverable archive. Everything soft-deleted anywhere in the system lands
// here with a snapshot, a human-readable label and the reason it was archived,
// and every type in ARCHIVE_TABLE_MAP can be restored with one action.
router.get('/archives', requireAdmin, async (req, res) => {
    try {
        const params = [];
        const filters = ['ar.restored_at IS NULL', 'ar.permanently_deleted_at IS NULL'];
        const search = buildSearchClause(req.query.q, [
            'ar.entity_type', 'ar.entity_id', 'ar.label', 'ar.reason', 'u.username'
        ]);
        if (search.clause) { filters.push(search.clause); params.push(...search.params); }
        if (req.query.type) { filters.push('ar.entity_type = ?'); params.push(req.query.type); }

        const [rows] = await pool.query(
            `SELECT ar.id, ar.entity_type, ar.entity_id, ar.label, ar.reason, ar.snapshot,
                    ar.archived_at, u.username as archived_by_name
             FROM archived_records ar LEFT JOIN users u ON ar.archived_by=u.id
             WHERE ${filters.join(' AND ')}
             ORDER BY ar.archived_at DESC LIMIT 300`,
            params
        );
        // Restorable says whether this session can actually put the record back,
        // so the UI can grey out the button instead of failing on click.
        res.json(rows.map(r => ({ ...r, restorable: !!ARCHIVE_TABLE_MAP[r.entity_type] })));
    } catch (err) {
        console.error('Archives list error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.get('/archives/types', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT entity_type, COUNT(*) AS cnt FROM archived_records
             WHERE restored_at IS NULL AND permanently_deleted_at IS NULL
             GROUP BY entity_type ORDER BY entity_type`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/archives/:id/restore', requireAdmin, requireReason, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM archived_records WHERE id=? AND restored_at IS NULL AND permanently_deleted_at IS NULL', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Archive record not found' });
        const archive = rows[0];
        const [table, idColumn] = ARCHIVE_TABLE_MAP[archive.entity_type] || [];
        if (!table) return res.status(400).json({ error: `Unsupported archive type: ${archive.entity_type}` });

        const [result] = await pool.query(
            `UPDATE ${table} SET archived=false, archived_at=NULL WHERE ${idColumn}=?`,
            [archive.entity_id]
        );
        // The underlying row is gone (hard-deleted, or cascaded away with its
        // parent), so there is nothing to un-archive. Saying so is better than
        // reporting success and leaving the record missing from the live list.
        if (result.affectedRows === 0) {
            return res.status(410).json({
                error: `The original ${archive.entity_type} record no longer exists, so it cannot be restored.`
            });
        }
        await pool.query('UPDATE archived_records SET restored_at=NOW() WHERE id=?', [req.params.id]);
        await recordAudit({
            req, action: 'restore', entityType: archive.entity_type, entityId: archive.entity_id,
            summary: `Restored ${archive.entity_type} "${archive.label || archive.entity_id}" from the archive`,
            details: { archive_id: archive.id, archived_at: archive.archived_at }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Restore error:', err);
        res.status(500).json({ error: 'Failed to restore' });
    }
});

// The one genuinely irreversible action in the system, so it keeps the snapshot
// and the reason on the audit trail even though the row itself is gone.
router.delete('/archives/:id', requireAdmin, requireReason, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM archived_records WHERE id=? AND permanently_deleted_at IS NULL', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Archive record not found' });
        const archive = rows[0];
        const [table, idColumn] = ARCHIVE_TABLE_MAP[archive.entity_type] || [];
        if (!table) return res.status(400).json({ error: `Unsupported archive type: ${archive.entity_type}` });
        await pool.query(`DELETE FROM ${table} WHERE ${idColumn}=? AND archived=true`, [archive.entity_id]);
        await pool.query('UPDATE archived_records SET permanently_deleted_at=NOW() WHERE id=?', [req.params.id]);
        await recordAudit({
            req, action: 'purge', entityType: archive.entity_type, entityId: archive.entity_id,
            summary: `Permanently deleted ${archive.entity_type} "${archive.label || archive.entity_id}"`,
            before: archive.snapshot && typeof archive.snapshot === 'object' ? archive.snapshot : null,
            details: { archive_id: archive.id, label: archive.label }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Purge error:', err);
        res.status(500).json({ error: 'Failed to permanently delete' });
    }
});

module.exports = router;
