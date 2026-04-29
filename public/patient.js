const token = localStorage.getItem('adminToken');
if (!token) {
    window.location.href = '/login.html';
}

// ── THEME (Light / Dark) ────────────────────────────────────────
// Apply immediately to avoid flash of wrong theme
(function initTheme() {
    const saved = localStorage.getItem('customerTheme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeButton(saved);
})();

function updateThemeButton(theme) {
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    if (!icon || !label) return;
    if (theme === 'dark') {
        icon.textContent = '\u2600\ufe0f';
        label.textContent = 'Light Mode';
    } else {
        icon.textContent = '\ud83c\udf19';
        label.textContent = 'Dark Mode';
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('customerTheme', theme);
    updateThemeButton(theme);
}

function toggleTheme() {
    const current = localStorage.getItem('customerTheme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}
// ────────────────────────────────────────────────────────────────

const customerCategory = localStorage.getItem('customerCategory') || 'Regular';

// Map 'Regular' -> 'Q', 'Elderly' -> 'E', 'PWD' -> 'D'
function getQueueLetter() {
    if (customerCategory === 'Elderly') return 'E';
    if (customerCategory === 'PWD') return 'D';
    return 'Q';
}

function getUserIdFromToken() {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.id;
    } catch(e) { return null; }
}

const deviceId = 'cust_' + getUserIdFromToken();
let selectedDepartmentId = null;
let currentQueueStatus = null; // waiting, serving, completed
let chatSessionId = localStorage.getItem('chatSessionId');

// --- INITIAL LOAD & ROUTING ---
async function init() {
    await fetchSettings();
    document.getElementById('user-category-display').innerText = customerCategory;
    
    // Connect socket for live queue updates
    const socket = io();
    socket.on('queueUpdate', (data) => {
        if (selectedDepartmentId == data.department_id) {
            pollState(); // refresh immediately
        }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const qrDeptId = urlParams.get('dept');
    
    if (qrDeptId) {
        selectedDepartmentId = qrDeptId;
        pollState(); 
    } else {
        pollState();
    }
}

// Polling configuration
let pollIntervalTimer = null;
let currentPollInterval = 3000;
let consecutiveErrors = 0;

async function startPolling() {
    await init();
    pollIntervalTimer = setTimeout(startPolling, currentPollInterval);
}

async function pollState() {
    try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
        const data = await res.json();
        
        consecutiveErrors = 0;
        currentPollInterval = 3000;

        const queues = data?.queue || [];
        const departments = data?.departments || [];
        const deptAvgTimes = data?.deptAvgTimes || {};
        
        if (data.announcement) {
            if (window.lastAnnouncementId === undefined) {
                window.lastAnnouncementId = data.announcement.id;
            } else if (data.announcement.id !== window.lastAnnouncementId) {
                window.lastAnnouncementId = data.announcement.id;
                document.getElementById('announcement-text').innerText = data.announcement.message;
                document.getElementById('announcement-modal').style.display = 'block';
            }
        }

        const myQueues = queues.filter(q => q.id === deviceId);
        
        if (currentQueueStatus !== null && myQueues.length === 0) {
           if (currentQueueStatus === 'serving' || currentQueueStatus === 'waiting') {
               showCompleted();
           }
           currentQueueStatus = null;
        }

        if (myQueues.length > 0) {
            const ticket = myQueues[0];
            selectedDepartmentId = ticket.department_id; 
            currentQueueStatus = ticket.status; 
            
            const dept = departments.find(d => d.id == ticket.department_id);
            document.getElementById('status-dept-name').innerText = dept ? dept.name : '';
            
            const serving = queues.find(q => q.department_id == ticket.department_id && q.status === 'serving');
            document.getElementById('current-serving-number').innerText = serving ? serving.number : '--';

            const deptQueue = queues.filter(q => q.department_id == ticket.department_id && q.status === 'waiting');
            const myIndex = deptQueue.findIndex(q => q.id === deviceId);
            const avgTime = deptAvgTimes[ticket.department_id] || 5; 
            const estWaitMins = myIndex >= 0 ? Math.ceil((myIndex + 1) * avgTime) : 0;
            
            showUIState('checking-queue', { ticketNumber: ticket.number, estWaitMins });

        } else {
            if (selectedDepartmentId) {
                const dept = departments.find(d => d.id == selectedDepartmentId);
                if (dept) {
                    if(!dept.is_open) {
                        document.getElementById('offline-message').innerText = `${dept.name} is Closed.`;
                        document.getElementById('offline-message').style.display = 'block';
                        showUIState('select-department', { departments: departments });
                    } else {
                        document.getElementById('offline-message').style.display = 'none';
                        // Auto-join the queue using the user's registered category!
                        joinQueue(getQueueLetter());
                        selectedDepartmentId = null; // reset to prevent looping if error
                    }
                }
            } else {
                showUIState('select-department', { departments: departments });
            }
        }

    } catch (err) {
        console.error("Poll Error:", err.message);
        consecutiveErrors++;
        currentPollInterval = Math.min(30000, 3000 * Math.pow(2, consecutiveErrors));
    }
}

// --- UI STATE MANAGEMENT ---
function showUIState(state, context) {
    const sDept = document.getElementById('dept-selection-section');
    const sQue = document.getElementById('queue-status-section');
    const sTop = document.getElementById('top-controls');
    
    if (sDept) sDept.style.display = 'none';
    if (sQue) sQue.style.display = 'none';
    if (sTop) sTop.style.display = 'none';

    if (state === 'select-department') {
        if(sDept) sDept.style.display = 'block';
        if(sTop) sTop.style.display = 'flex';
        let html = '';
        if (context.departments.length === 0) {
            html = '<div style="grid-column: 1/-1; text-align: center; color: var(--secondary-color);"><br>No departments have been set up yet.</div>';
        } else {
            context.departments.forEach(d => {
                const isClosed = !d.is_open ? 'style="opacity:0.5;"' : '';
                html += `<div class="dept-card" ${isClosed} onclick="selectDepartment(${d.id}, ${d.is_open})">
                            ${d.name}<br>
                            <small style="font-weight:normal;">${d.is_open ? 'Open' : 'Closed'}</small>
                         </div>`;
            });
        }
        if(document.getElementById('dept-cards-container')) {
            document.getElementById('dept-cards-container').innerHTML = html;
        }
    }
    else if (state === 'checking-queue') {
        if(sQue) sQue.style.display = 'block';
        document.getElementById('your-number-display').innerHTML = `Your Number: <strong style="color:var(--primary-color);">${context.ticketNumber}</strong>`;
        const estText = context.estWaitMins > 0 ? `~${context.estWaitMins} mins` : '--';
        document.getElementById('status-est-time').innerText = `Estimated Wait: ${estText}`;
    }
}

function selectDepartment(deptId, isOpen) {
    if (!isOpen) { alert('This department is currently closed.'); return; }
    // Ask for confirmation
    if (confirm("Are you sure you want to directly join this department's queue?")) {
        selectedDepartmentId = deptId;
        pollState(); 
    }
}

// --- CHECKIN MODAL ---
async function showScanModal() {
    document.getElementById('scan-modal').style.display = 'block';
    const list = document.getElementById('mock-appointments-list');
    list.innerHTML = 'Loading...';
    try {
        const res = await fetch('/api/appointments', { headers: { 'Authorization': 'Bearer ' + token } });
        const appts = await res.json();
        
        // Filter to only ours that are scheduled
        const myId = getUserIdFromToken();
        const mine = appts.filter(a => a.customer_id === myId && a.status === 'scheduled');
        
        if (mine.length === 0) {
            list.innerHTML = '<span style="color:#666;">No scheduled appointments found for today. Chat with our assistant to set one!</span>';
            return;
        }

        let html = '';
        mine.forEach(a => {
            html += `<div style="padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items:center;">
                <div>
                    <strong>${a.department_name}</strong><br>
                    <small>Phone: ${a.phone_number}</small>
                </div>
                <button class="btn btn-primary" onclick="checkinAppt(${a.id})" style="margin:0; padding:5px 10px;">Check In</button>
            </div>`;
        });
        list.innerHTML = html;
    } catch(err) {
        list.innerHTML = '<span style="color:red;">Failed to loading your appointments</span>';
    }
}

async function checkinAppt(id) {
    if (!confirm('Proceed to scan QR and check in for this appointment?')) return;
    try {
        const res = await fetch('/api/appointments/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ appointment_id: id })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('scan-modal').style.display = 'none';
            alert(`Checked in successfully! You are placed in the live queue.`);
            pollState();
        } else alert(data.error);
    } catch (err) { alert('Error checking in.');}
}

// --- ACTION METHODS ---
async function joinQueue(type) {
    const res = await fetch('/api/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ deviceId, type, department_id: selectedDepartmentId })
    });
    
    const data = await res.json();
    if (res.ok) {
        pollState(); 
    } else {
        alert(data.error || 'Failed to join queue');
    }
}

async function leaveQueue() {
    const res = await fetch('/api/queue/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ deviceId })
    });
    if(res.ok) {
        currentQueueStatus = null;
        selectedDepartmentId = null; 
        pollState();
    }
}

function showCompleted() {
    document.getElementById('completed-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('announcement-modal').style.display = "none";
}

// --- SETTINGS (CUSTOMIZATION) ---
async function fetchSettings() {
    try {
        const res = await fetch('/api/settings');
        if (res.ok) {
            const data = await res.json();
            if (data.site_name) {
                document.getElementById('site-name-display').innerText = data.site_name;
                document.title = data.site_name;
            }
            if (data.logo_path) {
                const logo = document.getElementById('site-logo');
                logo.src = data.logo_path;
                logo.style.display = 'inline-block';
            }
            // Use per-page customer background (fall back to legacy background_path)
            const bgPath = data.bg_customer || data.background_path;
            if (bgPath) {
                document.body.style.backgroundImage = `url('${bgPath}')`;
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center';
            }
        }
    } catch(err) { console.error('Failed to load settings', err); }
}

// --- CHATBOT WIDGET ---
async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    const chatLog = document.getElementById('chat-log');
    chatLog.innerHTML += `<div class="user-msg">${message}</div>`;
    input.value = '';
    
    chatLog.scrollTop = chatLog.scrollHeight;
    
    // Simplistic mock parse algorithm for 'appointment'
    const lc = message.toLowerCase();
    if (lc.includes('appointment')) {
        const phoneMatch = message.match(/\b09\d{9}\b/);
        const hasDeptMatch = ['cardiology', 'cashier'].some(d => lc.includes(d)); // mock matching logic

        if (phoneMatch) {
            // Attempt auto booking
            try {
                const resDepts = await fetch('/api/state');
                const data = await resDepts.json();
                const depts = data.departments;
                const foundDept = depts.find(d => lc.includes(d.name.toLowerCase()));
                
                if (foundDept) {
                    const apptRes = await fetch('/api/appointments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ department_id: foundDept.id, phone_number: phoneMatch[0] })
                    });
                    
                    if (apptRes.ok) {
                        chatLog.innerHTML += `<div class="bot-msg">Got it! I have scheduled your appointment for the ${foundDept.name} department with phone number ${phoneMatch[0]}. Remember to click "Scan QR" when you arrive at the clinic!</div>`;
                        chatLog.scrollTop = chatLog.scrollHeight;
                        return;
                    }
                }
            } catch (e) {}
        }
        
        chatLog.innerHTML += `<div class="bot-msg">To book an appointment, please tell me the department and provide your 11-digit phone number (e.g., "I want an appt for Cardiology, my number is 09123456789").</div>`;
        chatLog.scrollTop = chatLog.scrollHeight;
        return;
    }

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId: chatSessionId })
        });
        const data = await res.json();
        
        if (data.sessionId) {
            chatSessionId = data.sessionId;
            localStorage.setItem('chatSessionId', chatSessionId);
        }

        if (res.ok) {
            chatLog.innerHTML += `<div class="bot-msg">${data.reply}</div>`;
        } else {
            chatLog.innerHTML += `<div class="error-msg">${data.error}</div>`;
        }
    } catch (err) {
        chatLog.innerHTML += `<div class="error-msg">Connection Error. Pls check wifi.</div>`;
    }
    chatLog.scrollTop = chatLog.scrollHeight;
}

startPolling();
