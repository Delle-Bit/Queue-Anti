if (!requireAuth(['doctor', 'admin', 'admintechnical'])) throw new Error('Unauthorized');

let myDoctorId = null;
let myDoctorName = '';
let currentDocQueueId = null;
let currentServingUserId = null;
let currentSequenceId = null;
let currentServingTicket = null;
let activeRecordType = 'examination';
let prescriptionItems = [];
let autosaveTimeout = null;

// Find Doctor Profile
async function findMyDoctor() {
    try {
        const res = await fetch('/api/doctors', { headers: authHeaders() });
        const doctors = await res.json();
        const uid = getUserId();
        const myDoc = doctors.find(d => d.assigned_staff_id == uid);
        if (myDoc) {
            myDoctorId = myDoc.id;
            myDoctorName = myDoc.name;
            document.getElementById('doc-subtitle').textContent = `${myDoc.name} — Specialty: ${myDoc.specialty || 'General'}`;
        } else if (doctors.length > 0) {
            myDoctorId = doctors[0].id;
            myDoctorName = doctors[0].name;
            document.getElementById('doc-subtitle').textContent = `${doctors[0].name} (unassigned)`;
        } else {
            showToast('No doctor station found in database.', 'error');
        }
    } catch (err) {
        console.error('Failed to discover doctor station:', err);
    }
}

// Render Sidebar
renderSidebar([
    { section: 'DOCTOR' },
    { id: 'queue', label: 'Queue', icon: 'fa-solid fa-user-doctor' },
    { id: 'appointments', label: 'Appointments', icon: 'fa-solid fa-calendar-days' }
], 'queue');
initDefaultSection();

window.onSectionLoad = { 
    queue: loadDocQueue, 
    appointments: loadDocAppts 
};

// Load Queue & Active Serving Patient
async function loadDocQueue() {
    if (!myDoctorId) await findMyDoctor();
    if (!myDoctorId) return;

    try {
        const [qRes, aRes] = await Promise.all([
            fetch(`/api/queue/station?type=doctor&id=${myDoctorId}`, { headers: authHeaders() }),
            fetch(`/api/analytics/doctor/${myDoctorId}`, { headers: authHeaders() })
        ]);
        const queue = await qRes.json();
        const analytics = await aRes.json();

        // 1. Determine who is serving
        const serving = queue.find(q => q.status === 'serving');
        if (serving) {
            document.getElementById('doc-serving').textContent = serving.number;
            document.getElementById('doc-serving-name').textContent = serving.full_name || serving.username || 'Unnamed Patient';
            document.getElementById('doc-active-workspace').style.display = 'grid';
            
            currentDocQueueId = serving.id;
            currentServingTicket = serving.number;
            currentSequenceId = serving.sequence_id;

            const newUserId = serving.customer_id || serving.user_id;
            if (currentServingUserId !== newUserId) {
                currentServingUserId = newUserId;
                loadPatientMedicalFile(currentServingUserId);
            }
        } else {
            document.getElementById('doc-serving').textContent = '--';
            document.getElementById('doc-serving-name').textContent = 'No patient currently active';
            document.getElementById('doc-active-workspace').style.display = 'none';
            currentDocQueueId = null;
            currentServingUserId = null;
            currentSequenceId = null;
            currentServingTicket = null;
        }

        // 2. Render waiting list
        const waiting = queue.filter(q => q.status === 'waiting');
        document.getElementById('doc-waiting').textContent = waiting.length;
        document.getElementById('doc-queue-list').innerHTML = waiting.length === 0
            ? '<tr><td colspan="4" class="text-center text-muted">No patients waiting in queue.</td></tr>'
            : waiting.map(w => `
                <tr>
                    <td><strong>${w.number}</strong></td>
                    <td>${categoryBadge(w.customer_category || 'Regular')}</td>
                    <td>${w.full_name || w.username || '--'}</td>
                    <td>${formatTime(w.timestamp)}</td>
                </tr>
            `).join('');

        // 3. Render completed logs today
        document.getElementById('doc-logs').innerHTML = (analytics.logs || []).length === 0
            ? '<tr><td colspan="4" class="text-center text-muted">No completed consultations today.</td></tr>'
            : analytics.logs.map(l => `
                <tr>
                    <td>${l.ticket_number}</td>
                    <td>${l.full_name || l.username || '--'}</td>
                    <td>${formatTime(l.serve_time)}</td>
                    <td>${formatTime(l.complete_time)}</td>
                </tr>
            `).join('');

    } catch (err) {
        console.error('Error loading doctor queue:', err);
    }
}

