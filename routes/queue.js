const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const queueAutomation = require('../queue_automation');
const { startPackageQueue, getPackageSteps, queueTypeForCategory } = require('../queue_start');
const { requireStaff } = require('../config');
const { recordAudit } = require('../audit');

const { REINSERT_SLOT } = queueAutomation;

const getQueueType = queueTypeForCategory;

// A staff account may only act on its own station type. This is what actually
// enforces "everyone passes through the front desk first": the queue row for a
// later station is only created once the previous step is completed, so the only
// way to skip the cashier would be for a laboratory or doctor account to
// complete the frontdesk row itself - both endpoints take a queue_id/station
// from the request body and previously accepted any of them from any staff role.
// Admin/admintechnical/owner are omitted deliberately: they hold the override.
const ROLE_STATION_TYPE = {
    frontdesk: 'frontdesk',
    laboratory: 'laboratory',
    doctor: 'doctor'
};

// The front desk is also the final gatekeeper: it alone decides whether a visit
// is officially Completed or Unfinished, and it alone can cut a returning
// patient back into a line. Elevated roles keep the override so an admin can
// unstick a desk that has nobody on shift.
const FRONT_DESK_AUTHORITY_ROLES = ['frontdesk', 'admin', 'admintechnical', 'owner'];

function hasFrontDeskAuthority(user) {
    return !!user && FRONT_DESK_AUTHORITY_ROLES.includes(user.role);
}

function stationTypeAllowed(user, stationType) {
    const own = ROLE_STATION_TYPE[user && user.role];
    if (!own) return true;
    return own === stationType;
}

function stationDeniedMessage(stationType) {
    return stationType === 'frontdesk'
        ? 'Only front desk staff can process the front desk (cashier) step.'
        : `Your account cannot act on the ${stationType} queue.`;
}

async function getStationAverageMinutes(stationType, stationId, fallback) {
    let query = `SELECT AVG(TIMESTAMPDIFF(MINUTE, serve_time, complete_time)) as avg_mins
                 FROM queue_logs
                 WHERE station_type=? AND complete_time IS NOT NULL AND archived=false`;
    const params = [stationType];
    if (stationId) {
        query += ' AND station_id=?';
        params.push(stationId);
    }
    const [rows] = await pool.query(query, params);
    return Math.max(1, Math.ceil(parseFloat(rows[0]?.avg_mins) || fallback || 5));
}

async function getCurrentProcessing(stationType, stationId) {
    let query = `SELECT number FROM queue WHERE station_type=? AND status='serving' AND archived=false`;
    const params = [stationType];
    if (stationId) {
        query += ' AND station_id=?';
        params.push(stationId);
    }
    query += ' ORDER BY timestamp ASC LIMIT 1';
    const [rows] = await pool.query(query, params);
    return rows[0]?.number || '--';
}

// The waiting rows at a station, in the order they will actually be called.
async function getOrderedWaiting(stationType, stationId) {
    let query = `SELECT * FROM queue WHERE station_type=? AND status='waiting' AND archived=false`;
    const params = [stationType];
    if (stationId) { query += ' AND station_id=?'; params.push(stationId); }
    query += ' ORDER BY timestamp ASC';
    const [rows] = await pool.query(query, params);
    return queueAutomation.orderWaitingList(rows);
}

// Turns "put them at position N of the waiting list" into "call them right
// after this specific patient", which is what actually holds the position as the
// line drains. Slot 1 (or a line too short to have a slot-1 neighbour) resolves
// to no anchor at all, meaning "next".
async function resolveReinsertAnchor(stationType, stationId, excludeQueueId, slot) {
    const ordered = await getOrderedWaiting(stationType, stationId);
    const others = ordered.filter(r => String(r.id) !== String(excludeQueueId));
    const anchorIndex = Number(slot) - 2;     // slot 2 -> the row currently first
    if (anchorIndex < 0) return null;
    // A line shorter than the requested slot puts them at the back of it, which
    // is the closest thing to the position asked for.
    const anchor = others[Math.min(anchorIndex, others.length - 1)];
    return anchor ? anchor.id : null;
}

// Queue row ids are derived, not random: the opening front desk row is
// cust_<customer>_<sequence> and every later step appends _s<index>. Deriving
// it is what lets a step be revisited - re-insertion routes a patient back to
// an earlier step and lands on that step's own row instead of inventing a
// second row for the same stop.
function stepRowId(customerId, sequenceId, stepIndex) {
    return Number(stepIndex) > 0
        ? `cust_${customerId}_${sequenceId}_s${stepIndex}`
        : `cust_${customerId}_${sequenceId}`;
}

async function getServingRow(stationType, stationId) {
    let query = `SELECT * FROM queue WHERE station_type=? AND status='serving' AND archived=false`;
    const params = [stationType];
    if (stationId) { query += ' AND station_id=?'; params.push(stationId); }
    query += ' ORDER BY timestamp ASC LIMIT 1';
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
}

async function buildPackagePreview(packageId, category) {
    const [pkgs] = await pool.query(
        'SELECT * FROM service_packages WHERE id = ? AND is_active = true AND archived = false',
        [packageId]
    );
    if (pkgs.length === 0) return null;
    const type = getQueueType(category);
    const steps = await getPackageSteps(packageId);
    const ticket = await queueAutomation.peekTicketNumber('frontdesk', null, type);
    const [frontDeskWaiting] = await pool.query(
        `SELECT COUNT(*) as cnt FROM queue WHERE station_type='frontdesk' AND status='waiting' AND archived=false`
    );
    const currentProcessing = await getCurrentProcessing('frontdesk', null);
    let estimatedTotalTime = 0;
    for (let i = 0; i < steps.length; i++) {
        const avg = await getStationAverageMinutes(steps[i].type, steps[i].station_id, steps[i].est_time_minutes);
        // Cumulative ETA per department, so the linear track can label each node before joining.
        steps[i].est_minutes = avg;
        steps[i].eta_minutes = Math.ceil(estimatedTotalTime);
        steps[i].people_waiting = i === 0 ? frontDeskWaiting[0].cnt : 0;
        estimatedTotalTime += i === 0 ? (frontDeskWaiting[0].cnt + 1) * avg : avg;
    }
    return {
        package: pkgs[0],
        ticket,
        current_processing: currentProcessing,
        estimated_total_time: Math.ceil(estimatedTotalTime),
        steps
    };
}

