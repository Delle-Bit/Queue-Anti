// ── WALK-IN MANAGEMENT SCREEN ───────────────────────────────────────────────
// The front desk section for phone-less patients: registering them, watching
// where they are, and reprinting their paperwork.
//
// It does not move anybody. It used to carry a "Call next at the front desk"
// button and a per-row Advance, and both were copies of the front desk
// dashboard's own controls - the same endpoints with the same bodies, so the
// same patient could be called from two screens that then disagreed about who
// was at the counter. Calling and advancing live on the dashboard, which is
// where the station's own state is already on screen.
//
// Front desk only now. The admin dashboards hosted this screen so an elevated
// role could use those controls when nobody was on the desk; with the controls
// gone there was nothing there for them but a second copy of a list.
//
// A host page needs only an empty <div id="section-walkin" class="content-section">
// plus a sidebar entry, and must load this after shared.js and walkin-forms.js.

let walkInVisits = [];
let walkInServices = [];
let walkInScreenReady = false;

const WALKIN_QUEUE_BADGE = {
    serving: '<span class="badge badge-success">At the counter</span>',
    waiting: '<span class="badge badge-primary">Waiting</span>',
    'on-hold': '<span class="badge badge-warning">On-Hold</span>'
};

function walkInScreenMarkup() {
    return `
    <div class="page-header">
        <div>
            <div class="page-title"><i class="fa-solid fa-person-walking-arrow-right"></i> Walk-in Intake</div>
            <div class="page-subtitle">Register and manage patients who arrived without a phone</div>
        </div>
        <button class="btn btn-outline" onclick="window.open('/display.html','_blank')"
                title="Open the lobby queue board on another screen">
            <i class="fa-solid fa-tv"></i> Open Queue Display
        </button>
    </div>

    <div class="grid-2">
        <div class="card">
            <div class="card-header">
                <div class="card-title"><i class="fa-solid fa-user-plus"></i> Register a walk-in</div>
            </div>
            <p class="text-sm text-muted" style="margin:0 0 14px;">
                This creates the patient, puts them in the same queue as everyone else, and prints their
                intake form with their queue number on it. They fill the form in by hand and hand it back.
            </p>
            <div class="grid-2">
                <div class="form-group">
                    <label class="form-label" for="wi-first">First name <span style="color:var(--danger)">*</span></label>
                    <input type="text" class="form-input" id="wi-first" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label" for="wi-middle">Middle name</label>
                    <input type="text" class="form-input" id="wi-middle" autocomplete="off">
                </div>
            </div>
            <div class="grid-2">
                <div class="form-group">
                    <label class="form-label" for="wi-surname">Surname <span style="color:var(--danger)">*</span></label>
                    <input type="text" class="form-input" id="wi-surname" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label" for="wi-category">Priority category</label>
                    <select class="form-select" id="wi-category">
                        <option value="Regular">Regular</option>
                        <option value="Senior">Senior</option>
                        <option value="PWD">PWD</option>
                        <option value="Pregnant">Pregnant</option>
                    </select>
                    <small class="text-muted">Decides the ticket prefix and their place in the line.</small>
                </div>
            </div>
            <div class="grid-2">
                <div class="form-group">
                    <label class="form-label" for="wi-birthday">Date of birth</label>
                    <input type="date" class="form-input" id="wi-birthday">
                </div>
                <div class="form-group">
                    <label class="form-label" for="wi-gender">Sex</label>
                    <select class="form-select" id="wi-gender">
                        <option value="">Not stated</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" for="wi-phone">Contact number</label>
                <input type="text" class="form-input" id="wi-phone" placeholder="A companion’s number, if the patient has none">
            </div>
            <div class="form-group">
                <label class="form-label" for="wi-address">Address</label>
                <input type="text" class="form-input" id="wi-address" placeholder="Leave blank — the patient writes it on the printed form">
            </div>
            <div class="form-group">
                <label class="form-label" for="wi-service">Service availed <span style="color:var(--danger)">*</span></label>
                <select class="form-select" id="wi-service"><option value="">Loading services…</option></select>
                <small class="text-muted">Printed on the intake form and used to route them through the stations.</small>
            </div>
            <div id="wi-error" class="text-sm" style="display:none;color:var(--danger);margin-bottom:10px;"></div>
            <div class="queue-controls">
                <button class="btn btn-success" id="wi-submit" onclick="registerWalkIn()">
                    <i class="fa-solid fa-print"></i> Register and print intake form
                </button>
                <button class="btn btn-secondary" onclick="resetWalkInForm()">Clear</button>
            </div>
        </div>

        <div>
            <div class="stats-grid" style="grid-template-columns:1fr 1fr;">
                <div class="stat-card">
                    <div class="stat-icon blue"><i class="fa-solid fa-person-walking"></i></div>
                    <div class="stat-info"><div class="stat-label">Active walk-ins</div>
                    <div class="stat-value" id="wi-stat-active">0</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green"><i class="fa-solid fa-peso-sign"></i></div>
                    <div class="stat-info"><div class="stat-label">Paid</div>
                    <div class="stat-value" id="wi-stat-paid">0</div></div>
                </div>
            </div>
            <div class="card">
                <div class="card-header">
                    <div class="card-title"><i class="fa-solid fa-circle-info"></i> One shared queue</div>
                </div>
                <p class="text-sm text-muted" style="margin:0;">
                    A walk-in joins the same central queue as everybody else, so they are called from the
                    Queue section of this dashboard — not from here. This screen registers them, prints
                    their forms, and shows where they have got to.
                </p>
            </div>
        </div>
    </div>

    <div class="card mt-md">
        <div class="card-header">
            <div class="card-title"><i class="fa-solid fa-list-check"></i> Walk-in patients</div>
            <div class="filter-bar" style="margin:0;">
                <div class="search-bar" style="width:230px;">
                    <i class="fa-solid fa-search"></i>
                    <input type="text" id="wi-search" placeholder="Search ticket, name or service..."
                           oninput="renderWalkInList()">
                </div>
                <select class="form-select" id="wi-scope" onchange="loadWalkIns()">
                    <option value="active">Still in progress</option>
                    <option value="today">Everyone today</option>
                </select>
                <span class="filter-count" id="wi-count"></span>
            </div>
        </div>
        <div class="table-wrapper">
            <table>
                <thead><tr>
                    <th>Ticket</th><th>Patient</th><th>Service</th><th>Where they are</th>
                    <th>Payment</th><th>Progress</th><th>Forms</th>
                </tr></thead>
                <tbody id="wi-list"></tbody>
            </table>
        </div>
    </div>`;
}

