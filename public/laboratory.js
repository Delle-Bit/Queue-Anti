if (!requireAuth(['laboratory','admin','admintechnical'])) throw new Error('Unauthorized');

// Find this lab staff's assigned laboratory
let myLabId = null;
let currentLabQueueId = null;
let currentServingUserId = null;
let allLabLogs = [];

async function findMyLab() {
    const res = await fetch('/api/laboratories', { headers: authHeaders() });
    const labs = await res.json();
    const uid = getUserId();
    const myLab = labs.find(l => l.assigned_staff_id == uid);
    if (myLab) {
        myLabId = myLab.id;
        document.getElementById('lab-subtitle').textContent = myLab.name + ' — ' + (myLab.service_type || 'General');
    } else if (labs.length > 0) {
        myLabId = labs[0].id;
        document.getElementById('lab-subtitle').textContent = labs[0].name + ' (unassigned)';
    }
}

renderSidebar([
    { section: 'LABORATORY' },
    { id: 'queue', label: 'Queue', icon: 'fa-solid fa-microscope' },
    { id: 'appointments', label: 'Appointments', icon: 'fa-solid fa-calendar' }
], 'queue');
initDefaultSection();

window.onSectionLoad = { queue: loadLabQueue, appointments: loadLabAppts };

async function loadLabQueue() {
    if (!myLabId) await findMyLab();
    if (!myLabId) return;
    try {
        const [qRes, aRes] = await Promise.all([
            fetch(`/api/queue/station?type=laboratory&id=${myLabId}`, { headers: authHeaders() }),
            fetch(`/api/analytics/laboratory/${myLabId}`, { headers: authHeaders() })
        ]);
        const queue = await qRes.json();
        const analytics = await aRes.json();

        const serving = queue.find(q => q.status === 'serving');
        document.getElementById('lab-serving').textContent = serving ? serving.number : '--';
        document.getElementById('lab-serving-name').textContent = serving ? (serving.full_name || serving.username || '') : '';
        currentLabQueueId = serving ? serving.id : null;
        currentServingUserId = serving ? serving.customer_id || serving.user_id : null; // queue logs often store customer_id or user_id

        const waiting = queue.filter(q => q.status === 'waiting');
        document.getElementById('lab-queue-list').innerHTML = waiting.length === 0
            ? '<tr><td colspan="4" class="text-center text-muted">Empty</td></tr>'
            : waiting.map(w => `<tr><td><strong>${w.number}</strong></td><td>${categoryBadge(w.customer_category||'Regular')}</td><td>${w.full_name||w.username||'--'}</td><td>${formatTime(w.timestamp)}</td></tr>`).join('');

        document.getElementById('lab-avg').textContent = analytics.avg_time + 'm';
        document.getElementById('lab-perhr').textContent = analytics.per_hour;
        document.getElementById('lab-finish').textContent = analytics.est_finish + 'm';
        document.getElementById('lab-waiting').textContent = analytics.waiting_count;

        document.getElementById('lab-dist').innerHTML = (analytics.distribution || []).map(d => {
            const labels = {Q:'Regular',S:'Senior',D:'PWD',P:'Pregnant'};
            return `<div class="flex-between" style="padding:6px 0;"><span>${labels[d.type]||d.type}</span><span class="fw-600">${d.cnt}</span></div>`;
        }).join('') || '<span class="text-muted">No data</span>';

        allLabLogs = analytics.logs || [];
        renderLabLogsList(allLabLogs);
    } catch (err) { console.error(err); }
}

