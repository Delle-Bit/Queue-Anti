const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const aiServices = require('../ai_services');

router.get('/summary', async (req, res) => {
    const { period } = req.query; // 'daily', 'weekly', 'monthly'
    let dateFilter = 'CURDATE()';
    let periodName = 'Today';

    if (period === 'weekly') {
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
        periodName = 'Last 7 Days';
    } else if (period === 'monthly') {
        dateFilter = 'DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
        periodName = 'Last 30 Days';
    }

    try {
        // 1. Patient Volume
        const [volRows] = await pool.query(
            `SELECT COUNT(*) as count FROM queue_logs WHERE join_time >= ${period === 'daily' ? 'CURDATE()' : dateFilter} AND archived = false`
        );
        const patientVolume = volRows[0].count;

        // 2. Wait Time Avg
        const [waitRows] = await pool.query(
            `SELECT AVG(TIMESTAMPDIFF(MINUTE, join_time, serve_time)) as avg_wait 
             FROM queue_logs 
             WHERE join_time >= ${period === 'daily' ? 'CURDATE()' : dateFilter} AND serve_time IS NOT NULL AND archived = false`
        );
        const waitTimeAvg = Math.round(waitRows[0].avg_wait || 0);

        // 3. Revenue
        const [revRows] = await pool.query(
            `SELECT SUM(price) as total FROM queue_logs WHERE join_time >= ${period === 'daily' ? 'CURDATE()' : dateFilter} AND archived = false`
        );
        const revenue = parseFloat(revRows[0].total || 0);

        // 4. Top Service
        const [servRows] = await pool.query(
            `SELECT package_name, COUNT(*) as count FROM queue_logs 
             WHERE join_time >= ${period === 'daily' ? 'CURDATE()' : dateFilter} AND archived = false
             GROUP BY package_name ORDER BY count DESC LIMIT 1`
        );
        const topService = servRows.length > 0 ? servRows[0].package_name : 'N/A';

        // 5. Category Distribution (for charts)
        const [catRows] = await pool.query(
            `SELECT type, COUNT(*) as count FROM queue_logs 
             WHERE join_time >= ${period === 'daily' ? 'CURDATE()' : dateFilter} AND archived = false
             GROUP BY type`
        );

        // AI Summary
        const aiResponse = await aiServices.reportGeneration({
            period: periodName,
            patientVolume,
            waitTimeAvg,
            revenue,
            topService
        });

        res.json({
            success: true,
            period: periodName,
            stats: {
                patientVolume,
                waitTimeAvg,
                revenue,
                topService,
                distribution: catRows
            },
            aiSummary: aiResponse.summary
        });
    } catch (err) {
        console.error('Report error:', err);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

module.exports = router;
