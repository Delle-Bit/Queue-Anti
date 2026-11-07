// routes/feedback.js — patient feedback capture, its sentiment, and the
// administrator workflow that addresses it.
//
// Mounted ONCE (see server.js), unlike routes/admin.js, so a route without a
// guard is a route every signed-in account can reach. Every handler below
// carries its own check: reads are requireStaff, addressing is requireAdmin.
const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { requireStaff, requireAdmin, STAFF_ROLES } = require('../config');
const { analyzeSentiment } = require('../sentiment');
const { recordAudit } = require('../audit');

// How long after a visit closes the dashboard still offers the feedback prompt.
const PENDING_WINDOW_DAYS = 7;

// Fixed allow-lists. A query string is a value, not an identifier, but matching
// it against a known set keeps a typo from silently returning everything.
const FEEDBACK_STATUSES = ['new', 'in_review', 'resolved'];
const FEEDBACK_SENTIMENTS = ['Positive', 'Neutral', 'Negative'];

// mysql2 returns a JSON column already parsed, while an older row written by
// hand may still be a string. Accept either rather than throwing on one shape.
function parseIssues(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

// GET /api/feedback/pending — the customer's most recent closed visit that has
// no feedback yet. Server-driven so the dashboard never has to decide
// eligibility from a single active/inactive flag.
router.get('/pending', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT qs.id AS sequence_id, sp.name AS package_name, qs.completed_at
               FROM queue_sequences qs
               JOIN service_packages sp ON sp.id = qs.package_id
               LEFT JOIN feedback f ON f.sequence_id = qs.id AND f.archived = false
              WHERE qs.customer_id = ?
                AND qs.status IN ('completed','unfinished')
                AND qs.archived = false
                AND f.id IS NULL
                AND qs.completed_at >= (NOW() - INTERVAL ? DAY)
              ORDER BY qs.completed_at DESC
              LIMIT 1`,
            [req.user.id, PENDING_WINDOW_DAYS]
        );
        if (rows.length === 0) return res.json({ eligible: false });
        res.json({ eligible: true, ...rows[0] });
    } catch (err) {
        console.error('Feedback pending error:', err);
        res.status(500).json({ error: 'Could not check feedback' });
    }
});

// POST /api/feedback — submit one entry. The rating is optional; so is the
// comment, but an empty submission is refused so the table is not filled with
// blanks by a stray tap.
router.post('/', async (req, res) => {
    const { sequence_id, rating, comment, source } = req.body;
    try {
        const clean = String(comment || '').trim().slice(0, 2000);
        const numeric = rating === undefined || rating === null || rating === '' ? null : Number(rating);
        if (!clean && numeric === null) {
            return res.status(400).json({ error: 'Please add a rating or a comment.' });
        }
        if (numeric !== null && (!Number.isInteger(numeric) || numeric < 1 || numeric > 5)) {
            return res.status(400).json({ error: 'Rating must be from 1 to 5.' });
        }

        // The sequence must belong to this customer, or be absent (a general
        // comment with no visit attached).
        let seqId = null;
        if (sequence_id) {
            const [own] = await pool.query(
                'SELECT id FROM queue_sequences WHERE id = ? AND customer_id = ? AND archived = false',
                [sequence_id, req.user.id]
            );
            if (own.length === 0) return res.status(404).json({ error: 'Visit not found' });
            seqId = own[0].id;
        }

        const result = analyzeSentiment(clean);
        await pool.query(
            `INSERT INTO feedback
                (customer_id, sequence_id, rating, comment, sentiment_label, sentiment_score, issues, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, seqId, numeric, clean || null, result.label, result.compound,
             JSON.stringify(result.issues), source === 'assistant' ? 'assistant' : 'dashboard']
        );
        res.json({ success: true, sentiment: result.label, issues: result.issues });
    } catch (err) {
        console.error('Feedback submit error:', err);
        res.status(500).json({ error: 'Could not save feedback' });
    }
});

// GET /api/feedback — staff-wide list, newest first, optionally filtered.
// status/sentiment are matched against a fixed allow-list rather than trusted,
// so an arbitrary string cannot reach the WHERE clause as a value that matches
// nothing meaningful.
router.get('/', requireStaff, async (req, res) => {
    try {
        const where = ['f.archived = false'];
        const params = [];
        if (FEEDBACK_STATUSES.includes(req.query.status)) {
            where.push('f.status = ?'); params.push(req.query.status);
        }
        if (FEEDBACK_SENTIMENTS.includes(req.query.sentiment)) {
            where.push('f.sentiment_label = ?'); params.push(req.query.sentiment);
        }
        const [rows] = await pool.query(
            `SELECT f.id, f.rating, f.comment, f.sentiment_label, f.sentiment_score, f.issues,
                    f.status, f.assigned_to, f.admin_note, f.addressed_at, f.updated_at, f.created_at,
                    u.username AS customer_name,
                    a.username AS assigned_name
               FROM feedback f
               LEFT JOIN users u ON u.id = f.customer_id
               LEFT JOIN users a ON a.id = f.assigned_to
              WHERE ${where.join(' AND ')}
              ORDER BY FIELD(f.status, 'new', 'in_review', 'resolved'), f.created_at DESC
              LIMIT 200`, params
        );
        res.json(rows.map(r => ({ ...r, issues: parseIssues(r.issues) })));
    } catch (err) {
        console.error('Feedback list error:', err);
        res.status(500).json({ error: 'Could not load feedback' });
    }
});

