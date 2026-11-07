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
    delete require.cache[require.resolve('./eta')];
    const eta2 = require('./eta');

    cannedRows = [
        { secs: 600, complete_time: daysAgo(1) },
        { secs: 600, complete_time: daysAgo(2) },
        { secs: 600, complete_time: daysAgo(3) }
    ];
    check('three recent 10-minute visits -> 10', await eta2.stationAverageMinutes('laboratory', 1, 30, NOW), 10);

    // The fallback chain is recent -> all-time -> configured -> 5. One recent
    // sample is thin, but it is still real history, so it beats the configured
    // estimate; the configured value is the next rung, tested below.
    cannedRows = [{ secs: 600, complete_time: daysAgo(1) }];
    check('thin recent data falls back to the all-time average',
        await eta2.stationAverageMinutes('laboratory', 1, 42, NOW), 10);

    cannedRows = [];
    check('no history at all uses the configured estimate',
        await eta2.stationAverageMinutes('laboratory', 1, 42, NOW), 42);

    cannedRows = [];
    check('no history and no configured estimate uses the default of 5',
        await eta2.stationAverageMinutes('laboratory', 1, undefined, NOW), 5);

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
})();

