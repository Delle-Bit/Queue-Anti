/* ================================================================
   MEDICAL CLINIC — Admin console, shared by admintechnical + owner
   ================================================================

   admintechnical.html and owner.html host the same Manage Accounts, Manage
   Laboratories, Service Management, Audit Log and Archives screens. Those five
   screens previously existed as two near-identical copies in admintechnical.js
   and owner.js, which had already drifted apart (different confirm prompts,
   different archive columns, one page missing the purge action). They live here
   once instead.

   Each page still owns what is genuinely its own: its sidebar, its dashboard,
   which roles it may create, and - for the owner - the AI reports and the
   account-deletion log.

   Requires shared.js (authHeaders, showToast, confirmAction, promptReason,
   matchesSearch, debounce, escapeHtml, formatDateTime, formatCurrency).
*/

// Every mutating call on these screens sends a reason, and the server rejects it
// without one - see audit.js. `presets` are one-click common answers so the
// requirement is a prompt rather than an obstacle.
const REASON_PRESETS = {
    userUpdate: ['Password reset at the staff member’s request', 'Role changed after a transfer', 'Correcting a data-entry error'],
    userDelete: ['Staff member has left the clinic', 'Duplicate account', 'Created by mistake'],
    userCreate: ['New staff member onboarded', 'Replacing a departed staff member'],
    labUpdate: ['Reassigned to different staff', 'Renamed for clarity', 'Correcting the service type'],
    labCreate: ['New laboratory section opened'],
    labDelete: ['Section closed', 'Duplicate entry', 'Equipment retired'],
    restore: ['Archived by mistake', 'Needed again', 'Reversing an incorrect deletion'],
    purge: ['Data retention period elapsed', 'Duplicate record confirmed', 'Requested by the data subject']
};

// ── MANAGE ACCOUNTS ─────────────────────────────────────────────────────────
// Search runs server-side (/api/users/staff?q=, /api/users/customers?q=) so it
// keeps working once the customer table is larger than a page of results, and
// matches on account ID, patient UID, username, name, email and role.

let staffCache = [];
let customerCache = [];

async function loadAccounts() {
    const staffTerm = document.getElementById('staff-search')?.value || '';
    const staffRole = document.getElementById('staff-role-filter')?.value || '';
    const custTerm = document.getElementById('cust-search')?.value || '';
    const custCategory = document.getElementById('cust-category-filter')?.value || '';

    const staffQuery = new URLSearchParams();
    if (staffTerm.trim()) staffQuery.set('q', staffTerm.trim());
    if (staffRole) staffQuery.set('role', staffRole);
    const custQuery = new URLSearchParams();
    if (custTerm.trim()) custQuery.set('q', custTerm.trim());
    if (custCategory) custQuery.set('category', custCategory);

    if (skeletonFirstLoad('admin-accounts')) {
        // Role and category are badges; the last column is a pair of buttons.
        skeletonTable('staff-table', { rows: 5, cols: [
            'skel-line skel-w-30', 'skel-line skel-w-60', 'skel-line skel-w-80',
            'skel-pill skel-w-60', 'skel-line skel-w-70', 'skel-btn'
        ] });
        skeletonTable('cust-table', { rows: 5, cols: [
            'skel-line skel-w-30', 'skel-line skel-w-60', 'skel-line skel-w-80',
            'skel-pill skel-w-60', 'skel-line skel-w-30', 'skel-line skel-w-50'
        ] });
    }

    try {
        const [staffRes, custRes] = await Promise.all([
            fetch(`/api/users/staff?${staffQuery}`, { headers: authHeaders() }),
            fetch(`/api/users/customers?${custQuery}`, { headers: authHeaders() })
        ]);
        staffCache = await staffRes.json();
        customerCache = await custRes.json();
    } catch (err) {
        showToast('Failed to load accounts', 'error');
        clearSkeleton('staff-table', 'cust-table');
        return;
    }
    renderStaffTable();
    renderCustomerTable();
    clearSkeleton('staff-table', 'cust-table');
}

const searchAccounts = debounce(loadAccounts, 250);

