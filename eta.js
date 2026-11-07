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
