const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { pool, initDB, DEFAULT_SERVICES, STAFF_SEEDS, LAB_SEEDS, DOCTOR_SEEDS, SERVICE_STEPS } = require('./database.js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');
const { JWT_SECRET, requireAdmin } = require('./config');
const { nextTicketNumber, APPOINTMENT_PRIORITY_BOOST } = require('./queue_automation');
const { startMissedAppointmentSweep } = require('./appointment_automation');

// Shown when someone tries to check in against a slot the sweep already closed.
const MISSED_APPOINTMENT_MESSAGE = 'This appointment was marked as "Did Not Arrive" because its scheduled time passed without a check-in. Please approach the front desk to be assisted.';

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
        // Reject special-purpose tokens (e.g. the short-lived login-OTP challenge
        // token) here so the 2FA gate can't be bypassed on routes that only check
        // req.user.id and don't otherwise validate req.user.role.
        if (user.purpose) return res.status(403).json({ error: 'Invalid token' });
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
    if (labs.length === 0 && !hasDoctorStep) return { unavailable: true };
    const totalSteps = 1 + labs.length + (hasDoctorStep ? 1 : 0);
    const [userRows] = await pool.query('SELECT customer_category FROM users WHERE id=?', [appointment.customer_id]);
    const category = userRows[0]?.customer_category || 'Regular';
    let type = 'Q';
    if (category === 'Senior') type = 'S';
    else if (category === 'PWD') type = 'D';
    else if (category === 'Pregnant') type = 'P';

    // An appointment holder reserved this slot, so they enter the queue with a
    // head start over walk-ins. It is stored on the sequence, not just on the
    // first queue row, so /complete-step can re-apply it at every station -
    // otherwise the priority would evaporate the moment the front desk was done.
    const priorityBoost = APPOINTMENT_PRIORITY_BOOST;

    const [seqResult] = await pool.query(
        `INSERT INTO queue_sequences (customer_id, package_id, current_step, total_steps, has_doctor_step, doctor_id, appointment_id, priority_boost)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
        [appointment.customer_id, appointment.package_id, totalSteps, hasDoctorStep ? 1 : 0,
         hasDoctorStep ? pkgDoctor[0].doctor_id : null, appointment.id, priorityBoost]
    );
    const seqId = seqResult.insertId;
    const ticketNum = await nextTicketNumber('frontdesk', null, type);
    const queueId = `appt_${appointment.id}_${seqId}`;
    // The amount actually owed (package price plus the appointment surcharge) is
    // what the front desk collects, so it is what the revenue logs should carry.
    const amountDue = appointment.amount_due != null ? appointment.amount_due : appointment.price;
    await pool.query(
        `INSERT INTO queue (id, station_type, station_id, number, type, status, customer_id, sequence_id, priority_boost)
         VALUES (?, 'frontdesk', NULL, ?, ?, 'waiting', ?, ?, ?)`,
        [queueId, ticketNum, type, appointment.customer_id, seqId, priorityBoost]
    );
    await pool.query(
        `INSERT INTO queue_logs (station_type, station_id, ticket_number, type, customer_id, sequence_id, package_name, price, join_time)
         VALUES ('frontdesk', NULL, ?, ?, ?, ?, ?, ?, NOW())`,
        [ticketNum, type, appointment.customer_id, seqId, appointment.package_name, amountDue]
    );
    if (io) io.emit('queueUpdate', { appointment_id: appointment.id, queue_id: queueId });
    return { ticket: ticketNum, sequence_id: seqId };
}

function makeCustomerUid(insertId) {
    const year = new Date().getFullYear();
    return `MC-${year}-${String(insertId).padStart(6, '0')}`;
}

// A seeded account whose name was never filled in shows up as the username with
// the underscores swapped for spaces ("admin tech"). Only those - and blanks -
// get the seed name, so a name someone actually typed into the admin UI is not
// overwritten on the next reboot.
function isPlaceholderName(username, fullName) {
    const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const name = squash(fullName);
    return !name || name === squash(username);
}

function composeFullName(seed) {
    return [seed.first_name, seed.middle_name, seed.surname].filter(Boolean).join(' ');
}

app.post('/api/appointments/check-in', authenticateToken, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'Token is required' });
    try {
        // Looked up without the archived filter so a swept no-show can be told
        // apart from a genuinely bad code - otherwise a patient who missed their
        // slot is told their QR is invalid, which sends them looking for the
        // wrong problem.
        const [rows] = await pool.query(
            `SELECT a.*, sp.name as package_name, sp.price
             FROM appointments a JOIN service_packages sp ON a.package_id = sp.id
             WHERE a.qr_token = ?`,
            [token]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'Invalid or expired check-in code.' });
        const appointment = rows[0];

        if (appointment.status === 'no-show') {
            return res.status(400).json({ success: false, error: MISSED_APPOINTMENT_MESSAGE });
        }
        if (appointment.archived) {
            return res.status(404).json({ success: false, error: 'Invalid or expired check-in code.' });
        }
        if (appointment.status === 'checked-in' || appointment.status === 'completed') {
             return res.status(400).json({ success: false, error: 'Already checked in or completed.' });
        }

        await pool.query(
            `UPDATE appointments SET status='checked-in', checked_in_at=NOW() WHERE id=?`,
            [appointment.id]
        );

        const queue = await startQueueFromAppointment(appointment, io);
        if (queue.unavailable) return res.status(400).json({ success: false, error: 'This service is currently unavailable.' });
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
             WHERE a.qr_token = ?`,
            [req.params.token]
        );
        if (rows.length === 0) return res.status(404).send('Invalid or expired check-in code.');
        const appointment = rows[0];
        if (appointment.status === 'no-show') return res.status(400).send(MISSED_APPOINTMENT_MESSAGE);
        if (appointment.archived) return res.status(404).send('Invalid or expired check-in code.');
        if (appointment.status !== 'checked-in') {
            await pool.query(
                `UPDATE appointments SET status='checked-in', checked_in_at=COALESCE(checked_in_at, NOW()) WHERE id=?`,
                [appointment.id]
            );
        }
        const queue = await startQueueFromAppointment(appointment, io);
        if (queue.unavailable) return res.status(400).send('This service is currently unavailable. Please approach the front desk.');
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

