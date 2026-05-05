const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../database');
const multer = require('multer');
const aiServices = require('../ai_services');
const upload = multer({ dest: 'uploads/' });

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, category: user.customer_category },
            JWT_SECRET, { expiresIn: '8h' }
        );
        // Track staff login
        if (user.role !== 'customer') {
            await pool.query('INSERT INTO staff_sessions (user_id) VALUES (?)', [user.id]);
        }
        const redirectMap = {
            customer: '/customer.html', frontdesk: '/frontdesk.html',
            laboratory: '/laboratory.html', admintechnical: '/admintechnical.html',
            admin: '/admintechnical.html', owner: '/owner.html'
        };
        res.json({
            success: true, token, role: user.role,
            category: user.customer_category, username: user.username,
            redirect: redirectMap[user.role] || '/index.html'
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/register', upload.single('idImage'), async (req, res) => {
    const { username, password, email, full_name } = req.body;
    try {
        // OCR scan for category detection
        let category = 'Regular', gender = null, birthday = null, detectedName = '';
        if (req.file) {
            const ocrData = await aiServices.ocrScan(req.file.path);
            if (ocrData.idType === 'Senior' || ocrData.idType === 'Elderly') category = 'Senior';
            else if (ocrData.idType === 'PWD') category = 'PWD';
            if (ocrData.name) detectedName = ocrData.name;
            if (ocrData.age) {
                const y = new Date().getFullYear() - ocrData.age;
                birthday = `${y}-01-01`;
            }
        }
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (username, password_hash, role, customer_category, email, full_name, birthday, gender)
             VALUES (?, ?, 'customer', ?, ?, ?, ?, ?)`,
            [username, hash, category, email || '', full_name || detectedName, birthday, gender]
        );
        // Mock welcome email
        console.log(`[MOCK EMAIL] Welcome ${username}! Your account has been created. Category: ${category}`);
        res.json({ success: true, message: 'Registration successful!', category });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed or username exists' });
    }
});

router.post('/forgot-password', async (req, res) => {
    const { username } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            const resetToken = 'RESET_' + Math.random().toString(36).substr(2, 9);
            await pool.query('UPDATE users SET reset_token = ?, reset_expiry = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE username = ?', [resetToken, username]);
            console.log(`[MOCK EMAIL TO ${username}] Reset token: ${resetToken}`);
        }
        res.json({ success: true, message: 'If the account exists, reset instructions were sent.' });
    } catch (err) { res.status(500).json({ error: 'Error processing request' }); }
});

router.post('/reset-password', async (req, res) => {
    const { username, resetToken, newPassword } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND reset_token = ? AND reset_expiry > NOW()', [username, resetToken]);
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired token' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expiry = NULL WHERE username = ?', [hash, username]);
        res.json({ success: true, message: 'Password reset successfully!' });
    } catch (err) { res.status(500).json({ error: 'Error resetting password' }); }
});

router.post('/ocr', upload.single('idImage'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
        const ocrData = await aiServices.ocrScan(req.file.path);
        
        let category = 'Regular', gender = null, birthday = null, detectedName = '';
        if (ocrData.idType === 'Senior' || ocrData.idType === 'Elderly') category = 'Senior';
        else if (ocrData.idType === 'PWD') category = 'PWD';
        if (ocrData.name) detectedName = ocrData.name;
        if (ocrData.age) {
            const y = new Date().getFullYear() - ocrData.age;
            birthday = `${y}-01-01`;
        }
        
        res.json({ success: true, category, name: detectedName, age: ocrData.age || null, birthday, gender: ocrData.gender || null });
    } catch (err) {
        console.error('OCR error:', err);
        res.status(500).json({ error: 'OCR processing failed' });
    }
});

module.exports = router;
