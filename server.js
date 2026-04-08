const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const QRCode = require('qrcode');
const { pool, initDB } = require('./database.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const multer = require('multer');
const http = require('http');
const socketIo = require('socket.io');
const aiServices = require('./ai_services.js');
const queueAutomation = require('./queue_automation.js');
const path = require('path');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// --- GEMINI AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    // System instructions will now be injected per request dynamically
});

const chatSessions = new Map();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const upload = multer({ dest: 'uploads/' });

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// --- DB INITIALIZATION & SEED ---
async function startServer() {
    await initDB();

    // Seed default Admin 
    const [users] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE username = ?', ['AdminUltimo']);
    if (users[0].cnt === 0) {
        const hash = await bcrypt.hash('123testPass', 10);
        await pool.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['AdminUltimo', hash, 'admin']);
        console.log('Account created');
    }

    // Seed default staff account (will test frontdesk)
    const [adminUsers] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE username = ?', ['admin123']);
    if (adminUsers[0].cnt === 0) {
        const hash = await bcrypt.hash('231minda', 10);
        await pool.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['admin123', hash, 'frontdesk']);
    }

    // Seed Doctor, Secretary, Cashier
    const rolesToSeed = ['doctor', 'secretary', 'cashier'];
    for (let role of rolesToSeed) {
        const [r] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE username = ?', [role + '123']);
        if (r[0].cnt === 0) {
            const hash = await bcrypt.hash('pass123', 10);
            await pool.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [role + '123', hash, role]);
        }
    }

    // Seed test Customers
    const customerTypes = ['Regular', 'Elderly', 'PWD'];
    for (let cat of customerTypes) {
        const uname = 'test_' + cat.toLowerCase();
        const [c] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE username = ?', [uname]);
        if (c[0].cnt === 0) {
            const hash = await bcrypt.hash('pass123', 10);
            await pool.query('INSERT INTO users (username, password_hash, role, customer_category) VALUES (?, ?, ?, ?)', [uname, hash, 'customer', cat]);
        }
    }

    // Seed default Cashier department
    const [depts] = await pool.query('SELECT COUNT(*) as cnt FROM departments WHERE name = ?', ['Cashier']);
    if (depts[0].cnt === 0) {
        await pool.query('INSERT INTO departments (name, start_time, cutoff_time, is_open) VALUES (?, NULL, NULL, true)', ['Cashier']);
        console.log('Default Cashier department created');
    }

    server.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

// --- AUTH MIDDLEWARE ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json({ error: 'Missing token' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

function verifyAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
}

function verifyFrontDesk(req, res, next) {
    if (req.user.role !== 'frontdesk' && req.user.role !== 'admin') return res.status(403).json({ error: 'Front Desk access required' });
    next();
}

function verifyDoctor(req, res, next) {
    if (req.user.role !== 'doctor' && req.user.role !== 'admin') return res.status(403).json({ error: 'Doctor access required' });
    next();
}

function verifySecretary(req, res, next) {
    if (req.user.role !== 'secretary' && req.user.role !== 'admin') return res.status(403).json({ error: 'Secretary access required' });
    next();
}

function verifyCashier(req, res, next) {
    if (req.user.role !== 'cashier' && req.user.role !== 'admin') return res.status(403).json({ error: 'Cashier access required' });
    next();
}

// --- AUTH APIs ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, category: user.customer_category }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ success: true, token, role: user.role, category: user.customer_category });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/register', upload.single('idImage'), async (req, res) => {
    const { username, password } = req.body;
    try {
        if (!req.file) return res.status(400).json({ error: 'ID Image is required for registration' });

        // Use Mock OCR to determine category
        const ocrData = await aiServices.ocrScan(req.file.path);

        // Mapping ocr ID types to our customer categories
        let category = 'Regular';
        if (ocrData.idType === 'Senior' || ocrData.idType === 'Elderly') category = 'Elderly';
        if (ocrData.idType === 'PWD') category = 'PWD';

        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password_hash, role, customer_category) VALUES (?, ?, ?, ?)', [username, hash, 'customer', category]);
        res.json({ success: true, message: 'Registration successful!', category });
    } catch (err) {
        console.error('Registration error', err);
        res.status(500).json({ error: 'Registration failed or username exists' });
    }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    const { username } = req.body;
    // Mocking email sending for this prototype
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            // Generate mock reset token
            const resetToken = 'RESET_' + Math.random().toString(36).substr(2, 9);
            await pool.query('UPDATE users SET reset_token = ?, reset_expiry = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE username = ?', [resetToken, username]);
            console.log(`[MOCK EMAIL TO ${username}] Password reset token: ${resetToken}`);
            // In a real app, send email here.
        }
        // Always return success to prevent username enumeration
        res.json({ success: true, message: 'If the username exists, a recovery instruction was sent via mock email (Terminal log).' });
    } catch (err) {
        res.status(500).json({ error: 'Error processing request' });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { username, resetToken, newPassword } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND reset_token = ? AND reset_expiry > NOW()', [username, resetToken]);
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired token' });

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expiry = NULL WHERE username = ?', [hash, username]);
        res.json({ success: true, message: 'Password reset successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Error resetting password' });
    }
});

