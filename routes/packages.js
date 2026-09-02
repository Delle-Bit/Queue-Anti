const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, requireStaff, STAFF_ROLES } = require('../config');
const { composeServiceSteps } = require('../queue_automation');
const { APPOINTMENT_SURCHARGE_PCT, appointmentPrice } = require('../appointment_automation');
const { recordAudit, requireReason, snapshotRow } = require('../audit');
const { archiveRecord } = require('../archive');

const DEFAULT_CATEGORY = 'General';

// A result form id, or null. Checked against the table rather than trusted: a
// service pointing at a form that does not exist would open the laboratory
// workspace on nothing.
async function resolveTestStructureId(value) {
    if (value === undefined || value === null || value === '') return null;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return null;
    const [rows] = await pool.query(
        'SELECT id FROM test_structures WHERE id = ? AND archived = false LIMIT 1', [id]);
    return rows.length > 0 ? id : null;
}

function normalizeCategory(value) {
    const category = String(value == null ? '' : value).trim().slice(0, 60);
    return category || DEFAULT_CATEGORY;
}

// True when the caller presents a valid staff token. Used for read options
// that only make sense in a management screen; this endpoint is public, so it
// asks rather than requires.
function isStaffRequest(req) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return false;
    try { return STAFF_ROLES.includes(jwt.verify(token, JWT_SECRET).role); }
    catch (e) { return false; }
}

function authRequired(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch (e) { res.status(403).json({ error: 'Invalid token' }); }
}

