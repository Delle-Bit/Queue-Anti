// Global scope helpers
window.callNext = async () => {
    try {
        const res = await fetch('/api/admin/next', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            console.log("Called next:", data.next);
            adminApp.fetchState();
        } else {
            alert(data.message || "Could not call next patient.");
        }
    } catch (err) {
        console.error("Error calling next:", err);
        alert("Error connecting to server.");
    }
};

window.resetQueue = async () => {
    if (!confirm("Are you sure? This will remove everyone from the queue.")) return;

    try {
        await fetch('/api/admin/reset', { method: 'POST' });
        adminApp.fetchState();
    } catch (err) {
        console.error("Error resetting queue:", err);
    }
};

window.broadcast = async () => {
    const msg = document.getElementById('announcement-input').value.trim();
    if (!msg) return;

    try {
        await fetch('/api/admin/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        });
        alert('Broadcast sent!');
        document.getElementById('announcement-input').value = '';
        adminApp.fetchState();
    } catch (err) {
        console.error("Error broadcasting:", err);
    }
};

window.toggleClinicStatus = async () => {
    const isOpen = document.getElementById('clinic-status-toggle').checked;
    try {
        await fetch('/api/admin/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isOpen })
        });
        adminApp.fetchState();
    } catch (err) {
        console.error("Error toggling clinic status:", err);
        // revert UI if failed
        document.getElementById('clinic-status-toggle').checked = !isOpen;
    }
};

// Admin Application Logic
const adminApp = {
    chart: null,

    async init() {
        // Generate QR code for patients
        try {
            const res = await fetch('/api/qrcode');
            const data = await res.json();
            document.getElementById('qrcode-container').innerHTML = `<img src="${data.qrImage}" alt="Scan to join" style="width: 150px; height: 150px;"/>`;
        } catch(e) {
            console.error("Error loading QR code");
        }

        // Initialize polling state
        this.fetchState();
        setInterval(() => this.fetchState(), 3000); // UI poll
    },

    async fetchState() {
        try {
            const res = await fetch('/api/state');
            if(!res.ok) return;
            const data = await res.json();
            
            // Clinic State
            document.getElementById('admin-current-serving').innerText = data.clinicState.currentServing || '--';
            document.getElementById('clinic-status-toggle').checked = data.clinicState.isOpen;

            // Stats
            const waitingCount = data.waitingQueue ? data.waitingQueue.length : 0;
            const servedCount = data.totalServed || 0;

            document.getElementById('pending-count').innerText = waitingCount;
            document.getElementById('total-served').innerText = servedCount;

            this.updateChart(waitingCount, servedCount);

        } catch (err) {
            console.error("Failed to fetch admin state", err);
        }
    },

    updateChart(waiting, served) {
        const ctx = document.getElementById('queueChart').getContext('2d');
        if (this.chart) {
            this.chart.data.datasets[0].data = [waiting, served];
            this.chart.update();
        } else {
            this.chart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Waiting', 'Served Today'],
                    datasets: [{
                        label: 'Patients',
                        data: [waiting, served],
                        backgroundColor: ['#005B96', '#00A896'],
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 } }
                    }
                }
            });
        }
    }
};

// Start logic
adminApp.init();