// Load Appointments
async function loadDocAppts() {
    try {
        const res = await fetch('/api/appointments', { headers: authHeaders() });
        const appts = await res.json();
        document.getElementById('doc-appt-list').innerHTML = appts.length === 0
            ? '<tr><td colspan="5" class="text-center text-muted">No appointments booked.</td></tr>'
            : appts.map(a => `
                <tr>
                    <td>${a.full_name || a.username}</td>
                    <td>${a.package_name}</td>
                    <td>${a.appointment_date}</td>
                    <td>${a.appointment_time}</td>
                    <td><span class="badge ${a.status === 'scheduled' ? 'badge-warning' : 'badge-success'}">${a.status}</span></td>
                </tr>
            `).join('');
    } catch (err) {
        console.error('Error loading appointments:', err);
    }
}

// Call Next Patient
async function docCallNext() {
    if (!myDoctorId) return;
    try {
        const res = await fetch('/api/queue/next', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ station_type: 'doctor', station_id: myDoctorId })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Calling: ' + data.next, 'success');
            loadDocQueue();
        } else {
            showToast(data.message || 'Queue empty', 'info');
        }
    } catch (err) {
        showToast('Failed to call next patient', 'error');
    }
}

// Complete Consultation
async function docComplete() {
    if (!currentDocQueueId) return showToast('No active patient', 'error');
    
    // Auto-save/commit any unsaved draft content first to avoid losing notes
    const hasNotes = document.getElementById('workspace-notes').value.trim() !== '';
    const hasPresc = prescriptionItems.length > 0;
    if (hasNotes || hasPresc) {
        await commitClinicalRecord(true); // silent commit
    }

    try {
        const res = await fetch('/api/queue/complete-step', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ queue_id: currentDocQueueId })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.finished ? 'All steps completed!' : 'Advancing to next station', 'success');
            // Clear local storage draft for this user
            localStorage.removeItem(`doctor_draft_${currentServingUserId}`);
            currentServingUserId = null;
            loadDocQueue();
        }
    } catch (err) {
        showToast('Failed to complete consultation', 'error');
    }
}

// Fetch Patient Medical File & History
async function loadPatientMedicalFile(userId) {
    if (!userId) return;

    try {
        const [medRes, clinicalRes] = await Promise.all([
            fetch(`/api/medical-records/${userId}`, { headers: authHeaders() }),
            fetch(`/api/clinical-records/${userId}`, { headers: authHeaders() })
        ]);
        const med = await medRes.json();
        const records = await clinicalRes.json();

        // Populate patient profile card
        if (med) {
            document.getElementById('patient-category-badge').className = `badge ${med.user?.customer_category === 'Senior' ? 'priority-senior' : med.user?.customer_category === 'PWD' ? 'priority-pwd' : med.user?.customer_category === 'Pregnant' ? 'priority-pregnant' : 'priority-regular'}`;
            document.getElementById('patient-category-badge').textContent = med.user?.customer_category || 'Regular';
            document.getElementById('patient-name-header').textContent = med.user?.full_name || 'Patient';
            
            // Age and DOB
            let dobText = 'DOB: --';
            let ageText = '--';
            if (med.user?.birthday) {
                const bday = new Date(med.user.birthday);
                dobText = `DOB: ${bday.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
                const diff = Date.now() - bday.getTime();
                const ageDate = new Date(diff);
                ageText = Math.abs(ageDate.getUTCFullYear() - 1970) + ' yo';
            }
            document.getElementById('patient-dob-sub').textContent = dobText;
            document.getElementById('patient-gender-age').textContent = `${med.user?.gender || 'Unspecified'} (${ageText})`;

            document.getElementById('patient-phone-display').textContent = med.phone || '--';
            document.getElementById('patient-occupation-display').textContent = med.occupation || '--';

            // Current symptoms / health conditions
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
            document.getElementById('patient-symptoms-display').innerHTML = healthHtml;

            // Past conditions summary
            let pastHtml = 'None reported';
            if (med.past_conditions) {
                try {
                    const pc = JSON.parse(med.past_conditions);
                    if (pc && typeof pc === 'object') {
                        pastHtml = `
                            <ul style="margin: 0; padding-left: 14px;">
                                <li>High BP: <strong>${pc.high_bp || 'No'}</strong></li>
                                <li>Heart Issue: <strong>${pc.heart_problems || 'No'}</strong></li>
                                <li>Blood Clots: <strong>${pc.blood_clots || 'No'}</strong></li>
                                <li>High Chol: <strong>${pc.high_cholesterol || 'No'}</strong></li>
                                <li>Surgeries: <strong>${pc.surgeries || 'No'}</strong> ${pc.surgeries === 'Yes' ? `(${pc.surgeries_details || ''})` : ''}</li>
                            </ul>
                        `;
                    }
                } catch(e) {
                    pastHtml = med.past_conditions;
                }
            }
            document.getElementById('patient-past-conditions-display').innerHTML = pastHtml;
        }

        // Render timeline
        const timeline = document.getElementById('patient-history-timeline');
        if (records.length === 0) {
            timeline.innerHTML = '<span class="text-muted text-sm">No previous medical records found.</span>';
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
                        }
                    } catch(e) {}
                }

                return `
                    <div class="timeline-item">
                        <div class="timeline-date">${formatDateTime(r.created_at)}</div>
                        <div class="timeline-title flex-between">
                            <span><span class="badge ${badgeCls}">${typeLabel}</span></span>
                            <small class="text-muted">Dr. ${r.staff_name || 'Staff'}</small>
                        </div>
                        <div class="timeline-desc">
                            <div>${escapeHtml(r.notes || 'No notes.')}</div>
                            ${detailsHtml}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Initialize active workspace inputs from draft if matches
        loadDraftFromLocalStorage();

    } catch (err) {
        console.error('Error loading patient medical files:', err);
    }
}

// Switch record tabs
function switchRecordType(type) {
    activeRecordType = type;
    document.querySelectorAll('.record-tab').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-type') === type);
    });

    const titleMap = {
        examination: '<i class="fa-solid fa-stethoscope"></i> Clinical Examination Note',
        prescription: '<i class="fa-solid fa-file-prescription"></i> Patient Prescription Details',
        diagnostic: '<i class="fa-solid fa-x-ray"></i> Diagnostic & Lab Directives'
    };
    document.getElementById('workspace-title').innerHTML = titleMap[type] || 'Consultation Record';

    // Show/hide vital inputs (Exam only)
    document.getElementById('vitals-entry-group').style.display = type === 'examination' ? 'grid' : 'none';
    
    // Show/hide prescription builder
    document.getElementById('prescription-builder-container').style.display = type === 'prescription' ? 'block' : 'none';

    // Refresh draft for this record type
    loadDraftFromLocalStorage();
}

