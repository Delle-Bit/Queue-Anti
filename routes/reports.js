const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const ExcelJS = require('exceljs');

function sanitizeCellValue(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/^[=+\-@]/.test(str)) {
        return `'${str}`;
    }
    return str;
}

// ── EXCEL EXPORT (FEATURE 3) ──────────────────────────────────────────────────
router.get('/sales/export-xlsx', async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;

    // Default to current month if no dates provided
    const now = new Date();
    const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const defaultTo = now.toISOString().slice(0, 10);

    const startDate = from || defaultFrom;
    const endDate = to || defaultTo;

    if (startDate > endDate) {
        return res.status(400).json({ error: 'Start date cannot be after end date' });
    }

    // The same rows the on-screen report (GET /sales) counts: a visit belongs to
    // a date by its paid_at, and status is not a filter there. Keeping the two in
    // step is what makes the file's totals match the report the operator sees. A
    // cancelled or unfinished sale still appears, marked in the Status column,
    // rather than silently dropping out of the export.
    const conditions = [
        'qs.paid_at >= ?',
        'qs.paid_at < DATE_ADD(?, INTERVAL 1 DAY)',
        'qs.archived = false'
    ];
    const params = [startDate, endDate];

    if (req.query.service_id) {
        conditions.push('sp.id = ?');
        params.push(req.query.service_id);
    }
    if (req.query.payment_method) {
        conditions.push('qs.payment_method = ?');
        params.push(req.query.payment_method);
    }

    try {
        const [rows] = await pool.query(
            `SELECT qs.id,
                    COALESCE(NULLIF(qs.receipt_no, ''), CONCAT('REC-', LPAD(qs.id, 6, '0'))) AS receipt_number,
                    DATE_FORMAT(qs.paid_at, '%Y-%m-%d') AS transaction_date,
                    COALESCE(u.full_name, u.username, 'Walk-in Customer') AS customer_name,
                    sp.name AS service_name,
                    1 AS quantity,
                    COALESCE(qs.list_amount, sp.price, 0) AS unit_price,
                    COALESCE(qs.discount_amount, 0) AS discount,
                    COALESCE(qs.amount_paid, sp.price, 0) AS total,
                    COALESCE(NULLIF(qs.payment_method, ''), 'Cash') AS payment_method,
                    qs.status AS status,
                    COALESCE(
                        (SELECT u_staff.full_name FROM queue_logs ql JOIN users u_staff ON ql.station_id = u_staff.id WHERE ql.sequence_id = qs.id AND ql.station_type = 'frontdesk' LIMIT 1),
                        'Front Desk'
                    ) AS processed_by
             FROM queue_sequences qs
             JOIN service_packages sp ON qs.package_id = sp.id
             LEFT JOIN users u ON qs.customer_id = u.id
             WHERE ${conditions.join(' AND ')}
             ORDER BY qs.paid_at ASC`,
            params
        );

        if (rows.length === 0) {
            return res.status(200).json({ empty: true, message: 'No sales records found for the selected filters.' });
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'ReaLab Medical System';
        workbook.created = new Date();

        // ── Sheet 1: Transactions
        const sheet = workbook.addWorksheet('Transactions');
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        const headers = [
            'Receipt No.', 'Date', 'Customer Name', 'Service',
            'Qty', 'Unit Price (PHP)', 'Discount (PHP)', 'Total (PHP)',
            'Payment Method', 'Status', 'Processed By'
        ];
        sheet.addRow(headers);

        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FF1F2937' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD9E1F2' }
        };

        rows.forEach(r => {
            sheet.addRow([
                sanitizeCellValue(r.receipt_number),
                r.transaction_date,
                sanitizeCellValue(r.customer_name),
                sanitizeCellValue(r.service_name),
                Number(r.quantity),
                Number(r.unit_price),
                Number(r.discount),
                Number(r.total),
                sanitizeCellValue(r.payment_method),
                sanitizeCellValue(r.status),
                sanitizeCellValue(r.processed_by)
            ]);
        });

        // Money format on columns F, G, H (indices 6, 7, 8)
        [6, 7, 8].forEach(colIdx => {
            sheet.getColumn(colIdx).numFmt = '₱#,##0.00';
        });

        // Totals row at the bottom
        const lastRow = sheet.rowCount;
        const totalsRow = sheet.addRow([
            '', '', '', 'TOTAL',
            { formula: `SUM(E2:E${lastRow})` },
            { formula: `SUM(F2:F${lastRow})` },
            { formula: `SUM(G2:G${lastRow})` },
            { formula: `SUM(H2:H${lastRow})` },
            '', '', ''
        ]);
        totalsRow.font = { bold: true };
        totalsRow.getCell(4).alignment = { horizontal: 'right' };

        // Auto-width columns
        sheet.columns.forEach(col => {
            let maxLen = 10;
            col.eachCell({ includeEmpty: false }, cell => {
                const len = cell.value ? String(cell.value).length : 0;
                if (len > maxLen) maxLen = len;
            });
            col.width = Math.min(maxLen + 3, 40);
        });

        // ── Sheet 2: Summary
        const summarySheet = workbook.addWorksheet('Summary');
        summarySheet.views = [{ state: 'frozen', ySplit: 1 }];

        summarySheet.addRow(['By Service', 'Total (PHP)', '', 'By Payment Method', 'Total (PHP)']);
        summarySheet.getRow(1).font = { bold: true };
        summarySheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8EAED' }
        };

        const byService = {};
        const byMethod = {};
        rows.forEach(r => {
            byService[r.service_name] = (byService[r.service_name] || 0) + Number(r.total);
            byMethod[r.payment_method] = (byMethod[r.payment_method] || 0) + Number(r.total);
        });

        const svcs = Object.keys(byService);
        const methods = Object.keys(byMethod);
        const maxLen = Math.max(svcs.length, methods.length);

        for (let i = 0; i < maxLen; i++) {
            summarySheet.addRow([
                svcs[i] ? sanitizeCellValue(svcs[i]) : '',
                svcs[i] ? Number(byService[svcs[i]]) : '',
                '',
                methods[i] ? sanitizeCellValue(methods[i]) : '',
                methods[i] ? Number(byMethod[methods[i]]) : ''
            ]);
        }
        summarySheet.getColumn(2).numFmt = '₱#,##0.00';
        summarySheet.getColumn(5).numFmt = '₱#,##0.00';
        summarySheet.columns.forEach(col => { col.width = 24; });

        // Log export in audit log
        try {
            const userId = req.user?.id || 1;
            const ip = req.ip || req.connection?.remoteAddress || '';
            await pool.query(
                `INSERT INTO export_audit_log (user_id, action, status, ip_address) VALUES (?, 'sales_excel_export', 'success', ?)`,
                [userId, ip]
            );
        } catch (_) {}

        const filename = `Sales_${startDate}_to_${endDate}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Export Excel error:', err);
        res.status(500).json({ error: 'Failed to generate Excel file' });
    }
});
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