// GET all packages with lab details
// Optional ?q= (matches service ID, name, description or category) and
// ?category= narrow the catalogue server-side, so the customer's Services search
// works the same whether there are 18 packages or 1,800.
router.get('/', async (req, res) => {
    try {
        const params = [];
        // A deactivated service is hidden from the customer's catalogue but has
        // to stay visible in Service Management - otherwise the row an
        // administrator just switched off disappears from the only screen that
        // could switch it back on, and the ID column skips a number with no
        // explanation. Staff-only: the flag is ignored without a staff token.
        const includeInactive = (req.query.include_inactive === '1' || req.query.include_inactive === 'true')
            && isStaffRequest(req);
        const filters = ['sp.archived = false'];
        if (!includeInactive) filters.push('sp.is_active = true');
        const term = String(req.query.q || '').trim();
        if (term) {
            filters.push('(CAST(sp.id AS CHAR) LIKE ? OR sp.name LIKE ? OR sp.description LIKE ? OR sp.category LIKE ?)');
            const like = `%${term}%`;
            params.push(like, like, like, like);
        }
        if (req.query.category) { filters.push('sp.category = ?'); params.push(req.query.category); }

        const [packages] = await pool.query(`
            SELECT sp.*, d.name as doctor_name, d.specialty as doctor_specialty
            FROM service_packages sp
            LEFT JOIN doctors d ON sp.doctor_id = d.id AND d.archived = false
            WHERE ${filters.join(' AND ')}
            ORDER BY sp.category, sp.name
        `, params);
        for (let pkg of packages) {
            const [labs] = await pool.query(
                `SELECT pl.*, l.name as lab_name, l.service_type
                 FROM package_laboratories pl
                 JOIN laboratories l ON pl.laboratory_id = l.id
                 WHERE pl.package_id = ? AND pl.archived = false AND l.archived = false ORDER BY pl.sequence_order`, [pkg.id]
            );
            pkg.laboratories = labs;
            // Full station sequence including the mandatory Front Desk step, so
            // the catalogue shows the same first stop the queue actually creates.
            pkg.steps = composeServiceSteps(labs, pkg.doctor_id ? { id: pkg.doctor_id, name: pkg.doctor_name } : null);
            pkg.is_available = labs.length > 0 || !!pkg.doctor_id;
            // Booking price, so the appointment form can show the breakdown
            // without hardcoding the surcharge on the client.
            pkg.appointment_surcharge_pct = APPOINTMENT_SURCHARGE_PCT;
            pkg.appointment_price = appointmentPrice(pkg.price);
        }
        res.json(packages);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch packages' }); }
});

// The categories actually in use, so the customer's filter only offers options
// that will match something.
router.get('/categories', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT category, COUNT(*) AS cnt FROM service_packages
             WHERE is_active = true AND archived = false AND category <> ''
             GROUP BY category ORDER BY category`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch categories' }); }
});

// GET package details with real-time ETA
router.get('/:id/details', async (req, res) => {
    try {
        const [pkgs] = await pool.query(`
            SELECT sp.*, d.name as doctor_name, d.specialty as doctor_specialty
            FROM service_packages sp
            LEFT JOIN doctors d ON sp.doctor_id = d.id AND d.archived = false
            WHERE sp.id = ? AND sp.archived = false
        `, [req.params.id]);
        if (pkgs.length === 0) return res.status(404).json({ error: 'Package not found' });
        const pkg = pkgs[0];

        const [labs] = await pool.query(
            `SELECT pl.*, l.name as lab_name, l.service_type
             FROM package_laboratories pl JOIN laboratories l ON pl.laboratory_id = l.id
             WHERE pl.package_id = ? AND pl.archived = false AND l.archived = false ORDER BY pl.sequence_order`, [pkg.id]
        );
        pkg.laboratories = labs;
        pkg.steps = composeServiceSteps(labs, pkg.doctor_id ? { id: pkg.doctor_id, name: pkg.doctor_name } : null);
        pkg.is_available = labs.length > 0 || !!pkg.doctor_id;

        // Calculate real-time ETA
        // Frontdesk wait
        const [fdQueue] = await pool.query(`SELECT COUNT(*) as cnt FROM queue WHERE station_type='frontdesk' AND status='waiting'`);
        const [fdAvg] = await pool.query(`SELECT AVG(TIMESTAMPDIFF(MINUTE, serve_time, complete_time)) as avg_mins FROM queue_logs WHERE station_type='frontdesk' AND complete_time IS NOT NULL AND DATE(join_time) = CURDATE()`);
        let totalEta = (fdQueue[0].cnt + 1) * (parseFloat(fdAvg[0].avg_mins) || 5);

        for (let lab of labs) {
            const [labQueue] = await pool.query(`SELECT COUNT(*) as cnt FROM queue WHERE station_type='laboratory' AND station_id=? AND status='waiting'`, [lab.laboratory_id]);
            const [labAvg] = await pool.query(`SELECT AVG(TIMESTAMPDIFF(MINUTE, serve_time, complete_time)) as avg_mins FROM queue_logs WHERE station_type='laboratory' AND station_id=? AND complete_time IS NOT NULL AND DATE(join_time) = CURDATE()`, [lab.laboratory_id]);
            totalEta += (labQueue[0].cnt + 1) * (parseFloat(labAvg[0].avg_mins) || lab.est_time_minutes || 10);
        }
        if (pkg.doctor_id) {
            const [docQueue] = await pool.query(`SELECT COUNT(*) as cnt FROM queue WHERE station_type='doctor' AND station_id=? AND status='waiting'`, [pkg.doctor_id]);
            const [docAvg] = await pool.query(`SELECT AVG(TIMESTAMPDIFF(MINUTE, serve_time, complete_time)) as avg_mins FROM queue_logs WHERE station_type='doctor' AND station_id=? AND complete_time IS NOT NULL AND DATE(join_time) = CURDATE()`, [pkg.doctor_id]);
            totalEta += (docQueue[0].cnt + 1) * (parseFloat(docAvg[0].avg_mins) || 15);
        }

        pkg.estimated_total_time = Math.ceil(totalEta);
        res.json(pkg);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch package details' }); }
});

// Front Desk is step 0 of every package and is never stored as a station row, so
// a station list that tries to include one would either duplicate the cashier or
// push it out of first place. Reject it rather than silently reordering.
const FRONT_DESK_NAME_PATTERN = /^\s*front\s*-?\s*desk\s*$/i;

async function rejectFrontDeskStations(laboratories) {
    const ids = (laboratories || []).map(l => parseInt(l.laboratory_id, 10)).filter(Number.isInteger);
    if (ids.length === 0) return null;
    const [rows] = await pool.query(
        `SELECT id, name FROM laboratories WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
    );
    const found = new Map(rows.map(r => [r.id, r.name]));
    for (const id of ids) {
        if (!found.has(id)) return `Station #${id} does not exist.`;
        if (FRONT_DESK_NAME_PATTERN.test(found.get(id))) {
            return 'Front Desk is always the first step of every service and cannot be added as a station.';
        }
    }
    return null;
}

// POST create package (frontdesk/admin)
router.post('/', authRequired, requireStaff, requireReason, async (req, res) => {
    const { name, description, price, est_time_minutes, laboratories, doctor_id, category, test_structure_id } = req.body;
    try {
        const stationError = await rejectFrontDeskStations(laboratories);
        if (stationError) return res.status(400).json({ error: stationError });
        const [result] = await pool.query(
            'INSERT INTO service_packages (name, description, price, est_time_minutes, category, doctor_id, test_structure_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, description || '', price, est_time_minutes || 15, normalizeCategory(category), doctor_id || null,
             await resolveTestStructureId(test_structure_id)]
        );
        const pkgId = result.insertId;
        if (laboratories && laboratories.length > 0) {
            for (let i = 0; i < laboratories.length; i++) {
                await pool.query(
                    'INSERT INTO package_laboratories (package_id, laboratory_id, sequence_order, est_time_minutes) VALUES (?, ?, ?, ?)',
                    [pkgId, laboratories[i].laboratory_id, i + 1, laboratories[i].est_time_minutes || 10]
                );
            }
        }
        await recordAudit({
            req, action: 'create', entityType: 'service_package', entityId: pkgId,
            summary: `Added service "${name}" at ${price}`,
            after: { ...(await snapshotRow('service_packages', 'id', pkgId)), stations: (laboratories || []).length }
        });
        res.json({ success: true, id: pkgId });
    } catch (err) {
        console.error('Create package error:', err);
        res.status(500).json({ error: 'Failed to create package' });
    }
});

