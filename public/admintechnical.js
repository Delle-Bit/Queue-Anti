if (!requireAuth(['admintechnical','admin'])) throw new Error('Unauthorized');
const myRole = getRole();

renderSidebar([
    { section: 'ADMIN' },
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-chart-line' },
    { id: 'accounts', label: 'Manage Accounts', icon: 'fa-solid fa-users-gear' },
    { id: 'labs', label: 'Manage Laboratories', icon: 'fa-solid fa-flask-vial' },
    { id: 'services', label: 'Service Management', icon: 'fa-solid fa-box-open' },
    { id: 'create', label: 'Create Account', icon: 'fa-solid fa-user-plus' },
    { id: 'audit', label: 'Audit Logs', icon: 'fa-solid fa-history' },
    { id: 'customize', label: 'Customize', icon: 'fa-solid fa-palette' }
], 'dashboard');
initDefaultSection();

window.onSectionLoad = {
    dashboard: loadAdminDash,
    accounts: loadAccounts,
    labs: loadLabs,
    services: loadServiceMgmt,
    create: initCreateForm,
    audit: loadAuditLogs,
    customize: loadCustomization
};

// ── DASHBOARD ──
async function loadAdminDash() {
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
}

// ── ACCOUNTS ──
async function loadAccounts() {
    const [staffRes, custRes] = await Promise.all([
        fetch('/api/users/staff', { headers: authHeaders() }),
        fetch('/api/users/customers', { headers: authHeaders() })
    ]);
    const staff = await staffRes.json();
    const customers = await custRes.json();

    document.getElementById('staff-table').innerHTML = staff.map(s => `<tr>
        <td>${s.id}</td><td>${s.username}</td><td>${s.full_name||'--'}</td>
        <td><span class="badge badge-primary">${s.role}</span></td>
        <td>${formatDateTime(s.created_at)}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="editUser(${s.id},'${s.username}','${s.role}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${s.id})"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`).join('');

    document.getElementById('cust-table').innerHTML = customers.map(c => {
        const age = c.created_at ? Math.floor((Date.now() - new Date(c.created_at)) / 86400000) + 'd' : '--';
        return `<tr><td>${c.username}</td><td>${c.full_name||'--'}</td><td>${categoryBadge(c.customer_category)}</td><td>${c.total_services}</td><td>${age}</td></tr>`;
    }).join('');
}

function editUser(id, username, role) {
    document.getElementById('edit-user-id').value = id;
    document.getElementById('edit-username').value = username;
    document.getElementById('edit-password').value = '';
    populateRoleSelect('edit-role', role);
    openModal('user-modal');
}

