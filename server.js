// Loaded before every local require, because several of them read process.env
// at module scope: config.js captures JWT_SECRET, database.js builds its
// connection config and its TLS option. With dotenv.config() below the
// requires - where it used to sit - config.js had already fallen back to its
// hardcoded development secret by the time .env was read, so the JWT_SECRET in
// .env was silently ignored and every session token in every environment was
// signed with a default that is published in this repository.
//
// In a container this was masked: real environment variables are set by the
// runtime, so process.env is already populated and dotenv has nothing to do.
// That is exactly what made it dangerous - it worked in production and lied
// locally, which is the wrong way round for a secret.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { pool, initDB, DEFAULT_SERVICES, DEFAULT_TEST_STRUCTURES, STAFF_SEEDS, LAB_SEEDS, DOCTOR_SEEDS, SERVICE_STEPS } = require('./database.js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');
const { JWT_SECRET, requireAdmin } = require('./config');
const { APPOINTMENT_PRIORITY_BOOST } = require('./queue_automation');
const { startPackageQueue } = require('./queue_start');
const { startMissedAppointmentSweep } = require('./appointment_automation');
const sessionActivity = require('./session_activity');

// Shown when someone tries to check in against a slot the sweep already closed.
const MISSED_APPOINTMENT_MESSAGE = 'This appointment was marked as "Did Not Arrive" because its scheduled time passed without a check-in. Please approach the front desk to be assisted.';

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
// One socket per open page, so every navigation and every sign-in retires one
// and opens another - a few minutes of ordinary use fills the terminal with
// connect/disconnect pairs that say nothing. The per-client lines are opt-in
// (LOG_SOCKETS=1) and carry the id, the reason and the live count when they are
// on; "Client disconnected" on its own could not even be matched to the
// connection it ended.
const LOG_SOCKETS = process.env.LOG_SOCKETS === '1' || process.env.LOG_SOCKETS === 'true';

