# Service Time Estimation Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the customer-facing wait estimate accurate and honest: a recency-weighted average of recent service times, a whole-visit total that includes the backlog waiting at every downstream station, and a distinct "this station" figure — all recomputed live as the line moves.

**Architecture:** A pure module `eta.js` holds the math (`recencyWeight`, `weightedAverage`, `estimateVisit`) and one DB-backed lookup (`stationAverageMinutes`). `routes/queue.js` and `routes/packages.js` stop computing averages inline and call this module. The pure functions are unit-tested without a database; the lookup is tested with a stubbed pool, matching `verify_ai_chain.js` / `verify_payment_math.js`.

**Tech Stack:** Node >=20, CommonJS, MySQL (`mysql2`), existing `queue_logs` timing table. No new dependency.

**Spec:** No separate design doc. Driven by the 2026-11-07 analysis of `buildCustomerStatus` / `buildPackagePreview` and the thesis "Service Time Estimation" section.

## Global Constraints

- Node >=20, CommonJS. No new dependency.
- `npm test` must stay key-free, network-free and database-free — so the math is pure and the DB lookup is exercised against a stubbed pool.
- Keep the existing `getStationAverageMinutes` behaviour available until every caller is migrated; do not delete it in the same commit that adds its replacement.
- Timestamps use `serve_time` / `complete_time` in `queue_logs`; recency is measured from `complete_time`.
- The dashboard contract must not regress: `estimated_total_time` stays the number the dashboard shows; new fields are additive.
- One service at a time, one visit at a time — the route guards stay as they are; this plan changes arithmetic only.

---

### Task 1: `eta.js` pure math

**Files:**
- Create: `eta.js`
- Test: `verify_eta.js`

**Interfaces:**
- Produces: `recencyWeight(ageDays, halfLife?) -> number`
- Produces: `weightedAverage(samples: [{minutes, ageDays}], halfLife?) -> number|null`
- Produces: `estimateVisit(steps: [{avgMinutes, peopleAhead, servers?}]) -> { total, currentStation, perStep }`

- [ ] **Step 1: Write the failing test**

```javascript
// verify_eta.js — the wait-estimate arithmetic, asserted.
// Run by `npm test`, or on its own: node verify_eta.js
// No key, no network, no database (the lookup is tested against a stub).
const eta = require('./eta');

let passed = 0, failed = 0;
function check(label, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { passed++; console.log(`  ok   ${label}`); }
    else { failed++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

console.log('\n1. recency halves every half-life');
check('today weighs 1', eta.recencyWeight(0), 1);
check('7 days old weighs one half', eta.recencyWeight(7), 0.5);
check('14 days old weighs one quarter', eta.recencyWeight(14), 0.25);
check('a future timestamp is clamped to full weight', eta.recencyWeight(-3), 1);

console.log('\n2. the weighted average');
check('equal ages average plainly', Math.round(eta.weightedAverage([
    { minutes: 10, ageDays: 0 }, { minutes: 20, ageDays: 0 }])), 15);
check('a recent slow visit outranks an old fast one',
    eta.weightedAverage([{ minutes: 20, ageDays: 0 }, { minutes: 10, ageDays: 14 }]) > 15, true);
check('null minutes are ignored', eta.weightedAverage([
    { minutes: 10, ageDays: 0 }, { minutes: null, ageDays: 1 }]), 10);
check('an empty set has no average', eta.weightedAverage([]), null);

console.log('\n3. the whole-visit estimate');
check('alone at a 5-minute station: 5', eta.estimateVisit([
    { avgMinutes: 5, peopleAhead: 0 }]).total, 5);
check('two ahead at a 10-minute station: 30 (wait 20 + own 10)', eta.estimateVisit([
    { avgMinutes: 10, peopleAhead: 2 }]).total, 30);
const backlog = eta.estimateVisit([
    { avgMinutes: 5, peopleAhead: 0 },
    { avgMinutes: 10, peopleAhead: 3 }]);
check('a downstream backlog lengthens the total', backlog.total, 5 + (3 * 10 + 10));
check('the current station is reported separately', backlog.currentStation, 5);
check('two servers halve the queue wait, not the service',
    eta.estimateVisit([{ avgMinutes: 10, peopleAhead: 2, servers: 2 }]).total, 20);
check('a single station is clamped to the ceiling', eta.estimateVisit([
    { avgMinutes: 500, peopleAhead: 0 }]).total, 120);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node verify_eta.js`
