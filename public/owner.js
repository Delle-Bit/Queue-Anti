if (!requireAuth(['owner'])) throw new Error('Unauthorized');

// Manage Accounts, Manage Laboratories, Service Management, Audit Logs and
// Archives are identical to the admin dashboard's and live in admin-shared.js.
// What stays here is what is genuinely this page's: its sidebar, the owner
// dashboard, and the sales report.

renderSidebar([
    { section: 'OWNER' },
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-building-columns' },
    { id: 'accounts', label: 'Manage Accounts', icon: 'fa-solid fa-users-gear' },
    { id: 'labs', label: 'Manage Laboratories', icon: 'fa-solid fa-flask-vial' },
    { id: 'sales', label: 'Sales Report', icon: 'fa-solid fa-receipt' },
    { id: 'services', label: 'Service Management', icon: 'fa-solid fa-box-open' },
    { id: 'structures', label: 'Test Structures', icon: 'fa-solid fa-vials' },
    { id: 'create', label: 'Create Account', icon: 'fa-solid fa-user-plus' },
    { id: 'audits', label: 'Audit Logs', icon: 'fa-solid fa-file-shield' },
    { id: 'archive', label: 'Archive', icon: 'fa-solid fa-box-archive' },
    { id: 'customize', label: 'Customize', icon: 'fa-solid fa-palette' }
], 'dashboard');
initDefaultSection();

window.onSectionLoad = {
    structures: loadTestStructureAdmin,
    dashboard: loadOwnerDash,
    accounts: loadAccounts,
    labs: loadLabs,
    sales: initSalesReport,
    services: loadServiceMgmt,
    create: initCreateForm,
    audits: loadAuditLogs,
    archive: loadArchives,
    customize: loadCustomization
};

// ── ROLES THIS PAGE MAY ASSIGN ──
// The owner is the only role that can create other elevated accounts, `owner`
// included - a role nobody can assign is a role nobody can hand back.
function populateRoleSelect(selectId, selected) {
    const roles = [
        { value: 'laboratory', label: 'Laboratory' },
        { value: 'frontdesk', label: 'Front Desk' },
        { value: 'doctor', label: 'Doctor' },
        { value: 'admintechnical', label: 'Admin Technical' },
        { value: 'admin', label: 'Admin' },
        { value: 'owner', label: 'Owner' }
    ];
    renderRoleOptions(selectId, roles, selected);
}

// ── DASHBOARD ──
async function loadOwnerDash() {
    skeletonValue(['ow-revenue', 'ow-services']);
    skeletonLines('ow-dist', { rows: 4 });
    skeletonTable('ow-sessions', { rows: 4, cols: [
        'skel-line skel-w-60', 'skel-pill skel-w-70', 'skel-line skel-w-80', 'skel-pill skel-w-60'
    ] });
    try {
        const res = await fetch('/api/analytics/owner', { headers: authHeaders() });
        const data = await res.json();

        document.getElementById('ow-revenue').textContent = formatCurrency(data.total_revenue);
        document.getElementById('ow-services').textContent = data.total_services;

        const labels = { Q: 'Regular', S: 'Senior', D: 'PWD', P: 'Pregnant' };
        document.getElementById('ow-dist').innerHTML = (data.distribution || []).map(d =>
            `<div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border-light);">
                <span>${labels[d.type] || d.type}</span><span class="fw-600">${d.cnt}</span></div>`
        ).join('') || '<span class="text-muted">No data today</span>';

        document.getElementById('ow-sessions').innerHTML = (data.sessions || []).map(s =>
            `<tr><td>${s.username}</td><td><span class="badge badge-primary">${s.role}</span></td>
            <td>${formatDateTime(s.login_time)}</td>
            <td>${s.logout_time ? formatDateTime(s.logout_time) : '<span class="badge badge-success">Active</span>'}</td></tr>`
        ).join('') || '<tr><td colspan="4" class="text-muted text-center">No sessions</td></tr>';
    } catch (err) { console.error(err); }
    clearSkeleton('ow-revenue', 'ow-services', 'ow-dist', 'ow-sessions');
}

