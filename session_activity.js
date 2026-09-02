const { pool } = require('./database');

// ── STAFF IDLE-SESSION TIMEOUT ──────────────────────────────────────────────
// A staff account with no activity for 15 minutes has its session terminated
// and is sent back to the sign-in page.
//
// Two halves, because neither is sufficient alone:
//
//   The browser owns the clock. Only it can see mouse, keyboard and touch, so
//   only it can tell an idle terminal from a busy one. It reports genuine user
//   activity here via POST /api/session/heartbeat and, on timeout, logs itself
//   out through POST /api/session/timeout.
//
//   The server owns the verdict. A closed laptop or a killed tab never reports
//   anything, so a token would otherwise stay usable for its full 8-hour life.
//   Every authenticated staff request is checked against the last heartbeat and
//   rejected once it is stale.
//
// Deliberately driven by heartbeats rather than by request traffic: the staff
// dashboards poll their queue every 5 seconds, so "time since last request"
// would never expire on an unattended screen. Background polling does not
// extend a session; a keystroke does.

const IDLE_LIMIT_MS = 15 * 60 * 1000;

// The browser only needs to report that the user is still there, so one write
// per minute is plenty - the alternative is a DB round trip per mouse move.
const HEARTBEAT_WRITE_INTERVAL_MS = 60 * 1000;

// Warn the user this long before the deadline, so they can keep working.
const WARN_BEFORE_MS = 60 * 1000;

const STAFF_EXCLUDED_ROLES = ['customer'];

function isStaffRole(role) {
    return !!role && !STAFF_EXCLUDED_ROLES.includes(role);
}

// userId -> { lastActivity: ms, lastWrite: ms }
const activity = new Map();

// A session terminated for inactivity is remembered here so the still-valid JWT
// cannot be replayed. Cleared when the account signs in again.
const terminated = new Map();

function now() { return Date.now(); }

// Seeds from staff_sessions so a server restart does not silently hand every
// idle terminal a fresh 15 minutes.
async function loadLastActivity(userId) {
    try {
        const [rows] = await pool.query(
            `SELECT last_activity, login_time FROM staff_sessions
             WHERE user_id = ? AND logout_time IS NULL
             ORDER BY id DESC LIMIT 1`,
            [userId]
        );
        if (rows.length === 0) return null;
        const stamp = rows[0].last_activity || rows[0].login_time;
        return stamp ? new Date(stamp).getTime() : null;
    } catch (err) {
        return null;
    }
}

async function getLastActivity(userId) {
    const entry = activity.get(userId);
    if (entry) return entry.lastActivity;
    const stored = await loadLastActivity(userId);
    // No open session row at all (a token from before this feature existed, or a
    // customer promoted to staff) - start the clock now rather than locking them
    // out on their next click.
    const seeded = stored != null ? stored : now();
    activity.set(userId, { lastActivity: seeded, lastWrite: seeded });
    return seeded;
}

// Records genuine user activity. Called from the heartbeat endpoint and on
// sign-in; not from ordinary request traffic.
async function touch(userId) {
    const stamp = now();
    const entry = activity.get(userId) || { lastActivity: stamp, lastWrite: 0 };
    entry.lastActivity = stamp;
    activity.set(userId, entry);
    terminated.delete(userId);

    if (stamp - entry.lastWrite >= HEARTBEAT_WRITE_INTERVAL_MS) {
        entry.lastWrite = stamp;
        try {
            await pool.query(
                `UPDATE staff_sessions SET last_activity = NOW()
                 WHERE user_id = ? AND logout_time IS NULL
                 ORDER BY id DESC LIMIT 1`,
                [userId]
            );
        } catch (err) { /* the in-memory clock still governs; DB is for restarts */ }
    }
    return stamp;
}

// Called when a staff account signs in: a fresh session starts a fresh clock.
async function start(userId) {
    terminated.delete(userId);
    const stamp = now();
    activity.set(userId, { lastActivity: stamp, lastWrite: stamp });
    return stamp;
}

async function terminate(userId, reason = 'timeout') {
    terminated.set(userId, { at: now(), reason });
    activity.delete(userId);
    try {
        await pool.query(
            `UPDATE staff_sessions SET logout_time = NOW(), end_reason = ?
             WHERE user_id = ? AND logout_time IS NULL
             ORDER BY id DESC LIMIT 1`,
            [reason, userId]
        );
    } catch (err) {
        console.error('[session] failed to close session for user', userId, '-', err.message);
    }
}

// Returns { expired, msRemaining }.
async function inspect(userId) {
    if (terminated.has(userId)) return { expired: true, msRemaining: 0 };
    const last = await getLastActivity(userId);
    const idleFor = now() - last;
    if (idleFor >= IDLE_LIMIT_MS) return { expired: true, msRemaining: 0 };
    return { expired: false, msRemaining: IDLE_LIMIT_MS - idleFor };
}

// Express guard. Mounted after token verification, so req.user is populated.
// Customers are left alone: the requirement is about staff terminals, which sit
// unattended in a public clinic, not about a patient's own phone.
function enforceIdleTimeout(req, res, next) {
    if (!req.user || !isStaffRole(req.user.role)) return next();
    inspect(req.user.id).then(({ expired }) => {
        if (!expired) return next();
        terminate(req.user.id, 'timeout').catch(() => {});
        // The header is what lets the browser react without every one of the
        // dozens of existing fetch call sites having to parse the body.
        res.set('X-Session-Timeout', '1');
        res.status(401).json({
            error: 'Your session ended after 15 minutes of inactivity. Please sign in again.',
            code: 'session_timeout'
        });
    }).catch(() => next());
}

module.exports = {
    IDLE_LIMIT_MS, WARN_BEFORE_MS, HEARTBEAT_WRITE_INTERVAL_MS,
    isStaffRole, touch, start, terminate, inspect, enforceIdleTimeout
};
