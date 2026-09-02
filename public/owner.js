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
    { id: 'walkin', label: 'Walk-in Intake', icon: 'fa-solid fa-person-walking-arrow-right' },
    { id: 'services', label: 'Service Management', icon: 'fa-solid fa-box-open' },
    { id: 'structures', label: 'Test Structures', icon: 'fa-solid fa-vials' },
    { id: 'create', label: 'Create Account', icon: 'fa-solid fa-user-plus' },
    { id: 'audits', label: 'Audit Logs', icon: 'fa-solid fa-file-shield' },
    { id: 'archive', label: 'Archive', icon: 'fa-solid fa-box-archive' },
    { id: 'customize', label: 'Customize', icon: 'fa-solid fa-palette' }
], 'dashboard');
initDefaultSection();

window.onSectionLoad = {
    walkin: loadWalkIns,
    structures: loadTestStructureAdmin,
    dashboard: loadOwnerDash,
    accounts: loadAccounts,
    labs: loadLabs,
    reports: loadReports,
    services: loadServiceMgmt,
    create: initCreateForm,
    audits: loadAuditLogs,
    archive: loadArchives,
    customize: loadCustomization
};

// ── ROLES THIS PAGE MAY ASSIGN ──
// The owner is the only role that can create other elevated accounts.
function populateRoleSelect(selectId, selected) {
    const roles = [
        { value: 'laboratory', label: 'Laboratory' },
        { value: 'frontdesk', label: 'Front Desk' },
        { value: 'doctor', label: 'Doctor' },
        { value: 'admintechnical', label: 'Admin Technical' },
        { value: 'admin', label: 'Admin' }
    ];
    const sel = document.getElementById(selectId);
    if (sel) sel.innerHTML = roles.map(r => `<option value="${r.value}" ${selected===r.value?'selected':''}>${r.label}</option>`).join('');
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