// --- STAFF MANAGEMENT APIs ---
app.get('/api/users', authenticateToken, verifyAdmin, async (req, res) => {
    const [rows] = await pool.query('SELECT id, username, role FROM users');
    res.json(rows);
});

app.post('/api/users', authenticateToken, verifyAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role || 'staff']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create user (maybe username exists)' });
    }
});

app.put('/api/users/:id', authenticateToken, verifyAdmin, async (req, res) => {
    const { password, role } = req.body;
    try {
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            await pool.query('UPDATE users SET password_hash = ?, role = ? WHERE id = ?', [hash, role, req.params.id]);
        } else {
            await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// --- DEPARTMENTS APIs ---
app.get('/api/departments', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM departments');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch departments' });
    }
});

app.post('/api/departments', authenticateToken, async (req, res) => {
    const { name, start_time, cutoff_time } = req.body;
    try {
        await pool.query('INSERT INTO departments (name, start_time, cutoff_time, is_open) VALUES (?, ?, ?, true)', [name, start_time || null, cutoff_time || null]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create department' });
    }
});

app.put('/api/departments/:id', authenticateToken, async (req, res) => {
    const { name, start_time, cutoff_time, is_open } = req.body;
    try {
        await pool.query('UPDATE departments SET name = ?, start_time = ?, cutoff_time = ?, is_open = ? WHERE id = ?',
            [name, start_time, cutoff_time, is_open, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update department' });
    }
});

app.delete('/api/departments/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete department (might be in use)' });
    }
});

// --- PRICING FAQs APIs ---
app.get('/api/faqs', async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM pricing_faqs');
    res.json(rows);
});

app.post('/api/faqs', authenticateToken, async (req, res) => {
    const { service_name, price, description } = req.body;
    await pool.query('INSERT INTO pricing_faqs (service_name, price, description) VALUES (?, ?, ?)', [service_name, price, description]);
    res.json({ success: true });
});

app.delete('/api/faqs/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM pricing_faqs WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete faq' });
    }
});

