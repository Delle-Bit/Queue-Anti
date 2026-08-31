const { pool } = require('./database.js');

// ── MISSED APPOINTMENT SWEEP ────────────────────────────────────────────────
// A booked slot that nobody checked in for used to sit in the staff and admin
// appointment lists forever, indistinguishable from an upcoming one. This marks
// it 'no-show' ("Did Not Arrive") and archives it, which drops it out of every
// working list - both lists filter on archived = false - while the snapshot in
// archived_records keeps it restorable from the owner's Archive view.
//
// Only 'scheduled' rows are swept. 'checked-in' means the patient arrived, and
// 'completed'/'cancelled' are already terminal.

// Grace period after the slot before it counts as a no-show. Booking slots are
// an hour apart, so an hour means a patient who is merely late is never marked
// absent while their slot is still the current one.
const NO_SHOW_GRACE_MINUTES = 60;

// Guards against two sweeps overlapping - the interval and a list request can
// fire at the same moment, and both would try to archive the same rows.
let sweepInFlight = null;

async function findMissedAppointments(graceMinutes) {
    // Comparison is done in SQL so it uses the same clock as NOW()/CURDATE()
    // everywhere else, rather than mixing in Node's timezone handling.
    const [rows] = await pool.query(
        `SELECT id, customer_id, package_id, appointment_date, appointment_time
         FROM appointments
         WHERE status = 'scheduled'
           AND archived = false
           AND TIMESTAMP(appointment_date, appointment_time) < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
        [graceMinutes]
    );
    return rows;
}

async function sweepMissedAppointments(options = {}) {
    const graceMinutes = Number.isFinite(options.graceMinutes)
        ? options.graceMinutes
        : NO_SHOW_GRACE_MINUTES;

    if (sweepInFlight) return sweepInFlight;

    sweepInFlight = (async () => {
        try {
            const missed = await findMissedAppointments(graceMinutes);
            if (missed.length === 0) return { swept: 0, ids: [] };

            const ids = [];
            for (const appt of missed) {
                try {
                    // Snapshot the row as it stands before the status changes, so
                    // the archive shows what was actually booked.
                    const [full] = await pool.query('SELECT * FROM appointments WHERE id = ?', [appt.id]);
                    if (full.length === 0) continue;

                    await pool.query(
                        `UPDATE appointments
                         SET status = 'no-show', no_show_at = NOW(), archived = true, archived_at = NOW()
                         WHERE id = ? AND status = 'scheduled' AND archived = false`,
                        [appt.id]
                    );

                    await pool.query(
                        `INSERT INTO archived_records (entity_type, entity_id, snapshot, archived_by)
                         VALUES ('appointment', ?, ?, NULL)`,
                        [String(appt.id), JSON.stringify(full[0])]
                    );
                    await pool.query(
                        `INSERT INTO audit_logs (action, entity_type, entity_id, details, performed_by)
                         VALUES ('archive', 'appointment', ?, ?, NULL)`,
                        [appt.id, JSON.stringify({
                            reason: 'no-show',
                            note: 'Did not arrive',
                            grace_minutes: graceMinutes,
                            swept_by: 'system'
                        })]
                    );
                    ids.push(appt.id);
                } catch (err) {
                    // One bad row must not abandon the rest of the sweep.
                    console.error(`[Appointments] Failed to archive missed appointment #${appt.id}:`, err.message);
                }
            }

            if (ids.length > 0) {
                console.log(`[Appointments] Marked ${ids.length} missed appointment(s) as Did Not Arrive: #${ids.join(', #')}`);
            }
            return { swept: ids.length, ids };
        } catch (err) {
            console.error('[Appointments] Missed-appointment sweep failed:', err.message);
            return { swept: 0, ids: [], error: err.message };
        } finally {
            sweepInFlight = null;
        }
    })();

    return sweepInFlight;
}

// Called from the appointment list endpoints so a list is never served with a
// stale row in it, even if the interval below has not fired yet. Failures are
// swallowed: a list request must still succeed if the sweep cannot run.
async function sweepQuietly() {
    try { return await sweepMissedAppointments(); }
    catch (e) { return { swept: 0, ids: [] }; }
}

function startMissedAppointmentSweep(intervalMinutes = 15) {
    sweepQuietly();
    const timer = setInterval(sweepQuietly, intervalMinutes * 60 * 1000);
    // Don't hold the process open on shutdown just for the sweep.
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = {
    NO_SHOW_GRACE_MINUTES,
    findMissedAppointments,
    sweepMissedAppointments,
    sweepQuietly,
    startMissedAppointmentSweep
};
