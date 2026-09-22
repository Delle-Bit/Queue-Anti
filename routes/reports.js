const express = require('express');
const router = express.Router();
const { pool } = require('../database');
// ── SALES ────────────────────────────────────────────────────────────────────
// What was actually taken at the cashier, between two dates. Every figure comes
// from queue_sequences.amount_paid rather than the package price list, because
// a Senior or a PWD pays 20 percent less and a price edited next month must not
// rewrite last month's sales. paid_at is the date a sale belongs to.
//
// Visits queued before payment recording shipped have paid_at but no
// amount_paid; they are counted separately rather than silently as zero, so a
// total that is missing history says so on its face.
router.get('/sales', async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    if (!from || !to) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD dates' });
    if (from > to) return res.status(400).json({ error: 'The start date must not be after the end date' });
    // A yearly report reads as twelve months, not 365 days.
    const group = req.query.group === 'month' ? 'month' : 'day';
    const periodExpr = group === 'month' ? "DATE_FORMAT(qs.paid_at, '%Y-%m')" : 'DATE(qs.paid_at)';

    // paid_at < to + 1 day, so the last day is included whatever time it was paid.
    const range = [from, to];
    const where = `qs.paid_at >= ? AND qs.paid_at < DATE_ADD(?, INTERVAL 1 DAY) AND qs.archived = false`;

    try {
        const [[totals]] = await pool.query(
            `SELECT COUNT(*) AS visits,
                    COALESCE(SUM(qs.list_amount), 0) AS list_total,
                    COALESCE(SUM(qs.discount_amount), 0) AS discount_total,
                    COALESCE(SUM(qs.amount_paid), 0) AS net_total,
                    SUM(qs.amount_paid IS NULL) AS unrecorded
             FROM queue_sequences qs WHERE ${where}`, range);

        const [byService] = await pool.query(
            `SELECT sp.name AS service, sp.category,
                    COUNT(*) AS visits,
                    COALESCE(SUM(qs.discount_amount), 0) AS discount,
                    COALESCE(SUM(qs.amount_paid), 0) AS net
             FROM queue_sequences qs
             JOIN service_packages sp ON sp.id = qs.package_id
             WHERE ${where}
             GROUP BY sp.id ORDER BY net DESC`, range);

        const [byPeriod] = await pool.query(
            `SELECT ${periodExpr} AS period, COUNT(*) AS visits,
                    COALESCE(SUM(qs.amount_paid), 0) AS net
             FROM queue_sequences qs WHERE ${where}
             GROUP BY period ORDER BY period`, range);

        const [byMethod] = await pool.query(
            `SELECT COALESCE(NULLIF(qs.payment_method, ''), 'unrecorded') AS method,
                    COUNT(*) AS visits, COALESCE(SUM(qs.amount_paid), 0) AS net
             FROM queue_sequences qs WHERE ${where}
             GROUP BY method ORDER BY net DESC`, range);

        const [byDiscount] = await pool.query(
            `SELECT COALESCE(NULLIF(qs.discount_type, ''), 'unrecorded') AS discount_type,
                    COUNT(*) AS visits,
                    COALESCE(SUM(qs.discount_amount), 0) AS discount,
                    COALESCE(SUM(qs.amount_paid), 0) AS net
             FROM queue_sequences qs WHERE ${where}
             GROUP BY discount_type ORDER BY visits DESC`, range);

        const [byChannel] = await pool.query(
            `SELECT qs.intake_channel AS channel, COUNT(*) AS visits,
                    COALESCE(SUM(qs.amount_paid), 0) AS net
             FROM queue_sequences qs WHERE ${where}
             GROUP BY qs.intake_channel ORDER BY net DESC`, range);

        // Paid for, then not finished. The clinic has the money and the patient
        // did not get the whole service, so it is the one line an owner reads
        // before the totals.
        const [unfinished] = await pool.query(
            `SELECT (SELECT ql.ticket_number FROM queue_logs ql
                     WHERE ql.sequence_id = qs.id ORDER BY ql.id LIMIT 1) AS ticket_number,
                    sp.name AS service, qs.paid_at,
                    COALESCE(qs.amount_paid, 0) AS net, qs.outcome_reason
             FROM queue_sequences qs
             LEFT JOIN service_packages sp ON sp.id = qs.package_id
             WHERE ${where} AND qs.outcome = 'unfinished'
             ORDER BY qs.paid_at DESC LIMIT 50`, range);

        const visits = Number(totals.visits) || 0;
        res.json({
            success: true,
            from, to, group,
            totals: {
                visits,
                list_total: Number(totals.list_total),
                discount_total: Number(totals.discount_total),
                net_total: Number(totals.net_total),
                average_sale: visits ? Math.round((Number(totals.net_total) / visits) * 100) / 100 : 0,
                unrecorded: Number(totals.unrecorded) || 0
            },
            by_service: byService, by_period: byPeriod, by_method: byMethod,
            by_discount: byDiscount, by_channel: byChannel, unfinished
        });
    } catch (err) {
        console.error('Sales report error:', err);
        res.status(500).json({ error: 'Failed to build the sales report' });
    }
});

module.exports = router;
