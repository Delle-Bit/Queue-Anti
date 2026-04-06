function generateDeviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) {
        id = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', id);
    }
    return id;
}

const deviceId = generateDeviceId();
let selectedDepartmentId = null;
let currentQueueStatus = null; // waiting, serving, completed
let chatSessionId = localStorage.getItem('chatSessionId');

// --- INITIAL LOAD & ROUTING ---
async function init() {
    // Check URL parameters for QR scans
    const urlParams = new URLSearchParams(window.location.search);
    const qrDeptId = urlParams.get('dept');
    
    if (qrDeptId) {
        selectedDepartmentId = qrDeptId;
        pollState(); // Poll state to check if we are in queue, otherwise show join options
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
        
        // 1. Check if the response was successful
        if (!res.ok) {
            throw new Error(`Server returned ${res.status}: ${res.statusText}`);
        }
        
        const data = await res.json();
        
        // If data is valid, reset backoff
        consecutiveErrors = 0;
        currentPollInterval = 3000;

        // Ensure safety checks (Optional chaining and fallback arrays)
        const queues = data?.queue || [];
        const departments = data?.departments || [];
        
        // 1. Handle overall announcements
        if (data.announcement) {
            // Initialize last id on first fetch to prevent old messages from popping up
            if (window.lastAnnouncementId === undefined) {
                window.lastAnnouncementId = data.announcement.id;
            } else if (data.announcement.id !== window.lastAnnouncementId) {
                // New announcement detected!
                window.lastAnnouncementId = data.announcement.id;
                document.getElementById('announcement-text').innerText = data.announcement.message;
                document.getElementById('announcement-modal').style.display = 'block';
            }
        }

        // 2. Determine our queue state safely
        const myQueues = queues.filter(q => q.id === deviceId);
        
        // Check if we were active but now aren't (meaning completed, cancelled, or transferred)
        if (currentQueueStatus !== null && myQueues.length === 0) {
           if (currentQueueStatus === 'serving' || currentQueueStatus === 'waiting') {
               showCompleted();
           }
           resetQueueStateLocal();
        }

        if (myQueues.length > 0) {
            // We have an active queue ticket!
            const ticket = myQueues[0];
            selectedDepartmentId = ticket.department_id; // Set dept forcefully 
            currentQueueStatus = ticket.status; 
            
            // Find department name
            const dept = departments.find(d => d.id == ticket.department_id);
            document.getElementById('status-dept-name').innerText = dept ? dept.name : '';
            
            showUIState('checking-queue', { ticketNumber: ticket.number });
            
            // Find who is serving in this department
            const serving = queues.find(q => q.department_id == ticket.department_id && q.status === 'serving');
            document.getElementById('current-serving-number').innerText = serving ? serving.number : '--';

        } else {
            // Not in queue. 
            // If we have selected a dept, show join categories. 
            // If we haven't selected a dept, show department cards.
            if (selectedDepartmentId) {
                // Verify department is open
                const dept = departments.find(d => d.id == selectedDepartmentId);
                if (dept) {
                    if(!dept.is_open) {
                        document.getElementById('offline-message').innerText = `${dept.name} is Closed.`;
                        document.getElementById('offline-message').style.display = 'block';
                    } else {
                        document.getElementById('offline-message').style.display = 'none';
                        
                        const serving = queues.find(q => q.department_id == selectedDepartmentId && q.status === 'serving');
                        const waitingCount = queues.filter(q => q.department_id == selectedDepartmentId && q.status === 'waiting').length;

                        showUIState('select-category', { 
                            deptName: dept.name, 
                            servingNum: serving ? serving.number : '--', 
                            waitingCount 
                        });
                    }
                }
            } else {
                showUIState('select-department', { departments: departments });
            }
        }

    } catch (err) {
        console.error("Poll Error:", err.message);
        
        // 3. Exponential Backoff implementation
        consecutiveErrors++;
        // Max limit of 30 seconds backoff
        currentPollInterval = Math.min(30000, 3000 * Math.pow(2, consecutiveErrors));
        console.log(`Retrying in ${currentPollInterval / 1000} seconds...`);
    }
}

// --- UI STATE MANAGEMENT ---
function showUIState(state, context) {
    const sDept = document.getElementById('dept-selection-section');
    const sCat = document.getElementById('join-queue-section');
    const sQue = document.getElementById('queue-status-section');
    
    sDept.style.display = 'none';
    sCat.style.display = 'none';
    sQue.style.display = 'none';

    if (state === 'select-department') {
        sDept.style.display = 'block';
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
        document.getElementById('dept-cards-container').innerHTML = html;
    }
    else if (state === 'select-category') {
        sCat.style.display = 'block';
        document.getElementById('selected-dept-name').innerText = context.deptName;
        document.getElementById('preview-serving-number').innerText = context.servingNum;
        document.getElementById('preview-waiting-count').innerText = `${context.waitingCount} people waiting ahead`;
    }
    else if (state === 'checking-queue') {
        sQue.style.display = 'block';
        document.getElementById('your-number-display').innerHTML = `Your Number: <strong style="color:var(--primary-color);">${context.ticketNumber}</strong>`;
    }
}

function selectDepartment(deptId, isOpen) {
    if (!isOpen) { alert('This department is currently closed.'); return; }
    selectedDepartmentId = deptId;
    pollState(); // re-eval
}
function goBackToDepts() {
    selectedDepartmentId = null;
    pollState();
}

// --- ACTION METHODS ---
async function joinQueue(type) {
    const res = await fetch('/api/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, type, department_id: selectedDepartmentId })
    });
    
    const data = await res.json();
    if (res.ok) {
        pollState(); // Force instant refresh
    } else {
        alert(data.error);
    }
}

async function leaveQueue() {
    const res = await fetch('/api/queue/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId })
    });
    if(res.ok) {
        resetQueueStateLocal();
        selectedDepartmentId = null; 
        pollState();
    }
}

function resetQueueStateLocal() {
    currentQueueStatus = null;
}

function showCompleted() {
    document.getElementById('completed-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('announcement-modal').style.display = "none";
}

// --- CHATBOT WIDGET ---
async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    const chatLog = document.getElementById('chat-log');
    chatLog.innerHTML += `<div class="user-msg">${message}</div>`;
    input.value = '';
    
    // scroll to bottom
    chatLog.scrollTop = chatLog.scrollHeight;

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

// Remove duplicate init call since startPolling calls pollState
startPolling();
