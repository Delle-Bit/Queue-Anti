if (!requireAuth(['customer'])) throw new Error('Unauthorized');

const navItems = [
    { section: 'MENU' },
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-gauge-high' },
    { id: 'services', label: 'Services', icon: 'fa-solid fa-flask' },
    { id: 'appointments', label: 'Appointments', icon: 'fa-solid fa-calendar-check' },
    { id: 'medical', label: 'Medical History', icon: 'fa-solid fa-notes-medical' }
];
renderSidebar(navItems, 'dashboard');
initDefaultSection();

let selectedPackageId = null;
let medicalFormComplete = false;
let calendarDate = new Date();
let latestQueuePreview = null;
const APPT_SLOTS = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00'];
window.onSectionLoad = {
    dashboard: loadDashboard,
    services: loadServices,
    appointments: loadAppointments,
    medical: loadMyMedicalRecords
};

window.onQueueUpdate = () => {
    // Only refresh if current section needs it
    const activeSection = document.querySelector('.content-section[style*="display: block"]');
    if (activeSection) {
        const id = activeSection.id.replace('section-', '');
        if (id === 'dashboard') loadDashboard();
        if (id === 'appointments') loadAppointments();
        if (id === 'medical') loadMyMedicalRecords();
    }
};

// ── DASHBOARD ──────────────────────────────────────────────────
let lastQueueStatus = null; // tracks 'on-hold' -> active transitions for the chime/notification
let allPackages = [];       // the Services catalogue, kept for client-side search

// Removes the first-load placeholder. Called as soon as the status is known -
// including on failure, or it would shimmer indefinitely over a page that is
// not going to get an answer.
function settleQueueSkeleton() {
    document.getElementById('queue-status-skeleton')?.remove();
}

async function loadDashboard() {
    await checkMandatoryMedicalForm(false);
    // No loader on refresh. This runs every five seconds, and the old overlay
    // put a blurred scrim over the patient's own ticket number twelve times a
    // minute; the first load is covered by the placeholder in the markup.
    try {
        const res = await fetch('/api/queue/my-status', { headers: authHeaders() });
        const data = await res.json();
        settleQueueSkeleton();
        if (!data.active) {
            document.getElementById('no-active-queue').style.display = 'block';
            document.getElementById('active-queue-panel').style.display = 'none';
            document.getElementById('hold-queue-panel').style.display = 'none';
            lastQueueStatus = null;
            return;
        }
        document.getElementById('no-active-queue').style.display = 'none';

        handleHoldTransition(data);

        if (data.on_hold) {
            document.getElementById('active-queue-panel').style.display = 'none';
            document.getElementById('hold-queue-panel').style.display = 'block';
            const station = data.hold_station_name || 'the lab';
            document.getElementById('hold-instruction').textContent =
                `Take your time. Once ready, bring your sample to ${station}. You will rejoin the line just behind the next patient.`;
            const readyBtn = document.getElementById('hold-ready-btn');
            if (data.sample_ready_at) {
                readyBtn.disabled = true;
                readyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Staff Notified — Awaiting Hand-off';
            } else {
                readyBtn.disabled = false;
                readyBtn.innerHTML = '<i class="fa-solid fa-check"></i> I am Ready for Hand-off / Re-queue';
            }
            return;
        }

        document.getElementById('hold-queue-panel').style.display = 'none';
        document.getElementById('active-queue-panel').style.display = 'block';

        document.getElementById('dash-ahead').textContent = data.people_ahead;
        document.getElementById('dash-eta').textContent = data.estimated_total_time > 0 ? data.estimated_total_time + ' minutes' : '--';
        document.getElementById('dash-ticket').textContent = data.current_queue ? data.current_queue.number : '--';
        document.getElementById('dash-current-processing').textContent = data.current_processing || '--';

        const stationLabel = data.current_queue
            ? (data.steps.find(s => s.status === 'active')?.name
               || (data.current_queue.station_type === 'frontdesk' ? 'Front Desk' : 'Processing'))
            : '--';
        document.getElementById('dash-current-station').textContent = data.awaiting_finalization
            ? 'Last step: return to the Front Desk to close your visit'
            : 'Currently at: ' + stationLabel;

        document.getElementById('queue-stepper-container').innerHTML = renderQueueTrack(data.steps);
    } catch (err) {
        console.error('Dashboard error:', err);
        // Nothing to show: fall back to the empty state rather than leaving a
        // placeholder shimmering over a panel that will never fill.
        settleQueueSkeleton();
        document.getElementById('no-active-queue').style.display = 'block';
    }
}

// Detects the ON-HOLD -> active transition and fires the chime + browser notification.
// Runs on every dashboard refresh (socket-driven via onQueueUpdate), so it only needs
// to compare against the previously observed status.
function handleHoldTransition(data) {
    const wasOnHold = lastQueueStatus === 'on-hold';
    lastQueueStatus = data.on_hold ? 'on-hold' : 'active';

    if (data.on_hold && 'Notification' in window && Notification.permission === 'default') {
        // Ask while the patient is actually going On-Hold — a real user-driven moment.
        Notification.requestPermission();
    }

    if (wasOnHold && !data.on_hold) {
        playResumeChime();
        const station = data.current_queue?.station_type === 'doctor' ? 'the Doctor' : 'the next station';
        const message = `Your sample has been received — please proceed to ${station}.`;
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('You\'re back in the queue', { body: message });
        }
        showToast(message, 'success');
    }
}

function playResumeChime() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        [880, 1320].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + i * 0.18);
            gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.18 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.18);
            osc.stop(now + i * 0.18 + 0.4);
        });
    } catch (err) { /* WebAudio unavailable — chime is a nice-to-have */ }
}

async function signalSampleReady() {
    try {
        const statusRes = await fetch('/api/queue/my-status', { headers: authHeaders() });
        const status = await statusRes.json();
        if (!status.active || !status.current_queue) return showToast('No active queue entry found', 'error');
        const res = await fetch('/api/queue/sample-ready', {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: status.current_queue.id })
        });
        const data = await res.json();
        if (data.success) showToast('Staff notified — please head to the lab window', 'success');
        else showToast(data.error || 'Failed to signal', 'error');
        loadDashboard();
    } catch (err) { showToast('Connection error', 'error'); }
}

