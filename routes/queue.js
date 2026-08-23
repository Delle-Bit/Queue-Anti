const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const queueAutomation = require('../queue_automation');
const { requireStaff } = require('../config');

function getQueueType(category) {
    if (category === 'Senior') return 'S';
    if (category === 'PWD') return 'D';
    if (category === 'Pregnant') return 'P';
    return 'Q';
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

async function getPackageSteps(packageId) {
    const [labs] = await pool.query(
        `SELECT pl.*, l.name as lab_name, l.service_type
         FROM package_laboratories pl
         JOIN laboratories l ON pl.laboratory_id = l.id
         WHERE pl.package_id = ? AND pl.archived=false AND l.archived=false
         ORDER BY pl.sequence_order`,
        [packageId]
    );
    const [pkgDoctor] = await pool.query(
        `SELECT sp.doctor_id, d.name as doctor_name
         FROM service_packages sp
         LEFT JOIN doctors d ON sp.doctor_id=d.id
         WHERE sp.id = ? AND sp.doctor_id IS NOT NULL`,
        [packageId]
    );
    const steps = [{ name: 'Front Desk', type: 'frontdesk', station_id: null, est_time_minutes: 5 }];
    labs.forEach(lab => steps.push({
        name: lab.lab_name,
        type: 'laboratory',
        station_id: lab.laboratory_id,
        est_time_minutes: lab.est_time_minutes || 10
    }));
    if (pkgDoctor.length > 0) {
        steps.push({
            name: pkgDoctor[0].doctor_name || 'Doctor',
            type: 'doctor',
            station_id: pkgDoctor[0].doctor_id,
            est_time_minutes: 15
        });
    }
    return steps;
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
        const steps = await getPackageSteps(package_id);
        const doctorStep = steps.find(step => step.type === 'doctor');
        const totalSteps = steps.length;

        const [seqResult] = await pool.query(
            'INSERT INTO queue_sequences (customer_id, package_id, current_step, total_steps, has_doctor_step, doctor_id) VALUES (?, ?, 0, ?, ?, ?)',
            [req.user.id, package_id, totalSteps, doctorStep ? 1 : 0, doctorStep ? doctorStep.station_id : null]
        );
        const seqId = seqResult.insertId;

        const type = getQueueType(req.user.category);

        // Generate ticket number for frontdesk (atomic counter)
        const ticketNum = await queueAutomation.nextTicketNumber('frontdesk', null, type);
        const queueId = `cust_${req.user.id}_${seqId}`;

        // Insert into queue at frontdesk
        await pool.query(
            `INSERT INTO queue (id, station_type, station_id, number, type, status, customer_id, sequence_id)
             VALUES (?, 'frontdesk', NULL, ?, ?, 'waiting', ?, ?)`,
            [queueId, ticketNum, type, req.user.id, seqId]
        );
        await pool.query(
            `INSERT INTO queue_logs (station_type, station_id, ticket_number, type, customer_id, sequence_id, package_name, price, join_time)
             VALUES ('frontdesk', NULL, ?, ?, ?, ?, ?, ?, NOW())`,
            [ticketNum, type, req.user.id, seqId, pkgs[0].name, pkgs[0].price]
        );

        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true, ticket: ticketNum, sequence_id: seqId, estimated_total_time: startPreview?.estimated_total_time || 0 });
    } catch (err) {
        console.error('Start package error:', err);
        res.status(500).json({ error: 'Failed to start queue' });
    }
});