function renderStaffTable() {
    const body = document.getElementById('staff-table');
    if (!body) return;
    const count = document.getElementById('staff-count');
    if (count) count.textContent = `${staffCache.length} staff account(s)`;

    body.innerHTML = staffCache.length === 0
        ? '<tr><td colspan="6" class="text-center text-muted">No staff accounts match this search.</td></tr>'
        : staffCache.map(s => `<tr>
            <td>${s.id}</td>
            <td>${escapeHtml(s.username)}</td>
            <td>${escapeHtml(s.full_name || '--')}<br><small class="text-muted">${escapeHtml(s.email || '')}</small></td>
            <td><span class="badge badge-primary">${escapeHtml(s.role)}</span></td>
            <td>${formatDateTime(s.created_at)}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="editUser(${s.id})" title="Edit account"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" onclick="deleteUser(${s.id})" title="Archive account"><i class="fa-solid fa-box-archive"></i></button></td>
        </tr>`).join('');
}

function renderCustomerTable() {
    const body = document.getElementById('cust-table');
    if (!body) return;
    const count = document.getElementById('cust-count');
    if (count) count.textContent = `${customerCache.length} customer account(s)`;

    body.innerHTML = customerCache.length === 0
        ? '<tr><td colspan="6" class="text-center text-muted">No customers match this search.</td></tr>'
        : customerCache.map(c => {
            const days = c.created_at ? Math.floor((Date.now() - new Date(c.created_at)) / 86400000) + 'd' : '--';
            return `<tr>
                <td>${escapeHtml(c.customer_uid || String(c.id))}</td>
                <td>${escapeHtml(c.username)}</td>
                <td>${escapeHtml(c.full_name || '--')}</td>
                <td>${categoryBadge(c.customer_category)}</td>
                <td>${c.total_services}</td>
                <td>${days}</td>
            </tr>`;
        }).join('');
}

function editUser(id) {
    const staff = staffCache.find(s => s.id == id);
    if (!staff) return showToast('Account not found', 'error');
    document.getElementById('edit-user-id').value = staff.id;
    document.getElementById('edit-username').value = staff.username;
    document.getElementById('edit-password').value = '';
    populateRoleSelect('edit-role', staff.role);
    openModal('user-modal');
}

