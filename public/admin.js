const token = localStorage.getItem('adminToken');
const role = localStorage.getItem('adminRole');
if (!token) window.location.href = '/login.html';

const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

if (role === 'ultraadmin') {
    document.getElementById('tab-ultra-btn').style.display = 'inline-block';
    fetchUsers(); // Initial fetch
}

let currentDeptId = null;
let currentTicketId = null; // Internal db ID
let currentServingRaw = null;

// Tab UI
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.nav-tabs button').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    event.target.classList.add('active');

    if (tabId === 'departments') { loadDepartments(); loadFaqs(); }
    if (tabId === 'analytics') loadDashboard();
    if (tabId === 'ultra') fetchUsers();
}

function logout() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminRole');
    window.location.href = '/login.html';
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// --- QUEUE MANAGEMENT ---
async function fetchStateInitial() {
    const res = await fetch('/api/state');
    const data = await res.json();
    
    const select = document.getElementById('manage-dept-select');
    const transferSelect = document.getElementById('transfer-dept-select');
    select.innerHTML = '<option value="">-- Select Department --</option>';
    transferSelect.innerHTML = '';
    
    data.departments.forEach(d => {
        select.innerHTML += `<option value="${d.id}">${d.name}</option>`;
        transferSelect.innerHTML += `<option value="${d.id}">${d.name}</option>`;
    });

    if (data.departments.length > 0) {
        select.value = data.departments[0].id;
        loadQueueForDept();
    }
}

async function loadQueueForDept() {
    currentDeptId = document.getElementById('manage-dept-select').value;
    if (!currentDeptId) {
        document.getElementById('queue-controls').style.display = 'none';
        return;
    }
    document.getElementById('queue-controls').style.display = 'block';
    refreshQueueView();
}

async function refreshQueueView() {
    if(!currentDeptId) return;
    const res = await fetch('/api/state');
    const data = await res.json();
    
    // Filter queue for this dept
    const myQueue = data.queue.filter(q => q.department_id == currentDeptId);
    
    // Find Serving
    const serving = myQueue.find(q => q.status === 'serving');
    if (serving) {
        document.getElementById('admin-current-serving').innerText = serving.number;
        currentTicketId = serving.id;
        currentServingRaw = serving;
    } else {
        document.getElementById('admin-current-serving').innerText = '--';
        currentTicketId = null;
        currentServingRaw = null;
    }

    // Pending List
    const waiting = myQueue.filter(q => q.status === 'waiting');
    let html = '';
    waiting.forEach(w => {
        html += `<tr>
            <td><strong>${w.number}</strong></td>
            <td>${w.type}</td>
            <td>${new Date(w.timestamp).toLocaleTimeString()}</td>
        </tr>`;
    });
    document.getElementById('pending-queue-list').innerHTML = html;
}

// Polling for updates
setInterval(() => { if (document.getElementById('tab-queue').classList.contains('active')) refreshQueueView(); }, 5000);

async function callNext() {
    if(!currentDeptId) return;
    const res = await fetch('/api/admin/next', { method: 'POST', headers, body: JSON.stringify({ department_id: currentDeptId }) });
    const data = await res.json();
    if (!data.success) alert(data.message || 'Error calling next');
    refreshQueueView();
}

async function completeTransaction() {
    if (!currentTicketId) return alert('No active transaction');
    const res = await fetch('/api/admin/complete', { method: 'POST', headers, body: JSON.stringify({ ticket_id: currentTicketId }) });
    if (res.ok) {
        alert('Transaction Completed!');
        refreshQueueView();
    }
}

function showTransferModal() {
    if (!currentTicketId) return alert('No active transaction to transfer');
    document.getElementById('transfer-modal').style.display = 'block';
}

async function transferPatient() {
    const newDeptId = document.getElementById('transfer-dept-select').value;
    if (newDeptId == currentDeptId) return alert('Cannot transfer to same department');
    const res = await fetch('/api/admin/transfer', { 
        method: 'POST', headers, 
        body: JSON.stringify({ ticket_id: currentTicketId, new_department_id: newDeptId }) 
    });
    if (res.ok) {
        alert('Patient transferred to queue of new department');
        closeModal('transfer-modal');
        refreshQueueView();
    }
}

