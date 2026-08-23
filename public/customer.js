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
async function loadDashboard() {
    await checkMandatoryMedicalForm(false);
    showSectionLoader('active-queue-panel', 'Updating queue status...');
    try {
        const res = await fetch('/api/queue/my-status', { headers: authHeaders() });
        const data = await res.json();
        if (!data.active) {
            document.getElementById('no-active-queue').style.display = 'block';
            document.getElementById('active-queue-panel').style.display = 'none';
            hideSectionLoader('active-queue-panel');
            return;
        }
        document.getElementById('no-active-queue').style.display = 'none';
        document.getElementById('active-queue-panel').style.display = 'block';

        document.getElementById('dash-ahead').textContent = data.people_ahead;
        document.getElementById('dash-eta').textContent = data.estimated_total_time > 0 ? data.estimated_total_time + ' minutes' : '--';
        document.getElementById('dash-ticket').textContent = data.current_queue ? data.current_queue.number : '--';
        document.getElementById('dash-current-processing').textContent = data.current_processing || '--';

        const stationLabel = data.current_queue
            ? (data.current_queue.station_type === 'frontdesk' ? 'Front Desk' : data.steps.find(s=>s.status==='active')?.name || 'Processing')
            : '--';
        document.getElementById('dash-current-station').textContent = 'Currently at: ' + stationLabel;

        document.getElementById('queue-stepper-container').innerHTML = renderQueueTrack(data.steps);
    } catch (err) { console.error('Dashboard error:', err); }
    hideSectionLoader('active-queue-panel');
}

// Linear queue track: one continuous horizontal progress rail with a department
// milestone per step. Real-time status and wait estimates sit under each node.
function renderQueueTrack(steps = []) {
    if (!steps.length) return '<div class="queue-track-empty text-muted">No queue steps to show.</div>';

    const labels = { pending: 'Waiting', active: 'In Progress', completed: 'Completed' };
    const icons = { pending: 'fa-clock', active: 'fa-spinner fa-spin', completed: 'fa-check' };
    const typeLabels = { frontdesk: 'Verification & payment', doctor: 'Consultation', laboratory: 'Laboratory' };

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
                <small>${typeLabels[step.type] || 'Service'} · ${detail}</small>
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
async function loadServices() {
    try {
        showSectionLoader('packages-grid', 'Loading services...');
        const res = await fetch('/api/packages');
        const packages = await res.json();
        const grid = document.getElementById('packages-grid');
        if (packages.length === 0) {
            grid.innerHTML = '<div class="card text-center" style="grid-column:1/-1;padding:40px;"><p class="text-muted">No services available yet.</p></div>';
            return;
        }
        grid.innerHTML = packages.map(p => `
            <div class="pkg-card" onclick="showPackageDetail(${p.id})">
                <div class="pkg-card-badge">${categoryBadge(getCategory())}</div>
                <h3>${p.name}</h3>
                <p>${p.description || 'No description'}</p>
                <div class="pkg-card-footer">
                    <span class="pkg-price">${formatCurrency(p.price)}</span>
                    <span class="pkg-time"><i class="fa-solid fa-clock"></i> ~${p.est_time_minutes}min</span>
                </div>
                <div class="mt-sm text-sm text-muted">${p.laboratories?.length || 0} lab step(s)</div>
            </div>
        `).join('');
    } catch (err) { console.error(err); }
    hideSectionLoader('packages-grid');
}

async function showPackageDetail(id) {
    if (!(await ensureMedicalFormComplete(true))) return;
    selectedPackageId = id;
    try {
        const res = await fetch(`/api/packages/${id}/details`);
        const pkg = await res.json();
        document.getElementById('pkg-modal-name').textContent = pkg.name;
        document.getElementById('pkg-modal-desc').textContent = pkg.description || '';
        document.getElementById('pkg-modal-price').textContent = formatCurrency(pkg.price);
        document.getElementById('pkg-modal-eta').textContent = pkg.estimated_total_time + ' minutes';

        const labsHtml = (pkg.laboratories || []).map((l, i) => `
            <div class="pkg-lab-item">
                <div class="pkg-lab-num">${i+1}</div>
                <div class="pkg-lab-info"><strong>${l.lab_name}</strong><small>${l.service_type || ''} • ~${l.est_time_minutes}min</small></div>
            </div>
        `).join('');
        document.getElementById('pkg-modal-labs').innerHTML = labsHtml || '<p class="text-muted text-sm">No laboratory steps</p>';
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
        if (tbody) tbody.innerHTML = '<tr><td colspan="6"><div class="medical-inline-loader"><span class="medical-loader-heart"></span> Loading appointments...</div></td></tr>';
        const res = await fetch('/api/appointments/my', { headers: authHeaders() });
        const appts = await res.json();
        if (appts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:32px;">No appointments yet</td></tr>';
        } else {
            tbody.innerHTML = appts.map(a => `<tr>
                <td><strong>${a.package_name}</strong></td>
                <td>${a.appointment_date}</td>
                <td>${a.appointment_time}</td>
                <td><span class="badge ${a.status==='scheduled'?'badge-warning':a.status==='paid'||a.status==='checked-in'?'badge-success':'badge-neutral'}">${a.status}</span></td>
                <td>${formatCurrency(a.price)}</td>
                <td>
                    ${a.status === 'scheduled' ? `<button class="btn btn-sm btn-primary" onclick="openCheckInScanner(${a.id})"><i class="fa-solid fa-qrcode"></i> Check-In</button>` : '--'}
                </td>
            </tr>`).join('');
        }

        // Populate appointment modal package select
        const pkgRes = await fetch('/api/packages');
        const pkgs = await pkgRes.json();
        const sel = document.getElementById('appt-package');
        sel.innerHTML = pkgs.map(p => `<option value="${p.id}" data-price="${p.price}">${p.name} — ${formatCurrency(p.price)}</option>`).join('');
        sel.onchange = () => {
            const opt = sel.options[sel.selectedIndex];
            document.getElementById('appt-amount').textContent = formatCurrency(opt.dataset.price);
        };
        if (sel.options.length > 0) sel.onchange();

        renderAppointmentCalendar();
    } catch (err) { console.error(err); }
}

function selectPayMethod(method) {
    document.getElementById('appt-pay-method').value = method;
    showToast(`Payment method: ${method.toUpperCase()}`, 'info', 1500);
}

async function bookAppointment() {
    if (!(await ensureMedicalFormComplete(true))) return;
    const pkg = document.getElementById('appt-package').value;
    const date = document.getElementById('appt-date').value;
    const time = selectedTimeSlot;
    const notes = document.getElementById('appt-notes').value;
    const method = document.getElementById('appt-pay-method').value;
    if (!pkg || !date || !time) return showToast('Fill all fields', 'error');

    const btn = document.getElementById('appt-confirm-btn');
    btn.disabled = true;
    try {
        const res = await fetch('/api/appointments', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ package_id: pkg, appointment_date: date, appointment_time: time, payment_method: method, notes })
        });
        if (res.ok) {
            closeModal('appt-modal');
            showToast('Appointment booked!', 'success');
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
        APPT_SLOTS.forEach(timeStr => {
            const isBooked = booked.includes(timeStr);
            const className = isBooked ? 'time-slot full' : 'time-slot';
            const clickAttr = isBooked ? '' : `onclick="selectTimeSlot('${timeStr}')"`;
            slotsHtml += `<div class="${className}" id="ts-${timeStr}" ${clickAttr}>${timeStr}</div>`;
        });
        grid.innerHTML = slotsHtml;
        selectedTimeSlot = null;
    } catch (err) { grid.innerHTML = '<div class="text-danger">Failed to load slots</div>'; }
}

