# Feedback Sentiment Analysis (VADER port) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture patient feedback at the end of a visit (from the dashboard or the virtual assistant), score it with a JavaScript VADER port, persist it, and surface sentiment plus recurring issues to staff.

**Architecture:** A pure `sentiment.js` analyzer wraps the `vader-sentiment` package (no Python, no network). A new `feedback` table stores each entry with its computed label/score/issues. A single `routes/feedback.js` router (mounted once) serves customer submit/pending and staff list/summary, each route carrying its own guard. The customer dashboard shows a feedback modal when a visit closes; the virtual assistant opens the same modal on a feedback intent. No AI provider is required — VADER runs locally.

**Tech Stack:** Node >=20, CommonJS, Express 5, MySQL (`mysql2`), `vader-sentiment` (pure JS, Apache-2.0 port of Hutto & Gilbert 2014), existing `public/shared.js` modal helpers, Socket.IO `queueUpdate`.

**Spec:** No separate design doc. Driven by the thesis "Model and Algorithm" section (Feedback Sentiment Analysis) and the decision recorded 2026-11-07 to ship a JS VADER port rather than a 300 MB Transformers.js runtime.

## Global Constraints

- Node >=20, CommonJS (`require`). No Python. No new native/compiled dependency.
- The only new runtime dependency is `vader-sentiment` (pure JS).
- `npm test` must stay key-free, network-free and database-free.
- Schema changes go through `initDB()` and are additive only: `CREATE TABLE IF NOT EXISTS`, `addColumnIfMissing`, `addIndexIfMissing`. Editing an existing `CREATE TABLE` body does nothing on a deployed database.
- The database is MySQL, not MariaDB: **never** put a `DEFAULT` on a `TEXT` column (it fails `CREATE TABLE` under `STRICT_TRANS_TABLES`).
- `routes/admin.js` is mounted twice (once under `/api/admin` with `requireAdmin`, once under bare `/api` without). Never add an unguarded handler there. New admin-facing routes go in `routes/feedback.js`.
- Staff roles are `STAFF_ROLES`; admin roles are `ADMIN_ROLES`, both in `config.js`. Reuse `requireStaff` / `requireAdmin`.
- Patient free text is sensitive. Store the comment once in `feedback`. Do **not** route it through `logAI()` (its `ai_logs` payload is JSON on disk indefinitely); if any AI logging is added, redact the text.
- Use `NOW()` / `CURDATE()` for timestamps, matching the rest of the app.

---

### Task 1: VADER analyzer module

**Files:**
- Create: `sentiment.js`
- Test: `verify_sentiment.js`

**Interfaces:**
- Produces: `analyzeSentiment(text) -> { label: 'Positive'|'Neutral'|'Negative', compound: number, scores: {pos,neu,neg}, issues: string[] }`
- Produces: `classify(compound) -> 'Positive'|'Neutral'|'Negative'`
- Produces: `ISSUE_RULES` (array of `{ label, re }`), `LABELS`

- [ ] **Step 1: Write the failing test**

```javascript
// verify_sentiment.js — VADER scoring and issue mining, asserted.
// Run by `npm test`, or on its own: node verify_sentiment.js
// Needs no key, no network, no database.
const { analyzeSentiment, classify } = require('./sentiment');

let passed = 0, failed = 0;
function check(label, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { passed++; console.log(`  ok   ${label}`); }
    else { failed++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

console.log('\n1. the VADER thresholds');
check('clearly positive', classify(0.85), 'Positive');
check('the +0.05 boundary is positive', classify(0.05), 'Positive');
check('just under the boundary is neutral', classify(0.0499), 'Neutral');
check('clearly negative', classify(-0.7), 'Negative');
check('the -0.05 boundary is negative', classify(-0.05), 'Negative');
check('zero is neutral', classify(0), 'Neutral');

console.log('\n2. scoring real sentences');
check('praise reads positive', analyzeSentiment('The staff were kind and fast, thank you!').label, 'Positive');
check('a complaint reads negative', analyzeSentiment('I waited so long and the room was dirty.').label, 'Negative');
check('a flat statement reads neutral', analyzeSentiment('I visited the clinic on Monday.').label, 'Neutral');
check('empty input is neutral, not an error', analyzeSentiment('').label, 'Neutral');
check('whitespace-only is neutral', analyzeSentiment('   ').label, 'Neutral');

console.log('\n3. issue mining is independent of polarity');
const complaint = analyzeSentiment('Very slow, waited over an hour, and expensive.');
check('long wait flagged', complaint.issues.includes('Long wait times'), true);
check('cost flagged', complaint.issues.includes('Cost / billing'), true);
check('a praise with no topic flags nothing', analyzeSentiment('Thank you!').issues.length, 0);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node verify_sentiment.js`
Expected: FAIL — `Cannot find module './sentiment'`.

