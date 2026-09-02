const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { pool } = require('../database');
const sessionActivity = require('../session_activity');
const multer = require('multer');
const aiServices = require('../ai_services');
const { JWT_SECRET } = require('../config');
const { sendLoginOTP, verifyLoginOTP } = require('../lib/better_auth_bridge');
const { sendOtpEmail, sendPasswordResetEmail } = require('../email_service');
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

function slugifyName(name) {
    return (name || '')
        .toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 40) || 'user';
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

// Sweeps pending_registrations rows whose 24h token has expired: unlinks their
// uploaded ID images and deletes the row. Nothing else ever cleans these up —
// an abandoned wizard (closed tab, no final OTP step) would otherwise leave
// orphaned rows/files on disk indefinitely.
async function reapExpiredRegistrations() {
    try {
        const [rows] = await pool.query('SELECT token, front_id_path, back_id_path FROM pending_registrations WHERE expires_at <= NOW()');
        for (const row of rows) {
            if (row.front_id_path) fs.unlink(row.front_id_path, () => {});
            if (row.back_id_path) fs.unlink(row.back_id_path, () => {});
        }
        if (rows.length > 0) {
            await pool.query('DELETE FROM pending_registrations WHERE expires_at <= NOW()');
            console.log(`[Registration Reaper] Purged ${rows.length} expired pending registration(s).`);
        }
    } catch (err) {
        console.error('[Registration Reaper] Sweep failed:', err);
    }
}

const LOGIN_REDIRECT_MAP = {
    customer: '/customer.html', frontdesk: '/frontdesk.html',
    laboratory: '/laboratory.html', admintechnical: '/admintechnical.html',
    admin: '/admintechnical.html', owner: '/owner.html', doctor: '/doctor.html'
};

function maskEmail(email) {
    const [name, domain] = email.split('@');
    if (!domain) return email;
    return `${name.slice(0, 2)}***@${domain}`;
}

async function issueSessionToken(user, res) {
    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role, category: user.customer_category },
        JWT_SECRET, { expiresIn: '8h' }
    );
    // Track staff login, and start the 15-minute inactivity clock for this
    // session (session_activity.js) so a fresh sign-in is never treated as the
    // continuation of an idle one.
    if (user.role !== 'customer') {
        await pool.query('INSERT INTO staff_sessions (user_id, last_activity) VALUES (?, NOW())', [user.id]);
        await sessionActivity.start(user.id);
    }
    res.json({
        success: true, token, role: user.role,
        category: user.customer_category, username: user.username,
        redirect: LOGIN_REDIRECT_MAP[user.role] || '/index.html'
    });
}

router.post('/login', rateLimit(10, 60 * 1000), async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        // Customers get a second factor: email OTP before a session token is issued.
        // Staff/admin/doctor/owner logins are unaffected (matches "customer login flow").
        if (user.role === 'customer' && user.email) {
            const challengeToken = jwt.sign({ id: user.id, purpose: 'login-otp' }, JWT_SECRET, { expiresIn: '5m' });
            try {
                await sendLoginOTP(user.email);
            } catch (err) {
                console.error('Login OTP send error:', err);
                return res.status(500).json({ error: 'Failed to send verification code' });
            }
            return res.json({ success: true, otp_required: true, challenge_token: challengeToken, email_hint: maskEmail(user.email) });
        }

        await issueSessionToken(user, res);
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/login/verify-otp', rateLimit(10, 5 * 60 * 1000), async (req, res) => {
    const { challenge_token, otp } = req.body || {};
    if (!challenge_token || !otp) return res.status(400).json({ error: 'Challenge token and code required' });
    try {
        let payload;
        try { payload = jwt.verify(challenge_token, JWT_SECRET); }
        catch (err) { return res.status(400).json({ error: 'Verification session expired. Please log in again.' }); }
        if (payload.purpose !== 'login-otp') return res.status(400).json({ error: 'Invalid verification session' });

        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [payload.id]);
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid verification session' });
        const user = rows[0];

        const ok = await verifyLoginOTP(user.email, otp);
        if (!ok) return res.status(400).json({ error: 'Invalid or expired code' });

        await issueSessionToken(user, res);
    } catch (err) {
        console.error('Login verify-otp error:', err);
        res.status(500).json({ error: 'Failed to verify code' });
    }
});

