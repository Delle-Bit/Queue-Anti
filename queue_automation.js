const { pool } = require('./database.js');

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
    return base + category_weight + waiting_time;
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

module.exports = { calculateScore, getNextPatient, getNextFromList };
