const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const bcrypt = require('bcrypt');

// --- USERS ---
router.get('/users/staff', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT id, username, role, full_name, email, created_at FROM users WHERE role != 'customer' ORDER BY created_at DESC`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/users/customers', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT u.id, u.username, u.full_name, u.email, u.customer_category, u.created_at,
                   COUNT(qs.id) as total_services
            FROM users u LEFT JOIN queue_sequences qs ON u.id = qs.customer_id AND qs.status='completed'
            WHERE u.role = 'customer' GROUP BY u.id ORDER BY u.created_at DESC
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/users', async (req, res) => {
    const { username, password, role, email, full_name } = req.body;
    try {
        // Admin role cannot create other admins
        if (req.user.role === 'admin' && (role === 'admin' || role === 'admintechnical')) {
            return res.status(403).json({ error: 'Admin cannot create other Admin accounts' });
        }
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password_hash, role, email, full_name) VALUES (?, ?, ?, ?, ?)',
            [username, hash, role, email || '', full_name || '']
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to create user' }); }
});

router.put('/users/:id', async (req, res) => {
    const { password, role, email, full_name } = req.body;
    try {
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            await pool.query('UPDATE users SET password_hash=?, role=?, email=?, full_name=? WHERE id=?',
                [hash, role, email || '', full_name || '', req.params.id]);
        } else {
            await pool.query('UPDATE users SET role=?, email=?, full_name=? WHERE id=?',
                [role, email || '', full_name || '', req.params.id]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to update user' }); }
});

router.delete('/users/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to delete user' }); }
});

// --- LABORATORIES ---
router.get('/laboratories', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT l.*, u.username as staff_name FROM laboratories l
            LEFT JOIN users u ON l.assigned_staff_id = u.id ORDER BY l.name
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/laboratories', async (req, res) => {
    const { name, service_type, assigned_staff_id, start_time, cutoff_time } = req.body;
    try {
        await pool.query(
            'INSERT INTO laboratories (name, service_type, assigned_staff_id, start_time, cutoff_time) VALUES (?, ?, ?, ?, ?)',
            [name, service_type || '', assigned_staff_id || null, start_time || null, cutoff_time || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/laboratories/:id', async (req, res) => {
    const { name, service_type, assigned_staff_id, is_open, start_time, cutoff_time } = req.body;
    try {
        await pool.query(
            'UPDATE laboratories SET name=?, service_type=?, assigned_staff_id=?, is_open=?, start_time=?, cutoff_time=? WHERE id=?',
            [name, service_type, assigned_staff_id || null, is_open !== false, start_time || null, cutoff_time || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/laboratories/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM laboratories WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- APPOINTMENTS ---
router.get('/appointments', async (req, res) => {
    try {
        let query = `SELECT a.*, sp.name as package_name, sp.price, u.username, u.full_name
                     FROM appointments a
                     JOIN service_packages sp ON a.package_id = sp.id
                     JOIN users u ON a.customer_id = u.id ORDER BY a.appointment_date, a.appointment_time`;
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/appointments/my', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, sp.name as package_name, sp.price FROM appointments a
             JOIN service_packages sp ON a.package_id = sp.id
             WHERE a.customer_id = ? ORDER BY a.appointment_date DESC`, [req.user.id]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/appointments', async (req, res) => {
    const { package_id, appointment_date, appointment_time, payment_method, payment_ref, notes } = req.body;
    try {
        await pool.query(
            `INSERT INTO appointments (customer_id, package_id, appointment_date, appointment_time, payment_status, payment_method, payment_ref, notes)
             VALUES (?, ?, ?, ?, 'paid', ?, ?, ?)`,
            [req.user.id, package_id, appointment_date, appointment_time, payment_method || 'mock', payment_ref || 'MOCK-' + Date.now(), notes || '']
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- ANALYTICS ---
router.get('/analytics/frontdesk', async (req, res) => {
    try {
        const [avg] = await pool.query(`SELECT AVG(TIMESTAMPDIFF(MINUTE,serve_time,complete_time)) as v FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`);
        const [perHour] = await pool.query(`SELECT COUNT(*)/GREATEST(1,TIMESTAMPDIFF(HOUR,MIN(serve_time),MAX(complete_time))) as v FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`);
        const [total] = await pool.query(`SELECT COUNT(*) as v FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE()`);
        const [fastest] = await pool.query(`SELECT ticket_number, package_name, TIMESTAMPDIFF(MINUTE,serve_time,complete_time) as mins FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE() ORDER BY mins ASC LIMIT 1`);
        const [slowest] = await pool.query(`SELECT ticket_number, package_name, TIMESTAMPDIFF(MINUTE,serve_time,complete_time) as mins FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time)=CURDATE() ORDER BY mins DESC LIMIT 1`);
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

router.get('/analytics/laboratory/:id', async (req, res) => {
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

router.get('/analytics/admin', async (req, res) => {
    try {
        const [userCounts] = await pool.query(`SELECT role, COUNT(*) as cnt FROM users GROUP BY role`);
        const [catCounts] = await pool.query(`SELECT customer_category, COUNT(*) as cnt FROM users WHERE role='customer' GROUP BY customer_category`);
        const [sessions] = await pool.query(`SELECT ss.*, u.username FROM staff_sessions ss JOIN users u ON ss.user_id=u.id ORDER BY ss.login_time DESC LIMIT 20`);
        const [labVolume] = await pool.query(`SELECT station_id, COUNT(*) as cnt FROM queue_logs WHERE station_type='laboratory' AND DATE(join_time)=CURDATE() GROUP BY station_id`);
        const [fdVolume] = await pool.query(`SELECT COUNT(*) as cnt FROM queue_logs WHERE station_type='frontdesk' AND DATE(join_time)=CURDATE()`);
        res.json({ userCounts, catCounts, sessions, labVolume, fdVolume: fdVolume[0].cnt });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/analytics/owner', async (req, res) => {
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
        await pool.query(`UPDATE staff_sessions SET logout_time=NOW() WHERE user_id=? AND logout_time IS NULL ORDER BY id DESC LIMIT 1`, [req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- AUDIT LOGS ---
router.get('/audit-logs', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT al.*, u.username FROM audit_logs al LEFT JOIN users u ON al.performed_by=u.id ORDER BY al.created_at DESC LIMIT 100`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- SETTINGS ---
router.get('/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings WHERE id=1');
        res.json(rows[0] || {});
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/settings', async (req, res) => {
    const { site_name, logo_path, theme, navbar_color, background_image } = req.body;
    try {
        await pool.query(
            `UPDATE settings SET site_name=?, logo_path=?, theme=?, navbar_color=?, background_image=? WHERE id=1`,
            [site_name, logo_path, theme || 'light', navbar_color || '#ffffff', background_image || '']
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to update settings' }); }
});

// --- MEDICAL RECORDS ---
router.get('/medical-records/my', async (req, res) => {
    try {
        const [user] = await pool.query('SELECT full_name, gender, birthday FROM users WHERE id = ?', [req.user.id]);
        const [rows] = await pool.query('SELECT * FROM medical_records WHERE customer_id = ?', [req.user.id]);
        
        if (rows.length > 0) {
            res.json({ ...rows[0], user: user[0] });
        } else {
            res.json({ user: user[0] }); // No medical record yet, but send user info
        }
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/medical-records/my', async (req, res) => {
    const { full_name, gender, birthday, birthplace, address, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions } = req.body;
    const customer_id = req.user.id;
    try {
        await pool.query('UPDATE users SET full_name=?, gender=?, birthday=? WHERE id=?', [full_name, gender || null, birthday || null, customer_id]);

        const [existing] = await pool.query('SELECT id FROM medical_records WHERE customer_id = ?', [customer_id]);
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
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/medical-records/:customerId', async (req, res) => {
    try {
        const [user] = await pool.query('SELECT full_name, gender, birthday FROM users WHERE id = ?', [req.params.customerId]);
        const [rows] = await pool.query('SELECT * FROM medical_records WHERE customer_id = ?', [req.params.customerId]);
        
        if (rows.length > 0) {
            res.json({ ...rows[0], user: user[0] });
        } else {
            res.json(null);
        }
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/medical-records', async (req, res) => {
    const { customer_id, birthplace, address, phone, status, occupation, retiree, emergency_contact, current_health, past_conditions } = req.body;
    try {
        const [existing] = await pool.query('SELECT id FROM medical_records WHERE customer_id = ?', [customer_id]);
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
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- LAB NOTES ---
router.get('/lab-notes/:customerId', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT ln.*, u.username as staff_name FROM lab_notes ln
             LEFT JOIN users u ON ln.staff_id = u.id
             WHERE ln.customer_id = ? ORDER BY ln.created_at DESC`,
            [req.params.customerId]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/lab-notes', async (req, res) => {
    const { customer_id, note } = req.body;
    try {
        await pool.query(
            `INSERT INTO lab_notes (customer_id, staff_id, note) VALUES (?, ?, ?)`,
            [customer_id, req.user.id, note]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- FAQS (for chatbot) ---
router.get('/faqs', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM pricing_faqs');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
