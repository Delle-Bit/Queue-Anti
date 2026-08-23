const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { pool } = require('../database');
const multer = require('multer');
const aiServices = require('../ai_services');
const { JWT_SECRET } = require('../config');
const upload = multer({ dest: 'uploads/' });

// Simple in-memory rate limiter (per IP + route)
const rateStore = new Map();
function rateLimit(limit, windowMs) {
    return (req, res, next) => {
        const key = `${req.route?.path || req.path}|${req.ip}`;
        const now = Date.now();
        const bucket = (rateStore.get(key) || []).filter((t) => now - t < windowMs);
        if (bucket.length >= limit) {
            return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        }
        bucket.push(now);
        rateStore.set(key, bucket);
        next();
    };
}

function cleanupUpload(files) {
    const paths = [];
    if (files && files['frontId']) paths.push(files['frontId'][0].path);
    if (files && files['backId']) paths.push(files['backId'][0].path);
    for (const p of paths) fs.unlink(p, () => {});
}

function makeCustomerUid(insertId) {
    const year = new Date().getFullYear();
    return `MC-${year}-${String(insertId).padStart(6, '0')}`;
}

function generateToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function cleanupPendingRegistration(token) {
    try {
        const [rows] = await pool.query('SELECT front_id_path, back_id_path FROM pending_registrations WHERE token = ?', [token]);
        if (rows.length > 0) {
            if (rows[0].front_id_path) fs.unlink(rows[0].front_id_path, () => {});
            if (rows[0].back_id_path) fs.unlink(rows[0].back_id_path, () => {});
        }
        await pool.query('DELETE FROM pending_registrations WHERE token = ?', [token]);
    } catch (e) { /* ignore */ }
}