// GET /api/feedback/staff — the assign-to picker's source. Admin only.
router.get('/staff', requireAdmin, async (req, res) => {
    try {
        const placeholders = STAFF_ROLES.map(() => '?').join(',');
        const [rows] = await pool.query(
            `SELECT id, username, role FROM users
              WHERE archived = false AND role IN (${placeholders})
              ORDER BY username`,
            STAFF_ROLES
        );
        res.json(rows);
    } catch (err) {
        console.error('Feedback staff error:', err);
        res.status(500).json({ error: 'Could not load staff' });
    }
});

// PATCH /api/feedback/:id — address one entry. An administrator moves it
// through new -> in_review -> resolved, optionally assigning it and leaving a
// note. Resolving stamps addressed_by/addressed_at; moving a resolved entry
// back to an open status clears them, so the fields always describe the current
// state. Every change is audited.
router.patch('/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad feedback id' });
    const { status, admin_note, assigned_to } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM feedback WHERE id = ? AND archived = false', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
        const before = rows[0];

        const sets = [];
        const params = [];
        let nextStatus = before.status;

        if (status !== undefined) {
            if (!FEEDBACK_STATUSES.includes(status)) {
                return res.status(400).json({ error: 'Status must be new, in_review or resolved.' });
            }
            nextStatus = status;
            sets.push('status = ?'); params.push(status);
            if (status === 'resolved') {
                sets.push('addressed_by = ?', 'addressed_at = NOW()');
                params.push(req.user.id);
            } else {
                sets.push('addressed_by = NULL', 'addressed_at = NULL');
            }
        }
        if (admin_note !== undefined) {
            sets.push('admin_note = ?'); params.push(String(admin_note || '').trim().slice(0, 2000) || null);
        }
        if (assigned_to !== undefined) {
            const who = assigned_to === null || assigned_to === '' ? null : Number(assigned_to);
            if (who !== null) {
                if (!Number.isInteger(who) || who <= 0) {
                    return res.status(400).json({ error: 'That account cannot be assigned.' });
                }
                const placeholders = STAFF_ROLES.map(() => '?').join(',');
                const [ok] = await pool.query(
                    `SELECT id FROM users
                      WHERE id = ? AND archived = false AND role IN (${placeholders})`,
                    [who, ...STAFF_ROLES]
                );
                if (ok.length === 0) return res.status(400).json({ error: 'That account cannot be assigned.' });
            }
            sets.push('assigned_to = ?'); params.push(who);
        }
        if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

        params.push(id);
        await pool.query(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, params);

        await recordAudit({
            req,
            action: 'feedback_address',
            entityType: 'feedback',
            entityId: id,
            summary: `Feedback #${id} set to ${nextStatus}`,
            details: {
                before: { status: before.status, assigned_to: before.assigned_to },
                after: { status: nextStatus }
            }
        });
        res.json({ success: true, status: nextStatus });
    } catch (err) {
        console.error('Feedback update error:', err);
        res.status(500).json({ error: 'Could not update feedback' });
    }
});

// GET /api/feedback/summary — headcounts plus the most frequent issues.
router.get('/summary', requireStaff, async (req, res) => {
    try {
        const [labels] = await pool.query(
            `SELECT sentiment_label, COUNT(*) AS n FROM feedback WHERE archived = false GROUP BY sentiment_label`
        );
        const counts = { Positive: 0, Neutral: 0, Negative: 0 };
        for (const row of labels) counts[row.sentiment_label] = Number(row.n);

        const [statusRows] = await pool.query(
            `SELECT status, COUNT(*) AS n FROM feedback WHERE archived = false GROUP BY status`
        );
        const statuses = { new: 0, in_review: 0, resolved: 0 };
        for (const row of statusRows) statuses[row.status] = Number(row.n);

        const [issueRows] = await pool.query(
            `SELECT issues FROM feedback WHERE archived = false AND issues IS NOT NULL`
        );
        const tally = new Map();
        for (const row of issueRows) {
            for (const issue of parseIssues(row.issues)) {
                tally.set(issue, (tally.get(issue) || 0) + 1);
            }
        }
        const top_issues = [...tally.entries()]
            .map(([issue, count]) => ({ issue, count }))
            .sort((a, b) => b.count - a.count);

        res.json({ counts, statuses, total: counts.Positive + counts.Neutral + counts.Negative, top_issues });
    } catch (err) {
        console.error('Feedback summary error:', err);
        res.status(500).json({ error: 'Could not summarise feedback' });
    }
});

module.exports = router;