async function updateUser() {
    const id = document.getElementById('edit-user-id').value;
    const body = { password: document.getElementById('edit-password').value, role: document.getElementById('edit-role').value };
    const res = await fetch(`/api/users/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    if (res.ok) { closeModal('user-modal'); showToast('Updated!', 'success'); loadAccounts(); }
    else showToast('Failed', 'error');
}

async function deleteUser(id) {
    if (!confirm('Delete this user?')) return;
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) { showToast('Deleted', 'success'); loadAccounts(); }
}

// ── LABS ──
async function loadLabs() {
    const res = await fetch('/api/laboratories', { headers: authHeaders() });
    const labs = await res.json();
    document.getElementById('labs-table').innerHTML = labs.map(l => `<tr>
        <td><strong>${l.name}</strong></td><td>${l.service_type||'--'}</td><td>${l.staff_name||'Unassigned'}</td>
        <td><span class="badge ${l.is_open?'badge-success':'badge-danger'}">${l.is_open?'Open':'Closed'}</span></td>
        <td><button class="btn btn-sm btn-secondary" onclick="editLab(${l.id})"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteLab(${l.id})"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`).join('');

    // Populate staff select in modal
    const staffRes = await fetch('/api/users/staff', { headers: authHeaders() });
    const staff = await staffRes.json();
    const labStaff = staff.filter(s => s.role === 'laboratory');
    document.getElementById('lab-staff').innerHTML = '<option value="">Unassigned</option>' +
        labStaff.map(s => `<option value="${s.id}">${s.username} (${s.full_name||''})</option>`).join('');
}

async function saveLab() {
    const id = document.getElementById('lab-edit-id').value;
    const body = {
        name: document.getElementById('lab-name').value,
        service_type: document.getElementById('lab-type').value,
        assigned_staff_id: document.getElementById('lab-staff').value || null
    };
    const url = id ? `/api/laboratories/${id}` : '/api/laboratories';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    if (res.ok) { closeModal('lab-modal'); showToast('Saved!', 'success'); loadLabs(); }
}

async function deleteLab(id) {
    if (!confirm('Delete this laboratory?')) return;
    await fetch(`/api/laboratories/${id}`, { method: 'DELETE', headers: authHeaders() });
    showToast('Deleted', 'success'); loadLabs();
}

function editLab(id) {
    // Simple: just open modal with blank for now
    document.getElementById('lab-edit-id').value = id;
    openModal('lab-modal');
}

// ── CREATE ACCOUNT ──
function initCreateForm() {
    populateRoleSelect('new-role');
}

function populateRoleSelect(selectId, selected) {
    let roles = [
        { value: 'laboratory', label: 'Laboratory' },
        { value: 'frontdesk', label: 'Front Desk' }
    ];
    if (myRole === 'admintechnical') {
        roles.push({ value: 'admin', label: 'Admin' });
    }
    const sel = document.getElementById(selectId);
    sel.innerHTML = roles.map(r => `<option value="${r.value}" ${selected===r.value?'selected':''}>${r.label}</option>`).join('');
}

async function createAccount() {
    const body = {
        username: document.getElementById('new-username').value,
        full_name: document.getElementById('new-fullname').value,
        email: document.getElementById('new-email').value,
        password: document.getElementById('new-password').value,
        role: document.getElementById('new-role').value
    };
    if (!body.username || !body.password) return showToast('Fill required fields', 'error');
    const res = await fetch('/api/users', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    if (res.ok) {
        showToast('Account created!', 'success');
        document.getElementById('new-username').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('new-fullname').value = '';
        document.getElementById('new-email').value = '';
    } else {
        const data = await res.json();
        showToast(data.error || 'Failed', 'error');
    }
}

loadAdminDash();
initCreateForm();

// ── AUDIT LOGS ──
async function loadAuditLogs() {
    try {
        const res = await fetch('/api/analytics/admin', { headers: authHeaders() });
        const data = await res.json();
        const logs = data.auditLogs || []; // Wait, the endpoint may not return auditLogs. We need to fetch from /api/admin/audit-logs
    } catch(err) {}
}

async function fetchAuditLogs() {
    try {
        const res = await fetch('/api/admin/audit-logs', { headers: authHeaders() });
        if(res.ok) {
            const logs = await res.json();
            document.getElementById('audit-table').innerHTML = logs.map(l => `<tr>
                <td>${formatDateTime(l.created_at)}</td>
                <td>${l.username || 'System'}</td>
                <td><span class="badge badge-neutral">${l.action}</span></td>
                <td>${l.entity_type}</td>
                <td>${l.entity_id}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title='${l.details}'>${l.details}</td>
            </tr>`).join('');
        }
    } catch (err) {}
}
window.loadAuditLogs = fetchAuditLogs;

// ── CUSTOMIZATION ──
async function loadCustomization() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        if(settings) {
            document.getElementById('cust-nav-color').value = settings.navbar_color || '#1e293b';
            document.getElementById('cust-nav-color-text').value = settings.navbar_color || '#1e293b';
            document.getElementById('cust-bg-url').value = settings.background_image || '';
        }
    } catch(err) {}
}

async function saveCustomization() {
    const navColor = document.getElementById('cust-nav-color').value;
    const bgUrl = document.getElementById('cust-bg-url').value;
    try {
        const res = await fetch('/api/admin/settings', {
            method: 'PUT', headers: authHeaders(),
            body: JSON.stringify({ navbar_color: navColor, background_image: bgUrl })
        });
        if(res.ok) { showToast('Settings saved!', 'success'); }
        else { showToast('Failed to save settings', 'error'); }
    } catch(err) {}
}

// ── SERVICE MANAGEMENT ──
let allLabs = [];
async function fetchAllLabs() {
    const res = await fetch('/api/laboratories', { headers: authHeaders() });
    allLabs = await res.json();
}
fetchAllLabs();