io.on('connection', (socket) => {
    if (LOG_SOCKETS) {
        console.log(`[Socket] connected ${socket.id} (${io.engine.clientsCount} open)`);
    }
    socket.on('disconnect', (reason) => {
        if (LOG_SOCKETS) {
            console.log(`[Socket] disconnected ${socket.id} - ${reason} (${io.engine.clientsCount} open)`);
        }
    });
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

// ── STAFF SESSION ACTIVITY ──────────────────────────────────────────────────
// The 15-minute inactivity timeout. `enforceIdleTimeout` rejects a stale staff
// token; the two endpoints below are how the browser reports that the user is
// still at the terminal, and that it has given up on them.
//
// Deliberately heartbeat-driven rather than traffic-driven: the staff dashboards
// poll their queue every 5 seconds, so an unattended screen would otherwise keep
// its own session alive forever. See session_activity.js.
app.post('/api/session/heartbeat', authenticateToken, async (req, res) => {
    if (!sessionActivity.isStaffRole(req.user.role)) {
        return res.json({ success: true, tracked: false });
    }
    const state = await sessionActivity.inspect(req.user.id);
    if (state.expired) {
        await sessionActivity.terminate(req.user.id, 'timeout');
        res.set('X-Session-Timeout', '1');
        return res.status(401).json({
            error: 'Your session ended after 15 minutes of inactivity. Please sign in again.',
            code: 'session_timeout'
        });
    }
    await sessionActivity.touch(req.user.id);
    res.json({
        success: true,
        tracked: true,
        idle_limit_ms: sessionActivity.IDLE_LIMIT_MS,
        warn_before_ms: sessionActivity.WARN_BEFORE_MS
    });
});

app.post('/api/session/timeout', authenticateToken, async (req, res) => {
    if (sessionActivity.isStaffRole(req.user.role)) {
        await sessionActivity.terminate(req.user.id, 'timeout');
    }
    res.json({ success: true });
});

// Routes — order matters: specific routes before catch-all
const queueRoutes = require('./routes/queue');
const testStructureRoutes = require('./routes/test_structures');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const reportRoutes = require('./routes/reports');
const packageRoutes = require('./routes/packages');
const assistantRoutes = require('./routes/assistant');
const walkinRoutes = require('./routes/walkin');
const displayRoutes = require('./routes/display');

const idleTimeout = sessionActivity.enforceIdleTimeout;

app.use('/api/auth', authRoutes);
app.use('/api/packages', packageRoutes);
// The lobby board. Mounted before the authenticated routers on purpose: it runs
// on a wall-mounted screen with nobody signed in to it, so it is public - and
// therefore carries ticket numbers and station names only, never patient names.
app.use('/api/display', displayRoutes);
// Phone-less walk-in intake. The role check is inside the router (front desk
// plus the elevated override), same as the other operational routers.
app.use('/api/walkin', authenticateToken, idleTimeout, walkinRoutes);
app.use('/api/queue', authenticateToken, idleTimeout, queueRoutes);
// Result forms. Reads are staff-wide (the laboratory renders its form from
// them), writes are administrator-only - both guarded inside the router.
app.use('/api/test-structures', authenticateToken, idleTimeout, testStructureRoutes);
app.use('/api/assistant', authenticateToken, idleTimeout, assistantRoutes);
app.use('/api/reports', authenticateToken, idleTimeout, verifyRoles('owner'), reportRoutes);
app.use('/api/admin', authenticateToken, idleTimeout, requireAdmin, adminRoutes);
// routes/admin.js a second time, at the bare /api prefix and WITHOUT
// requireAdmin. Not a loophole - it is what serves the customer-facing routes
// that live in that file (GET /appointments/my, POST /appointments,
// POST /appointments/:id/cancel, /medical-records/my, /clinical-records/my,
// GET /faqs), which a patient has to be able to reach.
//
// So this mount is authenticated only, and the real guard is per-route: every
// administrator or staff route in admin.js carries its own requireAdmin /
// requireStaff, because the same handler is also reachable here without one.
// A new route added to that file with no guard is published to every signed-in
// account, patients included.
app.use('/api', authenticateToken, idleTimeout, adminRoutes);

async function startQueueFromAppointment(appointment, io) {
    const [userRows] = await pool.query('SELECT customer_category FROM users WHERE id=?', [appointment.customer_id]);

    const started = await startPackageQueue({
        customerId: appointment.customer_id,
        packageId: appointment.package_id,
        category: userRows[0]?.customer_category || 'Regular',
        intakeChannel: 'appointment',
        appointmentId: appointment.id,
        // An appointment holder reserved this slot, so they enter the queue with
        // a head start over walk-ins. It is stored on the sequence, not just on
        // the first queue row, so /complete-step can re-apply it at every station
        // - otherwise the priority would evaporate the moment the front desk was
        // done with them.
        priorityBoost: APPOINTMENT_PRIORITY_BOOST,
        // The step-0 row has always been named after the appointment here, so it
        // still is. From step 1 on, /complete-step derives the id from
        // stepRowId() regardless of what this first row was called.
        rowId: (seqId) => `appt_${appointment.id}_${seqId}`,
        // The amount actually owed (package price plus the appointment surcharge)
        // is what the front desk collects, so it is what the revenue log carries.
        logPrice: appointment.amount_due != null ? appointment.amount_due : appointment.price
    });
    if (started.alreadyActive) return { alreadyActive: true };
    if (started.unavailable || started.notFound) return { unavailable: true };

    if (io) io.emit('queueUpdate', { appointment_id: appointment.id, queue_id: started.queue_id });
    return { ticket: started.ticket, sequence_id: started.sequence_id };
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
// Result forms are seeded once and then left alone. They are administrator-
// owned data from that point: re-applying the defaults on every boot would
// quietly undo a corrected reference range, which is exactly the kind of
// change this feature exists to allow.
async function seedTestStructures() {
    for (const struct of DEFAULT_TEST_STRUCTURES) {
        const [existing] = await pool.query('SELECT id FROM test_structures WHERE name=? LIMIT 1', [struct.name]);
        if (existing.length > 0) continue;

        const [result] = await pool.query(
            'INSERT INTO test_structures (name, description, input_mode, is_active) VALUES (?, ?, ?, true)',
            [struct.name, struct.description || null, struct.input_mode || 'structured']
        );
        const structureId = result.insertId;
        let order = 0;
        for (const field of struct.fields || []) {
            await pool.query(
                `INSERT INTO test_structure_fields
                    (structure_id, label, unit, reference_range, field_type, options, default_value, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [structureId, field.label, field.unit || null, field.reference_range || null,
                 field.field_type || 'number', field.options || null, field.default_value || null, order++]
            );
        }
        console.log(`[Seed] Result form "${struct.name}" (${struct.input_mode || 'structured'}, ${(struct.fields || []).length} field(s))`);
    }
}

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
        // Both front desk bookends are printed, because both are steps the queue
        // engine actually creates - see composeServiceSteps in queue_automation.js.
        console.log(`[Seed] "${pkgName}": Front Desk -> ${wired.join(' -> ')}${consult} -> Front Desk (close)`);
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
    // The password every seeded account is created with, when set. The
    // per-account defaults in STAFF_SEEDS are published - they are in
    // example_accounts.md and README.md, in a public repository - which is fine
    // for a machine on your desk and not fine for anything with a URL: between
    // first boot and the moment somebody remembers to change them, "owner1" /
    // "owner123" is a valid administrator login for whoever finds the site.
    //
    // Set SEED_PASSWORD in any deployed environment. It applies only at
    // creation: the loop below never rewrites an existing account's password,
    // so changing one from the admin UI afterwards survives every redeploy.
    const seedPasswordOverride = process.env.SEED_PASSWORD || null;
    if (seedPasswordOverride) {
        console.log('[Seed] SEED_PASSWORD is set - new seed accounts will use it instead of their documented defaults.');
    } else if (process.env.NODE_ENV === 'production') {
        console.warn('[Seed] WARNING: NODE_ENV=production but SEED_PASSWORD is not set. Any account created now uses the password published in example_accounts.md. Change them immediately, or set SEED_PASSWORD and start from a clean database.');
    }

    for (const s of STAFF_SEEDS) {
        const fullName = composeFullName(s);
        const [rows] = await pool.query('SELECT id, full_name, customer_uid FROM users WHERE username=?', [s.username]);

        if (rows.length === 0) {
            const hash = await bcrypt.hash(seedPasswordOverride || s.password, 10);
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
                'INSERT INTO service_packages (name, description, price, est_time_minutes, category, is_active) VALUES (?, ?, ?, ?, ?, true)',
                [svc.name, svc.description, svc.price, svc.est_time_minutes, svc.category || 'General']
            );
            packageId = pkgResult.insertId;
        } else {
            await pool.query(
                // category is backfilled only when it is still the default, so a
                // category an admin actually chose is not overwritten on reboot.
                "UPDATE service_packages SET description=?, price=?, est_time_minutes=?, category=IF(category='' OR category='General', ?, category), is_active=true, archived=false, archived_at=NULL WHERE id=?",
                [svc.description, svc.price, svc.est_time_minutes, svc.category || 'General', packageId]
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
    await seedTestStructures();

    console.log('[Server] Seed data created.');

    // Sweeps slots that came and went without a check-in, marking them
    // "Did Not Arrive" and archiving them out of the staff/admin lists. Runs
    // once now to catch anything missed while the server was down, then on a
    // timer. The list endpoints sweep too, so this only covers idle periods.
    startMissedAppointmentSweep();

    server.listen(port, () => console.log(`Server running at http://localhost:${port}`));
}

// ── SHUTDOWN ────────────────────────────────────────────────────────────────
// A container is stopped by SIGTERM, and Node's default response is to exit
// immediately - mid-request, mid-transaction, with every socket dropped. On a
// redeploy that shows up as a patient's dashboard erroring at the moment the
// desk was calling them. Closing the HTTP server first lets in-flight requests
// finish, then the pool is drained so MySQL is not left holding connections.
let shuttingDown = false;

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] ${signal} received - closing down.`);

    // Stops accepting new connections; the callback fires once the open ones
    // have drained. io.close() ends the socket sessions the browsers hold open,
    // which would otherwise keep the server alive well past the grace period.
    io.close();
    server.close(async () => {
        try {
            await pool.end();
            console.log('[Server] Closed cleanly.');
        } catch (err) {
            console.error('[Server] Error closing the database pool:', err.message);
        }
        process.exit(0);
    });

    // Docker sends SIGKILL ten seconds after SIGTERM by default. Exiting at
    // eight leaves the clean path a chance to win, and guarantees the process
    // is gone either way rather than being killed halfway through.
    setTimeout(() => {
        console.warn('[Server] Shutdown timed out - exiting anyway.');
        process.exit(1);
    }, 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A boot that cannot reach its database exits non-zero instead of listening.
// Docker's restart policy and every hosting platform's health check treat an
// exited container as something to retry; they treat an open port as success.
startServer().catch((err) => {
    console.error('[Server] Startup failed:', err.message);
    console.error('[Server] Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME, and that the database is reachable.');
    process.exit(1);
});

