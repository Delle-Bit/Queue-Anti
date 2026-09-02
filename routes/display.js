// ── PUBLIC QUEUE DISPLAY ────────────────────────────────────────────────────
// Feeds the lobby board (public/display.html), which runs on a wall-mounted
// screen with nobody signed in to it. That makes this the only queue endpoint
// in the system without an authenticated caller behind it, and the reason it is
// a separate router rather than another route on /api/queue.
//
// It therefore answers with ticket numbers and station names only. No patient
// names, no categories, no service names, no ids - a ticket prefix already
// tells the room that S-014 is a senior citizen, which is unavoidable and is
// how the numbering works, but nothing here should let a stranger in the
// waiting room learn who is being seen or what for.
const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const queueAutomation = require('../queue_automation');

// How many tickets deep the board lists per station. A lobby screen is read
// from across the room, so the list is short by design.
const UPCOMING_LIMIT = 4;

router.get('/', async (req, res) => {
    try {
        const [settings] = await pool.query('SELECT site_name FROM settings WHERE id=1');
        const [labs] = await pool.query(
            `SELECT id, name FROM laboratories WHERE archived = false AND is_open = true ORDER BY name`
        );
        const [doctors] = await pool.query(
            `SELECT id, name FROM doctors WHERE archived = false AND is_open = true ORDER BY name`
        );

        // Every live row in one query, then grouped in memory - a station with
        // nothing waiting still gets a panel on the board, so the room can see
        // that the counter exists and is simply idle.
        const [rows] = await pool.query(
            `SELECT id, number, type, status, station_type, station_id, timestamp,
                    reinsert_slot, reinsert_after, reinserted_at, priority_boost
             FROM queue
             WHERE status IN ('waiting','serving') AND archived = false
             ORDER BY timestamp ASC`
        );

        const stations = [
            { key: 'frontdesk', type: 'frontdesk', id: null, name: 'Front Desk' },
            ...labs.map(l => ({ key: `laboratory:${l.id}`, type: 'laboratory', id: l.id, name: l.name })),
            ...doctors.map(d => ({ key: `doctor:${d.id}`, type: 'doctor', id: d.id, name: d.name }))
        ];

        for (const station of stations) {
            const mine = rows.filter(r =>
                r.station_type === station.type &&
                (station.id == null ? r.station_id == null : Number(r.station_id) === Number(station.id)));

            const serving = mine.find(r => r.status === 'serving') || null;
            // Ordered by the same function the stations call from, so the board
            // is not just "who is waiting" but the order they will be called -
            // including a patient the front desk re-inserted, who is otherwise
            // lifted out of priority scoring entirely.
            const waiting = await queueAutomation.orderWaitingList(mine.filter(r => r.status === 'waiting'));

            station.now_serving = serving ? serving.number : null;
            station.serving_since = serving ? serving.timestamp : null;
            station.waiting_count = waiting.length;
            station.upcoming = waiting.slice(0, UPCOMING_LIMIT).map(r => r.number);
        }

        res.json({
            clinic_name: (settings[0] && settings[0].site_name) || 'Medical Clinic',
            generated_at: new Date().toISOString(),
            stations
        });
    } catch (err) {
        console.error('Public display error:', err);
        res.status(500).json({ error: 'Failed to load the queue display.' });
    }
});

module.exports = router;