async function loadServiceMgmt() {
    const res = await fetch('/api/packages');
    const pkgs = await res.json();
    document.getElementById('svc-list').innerHTML = pkgs.map(p => `<tr>
        <td><strong>${p.name}</strong></td><td>${formatCurrency(p.price)}</td><td>${p.est_time_minutes}m</td>
        <td>${(p.laboratories||[]).map(l=>l.lab_name).join(' → ') || 'None'}</td>
        <td><span class="badge ${p.is_active?'badge-success':'badge-danger'}">${p.is_active?'Active':'Inactive'}</span></td>
        <td><button class="btn btn-sm btn-secondary" onclick='editService(${JSON.stringify(p).replace(/'/g,"&apos;")})'><i class="fa-solid fa-pen"></i></button></td>
    </tr>`).join('');
}

function editService(pkg) {
    document.getElementById('svc-edit-id').value = pkg.id;
    document.getElementById('svc-name').value = pkg.name;
    document.getElementById('svc-desc').value = pkg.description || '';
    document.getElementById('svc-price').value = pkg.price;
    document.getElementById('svc-modal-title').textContent = 'Edit Service Package';
    renderLabSequence(pkg.laboratories || []);
    openModal('svc-modal');
}

let labSequence = [];
let draggedLabIndex = null;
window.dragLab = function(e, i) { draggedLabIndex = i; e.dataTransfer.effectAllowed = 'move'; }
window.allowDropLab = function(e) { e.preventDefault(); }
window.dropLab = function(e, targetI) {
    e.preventDefault();
    if (draggedLabIndex === null || draggedLabIndex === targetI) return;
    const item = labSequence.splice(draggedLabIndex, 1)[0];
    labSequence.splice(targetI, 0, item);
    renderLabSequence(labSequence);
}

function renderLabSequence(labs) {
    labSequence = labs || [];
    const container = document.getElementById('svc-lab-list');
    container.innerHTML = labSequence.map((l, i) => `
        <div class="flex-between" draggable="true" ondragstart="dragLab(event, ${i})" ondragover="allowDropLab(event)" ondrop="dropLab(event, ${i})" style="padding:8px;background:var(--bg-input);border-radius:8px;margin-bottom:6px;cursor:grab;">
            <span><i class="fa-solid fa-grip-vertical text-muted mr-sm"></i> <strong>${i+1}.</strong> ${allLabs.find(x=>x.id==l.laboratory_id)?.name || 'Lab #'+l.laboratory_id}</span>
            <button class="btn btn-sm btn-danger btn-icon" onclick="removeLabStep(${i})"><i class="fa-solid fa-trash"></i></button>
        </div>
    `).join('');
}

function addLabToSequence() {
    const sel = document.getElementById('lab-select-dropdown');
    sel.innerHTML = allLabs.map(l => `<option value="${l.id}">${l.name} (${l.service_type})</option>`).join('');
    openModal('select-lab-modal');
}
window.confirmAddLab = function() {
    const sel = document.getElementById('lab-select-dropdown').value;
    if (sel) { labSequence.push({ laboratory_id: parseInt(sel), est_time_minutes: 10 }); renderLabSequence(labSequence); }
    closeModal('select-lab-modal');
}
function removeLabStep(i) { labSequence.splice(i, 1); renderLabSequence(labSequence); }

async function saveService() {
    const id = document.getElementById('svc-edit-id').value;
    let finalLabs = labSequence;
    let est_time_minutes = 15;
    try {
        const estRes = await fetch('/api/packages/estimate-time', {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ laboratories: labSequence })
        });
        const estData = await estRes.json();
        est_time_minutes = estData.total;
        finalLabs = estData.laboratories;
    } catch(err) { console.warn('AI Estimation failed'); }

    const body = {
        name: document.getElementById('svc-name').value,
        description: document.getElementById('svc-desc').value,
        price: parseFloat(document.getElementById('svc-price').value),
        est_time_minutes: est_time_minutes,
        laboratories: finalLabs
    };
    const url = id ? `/api/packages/${id}` : '/api/packages';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    if (res.ok) { closeModal('svc-modal'); showToast('Saved!', 'success'); loadServiceMgmt(); }
    else showToast('Failed to save', 'error');
}
