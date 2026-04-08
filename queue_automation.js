const { pool } = require('./database.js');

async function calculateScore(patient) {
    // Formula: score = base + category_weight + waiting_time + appointment_weight
    let base = 10;
    let category_weight = 0;
    
    // Priorities based on user specific rules (E = Elderly, P = PWD, Q = Regular)
    if (patient.type === 'E') category_weight = 50; 
    if (patient.type === 'P') category_weight = 40;
    if (patient.type === 'A') category_weight = 30; // Appointment
    
    // Waiting time weight (1 point per minute)
    let waiting_time = 0;
    if (patient.timestamp) {
        const diffMs = new Date() - new Date(patient.timestamp);
        waiting_time = Math.floor(diffMs / 60000);
    }
    
    let appointment_weight = patient.type === 'A' ? 20 : 0;
    
    return base + category_weight + waiting_time + appointment_weight;
}

async function getNextPatient(departmentId) {
    const [queueRows] = await pool.query(
        `SELECT * FROM queue WHERE department_id = ? AND status = 'waiting' ORDER BY timestamp ASC`, 
        [departmentId]
    );

    if (queueRows.length === 0) return null;

    // Calculate scores for all waiting patients
    for (let patient of queueRows) {
        patient.score = await calculateScore(patient);
    }

    // Sort by highest score first
    queueRows.sort((a, b) => b.score - a.score);
    
    return queueRows[0]; // the one with highest score
}

module.exports = {
    getNextPatient,
    calculateScore
};
