/* ================================================================
   MEDICAL CLINIC — Shared JavaScript Utilities
   ================================================================ */

// ── AUTH ──────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('clinicToken'); }
function getRole() { return localStorage.getItem('clinicRole'); }
function getUsername() { return localStorage.getItem('clinicUsername'); }
function getCategory() { return localStorage.getItem('clinicCategory'); }
function getUserId() {
    try {
        const t = getToken();
        if (!t) return null;
        return JSON.parse(atob(t.split('.')[1])).id;
    } catch(e) { return null; }
}

function authHeaders() {
    return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
}

function requireAuth(allowedRoles) {
    const token = getToken();
    const role = getRole();
    if (!token || !role) { window.location.replace('/index.html'); return false; }
    if (allowedRoles && !allowedRoles.includes(role)) {
        window.location.replace('/index.html');
        return false;
    }
    return true;
}

function logout() {
    // Track staff logout
    const token = getToken();
    const role = getRole();
    if (token && role !== 'customer') {
        fetch('/api/staff-sessions/logout', {
            method: 'POST',
            headers: authHeaders()
        }).catch(() => {});
    }
    localStorage.removeItem('clinicToken');
    localStorage.removeItem('clinicRole');
    localStorage.removeItem('clinicUsername');
    localStorage.removeItem('clinicCategory');
    window.location.href = '/index.html';
}

// ── SIDEBAR RENDERING ────────────────────────────────────────────
function renderSidebar(navItems, activeId) {
    const username = getUsername() || 'User';
    const role = getRole() || 'user';
    const initials = username.substring(0, 2).toUpperCase();

    const roleLabels = {
        admintechnical: 'Admin Technical',
        admin: 'Administrator',
        customer: 'Customer',
        frontdesk: 'Front Desk',
        laboratory: 'Laboratory',
        owner: 'Owner'
    };

    let navHtml = '';
    navItems.forEach(item => {
        if (item.section) {
            navHtml += `<div class="sidebar-section">${item.section}</div>`;
            return;
        }
        const active = item.id === activeId ? 'active' : '';
        navHtml += `<button class="sidebar-link ${active}" data-nav="${item.id}" onclick="navigateTo('${item.id}')">
            <i class="${item.icon}"></i> ${item.label}
        </button>`;
    });

    const sidebarHtml = `
        <div class="sidebar-header">
            <img src="/images/examplelogo.svg" alt="Logo" class="sidebar-logo">
            <div class="sidebar-brand">
                Medical Clinic
                <small>${roleLabels[role] || role}</small>
            </div>
        </div>
        <nav class="sidebar-nav">${navHtml}</nav>
        <div class="sidebar-footer">
            <div class="sidebar-user">
                <div class="sidebar-avatar">${initials}</div>
                <div class="sidebar-user-info">
                    <div class="sidebar-user-name">${username}</div>
                    <div class="sidebar-user-role">${roleLabels[role] || role}</div>
                </div>
            </div>
            <button class="sidebar-logout" onclick="logout()">
                <i class="fa-solid fa-right-from-bracket"></i> Sign Out
            </button>
        </div>
    `;

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.innerHTML = sidebarHtml;
}

function navigateTo(sectionId) {
    // Switch active section
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    const target = document.getElementById('section-' + sectionId);
    if (target) target.style.display = 'block';

    // Update sidebar active state
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`[data-nav="${sectionId}"]`);
    if (activeLink) activeLink.classList.add('active');

    // Trigger section load callback if exists
    if (window.onSectionLoad && typeof window.onSectionLoad[sectionId] === 'function') {
        window.onSectionLoad[sectionId]();
    }
}

// Initialize first visible section based on active sidebar link
function initDefaultSection() {
    const firstActive = document.querySelector('.sidebar-link.active');
    if (firstActive) {
        const sectionId = firstActive.getAttribute('data-nav');
        if (sectionId) navigateTo(sectionId);
    } else {
        // Show first content-section
        const first = document.querySelector('.content-section');
        if (first) first.style.display = 'block';
    }
}

// ── HAMBURGER (MOBILE) ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const hamburger = document.querySelector('.hamburger');
    const sidebar = document.getElementById('sidebar');
    if (hamburger && sidebar) {
        hamburger.addEventListener('click', () => sidebar.classList.toggle('open'));
        // Close on link click (mobile)
        sidebar.addEventListener('click', (e) => {
            if (e.target.closest('.sidebar-link') && window.innerWidth <= 768) {
                sidebar.classList.remove('open');
            }
        });
    }
});

// ── TOAST NOTIFICATIONS ─────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ── MODAL HELPERS ───────────────────────────────────────────────
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// ── CHATBOT WIDGET ──────────────────────────────────────────────
let chatSessionId = localStorage.getItem('chatSessionId');

function initChatbot() {
    const fab = document.querySelector('.chat-fab');
    const widget = document.querySelector('.chat-widget');
    if (!fab || !widget) return;

    fab.addEventListener('click', () => widget.classList.toggle('open'));
    const closeBtn = widget.querySelector('.close-chat');
    if (closeBtn) closeBtn.addEventListener('click', () => widget.classList.remove('open'));
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    const log = document.getElementById('chat-log');
    log.innerHTML += `<div class="user-msg">${escapeHtml(message)}</div>`;
    input.value = '';
    log.scrollTop = log.scrollHeight;

    // Check for appointment intent
    const lc = message.toLowerCase();
    if (lc.includes('appointment') || lc.includes('schedule') || lc.includes('book')) {
        if (getRole() === 'customer') {
            log.innerHTML += `<div class="bot-msg">I can help you schedule an appointment! Let me redirect you to the Appointments section. <a href="#" onclick="navigateTo('appointments');document.querySelector('.chat-widget').classList.remove('open');return false;" style="color:var(--primary);font-weight:600;">Go to Appointments →</a></div>`;
            log.scrollTop = log.scrollHeight;
            return;
        }
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
        log.innerHTML += `<div class="bot-msg">${data.reply || data.error || 'No response'}</div>`;
    } catch (err) {
        log.innerHTML += `<div class="bot-msg" style="color:var(--danger);">Connection error. Please try again.</div>`;
    }
    log.scrollTop = log.scrollHeight;
}

function sendFaqQuestion(question) {
    const input = document.getElementById('chat-input');
    if (input) { input.value = question; sendChatMessage(); }
}

// ── UTILITY FUNCTIONS ───────────────────────────────────────────
function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function formatTime(dateStr) {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleString([], {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatCurrency(amount) {
    return '₱' + parseFloat(amount || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });
}

function categoryBadge(cat) {
    const cls = {
        'Regular': 'priority-regular',
        'Senior': 'priority-senior',
        'PWD': 'priority-pwd',
        'Pregnant': 'priority-pregnant'
    };
    return `<span class="badge ${cls[cat] || 'badge-neutral'}">${cat || 'Regular'}</span>`;
}

// ── SOCKET.IO ───────────────────────────────────────────────────
let socket = null;
function initSocket() {
    if (typeof io !== 'undefined') {
        socket = io();
        socket.on('queueUpdate', () => {
            if (typeof onQueueUpdate === 'function') onQueueUpdate();
        });
    }
}

// ── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initChatbot();
    initSocket();
});