router.post('/login', rateLimit(10, 60 * 1000), async (req, res) => {
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
            admin: '/admintechnical.html', owner: '/owner.html', doctor: '/doctor.html'
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

router.post('/register/step1', rateLimit(5, 10 * 60 * 1000), upload.fields([{ name: 'frontId', maxCount: 1 }, { name: 'backId', maxCount: 1 }]), async (req, res) => {
    const { username, email, verification_method, guardian_name, guardian_contact, guardian_relationship } = req.body || {};
    try {
        const isUnderage = verification_method === 'guardian';
        if (!isUnderage && (!req.files || !req.files['frontId'] || !req.files['backId'])) {
            cleanupUpload(req.files);
            return res.status(400).json({ error: 'Both Front and Back ID images are required' });
        }
        if (isUnderage && (!guardian_name || !guardian_contact || !guardian_relationship)) {
            cleanupUpload(req.files);
            return res.status(400).json({ error: 'Guardian name, contact, and relationship are required for underage registration' });
        }

        // Check if username or email already exists
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existing.length > 0) {
            cleanupUpload(req.files);
            return res.status(409).json({ error: 'Username or email already registered' });
        }

        // OCR scan for category detection using the front ID
        let category = 'Regular', gender = null, birthday = null, detectedName = '';
        let frontIdPath = null, backIdPath = null;
        if (!isUnderage) {
            const frontFile = req.files['frontId'][0];
            const backFile = req.files['backId'][0];
            frontIdPath = frontFile.path;
            backIdPath = backFile.path;
            const ocrData = await aiServices.ocrScan(frontFile.path);
            if (ocrData.idType === 'Senior' || ocrData.idType === 'Elderly') category = 'Senior';
            else if (ocrData.idType === 'PWD') category = 'PWD';
            if (ocrData.name) detectedName = ocrData.name;
            if (ocrData.age) {
                const y = new Date().getFullYear() - ocrData.age;
                birthday = `${y}-01-01`;
            }
            if (ocrData.gender) gender = ocrData.gender;
        } else {
            cleanupUpload(req.files);
        }

        // Create pending registration
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        await pool.query(
            `INSERT INTO pending_registrations (token, username, email, verification_method, is_underage, guardian_name, guardian_contact, guardian_relationship, front_id_path, back_id_path, detected_category, detected_name, detected_birthday, detected_gender, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [token, username, email, verification_method, isUnderage ? 1 : 0, guardian_name || '', guardian_contact || '', guardian_relationship || '', frontIdPath, backIdPath, category, detectedName, birthday, gender, expiresAt]
        );

        res.json({
            success: true,
            message: 'Step 1 complete. Proceed to password creation.',
            token,
            category,
            detectedName,
            requiresGuardian: isUnderage
        });
    } catch (err) {
        cleanupUpload(req.files);
        console.error('Registration step1 error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Step 2: Password creation with confirmation
router.post('/register/step2', rateLimit(5, 10 * 60 * 1000), async (req, res) => {
    const { token, password, confirm_password } = req.body || {};
    try {
        if (!token) return res.status(400).json({ error: 'Registration token required' });
        if (!password || !confirm_password) return res.status(400).json({ error: 'Password and confirmation required' });
        if (password !== confirm_password) return res.status(400).json({ error: 'Passwords do not match' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const [rows] = await pool.query('SELECT * FROM pending_registrations WHERE token = ? AND expires_at > NOW()', [token]);
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired registration token' });

        const hash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE pending_registrations SET password_hash = ? WHERE token = ?', [hash, token]);

        res.json({ success: true, message: 'Password set. Proceed to verification.' });
    } catch (err) {
        console.error('Registration step2 error:', err);
        res.status(500).json({ error: 'Failed to set password' });
    }
});

// Step 3: Send verification code (OTP)
router.post('/register/send-verification', rateLimit(3, 10 * 60 * 1000), async (req, res) => {
    const { token } = req.body || {};
    try {
        if (!token) return res.status(400).json({ error: 'Registration token required' });

        const [rows] = await pool.query('SELECT * FROM pending_registrations WHERE token = ? AND expires_at > NOW() AND password_hash IS NOT NULL', [token]);
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired registration token, or password not set' });

        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await pool.query('UPDATE pending_registrations SET otp_code = ?, otp_expires_at = ?, otp_attempts = 0 WHERE token = ?', [otp, otpExpires, token]);

        // Mock email sending
        console.log(`[MOCK EMAIL TO ${rows[0].email}] Your verification code: ${otp}`);

        res.json({ success: true, message: 'Verification code sent to your email.' });
    } catch (err) {
        console.error('Send verification error:', err);
        res.status(500).json({ error: 'Failed to send verification' });
    }
});

// Step 4: Verify OTP and create account
router.post('/register/verify-otp', rateLimit(10, 10 * 60 * 1000), async (req, res) => {
    const { token, otp } = req.body || {};
    try {
        if (!token || !otp) return res.status(400).json({ error: 'Token and OTP required' });

        const [rows] = await pool.query('SELECT * FROM pending_registrations WHERE token = ? AND expires_at > NOW() AND password_hash IS NOT NULL AND otp_code IS NOT NULL AND otp_expires_at > NOW()', [token]);
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired registration token or OTP' });

        const pending = rows[0];
        if (pending.otp_attempts >= 5) {
            await cleanupPendingRegistration(token);
            return res.status(429).json({ error: 'Too many failed attempts. Registration expired.' });
        }
        if (pending.otp_code !== otp) {
            await pool.query('UPDATE pending_registrations SET otp_attempts = otp_attempts + 1 WHERE token = ?', [token]);
            return res.status(400).json({ error: 'Invalid OTP code' });
        }

        // Create the actual user account
        const [result] = await pool.query(
            `INSERT INTO users (username, password_hash, role, customer_category, email, full_name, birthday, gender, verification_method, is_underage, guardian_name, guardian_contact, guardian_relationship)
             VALUES (?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [pending.username, pending.password_hash, pending.detected_category, pending.email || '', pending.detected_name || pending.username, pending.detected_birthday, pending.detected_gender, pending.verification_method, pending.is_underage ? 1 : 0, pending.guardian_name || '', pending.guardian_contact || '', pending.guardian_relationship || '']
        );
        await pool.query('UPDATE users SET customer_uid=? WHERE id=?', [makeCustomerUid(result.insertId), result.insertId]);

        // Cleanup pending registration and uploaded files
        await cleanupPendingRegistration(token);

        // Mock welcome email
        console.log(`[MOCK EMAIL] Welcome ${pending.username}! Your account has been created. Category: ${pending.detected_category}`);

        res.json({ success: true, message: 'Account created successfully!', category: pending.detected_category });
    } catch (err) {
        console.error('Registration verify-otp error:', err);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

router.post('/forgot-password', rateLimit(3, 10 * 60 * 1000), async (req, res) => {
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

router.post('/reset-password', rateLimit(5, 10 * 60 * 1000), async (req, res) => {
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
        fs.unlink(req.file.path, () => {});

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
        if (req.file) fs.unlink(req.file.path, () => {});
        console.error('OCR error:', err);
        res.status(500).json({ error: 'OCR processing failed' });
    }
});

module.exports = router;