Expected: FAIL — `Cannot find module './eta'`.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// eta.js — how long a patient still has to wait.
//
// This replaces the all-time flat average that used to sit inline in
// routes/queue.js. Three things were wrong with it: it averaged every visit
// ever (a slow Monday from months ago dragged today's number), it only counted
// the line at the *current* station (ten people already queued at the lab did
// not lengthen the patient's total), and it exposed one number where the
// dashboard wanted two ("this counter" vs "the whole visit").
//
// The math is pure so it can be tested without a database; only
// stationAverageMinutes touches MySQL.
const { pool } = require('./database');

const HALF_LIFE_DAYS = 7;      // a visit a week old counts half as much
const RECENT_WINDOW_DAYS = 14; // beyond this, only used if recent data is thin
const MIN_SAMPLES = 3;         // fewer recent visits than this -> fall back
const DEFAULT_MINUTES = 5;     // last resort, matches the old fallback
const MAX_STATION_MINUTES = 120; // a single station cannot plausibly exceed this

// Exponential decay: a sample `ageDays` old carries half the weight every
// HALF_LIFE_DAYS. Future timestamps (clock skew) are clamped to full weight.
function recencyWeight(ageDays, halfLife = HALF_LIFE_DAYS) {
    return Math.pow(0.5, Math.max(0, Number(ageDays) || 0) / halfLife);
}

// Weighted mean of { minutes, ageDays }. Non-positive or non-finite service
// times are dropped rather than skewing the mean toward zero.
function weightedAverage(samples, halfLife = HALF_LIFE_DAYS) {
    let num = 0, den = 0;
    for (const s of samples || []) {
        const minutes = Number(s.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) continue;
        const w = recencyWeight(s.ageDays, halfLife);
        num += minutes * w;
        den += w;
    }
    return den > 0 ? num / den : null;
}

function clampStation(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return Math.min(minutes, MAX_STATION_MINUTES);
}

/**
 * Per-station average service minutes.
 * Fallback chain: recent weighted average -> all-time weighted average ->
 * configured est_time_minutes -> DEFAULT_MINUTES. `now` is injectable so the
 * test is deterministic.
 */
async function stationAverageMinutes(stationType, stationId, estFallback, now = new Date()) {
    let where = "station_type=? AND complete_time IS NOT NULL AND serve_time IS NOT NULL AND archived=false";
    const params = [stationType];
    if (stationId) { where += ' AND station_id=?'; params.push(stationId); }

    const [rows] = await pool.query(
        `SELECT TIMESTAMPDIFF(SECOND, serve_time, complete_time) AS secs, complete_time
           FROM queue_logs WHERE ${where}`, params);
    const samples = rows.map(r => ({
        minutes: Number(r.secs) / 60,
        ageDays: (now.getTime() - new Date(r.complete_time).getTime()) / 86400000
    }));

    const recent = samples.filter(s => s.ageDays <= RECENT_WINDOW_DAYS);
    const recentAvg = recent.length >= MIN_SAMPLES ? weightedAverage(recent) : null;
    const chosen = clampStation(recentAvg)
        ?? clampStation(weightedAverage(samples))
        ?? clampStation(Number(estFallback))
        ?? DEFAULT_MINUTES;
    return Math.max(1, Math.ceil(chosen));
}

/**
 * Whole-visit estimate from the patient's remaining steps.
 * Each step: { avgMinutes, peopleAhead, servers? }.
 *   wait at a step = peopleAhead * avgMinutes / servers
 *   contribution   = wait + avgMinutes (their own service)
 * The first step is the one they are at now; `currentStation` is that step's
 * contribution, `total` is every remaining step summed.
 */
function estimateVisit(steps) {
    const perStep = [];
    let total = 0;
    for (const s of steps || []) {
        const avg = clampStation(Number(s.avgMinutes)) ?? DEFAULT_MINUTES;
        const servers = Math.max(1, Math.floor(Number(s.servers) || 1));
        const ahead = Math.max(0, Number(s.peopleAhead) || 0);
        const wait = (ahead * avg) / servers;
        const contribution = wait + avg;
        perStep.push({ waitMinutes: Math.round(wait), serviceMinutes: Math.round(avg), contribution });
        total += contribution;
    }
    return {
        total: Math.ceil(total),
        currentStation: perStep.length ? Math.ceil(perStep[0].contribution) : 0,
        perStep
    };
}