// Give every service its station sequence (see SERVICE_STEPS in database.js).
// A package is only wired if it has no active stations and no doctor yet, so a
// sequence someone edited in the admin UI is never reverted on the next reboot.
// Without this, `package_laboratories` is empty and every service reports
// "This service is currently unavailable."
async function seedServiceSteps() {
    const [stationRows] = await pool.query('SELECT id, name FROM laboratories WHERE archived = false');
    const stationIdByName = new Map(stationRows.map(r => [r.name, r.id]));
    const [doctorRows] = await pool.query('SELECT id, specialty FROM doctors WHERE archived = false');
    const doctorIdBySpecialty = new Map(doctorRows.map(r => [r.specialty, r.id]));

    for (const [pkgName, plan] of Object.entries(SERVICE_STEPS)) {
        const [pkgRows] = await pool.query(
            'SELECT id, doctor_id FROM service_packages WHERE name=? AND archived=false LIMIT 1', [pkgName]
        );
        if (pkgRows.length === 0) continue;
        const pkg = pkgRows[0];

        const [stepCount] = await pool.query(
            'SELECT COUNT(*) AS cnt FROM package_laboratories WHERE package_id=? AND archived=false', [pkg.id]
        );
        if (stepCount[0].cnt > 0 || pkg.doctor_id) continue;   // already configured

        // sequence_order must stay contiguous from 1 - routes/queue.js looks the
        // next station up by `sequence_order = current_step`.
        let order = 1;
        const wired = [];
        for (const step of plan.stations) {
            const stationId = stationIdByName.get(step.at);
            if (!stationId) {
                console.warn(`[Seed] No station named "${step.at}" - skipped for "${pkgName}"`);
                continue;
            }
            await pool.query(
                'INSERT INTO package_laboratories (package_id, laboratory_id, sequence_order, est_time_minutes) VALUES (?, ?, ?, ?)',
                [pkg.id, stationId, order++, step.minutes]
            );
            wired.push(step.at);
        }

        let consult = '';
        if (plan.doctor) {
            const doctorId = doctorIdBySpecialty.get(plan.doctor);
            if (doctorId) {
                await pool.query('UPDATE service_packages SET doctor_id=? WHERE id=?', [doctorId, pkg.id]);
                consult = ` -> ${plan.doctor} consultation`;
            } else {
                console.warn(`[Seed] No ${plan.doctor} doctor on file - "${pkgName}" left without a consultation step`);
            }
        }
        console.log(`[Seed] "${pkgName}": Front Desk -> ${wired.join(' -> ')}${consult}`);
    }
}