- [ ] **Step 3: Install the dependency**

Run: `npm install --save vader-sentiment`
Expected: `vader-sentiment` appears under `dependencies` in `package.json`.

- [ ] **Step 4: Write the minimal implementation**

```javascript
// sentiment.js — a JavaScript port of VADER (Valence Aware Dictionary and
// sEntiment Reasoner), the lexicon- and rule-based model from Hutto & Gilbert
// (ICWSM 2014). The `vader-sentiment` package is that same algorithm ported to
// JS, so this runs in the existing Node image with no Python and no network.
//
// Scope note: VADER scores *valence* (how positive or negative), not topics. The
// issue rules below are a small keyword layer on top, because "the line is slow"
// and "everything was perfect" can carry the same sentiment but are not the same
// message to the clinic.
const vader = require('vader-sentiment');

const LABELS = { pos: 'Positive', neu: 'Neutral', neg: 'Negative' };

// VADER's documented thresholds on the normalized compound score.
function classify(compound) {
    if (compound >= 0.05) return 'Positive';
    if (compound <= -0.05) return 'Negative';
    return 'Neutral';
}

const ISSUE_RULES = [
    { label: 'Long wait times', re: /\b(wait|waiting|slow|delayed|delay|line|queue)\b/i },
    { label: 'Staff attitude', re: /\b(rude|unfriendly|attitude|disrespect|impolite)\b/i },
    { label: 'Unclear instructions', re: /\b(confus|unclear|didn'?t know|not sure where|no direction)\b/i },
    { label: 'Cleanliness', re: /\b(dirty|unclean|messy|filthy)\b/i },
    { label: 'Cost / billing', re: /\b(expensive|overpriced|cost|price|charge|bill|payment|receipt)\b/i }
];

function analyzeSentiment(text) {
    const clean = String(text || '').trim();
    if (!clean) {
        return { label: 'Neutral', compound: 0, scores: { pos: 0, neu: 1, neg: 0 }, issues: [] };
    }
    const scores = vader.SentimentIntensityAnalyzer.polarity_scores(clean);
    return {
        label: classify(scores.compound),
        compound: Math.round(scores.compound * 10000) / 10000,
        scores: { pos: scores.pos, neu: scores.neu, neg: scores.neg },
        issues: ISSUE_RULES.filter(r => r.re.test(clean)).map(r => r.label)
    };
}

module.exports = { analyzeSentiment, classify, ISSUE_RULES, LABELS };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node verify_sentiment.js`
Expected: PASS, `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add sentiment.js verify_sentiment.js package.json package-lock.json
git commit -m "feat(sentiment): VADER port with issue mining, no Python"
```

---

### Task 2: `feedback` table

**Files:**
- Modify: `database.js` (inside `initDB()`, near the `announcements` table ~line 646)

**Interfaces:**
- Produces: table `feedback(id, customer_id, sequence_id, rating, comment, sentiment_label, sentiment_score, issues, source, created_at, archived)`

- [ ] **Step 1: Add the table creation** (after the `announcements` block)