module.exports = {
    recencyWeight, weightedAverage, estimateVisit, stationAverageMinutes,
    HALF_LIFE_DAYS, RECENT_WINDOW_DAYS, MIN_SAMPLES, DEFAULT_MINUTES, MAX_STATION_MINUTES
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node verify_eta.js`
Expected: PASS, `0 failed`. (The DB function is not exercised yet — Task 2.)

- [ ] **Step 5: Commit**

```bash
git add eta.js verify_eta.js
git commit -m "feat(eta): recency-weighted, whole-visit wait estimate (pure math)"
```

---

### Task 2: Test the DB-backed lookup against a stub

**Files:**
- Modify: `verify_eta.js`

**Interfaces:**
- Consumes: `stationAverageMinutes(stationType, stationId, estFallback, now)` from Task 1

- [ ] **Step 1: Write the failing test** — insert before the summary line, stubbing the pool

```javascript
// eta.js requires ./database at load. Replace it with a stub whose `rows` the
// test controls, the same trick verify_payment_math.js uses.
const path = require('path');
const Module = require('module');
let cannedRows = [];
const dbPath = require.resolve(path.join(__dirname, 'database.js'));
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = { pool: { query: async () => [cannedRows, []] } };

const NOW = new Date('2026-11-07T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

console.log('\n4. the DB-backed average and its fallbacks');
(async () => {
    cannedRows = [];   // eta was already required above; re-require to pick up the stub
    delete require.cache[require.resolve('./eta')];
    const eta2 = require('./eta');

    cannedRows = [ { secs: 600, complete_time: daysAgo(1) }, { secs: 600, complete_time: daysAgo(2) }, { secs: 600, complete_time: daysAgo(3) } ];
    check('three recent 10-minute visits -> 10', await eta2.stationAverageMinutes('laboratory', 1, 30, NOW), 10);

    cannedRows = [ { secs: 600, complete_time: daysAgo(1) } ]; // thin recent data
    check('thin recent data falls back to the configured estimate',
        await eta2.stationAverageMinutes('laboratory', 1, 42, NOW), 42);

    cannedRows = [];
    check('no history at all uses the default of 5',
        await eta2.stationAverageMinutes('laboratory', 1, undefined, NOW), 5);

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
})();
```

> Move the existing `console.log(...passed...)`/`process.exit` lines into this async block; delete the synchronous copy so the summary prints once.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node verify_eta.js`
Expected: FAIL — the stubbed pool is not in effect yet (the module was required before the stub), so the lookup throws or returns the wrong value.

- [ ] **Step 3: Make it pass**

Ensure the stub is installed **before** `require('./eta')`, and that the module cache for `./eta` is cleared after stubbing `./database`, so `eta.js` binds to the stubbed pool. No production code changes should be needed; if the test still fails, the ordering of the stub vs. the require is the bug.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node verify_eta.js`
Expected: PASS, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add verify_eta.js
git commit -m "test(eta): cover the recency/fallback chain against a stubbed pool"
```

---

### Task 3: Use `eta` in the live customer status

**Files:**
- Modify: `routes/queue.js` (`buildCustomerStatus`, ~lines 1130–1233)
- Modify: `routes/queue.js` (`buildPackagePreview`, ~lines 163–192)

**Interfaces:**
- Consumes: `stationAverageMinutes`, `estimateVisit` (Task 1)
- Produces: `estimated_total_time` (whole visit), `estimated_current_station` (this station) on the `/api/queue/my-status` payload

- [ ] **Step 1: Add the require** at the top of `routes/queue.js`

```javascript
const etaEstimate = require('../eta');
```

- [ ] **Step 2: Replace the inline ETA loop** in `buildCustomerStatus` (the `for (let i = stepIndex; ...)` block)

```javascript
    // Estimate the whole remaining visit, not just this counter. Each downstream
    // station contributes its own backlog (people already waiting there) times
    // its recent average, so a queue at the lab lengthens the total even while
    // the patient is still at the front desk.
    const remainingSteps = [];
    for (let i = stepIndex; i < serviceSteps.length; i++) {
        const step = serviceSteps[i];
        const avg = await etaEstimate.stationAverageMinutes(step.type, step.station_id, step.est_time_minutes);
        let peopleAhead = position - 1;             // current station: everyone still ahead
        if (i > stepIndex) {
            const [wRows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM queue
                  WHERE station_type=? AND status='waiting' AND archived=false
                  ${step.station_id ? 'AND station_id=?' : ''}`,
                step.station_id ? [step.type, step.station_id] : [step.type]
            );
            peopleAhead = wRows[0].cnt;
        }
        remainingSteps.push({ avgMinutes: avg, peopleAhead, servers: 1 });
    }
    const visit = etaEstimate.estimateVisit(remainingSteps);