// Live Vitals Box Sync
function updateVitalDisplay(vital, val) {
    const el = document.getElementById(`vital-${vital}-display`);
    if (el) el.textContent = val.trim() ? val : '--';
    triggerAutosave();
}

// Prescription list renderer
function addPrescriptionItem() {
    const medName = document.getElementById('presc-med-name').value.trim();
    const dosage = document.getElementById('presc-dosage').value.trim();
    if (!medName || !dosage) return showToast('Please enter both medicine name and dosage', 'warning');

    prescriptionItems.push({ medicine: medName, dosage: dosage });
    document.getElementById('presc-med-name').value = '';
    document.getElementById('presc-dosage').value = '';
    
    renderPrescriptionItems();
    triggerAutosave();
}

function removePrescriptionItem(index) {
    prescriptionItems.splice(index, 1);
    renderPrescriptionItems();
    triggerAutosave();
}

function renderPrescriptionItems() {
    const list = document.getElementById('prescription-items-list');
    if (prescriptionItems.length === 0) {
        list.innerHTML = '<div class="text-muted text-sm text-center" style="padding: 10px;">No prescribed medicines added yet.</div>';
    } else {
        list.innerHTML = prescriptionItems.map((item, idx) => `
            <div class="prescription-item">
                <span><strong>${item.medicine}</strong> — ${item.dosage}</span>
                <button type="button" onclick="removePrescriptionItem(${idx})">&times;</button>
            </div>
        `).join('');
    }
}

// Auto-Save Drafts to Local Storage
function triggerAutosave() {
    const statusEl = document.getElementById('autosave-status');
    const textEl = document.getElementById('autosave-text');
    
    statusEl.classList.add('saving');
    textEl.textContent = 'Saving draft...';

    if (autosaveTimeout) clearTimeout(autosaveTimeout);
    
    autosaveTimeout = setTimeout(() => {
        saveDraftToLocalStorage();
        statusEl.classList.remove('saving');
        textEl.textContent = 'Draft auto-saved locally';
    }, 1000);
}