async function broadcast() {
    const msg = document.getElementById('announcement-input').value;
    if(!msg) return;
    await fetch('/api/admin/broadcast', { method: 'POST', headers, body: JSON.stringify({ message: msg }) });
    alert('Broadcast sent');
    document.getElementById('announcement-input').value = '';
}


// --- DEPARTMENTS & FAQs ---
function showDeptModal() { document.getElementById('dept-modal').style.display = 'block'; }
function showFaqModal() { document.getElementById('faq-modal').style.display = 'block'; }

async function saveDept() {
    const name = document.getElementById('d-name').value;
    const startNone = document.getElementById('d-start-none').checked;
    const cutoffNone = document.getElementById('d-cutoff-none').checked;
    const start = startNone ? null : document.getElementById('d-start').value;
    const cutoff = cutoffNone ? null : document.getElementById('d-cutoff').value;
    await fetch('/api/departments', { method: 'POST', headers, body: JSON.stringify({ name, start_time: start, cutoff_time: cutoff }) });
    closeModal('dept-modal');
    loadDepartments();
    fetchStateInitial();
}

function showFaqModal() {
    document.getElementById('f-id').value = '';
    document.getElementById('f-name').value = '';
    document.getElementById('f-price').value = '';
    document.getElementById('f-desc').value = '';
    document.getElementById('faq-modal-title').innerText = 'Add Pricing';
    document.getElementById('faq-modal').style.display = 'block';
}

function editFaq(id, name, price, desc) {
    document.getElementById('f-id').value = id;
    document.getElementById('f-name').value = name;
    document.getElementById('f-price').value = price;
    document.getElementById('f-desc').value = desc;
    document.getElementById('faq-modal-title').innerText = 'Edit Pricing';
    document.getElementById('faq-modal').style.display = 'block';
}

async function saveFaq() {
    const id = document.getElementById('f-id').value;
    const name = document.getElementById('f-name').value;
    const price = document.getElementById('f-price').value;
    const desc = document.getElementById('f-desc').value;
    if (id) {
        await fetch(`/api/faqs/${id}`, { method: 'PUT', headers, body: JSON.stringify({ service_name: name, price, description: desc }) });
    } else {
        await fetch('/api/faqs', { method: 'POST', headers, body: JSON.stringify({ service_name: name, price, description: desc }) });
    }
    closeModal('faq-modal');
    loadFaqs();
}

async function loadDepartments() {
    const res = await fetch('/api/departments', { headers });
    const data = await res.json();
    let html = '';
    data.forEach(d => {
        html += `<tr>
            <td>${d.name}</td><td>${d.start_time || 'None'}</td><td>${d.cutoff_time || 'None'}</td>
            <td>${d.is_open ? 'Open' : 'Closed'}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="showQR(${d.id}, '${d.name}')" title="Show QR"><i class="fa-solid fa-qrcode"></i></button>
                <button class="btn btn-sm btn-warning" onclick="resetDeptQueue(${d.id}, '${d.name}')" title="Reset Queue" style="color:#fff;background:#ffc107;border:none;"><i class="fa-solid fa-rotate-right"></i></button>
                <button class="btn btn-sm btn-danger" onclick="deleteDept(${d.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    });
    document.getElementById('dept-list').innerHTML = html;
}

async function deleteDept(id) {
    if(!confirm("Are you sure you want to delete this department?")) return;
    const res = await fetch(`/api/departments/${id}`, { method: 'DELETE', headers });
    if(res.ok) {
        alert('Deleted successfully');
        loadDepartments();
    } else {
        alert('Could not delete department (it might have active queue logs).');
    }
}

async function loadFaqs() {
    const res = await fetch('/api/faqs');
    const data = await res.json();
    let html = '';
    data.forEach(d => { 
        const escapedName = d.service_name.replace(/'/g, "\\'");
        const escapedDesc = (d.description || '').replace(/'/g, "\\'");
        html += `<tr>
            <td>${d.service_name}</td><td>${d.price}</td><td>${d.description || ''}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="editFaq(${d.id}, '${escapedName}', ${d.price}, '${escapedDesc}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-sm btn-danger" onclick="deleteFaq(${d.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`; 
    });
    document.getElementById('faq-list').innerHTML = html;
}