async function updateUser() {
    const id = document.getElementById('edit-user-id').value;
    const staff = staffCache.find(s => s.id == id) || {};
    const reason = await promptReason({
        title: `Reason for changing "${staff.username || id}"`,
        message: 'Account changes are recorded in the audit log against your own account.',
        placeholder: 'e.g. password reset after the staff member was locked out',
        confirmLabel: 'Save changes',
        presets: REASON_PRESETS.userUpdate
    });
    if (!reason) return;

    const body = {
        password: document.getElementById('edit-password').value,
        role: document.getElementById('edit-role').value,
        email: staff.email || '',
        full_name: staff.full_name || '',
        reason
    };
    const res = await fetch(`/api/users/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { closeModal('user-modal'); showToast('Account updated', 'success'); loadAccounts(); }
    else showToast(data.error || 'Failed to update account', 'error');
}

async function deleteUser(id) {
    const staff = staffCache.find(s => s.id == id) || {};
    const label = staff.full_name || staff.username || `#${id}`;
    const confirmed = await confirmAction({
        title: 'Archive this account?',
        message: `"${label}" will no longer be able to sign in.`,
        detail: 'The account is archived, not deleted — it can be restored from Archives.',
        icon: 'fa-solid fa-box-archive',
        confirmLabel: 'Archive account',
        confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    const reason = await promptReason({
        title: `Why archive "${label}"?`,
        placeholder: 'e.g. staff member resigned effective this month',
        confirmLabel: 'Archive account',
        confirmClass: 'btn-danger',
        presets: REASON_PRESETS.userDelete
    });
    if (!reason) return;

    const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ reason })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { showToast('Account archived', 'success'); loadAccounts(); }
    else showToast(data.error || 'Failed to archive account', 'error');
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

    const reason = await promptReason({
        title: `Reason for creating "${body.username}"`,
        placeholder: 'e.g. new front desk staff started today',
        confirmLabel: 'Create account',
        presets: REASON_PRESETS.userCreate
    });
    if (!reason) return;
    body.reason = reason;

    const res = await fetch('/api/users', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
        showToast('Account created', 'success');
        ['new-username', 'new-password', 'new-fullname', 'new-email'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    } else {
        showToast(data.error || 'Failed to create account', 'error');
    }
}

function initCreateForm() {
    populateRoleSelect('new-role');
}

// ── MANAGE LABORATORIES ─────────────────────────────────────────────────────
let labsCache = [];

async function loadLabs() {
    if (skeletonFirstLoad('admin-labs')) {
        skeletonTable('labs-table', { rows: 4, cols: [
            'skel-line skel-w-70', 'skel-line skel-w-60', 'skel-line skel-w-60',
            'skel-pill skel-w-50', 'skel-btn'
        ] });
    }
    const res = await fetch('/api/laboratories', { headers: authHeaders() });
    labsCache = await res.json();
    const body = document.getElementById('labs-table');
    if (body) {
        body.innerHTML = labsCache.length === 0
            ? '<tr><td colspan="5" class="text-center text-muted">No laboratories yet.</td></tr>'
            : labsCache.map(l => `<tr>
                <td><strong>${escapeHtml(l.name)}</strong></td>
                <td>${escapeHtml(l.service_type || '--')}</td>
                <td>${escapeHtml(l.staff_name || 'Unassigned')}</td>
                <td><span class="badge ${l.is_open ? 'badge-success' : 'badge-danger'}">${l.is_open ? 'Open' : 'Closed'}</span></td>
                <td><button class="btn btn-sm btn-secondary" onclick="editLab(${l.id})"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-sm btn-danger" onclick="deleteLab(${l.id})" title="Archive laboratory"><i class="fa-solid fa-box-archive"></i></button></td>
            </tr>`).join('');
    }

    // Only laboratory staff can be assigned to a laboratory station.
    const select = document.getElementById('lab-staff');
    if (select) {
        const staffRes = await fetch('/api/users/staff?role=laboratory', { headers: authHeaders() });
        const labStaff = await staffRes.json();
        select.innerHTML = '<option value="">Unassigned</option>' +
            labStaff.map(s => `<option value="${s.id}">${escapeHtml(s.username)} (${escapeHtml(s.full_name || '')})</option>`).join('');
    }
}

async function saveLab() {
    const id = document.getElementById('lab-edit-id').value;
    const existing = id ? labsCache.find(l => l.id == id) : null;
    const name = document.getElementById('lab-name').value;

    const reason = await promptReason({
        title: id ? `Reason for changing "${existing?.name || name}"` : `Reason for adding "${name}"`,
        placeholder: id ? 'e.g. reassigned to the new RMT on this section' : 'e.g. new section commissioned',
        confirmLabel: id ? 'Save changes' : 'Add laboratory',
        presets: id ? REASON_PRESETS.labUpdate : REASON_PRESETS.labCreate
    });
    if (!reason) return;

    const body = {
        name,
        service_type: document.getElementById('lab-type').value,
        assigned_staff_id: document.getElementById('lab-staff').value || null,
        // Preserved rather than defaulted: this form does not render the opening
        // hours or the open/closed switch, and sending defaults would silently
        // reset them on every edit.
        is_open: existing ? existing.is_open : true,
        start_time: existing ? existing.start_time : null,
        cutoff_time: existing ? existing.cutoff_time : null,
        reason
    };
    const res = await fetch(id ? `/api/laboratories/${id}` : '/api/laboratories', {
        method: id ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { closeModal('lab-modal'); showToast('Saved', 'success'); loadLabs(); fetchAllLabs(); }
    else showToast(data.error || 'Failed to save', 'error');
}

async function deleteLab(id) {
    const lab = labsCache.find(l => l.id == id) || {};
    const confirmed = await confirmAction({
        title: 'Archive this laboratory?',
        message: `"${lab.name || id}" will be removed from service routes and staff dashboards.`,
        detail: 'It is archived, not deleted — it can be restored from Archives.',
        icon: 'fa-solid fa-box-archive',
        confirmLabel: 'Archive laboratory',
        confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    const reason = await promptReason({
        title: `Why archive "${lab.name || id}"?`,
        placeholder: 'e.g. section permanently closed',
        confirmLabel: 'Archive laboratory',
        confirmClass: 'btn-danger',
        presets: REASON_PRESETS.labDelete
    });
    if (!reason) return;

    const res = await fetch(`/api/laboratories/${id}`, {
        method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ reason })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { showToast('Laboratory archived', 'success'); loadLabs(); fetchAllLabs(); }
    else showToast(data.error || 'Failed to archive', 'error');
}

function prepareNewLab() {
    document.getElementById('lab-edit-id').value = '';
    document.getElementById('lab-name').value = '';
    document.getElementById('lab-type').value = '';
    document.getElementById('lab-staff').value = '';
    const title = document.getElementById('lab-modal-title');
    if (title) title.textContent = 'Add Laboratory';
    openModal('lab-modal');
}

function editLab(id) {
    const lab = labsCache.find(l => l.id == id);
    if (!lab) return;
    document.getElementById('lab-edit-id').value = lab.id;
    document.getElementById('lab-name').value = lab.name || '';
    document.getElementById('lab-type').value = lab.service_type || '';
    document.getElementById('lab-staff').value = lab.assigned_staff_id || '';
    const title = document.getElementById('lab-modal-title');
    if (title) title.textContent = 'Edit Laboratory';
    openModal('lab-modal');
}

// ── SERVICE MANAGEMENT ──────────────────────────────────────────────────────
let allLabs = [];
let allDoctors = [];
let allServices = [];
let labSequence = [];
let draggedLabIndex = null;

async function fetchAllLabs() {
    const [labRes, doctorRes] = await Promise.all([
        fetch('/api/laboratories', { headers: authHeaders() }),
        fetch('/api/doctors', { headers: authHeaders() })
    ]);
    allLabs = await labRes.json();
    allDoctors = await doctorRes.json();
    populateDoctorSelect();
}

async function loadServiceMgmt() {
    if (skeletonFirstLoad('admin-services')) {
        // The station route column is the tall one - it lists every stop from
        // the front desk and back, and wraps to about three lines.
        skeletonTable('svc-list', { rows: 5, cols: [
            'skel-line skel-w-30', 'skel-line skel-w-80', 'skel-pill skel-w-60',
            'skel-line skel-w-50', 'skel-line skel-w-40',
            ['skel-line skel-w-90', 'skel-line skel-w-80', 'skel-line skel-w-50',
             'skel-line skel-w-40 skel-sm'],
            'skel-pill skel-w-50', 'skel-btn'
        ] });
    }
    await fetchAllLabs();
    const res = await fetch('/api/packages');
    allServices = await res.json();
    populateCategoryControls(allServices);
    renderServiceList();
}

// Both the filter dropdown and the editor's autocomplete are filled from the
// categories actually in use, so neither offers a value that matches nothing.
function populateCategoryControls(services) {
    const categories = [...new Set(services.map(p => p.category).filter(Boolean))].sort();
    const filter = document.getElementById('svc-category-filter');
    if (filter) {
        const current = filter.value;
        filter.innerHTML = '<option value="">All categories</option>' +
            categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        filter.value = current;
    }
    const list = document.getElementById('svc-category-options');
    if (list) list.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
}

function renderServiceList() {
    const body = document.getElementById('svc-list');
    if (!body) return;
    clearSkeleton(body);
    const term = document.getElementById('svc-search')?.value || '';
    const category = document.getElementById('svc-category-filter')?.value || '';
    const rows = allServices.filter(p =>
        (!category || p.category === category) &&
        matchesSearch({ ...p, id_text: String(p.id) }, term, ['id_text', 'name', 'category', 'description']));

    const count = document.getElementById('svc-count');
    if (count) count.textContent = `${rows.length} of ${allServices.length} services`;

    body.innerHTML = rows.length === 0
        ? '<tr><td colspan="8" class="text-center text-muted">No services match this search.</td></tr>'
        : rows.map(p => `<tr>
            <td>${p.id}</td>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td><span class="badge badge-neutral">${escapeHtml(p.category || 'General')}</span></td>
            <td>${formatCurrency(p.price)}</td>
            <td>${p.est_time_minutes}m</td>
            <td>${serviceRouteLabel(p)}</td>
            <td>${p.is_available === false
                    ? '<span class="badge badge-danger">Currently Unavailable</span>'
                    : `<span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">${p.is_active ? 'Active' : 'Inactive'}</span>`}</td>
            <td><button class="btn btn-sm btn-secondary" onclick='editService(${JSON.stringify(p).replace(/'/g, "&apos;")})'><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" onclick="archiveService(${p.id}, '${escapeHtml(p.name).replace(/'/g, "&apos;")}')" title="Archive service"><i class="fa-solid fa-box-archive"></i></button></td>
        </tr>`).join('');
}

// Both front desk bookends are shown, because both are real stops the patient
// makes: the route is not "lab, lab" but "pay, lab, lab, close out".
function serviceRouteLabel(p) {
    const middle = (p.laboratories || []).map(l => l.lab_name);
    if (p.doctor_name) middle.push(/^dr\.?\s/i.test(p.doctor_name) ? p.doctor_name : 'Dr. ' + p.doctor_name);
    return ['Front Desk', ...middle, 'Front Desk'].map(escapeHtml).join(' → ');
}

function editService(pkg) {
    document.getElementById('svc-edit-id').value = pkg.id;
    document.getElementById('svc-name').value = pkg.name;
    document.getElementById('svc-desc').value = pkg.description || '';
    document.getElementById('svc-price').value = pkg.price;
    document.getElementById('svc-category').value = pkg.category || '';
    document.getElementById('svc-doctor').value = pkg.doctor_id || '';
    document.getElementById('svc-modal-title').textContent = 'Edit Service Package';
    renderLabSequence(pkg.laboratories || []);
    openModal('svc-modal');
}

function prepareNewService() {
    document.getElementById('svc-edit-id').value = '';
    document.getElementById('svc-name').value = '';
    document.getElementById('svc-desc').value = '';
    document.getElementById('svc-price').value = '';
    document.getElementById('svc-category').value = '';
    document.getElementById('svc-doctor').value = '';
    document.getElementById('svc-modal-title').textContent = 'Add Service Package';
    renderLabSequence([]);
    openModal('svc-modal');
}

window.dragLab = function (e, i) { draggedLabIndex = i; e.dataTransfer.effectAllowed = 'move'; };
window.allowDropLab = function (e) { e.preventDefault(); };
window.dropLab = function (e, targetI) {
    e.preventDefault();
    if (draggedLabIndex === null || draggedLabIndex === targetI) return;
    const item = labSequence.splice(draggedLabIndex, 1)[0];
    labSequence.splice(targetI, 0, item);
    renderLabSequence(labSequence);
};

// Both front desk steps render as locked. The queue engine adds them to every
// route (composeServiceSteps in queue_automation.js) and neither is stored in
// the editable station list, so the draggable stations are numbered from 2.
function renderLabSequence(labs) {
    labSequence = labs || [];
    const container = document.getElementById('svc-lab-list');
    if (!container) return;
    const lockedStep = (position, note) => `
        <div class="flex-between" style="padding:8px;background:var(--danger-light);border-left:3px solid var(--primary);border-radius:8px;margin-bottom:6px;">
            <span><i class="fa-solid fa-lock text-muted mr-sm"></i> <strong>${position}.</strong> Front Desk
                <small class="text-muted">(${note})</small></span>
        </div>`;
    container.innerHTML =
        lockedStep(1, 'cashier &mdash; always first') +
        labSequence.map((l, i) => `
        <div class="flex-between" draggable="true" ondragstart="dragLab(event, ${i})" ondragover="allowDropLab(event)" ondrop="dropLab(event, ${i})" style="padding:8px;background:var(--bg-input);border-radius:8px;margin-bottom:6px;cursor:grab;">
            <span><i class="fa-solid fa-grip-vertical text-muted mr-sm"></i> <strong>${i + 2}.</strong> ${escapeHtml(l.lab_name || allLabs.find(x => x.id == l.laboratory_id)?.name || 'Lab #' + l.laboratory_id)}</span>
            <button class="btn btn-sm btn-danger btn-icon" onclick="removeLabStep(${i})"><i class="fa-solid fa-trash"></i></button>
        </div>`).join('') +
        lockedStep(labSequence.length + 2, 'finalization &mdash; always last');
}

function addLabToSequence() {
    const sel = document.getElementById('lab-select-dropdown');
    sel.innerHTML = allLabs.map(l => `<option value="${l.id}">${escapeHtml(l.name)} (${escapeHtml(l.service_type || '')})</option>`).join('');
    openModal('select-lab-modal');
}

window.confirmAddLab = function () {
    const sel = document.getElementById('lab-select-dropdown').value;
    if (sel) { labSequence.push({ laboratory_id: parseInt(sel, 10), est_time_minutes: 10 }); renderLabSequence(labSequence); }
    closeModal('select-lab-modal');
};

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
    } catch (err) { console.warn('AI estimation failed, using defaults'); }

    const body = {
        name: document.getElementById('svc-name').value,
        description: document.getElementById('svc-desc').value,
        price: parseFloat(document.getElementById('svc-price').value),
        category: document.getElementById('svc-category').value,
        est_time_minutes,
        laboratories: finalLabs,
        doctor_id: document.getElementById('svc-doctor').value || null
    };

    const existing = allServices.find(p => p.id == id);
    const reason = await promptReason({
        title: id ? `Reason for changing "${existing?.name || body.name}"` : `Reason for adding "${body.name}"`,
        message: 'Service and price changes are recorded in the audit log against your account.',
        placeholder: id ? 'e.g. price updated per the 2026 rate sheet' : 'e.g. new service approved by the clinic head',
        confirmLabel: id ? 'Save changes' : 'Create service',
        presets: id
            ? ['Price update', 'Corrected the station route', 'Renamed the service', 'Fixing a data-entry error']
            : ['New service now offered', 'Replacing a retired package']
    });
    if (!reason) return;
    body.reason = reason;

    const res = await fetch(id ? `/api/packages/${id}` : '/api/packages', {
        method: id ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { closeModal('svc-modal'); showToast('Saved', 'success'); loadServiceMgmt(); }
    else showToast(data.error || 'Failed to save', 'error');
}

async function archiveService(id, name) {
    const confirmed = await confirmAction({
        title: 'Archive this service?',
        message: `"${name}" will be removed from the catalogue and from the customer's Services list.`,
        detail: 'It is archived, not deleted — it can be restored from Archives.',
        icon: 'fa-solid fa-box-archive',
        confirmLabel: 'Archive service',
        confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    const reason = await promptReason({
        title: `Why archive "${name}"?`,
        placeholder: 'e.g. equipment retired, service no longer offered',
        confirmLabel: 'Archive service',
        confirmClass: 'btn-danger',
        presets: ['Service no longer offered', 'Replaced by another package', 'Created by mistake']
    });
    if (!reason) return;

    const res = await fetch(`/api/packages/${id}`, {
        method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ reason })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { showToast('Service archived', 'success'); loadServiceMgmt(); }
    else showToast(data.error || 'Failed to archive', 'error');
}

function populateDoctorSelect() {
    const select = document.getElementById('svc-doctor');
    if (!select) return;
    select.innerHTML = '<option value="">No doctor consultation</option>' +
        allDoctors.map(d => `<option value="${d.id}">${escapeHtml(d.name)}${d.specialty ? ` (${escapeHtml(d.specialty)})` : ''}</option>`).join('');
}

// ── AUDIT LOG ───────────────────────────────────────────────────────────────
// Four columns, because an audit entry that cannot answer all four is not an
// audit entry: When, Who, What, and Why. The before → after detail sits behind
// a per-row toggle so the table stays readable.

let auditCache = [];

async function loadAuditLogs() {
    const query = new URLSearchParams();
    const term = document.getElementById('audit-search')?.value || '';
    if (term.trim()) query.set('q', term.trim());
    const action = document.getElementById('audit-action-filter')?.value;
    if (action) query.set('action', action);
    const entity = document.getElementById('audit-entity-filter')?.value;
    if (entity) query.set('entity_type', entity);

    if (skeletonFirstLoad('admin-audit')) {
        skeletonTable('audit-table', { rows: 6, cols: [
            'skel-line skel-w-70',
            ['skel-line skel-w-60', 'skel-line skel-w-50'],   // who over role
            'skel-pill skel-w-60',
            ['skel-line skel-w-90', 'skel-line skel-w-60'],   // what over record id
            'skel-line skel-w-70', 'skel-btn'
        ] });
    }

    try {
        const res = await fetch(`/api/audit-logs?${query}`, { headers: authHeaders() });
        auditCache = await res.json();
        if (!Array.isArray(auditCache)) throw new Error('Unexpected response');
        renderAuditLogs();
        populateAuditFacets();
    } catch (err) {
        showToast('Failed to load audit logs', 'error');
    }
    clearSkeleton('audit-table');
}

const searchAuditLogs = debounce(loadAuditLogs, 250);

// Filter options come from the server's distinct values, so the dropdowns only
// offer actions and entity types that exist.
let auditFacetsLoaded = false;
async function populateAuditFacets() {
    if (auditFacetsLoaded) return;
    try {
        const res = await fetch('/api/audit-logs/facets', { headers: authHeaders() });
        const facets = await res.json();
        const actionSelect = document.getElementById('audit-action-filter');
        if (actionSelect) {
            actionSelect.innerHTML = '<option value="">All actions</option>' +
                (facets.actions || []).map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
        }
        const entitySelect = document.getElementById('audit-entity-filter');
        if (entitySelect) {
            entitySelect.innerHTML = '<option value="">All record types</option>' +
                (facets.entity_types || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        }
        auditFacetsLoaded = true;
    } catch (err) { /* the filters simply stay unpopulated */ }
}

const AUDIT_ACTION_STYLES = {
    create: 'badge-success', update: 'badge-primary', archive: 'badge-warning',
    restore: 'badge-success', purge: 'badge-danger',
    finalize: 'badge-success', finalize_unfinished: 'badge-danger',
    call_back: 'badge-warning', reinsert: 'badge-warning'
};

function renderAuditLogs() {
    const body = document.getElementById('audit-table');
    if (!body) return;
    const count = document.getElementById('audit-count');
    if (count) count.textContent = `${auditCache.length} entr${auditCache.length === 1 ? 'y' : 'ies'}`;

    body.innerHTML = auditCache.length === 0
        ? '<tr><td colspan="6" class="text-center text-muted">No audit entries match this search.</td></tr>'
        : auditCache.map(l => {
            const hasDetail = !!(l.details || l.before_snapshot || l.after_snapshot);
            return `<tr>
                <td style="white-space:nowrap;">${formatDateTime(l.created_at)}</td>
                <td>${escapeHtml(l.actor_name || 'System')}${l.actor_role ? `<br><small class="text-muted">${escapeHtml(l.actor_role)}</small>` : ''}</td>
                <td><span class="badge ${AUDIT_ACTION_STYLES[l.action] || 'badge-neutral'}">${escapeHtml(l.action)}</span></td>
                <td>${escapeHtml(l.summary || `${l.entity_type || ''} ${l.entity_id ?? ''}`.trim() || '--')}
                    <br><small class="text-muted">${escapeHtml(l.entity_type || '')}${l.entity_id != null ? ` #${l.entity_id}` : ''}</small></td>
                <td>${l.reason
                        ? `<span class="audit-reason">${escapeHtml(l.reason)}</span>`
                        : '<span class="audit-reason-missing">not recorded</span>'}</td>
                <td>${hasDetail
                        ? `<button class="btn btn-sm btn-outline" onclick="toggleAuditDetail(${l.id}, this)">Details</button>`
                        : ''}</td>
            </tr>
            <tr id="audit-detail-${l.id}" style="display:none;">
                <td colspan="6"><pre class="audit-diff">${escapeHtml(formatAuditDetail(l))}</pre></td>
            </tr>`;
        }).join('');
}

// The changed fields as "field: from → to", falling back to the raw snapshots
// for entries (like a call-back) that record an event rather than a field edit.
function formatAuditDetail(log) {
    let details = log.details;
    if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch (e) { return details; }
    }
    const lines = [];
    if (details && typeof details === 'object') {
        for (const [field, value] of Object.entries(details)) {
            if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
                lines.push(`${field}: ${JSON.stringify(value.from)} → ${JSON.stringify(value.to)}`);
            } else {
                lines.push(`${field}: ${JSON.stringify(value)}`);
            }
        }
    }
    if (lines.length === 0 && log.before_snapshot) lines.push('before: ' + JSON.stringify(log.before_snapshot, null, 2));
    if (lines.length === 0 && log.after_snapshot) lines.push('after: ' + JSON.stringify(log.after_snapshot, null, 2));
    return lines.join('\n') || 'No field-level detail recorded.';
}

function toggleAuditDetail(id, btn) {
    const row = document.getElementById(`audit-detail-${id}`);
    if (!row) return;
    const open = row.style.display !== 'none';
    row.style.display = open ? 'none' : 'table-row';
    if (btn) btn.textContent = open ? 'Details' : 'Hide';
}

// ── ARCHIVES ────────────────────────────────────────────────────────────────
let archiveCache = [];

async function loadArchives() {
    const query = new URLSearchParams();
    const term = document.getElementById('archive-search')?.value || '';
    if (term.trim()) query.set('q', term.trim());
    const type = document.getElementById('archive-type-filter')?.value;
    if (type) query.set('type', type);

    if (skeletonFirstLoad('admin-archives')) {
        skeletonTable('archive-table', { rows: 5, cols: [
            'skel-line skel-w-70', 'skel-pill skel-w-60',
            ['skel-line skel-w-80', 'skel-line skel-w-30'],   // label over #id
            'skel-line skel-w-60', 'skel-line skel-w-70', 'skel-btn'
        ] });
        skeletonTable('deletion-logs-table', { rows: 3, cols: 4 });
    }

    try {
        const res = await fetch(`/api/archives?${query}`, { headers: authHeaders() });
        archiveCache = await res.json();
        if (!Array.isArray(archiveCache)) throw new Error('Unexpected response');
        renderArchives();
        populateArchiveTypes();
    } catch (err) {
        showToast('Failed to load archives', 'error');
    }
    clearSkeleton('archive-table');
    loadDeletionLogs();
}

const searchArchives = debounce(loadArchives, 250);

async function populateArchiveTypes() {
    const select = document.getElementById('archive-type-filter');
    if (!select) return;
    try {
        const res = await fetch('/api/archives/types', { headers: authHeaders() });
        const rows = await res.json();
        const current = select.value;
        select.innerHTML = '<option value="">All record types</option>' +
            rows.map(r => `<option value="${escapeHtml(r.entity_type)}">${escapeHtml(r.entity_type)} (${r.cnt})</option>`).join('');
        select.value = current;
    } catch (err) { /* filter stays unpopulated */ }
}

function renderArchives() {
    const body = document.getElementById('archive-table');
    if (!body) return;
    const count = document.getElementById('archive-count');
    if (count) count.textContent = `${archiveCache.length} archived record(s)`;

    body.innerHTML = archiveCache.length === 0
        ? '<tr><td colspan="6" class="text-center text-muted">Nothing is archived.</td></tr>'
        : archiveCache.map(r => `<tr>
            <td style="white-space:nowrap;">${formatDateTime(r.archived_at)}</td>
            <td><span class="badge badge-neutral">${escapeHtml(r.entity_type)}</span></td>
            <td><strong>${escapeHtml(r.label || '--')}</strong><br><small class="text-muted">#${escapeHtml(String(r.entity_id))}</small></td>
            <td>${escapeHtml(r.archived_by_name || 'System')}</td>
            <td>${r.reason ? `<span class="audit-reason">${escapeHtml(r.reason)}</span>` : '<span class="audit-reason-missing">not recorded</span>'}</td>
            <td>
                ${r.restorable
                    ? `<button class="btn btn-sm btn-success" onclick="restoreArchive(${r.id})"><i class="fa-solid fa-rotate-left"></i> Restore</button>`
                    : '<span class="text-muted text-sm">Not restorable</span>'}
                <button class="btn btn-sm btn-danger" onclick="purgeArchive(${r.id})" title="Delete permanently"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`).join('');
}

// Owner-only panel; the admin page has no such table, so this is a no-op there.
async function loadDeletionLogs() {
    const body = document.getElementById('deletion-logs-table');
    if (!body) return;
    try {
        const res = await fetch('/api/users/deletion-logs', { headers: authHeaders() });
        const logs = await res.json();
        body.innerHTML = logs.length === 0
            ? '<tr><td colspan="4" class="text-center text-muted">No deletion logs</td></tr>'
            : logs.map(l => `<tr>
                <td>${escapeHtml(l.account_name || '--')}</td>
                <td>${escapeHtml(l.deleted_by_name || '--')}</td>
                <td class="text-sm">${escapeHtml(l.reason || '--')}</td>
                <td>${formatDateTime(l.deleted_at)}</td>
            </tr>`).join('');
    } catch (err) { /* leave the previous content in place */ }
    clearSkeleton(body);
}

async function restoreArchive(id) {
    const record = archiveCache.find(r => r.id == id) || {};
    const confirmed = await confirmAction({
        title: 'Restore this record?',
        message: `${record.entity_type || 'The record'} "${record.label || record.entity_id}" will be put back into active use.`,
        icon: 'fa-solid fa-rotate-left',
        confirmLabel: 'Restore record',
        confirmClass: 'btn-success'
    });
    if (!confirmed) return;
    const reason = await promptReason({
        title: 'Reason for restoring',
        placeholder: 'e.g. archived by mistake during the clean-up',
        confirmLabel: 'Restore record',
        confirmClass: 'btn-success',
        presets: REASON_PRESETS.restore
    });
    if (!reason) return;

    const res = await fetch(`/api/archives/${id}/restore`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { showToast('Record restored', 'success'); loadArchives(); }
    else showToast(data.error || 'Failed to restore', 'error');
}

async function purgeArchive(id) {
    const record = archiveCache.find(r => r.id == id) || {};
    const confirmed = await confirmAction({
        title: 'Delete permanently?',
        message: `${record.entity_type || 'This record'} "${record.label || record.entity_id}" will be erased from the database.`,
        detail: 'This is the one action in the system that cannot be undone. The snapshot and your reason stay on the audit trail.',
        icon: 'fa-solid fa-triangle-exclamation',
        confirmLabel: 'Delete permanently',
        confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    const reason = await promptReason({
        title: 'Reason for permanent deletion',
        message: 'This cannot be undone, so the reason is the only remaining record of why.',
        placeholder: 'e.g. retention period elapsed under the clinic data policy',
        confirmLabel: 'Delete permanently',
        confirmClass: 'btn-danger',
        presets: REASON_PRESETS.purge
    });
    if (!reason) return;

    const res = await fetch(`/api/archives/${id}`, {
        method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ reason })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { showToast('Permanently deleted', 'success'); loadArchives(); }
    else showToast(data.error || 'Failed to delete', 'error');
}
