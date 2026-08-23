if (!requireAuth(['laboratory','admin','admintechnical'])) throw new Error('Unauthorized');

// Find this lab staff's assigned laboratory
let myLabId = null;
let currentLabQueueId = null;
let currentServingUserId = null;
let currentSequenceId = null;
let currentServingTicket = null;
let allLabLogs = [];

async function findMyLab() {
    try {
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
    } catch(err) {
        console.error('Error finding lab station:', err);
    }
}

renderSidebar([
    { section: 'LABORATORY' },
    { id: 'queue', label: 'Queue', icon: 'fa-solid fa-microscope' },
    { id: 'results', label: 'Enter Results', icon: 'fa-solid fa-square-poll-vertical' },
    { id: 'appointments', label: 'Appointments', icon: 'fa-solid fa-calendar' }
], 'queue');
initDefaultSection();

window.onSectionLoad = {
    queue: loadLabQueue,
    results: loadResultsWorkspace,
    appointments: loadLabAppts
};

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
        document.getElementById('lab-serving-name').textContent = serving ? (serving.full_name || serving.username || '') : 'No patient currently active';

        currentLabQueueId = serving ? serving.id : null;
        currentServingUserId = serving ? (serving.customer_id || serving.user_id) : null;
        currentSequenceId = serving ? serving.sequence_id : null;
        currentServingTicket = serving ? serving.number : null;

        const waiting = queue.filter(q => q.status === 'waiting');
        document.getElementById('lab-queue-list').innerHTML = waiting.length === 0
            ? '<tr><td colspan="4" class="text-center text-muted">Empty</td></tr>'
            : waiting.map(w => `<tr><td><strong>${w.number}</strong></td><td>${categoryBadge(w.customer_category||'Regular')}</td><td>${w.full_name||w.username||'--'}</td><td>${formatTime(w.timestamp)}</td></tr>`).join('');

        const parked = queue.filter(q => q.status === 'parked');
        document.getElementById('lab-parked-list').innerHTML = parked.length === 0
            ? '<tr><td colspan="5" class="text-center text-muted">No one parked</td></tr>'
            : parked.map(p => `<tr>
                <td><strong>${p.number}</strong></td><td>${p.full_name||p.username||'--'}</td><td>${formatTime(p.parked_at)}</td>
                <td>${p.sample_ready_at ? '<span class="badge badge-success">Ready</span>' : '<span class="text-muted">Waiting</span>'}</td>
                <td><button class="btn btn-sm btn-primary" onclick="labUnpark('${p.id}')"><i class="fa-solid fa-arrow-rotate-left"></i> Sample Received</button></td>
            </tr>`).join('');

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
    if (data.success) {
        showToast('Calling: ' + data.next, 'success');
        loadLabQueue();
    } else {
        showToast(data.message || 'Queue empty', 'info');
    }
}

async function labComplete() {
    if (!currentLabQueueId) return showToast('No active patient', 'error');
    const res = await fetch('/api/queue/complete-step', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: currentLabQueueId }) });
    const data = await res.json();
    showToast(data.finished ? 'All steps completed!' : 'Advancing to: ' + (data.next_station || 'next'), 'success');
    loadLabQueue();
}

async function labPark() {
    if (!currentLabQueueId) return showToast('No active patient', 'error');
    const res = await fetch('/api/queue/park', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: currentLabQueueId, reason: 'PENDING_BIOLOGICAL_SAMPLE' }) });
    const data = await res.json();
    if (data.success) showToast('Patient parked — calling next', 'success');
    else showToast(data.error || 'Failed to park patient', 'error');
    loadLabQueue();
}

async function labUnpark(queueId) {
    const res = await fetch('/api/queue/unpark', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: queueId }) });
    const data = await res.json();
    if (data.success) showToast('Patient re-queued with priority', 'success');
    else showToast(data.error || 'Failed to unpark patient', 'error');
    loadLabQueue();
}

async function loadLabAppts() {
    const res = await fetch('/api/appointments', { headers: authHeaders() });
    const appts = await res.json();
    document.getElementById('lab-appt-list').innerHTML = appts.length === 0
        ? '<tr><td colspan="5" class="text-center text-muted">No appointments booked.</td></tr>'
        : appts.map(a => `<tr>
            <td>${a.full_name||a.username}</td><td>${a.package_name}</td><td>${a.appointment_date}</td>
            <td>${a.appointment_time}</td><td><span class="badge ${a.status==='scheduled'?'badge-warning':'badge-success'}">${a.status}</span></td>
        </tr>`).join('');
}