// Seed accounts & start
async function startServer() {
    await initDB();

    // Purge pending registrations abandoned mid-wizard (belt-and-suspenders alongside
    // the explicit /api/auth/register/abandon call the frontend fires on modal close).
    authRoutes.reapExpiredRegistrations();
    setInterval(authRoutes.reapExpiredRegistrations, 30 * 60 * 1000);

    // Seed one account per clinic position - see STAFF_SEEDS in database.js for
    // the roster and the job title behind each account.
    for (const s of STAFF_SEEDS) {
        const fullName = composeFullName(s);
        const [rows] = await pool.query('SELECT id, full_name, customer_uid FROM users WHERE username=?', [s.username]);

        if (rows.length === 0) {
            const hash = await bcrypt.hash(s.password, 10);
            const [result] = await pool.query(
                `INSERT INTO users (username, password_hash, role, customer_category, full_name, first_name, middle_name, surname)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [s.username, hash, s.role, s.category || null, fullName, s.first_name || '', s.middle_name || '', s.surname || '']
            );
            if (s.role === 'customer') {
                await pool.query('UPDATE users SET customer_uid=? WHERE id=?', [makeCustomerUid(result.insertId), result.insertId]);
            }
            console.log(`[Seed] Created ${s.role} account "${s.username}" - ${fullName} (${s.position || s.category})`);
            continue;
        }

        const existing = rows[0];
        if (isPlaceholderName(s.username, existing.full_name)) {
            await pool.query(
                'UPDATE users SET full_name=?, first_name=?, middle_name=?, surname=? WHERE id=?',
                [fullName, s.first_name || '', s.middle_name || '', s.surname || '', existing.id]
            );
        } else if (existing.full_name !== fullName) {
            console.log(`[Seed] Kept existing name "${existing.full_name}" on "${s.username}" (seed name is "${fullName}")`);
        }
        if (s.role === 'customer' && !existing.customer_uid) {
            await pool.query('UPDATE users SET customer_uid=? WHERE id=?', [makeCustomerUid(existing.id), existing.id]);
        }
    }
    const [missingCustomerIds] = await pool.query(`SELECT id FROM users WHERE role='customer' AND (customer_uid IS NULL OR customer_uid='')`);
    for (const row of missingCustomerIds) {
        await pool.query('UPDATE users SET customer_uid=? WHERE id=?', [makeCustomerUid(row.id), row.id]);
    }

    // Seed the stations a ticket can be routed to. Existing rows keep their own
    // service_type and hours; only an unassigned station gets its staff filled in.
    for (const l of LAB_SEEDS) {
        const [staff] = await pool.query('SELECT id FROM users WHERE username=?', [l.staff]);
        const staffId = staff[0]?.id || null;
        const [rows] = await pool.query('SELECT id, assigned_staff_id FROM laboratories WHERE name=?', [l.name]);
        if (rows.length === 0) {
            await pool.query('INSERT INTO laboratories (name, service_type, assigned_staff_id) VALUES (?, ?, ?)',
                [l.name, l.service_type, staffId]);
            console.log(`[Seed] Created station "${l.name}" (${l.service_type})`);
        } else if (!rows[0].assigned_staff_id && staffId) {
            await pool.query('UPDATE laboratories SET assigned_staff_id=? WHERE id=?', [staffId, rows[0].id]);
        }
    }

    // Seed the physicians. `replaces` lets a row that was named after the job
    // ("General Physician") be renamed to the physician who actually holds it.
    for (const d of DOCTOR_SEEDS) {
        const [staff] = await pool.query('SELECT id FROM users WHERE username=?', [d.staff]);
        const staffId = staff[0]?.id || null;
        const [rows] = await pool.query('SELECT id, name FROM doctors WHERE name=? OR name=?', [d.name, d.replaces || d.name]);
        if (rows.length === 0) {
            await pool.query('INSERT INTO doctors (name, specialty, assigned_staff_id) VALUES (?, ?, ?)',
                [d.name, d.specialty, staffId]);
            console.log(`[Seed] Created doctor "${d.name}" (${d.specialty})`);
        } else if (rows[0].name !== d.name) {
            await pool.query('UPDATE doctors SET name=?, specialty=? WHERE id=?', [d.name, d.specialty, rows[0].id]);
            console.log(`[Seed] Renamed doctor "${rows[0].name}" to "${d.name}"`);
        }
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
    await seedServiceSteps();

    console.log('[Server] Seed data created.');

    // Sweeps slots that came and went without a check-in, marking them
    // "Did Not Arrive" and archiving them out of the staff/admin lists. Runs
    // once now to catch anything missed while the server was down, then on a
    // timer. The list endpoints sweep too, so this only covers idle periods.
    startMissedAppointmentSweep();

    server.listen(port, () => console.log(`Server running at http://localhost:${port}`));
}

startServer();

