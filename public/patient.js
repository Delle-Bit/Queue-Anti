import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, onSnapshot, updateDoc, setDoc, getDoc, collection, addDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// TODO: Replace with your actual Firebase config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentPatientId = localStorage.getItem('patientId') || null;
let currentQueueNumber = localStorage.getItem('queueNumber') || null;

const patientApp = {
    joinQueue: async (type) => {
        if (currentQueueNumber) {
            alert(`You are already in the queue as ${currentQueueNumber}`);
            return;
        }

        // Generate ID logic (simplified for demo, usually backend handles sequential numbering safely)
        // Here we rely on a counter document or random ID for simplicity in this prototype phase
        // Optimally: Transaction to increment counter based on Type.

        try {
            const prefix = type;
            // Fetch current counter for this type (active_queues collection? or metadata doc?)
            // For now, let's just generate a random short ID to simulate unique number
            const randomNum = Math.floor(1000 + Math.random() * 9000);
            const newQueueNumber = `${prefix}-${randomNum}`;

            const newPatientData = {
                number: newQueueNumber,
                type: type, // Q, E, D, P
                status: 'waiting', // waiting, serving, done
                timestamp: serverTimestamp(),
                deviceId: generateDeviceId()
            };

            // Use deviceId as document key for persistence
            await setDoc(doc(db, "queue", newPatientData.deviceId), newPatientData);

            // Update LocalStorage
            localStorage.setItem('patientId', newPatientData.deviceId);
            localStorage.setItem('queueNumber', newQueueNumber);

            currentPatientId = newPatientData.deviceId;
            currentQueueNumber = newQueueNumber;

            updateUI(true);
        } catch (error) {
            console.error("Error joining queue: ", error);
            alert("Failed to join queue. Clinic might be offline.");
        }
    },

    leaveQueue: async () => {
        if (!currentPatientId) return;
        try {
            await updateDoc(doc(db, "queue", currentPatientId), {
                status: 'cancelled'
            });
            localStorage.removeItem('patientId');
            localStorage.removeItem('queueNumber');
            currentPatientId = null;
            currentQueueNumber = null;
            updateUI(false);
        } catch (error) {
            console.error("Error leaving queue: ", error);
        }
    },

    sendMessage: async () => {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        if (!message) return;

        const chatLog = document.getElementById('chat-log');

        // Append User Message
        const userMsgLi = document.createElement('li');
        userMsgLi.classList.add('chat', 'outgoing');
        userMsgLi.innerHTML = `<p>${message}</p>`; // sanitized in a real app
        chatLog.appendChild(userMsgLi);

        input.value = '';
        chatLog.scrollTop = chatLog.scrollHeight;

        try {
            // Simulate bot response for UI demo if backend not ready, or actual fetch
            /* 
            const res = await fetch('/api/chat', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ message })
             });
             const data = await res.json();
             const botReply = data.reply;
            */

            // Simulating response for visual verification since server might not have LLM hooked up yet
            // In real prod, uncomment the fetch above.

            // For now, let's try to fetch, if it fails, fallback to dummy
            let botReply = "I'm just a demo bot for now.";
            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                if (res.ok) {
                    const data = await res.json();
                    botReply = data.reply;
                }
            } catch (e) {
                console.log("Chat API not reachable, using mock.");
            }

            const botMsgLi = document.createElement('li');
            botMsgLi.classList.add('chat', 'incoming');
            botMsgLi.innerHTML = `<p>${botReply}</p>`;
            chatLog.appendChild(botMsgLi);

            chatLog.scrollTop = chatLog.scrollHeight;
        } catch (err) {
            const errorLi = document.createElement('li');
            errorLi.classList.add('chat', 'incoming');
            errorLi.innerHTML = `<p style="color:red">Error connecting to bot.</p>`;
            chatLog.appendChild(errorLi);
        }
    }
};

// UI & Listeners
function updateUI(inQueue) {
    if (inQueue) {
        document.getElementById('join-queue-section').style.display = 'none';
        document.getElementById('queue-status-section').style.display = 'block';
        document.getElementById('your-number-display').innerHTML = `Your Number: <strong>${currentQueueNumber}</strong>`;
    } else {
        document.getElementById('join-queue-section').style.display = 'block';
        document.getElementById('queue-status-section').style.display = 'none';
    }
}

function generateDeviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) {
        id = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', id);
    }
    return id;
}

// Initial Load
if (currentPatientId) {
    // Check if still valid in DB
    const docRef = doc(db, "queue", currentPatientId);
    getDoc(docRef).then(docSnap => {
        if (docSnap.exists() && docSnap.data().status !== 'done' && docSnap.data().status !== 'cancelled') {
            updateUI(true);
        } else {
            // Expired or done
            localStorage.removeItem('patientId');
            localStorage.removeItem('queueNumber');
            updateUI(false);
        }
    });
}

// Listen for Global State (Current Serving)
const stateDocRef = doc(db, "clinic", "state");
onSnapshot(stateDocRef, (doc) => {
    if (doc.exists()) {
        const data = doc.data();
        document.getElementById('current-serving-number').innerText = data.currentServing || "--";

        // Online/Offline Status
        if (!data.isOpen) {
            document.getElementById('offline-message').style.display = 'block';
            document.getElementById('join-queue-section').style.display = 'none';
        } else {
            document.getElementById('offline-message').style.display = 'none';
            if (!currentPatientId) document.getElementById('join-queue-section').style.display = 'block';
        }
    }
});

// Listen for Announcements
const announcementDocRef = doc(db, "clinic", "announcements");
onSnapshot(announcementDocRef, (doc) => {
    if (doc.exists()) {
        const data = doc.data();
        if (data.message && data.timestamp && (Date.now() - data.timestamp.toMillis() < 60000)) {
            // Only show if recent (< 1 min old) to avoid stale popups on refresh
            // Or use a local flag to track 'seen' announcements
            document.getElementById('announcement-text').innerText = data.message;
            document.getElementById('announcement-modal').style.display = 'block';
        }
    }
});

window.patientApp = patientApp;
