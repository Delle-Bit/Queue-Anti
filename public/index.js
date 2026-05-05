// Landing page JS — Login + Registration
function switchAuthTab(tab) {
    document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
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

    const fileInput = document.getElementById('reg-id-photo');
    if (!fileInput.files.length) {
        errEl.textContent = 'ID Photo is required'; errEl.classList.add('show');
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Register';
        return;
    }

    const formData = new FormData();
    formData.append('username', document.getElementById('reg-username').value);
    formData.append('password', document.getElementById('reg-password').value);
    formData.append('email', document.getElementById('reg-email').value);
    formData.append('idImage', fileInput.files[0]);

    try {
        const res = await fetch('/api/auth/register', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
            sucEl.textContent = `Registration complete! Category: ${data.category}. Redirecting to login...`;
            sucEl.classList.add('show');
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
