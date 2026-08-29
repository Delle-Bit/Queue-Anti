const emailjs = require('@emailjs/nodejs');

let warnedMissingOtpConfig = false;
let warnedMissingResetConfig = false;

// Sends a one-time-password email via EmailJS, using its own dedicated
// service/template/keys — deliberately separate from the password-reset
// EmailJS config below (different EmailJS service, different template, so
// they need their own credentials). Falls back to a console-mock when not
// fully configured, so OTP flows aren't hard-blocked in dev. The OTP template's
// "To Email" field (Settings tab, EmailJS dashboard) is bound to `{{email}}`
// (not `to_email`), and its body displays the code via `{{passcode}}`. Used by
// both the registration verification step (routes/auth.js) and login OTP
// (lib/better_auth.mjs).
async function sendOtpEmail(email, otp) {
    const serviceId = process.env.EMAILJS_OTP_SERVICE_ID;
    const templateId = process.env.EMAILJS_OTP_TEMPLATE_ID;
    const publicKey = process.env.EMAILJS_OTP_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_OTP_PRIVATE_KEY;

    if (!serviceId || !templateId || !publicKey || !privateKey) {
        if (!warnedMissingOtpConfig) {
            console.warn('[email_service] EMAILJS_OTP_SERVICE_ID / EMAILJS_OTP_TEMPLATE_ID / EMAILJS_OTP_PUBLIC_KEY / EMAILJS_OTP_PRIVATE_KEY not fully set — OTP emails will only be logged to console.');
            warnedMissingOtpConfig = true;
        }
        console.log(`[MOCK EMAIL TO ${email}] Your verification code: ${otp}`);
        return;
    }

    try {
        await emailjs.send(
            serviceId,
            templateId,
            { email, to_email: email, passcode: otp, otp_code: otp },
            { publicKey, privateKey }
        );
    } catch (err) {
        console.error('[email_service] Failed to send OTP email via EmailJS:', err.message || err);
        console.log(`[FALLBACK LOG] OTP for ${email}: ${otp}`);
    }
}

// Sends a password-reset verification code via EmailJS, using its own dedicated
// service/template/keys — separate from the registration/login OTP config above
// (own EmailJS service, own template). Falls back to a console-mock when not
// fully configured. Template variable bindings unconfirmed as of this writing —
// sends both `email`/`to_email` and `otp_code`/`passcode` so it has a chance of
// matching whichever names the template actually uses; narrow this once the
// template's Settings/Content tabs are checked (see registration OTP's history
// with this exact issue for the pattern: 403 -> non-browser toggle, 422 -> "To
// Email" variable name mismatch, "no code shown" -> body variable name mismatch).
async function sendPasswordResetEmail(email, otp) {
    const serviceId = process.env.EMAILJS_SERVICE_ID || 'service_q7v7ddo';
    const templateId = process.env.EMAILJS_TEMPLATE_ID;
    const publicKey = process.env.EMAILJS_PUBLIC_KEY;
    const privateKey = process.env.EMAILJS_PRIVATE_KEY;

    if (!templateId || !publicKey || !privateKey) {
        if (!warnedMissingResetConfig) {
            console.warn('[email_service] EMAILJS_TEMPLATE_ID / EMAILJS_PUBLIC_KEY / EMAILJS_PRIVATE_KEY not fully set — password reset emails will only be logged to console.');
            warnedMissingResetConfig = true;
        }
        console.log(`[MOCK EMAIL TO ${email}] Your password reset code: ${otp}`);
        return;
    }

    try {
        await emailjs.send(
            serviceId,
            templateId,
            { email, to_email: email, otp_code: otp, passcode: otp },
            { publicKey, privateKey }
        );
    } catch (err) {
        console.error('[email_service] Failed to send password reset email via EmailJS:', err.message || err);
        console.log(`[FALLBACK LOG] Password reset code for ${email}: ${otp}`);
    }
}

module.exports = { sendOtpEmail, sendPasswordResetEmail };
