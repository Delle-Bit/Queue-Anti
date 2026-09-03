import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const { pool } = require('../database.js');
const { sendOtpEmail } = require('../email_service.js');

// better-auth refuses to run on its own built-in default secret, and it throws
// from its internal initialisation rather than from anything we await - so a
// missing BETTER_AUTH_SECRET surfaced as an unhandled rejection that killed the
// process at boot, past the try/catch around migrateBetterAuth() in
// database.js. That made one optional variable able to take down the whole
// clinic, which is how the first Railway deploy failed.
//
// JWT_SECRET is the fallback because it is already mandatory and already strong,
// so there is no configuration in which this runs on a published default. Set
// BETTER_AUTH_SECRET to keep the two apart, which is preferable: this one only
// signs the six-digit login OTP exchange, while JWT_SECRET signs every session.
const authSecret = process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET;

if (!authSecret) {
    // Neither is set, which only happens with no .env at all. Say which
    // variable to set rather than letting the library's own error surface as an
    // unhandled rejection with no context.
    throw new Error('Set JWT_SECRET (and ideally BETTER_AUTH_SECRET) - the login OTP cannot be signed without one.');
}

export const auth = betterAuth({
    database: pool,
    secret: authSecret,
    baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 3000}`,
    emailAndPassword: { enabled: true },
    plugins: [
        emailOTP({
            otpLength: 6,
            expiresIn: 300, // 5 minutes
            allowedAttempts: 5,
            storeOTP: 'hashed',
            disableSignUp: false,
            sendVerificationOTP: async ({ email, otp, type }) => {
                if (type === 'sign-in') await sendOtpEmail(email, otp);
            }
        })
    ]
});

// checkVerificationOTP requires a better-auth `user` row with a matching email
// to already exist — sendVerificationOTP has no such requirement, so without
// this the first login attempt for any customer would send an OTP that could
// never be verified. Idempotent: swallows "already exists" on repeat calls.
async function ensureShadowUser(email) {
    try {
        await auth.api.signUpEmail({
            body: { email, password: crypto.randomBytes(24).toString('hex'), name: email }
        });
    } catch (err) {
        // Already provisioned — expected on every login after the first.
    }
}

export async function sendLoginOTP(email) {
    await ensureShadowUser(email);
    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
}

export async function verifyLoginOTP(email, otp) {
    try {
        await auth.api.checkVerificationOTP({ body: { email, type: 'sign-in', otp } });
        return true;
    } catch (err) {
        return false;
    }
}

export async function migrateBetterAuth() {
    const { getMigrations } = await import('better-auth/db/migration');
    const { compileMigrations } = await getMigrations(auth.options);
    const sql = await compileMigrations();
    if (!sql || !sql.trim()) return; // nothing pending

    // better-auth's generated DDL assumes MySQL's legacy "first TIMESTAMP column
    // with no explicit default auto-initializes to CURRENT_TIMESTAMP" behavior —
    // every TIMESTAMP column *after* the first one in a table is emitted bare
    // (no NULL, no DEFAULT) on the assumption MySQL will implicitly default it.
    // TIMESTAMP columns are implicitly NOT NULL in MySQL/MariaDB unless declared
    // otherwise, so a bare non-first TIMESTAMP column becomes "NOT NULL DEFAULT
    // '0000-00-00 00:00:00'" — which MariaDB's NO_ZERO_DATE sql_mode rejects
    // outright ("Invalid default value"). Patch each bare column explicitly:
    // `updatedAt` is semantically required (better-auth sets it on every write),
    // so it gets a real default; everything else (token expiry columns etc.) is
    // semantically optional, so it's made explicitly nullable instead.
    let patchedSql = sql.replace(
        /`updatedAt` timestamp\(3\) not null/g,
        '`updatedAt` timestamp(3) default CURRENT_TIMESTAMP(3) not null'
    );
    patchedSql = patchedSql.replace(
        /(`\w+` timestamp\(3\))(?!\s+(?:not null|default))/g,
        '$1 null'
    );

    const statements = patchedSql.split(';').map(s => s.trim()).filter(Boolean);
    for (const statement of statements) {
        await pool.query(statement);
    }
}
