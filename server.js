const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { pool, initDB, DEFAULT_SERVICES } = require('./database.js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');
const { JWT_SECRET, requireAdmin } = require('./config');
const { nextTicketNumber } = require('./queue_automation');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.set('io', io);

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/images', express.static('images'));

// Public site settings (branding/theme for unauthenticated pages)
app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings WHERE id=1');
        res.json(rows[0] || {});
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Socket.io
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => console.log('Client disconnected'));
});

// Auth middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Missing token' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

function verifyRoles(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
        next();
    };
}

// Routes — order matters: specific routes before catch-all
const queueRoutes = require('./routes/queue');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const reportRoutes = require('./routes/reports');
const packageRoutes = require('./routes/packages');
const assistantRoutes = require('./routes/assistant');

app.use('/api/auth', authRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/queue', authenticateToken, queueRoutes);
app.use('/api/assistant', authenticateToken, assistantRoutes);
app.use('/api/reports', authenticateToken, verifyRoles('owner'), reportRoutes);
app.use('/api/admin', authenticateToken, requireAdmin, adminRoutes);
app.use('/api', authenticateToken, adminRoutes);

async function startQueueFromAppointment(appointment, io) {
    const [existing] = await pool.query(
        `SELECT id FROM queue_sequences WHERE customer_id = ? AND status = 'in_progress' AND archived = false`,
        [appointment.customer_id]
    );
    if (existing.length > 0) return { alreadyActive: true };

    const [labs] = await pool.query(
        'SELECT * FROM package_laboratories WHERE package_id = ? AND archived = false ORDER BY sequence_order',
        [appointment.package_id]
    );
    const [pkgDoctor] = await pool.query('SELECT doctor_id FROM service_packages WHERE id = ? AND doctor_id IS NOT NULL', [appointment.package_id]);
    const hasDoctorStep = pkgDoctor.length > 0;
    const totalSteps = 1 + labs.length + (hasDoctorStep ? 1 : 0);
    const [userRows] = await pool.query('SELECT customer_category FROM users WHERE id=?', [appointment.customer_id]);
    const category = userRows[0]?.customer_category || 'Regular';
    let type = 'Q';
    if (category === 'Senior') type = 'S';
    else if (category === 'PWD') type = 'D';
    else if (category === 'Pregnant') type = 'P';

    const [seqResult] = await pool.query(
        'INSERT INTO queue_sequences (customer_id, package_id, current_step, total_steps, has_doctor_step, doctor_id) VALUES (?, ?, 0, ?, ?, ?)',
        [appointment.customer_id, appointment.package_id, totalSteps, hasDoctorStep ? 1 : 0, hasDoctorStep ? pkgDoctor[0].doctor_id : null]
    );
    const seqId = seqResult.insertId;
    const ticketNum = await nextTicketNumber('frontdesk', null, type);
    const queueId = `appt_${appointment.id}_${seqId}`;
    await pool.query(
        `INSERT INTO queue (id, station_type, station_id, number, type, status, customer_id, sequence_id)
         VALUES (?, 'frontdesk', NULL, ?, ?, 'waiting', ?, ?)`,
        [queueId, ticketNum, type, appointment.customer_id, seqId]
    );
    await pool.query(
        `INSERT INTO queue_logs (station_type, station_id, ticket_number, type, customer_id, sequence_id, package_name, price, join_time)
         VALUES ('frontdesk', NULL, ?, ?, ?, ?, ?, ?, NOW())`,
        [ticketNum, type, appointment.customer_id, seqId, appointment.package_name, appointment.price]
    );
    if (io) io.emit('queueUpdate', { appointment_id: appointment.id, queue_id: queueId });
    return { ticket: ticketNum, sequence_id: seqId };
}

function makeCustomerUid(insertId) {
    const year = new Date().getFullYear();
    return `MC-${year}-${String(insertId).padStart(6, '0')}`;
}

app.post('/api/appointments/check-in', authenticateToken, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'Token is required' });
    try {
        const [rows] = await pool.query(
            `SELECT a.*, sp.name as package_name, sp.price
             FROM appointments a JOIN service_packages sp ON a.package_id = sp.id
             WHERE a.qr_token = ? AND a.archived = false`,
            [token]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'Invalid or expired check-in code.' });
        const appointment = rows[0];

        if (appointment.status === 'checked-in' || appointment.status === 'completed') {
             return res.status(400).json({ success: false, error: 'Already checked in or completed.' });
        }

        await pool.query(
            `UPDATE appointments SET status='checked-in', checked_in_at=NOW() WHERE id=?`,
            [appointment.id]
        );

        const queue = await startQueueFromAppointment(appointment, io);
        res.json({ success: true, ticket: queue.ticket, package_name: appointment.package_name });
    } catch (err) {
        console.error('API QR check-in error:', err);
        res.status(500).json({ success: false, error: 'Check-in failed.' });
    }
});

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