router.post('/login/resend-otp', rateLimit(3, 10 * 60 * 1000), async (req, res) => {
    const { challenge_token } = req.body || {};
    if (!challenge_token) return res.status(400).json({ error: 'Challenge token required' });
    try {
        let payload;
        try { payload = jwt.verify(challenge_token, JWT_SECRET); }
        catch (err) { return res.status(400).json({ error: 'Verification session expired. Please log in again.' }); }
        if (payload.purpose !== 'login-otp') return res.status(400).json({ error: 'Invalid verification session' });

        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [payload.id]);
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid verification session' });

        await sendLoginOTP(rows[0].email);
        res.json({ success: true, message: 'Verification code resent.' });
    } catch (err) {
        console.error('Login resend-otp error:', err);
        res.status(500).json({ error: 'Failed to resend code' });
    }
});

// Suggests a login username from a display name, appending a number if the
// base is already taken (by an active account or another in-progress signup)
// so two people with the same name don't collide.
router.get('/register/suggest-username', rateLimit(30, 10 * 60 * 1000), async (req, res) => {
    const base = slugifyName(req.query.name);
    try {
        const like = `${base}%`;
        const [existing] = await pool.query('SELECT username FROM users WHERE username LIKE ?', [like]);
        const [pending] = await pool.query('SELECT username FROM pending_registrations WHERE username LIKE ? AND expires_at > NOW()', [like]);
        const taken = new Set([...existing, ...pending].map((r) => r.username));
        if (!taken.has(base)) return res.json({ username: base });
        let n = 2;
        while (taken.has(`${base}${n}`)) n++;
        res.json({ username: `${base}${n}`.slice(0, 50) });
    } catch (err) {
        console.error('Suggest username error:', err);
        res.status(500).json({ error: 'Failed to suggest username' });
    }
});