function renderLabLogsList(logs) {
    document.getElementById('lab-logs').innerHTML = logs.map(l => `<tr>
        <td>${l.ticket_number}</td><td>${l.type}</td><td>${l.package_name||'--'}</td>
        <td>${formatTime(l.join_time)}</td><td>${formatTime(l.serve_time)}</td><td>${formatTime(l.complete_time)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted">No logs</td></tr>';
}

function filterLabLogs(q) {
    renderLabLogsList(allLabLogs.filter(l => (l.ticket_number||'').toLowerCase().includes(q.toLowerCase())));
}

async function labCallNext() {
    if (!myLabId) return;
    const res = await fetch('/api/queue/next', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ station_type: 'laboratory', station_id: myLabId }) });
    const data = await res.json();
    if (data.success) showToast('Calling: ' + data.next, 'success');
    else showToast(data.message || 'Queue empty', 'info');
    loadLabQueue();
}

async function labComplete() {
    if (!currentLabQueueId) return showToast('No active patient', 'error');
    const res = await fetch('/api/queue/complete-step', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: currentLabQueueId }) });
    const data = await res.json();
    showToast(data.finished ? 'All steps completed!' : 'Advancing to: ' + (data.next_station || 'next'), 'success');
    loadLabQueue();
}

async function loadLabAppts() {
    const res = await fetch('/api/appointments', { headers: authHeaders() });
    const appts = await res.json();
    document.getElementById('lab-appt-list').innerHTML = appts.map(a => `<tr>
        <td>${a.full_name||a.username}</td><td>${a.package_name}</td><td>${a.appointment_date}</td>
        <td>${a.appointment_time}</td><td><span class="badge ${a.status==='scheduled'?'badge-warning':'badge-success'}">${a.status}</span></td>
    </tr>`).join('');
}

async function viewPatient() {
    if (!currentServingUserId) return showToast('No active patient being served', 'error');
    document.getElementById('patient-user-id').value = currentServingUserId;
    document.getElementById('patient-lab-note').value = '';
    
    try {
        const [medRes, notesRes] = await Promise.all([
            fetch(`/api/medical-records/${currentServingUserId}`, { headers: authHeaders() }),
            fetch(`/api/lab-notes/${currentServingUserId}`, { headers: authHeaders() })
        ]);
        
        const med = await medRes.json();
        const labNotes = await notesRes.json();
        
        if (med) {
            let chHtml = med.current_health || '--';
            let pcHtml = med.past_conditions || '--';
            
            try {
                if (med.current_health) {
                    const chArr = JSON.parse(med.current_health);
                    if (Array.isArray(chArr) && chArr.length > 0) {
                        chHtml = chArr.map(i => `<span class="badge badge-warning" style="margin-right:4px;margin-bottom:4px;display:inline-block;">${i}</span>`).join('');
                    } else if (Array.isArray(chArr)) {
                        chHtml = '<span class="text-muted">None reported</span>';
                    }
                }
            } catch(e) {}
            
            try {
                if (med.past_conditions) {
                    const pcObj = JSON.parse(med.past_conditions);
                    if (pcObj && typeof pcObj === 'object') {
                        pcHtml = `<ul style="margin:0;padding-left:16px;">
                            <li>Heart/Circulation: <strong>${pcObj.heart_problems}</strong></li>
                            <li>Blood Clots: <strong>${pcObj.blood_clots}</strong></li>
                            <li>High/Low BP: <strong>${pcObj.high_bp}</strong></li>
                            <li>High Cholesterol: <strong>${pcObj.high_cholesterol}</strong></li>
                            <li>STD/HIV: <strong>${pcObj.std_hiv}</strong></li>
                            <li>Surgeries: <strong>${pcObj.surgeries}</strong> ${pcObj.surgeries === 'Yes' ? `(${pcObj.surgeries_details||'Unspecified'})` : ''}</li>
                        </ul>`;
                    }
                }
            } catch(e) {}

            document.getElementById('patient-medical-data').innerHTML = `
                <div class="grid-2">
                    <div><strong>Birthplace:</strong> ${med.birthplace || '--'}</div>
                    <div><strong>Occupation:</strong> ${med.occupation || '--'}</div>
                    <div style="grid-column: span 2; margin-top:10px;"><strong>Past Conditions:</strong><div style="margin-top:4px;">${pcHtml}</div></div>
                    <div style="grid-column: span 2; margin-top:10px;"><strong>Current Health:</strong><div style="margin-top:4px;">${chHtml}</div></div>
                </div>
            `;
        } else {
            document.getElementById('patient-medical-data').innerHTML = '<span class="text-muted">No medical records found.</span>';
        }
        
        if (labNotes.length > 0) {
            document.getElementById('patient-lab-notes-list').innerHTML = labNotes.map(n => `
                <div style="padding:10px;border-bottom:1px solid var(--border-light);">
                    <div style="font-weight:bold;">${formatDateTime(n.created_at)} (Staff: ${n.staff_name || 'Unknown'})</div>
                    <div>${n.note}</div>
                </div>
            `).join('');
        } else {
            document.getElementById('patient-lab-notes-list').innerHTML = '<span class="text-muted">No previous notes.</span>';
        }
        
        openModal('patient-modal');
    } catch(err) {
        showToast('Error loading patient data', 'error');
        console.error(err);
    }
}

async function saveLabNote() {
    const userId = document.getElementById('patient-user-id').value;
    const note = document.getElementById('patient-lab-note').value;
    if (!note.trim()) return showToast('Note cannot be empty', 'error');
    
    try {
        const res = await fetch('/api/lab-notes', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ customer_id: userId, note: note })
        });
        if (res.ok) {
            showToast('Note saved!', 'success');
            viewPatient(); // Reload
        } else {
            showToast('Failed to save note', 'error');
        }
    } catch(err) { console.error(err); }
}

findMyLab().then(loadLabQueue);
function onQueueUpdate() { loadLabQueue(); }
setInterval(() => { if (document.getElementById('section-queue').style.display !== 'none') loadLabQueue(); }, 5000);
