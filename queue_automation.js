const { pool } = require('./database.js');

// ── SERVICE STEP COMPOSITION ────────────────────────────────────────────────
// Every service route both starts and ends at the front desk, and neither
// bookend is stored in package_laboratories - they are added here, which makes
// this the single definition of the visit shape for the queue engine, the
// service catalogue and the admin editor alike.
//
// Step 0 is the cashier: a patient is verified and pays before any laboratory or
// doctor step exists for them. The closing step is the gatekeeper: the front
// desk is the only station allowed to declare a visit officially Completed or
// Unfinished, so every route has to come back past it.
const FRONT_DESK_STEP = Object.freeze({
    name: 'Front Desk',
    type: 'frontdesk',
    station_id: null,
    est_time_minutes: 5,
    role: 'cashier'
});

const FRONT_DESK_FINAL_STEP = Object.freeze({
    name: 'Front Desk — Finalization',
    type: 'frontdesk',
    station_id: null,
    est_time_minutes: 3,
    role: 'finalization',
    is_final: true
});

// labs: package_laboratories rows joined to laboratories, in sequence_order.
// doctor: { id, name } or null.
function composeServiceSteps(labs, doctor) {
    const steps = [{ ...FRONT_DESK_STEP }];
    (labs || []).forEach(lab => steps.push({
        name: lab.lab_name || lab.name,
        type: 'laboratory',
        station_id: lab.laboratory_id,
        est_time_minutes: lab.est_time_minutes || 10
    }));
    if (doctor && doctor.id) steps.push({
        name: doctor.name || 'Doctor',
        type: 'doctor',
        station_id: doctor.id,
        est_time_minutes: 15
    });
    steps.push({ ...FRONT_DESK_FINAL_STEP });
    return steps;
}

// The front desk bookends are always present, so "does this package actually do
// anything?" is a question about what sits between them - never about the total
// length, which is 2 even for an empty package.
function serviceStationCount(steps) {
    return (steps || []).filter(s => s.type !== 'frontdesk').length;
}

function hasServiceStations(steps) {
    return serviceStationCount(steps) > 0;
}

// Head start given to a patient who booked an appointment, applied through
// priority_boost. Waiting time scores 1 point per minute, so this is worth
// "arrived 30 minutes earlier" - enough to put a booking ahead of walk-ins,
// while staying below the Senior/PWD/Pregnant weights below so the legally
// mandated priority categories still come first.
const APPOINTMENT_PRIORITY_BOOST = 30;

// Where a re-inserted patient lands in the waiting list at the moment they are
// re-inserted. Slot 2 means one ordinary patient is called before them, giving
// the order the front desk expects: whoever is being served now, then the next
// regular patient, then the patient who was re-inserted.
//
// The slot is only used to pick the neighbour to anchor behind (see
// resolveReinsertAnchor in routes/queue.js); the anchor is what actually holds
// the position afterwards.
const REINSERT_SLOT = 2;

async function calculateScore(patient) {
    let base = 10;
    let category_weight = 0;
    // S=Senior, D=PWD, P=Pregnant, Q=Regular
    if (patient.type === 'S') category_weight = 50;
    else if (patient.type === 'D') category_weight = 45;
    else if (patient.type === 'P') category_weight = 40;

    let waiting_time = 0;
    if (patient.timestamp) {
        waiting_time = Math.floor((new Date() - new Date(patient.timestamp)) / 60000);
    }
    return base + category_weight + waiting_time + (patient.priority_boost || 0);
}

// A station's waiting list in the exact order it will be called.
//
// Priority scoring decides the order of ordinary rows. A re-inserted row is
// lifted out of the scoring entirely and placed immediately behind one specific
// neighbour - the row named by its reinsert_after - which is how the front desk
// puts a returning patient behind exactly one other person rather than at the
// head of the line (what a large priority_boost would do) or at the tail (what
// re-joining would do).
//
// Anchored to a neighbour, not to a rank. Storing "you are second" instead
// re-applied itself every time the list was rebuilt: as the patients ahead were
// called, the re-inserted patient was pushed back to second again and their turn
// never actually arrived. Anchoring means that once the patient they were placed
// behind leaves the list, they are simply next.
async function orderWaitingList(queueRows) {
    const reinserted = [];
    const list = [];
    for (const row of (queueRows || [])) {
        if (row.reinsert_slot != null || row.reinsert_after != null) reinserted.push(row);
        else list.push(row);
    }

    for (const p of list) p.score = await calculateScore(p);
    list.sort((a, b) => b.score - a.score);

    // Oldest re-insertion first, so the list is stable across refreshes and two
    // patients placed behind the same neighbour keep the order they were placed
    // in rather than the later one cutting ahead of the earlier.
    reinserted.sort((a, b) =>
        new Date(a.reinserted_at || a.timestamp) - new Date(b.reinserted_at || b.timestamp));

    for (const row of reinserted) {
        row.score = await calculateScore(row);
        // Spliced into the list as it grows, so an anchor that is itself a
        // re-inserted row resolves correctly. No anchor - or an anchor that has
        // already been called - means this row is next.
        const anchorIdx = row.reinsert_after
            ? list.findIndex(r => String(r.id) === String(row.reinsert_after))
            : -1;
        list.splice(anchorIdx + 1, 0, row);
    }
    return list;
}

async function getNextFromList(queueRows) {
    if (!queueRows || queueRows.length === 0) return null;
    const ordered = await orderWaitingList(queueRows);
    return ordered[0] || null;
}

async function getNextPatient(stationType, stationId) {
    let query = `SELECT * FROM queue WHERE station_type=? AND status='waiting'`;
    const params = [stationType];
    if (stationId) { query += ' AND station_id=?'; params.push(stationId); }
    query += ' ORDER BY timestamp ASC';
    const [rows] = await pool.query(query, params);
    return getNextFromList(rows);
}

// Atomic per-day-per-station ticket numbering (prevents duplicate tickets under concurrency)
async function nextTicketNumber(stationType, stationId, type) {
    const sid = stationId || 0;
    await pool.query(
        `INSERT INTO ticket_counters (counter_date, station_type, station_id, count)
         VALUES (CURDATE(), ?, ?, 1)
         ON DUPLICATE KEY UPDATE count = count + 1`,
        [stationType, sid]
    );
    const [rows] = await pool.query(
        `SELECT count FROM ticket_counters
         WHERE counter_date = CURDATE() AND station_type = ? AND station_id = ?`,
        [stationType, sid]
    );
    return `${type}-${String(rows[0].count).padStart(3, '0')}`;
}

// Non-incrementing lookahead (for previews)
async function peekTicketNumber(stationType, stationId, type) {
    const sid = stationId || 0;
    const [rows] = await pool.query(
        `SELECT count FROM ticket_counters
         WHERE counter_date = CURDATE() AND station_type = ? AND station_id = ?`,
        [stationType, sid]
    );
    const next = (rows[0]?.count || 0) + 1;
    return `${type}-${String(next).padStart(3, '0')}`;
}

module.exports = {
    calculateScore, getNextPatient, getNextFromList, orderWaitingList,
    nextTicketNumber, peekTicketNumber,
    FRONT_DESK_STEP, FRONT_DESK_FINAL_STEP, composeServiceSteps,
    serviceStationCount, hasServiceStations,
    APPOINTMENT_PRIORITY_BOOST, REINSERT_SLOT
};