// Linear queue track: one continuous horizontal progress rail with a department
// milestone per step. Real-time status and wait estimates sit under each node.
function renderQueueTrack(steps = []) {
    if (!steps.length) return '<div class="queue-track-empty text-muted">No queue steps to show.</div>';

    const labels = { pending: 'Waiting', active: 'In Progress', completed: 'Completed' };
    const icons = { pending: 'fa-clock', active: 'fa-spinner fa-spin', completed: 'fa-check' };
    const typeLabels = { frontdesk: 'Verification & payment', doctor: 'Consultation', laboratory: 'Laboratory' };
    // The front desk is both the first and the last stop of every visit, but it
    // is doing a different job each time - captioning both as "verification &
    // payment" would tell the patient to expect to pay twice.
    const stepCaption = (step) => step.is_final
        ? 'Return to the front desk to close your visit'
        : (typeLabels[step.type] || 'Service');

    // Fill reaches the active node, or the far end once every department is done.
    const activeIndex = steps.findIndex(s => s.status === 'active');
    const completedCount = steps.filter(s => s.status === 'completed').length;
    const reached = activeIndex >= 0 ? activeIndex : (completedCount >= steps.length ? steps.length - 1 : completedCount);
    const fill = steps.length <= 1 ? 100 : Math.min(100, (reached / (steps.length - 1)) * 100);

    const nodes = steps.map((step, index) => {
        let detail;
        if (step.status === 'completed') {
            detail = 'Done';
        } else if (step.status === 'active') {
            const ahead = step.people_waiting > 0 ? `${step.people_waiting} ahead · ` : 'You are next · ';
            detail = `${ahead}~${step.est_minutes || 0} min`;
        } else {
            detail = step.eta_minutes != null ? `Starts in ~${step.eta_minutes} min` : `~${step.est_minutes || 0} min`;
        }

        return `
        <div class="queue-track-step ${step.status}">
            <div class="queue-track-node">
                <i class="fa-solid ${icons[step.status] || icons.pending}"></i>
            </div>
            <div class="queue-track-meta">
                <strong>${index + 1}. ${step.name}</strong>
                <span class="queue-track-status">${labels[step.status] || 'Waiting'}</span>
                <small>${stepCaption(step)} · ${detail}</small>
            </div>
        </div>`;
    }).join('');

    return `
        <div class="queue-track" role="list" aria-label="Queue progress by department" style="--track-count:${steps.length};">
            <div class="queue-track-steps">
                <div class="queue-track-rail"><span class="queue-track-fill" style="width:${fill}%"></span></div>
                ${nodes}
            </div>
        </div>`;
}

// Entry point used by the Virtual Nurse Assistant to dispatch a queue action.
// Reuses the existing preview → confirm flow so the medical-form gate and the
// queue preview modal still apply to voice-initiated requests.
function vaStartPackageFlow(packageId) {
    if (!packageId) return;
    navigateTo('services');
    selectedPackageId = packageId;
    confirmPackage();
}

// ── SERVICES ───────────────────────────────────────────────────
// The inside of one placeholder service card. Every wrapper here is the class
// the real card in renderServices() uses - badge, heading, tag row, blurb,
// price footer, step count - so each placeholder line occupies exactly one line
// box of the real element and the card lands at the height it will keep.
const SERVICE_CARD_SKELETON = `
    <div class="pkg-card-badge"><span class="skel skel-pill skel-badge"></span></div>
    <h3 class="skel-box"><span class="skel skel-line skel-w-80"></span></h3>
    <div class="pkg-card-tags">
        <span class="skel skel-pill skel-w-50"></span>
        <span class="skel skel-pill skel-w-30"></span>
    </div>
    <p class="skel-box"><span class="skel skel-line skel-w-90"></span></p>
    <div class="pkg-card-footer">
        <span class="skel skel-line pkg-price skel-w-40"></span>
        <span class="skel skel-line pkg-time skel-w-30"></span>
    </div>
    <div class="mt-sm text-sm skel-box"><span class="skel skel-line skel-w-60"></span></div>`;

async function loadServices() {
    try {
        // Six cards is what fills the grid above the fold at desktop width, so
        // the placeholder occupies the space the catalogue is about to occupy
        // instead of collapsing the section to nothing and pushing it open.
        skeletonCards('packages-grid', { count: 6, cardClass: 'pkg-card', body: SERVICE_CARD_SKELETON });
        const res = await fetch('/api/packages');
        allPackages = await res.json();
        populateServiceCategories(allPackages);
        renderServices();
    } catch (err) { console.error(err); }
    clearSkeleton('packages-grid');
}

// Only categories that actually have a service in them, so the filter never
// offers a choice that returns nothing.
function populateServiceCategories(packages) {
    const select = document.getElementById('service-category-filter');
    if (!select) return;
    const categories = [...new Set(packages.map(p => p.category).filter(Boolean))].sort();
    const current = select.value;
    select.innerHTML = '<option value="">All categories</option>' +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    select.value = current;
}

// Filtering happens on the already-fetched catalogue so results appear as the
// patient types. /api/packages also accepts ?q= and ?category= for the same
// filtering server-side, which is what keeps this workable as the catalogue grows.
function renderServices() {
    const grid = document.getElementById('packages-grid');
    if (!grid) return;
    const term = document.getElementById('service-search')?.value || '';
    const category = document.getElementById('service-category-filter')?.value || '';

    const rows = allPackages.filter(p =>
        (!category || p.category === category) &&
        matchesSearch({ ...p, id_text: String(p.id) }, term, ['id_text', 'name', 'category', 'description']));

    const count = document.getElementById('service-count');
    if (count) {
        count.textContent = allPackages.length === 0 ? ''
            : `${rows.length} of ${allPackages.length} services`;
    }

    if (allPackages.length === 0) {
        grid.innerHTML = '<div class="card text-center" style="grid-column:1/-1;padding:40px;"><p class="text-muted">No services available yet.</p></div>';
        return;
    }
    if (rows.length === 0) {
        grid.innerHTML = `<div class="card text-center" style="grid-column:1/-1;padding:40px;">
            <p class="text-muted">No services match your search.</p>
            <button class="btn btn-sm btn-outline mt-sm" onclick="clearServiceFilters()">Clear filters</button></div>`;
        return;
    }

    grid.innerHTML = rows.map(p => `
        <div class="pkg-card ${p.is_available === false ? 'pkg-card-unavailable' : ''}" onclick="showPackageDetail(${p.id})">
            <div class="pkg-card-badge">${categoryBadge(getCategory())}</div>
            <h3>${escapeHtml(p.name)}</h3>
            <div class="pkg-card-tags">
                <span class="badge badge-neutral">${escapeHtml(p.category || 'General')}</span>
                <span class="text-muted text-sm">ID #${p.id}</span>
            </div>
            <p>${escapeHtml(p.description || 'No description')}</p>
            <div class="pkg-card-footer">
                <span class="pkg-price">${formatCurrency(p.price)}</span>
                <span class="pkg-time"><i class="fa-solid fa-clock"></i> ~${p.est_time_minutes}min</span>
            </div>
            ${p.is_available === false
                ? '<div class="mt-sm"><span class="badge badge-danger">Currently Unavailable</span></div>'
                : `<div class="mt-sm text-sm text-muted">${p.steps?.length || 0} step(s) &middot; Front Desk to Front Desk</div>`}
        </div>
    `).join('');
}

function clearServiceFilters() {
    const search = document.getElementById('service-search');
    const filter = document.getElementById('service-category-filter');
    if (search) search.value = '';
    if (filter) filter.value = '';
    renderServices();
}

