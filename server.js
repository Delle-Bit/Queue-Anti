const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { pool, initDB } = require('./database.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.set('io', io);

const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatSessions = new Map();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/images', express.static('images'));

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
const authRoutes = require('./routes/auth');
const queueRoutes = require('./routes/queue');
const adminRoutes = require('./routes/admin');
const packageRoutes = require('./routes/packages');

app.use('/api/auth', authRoutes);
app.use('/api/chat', (req, res, next) => next()); // chat handled below
app.use('/api/packages', packageRoutes);          // GET public; POST/PUT check auth inside route
app.use('/api/queue', authenticateToken, queueRoutes);
app.use('/api', authenticateToken, adminRoutes);  // all other /api/* require token

// Chat API
app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'No message' });
    try {
        let sysPrompt = `You are a friendly assistant for the Medical Clinic.
Help patients with queue info, service details, and appointments.
Priority lanes: Senior, PWD, Pregnant patients get priority.
Keep responses short, warm, professional. Don't diagnose illnesses.
Use Philippine Peso (₱). Never use dollar signs.
If asked who made you: Wendelle Ortiz and friends.`;

        const [faqs] = await pool.query('SELECT service_name, price, description FROM pricing_faqs');
        if (faqs.length > 0) {
            sysPrompt += '\n\nService prices:';
            faqs.forEach(f => { sysPrompt += `\n- ${f.service_name}: ₱${f.price} (${f.description || ''})`; });
        }
        const [pkgs] = await pool.query('SELECT name, price, description FROM service_packages WHERE is_active=true');
        if (pkgs.length > 0) {
            sysPrompt += '\n\nService packages:';
            pkgs.forEach(p => { sysPrompt += `\n- ${p.name}: ₱${p.price} (${p.description || ''})`; });
        }

        const currentModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: sysPrompt });
        let chat;
        if (sessionId && chatSessions.has(sessionId)) {
            chat = chatSessions.get(sessionId);
        } else {
            chat = currentModel.startChat({ history: [] });
            const id = sessionId || 'sess_' + Date.now();
            chatSessions.set(id, chat);
            setTimeout(() => chatSessions.delete(id), 30 * 60 * 1000);
        }
        const result = await chat.sendMessage(message);
        res.json({ reply: result.response.text(), sessionId: sessionId || 'sess_' + Date.now() });
    } catch (err) {
        console.error('Chat error:', err.message);
        res.status(500).json({ error: 'Sorry, I am facing technical issues. Please approach the desk.' });
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
        { username: 'customer_regular', password: 'pass123', role: 'customer', category: 'Regular' },
        { username: 'customer_senior', password: 'pass123', role: 'customer', category: 'Senior' },
        { username: 'customer_pwd', password: 'pass123', role: 'customer', category: 'PWD' },
        { username: 'customer_pregnant', password: 'pass123', role: 'customer', category: 'Pregnant' }
    ];

    for (const s of seeds) {
        const [exists] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE username=?', [s.username]);
        if (exists[0].cnt === 0) {
            const hash = await bcrypt.hash(s.password, 10);
            await pool.query(
                'INSERT INTO users (username, password_hash, role, customer_category, full_name) VALUES (?, ?, ?, ?, ?)',
                [s.username, hash, s.role, s.category || null, s.username.replace('_', ' ')]
            );
        }
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

    // Seed sample package
    const [pkgExists] = await pool.query('SELECT COUNT(*) as cnt FROM service_packages');
    if (pkgExists[0].cnt === 0) {
        const [pkgResult] = await pool.query(
            'INSERT INTO service_packages (name, description, price, est_time_minutes) VALUES (?, ?, ?, ?)',
            ['General Check-up', 'Includes blood test and X-ray screening', 1500.00, 30]
        );
        const [allLabs] = await pool.query('SELECT id FROM laboratories ORDER BY id');
        for (let i = 0; i < allLabs.length; i++) {
            await pool.query('INSERT INTO package_laboratories (package_id, laboratory_id, sequence_order, est_time_minutes) VALUES (?, ?, ?, ?)',
                [pkgResult.insertId, allLabs[i].id, i + 1, 10]);
        }
    }

    console.log('[Server] Seed data created.');
    server.listen(port, () => console.log(`Server running at http://localhost:${port}`));
}

startServer();
