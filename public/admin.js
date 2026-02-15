import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, onSnapshot, updateDoc, setDoc, getDocs, collection, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const adminApp = {
    callNext: async () => {
        // Priority Logic: Check Priority Types first (P, D, E) then Q
        // Query for 'waiting' with priority
        // This is a simplified logic. In real app, might separate collections or use compound queries.

        try {
            const qRef = collection(db, "queue");
            // We need to fetch all waiting to sort by priority manually or simple 2 queries
            // Strategy: Query 'waiting' status, sort by timestamp asc. 
            // In client, pick first P, D, or E. If none, pick Q.

            const q = query(qRef, where("status", "==", "waiting"), orderBy("timestamp", "asc"));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                alert("Queue is empty!");
                return;
            }

            let nextPatient = null;
            const patients = querySnapshot.docs.map(d => ({ ...d.data(), id: d.id }));

            // Priority Filter
            const priorities = patients.filter(p => ['P', 'D', 'E'].includes(p.type));
            const regulars = patients.filter(p => p.type === 'Q');

            if (priorities.length > 0) {
                nextPatient = priorities[0]; // First priority by timestamp
            } else if (regulars.length > 0) {
                nextPatient = regulars[0];
            }

            if (nextPatient) {
                // Update Status
                await updateDoc(doc(db, "queue", nextPatient.id), { status: 'serving' });

                // Update Clinic State
                await updateDoc(doc(db, "clinic", "state"), {
                    currentServing: nextPatient.number
                });

                // Done previous patient? Need to handle "serving" -> "done" transition if we track history.
                // ideally we mark the PREVIOUS 'serving' patient as 'done' before setting new one.
            }

        } catch (err) {
            console.error("Error calling next:", err);
            alert("Error calling next patient.");
        }
    },

    resetQueue: async () => {
        if (!confirm("Are you sure? This will remove everyone from the queue.")) return;

        // Batch update all waiting/serving to 'cancelled' or delete
        // For prototype, we might just wipe the colleciton or reset state
        const qRef = collection(db, "queue");
        const snapshot = await getDocs(qRef);
        snapshot.forEach(async (d) => {
            await updateDoc(doc(db, "queue", d.id), { status: 'cancelled' });
        });

        await updateDoc(doc(db, "clinic", "state"), { currentServing: '--' });
    },

    broadcast: async () => {
        const msg = document.getElementById('announcement-input').value;
        if (!msg) return;

        await setDoc(doc(db, "clinic", "announcements"), {
            message: msg,
            timestamp: serverTimestamp()
        });
        alert('Broadcast sent!');
        document.getElementById('announcement-input').value = '';
    },

    toggleClinicStatus: async () => {
        const isOpen = document.getElementById('clinic-status-toggle').checked;
        await updateDoc(doc(db, "clinic", "state"), { isOpen: isOpen });
    }
};

// Initialize Dashboard
async function initDashboard() {
    // Generate QR
    const res = await fetch('/api/qrcode');
    const data = await res.json();
    document.getElementById('qrcode-container').innerHTML = `<img src="${data.qrImage}" alt="Scan to join" width="150"/>`;

    // Listen to stats
    const qRef = collection(db, "queue");
    onSnapshot(qRef, (snap) => {
        const list = snap.docs.map(d => d.data());
        const waiting = list.filter(d => d.status === 'waiting').length;
        const served = list.filter(d => d.status === 'done' || d.status === 'serving').length; // approximation

        document.getElementById('pending-count').innerText = waiting;
        document.getElementById('total-served').innerText = served;

        updateChart(waiting, served);
    });

    // Listen to Clinic State
    onSnapshot(doc(db, "clinic", "state"), (doc) => {
        if (doc.exists()) {
            document.getElementById('admin-current-serving').innerText = doc.data().currentServing || '--';
            document.getElementById('clinic-status-toggle').checked = doc.data().isOpen;
        }
    });
}

// Chart.js
let queueChart;
function updateChart(waiting, served) {
    const ctx = document.getElementById('queueChart').getContext('2d');
    if (queueChart) queueChart.destroy();

    queueChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Waiting', 'Served'],
            datasets: [{
                label: 'Patients',
                data: [waiting, served],
                backgroundColor: ['#ffc107', '#28a745']
            }]
        }
    });
}

initDashboard();

window.adminApp = adminApp;