// Complete current step → auto-advance
router.post('/complete-step', requireStaff, async (req, res) => {
    const { queue_id } = req.body;
    try {
        const [qRows] = await pool.query('SELECT * FROM queue WHERE id = ? AND archived = false', [queue_id]);
        if (qRows.length === 0) return res.status(404).json({ error: 'Queue entry not found' });
        const q = qRows[0];

        // Mark current queue entry as completed
        await pool.query(`UPDATE queue SET status = 'completed' WHERE id = ?`, [queue_id]);
        await pool.query(
            `UPDATE queue_logs SET complete_time = NOW()
             WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ? AND complete_time IS NULL
             ORDER BY id DESC LIMIT 1`,
            [q.sequence_id, q.station_type, q.station_id, q.number]
        );

        // Advance sequence
        const [seqs] = await pool.query('SELECT * FROM queue_sequences WHERE id = ? AND archived = false', [q.sequence_id]);
        if (seqs.length === 0) return res.json({ success: true, finished: true });
        const seq = seqs[0];
        const nextStep = seq.current_step + 1;

        if (nextStep >= seq.total_steps) {
            // All steps done
            await pool.query(`UPDATE queue_sequences SET current_step = ?, status = 'completed', completed_at = NOW() WHERE id = ?`, [nextStep, seq.id]);
            if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
            return res.json({ success: true, finished: true, message: 'All steps completed!' });
        }

        // Update sequence step
        await pool.query('UPDATE queue_sequences SET current_step = ? WHERE id = ?', [nextStep, seq.id]);

        // Get next lab from package_laboratories OR doctor step
        const labStepIndex = nextStep; // step 1 = first lab, step 2 = second lab, etc.
        const [seqFull] = await pool.query('SELECT * FROM queue_sequences WHERE id = ?', [seq.id]);
        const seqData = seqFull[0];
        const labCount = await pool.query('SELECT COUNT(*) as cnt FROM package_laboratories WHERE package_id = ? AND archived=false', [seq.package_id]);
        const totalLabs = labCount[0][0].cnt;

        // Check if this step is a doctor step (after all labs)
        if (seqData.has_doctor_step && nextStep === 1 + totalLabs) {
            // Route to doctor station
            const doctorId = seqData.doctor_id;
            const [docRows] = await pool.query('SELECT * FROM doctors WHERE id = ? AND archived=false', [doctorId]);
            const doc = docRows[0];
            if (!doc) {
                await pool.query(`UPDATE queue_sequences SET status='completed', completed_at=NOW() WHERE id=?`, [seq.id]);
                if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
                return res.json({ success: true, finished: true });
            }
            const newTicket = await queueAutomation.nextTicketNumber('doctor', doctorId, q.type);
            const newQueueId = `cust_${q.customer_id}_${seq.id}_s${nextStep}`;
            await pool.query(
                `INSERT INTO queue (id, station_type, station_id, number, type, status, customer_id, sequence_id)
                 VALUES (?, 'doctor', ?, ?, ?, 'waiting', ?, ?)`,
                [newQueueId, doctorId, newTicket, q.type, q.customer_id, seq.id]
            );
            await pool.query(
                `INSERT INTO queue_logs (station_type, station_id, ticket_number, type, customer_id, sequence_id, package_name, price, join_time)
                 VALUES ('doctor', ?, ?, ?, ?, ?, ?, 0, NOW())`,
                [doctorId, newTicket, q.type, q.customer_id, seq.id, doc.name]
            );
            if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
            return res.json({ success: true, finished: false, next_station: doc.name, next_ticket: newTicket, station_type: 'doctor' });
        }

        const [labs] = await pool.query(
            'SELECT pl.*, l.name as lab_name FROM package_laboratories pl JOIN laboratories l ON pl.laboratory_id = l.id WHERE pl.package_id = ? AND pl.sequence_order = ? AND pl.archived=false AND l.archived=false',
            [seq.package_id, nextStep]
        );

        if (labs.length === 0) {
            await pool.query(`UPDATE queue_sequences SET status = 'completed', completed_at = NOW() WHERE id = ?`, [seq.id]);
            if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
            return res.json({ success: true, finished: true });
        }

        const lab = labs[0];
        let type = q.type;

        // Generate new ticket for lab (atomic counter)
        const newTicket = await queueAutomation.nextTicketNumber('laboratory', lab.laboratory_id, type);
        const newQueueId = `cust_${q.customer_id}_${seq.id}_s${nextStep}`;

        await pool.query(
            `INSERT INTO queue (id, station_type, station_id, number, type, status, customer_id, sequence_id)
             VALUES (?, 'laboratory', ?, ?, ?, 'waiting', ?, ?)`,
            [newQueueId, lab.laboratory_id, newTicket, type, q.customer_id, seq.id]
        );
        await pool.query(
            `INSERT INTO queue_logs (station_type, station_id, ticket_number, type, customer_id, sequence_id, package_name, price, join_time)
             VALUES ('laboratory', ?, ?, ?, ?, ?, ?, 0, NOW())`,
            [lab.laboratory_id, newTicket, type, q.customer_id, seq.id, lab.lab_name]
        );

        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true, finished: false, next_station: lab.lab_name, next_ticket: newTicket });
    } catch (err) {
        console.error('Complete step error:', err);
        res.status(500).json({ error: 'Failed to complete step' });
    }
});