// Results Section Logic
async function loadResultsWorkspace() {
    // Sync active serving patient first
    if (!myLabId) await findMyLab();
    await loadLabQueue();

    if (!currentServingUserId) {
        document.getElementById('lab-no-active-patient').style.display = 'block';
        document.getElementById('lab-results-workspace').style.display = 'none';
        return;
    }

    document.getElementById('lab-no-active-patient').style.display = 'none';
    document.getElementById('lab-results-workspace').style.display = 'grid';

    document.getElementById('result-patient-id').value = currentServingUserId;
    document.getElementById('result-sequence-id').value = currentSequenceId || '';

    try {
        // Fetch patient details, previous lab notes, and clinical records
        const [medRes, notesRes, clinicalRes] = await Promise.all([
            fetch(`/api/medical-records/${currentServingUserId}`, { headers: authHeaders() }),
            fetch(`/api/lab-notes/${currentServingUserId}`, { headers: authHeaders() }),
            fetch(`/api/clinical-records/${currentServingUserId}`, { headers: authHeaders() })
        ]);

        const med = await medRes.json();
        const notes = await notesRes.json();
        const records = await clinicalRes.json();

        // 1. Populate Patient Panel
        if (med) {
            document.getElementById('res-patient-category').className = `badge ${med.user?.customer_category === 'Senior' ? 'priority-senior' : med.user?.customer_category === 'PWD' ? 'priority-pwd' : med.user?.customer_category === 'Pregnant' ? 'priority-pregnant' : 'priority-regular'}`;
            document.getElementById('res-patient-category').textContent = med.user?.customer_category || 'Regular';
            document.getElementById('res-patient-name').textContent = med.user?.full_name || 'Patient';

            let dobText = 'DOB: --';
            let ageText = '--';
            if (med.user?.birthday) {
                const bday = new Date(med.user.birthday);
                dobText = `DOB: ${bday.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
                const diff = Date.now() - bday.getTime();
                const ageDate = new Date(diff);
                ageText = Math.abs(ageDate.getUTCFullYear() - 1970) + ' yo';
            }
            document.getElementById('res-patient-dob').textContent = dobText;
            document.getElementById('res-patient-gender-age').textContent = `${med.user?.gender || 'Unspecified'} (${ageText})`;
            document.getElementById('res-patient-phone').textContent = med.phone || '--';

            // Show latest vitals if available in previous exams
            const examRecord = records.find(r => r.record_type === 'examination' && r.data);
            if (examRecord) {
                try {
                    const parsedData = typeof examRecord.data === 'string' ? JSON.parse(examRecord.data) : examRecord.data;
                    document.getElementById('res-patient-vitals').innerHTML = `
                        BP: <strong>${parsedData.bp || '--'}</strong> | Pulse: <strong>${parsedData.pulse || '--'} bpm</strong> | Temp: <strong>${parsedData.temp || '--'} °C</strong>
                        <br><small class="text-muted">Recorded by Dr. ${examRecord.staff_name || 'Staff'} on ${formatDateTime(examRecord.created_at)}</small>
                    `;
                } catch(e) {
                    document.getElementById('res-patient-vitals').textContent = '--';
                }
            } else {
                document.getElementById('res-patient-vitals').textContent = 'No vitals recorded.';
            }

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
            document.getElementById('res-patient-health').innerHTML = healthHtml;
        }

        // 2. Populate Lab Notes List
        if (notes.length > 0) {
            document.getElementById('res-lab-notes-list').innerHTML = notes.map(n => `
                <div style="padding:8px 0; border-bottom:1px solid var(--border-light);">
                    <strong>${formatDateTime(n.created_at)} (${n.staff_name || 'Staff'}):</strong>
                    <div>${escapeHtml(n.note)}</div>
                </div>
            `).join('');
        } else {
            document.getElementById('res-lab-notes-list').innerHTML = '<span class="text-muted">No notes recorded.</span>';
        }

        // 3. Load default template inputs
        loadTestTemplate(document.getElementById('lab-test-type').value);

    } catch(err) {
        console.error('Error loading results workspace patient file:', err);
    }
}

// Lab test templates definitions
const testTemplates = {
    'Complete Blood Count (CBC)': [
        { name: 'White Blood Cell (WBC)', ref: '4.0 - 10.0 x10^9/L', defaultVal: '6.5' },
        { name: 'Red Blood Cell (RBC)', ref: '4.5 - 5.9 x10^12/L', defaultVal: '5.0' },
        { name: 'Hemoglobin', ref: '13.5 - 17.5 g/dL', defaultVal: '14.2' },
        { name: 'Hematocrit', ref: '41 - 50 %', defaultVal: '43' },
        { name: 'Platelet Count', ref: '150 - 450 x10^9/L', defaultVal: '280' }
    ],
    'Blood Chemistry': [
        { name: 'Fasting Blood Sugar (FBS)', ref: '70 - 99 mg/dL', defaultVal: '88' },
        { name: 'Blood Urea Nitrogen (BUN)', ref: '7 - 20 mg/dL', defaultVal: '12' },
        { name: 'Creatinine', ref: '0.6 - 1.2 mg/dL', defaultVal: '0.9' },
        { name: 'Total Cholesterol', ref: '< 200 mg/dL', defaultVal: '175' }
    ],
    'Urinalysis': [
        { name: 'Color', ref: 'Pale Yellow - Straw', defaultVal: 'Yellow' },
        { name: 'pH', ref: '4.5 - 8.0', defaultVal: '6.0' },
        { name: 'Specific Gravity', ref: '1.005 - 1.030', defaultVal: '1.015' }
    ]
};

function loadTestTemplate(testType) {
    const inputsContainer = document.getElementById('lab-parameters-inputs');
    const templates = testTemplates[testType] || [];

    if (templates.length === 0) {
        inputsContainer.innerHTML = '<div class="text-muted text-sm" style="padding:10px 0;">No structured parameters needed for this test type. Use the findings area below.</div>';
        return;
    }

    inputsContainer.innerHTML = templates.map((t, idx) => `
        <div class="parameter-row" style="align-items:center;">
            <div style="font-size:0.9em; font-weight:500;">${t.name}</div>
            <div>
                <input type="text" class="form-input parameter-val-input" data-param="${t.name}" value="${t.defaultVal}" style="padding:6px 10px; font-size:0.85em;">
            </div>
            <div class="text-muted text-sm">${t.ref}</div>
        </div>
    `).join('');
}

// Add Workspace Lab Note
async function addWorkspaceLabNote() {
    const userId = document.getElementById('result-patient-id').value;
    const noteEl = document.getElementById('lab-quick-note');
    const note = noteEl.value.trim();
    if (!note) return showToast('Note cannot be empty', 'warning');

    try {
        const res = await fetch('/api/lab-notes', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ customer_id: userId, note: note })
        });
        if (res.ok) {
            showToast('Note added!', 'success');
            noteEl.value = '';
            loadResultsWorkspace(); // Reload
        } else {
            showToast('Failed to add note', 'error');
        }
    } catch(err) {
        console.error(err);
    }
}

// Save Lab Result and auto-complete queue step
async function saveLabResult() {
    const userId = document.getElementById('result-patient-id').value;
    const seqId = document.getElementById('result-sequence-id').value;
    const testType = document.getElementById('lab-test-type').value;
    const findings = document.getElementById('lab-findings-notes').value.trim();

    if (!findings) {
        return showToast('Findings / Observations is required to upload results', 'warning');
    }

    // Collect parameters
    const params = {};
    document.querySelectorAll('.parameter-val-input').forEach(input => {
        const paramName = input.getAttribute('data-param');
        params[paramName] = input.value;
    });

    const dataPayload = {
        test_name: testType,
        parameters: params
    };

    try {
        // 1. Post to clinical-records
        const recordRes = await fetch('/api/clinical-records', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                customer_id: userId,
                sequence_id: seqId || null,
                record_type: 'lab_result',
                data: dataPayload,
                notes: findings
            })
        });

        if (!recordRes.ok) {
            return showToast('Failed to upload results to clinical records database', 'error');
        }

        showToast('Clinical records saved successfully!', 'success');

        // 2. Complete lab queue step
        if (currentLabQueueId) {
            const completeRes = await fetch('/api/queue/complete-step', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ queue_id: currentLabQueueId })
            });
            const completeData = await completeRes.json();
            showToast(completeData.finished ? 'All steps completed!' : 'Patient advanced: ' + (completeData.next_station || 'next'), 'success');
        }

        // Reset workspace fields
        document.getElementById('lab-findings-notes').value = '';
        document.getElementById('lab-quick-note').value = '';

        // Reload page
        navigateTo('queue');
        loadLabQueue();

    } catch (err) {
        console.error('Error saving lab result:', err);
        showToast('System error saving lab result', 'error');
    }
}

// Initialize Socket.io / Polls
findMyLab().then(loadLabQueue);
function onQueueUpdate() {
    loadLabQueue();
    // If in results section, refresh
    if (document.getElementById('section-results').style.display !== 'none') {
        loadResultsWorkspace();
    }
}

setInterval(() => {
    if (document.getElementById('section-queue').style.display !== 'none') {
        loadLabQueue();
    }
}, 5000);