router.post('/register/step1', rateLimit(5, 10 * 60 * 1000), upload.fields([{ name: 'frontId', maxCount: 1 }, { name: 'backId', maxCount: 1 }]), async (req, res) => {
    const { username, full_name, email, verification_method, guardian_name, guardian_contact, guardian_relationship } = req.body || {};
    try {
        const isUnderage = verification_method === 'guardian';
        if (!username || !full_name || !email) {
            cleanupUpload(req.files);
            return res.status(400).json({ error: 'Full name, username, and email are required' });
        }
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

        // OCR scan for category detection using the front ID. The typed full name
        // is authoritative (OCR name extraction is unreliable); OCR only fills in
        // gaps if the client somehow sent a blank name.
        let category = 'Regular', gender = null, birthday = null, detectedName = full_name.trim().slice(0, 255);
        let frontIdPath = null, backIdPath = null;
        if (!isUnderage) {
            const frontFile = req.files['frontId'][0];
            const backFile = req.files['backId'][0];
            frontIdPath = frontFile.path;
            backIdPath = backFile.path;
            const ocrData = await aiServices.ocrScan(frontFile.path);
            if (ocrData.idType === 'Senior' || ocrData.idType === 'Elderly') category = 'Senior';
            else if (ocrData.idType === 'PWD') category = 'PWD';
            if (!detectedName && ocrData.name) detectedName = ocrData.name;
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
        // Client blocks spaces at the keystroke level, but this is the actual
        // security boundary — the client can be bypassed. Reject rather than
        // silently strip, so a caller that sends a space-containing password
        // (e.g. a direct API call) gets a clear error instead of having it
        // hashed as a different string than what they sent.
        if (password !== confirm_password) return res.status(400).json({ error: 'Passwords do not match' });
        if (/\s/.test(password)) return res.status(400).json({ error: 'Password cannot contain spaces' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        if (password.length > 16) return res.status(400).json({ error: 'Password cannot exceed 16 characters' });

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

        await sendOtpEmail(rows[0].email, otp);

        res.json({ success: true, message: 'Verification code sent to your email.' });
    } catch (err) {
        console.error('Send verification error:', err);
        res.status(500).json({ error: 'Failed to send verification' });
    }
});

// Step 4: Verify OTP and create account
router.post('/register/verify-otp', rateLimit(10, 10 * 60 * 1000), async (req, res) => {
    const { token, otp, terms_accepted } = req.body || {};
    try {
        if (!token || !otp) return res.status(400).json({ error: 'Token and OTP required' });
        if (!terms_accepted) return res.status(400).json({ error: 'You must accept the Terms and Conditions to create an account' });

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
            `INSERT INTO users (username, password_hash, role, customer_category, email, full_name, birthday, gender, verification_method, is_underage, guardian_name, guardian_contact, guardian_relationship, terms_accepted_at)
             VALUES (?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
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

// Explicit void: called when the user closes/abandons the registration modal
// mid-wizard, so the pending row + uploaded ID images are freed immediately
// instead of waiting up to 24h for natural expiry. Idempotent and unauthenticated
// (the token itself is the capability — same trust model as the other register/* steps).
router.post('/register/abandon', rateLimit(20, 10 * 60 * 1000), async (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Registration token required' });
    await cleanupPendingRegistration(token);
    res.json({ success: true });
});

router.post('/forgot-password', rateLimit(3, 10 * 60 * 1000), async (req, res) => {
    const { username } = req.body || {};
    try {
        // Always issue an opaque session token in the response, whether or not the
        // account exists — otherwise "did a token come back" becomes an account
        // enumeration oracle. A token for a nonexistent account just never matches
        // any row's reset_token later, so it fails the same way an expired one does.
        const resetToken = generateToken();
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0 && rows[0].email) {
            const otp = generateOTP();
            await pool.query(
                'UPDATE users SET reset_token = ?, reset_expiry = DATE_ADD(NOW(), INTERVAL 15 MINUTE), reset_otp = ?, reset_otp_attempts = 0 WHERE id = ?',
                [resetToken, otp, rows[0].id]
            );
            await sendPasswordResetEmail(rows[0].email, otp);
        }
        res.json({ success: true, message: 'If the account exists, a verification code was sent.', token: resetToken });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Error processing request' });
    }
});

// Verifies the emailed code before the client is allowed to proceed to the
// "new password" step. Clearing reset_otp here is what /reset-password below
// requires — a password can only be set after this step has succeeded.
router.post('/reset-password/verify-otp', rateLimit(10, 10 * 60 * 1000), async (req, res) => {
    const { token, otp } = req.body || {};
    try {
        if (!token || !otp) return res.status(400).json({ error: 'Token and code required' });
        const [rows] = await pool.query('SELECT * FROM users WHERE reset_token = ? AND reset_expiry > NOW()', [token]);
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired session. Please request a new code.' });

        const user = rows[0];
        if (user.reset_otp === null) return res.status(400).json({ error: 'Code already verified.' });
        if (user.reset_otp_attempts >= 5) {
            await pool.query('UPDATE users SET reset_token = NULL, reset_expiry = NULL, reset_otp = NULL WHERE id = ?', [user.id]);
            return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
        }
        if (user.reset_otp !== otp) {
            await pool.query('UPDATE users SET reset_otp_attempts = reset_otp_attempts + 1 WHERE id = ?', [user.id]);
            return res.status(400).json({ error: 'Invalid code' });
        }

        await pool.query('UPDATE users SET reset_otp = NULL WHERE id = ?', [user.id]);
        res.json({ success: true, message: 'Code verified. Choose a new password.' });
    } catch (err) {
        console.error('Reset password verify-otp error:', err);
        res.status(500).json({ error: 'Failed to verify code' });
    }
});

router.post('/reset-password', rateLimit(5, 10 * 60 * 1000), async (req, res) => {
    const { token, newPassword } = req.body || {};
    try {
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
        if (/\s/.test(newPassword)) return res.status(400).json({ error: 'Password cannot contain spaces' });
        if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        if (newPassword.length > 16) return res.status(400).json({ error: 'Password cannot exceed 16 characters' });
        const [rows] = await pool.query('SELECT * FROM users WHERE reset_token = ? AND reset_expiry > NOW() AND reset_otp IS NULL', [token]);
        if (rows.length === 0) return res.status(400).json({ error: 'Verification required before resetting your password.' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expiry = NULL, reset_otp = NULL, reset_otp_attempts = 0 WHERE id = ?', [hash, rows[0].id]);
        res.json({ success: true, message: 'Password reset successfully!' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Error resetting password' });
    }
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
module.exports.reapExpiredRegistrations = reapExpiredRegistrations;
