const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const QRCode = require('qrcode');
const { pool, initDB } = require('./database.js');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Initialize DB on start
initDB();

// API: Generate QR Code for the patient app
app.get('/api/qrcode', async (req, res) => {
    try {
        const url = `${req.protocol}://${req.get('host')}/index.html`; 
        const qrImage = await QRCode.toDataURL(url);
        res.json({ qrImage, url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// API: AI Chatbot Proxy (Mock)
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    let response = `I understand you said: "${message}". Please wait for assistance or check the queue board.`;
    
    // Quick keyword logic for a better demo
    const msgLower = message.toLowerCase();
    if(msgLower.includes('doctor') || msgLower.includes('time')) {
        response = "The doctor is currently seeing patients. Wait times vary based on the queue.";
    } else if (msgLower.includes('priority')) {
        response = "Priority lanes are for Elderly, PWD, and Pregnant patients.";
    }
    
    res.json({ reply: response });
});

// --- QUEUE SYSTEM APIs ---

// 1. Get Clinic State (Polled by clients)
app.get('/api/state', async (req, res) => {
    try {
        // Get clinic state
        const [stateRows] = await pool.query(`SELECT * FROM clinic_state WHERE id = 1`);
        let clinicState = stateRows[0] || { currentServing: '--', isOpen: true };

        // Get latest announcement
        const [annRows] = await pool.query(`SELECT * FROM announcements ORDER BY timestamp DESC LIMIT 1`);
        let announcement = annRows[0] || null;

        // Get snapshot of pending queue and wait times
        const [queueRows] = await pool.query(`SELECT id, number, type, status FROM queue WHERE status = 'waiting' ORDER BY timestamp ASC`);
        
        // Calculate total served today
        const [servedRows] = await pool.query(`SELECT COUNT(*) as served FROM queue WHERE status IN ('serving', 'done') AND DATE(timestamp) = CURDATE()`);

        res.json({
            clinicState,
            announcement,
            waitingQueue: queueRows,
            totalServed: servedRows[0].served || 0
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch state' });
    }
});

// 2. Join Queue
app.post('/api/queue/join', async (req, res) => {
    try {
        const { deviceId, type } = req.body;
        if(!deviceId || !type) return res.status(400).json({error: 'Invalid input'});

        // Check if device is already waiting
        const [existing] = await pool.query(`SELECT * FROM queue WHERE id = ? AND status = 'waiting'`, [deviceId]);
        if(existing.length > 0) {
            return res.json({ success: true, number: existing[0].number }); // Idempotent
        }

        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const newQueueNumber = `${type}-${randomNum}`;

        await pool.query(`INSERT INTO queue (id, number, type, status) VALUES (?, ?, ?, 'waiting') ON DUPLICATE KEY UPDATE number = ?, type = ?, status = 'waiting'`, [deviceId, newQueueNumber, type, newQueueNumber, type]);
        res.json({ success: true, number: newQueueNumber });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to join queue' });
    }
});

// 3. Leave Queue
app.post('/api/queue/leave', async (req, res) => {
    try {
        const { deviceId } = req.body;
        await pool.query(`UPDATE queue SET status = 'cancelled' WHERE id = ? AND status = 'waiting'`, [deviceId]);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: 'Failed to leave queue' });
    }
});


// --- ADMIN APIs ---

// Admin: Call Next Patient
app.post('/api/admin/next', async (req, res) => {
    try {
        const [queueRows] = await pool.query(`SELECT * FROM queue WHERE status = 'waiting' ORDER BY timestamp ASC`);
        
        if (queueRows.length === 0) {
            return res.json({ success: false, message: 'Queue is empty' });
        }

        // Priority Logic: P, D, E first.
        const priorities = queueRows.filter(p => ['P', 'D', 'E'].includes(p.type));
        const regulars = queueRows.filter(p => p.type === 'Q');

        let nextPatient = priorities.length > 0 ? priorities[0] : regulars[0];

        // Ensure state transition for previous serving patient
        await pool.query(`UPDATE queue SET status = 'done' WHERE status = 'serving'`);
        
        // Update new patient to serving
        await pool.query(`UPDATE queue SET status = 'serving' WHERE id = ?`, [nextPatient.id]);
        
        // Update clinic state
        await pool.query(`UPDATE clinic_state SET currentServing = ? WHERE id = 1`, [nextPatient.number]);

        res.json({ success: true, next: nextPatient.number });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to call next patient' });
    }
});

// Admin: Reset Queue
app.post('/api/admin/reset', async (req, res) => {
    try {
        await pool.query(`UPDATE queue SET status = 'cancelled' WHERE status IN ('waiting', 'serving')`);
        await pool.query(`UPDATE clinic_state SET currentServing = '--' WHERE id = 1`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset queue' });
    }
});

// Admin: Toggle visibility
app.post('/api/admin/toggle', async (req, res) => {
    try {
        const { isOpen } = req.body;
        await pool.query(`UPDATE clinic_state SET isOpen = ? WHERE id = 1`, [isOpen]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle clinic state' });
    }
});

// Admin: Broadcast Announcement
app.post('/api/admin/broadcast', async (req, res) => {
    try {
        const { message } = req.body;
        if(message) {
            await pool.query(`INSERT INTO announcements (message) VALUES (?)`, [message]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to broadcast' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
