if (!requireAuth(['customer'])) throw new Error('Unauthorized');

const navItems = [
    { section: 'MENU' },
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-gauge-high' },
    { id: 'services', label: 'Services', icon: 'fa-solid fa-flask' },
    { id: 'appointments', label: 'Appointments', icon: 'fa-solid fa-calendar-check' }
];
renderSidebar(navItems, 'dashboard');
initDefaultSection();

let selectedPackageId = null;
let medicalFormComplete = false;
let calendarDate = new Date();
const APPT_SLOTS = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00'];
window.onSectionLoad = {
    dashboard: loadDashboard,
    services: loadServices,
    appointments: loadAppointments
};

// ── DASHBOARD ──────────────────────────────────────────────────
async function loadDashboard() {
    await checkMandatoryMedicalForm(false);
    try {
        const res = await fetch('/api/queue/my-status', { headers: authHeaders() });
        const data = await res.json();
        if (!data.active) {
            document.getElementById('no-active-queue').style.display = 'block';
            document.getElementById('active-queue-panel').style.display = 'none';
            return;
        }
        document.getElementById('no-active-queue').style.display = 'none';
        document.getElementById('active-queue-panel').style.display = 'block';

        document.getElementById('dash-position').textContent = data.position || '--';
        document.getElementById('dash-ahead').textContent = data.people_ahead;
        document.getElementById('dash-eta').textContent = data.estimated_time > 0 ? data.estimated_time + 'm' : '--';
        document.getElementById('dash-ticket').textContent = data.current_queue ? data.current_queue.number : '--';

        const stationLabel = data.current_queue
            ? (data.current_queue.station_type === 'frontdesk' ? 'Front Desk' : data.steps.find(s=>s.status==='active')?.name || 'Processing')
            : '--';
        document.getElementById('dash-current-station').textContent = 'Currently at: ' + stationLabel;

        // Render stepper
        let stepperHtml = '<div class="queue-stepper">';
        data.steps.forEach((step, i) => {
            if (i > 0) stepperHtml += `<div class="step-line ${step.status==='completed'?'completed':''}"></div>`;
            const icon = step.status==='completed' ? '<i class="fa-solid fa-check"></i>' : (i+1);
            stepperHtml += `<div class="step ${step.status}"><div class="step-circle">${icon}</div><div class="step-label">${step.name}</div></div>`;
        });
        stepperHtml += '</div>';
        document.getElementById('queue-stepper-container').innerHTML = stepperHtml;
    } catch (err) { console.error('Dashboard error:', err); }
}

// ── SERVICES ───────────────────────────────────────────────────
async function loadServices() {
    try {
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
    try {
        const res = await fetch('/api/queue/start-package', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ package_id: selectedPackageId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            closeModal('pkg-modal');
            showToast('Queued successfully! Ticket: ' + data.ticket, 'success');
            navigateTo('dashboard');
            loadDashboard();
        } else {
            if (data.medical_form_required) openModal('mandatory-med-modal');
            showToast(data.error || 'Failed to queue', 'error');
        }
    } catch (err) { showToast('Connection error', 'error'); }
    btn.disabled = false;
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
        const res = await fetch('/api/appointments/my', { headers: authHeaders() });
        const appts = await res.json();
        const tbody = document.getElementById('appointments-list');
        if (appts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:32px;">No appointments yet</td></tr>';
        } else {
            tbody.innerHTML = appts.map(a => `<tr>
                <td><strong>${a.package_name}</strong></td>
                <td>${a.appointment_date}</td>
                <td>${a.appointment_time}</td>
                <td><span class="badge ${a.status==='scheduled'?'badge-warning':a.status==='paid'||a.status==='checked-in'?'badge-success':'badge-neutral'}">${a.status}</span></td>
                <td>${formatCurrency(a.price)}</td>
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

        if (!data.id && force) {
            // No medical record found, show modal and prefill user data
            if (data.user) {
                const parts = (data.user.full_name || '').trim().split(/\s+/).filter(Boolean);
                if (parts.length > 1 && !document.getElementById('req-med-first-name').value) {
                    document.getElementById('req-med-first-name').value = parts.slice(0, -1).join(' ');
                    document.getElementById('req-med-surname').value = parts[parts.length - 1];
                }
                document.getElementById('req-med-gender').value = data.user.gender || '';
                if (data.user.birthday) {
                    const d = new Date(data.user.birthday);
                    document.getElementById('req-med-birthdate').value = d.toISOString().split('T')[0];
                }
            }
            openModal('mandatory-med-modal');
        }
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
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
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

let cameraStream = null;

async function toggleCamera() {
    const btn = document.getElementById('camera-toggle-btn');
    const captureBtn = document.getElementById('camera-capture-btn');
    const video = document.getElementById('camera-stream');
    const status = document.getElementById('req-scan-status');

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
        video.style.display = 'none';
        captureBtn.style.display = 'none';
        btn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
        status.textContent = '';
    } else {
        try {
            status.textContent = 'Requesting camera access...';
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = cameraStream;
            video.style.display = 'block';
            captureBtn.style.display = 'inline-block';
            btn.innerHTML = '<i class="fa-solid fa-camera-slash"></i> Stop Camera';
            status.textContent = 'Camera ready — position your ID and click Capture';
        } catch (err) {
            status.textContent = 'Camera access denied or not available';
            console.error(err);
        }
    }
}

async function captureIDPhoto() {
    const video = document.getElementById('camera-stream');
    const canvas = document.getElementById('capture-canvas');
    const status = document.getElementById('req-scan-status');

    if (!video.srcObject) {
        status.textContent = 'Camera not active';
        return;
    }

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    status.textContent = 'Processing ID...';

    canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('idImage', blob, 'id-photo.jpg');

        try {
            const res = await fetch('/api/auth/ocr', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.success) {
                if (data.name) {
                    const parts = data.name.trim().split(/\s+/).filter(Boolean);
                    document.getElementById('req-med-first-name').value = parts.slice(0, -1).join(' ');
                    document.getElementById('req-med-surname').value = parts[parts.length - 1] || '';
                }
                if (data.gender) document.getElementById('req-med-gender').value = data.gender;
                if (data.birthday) {
                    document.getElementById('req-med-birthdate').value = data.birthday;
                }
                status.textContent = 'ID scan complete! Fields auto-filled.';
                cameraStream.getTracks().forEach(track => track.stop());
                cameraStream = null;
                document.getElementById('camera-stream').style.display = 'none';
                document.getElementById('camera-capture-btn').style.display = 'none';
                document.getElementById('camera-toggle-btn').innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
            } else {
                status.textContent = 'Scan failed. Try again.';
            }
        } catch (err) {
            status.textContent = 'Scan error. Try again.';
            console.error(err);
        }
    }, 'image/jpeg', 0.9);
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
        if (res.ok) {
            closeModal('mandatory-med-modal');
            medicalFormComplete = true;
            showToast('Medical record saved successfully!', 'success');
        } else {
            showToast('Failed to save medical form', 'error');
        }
    } catch (err) { console.error(err); showToast('Connection error', 'error'); }
}

const origOpenModal = window.openModal;
window.openModal = async function(id) {
    if (id === 'appt-modal') {
        if (!(await ensureMedicalFormComplete(true))) return;
        resetApptModal();
        renderAppointmentCalendar();
    }
    if (origOpenModal) origOpenModal(id);
    else document.getElementById(id)?.classList.add('active');
};
