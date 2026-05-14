const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

function authRequired(req, res, next) {
    const token = (req.headers['authorization'] || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch (e) { res.status(403).json({ error: 'Invalid token' }); }
}

// GET all packages with lab details
router.get('/', async (req, res) => {
    try {
        const [packages] = await pool.query('SELECT * FROM service_packages WHERE is_active = true AND archived = false ORDER BY name');
        for (let pkg of packages) {
            const [labs] = await pool.query(
                `SELECT pl.*, l.name as lab_name, l.service_type
                 FROM package_laboratories pl
                 JOIN laboratories l ON pl.laboratory_id = l.id
                 WHERE pl.package_id = ? AND pl.archived = false AND l.archived = false ORDER BY pl.sequence_order`, [pkg.id]
            );
            pkg.laboratories = labs;
        }
        res.json(packages);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch packages' }); }
});

// GET package details with real-time ETA
router.get('/:id/details', async (req, res) => {
    try {
        const [pkgs] = await pool.query('SELECT * FROM service_packages WHERE id = ? AND archived = false', [req.params.id]);
        if (pkgs.length === 0) return res.status(404).json({ error: 'Package not found' });
        const pkg = pkgs[0];

        const [labs] = await pool.query(
            `SELECT pl.*, l.name as lab_name, l.service_type
             FROM package_laboratories pl JOIN laboratories l ON pl.laboratory_id = l.id
             WHERE pl.package_id = ? AND pl.archived = false AND l.archived = false ORDER BY pl.sequence_order`, [pkg.id]
        );
        pkg.laboratories = labs;

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

        pkg.estimated_total_time = Math.ceil(totalEta);
        res.json(pkg);
    } catch (err) { res.status(500).json({ error: 'Failed to fetch package details' }); }
});

// POST create package (frontdesk/admin)
router.post('/', authRequired, async (req, res) => {
    const { name, description, price, est_time_minutes, laboratories } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO service_packages (name, description, price, est_time_minutes) VALUES (?, ?, ?, ?)',
            [name, description || '', price, est_time_minutes || 15]
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
router.put('/:id', authRequired, async (req, res) => {
    const { name, description, price, est_time_minutes, laboratories, is_active } = req.body;
    try {
        await pool.query(
            'UPDATE service_packages SET name=?, description=?, price=?, est_time_minutes=?, is_active=? WHERE id=?',
            [name, description, price, est_time_minutes, is_active !== false, req.params.id]
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

router.post('/estimate-time', authRequired, async (req, res) => {
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
