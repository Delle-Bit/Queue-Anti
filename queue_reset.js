// ── DAILY QUEUE RESET ───────────────────────────────────────────────────────
// The clinic is a same-day operation: a ticket is minted for today, served
// today, and the line starts empty again at 23:59 Asia/Manila. Ticket numbers
// already reset through ticket_counters.counter_date = CURDATE(); the live
// queue did not, so yesterday's waiting/serving/on-hold rows stayed in today's
// station lists and yesterday's in-progress visits kept blocking a new visit.
//
// Two conditions are used together, both evaluated by the database clock:
//
//   TIME(NOW()) >= '23:59:00'   the scheduled end-of-day tick
//   DATE(timestamp) < CURDATE() a process that was asleep, redeploying or
//                               down at the boundary still converges when it
//                               comes back
//
// Using NOW()/CURDATE() rather than Node's Date is deliberate: every other
// day boundary in the system (ticket numbering, walk-in filters, analytics)
// reads the same database clock. A reset that used the container's timezone
// would disagree with them the moment TZ and the database timezone differ.
const { pool } = require('./database.js');

const DAILY_RESET_TIME = '23:59:00';
const DAILY_RESET_REASON = 'Queue reset at end of day';
const RESET_INTERVAL_MS = 30 * 1000;

// Guards against two ticks overlapping - the interval and a manual call can
// fire together, and both would try to close the same rows.
let resetInFlight = null;

// Stale announcements are never archived (staff still need the history), so
// the count stays above zero for the rest of the day. Remember the last count
// we told clients about and only re-emit when it changes - otherwise every
// 30-second tick would make every open customer page refetch the banner.
let lastStaleAnnouncementCount = null;

async function resetDailyQueue(io) {
    if (resetInFlight) return resetInFlight;

    resetInFlight = (async () => {
        let closedQueue = 0;
        let closedSequences = 0;
        let staleAnnouncements = 0;

        try {
            // Close every live station row left over from the previous day, or
            // still open when the 23:59 tick fires. Completed/cancelled rows are
            // untouched; they are history, and every working list already
            // filters on status.
            const [queueResult] = await pool.query(
                `UPDATE queue
                    SET status = 'cancelled'
                  WHERE status IN ('waiting', 'serving', 'on-hold')
                    AND (DATE(timestamp) < CURDATE() OR TIME(NOW()) >= ?)`,
                [DAILY_RESET_TIME]
            );
            closedQueue = queueResult.affectedRows || 0;

            // A visit is the thing that blocks a new start-package request
            // (`status = 'in_progress'`). Closing only the queue rows would
            // leave the patient unable to join again, so the sequence is closed
            // as unfinished with a reason that is visible in the record.
            const [sequenceResult] = await pool.query(
                `UPDATE queue_sequences
                    SET status = 'unfinished',
                        outcome = 'unfinished',
                        outcome_reason = ?,
                        finalized_at = NOW(),
                        completed_at = NOW()
                  WHERE status = 'in_progress'
                    AND archived = false
                    AND (DATE(started_at) < CURDATE() OR TIME(NOW()) >= ?)`,
                [DAILY_RESET_REASON, DAILY_RESET_TIME]
            );
            closedSequences = sequenceResult.affectedRows || 0;

            // Announcements are a same-day message. The active endpoint also
            // filters on CURDATE(), but counting the stale rows here lets the
            // socket tell an open customer page to drop yesterday's banner at
            // the boundary instead of waiting for the next reload.
            const [staleRows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM announcements
                  WHERE archived = false AND DATE(timestamp) < CURDATE()`
            );
            staleAnnouncements = Number(staleRows[0]?.cnt || 0);

            if (io) {
                if (closedQueue > 0 || closedSequences > 0) {
                    io.emit('queueUpdate', {});
                }
                if (staleAnnouncements > 0 && staleAnnouncements !== lastStaleAnnouncementCount) {
                    io.emit('announcementUpdate', {});
                }
            }
            lastStaleAnnouncementCount = staleAnnouncements;

            if (closedQueue > 0 || closedSequences > 0) {
                console.log(`[Queue] End-of-day reset: ${closedQueue} live row(s), ${closedSequences} visit(s) closed.`);
            }
            return { closedQueue, closedSequences, staleAnnouncements };
        } catch (err) {
            console.error('[Queue] End-of-day reset failed:', err.message);
            return { closedQueue, closedSequences, staleAnnouncements, error: err.message };
        } finally {
            resetInFlight = null;
        }
    })();

    return resetInFlight;
}

// Called once at boot, then every 30 seconds. The first call is what cleans up
// a queue left behind by a deploy or a process that was not running at 23:59;
// the interval is what keeps the boundary honest without relying on a cron
// service the deployment does not have.
function startDailyQueueReset(io, intervalMs = RESET_INTERVAL_MS) {
    resetDailyQueue(io);
    const timer = setInterval(() => resetDailyQueue(io), intervalMs);
    // Do not hold the process open on shutdown just for the reset.
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = {
    DAILY_RESET_TIME,
    DAILY_RESET_REASON,
    resetDailyQueue,
    startDailyQueueReset
};