function initWalkInScreen() {
    const host = document.getElementById('section-walkin');
    if (!host || walkInScreenReady) return;
    host.innerHTML = walkInScreenMarkup();
    walkInScreenReady = true;
    loadWalkInServices();
}

async function loadWalkInServices() {
    try {
        const res = await fetch('/api/packages', { headers: authHeaders() });
        walkInServices = await res.json();
        const select = document.getElementById('wi-service');
        if (!select) return;
        // Ordered by id, matching Service Management, so the desk finds a service
        // in the position it sits in everywhere else.
        const options = (walkInServices || [])
            .slice()
            .sort((a, b) => Number(a.id) - Number(b.id))
            .map(p => `<option value="${p.id}">#${p.id} — ${escapeHtml(p.name)} (${formatCurrency(p.price || 0)})</option>`)
            .join('');
        select.innerHTML = `<option value="">Select a service…</option>${options}`;
    } catch (err) {
        console.error('Walk-in services error:', err);
    }
}

async function loadWalkIns() {
    initWalkInScreen();
    const scope = (document.getElementById('wi-scope') || {}).value || 'active';

    if (skeletonFirstLoad('wi-list')) {
        skeletonTable('wi-list', { rows: 3, cols: [
            'skel-line skel-w-50', 'skel-line skel-w-80', 'skel-line skel-w-70',
            'skel-pill skel-w-70', 'skel-pill skel-w-50', 'skel-line skel-w-50',
            'skel-btn', 'skel-btn'
        ], replace: true });
        skeletonValue(['wi-stat-active', 'wi-stat-paid']);
    }

    try {
        const res = await fetch(`/api/walkin?scope=${encodeURIComponent(scope)}`, { headers: authHeaders() });
        if (!res.ok) throw new Error('walk-in list failed');
        walkInVisits = await res.json();
        renderWalkInList();
        const active = walkInVisits.filter(v => v.visit_status === 'in_progress').length;
        document.getElementById('wi-stat-active').textContent = active;
        document.getElementById('wi-stat-paid').textContent = walkInVisits.filter(v => v.paid).length;
    } catch (err) {
        console.error('Walk-in list error:', err);
    }
    clearSkeleton('wi-list', 'wi-stat-active', 'wi-stat-paid');
}

function walkInProgressLabel(visit) {
    const total = Number(visit.total_steps) || 0;
    const step = Number(visit.current_step) || 0;
    if (visit.visit_status !== 'in_progress') {
        return `<span class="text-muted">${escapeHtml(visit.outcome || visit.visit_status)}</span>`;
    }
    // step_index is zero-based and total_steps counts both front desk bookends,
    // so "step 1 of 4" is what the desk expects to read.
    return `Step ${Math.min(step + 1, total)} of ${total}`;
}