async function showPackageDetail(id) {
    if (!(await ensureMedicalFormComplete(true))) return;
    selectedPackageId = id;
    try {
        const res = await fetch(`/api/packages/${id}/details`);
        const pkg = await res.json();
        if (pkg.is_available === false) return showToast('This service is currently unavailable.', 'error');
        document.getElementById('pkg-modal-name').textContent = pkg.name;
        document.getElementById('pkg-modal-desc').textContent = pkg.description || '';
        document.getElementById('pkg-modal-price').textContent = formatCurrency(pkg.price);
        document.getElementById('pkg-modal-eta').textContent = pkg.estimated_total_time + ' minutes';

        // pkg.steps is the real station sequence and always begins at the front
        // desk (the cashier), which is the first stop the queue actually creates.
        // Falls back to the laboratories list for an older API response.
        const steps = pkg.steps && pkg.steps.length
            ? pkg.steps
            : [{ name: 'Front Desk', type: 'frontdesk', est_time_minutes: 5 },
               ...(pkg.laboratories || []).map(l => ({ name: l.lab_name, type: 'laboratory', service_type: l.service_type, est_time_minutes: l.est_time_minutes })),
               { name: 'Front Desk — Finalization', type: 'frontdesk', est_time_minutes: 3, is_final: true }];
        const stepSubtitle = { frontdesk: 'Verification & payment', laboratory: 'Laboratory', doctor: 'Consultation' };
        const labsHtml = steps.map((s, i) => {
            const detail = s.is_final
                ? 'Outcome recorded'
                : (s.type === 'laboratory' ? (s.service_type || stepSubtitle.laboratory) : stepSubtitle[s.type] || '');
            // Both front desk steps are mandatory and neither can be skipped, so
            // both carry the required marker - the first as the cashier, the last
            // as the only station that can close the visit.
            const note = s.is_final ? ' • required last' : (s.type === 'frontdesk' ? ' • required first' : '');
            return `
            <div class="pkg-lab-item${s.type === 'frontdesk' ? ' pkg-lab-item-required' : ''}">
                <div class="pkg-lab-num">${i + 1}</div>
                <div class="pkg-lab-info"><strong>${s.name}</strong><small>${detail} • ~${s.est_time_minutes}min${note}</small></div>
            </div>`;
        }).join('');
        document.getElementById('pkg-modal-labs').innerHTML = labsHtml;
        openModal('pkg-modal');
    } catch (err) { showToast('Failed to load package details', 'error'); }
}

