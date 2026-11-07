// routes/feedback.js — patient feedback capture and its sentiment.
//
// Mounted ONCE (see server.js), unlike routes/admin.js, so a route without a
// guard is a route every signed-in account can reach. Every handler below
// carries its own check.
const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { requireStaff } = require('../config');
const { analyzeSentiment } = require('../sentiment');

// How long after a visit closes the dashboard still offers the feedback prompt.
const PENDING_WINDOW_DAYS = 7;

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

// GET /api/feedback — staff-wide list, newest first.
router.get('/', requireStaff, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT f.id, f.rating, f.comment, f.sentiment_label, f.sentiment_score, f.issues,
                    f.created_at, u.username AS customer_name
               FROM feedback f
               LEFT JOIN users u ON u.id = f.customer_id
              WHERE f.archived = false
              ORDER BY f.created_at DESC
              LIMIT 200`
        );
        res.json(rows.map(r => ({ ...r, issues: parseIssues(r.issues) })));
    } catch (err) {
        console.error('Feedback list error:', err);
        res.status(500).json({ error: 'Could not load feedback' });
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

        res.json({ counts, total: counts.Positive + counts.Neutral + counts.Negative, top_issues });
    } catch (err) {
        console.error('Feedback summary error:', err);
        res.status(500).json({ error: 'Could not summarise feedback' });
    }
});

module.exports = router;
