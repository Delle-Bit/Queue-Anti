if (!requireAuth(['frontdesk','admin','admintechnical'])) throw new Error('Unauthorized');

renderSidebar([
    { section: 'OPERATIONS' },
    { id: 'queue', label: 'Payment Queue', icon: 'fa-solid fa-cash-register' },
    { id: 'services', label: 'Service Management', icon: 'fa-solid fa-box-open' },
    { id: 'appointments', label: 'Appointments', icon: 'fa-solid fa-calendar' }
], 'queue');
initDefaultSection();

let currentServingQueueId = null;
let currentServingUserId = null;
let currentServingTicket = null;
// Whether the ticket at the counter is on the closing front desk step. The
// front desk sees the same station twice in every route - once as the cashier,
// once as the gatekeeper - and the two offer different actions.
let currentServingIsFinal = false;
let allLabs = [];
let allFdLogs = [];
let allServices = [];
let reinsertCandidates = [];

window.onSectionLoad = { queue: loadFdQueue, services: loadServiceMgmt, appointments: loadFdAppointments };

async function fetchLabs() {
    const res = await fetch('/api/laboratories', { headers: authHeaders() });
    allLabs = await res.json();
}
fetchLabs();

// ── QUEUE ──────────────────────────────────────────────────────
async function loadFdQueue() {
    try {
        const [qRes, aRes] = await Promise.all([
            fetch('/api/queue/station?type=frontdesk', { headers: authHeaders() }),
            fetch('/api/analytics/frontdesk', { headers: authHeaders() })
        ]);
        const queue = await qRes.json();
        const analytics = await aRes.json();

        const serving = queue.find(q => q.status === 'serving');
        document.getElementById('fd-serving').textContent = serving ? serving.number : '--';
        document.getElementById('fd-serving-name').textContent = serving ? (serving.full_name || serving.username || '') : 'No patient currently active';
        currentServingQueueId = serving ? serving.id : null;
        currentServingTicket = serving ? serving.number : null;
        // step_index 0 is the cashier step; anything later at this station is the
        // closing step, where the outcome is recorded instead of advancing.
        currentServingIsFinal = !!serving && Number(serving.step_index) > 0;
        renderFdStepLabel(serving);

        const newServingUserId = serving ? (serving.customer_id || serving.user_id) : null;
        if (currentServingUserId !== newServingUserId) {
            currentServingUserId = newServingUserId;
            loadPatientInfoPanel(currentServingUserId);
        }

        // The server returns the waiting rows in call order and numbers them, so
        // what is on screen is the order this desk will actually work through.
        const waiting = queue.filter(q => q.status === 'waiting');
        document.getElementById('fd-queue-list').innerHTML = waiting.length === 0
            ? '<tr><td colspan="5" class="text-center text-muted">Queue empty</td></tr>'
            : waiting.map((w, i) => `<tr class="${w.reinserted ? 'queue-row-reinserted' : ''}">
                <td>${w.call_position || i + 1}</td>
                <td><strong>${w.number}</strong>${w.reinserted ? ' <span class="badge badge-reinserted" title="Re-inserted by the front desk">re-inserted</span>' : ''}</td>
                <td>${categoryBadge(w.customer_category||'Regular')}</td>
                <td>${w.full_name||w.username||'--'}</td>
                <td>${formatTime(w.timestamp)}</td></tr>`).join('');

        document.getElementById('fd-avg').textContent = analytics.avg_time + 'm';
        document.getElementById('fd-perhr').textContent = analytics.per_hour;
        // With no measurable ticket yet these come back empty — show 0m, matching the zeroed
        // avg/per-hour cards beside them, instead of concatenating null into "nullm".
        document.getElementById('fd-fastest').textContent = `${Number(analytics.fastest?.mins ?? 0)}m`;
        document.getElementById('fd-slowest').textContent = `${Number(analytics.slowest?.mins ?? 0)}m`;

        // Distribution
        const distHtml = (analytics.distribution || []).map(d => {
            const labels = {Q:'Regular',S:'Senior',D:'PWD',P:'Pregnant'};
            return `<div class="flex-between" style="padding:6px 0;"><span>${labels[d.type]||d.type}</span><span class="fw-600">${d.cnt}</span></div>`;
        }).join('');
        document.getElementById('fd-dist-chart').innerHTML = distHtml || '<span class="text-muted">No data</span>';

        // Logs
        allFdLogs = analytics.logs || [];
        renderFdLogs(allFdLogs);
    } catch (err) { console.error(err); }
}