router.get('/preview-package/:packageId', async (req, res) => {
    try {
        const [medical] = await pool.query('SELECT id FROM medical_records WHERE customer_id=? AND archived=false', [req.user.id]);
        if (medical.length === 0) return res.status(409).json({ error: 'Please complete your medical form before selecting a service.', medical_form_required: true });
        const [existing] = await pool.query(
            `SELECT id FROM queue_sequences WHERE customer_id = ? AND status = 'in_progress' AND archived = false`,
            [req.user.id]
        );
        if (existing.length > 0) return res.status(400).json({ error: 'You already have an active queue. Please complete or cancel it first.' });
        const preview = await buildPackagePreview(req.params.packageId, req.user.category);
        if (!preview) return res.status(404).json({ error: 'Package not found' });
        // Every package is front-desk-to-front-desk, so length alone says nothing
        // about whether the package does anything - ask what sits between them.
        if (!queueAutomation.hasServiceStations(preview.steps)) {
            return res.status(400).json({ error: 'This service is currently unavailable.' });
        }
        res.json(preview);
    } catch (err) {
        console.error('Preview package error:', err);
        res.status(500).json({ error: 'Failed to preview queue' });
    }
});

// Start a package (customer selects package → auto-queue at frontdesk)
router.post('/start-package', async (req, res) => {
    const { package_id } = req.body;
    try {
        const [medical] = await pool.query('SELECT id FROM medical_records WHERE customer_id=? AND archived=false', [req.user.id]);
        if (medical.length === 0) return res.status(409).json({ error: 'Please complete your medical form before selecting a service.', medical_form_required: true });
        const [pkgs] = await pool.query('SELECT * FROM service_packages WHERE id = ? AND is_active = true AND archived = false', [package_id]);
        if (pkgs.length === 0) return res.status(404).json({ error: 'Package not found' });

        // Check if customer already has active sequence
        const [existing] = await pool.query(
            `SELECT * FROM queue_sequences WHERE customer_id = ? AND status = 'in_progress' AND archived = false`, [req.user.id]
        );
        if (existing.length > 0) return res.status(400).json({ error: 'You already have an active queue. Please complete or cancel it first.' });

        const startPreview = await buildPackagePreview(package_id, req.user.category);

        const started = await startPackageQueue({
            customerId: req.user.id,
            packageId: package_id,
            category: req.user.category,
            intakeChannel: 'online'
        });
        if (started.alreadyActive) {
            return res.status(400).json({ error: 'You already have an active queue. Please complete or cancel it first.' });
        }
        if (started.unavailable) {
            return res.status(400).json({ error: 'This service is currently unavailable.' });
        }

        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({
            success: true,
            ticket: started.ticket,
            sequence_id: started.sequence_id,
            estimated_total_time: startPreview?.estimated_total_time || 0
        });
    } catch (err) {
        console.error('Start package error:', err);
        res.status(500).json({ error: 'Failed to start queue' });
    }
});