app.get('/checkin/:token', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, sp.name as package_name, sp.price
             FROM appointments a JOIN service_packages sp ON a.package_id = sp.id
             WHERE a.qr_token = ? AND a.archived = false`,
            [req.params.token]
        );
        if (rows.length === 0) return res.status(404).send('Invalid or expired check-in code.');
        const appointment = rows[0];
        if (appointment.status !== 'checked-in') {
            await pool.query(
                `UPDATE appointments SET status='checked-in', checked_in_at=COALESCE(checked_in_at, NOW()) WHERE id=?`,
                [appointment.id]
            );
        }
        const queue = await startQueueFromAppointment(appointment, io);
        const ticket = escapeHtml(queue.ticket || 'Active');
        const pkgName = escapeHtml(appointment.package_name);
        res.send(`
            <!doctype html><html><head><title>Clinic Check-In</title><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:Arial,sans-serif;background:#f5f6fa;color:#2c3e50;display:grid;place-items:center;min-height:100vh;margin:0}.box{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.12)}.ticket{font-size:42px;font-weight:700;color:#4A90D9}</style></head>
            <body><div class="box"><h1>Checked in</h1><p>Your queue session has started.</p><div class="ticket">${ticket}</div><p>${pkgName}</p></div></body></html>
        `);
    } catch (err) {
        console.error('QR check-in error:', err);
        res.status(500).send('Check-in failed. Please approach the front desk.');
    }
});

// Seed accounts & start
async function startServer() {
    await initDB();

    // Seed accounts
    const seeds = [
        { username: 'admin_tech', password: 'admin123', role: 'admintechnical' },
        { username: 'admin_regular', password: 'admin123', role: 'admin' },
        { username: 'frontdesk1', password: 'pass123', role: 'frontdesk' },
        { username: 'lab_xray', password: 'pass123', role: 'laboratory' },
        { username: 'lab_blood', password: 'pass123', role: 'laboratory' },
        { username: 'owner1', password: 'owner123', role: 'owner' },
        { username: 'doctor1', password: 'pass123', role: 'doctor' },
        { username: 'customer_regular', password: 'pass123', role: 'customer', category: 'Regular' },
        { username: 'customer_senior', password: 'pass123', role: 'customer', category: 'Senior' },
        { username: 'customer_pwd', password: 'pass123', role: 'customer', category: 'PWD' },
        { username: 'customer_pregnant', password: 'pass123', role: 'customer', category: 'Pregnant' }
    ];

    for (const s of seeds) {
        const [exists] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE username=?', [s.username]);
        if (exists[0].cnt === 0) {
            const hash = await bcrypt.hash(s.password, 10);
            const [result] = await pool.query(
                'INSERT INTO users (username, password_hash, role, customer_category, full_name) VALUES (?, ?, ?, ?, ?)',
                [s.username, hash, s.role, s.category || null, s.username.replace('_', ' ')]
            );
            if (s.role === 'customer') {
                await pool.query('UPDATE users SET customer_uid=? WHERE id=?', [makeCustomerUid(result.insertId), result.insertId]);
            }
        } else if (s.role === 'customer') {
            const [rows] = await pool.query('SELECT id, customer_uid FROM users WHERE username=?', [s.username]);
            if (rows[0] && !rows[0].customer_uid) {
                await pool.query('UPDATE users SET customer_uid=? WHERE id=?', [makeCustomerUid(rows[0].id), rows[0].id]);
            }
        }
    }
    const [missingCustomerIds] = await pool.query(`SELECT id FROM users WHERE role='customer' AND (customer_uid IS NULL OR customer_uid='')`);
    for (const row of missingCustomerIds) {
        await pool.query('UPDATE users SET customer_uid=? WHERE id=?', [makeCustomerUid(row.id), row.id]);
    }

    // Seed sample laboratories
    const labSeeds = [
        { name: 'X-Ray Room', type: 'X-Ray', staff: 'lab_xray' },
        { name: 'Blood Test Lab', type: 'Blood Test', staff: 'lab_blood' }
    ];
    for (const l of labSeeds) {
        const [exists] = await pool.query('SELECT COUNT(*) as cnt FROM laboratories WHERE name=?', [l.name]);
        if (exists[0].cnt === 0) {
            const [user] = await pool.query('SELECT id FROM users WHERE username=?', [l.staff]);
            await pool.query('INSERT INTO laboratories (name, service_type, assigned_staff_id) VALUES (?, ?, ?)',
                [l.name, l.type, user.length > 0 ? user[0].id : null]);
        }
    }

    // Seed sample doctor
    const [docExists] = await pool.query('SELECT COUNT(*) as cnt FROM doctors WHERE name=?', ['General Physician']);
    if (docExists[0].cnt === 0) {
        const [docUser] = await pool.query('SELECT id FROM users WHERE username=?', ['doctor1']);
        await pool.query('INSERT INTO doctors (name, specialty, assigned_staff_id) VALUES (?, ?, ?)',
            ['General Physician', 'General Medicine', docUser.length > 0 ? docUser[0].id : null]);
    }

    // Ensure doctor_id column exists on service_packages
    try { await pool.query('ALTER TABLE service_packages ADD COLUMN doctor_id INT DEFAULT NULL'); } catch(e) {}

    for (const svc of DEFAULT_SERVICES) {
        const [pkgRows] = await pool.query('SELECT id FROM service_packages WHERE name=? LIMIT 1', [svc.name]);
        let packageId = pkgRows[0]?.id;
        if (!packageId) {
            const [pkgResult] = await pool.query(
                'INSERT INTO service_packages (name, description, price, est_time_minutes, is_active) VALUES (?, ?, ?, ?, true)',
                [svc.name, svc.description, svc.price, svc.est_time_minutes]
            );
            packageId = pkgResult.insertId;
        } else {
            await pool.query(
                'UPDATE service_packages SET description=?, price=?, est_time_minutes=?, is_active=true, archived=false, archived_at=NULL WHERE id=?',
                [svc.description, svc.price, svc.est_time_minutes, packageId]
            );
        }
        await pool.query(
            `INSERT INTO pricing_faqs (service_name, price, description)
             SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM pricing_faqs WHERE service_name=?)`,
            [svc.name, svc.price, svc.description, svc.name]
        );
        await pool.query(
            'UPDATE pricing_faqs SET price=?, description=? WHERE service_name=?',
            [svc.price, svc.description, svc.name]
        );
    }
    console.log('[Server] Seed data created.');
    server.listen(port, () => console.log(`Server running at http://localhost:${port}`));
}

startServer();