function selectTimeSlot(timeStr) {
    document.querySelectorAll('.time-slot').forEach(el => el.classList.remove('selected'));
    document.getElementById(`ts-${timeStr}`).classList.add('selected');
    selectedTimeSlot = timeStr;
    document.getElementById('selected-appt-time').textContent = `at ${timeStr}`;
    closeModal('slot-modal');
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
        days += `<button type="button" class="calendar-day ${muted} ${selected} ${hasBooking}" onclick="selectAppointmentDate('${iso}')">${d.getDate()}</button>`;
    }
    cal.innerHTML = heads + days;
}

function changeCalendarMonth(delta) {
    calendarDate.setMonth(calendarDate.getMonth() + delta);
    renderAppointmentCalendar();
}

function selectAppointmentDate(iso) {
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
    const address = document.getElementById('req-med-address').value;
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
        setVal('req-med-address', med.address);
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
        if (timelineEl) timelineEl.innerHTML = '<div class="medical-inline-loader"><span class="medical-loader-heart"></span> Loading records...</div>';
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
                if (r.data) {
                    try {
                        const parsedData = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
                        if (r.record_type === 'examination') {
                            detailsHtml = `<div style="font-size:0.85em;margin-top:4px;">BP: <strong>${parsedData.bp || '--'}</strong> | HR: <strong>${parsedData.pulse || '--'} bpm</strong> | Temp: <strong>${parsedData.temp || '--'} °C</strong></div>`;
                        } else if (r.record_type === 'prescription' && parsedData.items) {
                            detailsHtml = `<div style="font-size:0.85em;margin-top:4px;"><strong>Rx:</strong> ${parsedData.items.map(i => `${i.medicine} (${i.dosage})`).join(', ')}</div>`;
                        } else if (r.record_type === 'lab_result') {
                            let paramsHtml = '';
                            if (parsedData.parameters) {
                                paramsHtml = Object.entries(parsedData.parameters).map(([key, val]) => `<li>${key}: <strong>${val}</strong></li>`).join('');
                                paramsHtml = `<ul style="margin:4px 0 0 14px; padding:0; font-size:0.85em;">${paramsHtml}</ul>`;
                            }
                            detailsHtml = `<div style="font-size:0.85em;margin-top:4px;"><strong>Test Type:</strong> ${parsedData.test_name || 'General'}${paramsHtml}</div>`;
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
                            <div>${escapeHtml(r.notes || 'No comments.')}</div>
                            ${detailsHtml}
                        </div>
                    </div>
                `;
            }).join('');
        }

    } catch (err) {
        console.error('Error loading my medical records:', err);
    }
}