// PUT update package
router.put('/:id', authRequired, requireStaff, requireReason, async (req, res) => {
    const { name, description, price, est_time_minutes, laboratories, is_active, doctor_id, category, test_structure_id } = req.body;
    try {
        const stationError = await rejectFrontDeskStations(laboratories);
        if (stationError) return res.status(400).json({ error: stationError });
        const before = await snapshotRow('service_packages', 'id', req.params.id);
        if (!before) return res.status(404).json({ error: 'Package not found' });
        const [beforeStations] = await pool.query(
            `SELECT l.name FROM package_laboratories pl JOIN laboratories l ON pl.laboratory_id = l.id
             WHERE pl.package_id = ? AND pl.archived = false ORDER BY pl.sequence_order`,
            [req.params.id]
        );

        // Left alone when the caller does not mention it: the front desk's own
        // service editor has no result-form field, and saving from there must
        // not clear the one an administrator chose.
        const structureId = test_structure_id === undefined
            ? (before.test_structure_id || null)
            : await resolveTestStructureId(test_structure_id);

        await pool.query(
            `UPDATE service_packages SET name=?, description=?, price=?, est_time_minutes=?, category=?,
                    doctor_id=?, is_active=?, test_structure_id=? WHERE id=?`,
            [name, description, price, est_time_minutes, normalizeCategory(category != null ? category : before.category),
             doctor_id || null, is_active !== false, structureId, req.params.id]
        );
        if (laboratories) {
            await pool.query('UPDATE package_laboratories SET archived=true, archived_at=NOW() WHERE package_id = ?', [req.params.id]);
            for (let i = 0; i < laboratories.length; i++) {
                await pool.query(
                    'INSERT INTO package_laboratories (package_id, laboratory_id, sequence_order, est_time_minutes) VALUES (?, ?, ?, ?)',
                    [req.params.id, laboratories[i].laboratory_id, i + 1, laboratories[i].est_time_minutes || 10]
                );
            }
        }
        const [afterStations] = await pool.query(
            `SELECT l.name FROM package_laboratories pl JOIN laboratories l ON pl.laboratory_id = l.id
             WHERE pl.package_id = ? AND pl.archived = false ORDER BY pl.sequence_order`,
            [req.params.id]
        );
        // The station route is the part of a service an operator is most likely
        // to be asked about later, so it goes in the snapshot alongside the row.
        await recordAudit({
            req, action: 'update', entityType: 'service_package', entityId: req.params.id,
            summary: `Updated service "${before.name}"${Number(before.price) !== Number(price) ? ` (price ${before.price} → ${price})` : ''}`,
            before: { ...before, stations: beforeStations.map(r => r.name).join(' → ') },
            after: { ...(await snapshotRow('service_packages', 'id', req.params.id)), stations: afterStations.map(r => r.name).join(' → ') }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Update package error:', err);
        res.status(500).json({ error: 'Failed to update package' });
    }
});

// Soft delete. The catalogue had no delete at all, so a retired service could
// only be switched inactive and never left the admin list; it now archives like
// every other entity and is restorable from Archives.
router.delete('/:id', authRequired, requireStaff, requireReason, async (req, res) => {
    try {
        const [active] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM queue_sequences
             WHERE package_id = ? AND status = 'in_progress' AND archived = false`,
            [req.params.id]
        );
        if (active[0].cnt > 0) {
            return res.status(409).json({
                error: `${active[0].cnt} patient(s) are part-way through this service. Wait for them to finish, or mark the service inactive instead.`
            });
        }
        const archived = await archiveRecord('service_packages', 'id', req.params.id, 'service_package', req);
        if (!archived) return res.status(400).json({ error: 'This service is already archived, or does not exist.' });
        res.json({ success: true });
    } catch (err) {
        console.error('Archive package error:', err);
        res.status(500).json({ error: 'Failed to archive package' });
    }
});

const aiServices = require('../ai_services');

router.post('/estimate-time', authRequired, requireStaff, async (req, res) => {
    const { laboratories } = req.body;
    try {
        let totalEst = 0;
        let labsWithEst = [];
        for (const lab of (laboratories || [])) {
            const aiRes = await aiServices.serviceTimeEstimation({ historicalAvg: 10 });
            totalEst += aiRes.estimatedMins;
            labsWithEst.push({ ...lab, est_time_minutes: Math.round(aiRes.estimatedMins) });
        }
        res.json({ total: Math.round(totalEst) || 15, laboratories: labsWithEst });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