fetchAllLabs();
loadOwnerDash();

// ── SALES REPORT ───────────────────────────────────────────────
// Money only: every figure is what the cashier recorded at the opening front
// desk step, so a Senior's 20 percent is already off it.
function salesDateValue(d) {
    // Local date, not toISOString - that converts to UTC and in Manila reports
    // yesterday for anything before 8am.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const SALES_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

// Monthly and Yearly pick a calendar period; Custom dates shows the two date
// inputs. Whatever is chosen, the report is still asked for as from/to.
function syncSalesMode() {
    const mode = document.getElementById('sales-mode').value;
    document.querySelectorAll('.sales-monthly, .sales-yearly, .sales-range').forEach(el => {
        el.style.display = el.classList.contains(`sales-${mode}`) ? '' : 'none';
    });
}

// The quick buttons. Month and year shortcuts switch to that mode, so the
// controls always show what the report is covering.
function setSalesRange(range) {
    const today = new Date();
    const mode = document.getElementById('sales-mode');
    const year = document.getElementById('sales-year');
    const month = document.getElementById('sales-month');
    if (range === 'month' || range === 'lastmonth') {
        const d = new Date(today.getFullYear(), today.getMonth() - (range === 'lastmonth' ? 1 : 0), 1);
        mode.value = 'monthly'; year.value = d.getFullYear(); month.value = d.getMonth();
    } else if (range === 'year' || range === 'lastyear') {
        mode.value = 'yearly'; year.value = today.getFullYear() - (range === 'lastyear' ? 1 : 0);
    } else {
        const from = new Date(today);
        if (range === 'week') from.setDate(today.getDate() - 6);
        mode.value = 'range';
        document.getElementById('sales-from').value = salesDateValue(from);
        document.getElementById('sales-to').value = salesDateValue(today);
    }
    syncSalesMode();
    loadSalesReport();
}

function initSalesReport() {
    const month = document.getElementById('sales-month');
    if (!month.options.length) {
        month.innerHTML = SALES_MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join('');
        setSalesRange('month');
        return;
    }
    loadSalesReport();
}

// { from, to, group } for whatever the controls say, or null if incomplete.
function salesPeriod() {
    const mode = document.getElementById('sales-mode').value;
    const year = parseInt(document.getElementById('sales-year').value, 10);
    if (mode === 'range') {
        const from = document.getElementById('sales-from').value;
        const to = document.getElementById('sales-to').value;
        return from && to ? { from, to, group: 'day' } : null;
    }
    if (!(year >= 2000 && year <= 2100)) return null;
    if (mode === 'yearly') return { from: `${year}-01-01`, to: `${year}-12-31`, group: 'month' };
    const m = parseInt(document.getElementById('sales-month').value, 10);
    return { from: salesDateValue(new Date(year, m, 1)), to: salesDateValue(new Date(year, m + 1, 0)), group: 'day' };
}

// Which quick range (if any) the controls currently exactly match. Drives the
// highlight on the Today / This month / This year buttons so the active filter
// is visible rather than only implied by the dropdowns.
function currentSalesRange() {
    const mode = document.getElementById('sales-mode').value;
    const today = new Date();
    const todayStr = salesDateValue(today);
    if (mode === 'yearly') {
        const y = parseInt(document.getElementById('sales-year').value, 10);
        if (y === today.getFullYear()) return 'year';
        if (y === today.getFullYear() - 1) return 'lastyear';
        return null;
    }
    if (mode === 'monthly') {
        const y = parseInt(document.getElementById('sales-year').value, 10);
        const m = parseInt(document.getElementById('sales-month').value, 10);
        if (y === today.getFullYear() && m === today.getMonth()) return 'month';
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        if (y === prev.getFullYear() && m === prev.getMonth()) return 'lastmonth';
        return null;
    }
    // Custom range: only the two date shortcuts can match exactly.
    const from = document.getElementById('sales-from').value;
    const to = document.getElementById('sales-to').value;
    if (from === todayStr && to === todayStr) return 'today';
    const weekFrom = new Date(today);
    weekFrom.setDate(today.getDate() - 6);
    if (from === salesDateValue(weekFrom) && to === todayStr) return 'week';
    return null;
}

function syncSalesRangeButtons() {
    const active = currentSalesRange();
    document.querySelectorAll('[data-sales-range]').forEach(btn => {
        const on = btn.dataset.salesRange === active;
        btn.classList.toggle('btn-primary', on);
        btn.classList.toggle('btn-outline', !on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

const SALES_LABELS = {
    none: 'No discount', senior: 'Senior (20%)', pwd: 'PWD (20%)', other: 'Other',
    cash: 'Cash', gcash: 'GCash', card: 'Card', bank: 'Bank transfer', hmo: 'HMO',
    online: 'Joined online', appointment: 'Appointment', walkin: 'Walk-in',
    unrecorded: 'Not recorded'
};
const salesLabel = key => SALES_LABELS[key] || key || '--';

async function loadSalesReport() {
    syncSalesRangeButtons();
    const period = salesPeriod();
    if (!period) return showToast('Choose the period to report on', 'error');
    const { from, to, group } = period;

    const body = id => document.getElementById(id);
    skeletonValue(['sales-net', 'sales-visits', 'sales-discount', 'sales-average']);
    try {
        const res = await fetch(`/api/reports/sales?from=${from}&to=${to}&group=${group}`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Failed to load the sales report', 'error'); return; }

        const t = data.totals;
        body('sales-net').textContent = formatCurrency(t.net_total);
        body('sales-visits').textContent = t.visits;
        body('sales-discount').textContent = formatCurrency(t.discount_total);
        body('sales-average').textContent = formatCurrency(t.average_sale);

        // A visit paid for before payment recording shipped has no amount, and
        // counting it as zero would quietly understate the total.
        const notice = body('sales-notice');
        if (!t.visits) {
            notice.style.display = '';
            notice.textContent = "No payments in this period. A sale is recorded when the front desk clears a patient's first step and fills in the payment box.";
        } else if (t.unrecorded) {
            notice.style.display = '';
            notice.textContent = `${t.unrecorded} of these ${t.visits} paid visits were taken before the cashier recorded amounts, so their sales are not included.`;
        } else {
            notice.style.display = 'none';
        }

        const empty = cols => `<tr><td colspan="${cols}" class="text-center text-muted">Nothing in this period</td></tr>`;

        body('sales-by-service').innerHTML = data.by_service.length ? data.by_service.map(r => `<tr>
            <td>${escapeHtml(r.service || '--')}</td>
            <td>${escapeHtml(r.category || '--')}</td>
            <td>${r.visits}</td>
            <td>${formatCurrency(r.discount)}</td>
            <td><strong>${formatCurrency(r.net)}</strong></td>
            <td>${t.net_total ? Math.round((Number(r.net) / t.net_total) * 100) : 0}%</td></tr>`).join('') : empty(6);

        const monthly = group === 'month';
        body('sales-period-title').textContent = monthly ? 'Sales by month' : 'Sales by day';
        body('sales-period-head').textContent = monthly ? 'Month' : 'Date';
        body('sales-by-day').innerHTML = data.by_period.length ? data.by_period.map(r => `<tr>
            <td>${monthly ? salesMonth(r.period) : salesDay(r.period)}</td><td>${r.visits}</td>
            <td><strong>${formatCurrency(r.net)}</strong></td></tr>`).join('') : empty(3);

        body('sales-by-method').innerHTML = data.by_method.length ? data.by_method.map(r => `<tr>
            <td>${escapeHtml(salesLabel(r.method))}</td><td>${r.visits}</td>
            <td>${formatCurrency(r.net)}</td></tr>`).join('') : empty(3);

        body('sales-by-discount').innerHTML = data.by_discount.length ? data.by_discount.map(r => `<tr>
            <td>${escapeHtml(salesLabel(r.discount_type))}</td><td>${r.visits}</td>
            <td>${formatCurrency(r.discount)}</td><td>${formatCurrency(r.net)}</td></tr>`).join('') : empty(4);

        body('sales-by-channel').innerHTML = data.by_channel.length ? data.by_channel.map(r => `<tr>
            <td>${escapeHtml(salesLabel(r.channel))}</td><td>${r.visits}</td>
            <td>${formatCurrency(r.net)}</td></tr>`).join('') : empty(3);

        body('sales-unfinished').innerHTML = data.unfinished.length ? data.unfinished.map(r => `<tr>
            <td>${escapeHtml(r.ticket_number || '--')}</td>
            <td>${escapeHtml(r.service || '--')}</td>
            <td>${formatCurrency(r.net)}</td>
            <td>${escapeHtml(r.outcome_reason || '--')}</td></tr>`).join('')
            : '<tr><td colspan="4" class="text-center text-muted">None — every paid visit was completed</td></tr>';
    } catch (err) {
        showToast('Failed to load the sales report', 'error');
    } finally {
        clearSkeleton('sales-net', 'sales-visits', 'sales-discount', 'sales-average');
    }
}

async function exportSalesExcel() {
    const period = salesPeriod();
    if (!period) return showToast('Choose the period to report on', 'error');
    const { from, to } = period;
    closeSalesExportMenu();

    const btn = document.getElementById('btn-export-excel');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Exporting...'; }

    try {
        const res = await fetch(`/api/reports/sales/export-xlsx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
            headers: authHeaders()
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to export sales Excel', 'error');
            return;
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const json = await res.json();
            if (json.empty) {
                showToast(json.message || 'No sales records found for this period.', 'info');
                return;
            }
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cd = res.headers.get('content-disposition') || '';
        const match = cd.match(/filename="?([^"]+)"?/);
        a.download = match ? match[1] : `Sales_${from}_to_${to}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast('Sales Excel exported successfully!', 'success');
    } catch (err) {
        console.error('Export Excel error:', err);
        showToast('Export failed', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> Excel (.xlsx)'; }
    }
}

// ── SALES PDF EXPORT ──
function closeSalesExportMenu() {
    const menu = document.getElementById('sales-export-menu');
    if (menu) menu.open = false;
}

// The <details> handles its own open/close; these only handle "clicked away"
// and Escape, the two cases the disclosure cannot see on its own.
document.addEventListener('click', (e) => {
    const menu = document.getElementById('sales-export-menu');
    if (menu && menu.open && !menu.contains(e.target)) menu.open = false;
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSalesExportMenu();
});

function salesPdfFooter(doc, generatedAt) {
    const { margin, pageW, muted, hairline, footerTop } = PDF;
    doc.setDrawColor(hairline[0], hairline[1], hairline[2]);
    doc.setLineWidth(0.2);
    doc.line(margin, footerTop, pageW - margin, footerTop);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text('Sales report - internal financial document.', margin, footerTop + 4.5);
    doc.text('Generated ' + generatedAt, margin, footerTop + 8);
}

// A real generated PDF, not the browser's print dialog. Built client-side with
// jsPDF and the same clinic letterhead the patient documents use, so the sales
// report and the medical record look like they come from one system.
async function exportSalesPdf() {
    const period = salesPeriod();
    if (!period) return showToast('Choose the period to report on', 'error');
    const { from, to, group } = period;
    closeSalesExportMenu();

    const btn = document.getElementById('btn-export-pdf');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...'; }

    try {
        // Same endpoint and period as the report on screen, so the file's totals
        // match what the operator is looking at.
        const res = await fetch(`/api/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&group=${group}`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Failed to load the sales report', 'error'); return; }
        // A PDF of headers with no rows is not a report. Say so and stop.
        const t = data.totals || {};
        if (!t.visits) { showToast('No payments in this period to export', 'info'); return; }

        const settings = await fetch('/api/settings').then(r => r.ok ? r.json() : {}).catch(() => ({}));
        const clinic = { name: settings.site_name || 'ReaLab', logoPath: settings.logo_path || '/images/examplelogo.svg' };
        const logo = await loadLogoDataUrl(clinic.logoPath);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const generatedAt = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });

        pdfLetterhead(doc, clinic, logo, { title: 'Sales Report', marker: 'INTERNAL', markerNote: 'Financial Report' });

        const monthly = group === 'month';
        let y = PDF.headerBottom + 3;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
        doc.text(`Period: ${from} to ${to}`, PDF.margin, y + 2);
        y += 9;

        y = pdfSectionHeading(doc, 'Summary', y) + 3;
        y = pdfFieldGrid(doc, [
            ['Net sales', formatCurrency(t.net_total || 0)],
            ['Paid visits', String(t.visits || 0)],
            ['Discounts given', formatCurrency(t.discount_total || 0)],
            ['Average sale', formatCurrency(t.average_sale || 0)]
        ], y) + 7;

        const right = { halign: 'right' };
        const table = (title, head, body, columnStyles) => {
            y = pdfSectionHeading(doc, title, y) + 2;
            doc.autoTable({
                startY: y,
                head: [head],
                body,
                theme: 'grid',
                margin: { left: PDF.margin, right: PDF.margin, top: PDF.runningHeaderBottom, bottom: 24 },
                styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.9, textColor: PDF.ink, lineColor: PDF.hairline, lineWidth: 0.15 },
                headStyles: { fillColor: PDF.brand, textColor: [255, 255, 255], fontSize: 7.8, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [250, 251, 252] },
                columnStyles: columnStyles || {},
                didDrawPage: () => salesPdfFooter(doc, generatedAt)
            });
            y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 7;
        };

        table('By service', ['Service', 'Category', 'Visits', 'Discount', 'Net', 'Share'],
            (data.by_service || []).map(r => [
                r.service || '--', r.category || '--', String(r.visits),
                formatCurrency(r.discount), formatCurrency(r.net),
                (t.net_total ? Math.round((Number(r.net) / t.net_total) * 100) : 0) + '%'
            ]),
            { 2: right, 3: right, 4: right, 5: right });

        table(monthly ? 'By month' : 'By day', [monthly ? 'Month' : 'Date', 'Visits', 'Net'],
            (data.by_period || []).map(r => [monthly ? salesMonth(r.period) : salesDay(r.period), String(r.visits), formatCurrency(r.net)]),
            { 1: right, 2: right });

        table('By payment method', ['Method', 'Visits', 'Net'],
            (data.by_method || []).map(r => [salesLabel(r.method), String(r.visits), formatCurrency(r.net)]),
            { 1: right, 2: right });

        table('By discount', ['Discount', 'Visits', 'Discount', 'Net'],
            (data.by_discount || []).map(r => [salesLabel(r.discount_type), String(r.visits), formatCurrency(r.discount), formatCurrency(r.net)]),
            { 1: right, 2: right, 3: right });

        table('By intake channel', ['Channel', 'Visits', 'Net'],
            (data.by_channel || []).map(r => [salesLabel(r.channel), String(r.visits), formatCurrency(r.net)]),
            { 1: right, 2: right });

        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6.8);
            doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
            doc.text('Page ' + i + ' of ' + totalPages, PDF.pageW - PDF.margin, PDF.footerTop + 4.5, { align: 'right' });
        }

        doc.save(`Sales_${from}_to_${to}.pdf`);
        showToast('Sales PDF exported successfully!', 'success');
    } catch (err) {
        console.error('Export PDF error:', err);
        showToast('Failed to generate the sales PDF', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> PDF'; }
    }
}

// Date only, in the viewer's locale. shared.js has formatDateTime, but a sales
// row is a day, and printing a time of 00:00:00 next to every day reads as data
// the clinic does not have.
// '2026-09' as 'September 2026'.
function salesMonth(value) {
    const [y, m] = String(value || '').split('-').map(Number);
    return SALES_MONTHS[m - 1] ? `${SALES_MONTHS[m - 1]} ${y}` : String(value || '--');
}

function salesDay(value) {
    const d = new Date(value);
    return isNaN(d) ? String(value || '--') : d.toLocaleDateString();
}
