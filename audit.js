const { pool } = require('./database');

// ── AUDIT TRAIL ─────────────────────────────────────────────────────────────
// Every system-level configuration or data change records four things, and an
// entry missing any of them is not an audit trail:
//
//   What  - action + entity_type + entity_id, plus the before/after snapshots
//           and a `details` diff of only the fields that actually moved.
//   Who   - performed_by, denormalised to actor_name/actor_role so the log still
//           reads correctly after the account is renamed or archived.
//   When  - created_at.
//   Why   - reason, supplied by the person making the change. Required: the
//           endpoints below reject the request rather than write a blank one.

const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 500;

function normalizeReason(raw) {
    return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
}

// Returns an error message, or null when the reason is acceptable.
function reasonError(raw) {
    const reason = normalizeReason(raw);
    if (!reason) return 'A reason for this change is required.';
    if (reason.length < MIN_REASON_LENGTH) {
        return `The reason must be at least ${MIN_REASON_LENGTH} characters.`;
    }
    if (reason.length > MAX_REASON_LENGTH) {
        return `The reason must be ${MAX_REASON_LENGTH} characters or fewer.`;
    }
    return null;
}

// Express guard: rejects the request unless req.body.reason is usable, and
// normalises it onto req.auditReason so the handler does not repeat the work.
function requireReason(req, res, next) {
    const error = reasonError(req.body && req.body.reason);
    if (error) return res.status(400).json({ error, reason_required: true });
    req.auditReason = normalizeReason(req.body.reason);
    next();
}

// mysql2 hands back Date objects and Buffers; JSON.stringify would turn those
// into shapes that read badly in the log, so flatten them to strings first.
// Password hashes and one-time codes are dropped outright - an audit trail is
// read by more people than the users table is.
const REDACTED_KEYS = /password|hash|token|otp|secret/i;

function scrubSnapshot(row) {
    if (!row || typeof row !== 'object') return null;
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        if (REDACTED_KEYS.test(key)) continue;
        if (value instanceof Date) out[key] = value.toISOString();
        else if (Buffer.isBuffer(value)) out[key] = '[binary]';
        else out[key] = value;
    }
    return out;
}

// Only the fields that actually moved, so `details` stays readable in the table
// instead of repeating the whole row on every edit.
function diffSnapshots(before, after) {
    const a = scrubSnapshot(before) || {};
    const b = scrubSnapshot(after) || {};
    const changes = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const from = a[key];
        const to = b[key];
        if (String(from ?? '') === String(to ?? '')) continue;
        changes[key] = { from: from ?? null, to: to ?? null };
    }
    return changes;
}

// Never throws: a failed audit write must not roll back or 500 a change the
// clinic has already made. It is logged to the server console instead.
async function recordAudit({ req, action, entityType, entityId, summary, before, after, reason, details }) {
    try {
        const actor = (req && req.user) || {};
        const changes = details !== undefined ? details : diffSnapshots(before, after);
        const numericId = Number(entityId);
        await pool.query(
            `INSERT INTO audit_logs
                (action, entity_type, entity_id, details, summary, reason,
                 before_snapshot, after_snapshot, performed_by, actor_name, actor_role)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(action || 'update').slice(0, 100),
                String(entityType || '').slice(0, 50),
                Number.isFinite(numericId) ? numericId : null,
                JSON.stringify(changes ?? {}),
                String(summary || '').slice(0, 255),
                normalizeReason(reason != null ? reason : (req && req.auditReason)),
                before ? JSON.stringify(scrubSnapshot(before)) : null,
                after ? JSON.stringify(scrubSnapshot(after)) : null,
                actor.id || null,
                String(actor.username || 'system').slice(0, 255),
                String(actor.role || '').slice(0, 40)
            ]
        );
    } catch (err) {
        console.error('[audit] failed to record', action, entityType, entityId, '-', err.message);
    }
}

// Convenience for the common "read the row, change it, log the difference" shape.
async function snapshotRow(table, idColumn, idValue) {
    try {
        const [rows] = await pool.query(`SELECT * FROM ${table} WHERE ${idColumn} = ?`, [idValue]);
        return rows[0] || null;
    } catch (err) {
        return null;
    }
}

module.exports = {
    MIN_REASON_LENGTH, MAX_REASON_LENGTH,
    normalizeReason, reasonError, requireReason,
    scrubSnapshot, diffSnapshots,
    recordAudit, snapshotRow
};
