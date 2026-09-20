if (!requireAuth(['owner'])) throw new Error('Unauthorized');

// Manage Accounts, Manage Laboratories, Service Management, Audit Logs and
// Archives are identical to the admin dashboard's and live in admin-shared.js.
// What stays here is what is genuinely this page's: its sidebar, the owner
// dashboard, and the AI reports.

renderSidebar([
    { section: 'OWNER' },
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-building-columns' },
    { id: 'accounts', label: 'Manage Accounts', icon: 'fa-solid fa-users-gear' },
    { id: 'labs', label: 'Manage Laboratories', icon: 'fa-solid fa-flask-vial' },
    { id: 'reports', label: 'AI Reports', icon: 'fa-solid fa-chart-line' },
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
    reports: loadReports,
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

// ── REPORTS ──
async function loadReports() {
    const period = document.getElementById('report-period').value;
    const aiBox = document.getElementById('ai-report-summary');
    aiBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating insights...';

    try {
        const res = await fetch(`/api/reports/summary?period=${period}`, { headers: authHeaders() });
        const data = await res.json();

        if (data.success) {
            document.getElementById('rep-vol').textContent = data.stats.patientVolume;
            document.getElementById('rep-wait').textContent = data.stats.waitTimeAvg + 'm';
            document.getElementById('rep-rev').textContent = '₱' + data.stats.revenue.toLocaleString();
            document.getElementById('rep-top').textContent = data.stats.topService;

            aiBox.innerHTML = data.aiSummary;
        } else {
            aiBox.innerHTML = '<span class="text-danger">Failed to load reports.</span>';
        }
    } catch (err) {
        aiBox.innerHTML = '<span class="text-danger">Error connecting to server.</span>';
    }
}

fetchAllLabs();
loadOwnerDash();

// ── SALES REPORT ───────────────────────────────────────────────
// Money only: every figure is what the cashier recorded at the opening front
// desk step, so a Senior's 20 percent is already off it. The AI Reports screen
// above still reports the package price list, which is a different question.
function salesDateValue(d) {
    // Local date, not toISOString - that converts to UTC and in Manila reports
    // yesterday for anything before 8am.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setSalesRange(range) {
    const today = new Date();
    let from = new Date(today), to = new Date(today);
    if (range === 'week') from.setDate(today.getDate() - 6);
    if (range === 'month') from = new Date(today.getFullYear(), today.getMonth(), 1);
    if (range === 'lastmonth') {
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0);
    }
    if (range === 'year') from = new Date(today.getFullYear(), 0, 1);
    document.getElementById('sales-from').value = salesDateValue(from);
    document.getElementById('sales-to').value = salesDateValue(to);
    loadSalesReport();
}

function initSalesReport() {
    if (!document.getElementById('sales-from').value) {
        setSalesRange('month');
        return;
    }
    loadSalesReport();
}

const SALES_LABELS = {
    none: 'No discount', senior: 'Senior (20%)', pwd: 'PWD (20%)', other: 'Other',
    cash: 'Cash', gcash: 'GCash', card: 'Card', bank: 'Bank transfer', hmo: 'HMO',
    online: 'Joined online', appointment: 'Appointment', walkin: 'Walk-in',
    unrecorded: 'Not recorded'
};
const salesLabel = key => SALES_LABELS[key] || key || '--';

async function loadSalesReport() {
    const from = document.getElementById('sales-from').value;
    const to = document.getElementById('sales-to').value;
    if (!from || !to) return showToast('Choose both dates', 'error');

    const body = id => document.getElementById(id);
    skeletonValue(['sales-net', 'sales-visits', 'sales-discount', 'sales-average']);
    try {
        const res = await fetch(`/api/reports/sales?from=${from}&to=${to}`, { headers: authHeaders() });
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
        if (t.unrecorded) {
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

        body('sales-by-day').innerHTML = data.by_day.length ? data.by_day.map(r => `<tr>
            <td>${salesDay(r.day)}</td><td>${r.visits}</td>
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

// The browser's own printing. Only one section is on screen at a time and the
// print rules in shared.css drop the sidebar and the buttons, so what prints is
// this report - a second HTML document written into a popup would be a second
// copy of the same tables to keep in step.
function printSalesReport() {
    window.print();
}

// Date only, in the viewer's locale. shared.js has formatDateTime, but a sales
// row is a day, and printing a time of 00:00:00 next to every day reads as data
// the clinic does not have.
function salesDay(value) {
    const d = new Date(value);
    return isNaN(d) ? String(value || '--') : d.toLocaleDateString();
}
