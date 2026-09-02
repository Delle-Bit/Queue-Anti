if (!requireAuth(['laboratory','admin','admintechnical'])) throw new Error('Unauthorized');

// Find this lab staff's assigned laboratory
let myLabId = null;
let currentLabQueueId = null;
let currentServingUserId = null;
let currentSequenceId = null;
let currentServingTicket = null;
let currentServingStructureId = null;
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
    // First pass only - this polls every five seconds.
    if (skeletonFirstLoad('lab-dash')) {
        skeletonValue(['lab-serving', 'lab-avg', 'lab-perhr', 'lab-finish', 'lab-waiting']);
        // This one ships the sentence "No patient currently active" in the
        // markup, which is not yet known to be true.
        skeletonValue('lab-serving-name', { cls: 'skel-line skel-w-50', replace: true });
        skeletonTable('lab-queue-list', { rows: 4, cols: [
            'skel-line skel-w-20', 'skel-line skel-w-50', 'skel-pill skel-w-70',
            'skel-line skel-w-80', 'skel-line skel-w-50'
        ] });
        skeletonTable('lab-hold-list', { rows: 2, cols: [
            'skel-line skel-w-50', 'skel-line skel-w-80', 'skel-line skel-w-50',
            'skel-pill skel-w-60', 'skel-pill skel-w-80'
        ] });
        skeletonLines('lab-dist', { rows: 4 });
        skeletonTable('lab-logs', { rows: 4, cols: 6 });
    }
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
        // The result form this patient's service expects, if it names one.
        currentServingStructureId = serving ? (serving.test_structure_id || null) : null;

        // Server-ordered: the list is already in the order this station will call,
        // which is not join order once priority or a re-insertion is involved.
        const waiting = queue.filter(q => q.status === 'waiting');
        document.getElementById('lab-queue-list').innerHTML = waiting.length === 0
            ? '<tr><td colspan="5" class="text-center text-muted">Empty</td></tr>'
            : waiting.map((w, i) => `<tr class="${w.reinserted ? 'queue-row-reinserted' : ''}">
                <td>${w.call_position || i + 1}</td>
                <td><strong>${w.number}</strong>${w.reinserted ? ' <span class="badge badge-reinserted" title="Re-inserted by the front desk">re-inserted</span>' : ''}</td>
                <td>${categoryBadge(w.customer_category||'Regular')}</td>
                <td>${w.full_name||w.username||'--'}</td>
                <td>${formatTime(w.timestamp)}</td></tr>`).join('');

        const onHold = queue.filter(q => q.status === 'on-hold');
        document.getElementById('lab-hold-list').innerHTML = onHold.length === 0
            ? '<tr><td colspan="5" class="text-center text-muted">Nobody is On-Hold</td></tr>'
            : onHold.map(p => `<tr>
                <td><strong>${p.number}</strong></td><td>${p.full_name||p.username||'--'}</td><td>${formatTime(p.hold_at)}</td>
                <td>${p.sample_ready_at ? '<span class="badge badge-success">Ready</span>' : '<span class="text-muted">Waiting</span>'}</td>
                <td><button class="btn btn-sm btn-primary" onclick="labResume('${p.id}')"><i class="fa-solid fa-arrow-rotate-left"></i> Sample Received</button></td>
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
    clearSkeleton('lab-serving', 'lab-serving-name', 'lab-avg', 'lab-perhr', 'lab-finish', 'lab-waiting',
        'lab-queue-list', 'lab-hold-list', 'lab-dist', 'lab-logs');
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

// Confirmed, always: one click moves a real person out of the chair, and an
// accidental advance previously had no undo.
async function labCallNext() {
    if (!myLabId) return;
    const confirmed = await confirmAction({
        title: 'Call the next patient?',
        message: 'The next ticket in this laboratory\u2019s queue will be called.',
        detail: 'If you call the wrong ticket, use "Call Back" to undo it.',
        icon: 'fa-solid fa-bell',
        confirmLabel: 'Call next',
        confirmClass: 'btn-success'
    });
    if (!confirmed) return;

    const res = await fetch('/api/queue/next', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ station_type: 'laboratory', station_id: myLabId }) });
    const data = await res.json().catch(() => ({}));
    if (data.success) showToast('Calling: ' + data.next, 'success');
    else showToast(data.error || data.message || 'Queue empty', res.ok ? 'info' : 'error');
    loadLabQueue();
}

// Hand the patient on. A laboratory never ends a visit - every route goes back
// to the front desk, which is the only station that can close a transaction.
async function labAdvance() {
    if (!currentLabQueueId) return showToast('No active patient', 'error');
    const res = await fetch('/api/queue/complete-step', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: currentLabQueueId }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        showToast(data.error || 'Failed to advance', 'error');
        loadLabQueue();
        return;
    }
    showToast(data.is_final_step
        ? `${data.next_ticket} sent back to the front desk to close out`
        : 'Sent on to: ' + (data.next_station || 'the next station'), 'success');
    loadLabQueue();
}

async function labCallBack() {
    if (!myLabId) return;
    const confirmed = await confirmAction({
        title: 'Call back the previous ticket?',
        message: 'The patient now at this station goes back to the front of the queue, and the ticket completed just before them is recalled.',
        detail: 'Only works while the next station has not already picked that patient up.',
        icon: 'fa-solid fa-rotate-left',
        confirmLabel: 'Call back'
    });
    if (!confirmed) return;

    const res = await fetch('/api/queue/call-back', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ station_type: 'laboratory', station_id: myLabId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showToast(data.error || 'Nothing to call back', 'error');
    else if (data.recalled) showToast(`Recalled ${data.recalled}`, 'success');
    else showToast(data.message || 'Queue reverted', 'info');
    loadLabQueue();
}

async function labHold() {
    if (!currentLabQueueId) return showToast('No active patient', 'error');
    const res = await fetch('/api/queue/hold', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: currentLabQueueId, reason: 'PENDING_BIOLOGICAL_SAMPLE' }) });
    const data = await res.json().catch(() => ({}));
    if (data.success) showToast('Patient put On-Hold — calling next', 'success');
    else showToast(data.error || 'Failed to put patient On-Hold', 'error');
    loadLabQueue();
}

async function labResume(queueId) {
    const res = await fetch('/api/queue/resume', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ queue_id: queueId }) });
    const data = await res.json().catch(() => ({}));
    if (data.success) showToast(`Patient re-queued at position ${data.slot} of the line`, 'success');
    else showToast(data.error || 'Failed to resume patient', 'error');
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

        // 3. Open on the form this patient's service expects, falling back to
        // whatever is selected when the service names none.
        await loadTestStructures();
        const preferred = currentServingStructureId;
        const select = document.getElementById('lab-test-type');
        if (preferred && testStructures.some(st => String(st.id) === String(preferred))) {
            select.value = String(preferred);
        }
        loadTestTemplate(select.value);

    } catch(err) {
        console.error('Error loading results workspace patient file:', err);
    }
}

// Result forms, loaded from the server. These were a hardcoded object here,
// which meant only a developer could add a test or correct a reference range;
// administrators own them now (see routes/test_structures.js).
let testStructures = [];

async function loadTestStructures() {
    const select = document.getElementById('lab-test-type');
    if (!select) return;
    try {
        const res = await fetch('/api/test-structures', { headers: authHeaders() });
        testStructures = await res.json();
        if (!Array.isArray(testStructures)) throw new Error('Unexpected response');
    } catch (err) {
        console.error('Error loading test structures:', err);
        select.innerHTML = '<option value="">Could not load result forms</option>';
        return;
    }
    if (testStructures.length === 0) {
        select.innerHTML = '<option value="">No result forms configured</option>';
        document.getElementById('lab-structure-hint').textContent =
            'An administrator needs to add a result form before results can be recorded.';
        return;
    }
    const current = select.value;
    select.innerHTML = testStructures.map(st =>
        `<option value="${st.id}">${escapeHtml(st.name)}</option>`).join('');
    // Keep the staff member's own choice across a refresh.
    if (current && testStructures.some(st => String(st.id) === String(current))) select.value = current;
    loadTestTemplate(select.value);
}

function currentTestStructure() {
    const id = document.getElementById('lab-test-type')?.value;
    return testStructures.find(st => String(st.id) === String(id)) || null;
}

// Renders whichever form the selected structure calls for: a row per defined
// parameter, or the notepad when the structure is freeform.
function loadTestTemplate(structureId) {
    const structured = document.getElementById('lab-parameters-section');
    const freeform = document.getElementById('lab-freeform-section');
    const inputsContainer = document.getElementById('lab-parameters-inputs');
    const hint = document.getElementById('lab-structure-hint');
    const structure = testStructures.find(st => String(st.id) === String(structureId));

    if (hint) hint.textContent = structure?.description || '';

    if (!structure) {
        structured.style.display = '';
        freeform.style.display = 'none';
        inputsContainer.innerHTML = '<div class="text-muted text-sm" style="padding:10px 0;">Pick a result form to record against.</div>';
        return;
    }

    if (structure.input_mode === 'freeform') {
        structured.style.display = 'none';
        freeform.style.display = '';
        initRichTextEditor('lab-freeform-editor', {
            placeholder: `Write up the ${structure.name.toLowerCase()} findings...`
        });
        return;
    }

    freeform.style.display = 'none';
    structured.style.display = '';

    const fields = structure.fields || [];
    if (fields.length === 0) {
        inputsContainer.innerHTML = '<div class="text-muted text-sm" style="padding:10px 0;">This form has no parameters defined yet. Use the findings area below.</div>';
        return;
    }

    inputsContainer.innerHTML = fields.map(f => {
        const range = [f.reference_range, f.unit].filter(Boolean).join(' ');
        let input;
        if (f.field_type === 'select') {
            const options = String(f.options || '').split(',').map(o => o.trim()).filter(Boolean);
            input = `<select class="form-select parameter-val-input" data-param="${escapeHtml(f.label)}"
                             style="padding:6px 10px; font-size:0.85em;">
                        ${options.map(o => `<option value="${escapeHtml(o)}" ${o === f.default_value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
                     </select>`;
        } else {
            input = `<input type="${f.field_type === 'number' ? 'number' : 'text'}" step="any"
                            class="form-input parameter-val-input" data-param="${escapeHtml(f.label)}"
                            value="${escapeHtml(f.default_value || '')}" style="padding:6px 10px; font-size:0.85em;">`;
        }
        return `
        <div class="parameter-row" style="align-items:center;">
            <div style="font-size:0.9em; font-weight:500;">${escapeHtml(f.label)}</div>
            <div>${input}</div>
            <div class="text-muted text-sm">${escapeHtml(range || '--')}</div>
        </div>`;
    }).join('');
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
    const structure = currentTestStructure();
    const findings = document.getElementById('lab-findings-notes').value.trim();

    if (!structure) {
        return showToast('Pick a result form before uploading results', 'warning');
    }

    const freeform = structure.input_mode === 'freeform';
    const richNotes = freeform ? richTextValue('lab-freeform-editor') : '';

    // A freeform result lives in the notepad, so that is what has to be filled
    // in; a structured one still wants the findings summary underneath.
    if (freeform && richTextIsEmpty('lab-freeform-editor')) {
        return showToast('Write the diagnostic notes before uploading results', 'warning');
    }
    if (!freeform && !findings) {
        return showToast('Findings / Observations is required to upload results', 'warning');
    }

    const params = {};
    if (!freeform) {
        document.querySelectorAll('.parameter-val-input').forEach(input => {
            params[input.getAttribute('data-param')] = input.value;
        });
    }

    const dataPayload = {
        test_name: structure.name,
        test_structure_id: structure.id,
        input_mode: structure.input_mode,
        parameters: params
    };
    if (freeform) dataPayload.rich_notes = richNotes;

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
                notes: findings || null
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