// Hand the patient on to the next station in their route.
//
// This no longer ends a visit. Every route now finishes at the front desk, and
// only the front desk can declare the outcome, so the last step is closed
// through POST /finalize instead - see the guard below.
router.post('/complete-step', requireStaff, async (req, res) => {
    const { queue_id } = req.body;
    try {
        const [qRows] = await pool.query('SELECT * FROM queue WHERE id = ? AND archived = false', [queue_id]);
        if (qRows.length === 0) return res.status(404).json({ error: 'Queue entry not found' });
        const q = qRows[0];
        if (!stationTypeAllowed(req.user, q.station_type)) {
            return res.status(403).json({ error: stationDeniedMessage(q.station_type) });
        }

        const [seqs] = await pool.query('SELECT * FROM queue_sequences WHERE id = ? AND archived = false', [q.sequence_id]);
        if (seqs.length === 0) {
            await pool.query(`UPDATE queue SET status = 'completed' WHERE id = ?`, [queue_id]);
            return res.json({ success: true, finished: true });
        }
        const seq = seqs[0];

        // The live step list is the routing table; step_index says where this row
        // sits in it. Falling back to the sequence's own counter covers rows
        // written before step_index existed.
        const steps = await getPackageSteps(seq.package_id);
        const currentIndex = q.step_index != null ? q.step_index : seq.current_step;
        const nextIndex = currentIndex + 1;

        // Sitting at the front desk with nothing after it means this is the
        // closing step, and closing a visit is a decision, not an advance.
        if (q.station_type === 'frontdesk' && currentIndex >= steps.length - 1) {
            return res.status(400).json({
                error: 'This is the final front desk step. Use "Close Transaction" to record the outcome.',
                requires_finalize: true
            });
        }

        // Falls back to the closing front desk step when the route has been
        // shortened underneath this visit (a laboratory archived mid-visit
        // leaves step_index pointing past the end of the list). Sending the
        // patient back to the desk is always a valid next move; leaving them
        // stranded at a station the route no longer contains is not.
        const nextStep = steps[nextIndex] || { ...queueAutomation.FRONT_DESK_FINAL_STEP };

        // Mark current queue entry as completed
        await pool.query(`UPDATE queue SET status = 'completed' WHERE id = ?`, [queue_id]);
        await pool.query(
            `UPDATE queue_logs SET complete_time = NOW()
             WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ? AND complete_time IS NULL
             ORDER BY id DESC LIMIT 1`,
            [q.sequence_id, q.station_type, q.station_id, q.number]
        );

        // The front desk is the cashier, so clearing the opening front desk step
        // is when payment is taken. Stamped on the sequence for every visit, not
        // just appointments: the walk-in Diagnosis Form is printed off the back of
        // it, and it cannot be inferred from the step counter because a patient
        // sent back to an earlier step rolls current_step backwards and has still
        // paid. COALESCE keeps the first payment's time if they come past the
        // cashier twice.
        if (currentIndex === 0 && q.station_type === 'frontdesk') {
            await pool.query(
                'UPDATE queue_sequences SET paid_at = COALESCE(paid_at, NOW()) WHERE id = ?',
                [seq.id]
            );
            // An appointment is settled on site, so the booking is marked paid too.
            if (seq.appointment_id) {
                await pool.query(
                    `UPDATE appointments SET payment_status='paid', payment_method='onsite',
                            payment_ref=CONCAT('ONSITE-', ?)
                     WHERE id=? AND payment_status='pending'`,
                    [seq.appointment_id, seq.appointment_id]
                );
            }
        }

        await pool.query('UPDATE queue_sequences SET current_step = ? WHERE id = ?', [nextIndex, seq.id]);

        // Re-applied from the sequence rather than copied from the row just
        // completed, so a per-row adjustment at one station never becomes a
        // permanent head start for the rest of the visit.
        const seqBoost = seq.priority_boost || 0;

        // The ticket number is minted once, at the front desk, and follows the
        // patient for the whole visit. Minting a fresh per-station number gave
        // someone Q-006 at payment and then Q-001 at the laboratory, which reads
        // as a different patient's ticket. It stays unique clinic-wide because
        // every visit starts at the front desk counter.
        const newTicket = q.number;
        const newQueueId = stepRowId(q.customer_id, seq.id, nextIndex);

        // Upsert rather than insert: a patient the front desk sent back to an
        // earlier step walks the rest of the route a second time, and the row
        // for each of those steps already exists from the first pass. A plain
        // INSERT collided on the primary key and stranded them at the step
        // they were sent back to.
        await pool.query(
            `INSERT INTO queue (id, station_type, station_id, number, type, status, customer_id, sequence_id, step_index, priority_boost)
             VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                station_type=VALUES(station_type), station_id=VALUES(station_id),
                number=VALUES(number), type=VALUES(type), status='waiting',
                step_index=VALUES(step_index), priority_boost=VALUES(priority_boost),
                reinsert_slot=NULL, reinsert_after=NULL, reinserted_at=NULL, reinserted_by=NULL,
                hold_reason=NULL, hold_at=NULL, sample_ready_at=NULL, timestamp=NOW()`,
            [newQueueId, nextStep.type, nextStep.station_id || null, newTicket, q.type,
             q.customer_id, seq.id, nextIndex, seqBoost]
        );
        await pool.query(
            `INSERT INTO queue_logs (station_type, station_id, ticket_number, type, customer_id, sequence_id, package_name, price, join_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
            [nextStep.type, nextStep.station_id || null, newTicket, q.type, q.customer_id, seq.id, nextStep.name]
        );

        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({
            success: true,
            finished: false,
            next_station: nextStep.name,
            next_ticket: newTicket,
            station_type: nextStep.type,
            is_final_step: !!nextStep.is_final
        });
    } catch (err) {
        console.error('Complete step error:', err);
        res.status(500).json({ error: 'Failed to complete step' });
    }
});

// ── FINALIZATION ────────────────────────────────────────────────────────────
// The front desk is the only station with the authority to close a visit, and
// it must say which way it closed. 'completed' means the patient went through
// their whole route; 'unfinished' means it ended early and needs a reason on
// the record.
const FINALIZE_OUTCOMES = ['completed', 'unfinished'];

router.post('/finalize', requireStaff, async (req, res) => {
    const { queue_id, outcome, reason } = req.body;
    try {
        if (!hasFrontDeskAuthority(req.user)) {
            return res.status(403).json({
                error: 'Only the front desk can close a transaction. Send the patient back to the front desk to finish their visit.'
            });
        }
        if (!FINALIZE_OUTCOMES.includes(outcome)) {
            return res.status(400).json({ error: `Outcome must be one of: ${FINALIZE_OUTCOMES.join(', ')}` });
        }

        const [qRows] = await pool.query('SELECT * FROM queue WHERE id = ? AND archived = false', [queue_id]);
        if (qRows.length === 0) return res.status(404).json({ error: 'Queue entry not found' });
        const q = qRows[0];
        if (q.station_type !== 'frontdesk') {
            return res.status(400).json({ error: 'A transaction can only be closed at the front desk.' });
        }
        if (q.status !== 'serving') {
            return res.status(400).json({ error: 'Call the patient first — only the ticket currently being served can be closed.' });
        }

        const [seqs] = await pool.query('SELECT * FROM queue_sequences WHERE id = ?', [q.sequence_id]);
        const seq = seqs[0];
        if (!seq) return res.status(404).json({ error: 'Service record not found' });
        if (seq.status !== 'in_progress') {
            return res.status(400).json({ error: 'This visit has already been closed.' });
        }

        const steps = await getPackageSteps(seq.package_id);
        const stepIndex = q.step_index != null ? q.step_index : seq.current_step;
        const isFinalStep = stepIndex >= steps.length - 1;

        // A visit cannot be declared Completed while stations it has not reached
        // are still ahead of it. Closing early is allowed, but it is by
        // definition unfinished and has to say why.
        if (outcome === 'completed' && !isFinalStep) {
            const remaining = steps.slice(stepIndex + 1).filter(s => !s.is_final).map(s => s.name);
            return res.status(400).json({
                error: remaining.length
                    ? `This patient still has ${remaining.length} station(s) to go (${remaining.join(', ')}). Close it as Unfinished, or send them on.`
                    : 'This patient has not reached the closing front desk step yet.',
                remaining_stations: remaining
            });
        }

        const trimmedReason = String(reason || '').trim();
        if (outcome === 'unfinished' && trimmedReason.length < 3) {
            return res.status(400).json({ error: 'Closing a transaction as Unfinished requires a reason.', reason_required: true });
        }

        await pool.query(`UPDATE queue SET status='completed' WHERE id=?`, [queue_id]);
        await pool.query(
            `UPDATE queue_logs SET complete_time = NOW()
             WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ? AND complete_time IS NULL
             ORDER BY id DESC LIMIT 1`,
            [q.sequence_id, q.station_type, q.station_id, q.number]
        );
        // Anything still open elsewhere in this visit (a lab row the patient
        // never showed up for) is cancelled rather than left waiting forever.
        await pool.query(
            `UPDATE queue SET status='cancelled' WHERE sequence_id=? AND id<>? AND status IN ('waiting','serving','on-hold')`,
            [seq.id, queue_id]
        );
        await pool.query(
            `UPDATE queue_sequences
                SET status=?, outcome=?, outcome_reason=?, finalized_by=?, finalized_at=NOW(), completed_at=NOW()
              WHERE id=?`,
            [outcome, outcome, trimmedReason || null, req.user.id, seq.id]
        );

        // The appointment's own lifecycle ends with the visit it produced. This
        // was previously never closed out, leaving checked-in appointments
        // looking active indefinitely.
        if (seq.appointment_id) {
            await pool.query(
                `UPDATE appointments SET status=? WHERE id=? AND status NOT IN ('cancelled','no-show')`,
                [outcome === 'completed' ? 'completed' : 'checked-in', seq.appointment_id]
            );
            if (outcome === 'completed') {
                await pool.query(
                    `UPDATE appointments SET payment_status='paid', payment_method='onsite'
                     WHERE id=? AND payment_status='pending'`,
                    [seq.appointment_id]
                );
            }
        }

        await recordAudit({
            req,
            action: outcome === 'completed' ? 'finalize' : 'finalize_unfinished',
            entityType: 'queue_sequence',
            entityId: seq.id,
            summary: `Ticket ${q.number} closed as ${outcome}`,
            reason: trimmedReason || `Visit completed at the front desk (ticket ${q.number})`,
            details: { ticket: q.number, outcome, step_index: stepIndex, total_steps: steps.length }
        });

        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true, outcome, ticket: q.number });
    } catch (err) {
        console.error('Finalize error:', err);
        res.status(500).json({ error: 'Failed to close transaction' });
    }
});

// Shared "call the next waiting patient at a station" logic — used by /next and
// by the auto-call-next that fires when a patient is put On-Hold.
// The name a station is called by out loud, and on the public board. The
// bookend front desk steps are not stored stations at all (see
// composeServiceSteps), so they have no row to read a name from.
async function stationDisplayName(stationType, stationId) {
    if (stationType === 'frontdesk') return 'Front Desk';
    if (stationType === 'laboratory' && stationId) {
        const [rows] = await pool.query('SELECT name FROM laboratories WHERE id=?', [stationId]);
        if (rows.length) return rows[0].name;
    }
    if (stationType === 'doctor' && stationId) {
        const [rows] = await pool.query('SELECT name FROM doctors WHERE id=?', [stationId]);
        if (rows.length) return rows[0].name;
    }
    return stationType === 'laboratory' ? 'Laboratory' : stationType === 'doctor' ? 'Doctor' : 'Front Desk';
}

// Broadcast a call so the lobby display can put it up and read it out.
//
// Deliberately a separate event from queueUpdate: queueUpdate fires on every
// mutation and every dashboard re-fetches on it, and a board that spoke on each
// of those would talk over itself continuously. This one is emitted only where a
// patient is actually being summoned to a counter.
async function announceCall(io, row) {
    if (!io || !row) return;
    io.emit('queueAnnounce', {
        ticket: row.number,
        station_type: row.station_type,
        station_id: row.station_id || null,
        station_name: await stationDisplayName(row.station_type, row.station_id),
        called_at: new Date().toISOString()
    });
}

async function callNextAtStation(stationType, stationId) {
    const ordered = await getOrderedWaiting(stationType, stationId);
    const next = ordered[0];
    if (!next) return null;

    // A re-inserted patient's placement is consumed the moment they are called,
    // so they rejoin normal priority scoring if they end up back in the line.
    await pool.query(
        `UPDATE queue SET status='serving', reinsert_slot=NULL, reinsert_after=NULL WHERE id=?`,
        [next.id]
    );
    await pool.query(
        `UPDATE queue_logs SET serve_time=NOW()
         WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ? AND complete_time IS NULL
         ORDER BY id DESC LIMIT 1`,
        [next.sequence_id, next.station_type, next.station_id, next.number]
    );
    return next;
}

// Call next in station
router.post('/next', requireStaff, async (req, res) => {
    const { station_type, station_id } = req.body;
    try {
        if (!stationTypeAllowed(req.user, station_type)) {
            return res.status(403).json({ error: stationDeniedMessage(station_type) });
        }

        // Refuse to call a second patient while one is still being served. Two
        // rows in 'serving' at the same station are indistinguishable in the UI
        // (the dashboard and getCurrentProcessing both take the first match), so
        // a double-click used to silently strand a patient mid-transaction with
        // no way to get back to them.
        const alreadyServing = await getServingRow(station_type, station_id);
        if (alreadyServing) {
            return res.status(409).json({
                success: false,
                error: `Ticket ${alreadyServing.number} is still being served. Finish it, put it On-Hold, or use Call Back first.`,
                serving_number: alreadyServing.number,
                serving_queue_id: alreadyServing.id
            });
        }

        const next = await callNextAtStation(station_type, station_id);
        if (!next) return res.json({ success: false, message: 'Queue is empty' });
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        await announceCall(req.app.get('io'), next);
        res.json({ success: true, next: next.number, queue_id: next.id });
    } catch (err) {
        console.error('Call next error:', err);
        res.status(500).json({ error: 'Failed to call next' });
    }
});

// ── CALL BACK (undo the last advance) ───────────────────────────────────────
// Reverts an accidental "Next": whoever was just called goes back to the front
// of the waiting list, and the patient before them is recalled - which means
// undoing the step they were advanced past, including the queue row that
// advance created downstream.
//
// Only within this window, and only while the downstream row is untouched.
// Once the next station has actually called that patient, rolling back would
// mean two stations believing they have them.
const CALL_BACK_WINDOW_MINUTES = 15;

router.post('/call-back', requireStaff, async (req, res) => {
    const { station_type, station_id } = req.body;
    try {
        if (!stationTypeAllowed(req.user, station_type)) {
            return res.status(403).json({ error: stationDeniedMessage(station_type) });
        }

        const undone = [];

        // 1. Put the patient currently at the counter back at the head of the
        //    line. Slot 1 means they are called again next.
        const serving = await getServingRow(station_type, station_id);
        if (serving) {
            // Slot 1 with no anchor: they are called again next.
            await pool.query(
                `UPDATE queue SET status='waiting', reinsert_slot=1, reinsert_after=NULL,
                        reinserted_at=NOW(), reinserted_by=? WHERE id=?`,
                [req.user.id, serving.id]
            );
            await pool.query(
                `UPDATE queue_logs SET serve_time=NULL
                 WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ? AND complete_time IS NULL
                 ORDER BY id DESC LIMIT 1`,
                [serving.sequence_id, serving.station_type, serving.station_id, serving.number]
            );
            undone.push(serving.number);
        }

        // 2. Recall the immediately preceding number: the most recent step this
        //    station completed, for a visit that is still running.
        let sql = `SELECT q.* FROM queue q
                   JOIN queue_sequences qs ON q.sequence_id = qs.id
                   WHERE q.station_type = ? AND q.status = 'completed' AND q.archived = false
                     AND qs.status = 'in_progress' AND qs.archived = false
                     AND q.timestamp > DATE_SUB(NOW(), INTERVAL ? HOUR)`;
        const params = [station_type, 12];
        if (station_id) { sql += ' AND q.station_id = ?'; params.push(station_id); }
        sql += ' ORDER BY q.step_index DESC, q.timestamp DESC LIMIT 20';
        const [candidates] = await pool.query(sql, params);

        // queue_logs holds the timestamps, so it decides which of the candidates
        // was genuinely the last one completed here.
        let previous = null;
        let completedAt = null;
        for (const row of candidates) {
            const [logs] = await pool.query(
                `SELECT complete_time FROM queue_logs
                 WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ?
                   AND complete_time IS NOT NULL
                 ORDER BY id DESC LIMIT 1`,
                [row.sequence_id, row.station_type, row.station_id, row.number]
            );
            const when = logs[0]?.complete_time ? new Date(logs[0].complete_time) : null;
            if (!when) continue;
            if (!completedAt || when > completedAt) { completedAt = when; previous = row; }
        }

        if (!previous) {
            if (undone.length) {
                if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
                return res.json({
                    success: true, recalled: null, returned_to_queue: undone,
                    message: `${undone[0]} was returned to the front of the queue. No earlier ticket was available to recall.`
                });
            }
            return res.status(400).json({ error: 'There is nothing to call back at this station.' });
        }

        const ageMinutes = (Date.now() - completedAt.getTime()) / 60000;
        if (ageMinutes > CALL_BACK_WINDOW_MINUTES) {
            if (undone.length && req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
            return res.status(400).json({
                error: `The last completed ticket here (${previous.number}) was finished ${Math.round(ageMinutes)} minutes ago — too long to call back. Use Re-insert to put them back in the line.`,
                returned_to_queue: undone
            });
        }

        // The row the completion created downstream. It may only be rolled back
        // while it is still untouched.
        const [downstream] = await pool.query(
            `SELECT * FROM queue WHERE sequence_id = ? AND step_index = ? AND archived = false`,
            [previous.sequence_id, (previous.step_index || 0) + 1]
        );
        const nextRow = downstream[0];
        if (nextRow && nextRow.status !== 'waiting') {
            return res.status(409).json({
                error: `${previous.number} has already been picked up at the next station, so this step can no longer be reversed.`,
                returned_to_queue: undone
            });
        }
        if (nextRow) {
            await pool.query('DELETE FROM queue WHERE id = ?', [nextRow.id]);
            // The matching log row was written by the same advance and was never
            // served, so it is removed with it rather than left as a phantom join.
            await pool.query(
                `DELETE FROM queue_logs
                 WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ?
                   AND serve_time IS NULL AND complete_time IS NULL
                 ORDER BY id DESC LIMIT 1`,
                [nextRow.sequence_id, nextRow.station_type, nextRow.station_id, nextRow.number]
            );
        }

        await pool.query(`UPDATE queue SET status='serving' WHERE id=?`, [previous.id]);
        await pool.query(
            `UPDATE queue_logs SET complete_time=NULL
             WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ?
             ORDER BY id DESC LIMIT 1`,
            [previous.sequence_id, previous.station_type, previous.station_id, previous.number]
        );
        await pool.query(
            'UPDATE queue_sequences SET current_step = ? WHERE id = ?',
            [previous.step_index || 0, previous.sequence_id]
        );

        await recordAudit({
            req,
            action: 'call_back',
            entityType: 'queue',
            entityId: previous.sequence_id,
            summary: `Called back ${previous.number} at ${station_type}`,
            reason: `Queue advance reversed at the ${station_type} station`,
            details: { recalled: previous.number, returned_to_queue: undone, step_index: previous.step_index }
        });

        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        await announceCall(req.app.get('io'), previous);
        res.json({
            success: true,
            recalled: previous.number,
            queue_id: previous.id,
            returned_to_queue: undone
        });
    } catch (err) {
        console.error('Call back error:', err);
        res.status(500).json({ error: 'Failed to call back' });
    }
});

// ── RE-INSERTION (line cutting) ─────────────────────────────────────────────
// For a patient who missed their turn or came back with an unfinished process.
// Front desk only, and it can act on any station's line - a patient who missed
// their laboratory turn is re-inserted into the laboratory's queue from the
// desk, not by the laboratory itself.
//
// The slot, not a priority bump, is what makes the position exact: the patient
// lands behind precisely one ordinary patient. See orderWaitingList in
// queue_automation.js.
router.post('/reinsert', requireStaff, async (req, res) => {
    const { queue_id, reason, target_step_index } = req.body;
    try {
        if (!hasFrontDeskAuthority(req.user)) {
            return res.status(403).json({ error: 'Only the front desk can re-insert a patient into a queue.' });
        }
        const [qRows] = await pool.query(
            `SELECT q.*, u.full_name, u.username FROM queue q
             LEFT JOIN users u ON q.customer_id = u.id
             WHERE q.id = ? AND q.archived = false`,
            [queue_id]
        );
        if (qRows.length === 0) return res.status(404).json({ error: 'Queue entry not found' });
        const q = qRows[0];
        const patient = q.full_name || q.username || null;

        // Two shapes of the same action. Without a target step this is the
        // original move - hold the patient's place in the line they are already
        // in. With one, the desk is routing them back to an earlier step of
        // their own service, which means leaving the station they are at.
        const routeToStep = target_step_index !== undefined
            && target_step_index !== null && target_step_index !== '';

        if (!routeToStep) {
            if (!['waiting', 'on-hold'].includes(q.status)) {
                return res.status(400).json({
                    error: `Only a waiting or On-Hold ticket can be re-inserted (this one is "${q.status}").`
                });
            }

            const anchorId = await resolveReinsertAnchor(q.station_type, q.station_id, queue_id, REINSERT_SLOT);
            await pool.query(
                `UPDATE queue SET status='waiting', reinsert_slot=?, reinsert_after=?,
                        reinserted_at=NOW(), reinserted_by=?, hold_reason=NULL, sample_ready_at=NULL
                 WHERE id=?`,
                [REINSERT_SLOT, anchorId, req.user.id, queue_id]
            );

            await recordAudit({
                req,
                action: 'reinsert',
                entityType: 'queue',
                entityId: q.sequence_id,
                summary: `Re-inserted ${q.number} at slot ${REINSERT_SLOT} of the ${q.station_type} queue`,
                reason: String(reason || '').trim() || 'Patient returned to the queue after missing their turn',
                details: {
                    ticket: q.number, station_type: q.station_type, station_id: q.station_id,
                    slot: REINSERT_SLOT, placed_after: anchorId
                }
            });

            if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
            return res.json({ success: true, ticket: q.number, slot: REINSERT_SLOT, patient });
        }

        // -- Routing back to a specific step -------------------------------
        // A patient standing at the closing front desk step with a laboratory
        // result missing does not need their whole visit restarted; they need
        // that one station again. The desk sends them straight there and the
        // rest of the route replays from that point.
        //
        // `serving` is allowed here where the plain re-insert refuses it: the
        // patient is at the counter being dealt with, which is exactly when the
        // desk discovers the gap.
        if (!['waiting', 'serving', 'on-hold'].includes(q.status)) {
            return res.status(400).json({
                error: `A "${q.status}" ticket cannot be routed back to an earlier step.`
            });
        }
        if (!q.sequence_id) {
            return res.status(400).json({
                error: 'This ticket is not part of a multi-step service, so it has no steps to return to.'
            });
        }

        const [seqs] = await pool.query(
            'SELECT * FROM queue_sequences WHERE id = ? AND archived = false', [q.sequence_id]
        );
        if (seqs.length === 0) return res.status(404).json({ error: 'Visit not found' });
        const seq = seqs[0];
        if (seq.status !== 'in_progress') {
            return res.status(400).json({
                error: `This visit is already marked "${seq.status}". Only a visit still in progress can be re-routed.`
            });
        }

        // The patient's own route, and nothing else: composeServiceSteps builds
        // it from the stations on their availed package, so a step that is not
        // in this list cannot be selected however the request was made.
        const steps = await getPackageSteps(seq.package_id);
        const targetIndex = Number(target_step_index);
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= steps.length) {
            return res.status(400).json({
                error: `Step ${target_step_index} is not part of this patient's service.`,
                available_steps: steps.map((st, i) => ({ index: i, name: st.name }))
            });
        }

        const currentIndex = q.step_index != null ? q.step_index : seq.current_step;
        if (targetIndex === currentIndex) {
            return res.status(400).json({
                error: `${q.number} is already at "${steps[targetIndex].name}".`
            });
        }
        // Backwards only. Skipping a patient forward past steps they have not
        // had would roll the sequence counter over those stations and they
        // would never be called for them - a silently unfinished visit instead
        // of a visible one.
        if (targetIndex > currentIndex) {
            return res.status(400).json({
                error: `Re-insertion sends a patient back to a step they have already passed. "${steps[targetIndex].name}" is still ahead of them - use the station's own "Done" button to move them forward.`
            });
        }

        const targetStep = steps[targetIndex];
        const targetRowId = stepRowId(q.customer_id, seq.id, targetIndex);
        const anchorId = await resolveReinsertAnchor(
            targetStep.type, targetStep.station_id, targetRowId, REINSERT_SLOT
        );

        // The row they are standing at is abandoned, not completed - they did
        // not finish that step. Its open log row is closed off so the station's
        // analytics do not carry an entry that never ends.
        await pool.query(`UPDATE queue SET status='cancelled' WHERE id=?`, [queue_id]);
        await pool.query(
            `UPDATE queue_logs SET complete_time = NOW()
             WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ? AND complete_time IS NULL
             ORDER BY id DESC LIMIT 1`,
            [seq.id, q.station_type, q.station_id, q.number]
        );

        // The target step's row already exists from the first pass, so this is
        // an upsert. The ticket number is unchanged: one ticket per visit.
        await pool.query(
            `INSERT INTO queue (id, station_type, station_id, number, type, status, customer_id,
                                sequence_id, step_index, priority_boost, reinsert_slot, reinsert_after,
                                reinserted_at, reinserted_by)
             VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE
                station_type=VALUES(station_type), station_id=VALUES(station_id),
                number=VALUES(number), type=VALUES(type), status='waiting',
                step_index=VALUES(step_index), priority_boost=VALUES(priority_boost),
                reinsert_slot=VALUES(reinsert_slot), reinsert_after=VALUES(reinsert_after),
                reinserted_at=NOW(), reinserted_by=VALUES(reinserted_by),
                hold_reason=NULL, hold_at=NULL, sample_ready_at=NULL, timestamp=NOW()`,
            [targetRowId, targetStep.type, targetStep.station_id || null, q.number, q.type,
             q.customer_id, seq.id, targetIndex, seq.priority_boost || 0,
             REINSERT_SLOT, anchorId, req.user.id]
        );

        // A fresh log row: this is a second visit to that station, and the
        // station's throughput should count it as one.
        await pool.query(
            `INSERT INTO queue_logs (station_type, station_id, ticket_number, type, customer_id,
                                     sequence_id, package_name, price, join_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
            [targetStep.type, targetStep.station_id || null, q.number, q.type,
             q.customer_id, seq.id, targetStep.name]
        );

        await pool.query('UPDATE queue_sequences SET current_step = ? WHERE id = ?', [targetIndex, seq.id]);

        await recordAudit({
            req,
            action: 'reinsert',
            entityType: 'queue',
            entityId: seq.id,
            summary: `Routed ${q.number} back to step ${targetIndex + 1} (${targetStep.name}) at slot ${REINSERT_SLOT}`,
            reason: String(reason || '').trim() || 'Patient returned to an earlier step with an incomplete result',
            details: {
                ticket: q.number,
                from_step: { index: currentIndex, station_type: q.station_type, station_id: q.station_id },
                to_step: {
                    index: targetIndex, name: targetStep.name,
                    station_type: targetStep.type, station_id: targetStep.station_id || null
                },
                slot: REINSERT_SLOT, placed_after: anchorId
            }
        });

        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({
            success: true,
            ticket: q.number,
            patient,
            slot: REINSERT_SLOT,
            step_index: targetIndex,
            step_name: targetStep.name,
            station_type: targetStep.type,
            placed_after: anchorId
        });
    } catch (err) {
        console.error('Reinsert error:', err);
        res.status(500).json({ error: 'Failed to re-insert patient' });
    }
});

// Everyone the front desk could re-insert: waiting, being served, or On-Hold
// across every station, so the desk can find a returning patient without
// knowing which line they were in. `serving` is in the list because the patient
// at the counter is the one whose missing result the desk is looking at.
//
// Each candidate carries its own route, so the step picker can offer exactly
// the steps on that patient's availed service and nothing else.
router.get('/reinsert-candidates', requireStaff, async (req, res) => {
    try {
        if (!hasFrontDeskAuthority(req.user)) {
            return res.status(403).json({ error: 'Only the front desk can re-insert a patient into a queue.' });
        }
        const [rows] = await pool.query(
            `SELECT q.id, q.number, q.type, q.status, q.station_type, q.station_id, q.step_index,
                    q.reinsert_slot, q.hold_reason, q.hold_at, q.timestamp,
                    u.full_name, u.username, u.customer_category,
                    qs.package_id, qs.current_step, qs.total_steps,
                    sp.name AS package_name,
                    COALESCE(l.name, d.name, 'Front Desk') AS station_name
             FROM queue q
             LEFT JOIN users u ON q.customer_id = u.id
             LEFT JOIN queue_sequences qs ON q.sequence_id = qs.id
             LEFT JOIN service_packages sp ON qs.package_id = sp.id
             LEFT JOIN laboratories l ON q.station_type='laboratory' AND q.station_id = l.id
             LEFT JOIN doctors d ON q.station_type='doctor' AND q.station_id = d.id
             WHERE q.archived = false AND q.status IN ('waiting','serving','on-hold')
               AND qs.status = 'in_progress'
             ORDER BY q.timestamp ASC`
        );

        // One route lookup per distinct package rather than per patient - the
        // desk's list is short but several patients usually share a service.
        const routes = new Map();
        for (const row of rows) {
            if (!row.package_id) { row.steps = []; row.current_step_index = 0; continue; }
            if (!routes.has(row.package_id)) {
                routes.set(row.package_id, await getPackageSteps(row.package_id));
            }
            const steps = routes.get(row.package_id);
            const currentIndex = row.step_index != null ? row.step_index : (row.current_step || 0);
            row.current_step_index = currentIndex;
            row.steps = steps.map((st, i) => ({
                index: i,
                name: st.name,
                type: st.type,
                station_id: st.station_id || null,
                is_final: !!st.is_final,
                is_current: i === currentIndex,
                // Only a step already passed can be returned to; see the
                // backwards-only rule in POST /reinsert.
                selectable: i < currentIndex
            }));
        }

        res.json(rows);
    } catch (err) {
        console.error('Reinsert candidates error:', err);
        res.status(500).json({ error: 'Failed to load candidates' });
    }
});

// Put the serving patient On-Hold (e.g. waiting to produce a biological sample)
// and auto-call the next one.
router.post('/hold', requireStaff, async (req, res) => {
    const { queue_id, reason } = req.body;
    try {
        const [qRows] = await pool.query(`SELECT * FROM queue WHERE id = ? AND archived = false`, [queue_id]);
        if (qRows.length === 0) return res.status(404).json({ error: 'Queue entry not found' });
        const q = qRows[0];
        if (!stationTypeAllowed(req.user, q.station_type)) {
            return res.status(403).json({ error: stationDeniedMessage(q.station_type) });
        }
        if (q.status !== 'serving') return res.status(400).json({ error: 'Only the actively serving patient can be put On-Hold' });

        await pool.query(
            `UPDATE queue SET status='on-hold', hold_reason=?, hold_at=NOW(), sample_ready_at=NULL,
                    reinsert_slot=NULL, reinsert_after=NULL WHERE id=?`,
            [reason || 'PENDING_BIOLOGICAL_SAMPLE', queue_id]
        );
        await callNextAtStation(q.station_type, q.station_id);
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true });
    } catch (err) {
        console.error('Hold error:', err);
        res.status(500).json({ error: 'Failed to put patient On-Hold' });
    }
});

// Bring an On-Hold patient back into the line. They return to a defined slot
// rather than the head of the queue: the previous behaviour gave them a
// priority_boost of 100, which jumped them past every waiting patient including
// priority categories.
router.post('/resume', requireStaff, async (req, res) => {
    const { queue_id } = req.body;
    try {
        const [qRows] = await pool.query(`SELECT * FROM queue WHERE id = ? AND archived = false`, [queue_id]);
        if (qRows.length === 0) return res.status(404).json({ error: 'Queue entry not found' });
        const q = qRows[0];
        if (!stationTypeAllowed(req.user, q.station_type)) {
            return res.status(403).json({ error: stationDeniedMessage(q.station_type) });
        }
        if (q.status !== 'on-hold') return res.status(400).json({ error: 'Patient is not On-Hold' });

        const anchorId = await resolveReinsertAnchor(q.station_type, q.station_id, queue_id, REINSERT_SLOT);
        await pool.query(
            `UPDATE queue SET status='waiting', reinsert_slot=?, reinsert_after=?,
                    reinserted_at=NOW(), reinserted_by=?, hold_reason=NULL, sample_ready_at=NULL
             WHERE id=?`,
            [REINSERT_SLOT, anchorId, req.user.id, queue_id]
        );
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true, slot: REINSERT_SLOT });
    } catch (err) {
        console.error('Resume error:', err);
        res.status(500).json({ error: 'Failed to resume patient' });
    }
});

// Customer signals their sample is ready while On-Hold.
router.post('/sample-ready', async (req, res) => {
    const { queue_id } = req.body;
    try {
        const [qRows] = await pool.query(`SELECT * FROM queue WHERE id = ? AND archived = false`, [queue_id]);
        if (qRows.length === 0) return res.status(404).json({ error: 'Queue entry not found' });
        const q = qRows[0];
        if (q.customer_id !== req.user.id) return res.status(403).json({ error: 'Not your queue entry' });
        if (q.status !== 'on-hold') return res.status(400).json({ error: 'You are not currently On-Hold' });

        await pool.query(`UPDATE queue SET sample_ready_at=NOW() WHERE id=?`, [queue_id]);
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true });
    } catch (err) {
        console.error('Sample-ready error:', err);
        res.status(500).json({ error: 'Failed to signal sample ready' });
    }
});

// Build the customer's live queue status.
// Shared by GET /my-status and the Virtual Assistant dialogue controller.
async function buildCustomerStatus(customerId) {
    const [seqs] = await pool.query(
        `SELECT qs.*, sp.name as package_name, sp.price FROM queue_sequences qs
         JOIN service_packages sp ON qs.package_id = sp.id
         WHERE qs.customer_id = ? AND qs.status = 'in_progress' AND qs.archived=false`, [customerId]
    );
    if (seqs.length === 0) return { active: false };

    const seq = seqs[0];
    const serviceSteps = await getPackageSteps(seq.package_id);

    // Current queue entry
    const [currentQ] = await pool.query(
        `SELECT * FROM queue WHERE sequence_id = ? AND status IN ('waiting','serving','on-hold') AND archived=false ORDER BY timestamp ASC LIMIT 1`, [seq.id]
    );

    const onHold = currentQ.length > 0 && currentQ[0].status === 'on-hold';

    // Position comes from the same ordering the station will actually call in,
    // so a re-inserted or priority patient is told the truth. Counting rows with
    // an earlier timestamp (the previous approach) ignored both.
    let position = 0, eta = 0, currentProcessing = '--';
    let stepIndex = currentQ.length > 0 && currentQ[0].step_index != null ? currentQ[0].step_index : seq.current_step;
    if (currentQ.length > 0 && !onHold) {
        const cq = currentQ[0];
        currentProcessing = await getCurrentProcessing(cq.station_type, cq.station_id);
        if (cq.status === 'serving') {
            position = 1;
        } else {
            const ordered = await getOrderedWaiting(cq.station_type, cq.station_id);
            const idx = ordered.findIndex(r => r.id === cq.id);
            position = idx === -1 ? ordered.length + 1 : idx + 1;
            // Someone is already at the counter, so this patient is one further
            // back than their place in the waiting list suggests.
            if (currentProcessing !== '--') position += 1;
        }

        for (let i = stepIndex; i < serviceSteps.length; i++) {
            const step = serviceSteps[i];
            const avg = await getStationAverageMinutes(step.type, step.station_id, step.est_time_minutes);
            eta += i === stepIndex ? position * avg : avg;
        }
    }

    // Build steps array with per-department timing for the linear queue track.
    // eta_minutes is cumulative: minutes from now until that department starts serving this customer.
    let runningEta = 0;
    const steps = [];
    for (let i = 0; i < serviceSteps.length; i++) {
        const step = serviceSteps[i];
        let status = 'pending';
        if (stepIndex > i) status = 'completed';
        else if (stepIndex === i) status = 'active';

        const avg = await getStationAverageMinutes(step.type, step.station_id, step.est_time_minutes);
        let waiting = 0;
        let etaMinutes = null;
        if (status !== 'completed') {
            if (status === 'active') {
                waiting = Math.max(0, position - 1);
                etaMinutes = 0;
                runningEta = position * avg;
            } else {
                const [wRows] = await pool.query(
                    `SELECT COUNT(*) as cnt FROM queue WHERE station_type=? AND status='waiting' AND archived=false
                     ${step.station_id ? 'AND station_id=?' : ''}`,
                    step.station_id ? [step.type, step.station_id] : [step.type]
                );
                waiting = wRows[0].cnt;
                etaMinutes = Math.ceil(runningEta);
                runningEta += avg;
            }
        }

        steps.push({
            name: step.name,
            type: step.type,
            role: step.role || null,
            is_final: !!step.is_final,
            status,
            est_minutes: avg,
            eta_minutes: etaMinutes,
            people_waiting: waiting,
            is_current_station: status === 'active'
        });
    }

    // History of stations already completed in this sequence, sourced from queue_logs
    // (going On-Hold never deletes these rows, so this doubles as the "completed stations" record).
    const [completedLogs] = await pool.query(
        `SELECT station_type, station_id, ticket_number, package_name, join_time, serve_time, complete_time
         FROM queue_logs WHERE sequence_id = ? AND complete_time IS NOT NULL AND archived=false ORDER BY complete_time ASC`,
        [seq.id]
    );

    const activeStepName = steps.find(s => s.status === 'active')?.name || null;
    const activeStep = steps.find(s => s.status === 'active') || null;

    return {
        active: true,
        sequence: seq,
        steps,
        completed_stations: completedLogs,
        current_queue: currentQ[0] || null,
        current_processing: currentProcessing,
        position,
        estimated_time: Math.ceil(eta),
        estimated_total_time: Math.ceil(eta),
        people_ahead: Math.max(0, position - 1),
        // The closing front desk step, so the customer knows the visit is not
        // over until they have been back to the desk.
        awaiting_finalization: !!(activeStep && activeStep.is_final),
        on_hold: onHold,
        hold_reason: onHold ? currentQ[0].hold_reason : null,
        hold_station_name: onHold ? activeStepName : null,
        sample_ready_at: onHold ? currentQ[0].sample_ready_at : null,
        reinstated: !!(currentQ[0] && currentQ[0].reinsert_slot)
    };
}

// Get customer's queue status
router.get('/my-status', async (req, res) => {
    try {
        res.json(await buildCustomerStatus(req.user.id));
    } catch (err) {
        console.error('My status error:', err);
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// Cancel active queue
router.post('/cancel', async (req, res) => {
    try {
        await pool.query(`UPDATE queue SET status='cancelled' WHERE customer_id=? AND status IN ('waiting','on-hold')`, [req.user.id]);
        await pool.query(`UPDATE queue_sequences SET status='cancelled' WHERE customer_id=? AND status='in_progress'`, [req.user.id]);
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to cancel' }); }
});

// Get queue state for a station. The waiting rows come back in call order (not
// join order) and carry call_position, so what the staff read on screen is the
// order the station will actually work through.
router.get('/station', requireStaff, async (req, res) => {
    const { type, id } = req.query;
    try {
        // sp.test_structure_id rides along so the laboratory workspace can open
        // on the result form the patient's own service expects, instead of
        // whatever the dropdown happened to be left on.
        let query = `SELECT q.*, u.username, u.full_name, u.customer_category,
                            sp.test_structure_id, sp.name AS package_name
                     FROM queue q
                     LEFT JOIN users u ON q.customer_id = u.id
                     LEFT JOIN queue_sequences qs ON q.sequence_id = qs.id
                     LEFT JOIN service_packages sp ON qs.package_id = sp.id
                     WHERE q.station_type=? AND q.status IN ('waiting','serving','on-hold') AND q.archived=false`;
        const params = [type];
        if (id) { query += ' AND q.station_id=?'; params.push(id); }
        query += ' ORDER BY q.timestamp ASC';
        const [rows] = await pool.query(query, params);

        const waiting = await queueAutomation.orderWaitingList(rows.filter(r => r.status === 'waiting'));
        waiting.forEach((row, i) => {
            row.call_position = i + 1;
            row.reinserted = !!row.reinsert_slot;
        });
        const others = rows.filter(r => r.status !== 'waiting');

        // Serving first, then the waiting list in call order, then On-Hold.
        res.json([
            ...others.filter(r => r.status === 'serving'),
            ...waiting,
            ...others.filter(r => r.status === 'on-hold')
        ]);
    } catch (err) {
        console.error('Station queue error:', err);
        res.status(500).json({ error: 'Failed to fetch queue' });
    }
});

// Get booked time slots for a specific date
router.get('/booked-slots', async (req, res) => {
    const { date } = req.query;
    try {
        if (!date) return res.status(400).json({ error: 'Date is required' });
        const [rows] = await pool.query(
            `SELECT appointment_time FROM appointments WHERE appointment_date = ? AND status != 'cancelled' AND archived=false`,
            [date]
        );
        const slots = rows.map(r => r.appointment_time.substring(0, 5));
        res.json(slots);
    } catch (err) {
        console.error('Booked slots error:', err);
        res.status(500).json({ error: 'Failed to fetch booked slots' });
    }
});

router.get('/booked-dates', async (req, res) => {
    const { month } = req.query;
    try {
        if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Month must be YYYY-MM' });
        const [rows] = await pool.query(
            `SELECT appointment_date, COUNT(*) as booked_count
             FROM appointments
             WHERE DATE_FORMAT(appointment_date, '%Y-%m') = ? AND status != 'cancelled' AND archived=false
             GROUP BY appointment_date`,
            [month]
        );
        res.json(rows.map(r => ({
            date: typeof r.appointment_date === 'string' ? r.appointment_date.substring(0, 10) : new Date(r.appointment_date).toLocaleDateString('en-CA'),
            booked_count: r.booked_count
        })));
    } catch (err) {
        console.error('Booked dates error:', err);
        res.status(500).json({ error: 'Failed to fetch booked dates' });
    }
});

module.exports = router;
module.exports.stationDisplayName = stationDisplayName;
// Exposed for the Virtual Assistant dialogue controller (routes/assistant.js),
// which grounds its answers in the same live queue state the dashboard renders.
module.exports.buildCustomerStatus = buildCustomerStatus;