```javascript
        // Patient feedback. `comment` is free text and deliberately has no
        // DEFAULT - MySQL rejects that under STRICT_TRANS_TABLES. Sentiment is
        // computed once at submit time and stored alongside, so the staff view
        // never has to re-score (and the label can't drift if the lexicon
        // changes later).
        await pool.query(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                sequence_id INT DEFAULT NULL,
                rating TINYINT DEFAULT NULL,
                comment TEXT,
                sentiment_label ENUM('Positive','Neutral','Negative') DEFAULT 'Neutral',
                sentiment_score DECIMAL(6,4) DEFAULT 0,
                issues JSON,
                source ENUM('dashboard','assistant') DEFAULT 'dashboard',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                archived BOOLEAN DEFAULT false
            )
        `);
        await addIndexIfMissing('feedback', 'idx_feedback_customer', '(customer_id)');
        await addIndexIfMissing('feedback', 'idx_feedback_sequence', '(sequence_id)');
```

- [ ] **Step 2: Verify the schema converges on an existing database**

Run: `npm run dev`, wait for `Server running`, then confirm in MySQL:
`SHOW COLUMNS FROM clinic_v2.feedback;`
Expected: 11 columns, `comment` type `text` with `Default NULL`, `sentiment_label` an enum.

- [ ] **Step 3: Commit**

```bash
git add database.js
git commit -m "feat(feedback): table for patient feedback and its sentiment"
```

---

### Task 3: Back `feedbackAnalysis` with the real analyzer

**Files:**
- Modify: `ai_services.js` (`feedbackAnalysis`, ~line 1384; add `const { analyzeSentiment } = require('./sentiment');` near the top requires)
- Test: `verify_ai_chain.js` (extend)

**Interfaces:**
- Consumes: `analyzeSentiment(text)` from Task 1
- Produces: `aiServices.feedbackAnalysis(comments) -> { sentiment, compound, issues }` where `comments` is a string or array of `{ comment }` / strings

- [ ] **Step 1: Write the failing test** — append to `verify_ai_chain.js` before the summary line

```javascript
console.log('\n15. feedback analysis is real VADER, not a fixed string');
const fb = await T.feedbackAnalysis([
    { comment: 'The staff were wonderful and quick.' },
    { comment: 'Waited two hours, very slow.' }
]);
check('negative text can produce a negative result', fb.sentiment, 'Negative');
check('issues are mined from the text', fb.issues.includes('Long wait times'), true);
```

> Note: `T.feedbackAnalysis` must be exported in the `__test` block at the bottom of the file, alongside the existing exports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run verify:ai`
Expected: FAIL — result is always `"Mixed"` (the current stub), or `T.feedbackAnalysis is not a function` if the export was not added yet.

- [ ] **Step 3: Replace the stub**

```javascript
    feedbackAnalysis: async (feedbackArray) => {
        return await callMockAI('feedback', null, process.env.API_ALLAROUND, feedbackArray, (data) => {
            // VADER runs locally (no endpoint needed): ./sentiment.js. Model the
            // batch as one document so a mixed batch lands where its words do,
            // and keep per-entry scoring for the staff view.
            const text = Array.isArray(data)
                ? data.map(f => (typeof f === 'string' ? f : f?.comment || '')).join('. ')
                : String(data || '');
            const result = analyzeSentiment(text);
            return { sentiment: result.label, compound: result.compound, issues: result.issues };
        }, null, 'Feedback NLP');
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run verify:ai`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ai_services.js verify_ai_chain.js
git commit -m "feat(feedback): back feedbackAnalysis with VADER instead of a fixed string"
```

---

### Task 4: Customer routes — submit and pending

**Files:**
- Create: `routes/feedback.js`
- Modify: `server.js` (mount after line ~245)

**Interfaces:**
- Consumes: `analyzeSentiment` (Task 1), `checkAIToggle` (via `ai_services`)
- Produces: `POST /api/feedback` body `{ sequence_id?, rating?, comment?, source? }` → `{ success, sentiment, issues }`
- Produces: `GET /api/feedback/pending` → `{ eligible: boolean, sequence_id?, package_name?, completed_at? }`
- Produces: `GET /api/feedback` (staff) → `[{ id, customer_name, rating, comment, sentiment_label, sentiment_score, issues, created_at }]`
- Produces: `GET /api/feedback/summary` (staff) → `{ counts: {Positive,Neutral,Negative}, total, top_issues: [{issue, count}] }`

- [ ] **Step 1: Write the router**

```javascript
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

