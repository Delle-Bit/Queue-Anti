if (!requireAuth(['admintechnical','admin'])) throw new Error('Unauthorized');
const myRole = getRole();

// Manage Accounts, Manage Laboratories, Service Management, Audit Logs and
// Archives are identical to the owner dashboard's and live in admin-shared.js.
// What stays here is what is genuinely this page's: its sidebar, its dashboard,
// and which roles it is allowed to create.

renderSidebar([
    { section: 'ADMIN' },
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-chart-line' },
    { id: 'accounts', label: 'Manage Accounts', icon: 'fa-solid fa-users-gear' },
    { id: 'labs', label: 'Manage Laboratories', icon: 'fa-solid fa-flask-vial' },
    { id: 'services', label: 'Service Management', icon: 'fa-solid fa-box-open' },
    { id: 'structures', label: 'Test Structures', icon: 'fa-solid fa-vials' },
    { id: 'archives', label: 'Archives', icon: 'fa-solid fa-box-archive' },
    { id: 'create', label: 'Create Account', icon: 'fa-solid fa-user-plus' },
    { id: 'audit', label: 'Audit Logs', icon: 'fa-solid fa-history' },
    { id: 'customize', label: 'Customize', icon: 'fa-solid fa-palette' }
], 'dashboard');
initDefaultSection();

window.onSectionLoad = {
    structures: loadTestStructureAdmin,
    dashboard: loadAdminDash,
    accounts: loadAccounts,
    labs: loadLabs,
    services: loadServiceMgmt,
    archives: loadArchives,
    create: initCreateForm,
    audit: loadAuditLogs,
    customize: loadCustomization
};

// ── DASHBOARD ──
async function loadAdminDash() {
    // The stat strip has no markup of its own - without a placeholder the row
    // is zero-height and everything below it jumps down when the cards arrive.
    //
    // One card, not a guess at several: the strip is one card for the front
    // desk plus one per laboratory that saw a patient today, so the count is
    // not known until the fetch lands. One is the number that is always there,
    // and at a narrow viewport this strip is a single column - every extra
    // placeholder card would be another 110px of shift when it turns out not
    // to exist. Measured with real data: three placeholders for one real card
    // moved everything below down by 220px.
    skeletonStats('admin-stats', { count: 1 });
    skeletonLines('admin-role-dist', { rows: 4 });
    skeletonTable('admin-sessions', { rows: 4, cols: 3 });
    try {
        const res = await fetch('/api/analytics/admin', { headers: authHeaders() });
        const data = await res.json();
        const statsHtml = `
            <div class="stat-card"><div class="stat-icon blue"><i class="fa-solid fa-cash-register"></i></div><div class="stat-info"><div class="stat-label">Frontdesk Volume</div><div class="stat-value">${data.fdVolume}</div></div></div>
            ${(data.labVolume||[]).map(l => `<div class="stat-card"><div class="stat-icon green"><i class="fa-solid fa-flask"></i></div><div class="stat-info"><div class="stat-label">Lab #${l.station_id} Volume</div><div class="stat-value">${l.cnt}</div></div></div>`).join('')}
        `;
        document.getElementById('admin-stats').innerHTML = statsHtml;

        document.getElementById('admin-role-dist').innerHTML = (data.userCounts||[]).map(u =>
            `<div class="flex-between" style="padding:6px 0;"><span>${u.role}</span><span class="fw-600">${u.cnt}</span></div>`
        ).join('');

        document.getElementById('admin-sessions').innerHTML = (data.sessions||[]).map(s =>
            `<tr><td>${s.username}</td><td>${formatDateTime(s.login_time)}</td><td>${s.logout_time ? formatDateTime(s.logout_time) : '<span class="badge badge-success">Active</span>'}</td></tr>`
        ).join('');
    } catch (err) { console.error(err); }
    clearSkeleton('admin-stats', 'admin-role-dist', 'admin-sessions');
}

// ── ROLES THIS PAGE MAY ASSIGN ──
// A plain admin cannot create or promote to admin; only admintechnical can.
// The server enforces the same rule (ELEVATED_ROLES in routes/admin.js) - this
// is only about not offering a choice that would be rejected.
function populateRoleSelect(selectId, selected) {
    let roles = [
        { value: 'laboratory', label: 'Laboratory' },
        { value: 'frontdesk', label: 'Front Desk' },
        { value: 'doctor', label: 'Doctor' }
    ];
    // The technical administrator can already edit an owner account - the guard
    // in PUT /users/:id only restricts a plain `admin` - so withholding the
    // option bought no safety and left nobody able to restore the role after it
    // was lost. A plain admin still gets neither option, and the server refuses
    // them either way.
    if (myRole === 'admintechnical') {
        roles.push({ value: 'admin', label: 'Admin' });
        roles.push({ value: 'admintechnical', label: 'Admin Technical' });
        roles.push({ value: 'owner', label: 'Owner' });
    }
    renderRoleOptions(selectId, roles, selected);
}

fetchAllLabs();
loadAdminDash();
initCreateForm();
