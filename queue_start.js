// ── STARTING A VISIT ────────────────────────────────────────────────────────
// One place where a visit enters the queue, whichever door the patient came
// through: a customer joining from their own phone, an appointment being
// checked in, or the front desk booking in a phone-less walk-in at the counter.
//
// This exists because there were already two copies of the same six statements
// (routes/queue.js POST /start-package and server.js startQueueFromAppointment)
// and they had already drifted once - the appointment copy re-derived the step
// count by hand and was left one step short the moment the closing front desk
// step was added. A third copy for walk-ins would have drifted the same way,
// and "synchronises with the central active queue sequence" is precisely the
// requirement that a walk-in must not be a separate mechanism.
//
// What a visit consists of, in order:
//   queue_sequences  - the visit itself, and where it has got to (current_step)
//   queue            - one row per step, but only the step they are at now
//   queue_logs       - the timing record, opened per station and closed on exit
const { pool } = require('./database');
const queueAutomation = require('./queue_automation');

// S=Senior, D=PWD, P=Pregnant, Q=Regular. The letter is the ticket prefix and
// the priority weight is derived from it in calculateScore.
function queueTypeForCategory(category) {
    if (category === 'Senior') return 'S';
    if (category === 'PWD') return 'D';
    if (category === 'Pregnant') return 'P';
    return 'Q';
}

// The step list for a package, front desk bookends included. This is the
// routing table for the whole visit: a queue row's step_index indexes straight
// into it, so it has to be built the same way for every caller.
async function getPackageSteps(packageId) {
    const [labs] = await pool.query(
        `SELECT pl.*, l.name as lab_name, l.service_type
         FROM package_laboratories pl
         JOIN laboratories l ON pl.laboratory_id = l.id
         WHERE pl.package_id = ? AND pl.archived=false AND l.archived=false
         ORDER BY pl.sequence_order`,
        [packageId]
    );
    const [pkgDoctor] = await pool.query(
        `SELECT sp.doctor_id, d.name as doctor_name
         FROM service_packages sp
         JOIN doctors d ON sp.doctor_id = d.id
         WHERE sp.id = ? AND sp.doctor_id IS NOT NULL AND d.archived = false`,
        [packageId]
    );
    return queueAutomation.composeServiceSteps(
        labs,
        pkgDoctor.length > 0 ? { id: pkgDoctor[0].doctor_id, name: pkgDoctor[0].doctor_name } : null
    );
}

// Puts a patient at the head of their route: step 0, the front desk cashier.
//
// Returns one of three shapes, so callers can answer with their own wording:
//   { alreadyActive: true }  the patient is already mid-visit
//   { unavailable: true }    the package has no stations between the bookends
//   { ticket, sequence_id, queue_id, steps, package }
//
// `rowId` exists only because the appointment path has always named its step-0
// row `appt_<id>_<seq>` while the customer path names it `cust_<id>_<seq>`. It
// may be a string or a function of the new sequence id. The shape is free: from
// step 1 onwards /complete-step derives every row id from stepRowId(), so only
// this first row carries the caller's naming.
async function startPackageQueue({
    customerId,
    packageId,
    category = 'Regular',
    intakeChannel = 'online',
    appointmentId = null,
    priorityBoost = 0,
    rowId = null,
    // What the desk will actually collect. An appointment adds a surcharge on
    // top of the package price, so the caller may override it.
    logPrice = null
}) {
    const [existing] = await pool.query(
        `SELECT id FROM queue_sequences WHERE customer_id = ? AND status = 'in_progress' AND archived = false`,
        [customerId]
    );
    if (existing.length > 0) return { alreadyActive: true, sequence_id: existing[0].id };

    const [pkgs] = await pool.query(
        'SELECT * FROM service_packages WHERE id = ? AND archived = false',
        [packageId]
    );
    if (pkgs.length === 0) return { notFound: true };
    const pkg = pkgs[0];

    const steps = await getPackageSteps(packageId);
    // Every route is front-desk-to-front-desk, so the length is 2 even for an
    // empty package - ask what sits between the bookends instead.
    if (!queueAutomation.hasServiceStations(steps)) return { unavailable: true };

    const doctorStep = steps.find(step => step.type === 'doctor');
    const type = queueTypeForCategory(category);

    const [seqResult] = await pool.query(
        `INSERT INTO queue_sequences
            (customer_id, package_id, current_step, total_steps, has_doctor_step, doctor_id,
             appointment_id, priority_boost, intake_channel)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [customerId, packageId, steps.length, doctorStep ? 1 : 0,
         doctorStep ? doctorStep.station_id : null, appointmentId, priorityBoost, intakeChannel]
    );
    const sequenceId = seqResult.insertId;

    // Minted once, at the front desk, and carried for the whole visit.
    const ticket = await queueAutomation.nextTicketNumber('frontdesk', null, type);
    const queueId = typeof rowId === 'function'
        ? rowId(sequenceId)
        : (rowId || `cust_${customerId}_${sequenceId}`);

    await pool.query(
        `INSERT INTO queue (id, station_type, station_id, number, type, status, customer_id, sequence_id, step_index, priority_boost)
         VALUES (?, 'frontdesk', NULL, ?, ?, 'waiting', ?, ?, 0, ?)`,
        [queueId, ticket, type, customerId, sequenceId, priorityBoost]
    );
    await pool.query(
        `INSERT INTO queue_logs (station_type, station_id, ticket_number, type, customer_id, sequence_id, package_name, price, join_time)
         VALUES ('frontdesk', NULL, ?, ?, ?, ?, ?, ?, NOW())`,
        [ticket, type, customerId, sequenceId, pkg.name,
         logPrice != null ? logPrice : pkg.price]
    );

    return { ticket, sequence_id: sequenceId, queue_id: queueId, steps, package: pkg };
}

module.exports = { startPackageQueue, getPackageSteps, queueTypeForCategory };