// Call next in station
router.post('/next', requireStaff, async (req, res) => {
    const { station_type, station_id } = req.body;
    try {
        let query = `SELECT * FROM queue WHERE station_type=? AND status='waiting' AND archived=false`;
        const params = [station_type];
        if (station_id) { query += ' AND station_id=?'; params.push(station_id); }
        query += ' ORDER BY timestamp ASC';
        const [rows] = await pool.query(query, params);
        if (rows.length === 0) return res.json({ success: false, message: 'Queue is empty' });

        // Priority scoring
        const next = await queueAutomation.getNextFromList(rows);
        await pool.query(`UPDATE queue SET status='serving' WHERE id=?`, [next.id]);
        await pool.query(
            `UPDATE queue_logs SET serve_time=NOW()
             WHERE sequence_id = ? AND station_type = ? AND station_id <=> ? AND ticket_number = ? AND complete_time IS NULL
             ORDER BY id DESC LIMIT 1`,
            [next.sequence_id, next.station_type, next.station_id, next.number]
        );
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true, next: next.number, queue_id: next.id });
    } catch (err) { res.status(500).json({ error: 'Failed to call next' }); }
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
        `SELECT * FROM queue WHERE sequence_id = ? AND status IN ('waiting','serving') AND archived=false ORDER BY timestamp ASC LIMIT 1`, [seq.id]
    );

    // Calculate position, current processing number, and total service estimate from live station data.
    let position = 0, eta = 0, currentProcessing = '--';
    if (currentQ.length > 0) {
        const cq = currentQ[0];
        let countQuery = `SELECT COUNT(*) as cnt FROM queue WHERE station_type=? AND status='waiting' AND archived=false AND timestamp < ?`;
        const countParams = [cq.station_type, cq.timestamp];
        if (cq.station_id) { countQuery += ' AND station_id=?'; countParams.push(cq.station_id); }
        const [posRows] = await pool.query(countQuery, countParams);
        position = posRows[0].cnt + 1;
        currentProcessing = await getCurrentProcessing(cq.station_type, cq.station_id);

        for (let i = seq.current_step; i < serviceSteps.length; i++) {
            const step = serviceSteps[i];
            const avg = await getStationAverageMinutes(step.type, step.station_id, step.est_time_minutes);
            eta += i === seq.current_step ? position * avg : avg;
        }
    }

    // Build steps array with per-department timing for the linear queue track.
    // eta_minutes is cumulative: minutes from now until that department starts serving this customer.
    let runningEta = 0;
    const steps = [];
    for (let i = 0; i < serviceSteps.length; i++) {
        const step = serviceSteps[i];
        let status = 'pending';
        if (seq.current_step > i) status = 'completed';
        else if (seq.current_step === i) status = 'active';

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
            status,
            est_minutes: avg,
            eta_minutes: etaMinutes,
            people_waiting: waiting,
            is_current_station: status === 'active'
        });
    }

    return {
        active: true,
        sequence: seq,
        steps,
        current_queue: currentQ[0] || null,
        current_processing: currentProcessing,
        position,
        estimated_time: Math.ceil(eta),
        estimated_total_time: Math.ceil(eta),
        people_ahead: Math.max(0, position - 1)
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
        await pool.query(`UPDATE queue SET status='cancelled' WHERE customer_id=? AND status IN ('waiting')`, [req.user.id]);
        await pool.query(`UPDATE queue_sequences SET status='cancelled' WHERE customer_id=? AND status='in_progress'`, [req.user.id]);
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to cancel' }); }
});

// Get queue state for a station
router.get('/station', requireStaff, async (req, res) => {
    const { type, id } = req.query;
    try {
        let query = `SELECT q.*, u.username, u.full_name, u.customer_category
                     FROM queue q LEFT JOIN users u ON q.customer_id = u.id
                     WHERE q.station_type=? AND q.status IN ('waiting','serving') AND q.archived=false`;
        const params = [type];
        if (id) { query += ' AND q.station_id=?'; params.push(id); }
        query += ' ORDER BY q.timestamp ASC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch queue' }); }
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
// Exposed for the Virtual Assistant dialogue controller (routes/assistant.js),
// which grounds its answers in the same live queue state the dashboard renders.
module.exports.buildCustomerStatus = buildCustomerStatus;