function saveDraftToLocalStorage() {
    if (!currentServingUserId) return;

    const draftData = {
        type: activeRecordType,
        notes: document.getElementById('workspace-notes').value,
        bp: document.getElementById('input-vital-bp').value,
        pulse: document.getElementById('input-vital-pulse').value,
        temp: document.getElementById('input-vital-temp').value,
        prescription: prescriptionItems
    };

    localStorage.setItem(`doctor_draft_${currentServingUserId}`, JSON.stringify(draftData));
}

function loadDraftFromLocalStorage() {
    if (!currentServingUserId) return;

    const saved = localStorage.getItem(`doctor_draft_${currentServingUserId}`);
    if (saved) {
        try {
            const draft = JSON.parse(saved);
            
            // Only restore if the saved type matches the currently selected tab
            if (draft.type === activeRecordType) {
                document.getElementById('workspace-notes').value = draft.notes || '';
                
                if (activeRecordType === 'examination') {
                    document.getElementById('input-vital-bp').value = draft.bp || '';
                    document.getElementById('input-vital-pulse').value = draft.pulse || '';
                    document.getElementById('input-vital-temp').value = draft.temp || '';
                    
                    document.getElementById('vital-bp-display').textContent = draft.bp || '--';
                    document.getElementById('vital-pulse-display').textContent = draft.pulse || '--';
                    document.getElementById('vital-temp-display').textContent = draft.temp || '--';
                }
                
                if (activeRecordType === 'prescription') {
                    prescriptionItems = draft.prescription || [];
                    renderPrescriptionItems();
                }
                return;
            }
        } catch(e) {}
    }

    // Default clear if no matching draft
    document.getElementById('workspace-notes').value = '';
    if (activeRecordType === 'examination') {
        document.getElementById('input-vital-bp').value = '';
        document.getElementById('input-vital-pulse').value = '';
        document.getElementById('input-vital-temp').value = '';
        document.getElementById('vital-bp-display').textContent = '--';
        document.getElementById('vital-pulse-display').textContent = '--';
        document.getElementById('vital-temp-display').textContent = '--';
    }
    if (activeRecordType === 'prescription') {
        prescriptionItems = [];
        renderPrescriptionItems();
    }
}

// Commit Clinical Record to Database
async function commitClinicalRecord(silent = false) {
    if (!currentServingUserId) return;
    
    const notesVal = document.getElementById('workspace-notes').value.trim();
    
    // Build JSON data object
    let dataPayload = null;
    if (activeRecordType === 'examination') {
        dataPayload = {
            bp: document.getElementById('input-vital-bp').value.trim(),
            pulse: document.getElementById('input-vital-pulse').value.trim(),
            temp: document.getElementById('input-vital-temp').value.trim()
        };
    } else if (activeRecordType === 'prescription') {
        dataPayload = {
            items: prescriptionItems
        };
    }

    try {
        const res = await fetch('/api/clinical-records', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                customer_id: currentServingUserId,
                sequence_id: currentSequenceId,
                record_type: activeRecordType,
                data: dataPayload,
                notes: notesVal
            })
        });

        if (res.ok) {
            if (!silent) {
                showToast('Medical record saved successfully!', 'success');
                // Clear active fields
                document.getElementById('workspace-notes').value = '';
                if (activeRecordType === 'examination') {
                    document.getElementById('input-vital-bp').value = '';
                    document.getElementById('input-vital-pulse').value = '';
                    document.getElementById('input-vital-temp').value = '';
                    document.getElementById('vital-bp-display').textContent = '--';
                    document.getElementById('vital-pulse-display').textContent = '--';
                    document.getElementById('vital-temp-display').textContent = '--';
                } else if (activeRecordType === 'prescription') {
                    prescriptionItems = [];
                    renderPrescriptionItems();
                }
                localStorage.removeItem(`doctor_draft_${currentServingUserId}`);
                
                // Reload patient history timeline
                loadPatientMedicalFile(currentServingUserId);
            }
        } else {
            if (!silent) showToast('Failed to save clinical record to database', 'error');
        }
    } catch(err) {
        console.error('Error committing clinical record:', err);
    }
}

// Set Event Listeners for Draft Auto-saving
document.getElementById('workspace-notes').addEventListener('input', triggerAutosave);
document.getElementById('input-vital-bp').addEventListener('input', triggerAutosave);
document.getElementById('input-vital-pulse').addEventListener('input', triggerAutosave);
document.getElementById('input-vital-temp').addEventListener('input', triggerAutosave);

// Start Up
findMyDoctor().then(loadDocQueue);
function onQueueUpdate() { loadDocQueue(); }
setInterval(() => {
    if (document.getElementById('section-queue').style.display !== 'none') {
        loadDocQueue();
    }
}, 5000);
