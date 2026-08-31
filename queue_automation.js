const { pool } = require('./database.js');

// ── SERVICE STEP COMPOSITION ────────────────────────────────────────────────
// The front desk is the cashier: every service starts there, and a patient is
// verified and pays before any laboratory or doctor step exists for them. It is
// therefore never stored in package_laboratories - it is prepended here, which
// makes this the single definition of "step 0" for the queue engine, the service
// catalogue and the admin editor alike.
const FRONT_DESK_STEP = Object.freeze({
    name: 'Front Desk',
    type: 'frontdesk',
    station_id: null,
    est_time_minutes: 5
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
    return steps;
}

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

async function getNextFromList(queueRows) {
    if (queueRows.length === 0) return null;
    for (let p of queueRows) { p.score = await calculateScore(p); }
    queueRows.sort((a, b) => b.score - a.score);
    return queueRows[0];
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
    calculateScore, getNextPatient, getNextFromList, nextTicketNumber, peekTicketNumber,
    FRONT_DESK_STEP, composeServiceSteps
};