function renderFdLogs(logs) {
    document.getElementById('fd-logs-list').innerHTML = logs.map(l => `<tr>
        <td>${l.ticket_number}</td><td>${l.type}</td><td>${l.package_name||'--'}</td>
        <td>${formatCurrency(l.price || 0)}</td>
        <td>${formatTime(l.join_time)}</td><td>${formatTime(l.serve_time)}</td><td>${formatTime(l.complete_time)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="text-center text-muted">No logs</td></tr>';

    const total = logs.reduce((sum, l) => sum + parseFloat(l.price || 0), 0);
    const tfoot = document.getElementById('fd-logs-footer');
    if (tfoot) {
        if (logs.length > 0) {
            tfoot.style.display = 'table-row-group';
            document.getElementById('fd-logs-total-price').textContent = formatCurrency(total);
        } else {
            tfoot.style.display = 'none';
        }
    }
}

function filterFdLogs(q) {
    const filtered = allFdLogs.filter(l => (l.ticket_number||'').toLowerCase().includes(q.toLowerCase()) || (l.package_name||'').toLowerCase().includes(q.toLowerCase()));
    renderFdLogs(filtered);
}

// Tells the operator which of the two front desk roles the current ticket is at.
function renderFdStepLabel(serving) {
    const el = document.getElementById('fd-step-label');
    if (!el) return;
    if (!serving) { el.innerHTML = ''; return; }
    el.innerHTML = currentServingIsFinal
        ? '<span class="badge badge-warning"><i class="fa-solid fa-flag-checkered"></i> Finalization — close this transaction</span>'
        : '<span class="badge badge-primary"><i class="fa-solid fa-cash-register"></i> Cashier — collect payment, then send on</span>';
}

// Advancing the queue is confirmed, always. It is a single click that moves a
// real person out of the chair in front of you, and there was previously no way
// back from doing it by accident.
async function fdCallNext() {
    const confirmed = await confirmAction({
        title: 'Call the next patient?',
        message: 'The next ticket in the queue will be called to this counter.',
        detail: 'If you call the wrong ticket, use "Call Back" to undo it.',
        icon: 'fa-solid fa-bell',
        confirmLabel: 'Call next',
        confirmClass: 'btn-success'
    });
    if (!confirmed) return;

    const res = await fetch('/api/queue/next', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ station_type: 'frontdesk' }) });
    const data = await res.json().catch(() => ({}));
    if (data.success) showToast('Calling: ' + data.next, 'success');
    else showToast(data.error || data.message || 'Queue empty', res.ok ? 'info' : 'error');
    loadFdQueue();
}

// Hand the patient on to their next station. This no longer ends the visit -
// that is what "Close transaction" is for.
async function fdAdvance() {
    if (!currentServingQueueId) return showToast('No active transaction', 'error');
    const res = await fetch('/api/queue/complete-step', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: currentServingQueueId }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        showToast(data.error || 'Failed to advance', data.requires_finalize ? 'warning' : 'error');
        loadFdQueue();
        return;
    }
    showToast(data.is_final_step
        ? `${data.next_ticket} sent back to the front desk to close out`
        : 'Sent on to ' + (data.next_station || 'the next station'), 'success');
    loadFdQueue();
}

// Undo the last advance at this counter.
async function fdCallBack() {
    const confirmed = await confirmAction({
        title: 'Call back the previous ticket?',
        message: 'The patient now at the counter goes back to the front of the queue, and the ticket completed just before them is recalled.',
        detail: 'Only works while the next station has not already picked that patient up.',
        icon: 'fa-solid fa-rotate-left',
        confirmLabel: 'Call back',
        confirmClass: 'btn-primary'
    });
    if (!confirmed) return;

    const res = await fetch('/api/queue/call-back', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ station_type: 'frontdesk' }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showToast(data.error || 'Nothing to call back', 'error');
    else if (data.recalled) showToast(`Recalled ${data.recalled}`, 'success');
    else showToast(data.message || 'Queue reverted', 'info');
    loadFdQueue();
}

// The front desk's closing authority: record the official outcome and take the
// patient out of every active queue.
async function fdFinalize(outcome) {
    if (!currentServingQueueId) return showToast('Call a patient first — there is no ticket at this counter.', 'error');

    const isUnfinished = outcome === 'unfinished';
    const confirmed = await confirmAction({
        title: isUnfinished ? 'Close as Unfinished?' : 'Close as Completed?',
        message: isUnfinished
            ? `Ticket ${currentServingTicket} will be recorded as Unfinished and removed from every queue.`
            : `Ticket ${currentServingTicket} will be recorded as officially Completed.`,
        detail: 'This ends the patient\u2019s visit and cannot be undone from this screen.',
        icon: 'fa-solid fa-triangle-exclamation',
        confirmLabel: isUnfinished ? 'Close as Unfinished' : 'Close as Completed',
        confirmClass: isUnfinished ? 'btn-danger' : 'btn-success'
    });
    if (!confirmed) return;

    // A visit that did not run to completion has to say why, on the record.
    let reason = '';
    if (isUnfinished) {
        reason = await promptReason({
            title: 'Why is this transaction unfinished?',
            message: 'Recorded against this visit and in the audit log.',
            placeholder: 'e.g. patient left before the laboratory step',
            confirmLabel: 'Close as Unfinished',
            confirmClass: 'btn-danger',
            presets: ['Patient left before finishing', 'Unable to pay', 'Referred to another facility', 'Service unavailable today']
        });
        if (!reason) return;
    }

    const res = await fetch('/api/queue/finalize', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ queue_id: currentServingQueueId, outcome, reason })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showToast(data.error || 'Failed to close transaction', 'error');
    else showToast(`${data.ticket} closed as ${data.outcome}`, isUnfinished ? 'warning' : 'success');
    loadFdQueue();
}

// ── RE-INSERTION (line cutting) ──────────────────────────────────────────
async function openReinsertModal() {
    document.getElementById('reinsert-search').value = '';
    document.getElementById('reinsert-list').innerHTML =
        '<tr><td colspan="6" class="text-center text-muted">Loading...</td></tr>';
    openModal('reinsert-modal');
    try {
        const res = await fetch('/api/queue/reinsert-candidates', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        reinsertCandidates = data;
        renderReinsertCandidates();
    } catch (err) {
        document.getElementById('reinsert-list').innerHTML =
            `<tr><td colspan="6" class="text-center text-muted">${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderReinsertCandidates() {
    const term = document.getElementById('reinsert-search').value;
    const rows = reinsertCandidates.filter(c =>
        matchesSearch(c, term, ['number', 'full_name', 'username', 'station_name', 'package_name', 'status']));
    document.getElementById('reinsert-count').textContent =
        `${rows.length} of ${reinsertCandidates.length} in the queues`;
    document.getElementById('reinsert-list').innerHTML = rows.length === 0
        ? '<tr><td colspan="6" class="text-center text-muted">Nobody is waiting or On-Hold right now.</td></tr>'
        : rows.map(c => `<tr class="${c.reinsert_slot ? 'queue-row-reinserted' : ''}">
            <td><strong>${c.number}</strong></td>
            <td>${escapeHtml(c.full_name || c.username || '--')}<br><small class="text-muted">${escapeHtml(c.package_name || '')}</small></td>
            <td>${escapeHtml(c.station_name || c.station_type)}</td>
            <td>${c.status === 'on-hold'
                    ? '<span class="badge badge-warning">On-Hold</span>'
                    : '<span class="badge badge-neutral">Waiting</span>'}
                ${c.reinsert_slot ? '<br><span class="badge badge-reinserted">already re-inserted</span>' : ''}</td>
            <td>${formatTime(c.hold_at || c.timestamp)}</td>
            <td><button class="btn btn-sm btn-primary" onclick="doReinsert('${c.id}', '${escapeHtml(c.number)}')">
                <i class="fa-solid fa-arrow-turn-up"></i> Re-insert</button></td>
        </tr>`).join('');
}

async function doReinsert(queueId, ticket) {
    const reason = await promptReason({
        title: `Re-insert ${ticket}`,
        message: 'This patient will be called after the patient in process and one more regular patient.',
        placeholder: 'e.g. stepped out and missed their number being called',
        confirmLabel: 'Re-insert patient',
        presets: ['Missed their turn', 'Returned with an unfinished process', 'Sent back by another station']
    });
    if (!reason) return;

    const res = await fetch('/api/queue/reinsert', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: queueId, reason })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showToast(data.error || 'Failed to re-insert', 'error');
    showToast(`${data.ticket} re-inserted at position ${data.slot} of the line`, 'success');
    closeModal('reinsert-modal');
    loadFdQueue();
}

// ── SERVICE MANAGEMENT ─────────────────────────────────────────
async function loadServiceMgmt() {
    await fetchLabs();
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
    const term = document.getElementById('svc-search')?.value || '';
    const category = document.getElementById('svc-category-filter')?.value || '';
    const rows = allServices.filter(p =>
        (!category || p.category === category) &&
        matchesSearch({ ...p, id_text: String(p.id) }, term, ['id_text', 'name', 'category', 'description']));

    const count = document.getElementById('svc-count');
    if (count) count.textContent = `${rows.length} of ${allServices.length} services`;

    document.getElementById('svc-list').innerHTML = rows.length === 0
        ? '<tr><td colspan="8" class="text-center text-muted">No services match this search.</td></tr>'
        : rows.map(p => `<tr>
        <td>${p.id}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td><span class="badge badge-neutral">${escapeHtml(p.category || 'General')}</span></td>
        <td>${formatCurrency(p.price)}</td><td>${p.est_time_minutes}m</td>
        <td>${serviceRouteLabel(p)}</td>
        <td>${p.is_available === false ? '<span class="badge badge-danger">Currently Unavailable</span>' : `<span class="badge ${p.is_active?'badge-success':'badge-danger'}">${p.is_active?'Active':'Inactive'}</span>`}</td>
        <td><button class="btn btn-sm btn-secondary" onclick='editService(${JSON.stringify(p).replace(/'/g,"&apos;")})'><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger" onclick="archiveService(${p.id}, '${escapeHtml(p.name).replace(/'/g,"&apos;")}')"><i class="fa-solid fa-box-archive"></i></button></td>
    </tr>`).join('');
}

// Both front desk bookends are shown, because both are real stops the patient
// makes - the route is not "lab, lab" but "pay, lab, lab, close out".
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
    document.getElementById('svc-time').value = pkg.est_time_minutes;
    document.getElementById('svc-modal-title').textContent = 'Edit Service Package';
    renderLabSequence(pkg.laboratories || []);
    openModal('svc-modal');
}

async function archiveService(id, name) {
    const confirmed = await confirmAction({
        title: 'Archive this service?',
        message: `"${name}" will be removed from the catalogue.`,
        detail: 'It is archived, not deleted — an admin can restore it from Archives at any time.',
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
    if (!res.ok) return showToast(data.error || 'Failed to archive', 'error');
    showToast('Service archived', 'success');
    loadServiceMgmt();
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

// Identical to renderLabSequence in admintechnical.js and owner.js - all three
// pages host the same service editor. Both front desk steps are rendered as
// locked: the queue engine adds them to every route (composeServiceSteps in
// queue_automation.js) and neither is stored in the editable station list, so
// the draggable stations are numbered from 2.
function renderLabSequence(labs) {
    labSequence = labs || [];
    const container = document.getElementById('svc-lab-list');
    const lockedStep = (position, label, note) => `
        <div class="flex-between" style="padding:8px;background:var(--danger-light);border-left:3px solid var(--primary);border-radius:8px;margin-bottom:6px;">
            <span><i class="fa-solid fa-lock text-muted mr-sm"></i> <strong>${position}.</strong> ${label}
                <small class="text-muted">(${note})</small></span>
        </div>`;
    container.innerHTML =
        lockedStep(1, 'Front Desk', 'cashier &mdash; always first') +
        labSequence.map((l, i) => `
        <div class="flex-between" draggable="true" ondragstart="dragLab(event, ${i})" ondragover="allowDropLab(event)" ondrop="dropLab(event, ${i})" style="padding:8px;background:var(--bg-input);border-radius:8px;margin-bottom:6px;cursor:grab;">
            <span><i class="fa-solid fa-grip-vertical text-muted mr-sm"></i> <strong>${i+2}.</strong> ${l.lab_name || allLabs.find(x=>x.id==l.laboratory_id)?.name || 'Lab #'+l.laboratory_id}</span>
            <button class="btn btn-sm btn-danger btn-icon" onclick="removeLabStep(${i})"><i class="fa-solid fa-trash"></i></button>
        </div>
    `).join('') +
        lockedStep(labSequence.length + 2, 'Front Desk', 'finalization &mdash; always last');
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

function prepareNewService() {
    document.getElementById('svc-edit-id').value = '';
    document.getElementById('svc-name').value = '';
    document.getElementById('svc-desc').value = '';
    document.getElementById('svc-price').value = '';
    document.getElementById('svc-category').value = '';
    document.getElementById('svc-time').value = '';
    document.getElementById('svc-modal-title').textContent = 'Add Service Package';
    renderLabSequence([]);
    openModal('svc-modal');
}

async function saveService() {
    const id = document.getElementById('svc-edit-id').value;

    // Estimate time via AI
    let finalLabs = labSequence;
    let est_time_minutes = 15;
    try {
        const estRes = await fetch('/api/packages/estimate-time', {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ laboratories: labSequence })
        });
        const estData = await estRes.json();
        est_time_minutes = estData.total;
        finalLabs = estData.laboratories;
    } catch(err) { console.warn('AI Estimation failed, using defaults'); }

    const body = {
        name: document.getElementById('svc-name').value,
        description: document.getElementById('svc-desc').value,
        price: parseFloat(document.getElementById('svc-price').value),
        category: document.getElementById('svc-category').value,
        est_time_minutes: est_time_minutes,
        laboratories: finalLabs
    };
    // The catalogue is clinic configuration, so a price or route change carries a
    // reason on the audit trail. The server rejects the request without one.
    const reason = await promptReason({
        title: id ? `Reason for changing "${body.name}"` : `Reason for adding "${body.name}"`,
        placeholder: id ? 'e.g. price updated per the 2026 rate sheet' : 'e.g. new service approved by the clinic head',
        confirmLabel: id ? 'Save changes' : 'Create service',
        presets: id
            ? ['Price update', 'Corrected the station route', 'Renamed the service', 'Fixing a data-entry error']
            : ['New service now offered', 'Replacing a retired package']
    });
    if (!reason) return;
    body.reason = reason;

    const url = id ? `/api/packages/${id}` : '/api/packages';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { closeModal('svc-modal'); showToast('Saved!', 'success'); loadServiceMgmt(); }
    else showToast(data.error || 'Failed to save', 'error');
}

// ── APPOINTMENTS ───────────────────────────────────────────────
async function loadFdAppointments() {
    const res = await fetch('/api/appointments', { headers: authHeaders() });
    const appts = await res.json();
    // Appointments are settled on site, so this desk is the cashier for them:
    // amount_due already includes the priority booking surcharge, and payment is
    // marked paid automatically when this station clears the patient's front desk
    // step. Falls back to the package price for rows booked before the surcharge.
    document.getElementById('fd-appt-list').innerHTML = appts.map(a => `<tr>
        <td>${a.full_name||a.username}</td><td>${a.package_name}</td><td>${a.appointment_date}</td>
        <td>${a.appointment_time}</td><td><span class="badge ${a.status==='scheduled'?'badge-warning':'badge-success'}">${a.status}</span></td>
        <td><strong>${formatCurrency(a.amount_due ?? a.price)}</strong>${Number(a.surcharge_pct) > 0 ? `<br><small class="text-muted">incl. ${a.surcharge_pct}% priority</small>` : ''}</td>
        <td><span class="badge ${a.payment_status==='paid'?'badge-success':'badge-warning'}">${a.payment_status}</span></td>
        <td><button class="btn btn-sm btn-secondary" onclick="generateAppointmentQr(${a.id})"><i class="fa-solid fa-qrcode"></i> QR</button></td>
    </tr>`).join('');
}

async function generateAppointmentQr(id) {
    try {
        const res = await fetch(`/api/appointments/${id}/qr`, { method: 'POST', headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) return showToast(data.error || 'Failed to generate QR', 'error');
        document.getElementById('qr-image').src = data.qrDataUrl;
        document.getElementById('qr-download').href = data.qrDataUrl;
        document.getElementById('qr-link').textContent = data.url;
        openModal('qr-modal');
    } catch (err) {
        showToast('Failed to generate QR', 'error');
    }
}

function printQr() {
    const src = document.getElementById('qr-image').src;
    const link = document.getElementById('qr-link').textContent;
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Appointment QR</title></head><body style="font-family:Arial;text-align:center;padding:24px;"><h2>Patient Check-In QR</h2><img src="${src}" style="width:320px"><p>${link}</p><script>window.onload=()=>window.print();<\/script></body></html>`);
    win.document.close();
}

// Load patient info panel details
async function loadPatientInfoPanel(userId) {
    const panel = document.getElementById('fd-patient-panel');
    if (!userId) {
        if (panel) panel.style.display = 'none';
        return;
    }

    try {
        const res = await fetch(`/api/medical-records/${userId}`, { headers: authHeaders() });
        const med = await res.json();

        if (panel) panel.style.display = 'block';

        if (med) {
            const category = med.user?.customer_category || 'Regular';
            const catBadge = document.getElementById('fd-patient-category-badge');
            if (catBadge) {
                catBadge.className = `badge ${category === 'Senior' ? 'priority-senior' : category === 'PWD' ? 'priority-pwd' : category === 'Pregnant' ? 'priority-pregnant' : 'priority-regular'}`;
                catBadge.textContent = category;
            }

            let ageText = '--';
            if (med.user?.birthday) {
                const bday = new Date(med.user.birthday);
                const diff = Date.now() - bday.getTime();
                const ageDate = new Date(diff);
                ageText = Math.abs(ageDate.getUTCFullYear() - 1970) + ' yo';
            }
            document.getElementById('fd-patient-gender-age').textContent = `${med.user?.gender || 'Unspecified'} (${ageText})`;
            document.getElementById('fd-patient-birthplace').textContent = med.birthplace || '--';
            document.getElementById('fd-patient-address').textContent = med.address || '--';
            document.getElementById('fd-patient-phone').textContent = med.phone || '--';
            document.getElementById('fd-patient-occupation').textContent = med.occupation || '--';

            let healthHtml = 'None reported';
            if (med.current_health) {
                try {
                    const chArr = JSON.parse(med.current_health);
                    if (Array.isArray(chArr) && chArr.length > 0) {
                        healthHtml = chArr.map(item => `<span class="badge badge-warning" style="margin-right:4px;margin-bottom:4px;display:inline-block;">${item}</span>`).join('');
                    }
                } catch(e) {
                    healthHtml = med.current_health;
                }
            }
            document.getElementById('fd-patient-symptoms').innerHTML = healthHtml;
        } else {
            // No medical record found, show empty/uncompleted
            document.getElementById('fd-patient-birthplace').textContent = '--';
            document.getElementById('fd-patient-address').textContent = '--';
            document.getElementById('fd-patient-phone').textContent = '--';
            document.getElementById('fd-patient-occupation').textContent = '--';
            document.getElementById('fd-patient-symptoms').textContent = 'No medical records filled out yet.';
            document.getElementById('fd-patient-gender-age').textContent = '--';
            const catBadge = document.getElementById('fd-patient-category-badge');
            if (catBadge) {
                catBadge.className = 'badge priority-regular';
                catBadge.textContent = 'Regular';
            }
        }
    } catch (err) {
        console.error('Error loading patient info in panel:', err);
    }
}

// Open Edit Patient Modal
async function openEditPatientModal() {
    if (!currentServingUserId) return showToast('No active patient', 'error');

    document.getElementById('edit-patient-id').value = currentServingUserId;

    // Clear fields initially
    document.getElementById('edit-patient-firstname').value = '';
    document.getElementById('edit-patient-middlename').value = '';
    document.getElementById('edit-patient-surname').value = '';
    document.getElementById('edit-patient-category').value = 'Regular';
    document.getElementById('edit-patient-birthday').value = '';
    document.getElementById('edit-patient-gender').value = 'Male';
    document.getElementById('edit-patient-phone').value = '';
    document.getElementById('edit-patient-birthplace').value = '';
    document.getElementById('edit-patient-address').value = '';
    document.getElementById('edit-patient-occupation').value = '';
    document.getElementById('edit-patient-retiree').checked = false;
    document.getElementById('edit-patient-emergency').value = '';

    try {
        const res = await fetch(`/api/medical-records/${currentServingUserId}`, { headers: authHeaders() });
        const med = await res.json();

        if (med) {
            if (med.user) {
                document.getElementById('edit-patient-firstname').value = med.user.first_name || '';
                document.getElementById('edit-patient-middlename').value = med.user.middle_name || '';
                document.getElementById('edit-patient-surname').value = med.user.surname || '';
                document.getElementById('edit-patient-category').value = med.user.customer_category || 'Regular';
                document.getElementById('edit-patient-gender').value = med.user.gender || 'Male';

                if (med.user.birthday) {
                    // Extract date only (YYYY-MM-DD)
                    document.getElementById('edit-patient-birthday').value = med.user.birthday.substring(0, 10);
                }
            }

            document.getElementById('edit-patient-phone').value = med.phone || '';
            document.getElementById('edit-patient-birthplace').value = med.birthplace || '';
            document.getElementById('edit-patient-address').value = med.address || '';
            document.getElementById('edit-patient-occupation').value = med.occupation || '';
            document.getElementById('edit-patient-retiree').checked = !!med.retiree;
            document.getElementById('edit-patient-emergency').value = med.emergency_contact || '';
        }

        openModal('edit-patient-modal');
    } catch(err) {
        console.error('Error loading patient details for edit:', err);
        showToast('Error loading patient file', 'error');
    }
}

// Save Patient Edit Changes
async function savePatientEdit() {
    const customerId = document.getElementById('edit-patient-id').value;
    const fName = document.getElementById('edit-patient-firstname').value.trim();
    const mName = document.getElementById('edit-patient-middlename').value.trim();
    const sName = document.getElementById('edit-patient-surname').value.trim();
    const category = document.getElementById('edit-patient-category').value;
    const birthday = document.getElementById('edit-patient-birthday').value;
    const gender = document.getElementById('edit-patient-gender').value;
    const phone = document.getElementById('edit-patient-phone').value.trim();
    const birthplace = document.getElementById('edit-patient-birthplace').value.trim();
    const address = document.getElementById('edit-patient-address').value.trim();
    const occupation = document.getElementById('edit-patient-occupation').value.trim();
    const retiree = document.getElementById('edit-patient-retiree').checked ? 1 : 0;
    const emergency = document.getElementById('edit-patient-emergency').value.trim();

    if (!fName || !sName) {
        return showToast('First Name and Surname are required.', 'warning');
    }

    const fullName = `${fName} ${mName ? mName + ' ' : ''}${sName}`;

    try {
        const res = await fetch('/api/medical-records', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                customer_id: customerId,
                full_name: fullName,
                surname: sName,
                first_name: fName,
                middle_name: mName,
                no_middle_name: !mName,
                gender: gender,
                birthday: birthday || null,
                customer_category: category,
                birthplace: birthplace,
                address: address,
                phone: phone,
                status: 'active',
                occupation: occupation,
                retiree: retiree,
                emergency_contact: emergency
            })
        });

        if (res.ok) {
            showToast('Patient record saved successfully!', 'success');
            closeModal('edit-patient-modal');

            // Reload panels
            loadFdQueue();
            loadPatientInfoPanel(currentServingUserId);
        } else {
            showToast('Failed to save patient record', 'error');
        }
    } catch(err) {
        console.error('Error saving patient edit:', err);
        showToast('Error saving changes', 'error');
    }
}

loadFdQueue();
function onQueueUpdate() { loadFdQueue(); }
setInterval(() => { if (document.getElementById('section-queue').style.display !== 'none') loadFdQueue(); }, 5000);