async function resetDeptQueue(deptId, deptName) {
    if(!confirm(`Reset ALL queue data for "${deptName}"? This clears all waiting, serving, and log history for this department.`)) return;
    const res = await fetch(`/api/admin/reset-queue/${deptId}`, { method: 'POST', headers });
    if(res.ok) {
        alert(`Queue for "${deptName}" has been reset.`);
        loadDepartments();
        refreshQueueView();
    }
}

async function resetAllQueues() {
    if(!confirm('Reset ALL queue data across EVERY department? This cannot be undone!')) return;
    const res = await fetch('/api/admin/reset-queue-all', { method: 'POST', headers });
    if(res.ok) {
        alert('All queues have been reset.');
        loadDepartments();
        refreshQueueView();
    }
}

async function deleteFaq(id) {
    if(!confirm("Are you sure you want to delete this price?")) return;
    const res = await fetch(`/api/faqs/${id}`, { method: 'DELETE', headers });
    if(res.ok) loadFaqs();
}

async function showQR(deptId, deptName) {
    const res = await fetch('/api/qrcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dept_id: deptId }) });
    const data = await res.json();
    document.getElementById('qr-dept-name').innerText = deptName + " QR Scanner";
    document.getElementById('qr-image').src = data.qrImage;
    document.getElementById('qr-download').href = data.qrImage;
    document.getElementById('qr-modal').style.display = 'block';
}

// --- DASHBOARD ---
async function loadDashboard() {
    const res = await fetch('/api/admin/dashboard', { headers });
    if (!res.ok) return;
    const data = await res.json();
    
    document.getElementById('st-avg').innerText = data.avg_time + 'm';
    document.getElementById('st-hr').innerText = data.per_hour;
    document.getElementById('st-tot').innerText = data.total_processed;
    document.getElementById('st-est').innerText = data.est_total_time + 'm';

    let html = '';
    data.logs.forEach(l => {
        html += `<tr>
            <td>${l.ticket_number}</td>
            <td>${l.type}</td>
            <td>${l.department_name || 'N/A'}</td>
            <td>${l.join_time ? new Date(l.join_time).toLocaleTimeString() : '--'}</td>
            <td>${l.serve_time ? new Date(l.serve_time).toLocaleTimeString() : '--'}</td>
            <td>${l.complete_time ? new Date(l.complete_time).toLocaleTimeString() : '--'}</td>
        </tr>`;
    });
    document.getElementById('logs-list').innerHTML = html;
}

// --- ULTRAADMIN USER MANAGEMENT ---
async function fetchUsers() {
    if (role !== 'ultraadmin') return;
    const res = await fetch('/api/users', { headers });
    if (res.ok) {
        const users = await res.json();
        let html = '';
        users.forEach(u => {
            html += `<tr><td>${u.id}</td><td>${u.username}</td><td><span class="badge" style="background:${u.role==='ultraadmin'?'#dc3545':'#17a2b8'};color:white;padding:3px 8px;border-radius:12px;font-size:12px;">${u.role}</span></td></tr>`;
        });
        document.getElementById('users-table').innerHTML = html;
    }
}

async function createUser() {
    if (role !== 'ultraadmin') return;
    const username = document.getElementById('new-user').value;
    const password = document.getElementById('new-pass').value;
    if(!username || !password) return alert('Fill fields');

    const res = await fetch('/api/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, password, role: 'admin' })
    });

    if(res.ok) {
        alert('User created!');
        document.getElementById('new-user').value = '';
        document.getElementById('new-pass').value = '';
        fetchUsers();
    } else {
        alert('Failed. Username might exist.');
    }
}

// Init
fetchStateInitial();