app.put('/api/faqs/:id', authenticateToken, async (req, res) => {
    const { service_name, price, description } = req.body;
    try {
        await pool.query('UPDATE pricing_faqs SET service_name = ?, price = ?, description = ? WHERE id = ?', [service_name, price, description, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update faq' });
    }
});

// --- QUEUE / PATIENT APIs ---
app.get('/api/state', async (req, res) => {
    try {
        const [deptRows] = await pool.query('SELECT * FROM departments');
        const [queueRows] = await pool.query(`SELECT id, department_id, number, type, status, timestamp FROM queue WHERE status IN ('waiting', 'serving') ORDER BY timestamp ASC`);
        const [announcements] = await pool.query(`SELECT * FROM announcements ORDER BY timestamp DESC LIMIT 1`);

        const [avgRows] = await pool.query(`
            SELECT department_id, AVG(TIMESTAMPDIFF(MINUTE, serve_time, complete_time)) as avg_mins 
            FROM queue_logs 
            WHERE complete_time IS NOT NULL AND DATE(join_time) = CURDATE()
            GROUP BY department_id
        `);

        const deptAvgTimes = {};
        avgRows.forEach(row => {
            deptAvgTimes[row.department_id] = parseFloat(row.avg_mins || 0);
        });

        res.json({
            departments: deptRows,
            queue: queueRows,
            announcement: announcements[0] || null,
            deptAvgTimes
        });
    } catch (err) {
        console.error('[API/STATE] Critical error fetching data from MySQL:', err);
        res.status(500).json({ error: 'Failed to fetch state' });
    }
});

app.post('/api/queue/join', async (req, res) => {
    try {
        const { deviceId, type, department_id } = req.body;
        if (!deviceId || !type || !department_id) return res.status(400).json({ error: 'Invalid input' });

        // Check if cut-off time reached
        const [deptData] = await pool.query('SELECT * FROM departments WHERE id = ?', [department_id]);
        if (deptData.length === 0) return res.status(404).json({ error: 'Dept not found' });
        const dept = deptData[0];

        if (!dept.is_open) return res.status(403).json({ error: 'Department is closed.' });

        const now = new Date();
        const currentTime = now.toTimeString().split(' ')[0]; // HH:MM:SS
        if (dept.cutoff_time && currentTime > dept.cutoff_time) {
            return res.status(403).json({ error: 'Cut-off time reached for this department.' });
        }
        if (dept.start_time && currentTime < dept.start_time) {
            return res.status(403).json({ error: 'Department is not open yet.' });
        }

        // Check existing
        const [existing] = await pool.query(`SELECT * FROM queue WHERE id = ? AND status IN ('waiting', 'serving')`, [deviceId]);
        if (existing.length > 0) {
            return res.json({ success: true, number: existing[0].number, department_id: existing[0].department_id });
        }

        // Generate Sequential Number for the day and department
        const [seqRows] = await pool.query(`SELECT COUNT(*) as cnt FROM queue_logs WHERE department_id = ? AND type = ? AND DATE(join_time) = CURDATE()`, [department_id, type]);
        const seqNumber = seqRows[0].cnt + 1;
        const newQueueNumber = `${type}-${String(seqNumber).padStart(3, '0')}`; // e.g., P-001

        // Remove any old completed/cancelled entries for this device so the PK doesn't collide
        await pool.query(`DELETE FROM queue WHERE id = ? AND status NOT IN ('waiting', 'serving')`, [deviceId]);

        // Insert into queue
        await pool.query(`INSERT INTO queue (id, department_id, number, type, status) VALUES (?, ?, ?, ?, 'waiting')`, [deviceId, department_id, newQueueNumber, type]);

        // Log entry joined
        await pool.query(`INSERT INTO queue_logs (department_id, ticket_number, type, join_time) VALUES (?, ?, ?, NOW())`, [department_id, newQueueNumber, type]);

        res.json({ success: true, number: newQueueNumber });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to join queue' });
    }
});

app.post('/api/queue/leave', async (req, res) => {
    try {
        const { deviceId } = req.body;
        await pool.query(`UPDATE queue SET status = 'cancelled' WHERE id = ? AND status = 'waiting'`, [deviceId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to leave queue' });
    }
});

// --- ADMIN QUEUE OPERATIONS ---
app.post('/api/admin/next', authenticateToken, async (req, res) => {
    const { department_id } = req.body;
    try {
        const nextPatient = await queueAutomation.getNextPatient(department_id);

        if (!nextPatient) return res.json({ success: false, message: 'Queue is empty for this department' });

        await pool.query(`UPDATE queue SET status = 'serving' WHERE id = ?`, [nextPatient.id]);

        // Update log
        await pool.query(`UPDATE queue_logs SET serve_time = NOW() WHERE ticket_number = ? AND complete_time IS NULL ORDER BY join_time DESC LIMIT 1`, [nextPatient.number]);

        io.emit('queueUpdate', { department_id, nextPatient: nextPatient.number });
        res.json({ success: true, next: nextPatient.number });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to call next patient' });
    }
});

app.post('/api/admin/complete', authenticateToken, async (req, res) => {
    const { ticket_id } = req.body; // Using the internal deviceId string for reference
    try {
        // Get ticket details
        const [queueRows] = await pool.query(`SELECT number FROM queue WHERE id = ?`, [ticket_id]);
        if (queueRows.length > 0) {
            const ticketNumber = queueRows[0].number;
            await pool.query(`UPDATE queue SET status = 'completed' WHERE id = ?`, [ticket_id]);
            await pool.query(`UPDATE queue_logs SET complete_time = NOW() WHERE ticket_number = ? AND complete_time IS NULL ORDER BY id DESC LIMIT 1`, [ticketNumber]);
            // Also push a global notification or something for that specific user. 
            // We can add it to announcements targeted, or the patient polls state and sees status='completed'.
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to complete' });
    }
});

app.post('/api/admin/transfer', authenticateToken, async (req, res) => {
    const { ticket_id, new_department_id } = req.body;
    try {
        const [rows] = await pool.query(`SELECT type FROM queue WHERE id = ?`, [ticket_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });

        const type = rows[0].type;

        // Generate new sequential number for the new department
        const [seqRows] = await pool.query(`SELECT COUNT(*) as cnt FROM queue_logs WHERE department_id = ? AND type = ? AND DATE(join_time) = CURDATE()`, [new_department_id, type]);
        const seqNumber = seqRows[0].cnt + 1;
        const newQueueNumber = `${type}-${String(seqNumber).padStart(3, '0')}`;

        // Update department and assign the NEW number so sequences stay correct!
        await pool.query(`UPDATE queue SET department_id = ?, number = ?, status = 'waiting', timestamp = NOW() WHERE id = ?`, [new_department_id, newQueueNumber, ticket_id]);

        await pool.query(`INSERT INTO queue_logs (department_id, ticket_number, type, join_time) VALUES (?, ?, ?, NOW())`, [new_department_id, newQueueNumber, type]);
        res.json({ success: true, newNumber: newQueueNumber });
    } catch (err) {
        res.status(500).json({ error: 'Failed to transfer' });
    }
});

// --- ADMIN BROADCAST API ---
app.post('/api/admin/broadcast', authenticateToken, async (req, res) => {
    const { message } = req.body;
    try {
        await pool.query('INSERT INTO announcements (message) VALUES (?)', [message]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

// --- QUEUE RESET APIs ---
app.post('/api/admin/reset-queue/:deptId', authenticateToken, async (req, res) => {
    try {
        await pool.query(`DELETE FROM queue WHERE department_id = ?`, [req.params.deptId]);
        await pool.query(`DELETE FROM queue_logs WHERE department_id = ?`, [req.params.deptId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset queue' });
    }
});

app.post('/api/admin/reset-queue-all', authenticateToken, async (req, res) => {
    try {
        await pool.query(`DELETE FROM queue`);
        await pool.query(`DELETE FROM queue_logs`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset all queues' });
    }
});

// --- DASHBOARD & ANALYTICS ---
app.get('/api/admin/dashboard', authenticateToken, async (req, res) => {
    try {
        // Average processing time (completed tickets today)
        const [avgRows] = await pool.query(`
            SELECT AVG(TIMESTAMPDIFF(MINUTE, serve_time, complete_time)) as avg_mins 
            FROM queue_logs 
            WHERE complete_time IS NOT NULL AND DATE(join_time) = CURDATE()
        `);

        const avg_time = avgRows[0].avg_mins || 0;

        // Processed per hour today
        const [hourRows] = await pool.query(`
            SELECT COUNT(*) / GREATEST(1, HOUR(TIMEDIFF(MAX(complete_time), MIN(serve_time)))) as per_hour
            FROM queue_logs
            WHERE complete_time IS NOT NULL AND DATE(join_time) = CURDATE()
        `);
        const tickets_per_hour = hourRows[0].per_hour || 0;

        // Total processed
        const [totalRows] = await pool.query(`SELECT COUNT(*) as total FROM queue_logs WHERE complete_time IS NOT NULL AND DATE(join_time) = CURDATE()`);

        // Logs
        const [logs] = await pool.query(`
            SELECT q.*, d.name as department_name 
            FROM queue_logs q 
            LEFT JOIN departments d ON q.department_id = d.id 
            ORDER BY q.join_time DESC LIMIT 50
        `);

        // Est time: If avg time is say 10 mins, and there are X waiting, total = x * 10
        const [waitingRows] = await pool.query(`SELECT COUNT(*) as cnt FROM queue WHERE status = 'waiting'`);
        const est_total_time = waitingRows[0].cnt * avg_time;

        res.json({
            avg_time: parseFloat(avg_time).toFixed(1),
            per_hour: parseFloat(tickets_per_hour).toFixed(1),
            total_processed: totalRows[0].total,
            est_total_time: parseFloat(est_total_time).toFixed(1),
            logs
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
});

// --- OTHERS ---
app.post('/api/qrcode', async (req, res) => {
    try {
        const { dept_id } = req.body;
        const url = `${req.protocol}://${req.get('host')}/index.html${dept_id ? '?dept=' + dept_id : ''}`;
        const qrImage = await QRCode.toDataURL(url, { width: 300 });
        res.json({ qrImage, url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// --- APPOINTMENTS APIs ---
app.get('/api/appointments', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT a.*, d.name as department_name, u.username as customer_name FROM appointments a JOIN departments d ON a.department_id = d.id JOIN users u ON a.customer_id = u.id ORDER BY a.timestamp DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

app.post('/api/appointments', authenticateToken, async (req, res) => {
    const { department_id, phone_number } = req.body;
    try {
        // Create an appointment for the logged-in customer
        await pool.query('INSERT INTO appointments (customer_id, department_id, phone_number, status) VALUES (?, ?, ?, ?)', [req.user.id, department_id, phone_number, 'scheduled']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

app.post('/api/appointments/checkin', authenticateToken, async (req, res) => {
    const { appointment_id } = req.body;
    try {
        // 1. Get the appointment details
        const [rows] = await pool.query('SELECT * FROM appointments WHERE id = ? AND status = "scheduled"', [appointment_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Appointment not found or already checked-in' });

        const appointment = rows[0];
        const department_id = appointment.department_id;

        // 2. Map category from token mapping (regular -> Q, Elderly -> E, PWD -> D)
        let type = 'Q';
        if (req.user.category === 'Elderly') type = 'E';
        if (req.user.category === 'PWD') type = 'D';

        // 3. Generate normal queue number
        const [seqRows] = await pool.query(`SELECT COUNT(*) as cnt FROM queue_logs WHERE department_id = ? AND type = ? AND DATE(join_time) = CURDATE()`, [department_id, type]);
        const seqNumber = seqRows[0].cnt + 1;
        const newQueueNumber = `${type}-${String(seqNumber).padStart(3, '0')}`;

        // 4. Update appointment status
        await pool.query('UPDATE appointments SET status = "checked-in" WHERE id = ?', [appointment_id]);

        // 5. Add to actual queue using customer user ID as deviceId 
        // Note: The original system used a randomly generated deviceId. We will use `cust_` + req.user.id
        const deviceId = 'cust_' + req.user.id;

        // Remove old queue data for this customer
        await pool.query(`DELETE FROM queue WHERE id = ? AND status NOT IN ('waiting', 'serving')`, [deviceId]);

        // Insert into queue
        await pool.query(`INSERT INTO queue (id, department_id, number, type, status) VALUES (?, ?, ?, ?, 'waiting')`, [deviceId, department_id, newQueueNumber, type]);
        await pool.query(`INSERT INTO queue_logs (department_id, ticket_number, type, join_time) VALUES (?, ?, ?, NOW())`, [department_id, newQueueNumber, type]);

        res.json({ success: true, number: newQueueNumber });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to check-in appointment' });
    }
});

app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'No message provided' });

    try {
        // Build dynamic system prompt
        let sysPrompt = `You are a friendly and helpful assistant for the Medical Clinic.
        Your role is to assist patients who are waiting in the queue.
        Explaining how the overall queue system works.
        Priority lanes (Elderly, PWD, Pregnant patients get priority).
        Keep responses short, warm, and professional. Do not diagnose illnesses.
        Always use Philippine Peso (₱) when mentioning prices. Never use dollar signs.
        If asked something outside your scope, politely redirect to clinic staff.`;

        try {
            const [faqs] = await pool.query('SELECT service_name, price, description FROM pricing_faqs');
            if (faqs.length > 0) {
                sysPrompt += `\n\nHere are the current service prices (in Philippine Peso ₱) you can use as reference:`;
                faqs.forEach(f => {
                    sysPrompt += `\n- ${f.service_name}: ₱${f.price} (${f.description || 'No description'})`;
                });
            }
        } catch (e) { }

        const currentModel = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: sysPrompt
        });

        let chat;
        if (sessionId && chatSessions.has(sessionId)) {
            chat = chatSessions.get(sessionId);
        } else {
            chat = currentModel.startChat({ history: [] });
            const id = sessionId || ('sess_' + Date.now());
            chatSessions.set(id, chat);
            setTimeout(() => chatSessions.delete(id), 30 * 60 * 1000);
        }

        const result = await chat.sendMessage(message);
        const reply = result.response.text();
        res.json({ reply, sessionId: sessionId || 'sess_' + Date.now() });
    } catch (err) {
        console.error('Gemini API error:', err.message);
        res.status(500).json({ error: 'Sorry, I am currently facing technical issues. Please approach the desk.' });
    }
});

// --- SETTINGS (CUSTOMIZATION) APIs ---
app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
        res.json(rows[0] || {});
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/settings', authenticateToken, verifyAdmin, upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'background', maxCount: 1 }]), async (req, res) => {
    try {
        const { site_name, theme } = req.body;
        let logo_path = req.files['logo'] ? '/uploads/' + req.files['logo'][0].filename : undefined;
        let background_path = req.files['background'] ? '/uploads/' + req.files['background'][0].filename : undefined;

        let query = 'UPDATE settings SET site_name = ?, theme = ?';
        let params = [site_name, theme];

        if (logo_path !== undefined) { query += ', logo_path = ?'; params.push(logo_path); }
        if (background_path !== undefined) { query += ', background_path = ?'; params.push(background_path); }
        query += ' WHERE id = 1';

        await pool.query(query, params);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});


// --- OCR MOCK API ---
app.post('/api/ocr', upload.single('idImage'), async (req, res) => {
    try {
        // Mock processing using ai_services
        const ocrData = await aiServices.ocrScan(req.file ? req.file.path : null);
        res.json(ocrData);
    } catch (err) {
        res.status(500).json({ error: 'Failed OCR Scan' });
    }
});

startServer();