async function confirmPackage() {
    if (!selectedPackageId) return;
    if (!(await ensureMedicalFormComplete(true))) return;
    const btn = document.getElementById('pkg-confirm-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing Preview...';
    try {
        const res = await fetch(`/api/queue/preview-package/${selectedPackageId}`, { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) {
            latestQueuePreview = data;
            closeModal('pkg-modal');
            document.getElementById('preview-ticket').textContent = data.ticket || '--';
            document.getElementById('preview-current-processing').textContent = data.current_processing || '--';
            document.getElementById('preview-estimated-time').textContent = data.estimated_total_time ? `${data.estimated_total_time} minutes` : '--';
            document.getElementById('preview-steps').innerHTML = renderQueueTrack((data.steps || []).map(step => ({ ...step, status: 'pending' })));
            openModal('queue-preview-modal');
        } else {
            if (data.medical_form_required) openModal('mandatory-med-modal');
            showToast(data.error || 'Failed to prepare queue preview', 'error');
        }
    } catch (err) { showToast('Connection error', 'error'); }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm & Queue';
}

async function startPackageAfterPreview() {
    if (!selectedPackageId) return;
    const btn = document.getElementById('queue-preview-confirm-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Joining...';
    try {
        const res = await fetch('/api/queue/start-package', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ package_id: selectedPackageId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            closeModal('queue-preview-modal');
            showToast('Queued successfully! Ticket: ' + data.ticket, 'success');
            navigateTo('dashboard');
            loadDashboard();
        } else {
            showToast(data.error || 'Failed to join queue', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm & Join Queue';
}

async function cancelQueue() {
    if (!confirm('Leave queue? This cannot be undone.')) return;
    try {
        await fetch('/api/queue/cancel', { method: 'POST', headers: authHeaders() });
        showToast('Queue cancelled', 'info');
        loadDashboard();
    } catch (err) { showToast('Failed to cancel', 'error'); }
}

// ── APPOINTMENTS ───────────────────────────────────────────────
async function loadAppointments() {
    try {
        const tbody = document.getElementById('appointments-list');
        // Status is a badge and the last column a button, so those two columns
        // get pill-shaped placeholders rather than a full-width bar.
        skeletonTable(tbody, { rows: 3, cols: [
            'skel-line skel-w-70', 'skel-line skel-w-60', 'skel-line skel-w-50',
            'skel-pill skel-w-60', 'skel-line skel-w-50', 'skel-btn'
        ] });
        const res = await fetch('/api/appointments/my', { headers: authHeaders() });
        const appts = await res.json();
        if (appts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:32px;">No appointments yet</td></tr>';
        } else {
            // 'no-show' is set by the missed-appointment sweep. It stays in the
            // customer's own history (the staff lists drop it) so a slot they
            // missed doesn't appear to have silently vanished.
            const statusBadge = { 'scheduled': 'badge-warning', 'checked-in': 'badge-success', 'completed': 'badge-success', 'no-show': 'badge-danger', 'cancelled': 'badge-neutral' };
            const statusLabel = { 'no-show': 'Did Not Arrive' };
            tbody.innerHTML = appts.map(a => `<tr>
                <td><strong>${a.package_name}</strong></td>
                <td>${a.appointment_date}</td>
                <td>${a.appointment_time}</td>
                <td><span class="badge ${statusBadge[a.status] || 'badge-neutral'}">${statusLabel[a.status] || a.status}</span></td>
                <td>${formatCurrency(a.amount_due ?? a.price)}${a.payment_status === 'pending' ? '<br><small class="text-muted">due on site</small>' : ''}</td>
                <td>
                    ${a.status === 'scheduled' ? `<button class="btn btn-sm btn-primary" onclick="openCheckInScanner(${a.id})"><i class="fa-solid fa-qrcode"></i> Check-In</button>` : '--'}
                </td>
            </tr>`).join('');
        }

        // Populate appointment modal package select
        const pkgRes = await fetch('/api/packages');
        const pkgs = await pkgRes.json();
        const sel = document.getElementById('appt-package');
        // The booking total and the surcharge percentage both come from the API,
        // so the fee is defined in one place (appointment_automation.js) instead
        // of being duplicated here.
        sel.innerHTML = pkgs.map(p => `<option value="${p.id}"
            data-price="${p.price}"
            data-appt-price="${p.appointment_price ?? p.price}"
            data-surcharge-pct="${p.appointment_surcharge_pct ?? 0}">${p.name} — ${formatCurrency(p.appointment_price ?? p.price)}</option>`).join('');
        sel.onchange = () => {
            const opt = sel.options[sel.selectedIndex];
            if (!opt) return;
            const base = Number(opt.dataset.price) || 0;
            const total = Number(opt.dataset.apptPrice) || base;
            const pct = Number(opt.dataset.surchargePct) || 0;
            document.getElementById('appt-base-price').textContent = formatCurrency(base);
            document.getElementById('appt-surcharge-pct').textContent = pct;
            document.getElementById('appt-surcharge').textContent = formatCurrency(total - base);
            document.getElementById('appt-amount').textContent = formatCurrency(total);
        };
        if (sel.options.length > 0) sel.onchange();

        renderAppointmentCalendar();
    } catch (err) { console.error(err); }
    clearSkeleton('appointments-list');
}

async function bookAppointment() {
    if (!(await ensureMedicalFormComplete(true))) return;
    const pkg = document.getElementById('appt-package').value;
    const date = document.getElementById('appt-date').value;
    const time = selectedTimeSlot;
    const notes = document.getElementById('appt-notes').value;
    if (!pkg || !date || !time) return showToast('Fill all fields', 'error');
    // Re-checked at submit: the modal can sit open long enough for the selected
    // slot to fall into the past while the customer is on the payment step.
    if (isPastSlot(date, time)) {
        return showToast('That time has already passed. Please pick a new date and time.', 'error');
    }

    const btn = document.getElementById('appt-confirm-btn');
    btn.disabled = true;
    try {
        const res = await fetch('/api/appointments', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ package_id: pkg, appointment_date: date, appointment_time: time, notes })
        });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            closeModal('appt-modal');
            showToast(data.amount_due != null
                ? `Appointment booked. Pay ${formatCurrency(data.amount_due)} at the front desk.`
                : 'Appointment booked!', 'success', 5000);
            loadAppointments();
        } else {
            const data = await res.json();
            if (data.medical_form_required) openModal('mandatory-med-modal');
            showToast(data.error || 'Failed to book', 'error');
        }
    } catch (err) { showToast('Connection error', 'error'); }
    btn.disabled = false;
}

// ── POLLING ────────────────────────────────────────────────────
function onQueueUpdate() { loadDashboard(); }
loadDashboard();
setInterval(() => {
    if (document.getElementById('section-dashboard').style.display !== 'none') loadDashboard();
}, 5000);

// ── APPOINTMENT MULTI-STEP LOGIC ───────────────────────────────
let apptStep = 1;
let selectedTimeSlot = null;

function resetApptModal() {
    apptStep = 1;
    selectedTimeSlot = null;
    document.getElementById('selected-appt-time').textContent = '';
    document.getElementById('appt-step-1').style.display = 'block';
    document.getElementById('appt-step-2').style.display = 'none';
    document.getElementById('appt-prev-btn').style.display = 'none';
    document.getElementById('appt-next-btn').style.display = 'inline-block';
    document.getElementById('appt-confirm-btn').style.display = 'none';
}

function apptNextStep() {
    if (apptStep === 1) {
        if (!selectedTimeSlot) return showToast('Please select a time slot', 'warning');
        apptStep = 2;
    }
    updateApptModalView();
}

function apptPrevStep() {
    if (apptStep > 1) apptStep--;
    updateApptModalView();
}

function updateApptModalView() {
    document.getElementById('appt-step-1').style.display = apptStep === 1 ? 'block' : 'none';
    document.getElementById('appt-step-2').style.display = apptStep === 2 ? 'block' : 'none';

    document.getElementById('appt-prev-btn').style.display = apptStep > 1 ? 'inline-block' : 'none';
    document.getElementById('appt-next-btn').style.display = apptStep < 2 ? 'inline-block' : 'none';
    document.getElementById('appt-confirm-btn').style.display = apptStep === 2 ? 'inline-block' : 'none';
}

async function fetchTimeSlots() {
    const dateInput = document.getElementById('appt-date').value;
    if (!dateInput) return;
    const grid = document.getElementById('appt-time-slots');

    try {
        const res = await fetch(`/api/queue/booked-slots?date=${dateInput}`, { headers: authHeaders() });
        const booked = await res.json();

        let slotsHtml = '';
        let selectable = 0;
        APPT_SLOTS.forEach(timeStr => {
            const isBooked = booked.includes(timeStr);
            // On a future date every slot is still ahead; only today can have
            // slots that have already started.
            const isPast = !isBooked && isPastSlot(dateInput, timeStr);
            const classes = ['time-slot'];
            if (isBooked) classes.push('full');
            if (isPast) classes.push('past');
            const clickAttr = (isBooked || isPast) ? '' : `onclick="selectTimeSlot('${timeStr}')"`;
            if (!isBooked && !isPast) selectable++;
            slotsHtml += `<div class="${classes.join(' ')}" id="ts-${timeStr}" ${clickAttr}>${timeStr}</div>`;
        });
        grid.innerHTML = slotsHtml + (selectable === 0
            ? '<p class="text-muted text-sm mt-sm" style="grid-column:1/-1;">No slots left for this date. Please pick a later date.</p>'
            : '');
        selectedTimeSlot = null;
    } catch (err) { grid.innerHTML = '<div class="text-danger">Failed to load slots</div>'; }
}

function selectTimeSlot(timeStr) {
    const iso = document.getElementById('appt-date').value;
    if (iso && isPastSlot(iso, timeStr)) {
        return showToast('That time has already passed. Please choose a later slot.', 'warning');
    }
    document.querySelectorAll('.time-slot').forEach(el => el.classList.remove('selected'));
    document.getElementById(`ts-${timeStr}`).classList.add('selected');
    selectedTimeSlot = timeStr;
    document.getElementById('selected-appt-time').textContent = `at ${timeStr}`;
    closeModal('slot-modal');
}

// ── APPOINTMENT DATE/TIME RULES ────────────────────────────────
// Only future slots are bookable. Past dates are disabled in the calendar, and
// on today only slots strictly later than the current time are selectable - a
// slot equal to the current time has already started. Mirrored server-side in
// routes/admin.js; this half is only the affordance, not the enforcement.
function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Parsed field-by-field rather than with new Date(iso): a bare 'YYYY-MM-DD'
// string is parsed as UTC, which shifts the day either side of midnight.
function parseLocalDate(iso, timeStr) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

function isPastDate(iso) {
    return parseLocalDate(iso) < startOfToday();
}

function isPastSlot(iso, timeStr) {
    return parseLocalDate(iso, timeStr) <= new Date();
}

function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function renderAppointmentCalendar() {
    const cal = document.getElementById('appointment-calendar');
    if (!cal) return;
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    document.getElementById('calendar-title').textContent = calendarDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    let bookedDates = new Set();
    try {
        const res = await fetch(`/api/queue/booked-dates?month=${monthKey}`, { headers: authHeaders() });
        const rows = await res.json();
        bookedDates = new Set((rows || []).map(r => r.date));
    } catch (err) {}
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const heads = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="calendar-head">${d}</div>`).join('');
    let days = '';
    for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const iso = formatLocalDate(d);
        const muted = d.getMonth() !== month ? 'muted' : '';
        const selected = document.getElementById('appt-date').value === iso ? 'selected' : '';
        const hasBooking = bookedDates.has(iso) ? 'has-booking' : '';
        const past = isPastDate(iso);
        // disabled (not just a class) so the button is also unreachable by
        // keyboard and can't be activated by a stray click handler.
        const attrs = past
            ? 'disabled aria-disabled="true" title="This date has already passed"'
            : `onclick="selectAppointmentDate('${iso}')"`;
        days += `<button type="button" class="calendar-day ${muted} ${selected} ${hasBooking} ${past ? 'past' : ''}" ${attrs}>${d.getDate()}</button>`;
    }
    cal.innerHTML = heads + days;

    // Nothing before the current month is bookable, so don't let the user page
    // back into it and find a grid of dead cells.
    const prevBtn = document.getElementById('calendar-prev-btn');
    if (prevBtn) {
        const now = new Date();
        const atCurrentMonth = year === now.getFullYear() && month === now.getMonth();
        prevBtn.disabled = atCurrentMonth;
        prevBtn.title = atCurrentMonth ? 'Past months cannot be booked' : 'Previous month';
    }
}

function changeCalendarMonth(delta) {
    const target = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + delta, 1);
    const now = new Date();
    if (target < new Date(now.getFullYear(), now.getMonth(), 1)) return;
    calendarDate = target;
    renderAppointmentCalendar();
}

function selectAppointmentDate(iso) {
    if (isPastDate(iso)) return showToast('Please choose today or a future date.', 'warning');
    document.getElementById('appt-date').value = iso;
    document.getElementById('selected-appt-date').textContent = iso;
    selectedTimeSlot = null;
    document.getElementById('selected-appt-time').textContent = '';
    renderAppointmentCalendar();
    document.getElementById('slot-modal-title').textContent = `Slots for ${iso}`;
    openModal('slot-modal');
    fetchTimeSlots();
}

// ── MANDATORY MEDICAL FORM ─────────────────────────────────────────

async function checkMandatoryMedicalForm(force = false) {
    try {
        const res = await fetch('/api/medical-records/my', { headers: authHeaders() });
        const data = await res.json();
        medicalFormComplete = !!data.id;

        if (!data.id && force) openModal('mandatory-med-modal');
        return medicalFormComplete;
    } catch (err) { console.error('Failed to check medical form', err); }
    return false;
}

async function ensureMedicalFormComplete(force = false) {
    const complete = await checkMandatoryMedicalForm(force);
    if (!complete && force) showToast('Please complete the medical form before continuing.', 'warning');
    return complete;
}

function skipMandatoryMedicalForm() {
    closeModal('mandatory-med-modal');
}

function toggleMiddleName() {
    const noMiddle = document.getElementById('req-med-no-middle').checked;
    const middle = document.getElementById('req-med-middle-name');
    middle.disabled = noMiddle;
    if (noMiddle) middle.value = '';
    middle.classList.remove('field-error');
}

function validateRequiredMedicalFields() {
    document.querySelectorAll('#mandatory-med-modal [data-required="true"], #mandatory-med-modal select[required]').forEach(el => el.classList.remove('field-error'));
    const required = Array.from(document.querySelectorAll('#mandatory-med-modal [data-required="true"], #mandatory-med-modal select[required]'));
    const missing = required.filter(el => !el.disabled && !String(el.value || '').trim());
    missing.forEach(el => el.classList.add('field-error'));
    if (missing.length > 0) {
        missing[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        missing[0].focus({ preventScroll: true });
        showToast('Please complete the highlighted required fields.', 'error');
        return false;
    }
    return true;
}

function toggleSurgeryInput() {
    const val = document.getElementById('pc-surgeries').value;
    document.getElementById('surgery-spec-div').style.display = val === 'Yes' ? 'block' : 'none';
}

// ── PH ADDRESS CASCADE (Province → City/Municipality → Barangay) ─────
// Data is PSGC (see scripts/build-psgc-data.js). Provinces + cities are one
// small fetch each; barangays are sharded per province so picking a province
// downloads only that province's ~15-90KB instead of the country's 11MB.
// Everything is memoized, so reopening the form re-fetches nothing.
const PH_DATA_BASE = '/data/ph';
const phAddress = { provinces: null, cities: null, barangays: new Map(), basePromise: null };

function loadPhBaseData() {
    if (!phAddress.basePromise) {
        phAddress.basePromise = Promise.all([
            fetch(`${PH_DATA_BASE}/provinces.json`).then(r => { if (!r.ok) throw new Error('provinces'); return r.json(); }),
            fetch(`${PH_DATA_BASE}/cities.json`).then(r => { if (!r.ok) throw new Error('cities'); return r.json(); })
        ]).then(([provinces, cities]) => {
            phAddress.provinces = provinces;
            phAddress.cities = cities;
        }).catch(err => {
            phAddress.basePromise = null; // let a later reopen retry
            throw err;
        });
    }
    return phAddress.basePromise;
}

function loadPhBarangays(provinceCode) {
    if (!phAddress.barangays.has(provinceCode)) {
        const p = fetch(`${PH_DATA_BASE}/barangays/${provinceCode}.json`)
            .then(r => { if (!r.ok) throw new Error('barangays'); return r.json(); })
            .catch(err => {
                phAddress.barangays.delete(provinceCode);
                throw err;
            });
        phAddress.barangays.set(provinceCode, p);
    }
    return phAddress.barangays.get(provinceCode);
}

// Option value is the NAME (that's what gets stored and displayed); the PSGC
// code rides along in a data attribute purely to filter the next level.
function setSelectOptions(select, items, placeholder) {
    select.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholder;
    select.appendChild(ph);
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.n;
        opt.textContent = item.n;
        opt.dataset.code = item.c;
        select.appendChild(opt);
    });
}

function selectedCode(select) {
    const opt = select.selectedOptions && select.selectedOptions[0];
    return opt ? (opt.dataset.code || '') : '';
}

async function initAddressSelects() {
    const provSel = document.getElementById('req-med-province');
    if (!provSel || provSel.dataset.ready === 'true') return;
    try {
        await loadPhBaseData();
        setSelectOptions(provSel, phAddress.provinces, 'Select province');
        provSel.dataset.ready = 'true';
    } catch (err) {
        console.error('Failed to load address data', err);
        setSelectOptions(provSel, [], 'Unable to load provinces');
        showToast('Could not load the address list. Check your connection, then reopen the form.', 'error');
    }
}

async function onProvinceChange() {
    const provSel = document.getElementById('req-med-province');
    const citySel = document.getElementById('req-med-city');
    const brgySel = document.getElementById('req-med-barangay');
    const provinceCode = selectedCode(provSel);

    // Any province change invalidates both levels below it.
    brgySel.disabled = true;
    setSelectOptions(brgySel, [], 'Select city first');
    if (!provinceCode) {
        citySel.disabled = true;
        setSelectOptions(citySel, [], 'Select province first');
        return;
    }
    const cities = (phAddress.cities || []).filter(c => c.p === provinceCode);
    setSelectOptions(citySel, cities, 'Select city / municipality');
    citySel.disabled = false;
    // Warm the shard now so picking a city feels instant.
    loadPhBarangays(provinceCode).catch(() => {});
}

async function onCityChange() {
    const provSel = document.getElementById('req-med-province');
    const citySel = document.getElementById('req-med-city');
    const brgySel = document.getElementById('req-med-barangay');
    const provinceCode = selectedCode(provSel);
    const cityCode = selectedCode(citySel);

    if (!cityCode) {
        brgySel.disabled = true;
        setSelectOptions(brgySel, [], 'Select city first');
        return;
    }
    setSelectOptions(brgySel, [], 'Loading barangays...');
    // Stays enabled on failure on purpose: an empty required select blocks
    // submission, whereas a disabled one is skipped by the validator and
    // would let an address through with no barangay.
    brgySel.disabled = false;
    try {
        const all = await loadPhBarangays(provinceCode);
        // Guard against a slow shard resolving after the user moved on.
        if (selectedCode(citySel) !== cityCode) return;
        const list = all.filter(b => b.m === cityCode);
        setSelectOptions(brgySel, list, list.length ? 'Select barangay' : 'No barangays found');
    } catch (err) {
        console.error('Failed to load barangays', err);
        setSelectOptions(brgySel, [], 'Unable to load barangays');
        showToast('Could not load barangays for that city. Please try again.', 'error');
    }
}

// Rebuilds the single-line address string that the profile card, staff views,
// and PDF export all already read from `medical_records.address`.
function composeAddressString({ houseNumber, street, barangay, city, province }) {
    const line = [houseNumber, street].map(v => String(v || '').trim()).filter(Boolean).join(' ');
    // Many PSGC barangay names are literally "Barangay 1 (Pob.)" — don't
    // produce "Barangay Barangay 1".
    const brgy = String(barangay || '').trim();
    const brgyLabel = !brgy ? '' : (/^barangay\b/i.test(brgy) ? brgy : `Barangay ${brgy}`);
    return [line, brgyLabel, String(city || '').trim(), String(province || '').trim()]
        .filter(Boolean)
        .join(', ');
}

// Restores the three chained selects from a saved record, level by level —
// each one has to be populated before the next can be set.
async function restoreAddressSelects(med) {
    await initAddressSelects();
    const provSel = document.getElementById('req-med-province');
    const citySel = document.getElementById('req-med-city');
    const brgySel = document.getElementById('req-med-barangay');
    if (!provSel) return;

    provSel.value = med.province || '';
    // A saved name that's no longer in PSGC (renamed/merged) won't match any
    // option, leaving the select blank so the user just re-picks it.
    if (!provSel.value) {
        await onProvinceChange();
        return;
    }
    await onProvinceChange();

    citySel.value = med.city || '';
    if (!citySel.value) return;
    await onCityChange();

    brgySel.value = med.barangay || '';
}

async function submitMandatoryMedicalForm() {
    if (!validateRequiredMedicalFields()) return;
    const surname = document.getElementById('req-med-surname').value.trim();
    const firstName = document.getElementById('req-med-first-name').value.trim();
    const noMiddleName = document.getElementById('req-med-no-middle').checked;
    const middleName = noMiddleName ? '' : document.getElementById('req-med-middle-name').value.trim();
    const name = [firstName, middleName, surname].filter(Boolean).join(' ');
    const gender = document.getElementById('req-med-gender').value;
    const birthdate = document.getElementById('req-med-birthdate').value;

    const birthplace = document.getElementById('req-med-birthplace').value;
    const status = document.getElementById('req-med-status').value;
    const houseNumber = document.getElementById('req-med-house-number').value.trim();
    const street = document.getElementById('req-med-street').value.trim();
    const barangay = document.getElementById('req-med-barangay').value;
    const city = document.getElementById('req-med-city').value;
    const province = document.getElementById('req-med-province').value;
    const address = composeAddressString({ houseNumber, street, barangay, city, province });
    const phone = document.getElementById('req-med-phone').value;
    const occupation = document.getElementById('req-med-occupation').value;
    const emergency = document.getElementById('req-med-emergency').value;

    const retiree = document.getElementById('req-med-retiree').checked ? 1 : 0;
    const allergies = document.getElementById('req-med-allergies').value;

    // Gather current health checkboxes
    const currentHealthArr = Array.from(document.querySelectorAll('.req-ch-checkbox:checked')).map(cb => cb.value);
    if (allergies.trim()) currentHealthArr.push(`Allergies: ${allergies}`);

    // Gather past conditions
    const pastConditionsObj = {
        heart_problems: document.getElementById('pc-heart').value,
        blood_clots: document.getElementById('pc-clots').value,
        high_bp: document.getElementById('pc-bp').value,
        high_cholesterol: document.getElementById('pc-chol').value,
        std_hiv: document.getElementById('pc-std').value,
        surgeries: document.getElementById('pc-surgeries').value
    };
    if (pastConditionsObj.surgeries === 'Yes') {
        pastConditionsObj.surgeries_details = document.getElementById('req-med-surgeries').value;
    }

    const payload = {
        full_name: name,
        surname,
        first_name: firstName,
        middle_name: middleName,
        no_middle_name: noMiddleName,
        gender: gender,
        birthday: birthdate,
        birthplace,
        status,
        address,
        house_number: houseNumber,
        street,
        barangay,
        city,
        province,
        phone,
        occupation,
        retiree,
        emergency_contact: emergency,
        current_health: JSON.stringify(currentHealthArr),
        past_conditions: JSON.stringify(pastConditionsObj)
    };

    try {
        const res = await fetch('/api/medical-records/my', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            closeModal('mandatory-med-modal');
            medicalFormComplete = true;
            showToast('Medical record saved successfully!', 'success');
            loadMyMedicalRecords();
        } else {
            showToast(data.error || 'Failed to save medical form', 'error');
        }
    } catch (err) { console.error(err); showToast('Connection error', 'error'); }
}

async function populateMedicalFormFromRecord() {
    try {
        const res = await fetch('/api/medical-records/my', { headers: authHeaders() });
        const med = await res.json();
        const user = med.user || {};
        const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = value || '';
        };
        setVal('req-med-surname', user.surname);
        setVal('req-med-first-name', user.first_name);
        setVal('req-med-middle-name', user.middle_name);
        document.getElementById('req-med-no-middle').checked = !!user.no_middle_name;
        toggleMiddleName();
        setVal('req-med-gender', user.gender);
        setVal('req-med-birthdate', user.birthday ? String(user.birthday).slice(0, 10) : '');
        setVal('req-med-birthplace', med.birthplace);
        setVal('req-med-status', med.status);
        setVal('req-med-house-number', med.house_number);
        setVal('req-med-street', med.street);
        await restoreAddressSelects(med);
        setVal('req-med-phone', med.phone);
        setVal('req-med-occupation', med.occupation);
        document.getElementById('req-med-retiree').checked = !!med.retiree;
        setVal('req-med-emergency', med.emergency_contact);
    } catch (err) {
        console.error('Failed to load medical form values', err);
    }
}

const origOpenModal = window.openModal;
window.openModal = async function(id) {
    if (id === 'appt-modal') {
        if (!(await ensureMedicalFormComplete(true))) return;
        resetApptModal();
        renderAppointmentCalendar();
    }
    if (id === 'mandatory-med-modal') {
        await populateMedicalFormFromRecord();
        // Safety net: if the record fetch above failed, the province list
        // would otherwise be left stuck on "Loading...".
        await initAddressSelects();
    }
    if (origOpenModal) origOpenModal(id);
    else document.getElementById(id)?.classList.add('active');
};

// ── QR CHECK-IN SCANNER ──────────────────────────────────────────
let html5QrCode = null;

function openCheckInScanner(appointmentId) {
    openModal('qr-checkin-modal');
    document.getElementById('qr-result').innerHTML = '<span class="text-muted">Initializing camera...</span>';

    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }

    const qrConfig = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrCode.start(
        { facingMode: "environment" },
        qrConfig,
        async (decodedText) => {
            // Stop scanning once code is found
            await stopScanner();
            processCheckIn(decodedText);
        },
        (errorMessage) => {
            // Ignore parse errors as they are frequent while searching for QR
        }
    ).catch(err => {
        document.getElementById('qr-result').innerHTML = `<span class="text-danger">Error: ${err}</span>`;
    });
}

async function stopScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        await html5QrCode.stop();
    }
}

async function closeCheckInScanner() {
    await stopScanner();
    closeModal('qr-checkin-modal');
}

async function processCheckIn(qrData) {
    document.getElementById('qr-result').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

    // The QR data can be a full URL or just the token
    let token = qrData;
    if (qrData.includes('/checkin/')) {
        token = qrData.split('/checkin/').pop();
    }

    try {
        const res = await fetch('/api/appointments/check-in', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            document.getElementById('qr-result').innerHTML = `<div class="text-success"><i class="fa-solid fa-circle-check"></i> Checked-in! Ticket: <strong>${data.ticket}</strong></div>`;
            showToast(`Checked-in! Your ticket is ${data.ticket}`, 'success');

            setTimeout(async () => {
                await closeCheckInScanner();
                await loadAppointments(); // Refresh appointment list status
                navigateTo('dashboard'); // Switch to dashboard to show active queue
            }, 1500);
        } else {
            document.getElementById('qr-result').innerHTML = `<div class="text-danger"><i class="fa-solid fa-circle-xmark"></i> ${data.error || 'Invalid or expired QR code'}</div>`;
            // Restart scanner after a short delay so user can try again
            setTimeout(() => {
                if (document.getElementById('qr-checkin-modal').classList.contains('active')) {
                    openCheckInScanner();
                }
            }, 3000);
        }
    } catch (err) {
        document.getElementById('qr-result').innerHTML = `<span class="text-danger">Connection error</span>`;
    }
}

// Fetch and Render personal medical file and clinical records
async function loadMyMedicalRecords() {
    try {
        const timelineEl = document.getElementById('my-history-timeline');
        skeletonLines(timelineEl, { rows: 3, avatar: true });
        const [medRes, clinicalRes] = await Promise.all([
            fetch('/api/medical-records/my', { headers: authHeaders() }),
            fetch('/api/clinical-records/my', { headers: authHeaders() })
        ]);

        const med = await medRes.json();
        const records = await clinicalRes.json();

        // 1. Personal Profile Card
        if (med) {
            const user = med.user || {};
            const fullName = user.full_name || [user.first_name, user.middle_name, user.surname].filter(Boolean).join(' ') || getUsername() || 'Customer';
            document.getElementById('my-med-name').textContent = fullName;
            document.getElementById('my-med-customer-id').textContent = `ID: ${user.customer_uid || ('MC-' + String(user.id || getUserId() || '').padStart(6, '0'))}`;
            const avatar = document.getElementById('my-med-avatar');
            if (avatar) {
                const genderKey = String(user.gender || '').toLowerCase();
                avatar.className = `profile-avatar ${genderKey === 'female' ? 'female' : genderKey === 'male' ? 'male' : 'neutral'}`;
                avatar.innerHTML = `<i class="fa-solid ${genderKey === 'female' ? 'fa-person-dress' : genderKey === 'male' ? 'fa-person' : 'fa-user'}"></i>`;
            }
            const category = user.customer_category || 'Regular';
            const catBadge = document.getElementById('my-med-category');
            if (catBadge) {
                catBadge.className = `badge ${category === 'Senior' ? 'priority-senior' : category === 'PWD' ? 'priority-pwd' : category === 'Pregnant' ? 'priority-pregnant' : 'priority-regular'}`;
                catBadge.textContent = user.is_underage ? `${category} / Underage` : category;
            }

            let ageText = '--';
            if (med.user?.birthday) {
                const bday = new Date(med.user.birthday);
                const diff = Date.now() - bday.getTime();
                const ageDate = new Date(diff);
                ageText = Math.abs(ageDate.getUTCFullYear() - 1970) + ' yo';
            }

            document.getElementById('my-med-gender-age').textContent = `${med.user?.gender || 'Unspecified'} (${ageText})`;
            document.getElementById('my-med-birthplace').textContent = med.birthplace || '--';
            document.getElementById('my-med-address').textContent = med.address || '--';
            document.getElementById('my-med-phone').textContent = med.phone || '--';
            document.getElementById('my-med-status').textContent = med.status || 'Active';
            document.getElementById('my-med-occupation').textContent = med.occupation || '--';
            document.getElementById('my-med-emergency').textContent = med.emergency_contact || '--';

            // Current Health Conditions / Symptoms
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
            document.getElementById('my-med-symptoms').innerHTML = healthHtml;

            // Past medical conditions summary
            let pastHtml = 'None reported';
            if (med.past_conditions) {
                try {
                    const pc = JSON.parse(med.past_conditions);
                    if (pc && typeof pc === 'object') {
                        pastHtml = `
                            <ul style="margin: 0; padding-left: 14px; font-size:0.95em;">
                                <li>High BP: <strong>${pc.high_bp || 'No'}</strong></li>
                                <li>Heart Circulation: <strong>${pc.heart_problems || 'No'}</strong></li>
                                <li>Blood Clots: <strong>${pc.blood_clots || 'No'}</strong></li>
                                <li>High Cholesterol: <strong>${pc.high_cholesterol || 'No'}</strong></li>
                                <li>Surgeries: <strong>${pc.surgeries || 'No'}</strong> ${pc.surgeries === 'Yes' ? `(${pc.surgeries_details || ''})` : ''}</li>
                            </ul>
                        `;
                    }
                } catch(e) {
                    pastHtml = med.past_conditions;
                }
            }
            document.getElementById('my-med-past').innerHTML = pastHtml;
        }

        // 2. Render Clinical Timeline
        const timeline = document.getElementById('my-history-timeline');
        if (records.length === 0) {
            timeline.innerHTML = '<span class="text-muted text-sm">No consultation or laboratory records found.</span>';
        } else {
            timeline.innerHTML = records.map(r => {
                let badgeCls = 'badge-primary';
                let typeLabel = r.record_type;
                if (r.record_type === 'prescription') { badgeCls = 'badge-success'; typeLabel = 'Prescription'; }
                else if (r.record_type === 'examination') { badgeCls = 'badge-neutral'; typeLabel = 'Examination'; }
                else if (r.record_type === 'diagnostic') { badgeCls = 'badge-warning'; typeLabel = 'Diagnostic'; }
                else if (r.record_type === 'lab_result') { badgeCls = 'badge-danger'; typeLabel = 'Lab Result'; }

                let detailsHtml = '';
                // A freeform result ("Other Diagnostics") is written in the
                // laboratory's notepad and stored as markup, so it is rendered
                // as markup here rather than escaped into one flat line.
                // Sanitised again on the way out: the record may have been
                // written before the allow-list was what it is now.
                let richHtml = '';
                if (r.data) {
                    try {
                        const parsedData = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                        if (parsedData.rich_notes) richHtml = sanitizeRichHtml(parsedData.rich_notes);
                        if (r.record_type === 'examination') {
                            detailsHtml = `<div style="font-size:0.85em;margin-top:4px;">BP: <strong>${parsedData.bp || '--'}</strong> | HR: <strong>${parsedData.pulse || '--'} bpm</strong> | Temp: <strong>${parsedData.temp || '--'} °C</strong></div>`;
                        } else if (r.record_type === 'prescription' && parsedData.items) {
                            detailsHtml = `<div style="font-size:0.85em;margin-top:4px;"><strong>Rx:</strong> ${parsedData.items.map(i => `${i.medicine} (${i.dosage})`).join(', ')}</div>`;
                        } else if (r.record_type === 'lab_result') {
                            let paramsHtml = '';
                            if (parsedData.parameters && Object.keys(parsedData.parameters).length > 0) {
                                paramsHtml = Object.entries(parsedData.parameters).map(([key, val]) => `<li>${escapeHtml(key)}: <strong>${escapeHtml(String(val))}</strong></li>`).join('');
                                paramsHtml = `<ul style="margin:4px 0 0 14px; padding:0; font-size:0.85em;">${paramsHtml}</ul>`;
                            }
                            detailsHtml = `<div style="font-size:0.85em;margin-top:4px;"><strong>Test Type:</strong> ${escapeHtml(parsedData.test_name || 'General')}${paramsHtml}</div>`;
                        }
                    } catch(e) {}
                }

                return `
                    <div class="timeline-item">
                        <div class="timeline-date">${formatDateTime(r.created_at)}</div>
                        <div class="timeline-title flex-between">
                            <span><span class="badge ${badgeCls}">${typeLabel}</span></span>
                            <small class="text-muted">By: ${r.staff_full_name || r.staff_name || 'Clinic Staff'}</small>
                        </div>
                        <div class="timeline-desc">
                            ${richHtml
                                ? `<div class="rich-note">${richHtml}</div>`
                                : `<div>${escapeHtml(r.notes || 'No comments.')}</div>`}
                            ${detailsHtml}
                        </div>
                    </div>
                `;
            }).join('');
        }

    } catch (err) {
        console.error('Error loading my medical records:', err);
    }
    clearSkeleton('my-history-timeline');
}

// ── MEDICAL RECORD PDF EXPORT ────────────────────────────────────────
// Renders the patient's record as a formal clinic document via jsPDF
// (direct download, no print dialog). Reads the same endpoints and field
// mapping as loadMyMedicalRecords().
//
// Layout follows the conventions real clinic paperwork uses: serif
// letterhead, a titled document band, boxed demographics, ruled section
// headers, and a repeating footer carrying the confidentiality notice and
// page count.
// The letterhead, section headings, field grid and footer used below live in
// clinic-pdf.js, which frontdesk.html loads too - the walk-in intake and
// diagnosis forms are the same clinic's paperwork and print on the same
// stationery. Loaded before this file; see customer.html.

async function exportMedicalRecordPDF() {
    const btn = document.getElementById('export-med-pdf-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...'; }
    try {
        const [medRes, clinicalRes, settingsRes] = await Promise.all([
            fetch('/api/medical-records/my', { headers: authHeaders() }),
            fetch('/api/clinical-records/my', { headers: authHeaders() }),
            // Branding is best-effort: a failed settings call must not sink the export.
            fetch('/api/settings').catch(() => null)
        ]);
        const med = await medRes.json();
        const records = await clinicalRes.json();
        const settings = settingsRes && settingsRes.ok ? await settingsRes.json().catch(() => ({})) : {};

        const clinic = {
            name: settings.site_name || 'Medical Clinic',
            logoPath: settings.logo_path || '/images/examplelogo.svg'
        };
        const logo = await loadLogoDataUrl(clinic.logoPath);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const generatedAt = new Date().toLocaleString();
        const user = med.user || {};

        let ageText = '—';
        if (user.birthday) {
            const diff = Date.now() - new Date(user.birthday).getTime();
            ageText = Math.abs(new Date(diff).getUTCFullYear() - 1970) + ' years';
        }
        const category = user.customer_category || 'Regular';
        const patient = {
            name: user.full_name || getUsername() || 'Customer',
            id: user.customer_uid || ('MC-' + String(user.id || getUserId() || '').padStart(6, '0'))
        };

        pdfLetterhead(doc, clinic, logo);

        let y = PDF.headerBottom + 3;
        y = pdfSectionHeading(doc, 'Patient Information', y) + 1.5;
        y = pdfFieldGrid(doc, [
            ['Patient Name', patient.name],
            ['Patient ID', patient.id],
            ['Date of Birth', user.birthday ? new Date(user.birthday).toLocaleDateString() : '—'],
            ['Age', ageText],
            ['Sex', user.gender || 'Unspecified'],
            ['Priority Category', user.is_underage ? category + ' / Underage' : category],
            ['Civil Status', med.status || '—'],
            ['Occupation', med.occupation || '—'],
            ['Place of Birth', med.birthplace || '—'],
            ['Contact Number', med.phone || '—'],
            // Full width: a complete PH address won't fit in half a row.
            ['Residential Address', med.address || '—', 'full'],
            ['Emergency Contact', med.emergency_contact || '—', 'full']
        ], y);

        y += 6;
        y = pdfSectionHeading(doc, 'Reported Health Conditions', y) + 2;

        let symptomsText = 'None reported';
        if (med.current_health) {
            try {
                const arr = JSON.parse(med.current_health);
                if (Array.isArray(arr) && arr.length) symptomsText = arr.join(' · ');
            } catch (e) { symptomsText = med.current_health; }
        }
        y = pdfTextBlock(doc, 'Current', symptomsText, y);

        let pastText = 'None reported';
        if (med.past_conditions) {
            try {
                const pc = JSON.parse(med.past_conditions);
                if (pc && typeof pc === 'object') {
                    pastText = [
                        'High blood pressure: ' + (pc.high_bp || 'No'),
                        'Heart / circulation: ' + (pc.heart_problems || 'No'),
                        'Blood clots: ' + (pc.blood_clots || 'No'),
                        'High cholesterol: ' + (pc.high_cholesterol || 'No'),
                        'Surgeries: ' + (pc.surgeries || 'No') + (pc.surgeries === 'Yes' && pc.surgeries_details ? ' (' + pc.surgeries_details + ')' : '')
                    ].join(' · ');
                }
            } catch (e) { pastText = med.past_conditions; }
        }
        y = pdfTextBlock(doc, 'History', pastText, y);

        y += 5;
        y = pdfSectionHeading(doc, 'Consultation & Laboratory Records', y) + 2;

        const typeLabels = { prescription: 'Prescription', examination: 'Examination', diagnostic: 'Diagnostic', lab_result: 'Laboratory' };
        const tableRows = records.map(r => {
            let details = '';
            if (r.data) {
                try {
                    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                    if (r.record_type === 'examination') {
                        details = 'BP ' + (d.bp || '—') + '  ·  HR ' + (d.pulse || '—') + ' bpm  ·  Temp ' + (d.temp || '—') + ' °C';
                    } else if (r.record_type === 'prescription' && d.items) {
                        details = d.items.map(i => i.medicine + ' (' + i.dosage + ')').join('\n');
                    } else if (r.record_type === 'lab_result') {
                        const params = d.parameters
                            ? Object.entries(d.parameters).map(([k, v]) => k + ': ' + v).join('\n')
                            : '';
                        details = [d.test_name || 'General', params].filter(Boolean).join('\n');
                    }
                } catch (e) { /* leave details blank on malformed JSON */ }
            }
            return [
                formatDateTime(r.created_at),
                typeLabels[r.record_type] || r.record_type,
                details || '—',
                r.notes || '—',
                r.staff_full_name || r.staff_name || 'Clinic Staff'
            ];
        });

        if (tableRows.length === 0) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(8.8);
            doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
            doc.text('No consultation or laboratory records on file.', PDF.margin, y + 4);
            pdfFooter(doc, 1, generatedAt);
        } else {
            doc.autoTable({
                startY: y + 1,
                head: [['Date & Time', 'Type', 'Findings / Details', 'Remarks', 'Recorded By']],
                body: tableRows,
                theme: 'grid',
                margin: { left: PDF.margin, right: PDF.margin, top: PDF.runningHeaderBottom, bottom: 26 },
                styles: {
                    font: 'helvetica', fontSize: 7.6, cellPadding: 2.2,
                    textColor: PDF.ink, lineColor: PDF.hairline, lineWidth: 0.15,
                    valign: 'top', overflow: 'linebreak'
                },
                headStyles: {
                    fillColor: PDF.brand, textColor: [255, 255, 255],
                    fontSize: 7.4, fontStyle: 'bold', halign: 'left'
                },
                alternateRowStyles: { fillColor: [250, 251, 252] },
                columnStyles: {
                    0: { cellWidth: 26 },
                    1: { cellWidth: 20 },
                    2: { cellWidth: 48 },
                    3: { cellWidth: 'auto' },
                    4: { cellWidth: 26, textColor: PDF.muted }
                },
                // Stamps the running header and footer on every page the table
                // spills onto, so continuation sheets stand on their own.
                didDrawPage: () => {
                    const page = doc.internal.getCurrentPageInfo().pageNumber;
                    if (page > 1) pdfRunningHeader(doc, clinic, patient);
                    pdfFooter(doc, page, generatedAt);
                }
            });
        }

        // Page numbering is deferred: the total is only known once the table
        // has finished paginating.
        const total = doc.internal.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6.8);
            doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
            doc.text('Page ' + i + ' of ' + total, PDF.pageW - PDF.margin, PDF.footerTop + 11.5, { align: 'right' });
        }

        const safeName = String(patient.name).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        doc.save('medical-record-' + (safeName || 'patient') + '-' + new Date().toISOString().slice(0, 10) + '.pdf');
    } catch (err) {
        console.error('Error exporting medical record PDF:', err);
        showToast('Failed to generate PDF export', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-arrow-down"></i> Export PDF'; }
    }
}
