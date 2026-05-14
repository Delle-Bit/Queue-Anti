const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const queueAutomation = require('../queue_automation');

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

        // Count labs in package
        const [labs] = await pool.query('SELECT * FROM package_laboratories WHERE package_id = ? AND archived = false ORDER BY sequence_order', [package_id]);
        const totalSteps = 1 + labs.length; // frontdesk + labs

        // Create sequence
        const [seqResult] = await pool.query(
            'INSERT INTO queue_sequences (customer_id, package_id, current_step, total_steps) VALUES (?, ?, 0, ?)',
            [req.user.id, package_id, totalSteps]
        );
        const seqId = seqResult.insertId;

        // Determine queue type from category
        let type = 'Q';
        if (req.user.category === 'Senior') type = 'S';
        else if (req.user.category === 'PWD') type = 'D';
        else if (req.user.category === 'Pregnant') type = 'P';

        // Generate ticket number for frontdesk
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as cnt FROM queue_logs WHERE station_type='frontdesk' AND DATE(join_time) = CURDATE() AND archived = false`
        );
        const ticketNum = `${type}-${String(countRows[0].cnt + 1).padStart(3, '0')}`;
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
        res.json({ success: true, ticket: ticketNum, sequence_id: seqId });
    } catch (err) {
        console.error('Start package error:', err);
        res.status(500).json({ error: 'Failed to start queue' });
    }
});

// Complete current step → auto-advance
router.post('/complete-step', async (req, res) => {
    const { queue_id } = req.body;
    try {
        const [qRows] = await pool.query('SELECT * FROM queue WHERE id = ? AND archived = false', [queue_id]);
        if (qRows.length === 0) return res.status(404).json({ error: 'Queue entry not found' });
        const q = qRows[0];

        // Mark current queue entry as completed
        await pool.query(`UPDATE queue SET status = 'completed' WHERE id = ?`, [queue_id]);
        await pool.query(
            `UPDATE queue_logs SET complete_time = NOW() WHERE ticket_number = ? AND complete_time IS NULL ORDER BY id DESC LIMIT 1`,
            [q.number]
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

        // Get next lab from package_laboratories (step 1 = first lab, etc.)
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

        // Generate new ticket for lab
        const [cnt] = await pool.query(
            `SELECT COUNT(*) as cnt FROM queue_logs WHERE station_type='laboratory' AND station_id=? AND DATE(join_time)=CURDATE() AND archived=false`,
            [lab.laboratory_id]
        );
        const newTicket = `${type}-${String(cnt[0].cnt + 1).padStart(3, '0')}`;
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
router.post('/next', async (req, res) => {
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
            `UPDATE queue_logs SET serve_time=NOW() WHERE ticket_number=? AND complete_time IS NULL ORDER BY id DESC LIMIT 1`,
            [next.number]
        );
        if (req.app.get('io')) req.app.get('io').emit('queueUpdate', {});
        res.json({ success: true, next: next.number, queue_id: next.id });
    } catch (err) { res.status(500).json({ error: 'Failed to call next' }); }
});

// Get customer's queue status
router.get('/my-status', async (req, res) => {
    try {
        const [seqs] = await pool.query(
            `SELECT qs.*, sp.name as package_name, sp.price FROM queue_sequences qs
             JOIN service_packages sp ON qs.package_id = sp.id
             WHERE qs.customer_id = ? AND qs.status = 'in_progress' AND qs.archived=false`, [req.user.id]
        );
        if (seqs.length === 0) return res.json({ active: false });

        const seq = seqs[0];
        const [labs] = await pool.query(
            `SELECT pl.*, l.name as lab_name, l.service_type FROM package_laboratories pl
             JOIN laboratories l ON pl.laboratory_id = l.id
             WHERE pl.package_id = ? AND pl.archived=false AND l.archived=false ORDER BY pl.sequence_order`, [seq.package_id]
        );

        // Current queue entry
        const [currentQ] = await pool.query(
            `SELECT * FROM queue WHERE sequence_id = ? AND status IN ('waiting','serving') AND archived=false LIMIT 1`, [seq.id]
        );

        // Calculate position and ETA
        let position = 0, eta = 0;
        if (currentQ.length > 0) {
            const cq = currentQ[0];
            let countQuery = `SELECT COUNT(*) as cnt FROM queue WHERE station_type=? AND status='waiting' AND archived=false AND timestamp < ?`;
            const countParams = [cq.station_type, cq.timestamp];
            if (cq.station_id) { countQuery += ' AND station_id=?'; countParams.push(cq.station_id); }
            const [posRows] = await pool.query(countQuery, countParams);
            position = posRows[0].cnt + 1;

            // ETA for current station
            let avgQuery = `SELECT AVG(TIMESTAMPDIFF(MINUTE, serve_time, complete_time)) as avg_mins FROM queue_logs WHERE station_type=? AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`;
            const avgParams = [cq.station_type];
            if (cq.station_id) { avgQuery += ' AND station_id=?'; avgParams.push(cq.station_id); }
            const [avgRows] = await pool.query(avgQuery, avgParams);
            eta = position * (parseFloat(avgRows[0].avg_mins) || 5);

            // Add ETA for remaining stations
            for (let i = seq.current_step; i < labs.length; i++) {
                const [labAvg] = await pool.query(
                    `SELECT AVG(TIMESTAMPDIFF(MINUTE, serve_time, complete_time)) as avg_mins FROM queue_logs WHERE station_type='laboratory' AND station_id=? AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`,
                    [labs[i].laboratory_id]
                );
                eta += parseFloat(labAvg[0].avg_mins) || labs[i].est_time_minutes || 10;
            }
        }

        // Build steps array
        const steps = [{ name: 'Front Desk', type: 'frontdesk', status: seq.current_step > 0 ? 'completed' : (seq.current_step === 0 ? 'active' : 'pending') }];
        labs.forEach((lab, i) => {
            let status = 'pending';
            if (seq.current_step > i + 1) status = 'completed';
            else if (seq.current_step === i + 1) status = 'active';
            steps.push({ name: lab.lab_name, type: 'laboratory', status });
        });

        res.json({
            active: true,
            sequence: seq,
            steps,
            current_queue: currentQ[0] || null,
            position,
            estimated_time: Math.ceil(eta),
            people_ahead: Math.max(0, position - 1)
        });
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
router.get('/station', async (req, res) => {
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
