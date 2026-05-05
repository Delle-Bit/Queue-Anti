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
window.onSectionLoad = {
    dashboard: loadDashboard,
    services: loadServices,
    appointments: loadAppointments
};

// ── DASHBOARD ──────────────────────────────────────────────────
async function loadDashboard() {
    await checkMandatoryMedicalForm();
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

        // Set min date to tomorrow
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('appt-date').min = tomorrow.toISOString().split('T')[0];
        document.getElementById('appt-date').value = tomorrow.toISOString().split('T')[0];
    } catch (err) { console.error(err); }
}

function selectPayMethod(method) {
    document.getElementById('appt-pay-method').value = method;
    showToast(`Payment method: ${method.toUpperCase()}`, 'info', 1500);
}

async function bookAppointment() {
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
        } else { showToast('Failed to book', 'error'); }
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
    const dateObj = new Date(dateInput);
    const day = dateObj.getDay();
    const grid = document.getElementById('appt-time-slots');
    
    if (day === 0) {
        grid.innerHTML = '<div class="text-warning"><i class="fa-solid fa-triangle-exclamation"></i> Closed on Sundays</div>';
        selectedTimeSlot = null;
        return;
    }

    try {
        const res = await fetch(`/api/queue/booked-slots?date=${dateInput}`, { headers: authHeaders() });
        const booked = await res.json();
        
        let slotsHtml = '';
        for (let h = 8; h <= 15; h++) {
            const timeStr = `${h.toString().padStart(2, '0')}:00`;
            const isBooked = booked.includes(timeStr);
            const className = isBooked ? 'time-slot full' : 'time-slot';
            const clickAttr = isBooked ? '' : `onclick="selectTimeSlot('${timeStr}')"`;
            slotsHtml += `<div class="${className}" id="ts-${timeStr}" ${clickAttr}>${timeStr}</div>`;
        }
        grid.innerHTML = slotsHtml;
        selectedTimeSlot = null;
    } catch (err) { grid.innerHTML = '<div class="text-danger">Failed to load slots</div>'; }
}

function selectTimeSlot(timeStr) {
    document.querySelectorAll('.time-slot').forEach(el => el.classList.remove('selected'));
    document.getElementById(`ts-${timeStr}`).classList.add('selected');
    selectedTimeSlot = timeStr;
}

// ── MANDATORY MEDICAL FORM ─────────────────────────────────────────

async function checkMandatoryMedicalForm() {
    try {
        const res = await fetch('/api/medical-records/my', { headers: authHeaders() });
        const data = await res.json();
        
        if (!data.id) {
            // No medical record found, show modal and prefill user data
            if (data.user) {
                document.getElementById('req-med-name').value = data.user.full_name || '';
                document.getElementById('req-med-gender').value = data.user.gender || '';
                if (data.user.birthday) {
                    const d = new Date(data.user.birthday);
                    document.getElementById('req-med-birthdate').value = d.toISOString().split('T')[0];
                    calculateAge();
                }
            }
            document.getElementById('mandatory-med-modal').style.display = 'flex';
        }
    } catch (err) { console.error('Failed to check medical form', err); }
}

function calculateAge() {
    const dob = document.getElementById('req-med-birthdate').value;
    if (dob) {
        const age = new Date().getFullYear() - new Date(dob).getFullYear();
        document.getElementById('req-med-age').value = age > 0 ? age : 0;
    }
}

function toggleSurgeryInput() {
    const val = document.getElementById('pc-surgeries').value;
    document.getElementById('surgery-spec-div').style.display = val === 'Yes' ? 'block' : 'none';
}

async function scanReqID() {
    const fileInput = document.getElementById('req-id-scan');
    if (!fileInput.files.length) return;
    
    const status = document.getElementById('req-scan-status');
    status.textContent = 'Scanning...';
    
    const formData = new FormData();
    formData.append('idImage', fileInput.files[0]);
    
    try {
        const res = await fetch('/api/auth/ocr', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            if (data.name) document.getElementById('req-med-name').value = data.name;
            if (data.gender) document.getElementById('req-med-gender').value = data.gender;
            if (data.birthday) {
                document.getElementById('req-med-birthdate').value = data.birthday;
                calculateAge();
            }
            status.textContent = 'Scan complete! Fields auto-filled.';
        } else { status.textContent = 'Scan failed.'; }
    } catch (err) { status.textContent = 'Scan error.'; }
}

async function submitMandatoryMedicalForm() {
    const name = document.getElementById('req-med-name').value;
    const gender = document.getElementById('req-med-gender').value;
    const birthdate = document.getElementById('req-med-birthdate').value;
    
    if (!name || !gender || !birthdate) return showToast('Please complete Personal Details', 'error');

    const birthplace = document.getElementById('req-med-birthplace').value;
    const status = document.getElementById('req-med-status').value;
    const address = document.getElementById('req-med-address').value;
    const phone = document.getElementById('req-med-phone').value;
    const occupation = document.getElementById('req-med-occupation').value;
    const emergency = document.getElementById('req-med-emergency').value;

    if (!birthplace || !status || !address || !phone || !occupation || !emergency) return showToast('Please complete all text fields', 'error');

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
            document.getElementById('mandatory-med-modal').style.display = 'none';
            showToast('Medical record saved successfully!', 'success');
        } else {
            showToast('Failed to save medical form', 'error');
        }
    } catch (err) { console.error(err); showToast('Connection error', 'error'); }
}

const origOpenModal = window.openModal;
window.openModal = function(id) {
    if (id === 'appt-modal') {
        resetApptModal();
        if (document.getElementById('appt-date').value) fetchTimeSlots();
    }
    if (origOpenModal) origOpenModal(id);
    else document.getElementById(id)?.classList.add('active');
};
