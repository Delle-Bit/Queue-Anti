// Unique chat session ID for Gemini conversation history
const chatSessionId = 'chat_' + (localStorage.getItem('deviceId') || Math.random().toString(36).substring(2, 9));

// Global scope functions for HTML onclick handlers
window.joinQueue = async (type) => {
    if (patientApp.currentQueueNumber) {
        alert(`You are already in the queue as ${patientApp.currentQueueNumber}`);
        return;
    }

    try {
        const res = await fetch('/api/queue/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: patientApp.deviceId, type })
        });
        const data = await res.json();
        
        if (data.success) {
            patientApp.currentQueueNumber = data.number;
            localStorage.setItem('queueNumber', data.number);
            patientApp.updateUI(true);
            patientApp.fetchState(); // fetch immediately after joining
        }
    } catch (err) {
        console.error("Error joining queue: ", err);
        alert("Failed to join queue. Clinic might be offline.");
    }
};

window.leaveQueue = async () => {
    if (!patientApp.deviceId) return;
    try {
        const res = await fetch('/api/queue/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: patientApp.deviceId })
        });
        if (res.ok) {
            localStorage.removeItem('queueNumber');
            patientApp.currentQueueNumber = null;
            patientApp.updateUI(false);
        }
    } catch (err) {
        console.error("Error leaving queue: ", err);
    }
};

window.sendMessage = async () => {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    const chatLog = document.getElementById('chat-log');

    // Append User Message
    const userMsgLi = document.createElement('li');
    userMsgLi.classList.add('chat', 'outgoing');
    userMsgLi.innerHTML = `<p>${message}</p>`; 
    chatLog.appendChild(userMsgLi);

    input.value = '';
    chatLog.scrollTop = chatLog.scrollHeight;

    // Show a typing indicator
    const typingLi = document.createElement('li');
    typingLi.classList.add('chat', 'incoming', 'typing-indicator');
    typingLi.innerHTML = `<p><em>Typing...</em></p>`;
    chatLog.appendChild(typingLi);
    chatLog.scrollTop = chatLog.scrollHeight;

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId: chatSessionId })
        });
        let botReply = "I am currently unavailable.";
        if (res.ok) {
            const data = await res.json();
            botReply = data.reply;
        }

        // Remove typing indicator
        chatLog.removeChild(typingLi);

        const botMsgLi = document.createElement('li');
        botMsgLi.classList.add('chat', 'incoming');
        botMsgLi.innerHTML = `<p>${botReply}</p>`;
        chatLog.appendChild(botMsgLi);

        chatLog.scrollTop = chatLog.scrollHeight;
    } catch (err) {
        chatLog.removeChild(typingLi);
        const errorLi = document.createElement('li');
        errorLi.classList.add('chat', 'incoming');
        errorLi.innerHTML = `<p style="color:red">Error connecting to bot.</p>`;
        chatLog.appendChild(errorLi);
    }
};

window.closeModal = () => {
    document.getElementById('announcement-modal').style.display = "none";
};

// Main App Logic
const patientApp = {
    deviceId: localStorage.getItem('deviceId') || ('device_' + Math.random().toString(36).substring(2, 9)),
    currentQueueNumber: localStorage.getItem('queueNumber') || null,
    lastSeenAnnouncementId: localStorage.getItem('lastAnnouncementId') || null,

    init() {
        localStorage.setItem('deviceId', this.deviceId);
        
        if (this.currentQueueNumber) {
            this.updateUI(true);
        }

        // Poll server for state every 3 seconds
        this.fetchState();
        setInterval(() => this.fetchState(), 3000);

        // Add Enter key listener for chat
        document.getElementById('chat-input').addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                window.sendMessage();
            }
        });
    },

    updateUI(inQueue) {
        if (inQueue) {
            document.getElementById('join-queue-section').style.display = 'none';
            document.getElementById('queue-status-section').style.display = 'block';
            document.getElementById('your-number-display').innerText = this.currentQueueNumber;
        } else {
            document.getElementById('join-queue-section').style.display = 'block';
            document.getElementById('queue-status-section').style.display = 'none';
        }
    },

    async fetchState() {
        try {
            const res = await fetch('/api/state');
            if(!res.ok) return;
            const data = await res.json();
            
            // 1. Process Clinic State
            const state = data.clinicState;
            document.getElementById('current-serving-number').innerText = state.currentServing || "--";

            const offlineMsg = document.getElementById('offline-message');
            const joinSection = document.getElementById('join-queue-section');

            if (!state.isOpen) {
                offlineMsg.style.display = 'flex';
                joinSection.style.display = 'none';
            } else {
                offlineMsg.style.display = 'none';
                if (!this.currentQueueNumber) joinSection.style.display = 'block';
            }

            // 2. Process Current User's Queue Position
            const queue = data.waitingQueue || [];
            if (this.currentQueueNumber) {
                const myIndex = queue.findIndex(q => q.number === this.currentQueueNumber);
                
                if (myIndex === -1) {
                    // Check if they are currently serving
                    if(state.currentServing === this.currentQueueNumber) {
                        document.getElementById('people-ahead').innerText = "0";
                        document.getElementById('wait-time').innerText = "0";
                    } else {
                        // Not in line, not serving -> probably done or cancelled via admin
                        this.currentQueueNumber = null;
                        localStorage.removeItem('queueNumber');
                        this.updateUI(false);
                    }
                } else {
                    // Number of priority people vs regular people affects exact ordering, 
                    // but the server gave us an ordered array based on timestamp (for now, or logic).
                    // In a perfect system the array is pre-sorted by the backend Priority > timestamp.
                    const peopleAhead = myIndex;
                    document.getElementById('people-ahead').innerText = peopleAhead;
                    
                    // Simple estimate: 10 mins per person
                    document.getElementById('wait-time').innerText = peopleAhead * 10;
                }
            }

            // 3. Process Announcements
            const ann = data.announcement;
            if (ann && ann.id && String(ann.id) !== this.lastSeenAnnouncementId) {
                this.lastSeenAnnouncementId = String(ann.id);
                localStorage.setItem('lastAnnouncementId', this.lastSeenAnnouncementId);
                
                document.getElementById('announcement-text').innerText = ann.message;
                document.getElementById('announcement-modal').style.display = 'flex';
            }

        } catch (err) {
            console.error("Failed to fetch clinic state", err);
        }
    }
};

// Start App
patientApp.init();
