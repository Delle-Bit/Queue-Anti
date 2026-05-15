// Landing page JS — Login + Registration
let regCameraStream = null;
let regCapturedBlob = null;

const LANDING_SERVICES = [
    ['Hematology (CBC)', 450],
    ['Clinical Microscopy', 300],
    ['Ultrasound', 2800],
    ['X-ray', 900],
    ['2D Echocardiography', 6000],
    ['Venous Duplex Scan', 4500],
    ['Arterial Duplex Scan', 5800],
    ['Carotid Duplex Scan', 6000],
    ['Holter Monitoring', 6500],
    ['24-Hour Ambulatory BP Monitoring', 5000],
    ['ECG / FCG', 1300],
    ['Blood Chemistry', 4500],
    ['Serology Exams', 2500],
    ['Drug Testing', 900],
    ['HIV Screening', 1200],
    ['Annual Physical Exam', 3500],
    ['Pre-Employment Medical', 3500],
    ['Rapid Antibody Test', 1500]
];

function renderLandingServices() {
    const list = document.getElementById('landing-services-list');
    if (!list) return;
    list.innerHTML = LANDING_SERVICES.map(([name, price]) => `
        <article class="service-card">
            <strong>${name}</strong>
            <span>₱${price.toLocaleString('en-PH')}</span>
        </article>
    `).join('');
}

renderLandingServices();

function switchAuthTab(tab) {
    document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

async function toggleRegCamera() {
    const btn = document.getElementById('reg-camera-toggle');
    const captureBtn = document.getElementById('reg-camera-capture');
    const video = document.getElementById('reg-camera-stream');
    const status = document.getElementById('reg-camera-status');

    if (regCameraStream) {
        regCameraStream.getTracks().forEach(track => track.stop());
        regCameraStream = null;
        video.style.display = 'none';
        captureBtn.style.display = 'none';
        btn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Camera';
        status.textContent = 'Any Valid ID';
    } else {
        try {
            status.textContent = 'Requesting camera access...';
            regCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            video.srcObject = regCameraStream;
            video.style.display = 'block';
            captureBtn.style.display = 'inline-block';
            btn.innerHTML = '<i class="fa-solid fa-camera-slash"></i> Stop Camera';
            status.textContent = 'Position your ID and click Capture';
        } catch (err) {
            status.textContent = 'Camera access denied or not available';
            console.error(err);
        }
    }
}

async function captureRegID() {
    const video = document.getElementById('reg-camera-stream');
    const canvas = document.getElementById('reg-capture-canvas');
    const status = document.getElementById('reg-camera-status');

    if (!video.srcObject) {
        status.textContent = 'Camera not active';
        return;
    }

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
        regCapturedBlob = blob;
        status.textContent = 'Photo captured successfully ✓';
        regCameraStream.getTracks().forEach(track => track.stop());
        regCameraStream = null;
        video.style.display = 'none';
        document.getElementById('reg-camera-capture').style.display = 'none';
        document.getElementById('reg-camera-toggle').innerHTML = '<i class="fa-solid fa-camera"></i> Retake Photo';
    }, 'image/jpeg', 0.9);
}


async function handleLogin(e) {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.classList.remove('show');
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: document.getElementById('login-username').value,
                password: document.getElementById('login-password').value
            })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            localStorage.setItem('clinicToken', data.token);
            localStorage.setItem('clinicRole', data.role);
            localStorage.setItem('clinicUsername', data.username);
            localStorage.setItem('clinicCategory', data.category || 'Regular');
            window.location.href = data.redirect;
        } else {
            errEl.textContent = data.error || 'Login failed';
            errEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = 'Connection error';
        errEl.classList.add('show');
    }
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
}

async function handleRegister(e) {
    e.preventDefault();
    const errEl = document.getElementById('reg-error');
    const sucEl = document.getElementById('reg-success');
    errEl.classList.remove('show'); sucEl.classList.remove('show');
    const btn = document.getElementById('reg-btn');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing ID...';

    if (!regCapturedBlob) {
        errEl.textContent = 'ID Photo is required. Please capture your ID using the camera.'; errEl.classList.add('show');
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Register';
        return;
    }

    const formData = new FormData();
    formData.append('username', document.getElementById('reg-username').value);
    formData.append('password', document.getElementById('reg-password').value);
    formData.append('email', document.getElementById('reg-email').value);
    formData.append('idImage', regCapturedBlob, 'id-photo.jpg');

    try {
        const res = await fetch('/api/auth/register', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
            sucEl.textContent = `Registration complete! Category: ${data.category}. Redirecting to login...`;
            sucEl.classList.add('show');
            regCapturedBlob = null;
            setTimeout(() => switchAuthTab('login'), 2500);
        } else {
            errEl.textContent = data.error || 'Registration failed';
            errEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = 'Connection error';
        errEl.classList.add('show');
    }
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Register';
}

// Forgot password
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

async function requestReset() {
    const username = document.getElementById('forgot-username').value;
    if (!username) return;
    const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    });
    const data = await res.json();
    const msg = document.getElementById('forgot-msg');
    msg.textContent = data.message; msg.classList.add('show');
}

// Landing page chatbot
let landingChatSession = null;
async function sendLandingChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim(); if (!msg) return;
    const log = document.getElementById('chat-log');
    log.innerHTML += `<div class="user-msg">${msg}</div>`;
    input.value = ''; log.scrollTop = log.scrollHeight;

    try {
        const res = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, sessionId: landingChatSession })
        });
        const data = await res.json();
        if (data.sessionId) landingChatSession = data.sessionId;
        log.innerHTML += `<div class="bot-msg">${data.reply || data.error}</div>`;
    } catch (err) {
        log.innerHTML += `<div class="bot-msg" style="color:var(--danger);">Connection error.</div>`;
    }
    log.scrollTop = log.scrollHeight;
}
function sendFaqQ(q) { document.getElementById('chat-input').value = q; sendLandingChat(); }

// Auto-redirect if already logged in
(function checkExisting() {
    const token = localStorage.getItem('clinicToken');
    const role = localStorage.getItem('clinicRole');
    if (token && role) {
        const map = { customer:'/customer.html', frontdesk:'/frontdesk.html', laboratory:'/laboratory.html', admintechnical:'/admintechnical.html', admin:'/admintechnical.html', owner:'/owner.html' };
        if (map[role]) window.location.href = map[role];
    }
})();
