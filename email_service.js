const axios = require('axios');
const emailjs = require('@emailjs/nodejs');

let warnedMissingKey = false;
let warnedMissingEmailJSConfig = false;

// Sends a one-time-password email via the Resend HTTP API. Falls back to the
// same console-mock pattern used by the registration OTP flow (routes/auth.js)
// when RESEND_API_KEY isn't configured, so login isn't hard-blocked in dev.
async function sendOtpEmail(email, otp) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.FROM_EMAIL || 'onboarding@resend.dev';

    if (!apiKey) {
        if (!warnedMissingKey) {
            console.warn('[email_service] RESEND_API_KEY not set — OTP emails will only be logged to console.');
            warnedMissingKey = true;
        }
        console.log(`[MOCK EMAIL TO ${email}] Your login verification code: ${otp}`);
        return;
    }

    try {
        await axios.post('https://api.resend.com/emails', {
            from,
            to: email,
            subject: 'Your login verification code',
            html: `<p>Your verification code is:</p><h2 style="letter-spacing:0.3em;">${otp}</h2><p>This code expires in 5 minutes.</p>`
        }, {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('[email_service] Failed to send OTP email via Resend:', err.response?.data || err.message);
        console.log(`[FALLBACK LOG] OTP for ${email}: ${otp}`);
    }
}

// Sends a password-reset link via EmailJS. Falls back to a console-mock (same
// pattern as sendOtpEmail) when the EmailJS template/keys aren't configured.
// The EmailJS template referenced by EMAILJS_TEMPLATE_ID must define variables
// named `to_email` and `reset_link` for this call's templateParams to populate.
async function sendPasswordResetEmail(email, resetLink) {
    const serviceId = process.env.EMAILJS_SERVICE_ID || 'service_fme5x5o';
    const templateId = process.env.EMAILJS_TEMPLATE_ID;
    const publicKey = process.env.EMAILJS_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_PRIVATE_KEY;

    if (!templateId || !publicKey || !privateKey) {
        if (!warnedMissingEmailJSConfig) {
            console.warn('[email_service] EMAILJS_TEMPLATE_ID / EMAILJS_PUBLIC_KEY / EMAILJS_PRIVATE_KEY not fully set — password reset emails will only be logged to console.');
            warnedMissingEmailJSConfig = true;
        }
        console.log(`[MOCK EMAIL TO ${email}] Reset your password: ${resetLink}`);
        return;
    }

    try {
        await emailjs.send(
            serviceId,
            templateId,
            { to_email: email, reset_link: resetLink },
            { publicKey, privateKey }
        );
    } catch (err) {
        console.error('[email_service] Failed to send password reset email via EmailJS:', err.message || err);
        console.log(`[FALLBACK LOG] Reset link for ${email}: ${resetLink}`);
    }
}

module.exports = { sendOtpEmail, sendPasswordResetEmail };