function renderWalkInList() {
    const term = (document.getElementById('wi-search') || {}).value || '';
    const rows = walkInVisits.filter(v =>
        matchesSearch(v, term, ['ticket', 'full_name', 'package_name', 'customer_uid', 'station_name']));

    const countEl = document.getElementById('wi-count');
    if (countEl) {
        countEl.textContent = rows.length === walkInVisits.length
            ? `${rows.length} patient${rows.length === 1 ? '' : 's'}`
            : `${rows.length} of ${walkInVisits.length}`;
    }

    const body = document.getElementById('wi-list');
    if (!body) return;
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="text-center text-muted">
            No walk-in patients ${term ? 'match that search' : 'yet'}.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map(v => {
        return `<tr>
            <td><strong>${escapeHtml(v.ticket || '—')}</strong></td>
            <td>${escapeHtml(v.full_name || '—')}
                <div class="text-sm text-muted">${escapeHtml(v.customer_uid || '')}${
                    v.age != null ? ' · ' + v.age + ' yrs' : ''}</div></td>
            <td>${escapeHtml(v.package_name || '—')}
                <div class="text-sm text-muted">${categoryBadge(v.customer_category || 'Regular')}</div></td>
            <td>${v.queue_id
                    ? `${escapeHtml(v.station_name || v.station_type)}<div class="text-sm">${
                        WALKIN_QUEUE_BADGE[v.queue_status] || escapeHtml(v.queue_status || '')}</div>`
                    : '<span class="text-muted">Not in a queue</span>'}</td>
            <td>${v.paid
                    ? `<span class="badge badge-success">Paid</span><div class="text-sm text-muted">${formatTime(v.paid_at)}</div>`
                    : '<span class="badge badge-warning">Unpaid</span>'}</td>
            <td>${walkInProgressLabel(v)}</td>
            <td style="white-space:nowrap;">
                <button class="btn btn-sm btn-secondary" onclick="printWalkInForm(${v.sequence_id}, 'intake')"
                        title="Reprint the medical intake form"><i class="fa-solid fa-file-lines"></i> Intake</button>
                <button class="btn btn-sm btn-primary" onclick="printWalkInForm(${v.sequence_id}, 'diagnosis')"
                        ${v.paid ? '' : 'disabled title="Printed once payment is taken at the front desk."'}>
                    <i class="fa-solid fa-stethoscope"></i> Diagnosis</button>
            </td>
        </tr>`;
    }).join('');
}

function resetWalkInForm() {
    ['wi-first', 'wi-middle', 'wi-surname', 'wi-birthday', 'wi-phone', 'wi-address']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const category = document.getElementById('wi-category');
    if (category) category.value = 'Regular';
    const gender = document.getElementById('wi-gender');
    if (gender) gender.value = '';
    const service = document.getElementById('wi-service');
    if (service) service.value = '';
    walkInError('');
}

function walkInError(message) {
    const el = document.getElementById('wi-error');
    if (!el) return;
    el.textContent = message || '';
    el.style.display = message ? 'block' : 'none';
}

async function registerWalkIn() {
    const value = (id) => (document.getElementById(id) || {}).value || '';
    const payload = {
        first_name: value('wi-first').trim(),
        middle_name: value('wi-middle').trim(),
        surname: value('wi-surname').trim(),
        category: value('wi-category'),
        gender: value('wi-gender') || null,
        birthday: value('wi-birthday') || null,
        phone: value('wi-phone').trim(),
        address: value('wi-address').trim(),
        package_id: value('wi-service')
    };

    if (!payload.first_name || !payload.surname) {
        walkInError('First name and surname are required.');
        return;
    }
    if (!payload.package_id) {
        walkInError('Pick the service the patient is availing.');
        return;
    }
    walkInError('');

    const btn = document.getElementById('wi-submit');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering…'; }
    try {
        const res = await fetch('/api/walkin', {
            method: 'POST', headers: authHeaders(), body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            walkInError(data.error || 'Could not register this patient.');
            showToast(data.error || 'Could not register this patient.', 'error');
            return;
        }

        showToast(`${payload.first_name} ${payload.surname} queued as ${data.ticket}`, 'success');
        resetWalkInForm();
        await loadWalkIns();
        // The form is generated immediately, because the queue number on it is
        // the only thing the patient can be called by - they have no phone to
        // read it from.
        await printWalkInForm(data.sequence_id, 'intake');
    } catch (err) {
        console.error('Walk-in register error:', err);
        walkInError('Could not reach the server.');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-print"></i> Register and print intake form'; }
    }
}