// GET /api/feedback/pending — the customer's most recent closed visit that has
// no feedback yet. Server-driven so the dashboard never has to decide
// eligibility from a single active/inactive flag.
router.get('/pending', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT qs.id AS sequence_id, qs.package_name, qs.completed_at
               FROM queue_sequences qs
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
        res.json(rows.map(r => ({ ...r, issues: r.issues ? JSON.parse(r.issues) : [] })));
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
            for (const issue of JSON.parse(row.issues || '[]')) {
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
```

- [ ] **Step 2: Mount it** — in `server.js`, after the `/api/assistant` line (~245)

```javascript
const feedbackRoutes = require('./routes/feedback');
// ...
app.use('/api/feedback', authenticateToken, idleTimeout, feedbackRoutes);
```

- [ ] **Step 3: Smoke-test by hand**

Run: `npm run dev`. As a customer, `POST /api/feedback` with `{ "comment": "long wait, rude staff" }` and the auth header.
Expected: `{ "success": true, "sentiment": "Negative", "issues": ["Long wait times","Staff attitude"] }`.
Then `GET /api/feedback/pending` → `{ "eligible": false }` (no closed visit).

- [ ] **Step 4: Commit**

```bash
git add routes/feedback.js server.js
git commit -m "feat(feedback): submit, pending, list and summary routes"
```

---

### Task 5: Dashboard popup after a visit closes

**Files:**
- Modify: `public/customer.html` (add the modal markup near `#no-active-queue`, ~line 72)
- Modify: `public/customer.js` (`loadDashboard`, ~line 60; add helpers)

**Interfaces:**
- Consumes: `GET /api/feedback/pending`, `POST /api/feedback` (Task 4), `openModal`/`closeModal` (shared.js)

- [ ] **Step 1: Add the modal markup** (inside the dashboard section, after `#no-active-queue`)

```html
            <div id="feedback-modal" class="modal-overlay" style="display:none;">
                <div class="modal">
                    <div class="modal-header">
                        <div class="modal-title"><i class="fa-solid fa-comment-dots"></i> How was your visit?</div>
                        <button type="button" class="modal-close" onclick="closeModal('feedback-modal')">&times;</button>
                    </div>
                    <div style="padding:16px;">
                        <div id="feedback-stars" style="font-size:2em;text-align:center;margin-bottom:12px;">
                            <span data-star="1">&#9733;</span><span data-star="2">&#9733;</span><span data-star="3">&#9733;</span><span data-star="4">&#9733;</span><span data-star="5">&#9733;</span>
                        </div>
                        <textarea id="feedback-comment" class="form-input" rows="4"
                            placeholder="Tell us about your visit (optional)"></textarea>
                        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
                            <button type="button" class="btn btn-outline" onclick="closeModal('feedback-modal')">Not now</button>
                            <button type="button" class="btn btn-primary" id="feedback-submit-btn" onclick="submitFeedback()">Send</button>
                        </div>
                    </div>
                </div>
            </div>
```

- [ ] **Step 2: Add the logic** to `public/customer.js`

```javascript
// A closed visit offers one feedback prompt. `pendingFeedback` is set from the
// server, so a customer who has not had a visit today sees nothing.
let pendingFeedback = null;
let feedbackRating = 0;

async function checkPendingFeedback(wasActive) {
    if (!wasActive || pendingFeedback) return;      // only on the active -> closed edge
    try {
        const res = await fetch('/api/feedback/pending', { headers: authHeaders() });
        const data = await res.json();
        if (data.eligible) {
            pendingFeedback = data;
            feedbackRating = 0;
            setTimeout(() => openModal('feedback-modal'), 800);   // let the chime finish
        }
    } catch (e) { /* silent: the prompt is optional */ }
}

function initFeedbackStars() {
    const box = document.getElementById('feedback-stars');
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    box.querySelectorAll('[data-star]').forEach(star => {
        star.style.cursor = 'pointer';
        star.addEventListener('click', () => {
            feedbackRating = Number(star.dataset.star);
            box.querySelectorAll('[data-star]').forEach(s => {
                s.style.color = Number(s.dataset.star) <= feedbackRating ? 'var(--warning,#f59e0b)' : 'var(--text-muted)';
            });
        });
    });
}

async function submitFeedback() {
    const comment = document.getElementById('feedback-comment').value;
    const btn = document.getElementById('feedback-submit-btn');
    btn.disabled = true;
    try {
        const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ sequence_id: pendingFeedback?.sequence_id, rating: feedbackRating || null, comment })
        });
        if (!res.ok) throw new Error('failed');
        showToast('Thank you for your feedback!', 'success');
        pendingFeedback = null;
        closeModal('feedback-modal');
    } catch (e) {
        showToast('Could not send feedback right now', 'error');
    } finally {
        btn.disabled = false;
    }
}
window.submitFeedback = submitFeedback;
```

- [ ] **Step 3: Wire it into `loadDashboard`** — capture the edge. In `loadDashboard`, replace the two `return`-before-render spots so the previous active state is tracked:

```javascript
// At the top of loadDashboard, before the fetch:
const wasActive = lastQueueStatus === 'active';
// In the `if (!data.active)` branch, before `return`:
checkPendingFeedback(wasActive);
// And call initFeedbackStars() once, at the end of the function's success path.
initFeedbackStars();
```

> `lastQueueStatus` already exists (used for the on-hold transition) and is set to `'active'`/`'on-hold'` as the dashboard renders. Confirm it is `null` on a fresh customer with no visit, so the first render does not fire the prompt.

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`. Close a visit from the front desk while a customer dashboard is open.
Expected: within ~5 s (the refresh tick) the "How was your visit?" modal appears; Send with a comment writes a row in `feedback` and the modal closes; reopening the dashboard does not prompt again for the same visit.

- [ ] **Step 5: Commit**

```bash
git add public/customer.html public/customer.js
git commit -m "feat(feedback): prompt on the dashboard when a visit closes"
```

---

### Task 6: Virtual assistant feedback intent

**Files:**
- Modify: `ai_services.js` (`assistantCommandReply`, ~line 474)
- Modify: `public/va.js` (`executeVaAction`, ~line 1339)

**Interfaces:**
- Produces: action `{ type: 'open_feedback', package_name: '' }`
- Consumes: `checkPendingFeedback` / `openModal` on the client

- [ ] **Step 1: Add the intent** in `assistantCommandReply`, before the final `return null`

```javascript
  // Feedback is an installed flow, not a queue action. Detected here so the
  // model never has to guess, and so a complaint typed into the chat opens the
  // same card the dashboard uses rather than being filed silently.
  if (/\b(feedback|complaint|complain|suggestion|suggest|review|rate (?:my|the) (?:visit|service))\b/.test(text)) {
    return {
      reply: 'I can pass that on. Opening the feedback form for you now.',
      intent: 'feedback',
      action: { type: 'open_feedback', package_name: '' }
    };
  }
```

- [ ] **Step 2: Handle the action** in `public/va.js` `executeVaAction` switch

```javascript
        case 'open_feedback':
            if (typeof checkPendingFeedback === 'function') {
                // The dashboard may not be the active section; fetch pending
                // directly so the card has a sequence to attach.
                fetch('/api/feedback/pending', { headers: authHeaders() })
                    .then(r => r.json())
                    .then(d => { if (d.eligible) { pendingFeedback = d; openModal('feedback-modal'); } })
                    .catch(() => {});
            }
            break;
```

- [ ] **Step 3: Verify by hand**

Open the VA and type "I want to leave feedback".
Expected: the VA replies with the pass-on line and the feedback modal opens. With no eligible visit, the modal does not open and no error appears.

- [ ] **Step 4: Commit**

```bash
git add ai_services.js public/va.js
git commit -m "feat(feedback): virtual assistant can open the feedback form"
```

---

### Task 7: Staff feedback view + docs + gate the test

**Files:**
- Modify: `public/owner.js` or `public/admin-shared.js` (add a Feedback section)
- Modify: `public/owner.html` / `public/admin.html` (section markup + nav entry)
- Modify: `package.json` (add `node --check sentiment.js`, `node --check routes/feedback.js`, and `node verify_sentiment.js` to `scripts.test`)
- Modify: `HANDOVER.md`, `CLAUDE.md` (record the feature)

**Interfaces:**
- Consumes: `GET /api/feedback`, `GET /api/feedback/summary` (Task 4)

- [ ] **Step 1: Add the panel** (owner dashboard — the business-facing role)

A card with three sentiment counts and a table of the newest entries (rating stars, comment, sentiment badge, issue chips). Follow the existing `loadDashboard`/`owner.js` section pattern; render via `fetch('/api/feedback')` and `fetch('/api/feedback/summary')`.

```javascript
async function loadFeedback() {
    const [list, summary] = await Promise.all([
        fetch('/api/feedback', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/feedback/summary', { headers: authHeaders() }).then(r => r.json())
    ]);
    document.getElementById('fb-positive').textContent = summary.counts.Positive;
    document.getElementById('fb-neutral').textContent = summary.counts.Neutral;
    document.getElementById('fb-negative').textContent = summary.counts.Negative;
    document.getElementById('fb-issues').innerHTML = summary.top_issues
        .map(i => `<span class="badge badge-neutral">${escapeHtml(i.issue)} (${i.count})</span>`).join(' ');
    document.getElementById('fb-rows').innerHTML = list.map(f => `
        <tr>
            <td>${'★'.repeat(f.rating || 0)}${'☆'.repeat(5 - (f.rating || 0))}</td>
            <td>${escapeHtml(f.comment || '—')}</td>
            <td><span class="badge ${f.sentiment_label === 'Negative' ? 'badge-danger' : f.sentiment_label === 'Positive' ? 'badge-success' : 'badge-neutral'}">${f.sentiment_label}</span></td>
            <td>${new Date(f.created_at).toLocaleString()}</td>
        </tr>`).join('');
}
```

- [ ] **Step 2: Gate the test** — edit `package.json` `scripts.test`

Add `node --check sentiment.js && node --check routes/feedback.js &&` into the chain, and append `&& node verify_sentiment.js` before the final better-auth check.

- [ ] **Step 3: Run the full gate**

Run: `npm test`
Expected: all `node --check` pass, `verify_sentiment.js` reports `0 failed`, the other verify scripts still pass.

- [ ] **Step 4: Document**

In `CLAUDE.md`, add a short subsection under the AI section: VADER runs locally via `sentiment.js` (JS port, no Python/network); feedback is stored in `feedback`; sentiment is computed once at submit. In `HANDOVER.md`, add the `feedback` table and the `/api/feedback` routes.

- [ ] **Step 5: Commit**

```bash
git add public/owner.js public/owner.html package.json HANDOVER.md CLAUDE.md
git commit -m "feat(feedback): staff sentiment view, docs and test gate"
```

---

## Self-Review

- **Coverage:** capture (Tasks 4–6), analysis (Tasks 1,3), storage (Task 2), display (Task 7), both entry points the request named — dashboard popup and the VA. The `feedback_enabled` toggle already exists in `ai_settings`; wire `checkAIToggle('feedback')` into the submit route if the toggle must gate capture, and into the pending route if it must gate the prompt.
- **Placeholder scan:** no TBDs; each step shows code or an exact command.
- **Type consistency:** `analyzeSentiment` returns `{label, compound, scores, issues}` throughout; actions use `type: 'open_feedback'` in both `ai_services.js` and `public/va.js`.
- **Known limitation (documented, not hidden):** VADER is tuned for English social-media text. Taglish or short clinic phrasing will be approximate. This is the trigger to revisit a transformer model later — behind the same `feedbackAnalysis` seam.
