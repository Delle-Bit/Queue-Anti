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
let allLabs = [];
let allFdLogs = [];

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

        const newServingUserId = serving ? (serving.customer_id || serving.user_id) : null;
        if (currentServingUserId !== newServingUserId) {
            currentServingUserId = newServingUserId;
            loadPatientInfoPanel(currentServingUserId);
        }

        const waiting = queue.filter(q => q.status === 'waiting');
        document.getElementById('fd-queue-list').innerHTML = waiting.length === 0
            ? '<tr><td colspan="4" class="text-center text-muted">Queue empty</td></tr>'
            : waiting.map(w => `<tr><td><strong>${w.number}</strong></td><td>${categoryBadge(w.customer_category||'Regular')}</td><td>${w.full_name||w.username||'--'}</td><td>${formatTime(w.timestamp)}</td></tr>`).join('');

        document.getElementById('fd-avg').textContent = analytics.avg_time + 'm';
        document.getElementById('fd-perhr').textContent = analytics.per_hour;
        document.getElementById('fd-fastest').textContent = analytics.fastest ? analytics.fastest.mins + 'm' : '--';
        document.getElementById('fd-slowest').textContent = analytics.slowest ? analytics.slowest.mins + 'm' : '--';

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

async function fdCallNext() {
    const res = await fetch('/api/queue/next', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ station_type: 'frontdesk' }) });
    const data = await res.json();
    if (data.success) showToast('Calling: ' + data.next, 'success');
    else showToast(data.message || 'Queue empty', 'info');
    loadFdQueue();
}

async function fdComplete() {
    if (!currentServingQueueId) return showToast('No active transaction', 'error');
    const res = await fetch('/api/queue/complete-step', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: currentServingQueueId }) });
    const data = await res.json();
    showToast(data.finished ? 'Completed (final step)' : 'Completed → advancing to ' + (data.next_station||'next'), 'success');
    loadFdQueue();
}

// ── SERVICE MANAGEMENT ─────────────────────────────────────────
async function loadServiceMgmt() {
    await fetchLabs();
    const res = await fetch('/api/packages');
    const pkgs = await res.json();
    document.getElementById('svc-list').innerHTML = pkgs.map(p => `<tr>
        <td><strong>${p.name}</strong></td><td>${formatCurrency(p.price)}</td><td>${p.est_time_minutes}m</td>
        <td>${(p.laboratories||[]).map(l=>l.lab_name).join(' → ') || 'None'}</td>
        <td>${p.is_available === false ? '<span class="badge badge-danger">Currently Unavailable</span>' : `<span class="badge ${p.is_active?'badge-success':'badge-danger'}">${p.is_active?'Active':'Inactive'}</span>`}</td>
        <td><button class="btn btn-sm btn-secondary" onclick='editService(${JSON.stringify(p).replace(/'/g,"&apos;")})'><i class="fa-solid fa-pen"></i></button></td>
    </tr>`).join('');
}

function editService(pkg) {
    document.getElementById('svc-edit-id').value = pkg.id;
    document.getElementById('svc-name').value = pkg.name;
    document.getElementById('svc-desc').value = pkg.description || '';
    document.getElementById('svc-price').value = pkg.price;
    document.getElementById('svc-time').value = pkg.est_time_minutes;
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
            <span><i class="fa-solid fa-grip-vertical text-muted mr-sm"></i> <strong>${i+1}.</strong> ${l.lab_name || allLabs.find(x=>x.id==l.laboratory_id)?.name || 'Lab #'+l.laboratory_id}</span>
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
        est_time_minutes: est_time_minutes,
        laboratories: finalLabs
    };
    const url = id ? `/api/packages/${id}` : '/api/packages';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    if (res.ok) { closeModal('svc-modal'); showToast('Saved!', 'success'); loadServiceMgmt(); }
    else showToast('Failed to save', 'error');
}

// ── APPOINTMENTS ───────────────────────────────────────────────
async function loadFdAppointments() {
    const res = await fetch('/api/appointments', { headers: authHeaders() });
    const appts = await res.json();
    document.getElementById('fd-appt-list').innerHTML = appts.map(a => `<tr>
        <td>${a.full_name||a.username}</td><td>${a.package_name}</td><td>${a.appointment_date}</td>
        <td>${a.appointment_time}</td><td><span class="badge ${a.status==='scheduled'?'badge-warning':'badge-success'}">${a.status}</span></td>
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
