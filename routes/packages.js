const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, requireStaff } = require('../config');
const { composeServiceSteps } = require('../queue_automation');

function authRequired(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch (e) { res.status(403).json({ error: 'Invalid token' }); }
}

// GET all packages with lab details
router.get('/', async (req, res) => {
    try {
        const [packages] = await pool.query(`
            SELECT sp.*, d.name as doctor_name, d.specialty as doctor_specialty
            FROM service_packages sp
            LEFT JOIN doctors d ON sp.doctor_id = d.id AND d.archived = false
            WHERE sp.is_active = true AND sp.archived = false
            ORDER BY sp.name
        `);
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
        }
        res.json(packages);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch packages' }); }
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
router.post('/', authRequired, requireStaff, async (req, res) => {
    const { name, description, price, est_time_minutes, laboratories, doctor_id } = req.body;
    try {
        const stationError = await rejectFrontDeskStations(laboratories);
        if (stationError) return res.status(400).json({ error: stationError });
        const [result] = await pool.query(
            'INSERT INTO service_packages (name, description, price, est_time_minutes, doctor_id) VALUES (?, ?, ?, ?, ?)',
            [name, description || '', price, est_time_minutes || 15, doctor_id || null]
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
        await pool.query('INSERT INTO audit_logs (action, entity_type, entity_id, details, performed_by) VALUES (?, ?, ?, ?, ?)',
            ['create', 'service_package', pkgId, JSON.stringify({ name, price }), req.user.id]);
        res.json({ success: true, id: pkgId });
    } catch (err) { res.status(500).json({ error: 'Failed to create package' }); }
});

// PUT update package
router.put('/:id', authRequired, requireStaff, async (req, res) => {
    const { name, description, price, est_time_minutes, laboratories, is_active, doctor_id } = req.body;
    try {
        const stationError = await rejectFrontDeskStations(laboratories);
        if (stationError) return res.status(400).json({ error: stationError });
        await pool.query(
            'UPDATE service_packages SET name=?, description=?, price=?, est_time_minutes=?, doctor_id=?, is_active=? WHERE id=?',
            [name, description, price, est_time_minutes, doctor_id || null, is_active !== false, req.params.id]
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
        await pool.query('INSERT INTO audit_logs (action, entity_type, entity_id, details, performed_by) VALUES (?, ?, ?, ?, ?)',
            ['update', 'service_package', req.params.id, JSON.stringify({ name, price }), req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to update package' }); }
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