```

Then in the returned object set:

```javascript
        estimated_time: visit.total,
        estimated_total_time: visit.total,
        estimated_current_station: visit.currentStation,
```

> `position` is already computed above this loop (1-based, including whoever is being served), so `position - 1` is "people ahead".

- [ ] **Step 3: Replace `buildPackagePreview`'s loop** so the pre-join preview also counts downstream backlog

```javascript
    const previewSteps = [];
    for (let i = 0; i < steps.length; i++) {
        const avg = await etaEstimate.stationAverageMinutes(steps[i].type, steps[i].station_id, steps[i].est_time_minutes);
        let peopleAhead = i === 0 ? frontDeskWaiting[0].cnt : 0;
        if (i > 0) {
            const [wRows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM queue
                  WHERE station_type=? AND status='waiting' AND archived=false
                  ${steps[i].station_id ? 'AND station_id=?' : ''}`,
                steps[i].station_id ? [steps[i].type, steps[i].station_id] : [steps[i].type]
            );
            peopleAhead = wRows[0].cnt;
        }
        previewSteps.push({ avgMinutes: avg, peopleAhead, servers: 1 });
    }
    const visit = etaEstimate.estimateVisit(previewSteps);
    steps.forEach((s, i) => {
        s.est_minutes = previewSteps[i].avgMinutes;
        s.people_waiting = previewSteps[i].peopleAhead;
        // Cumulative ETA to *reach* each node, for the linear track labels.
        s.eta_minutes = Math.ceil(previewSteps.slice(0, i).reduce((sum, p) => sum + p.contribution, 0));
    });
    return {
        package: pkgs[0],
        ticket,
        current_processing: currentProcessing,
        estimated_total_time: visit.total,
        steps
    };
```

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`. Queue a second customer at the lab, then load a customer's dashboard.
Expected: `dash-eta` reflects the lab backlog; the per-node labels on the queue track increase downstream; nothing throws.

- [ ] **Step 5: Commit**

```bash
git add routes/queue.js
git commit -m "feat(eta): live status and preview use the whole-visit estimate"
```

---

### Task 4: Use `eta` in the packages routes

**Files:**
- Modify: `routes/packages.js` (`estimate-time` route ~line 295; the package ETA block ~lines 140–154)

**Interfaces:**
- Consumes: `stationAverageMinutes` (Task 1)

- [ ] **Step 1: Replace the fixed-input estimate** in `POST /estimate-time`

```javascript
const etaEstimate = require('../eta');
// ...
router.post('/estimate-time', authRequired, requireStaff, async (req, res) => {
    const { laboratories } = req.body;
    try {
        let totalEst = 0;
        const labsWithEst = [];
        for (const lab of (laboratories || [])) {
            const mins = await etaEstimate.stationAverageMinutes(
                'laboratory',
                lab.laboratory_id || lab.id || null,
                lab.est_time_minutes
            );
            totalEst += mins;
            labsWithEst.push({ ...lab, est_time_minutes: mins });
        }
        res.json({ total: Math.round(totalEst) || 15, laboratories: labsWithEst });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
```

- [ ] **Step 2: Replace the inline `AVG(...)` in the package ETA block** (the `fdAvg` / `labAvg` / `docAvg` queries) with calls to `stationAverageMinutes`, keeping the same shape:

```javascript
const fdAvg = await etaEstimate.stationAverageMinutes('frontdesk', null, 5);
let totalEta = (fdQueue[0].cnt + 1) * fdAvg;
for (const lab of labs) {
    const labAvg = await etaEstimate.stationAverageMinutes('laboratory', lab.laboratory_id, lab.est_time_minutes);
    totalEta += (labQueue[0].cnt + 1) * labAvg;
}
```

> Keep the loop structure identical; only the source of the average changes. This removes the today-only `CURDATE()` inconsistency between this file and `routes/queue.js` — both now share one recency policy.

- [ ] **Step 3: Verify by hand**

Call `POST /api/packages/estimate-time` with a `laboratories` array.
Expected: each `est_time_minutes` comes from the station's recent history, not a constant `11`.

- [ ] **Step 4: Commit**

```bash
git add routes/packages.js
git commit -m "feat(eta): packages estimate-time and preview share the recency policy"
```

---

### Task 5 (optional): parallel-server capacity

**Files:**
- Modify: `routes/queue.js` (the `servers: 1` fields from Task 3)

**Interfaces:**
- Consumes: `estimateVisit`'s `servers` field (Task 1)

- [ ] **Step 1: Count active stations of the same type** when a step is not pinned to one station

```javascript
// Two labs on shift clear their shared queue twice as fast. A step pinned to a
// specific doctor or lab has one server; a generic step divides by however many
// active stations of that type exist.
async function serverCountFor(type, stationId) {
    if (stationId) return 1;
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS n FROM laboratories WHERE archived=false AND service_type=?
         UNION ALL SELECT 1`, [type]
    );
    const n = rows[0]?.n;
    return Math.max(1, Number(n) || 1);
}
```

Set `servers: await serverCountFor(step.type, step.station_id)` in the `remainingSteps.push(...)` calls.

- [ ] **Step 2: Verify by hand**

With two labs active, the lab wait for a given backlog should be roughly half.
Expected: the estimate drops when a second lab is added, and returns when it is archived.

- [ ] **Step 3: Commit**

```bash
git add routes/queue.js
git commit -m "feat(eta): divide queue waits by active servers per station type"
```

---

### Task 6: Test gate and docs

**Files:**
- Modify: `package.json` (`scripts.test`)
- Modify: `HANDOVER.md`, `CLAUDE.md`

- [ ] **Step 1: Gate the test** — add `node --check eta.js &&` into the check chain and `&& node verify_eta.js` before the final better-auth check in `scripts.test`.

- [ ] **Step 2: Run the full gate**

Run: `npm test`
Expected: every `node --check` passes; `verify_eta.js` reports `0 failed`; the other verify scripts still pass.

- [ ] **Step 3: Document**

In `CLAUDE.md`, add a subsection: wait estimates come from `eta.js` — a 7-day half-life recency-weighted average over `queue_logs`, with downstream backlog included and a fallback chain (recent → all-time → configured → 5 min). Note the removed `getStationAverageMinutes` only after Task 3's callers are gone. In `HANDOVER.md`, note that `/api/queue/my-status` now returns `estimated_current_station` alongside `estimated_total_time`.

- [ ] **Step 4: Commit**

```bash
git add package.json HANDOVER.md CLAUDE.md
git commit -m "feat(eta): gate the estimate test, document the model"
```

---

## Self-Review

- **Coverage:** recency weighting (Task 1), fallback chain (Tasks 1–2), downstream backlog (Task 3), preview parity (Task 3), packages parity (Task 4), parallel capacity (Task 5, optional), gate + docs (Task 6). Matches the 2026-11-07 gap list: no recency filter / downstream ignored / `estimated_time` == `estimated_total_time` / no throughput model / no rounding policy.
- **Placeholder scan:** no TBDs; every step has code or an exact command.
- **Type consistency:** `estimateVisit` returns `{ total, currentStation, perStep }` everywhere; `stationAverageMinutes(stationType, stationId, estFallback, now)` keeps the same argument order in every call site.
- **Migration safety:** `getStationAverageMinutes` in `routes/queue.js` is left in place until Task 3 and Task 4 remove its last callers; delete it in a follow-up commit once grep shows no callers, so the change is reversible.
- **Paper alignment:** this replaces the inaccurate "scikit-learn linear regression" claim with something the code actually does (a recency-weighted moving average with queue-length inputs). Reword the thesis section to match.
