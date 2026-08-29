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
        owner: 'Owner',
        doctor: 'Doctor'
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

function showSectionLoader(targetId, message = 'Loading...') {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.classList.add('loading-host');
    let loader = target.querySelector(':scope > .medical-loader-overlay');
    if (!loader) {
        loader = document.createElement('div');
        loader.className = 'medical-loader-overlay';
        loader.innerHTML = `
            <div class="medical-loader">
                <div class="medical-loader-heart"></div>
                <span></span>
            </div>
        `;
        target.appendChild(loader);
    }
    loader.querySelector('span').textContent = message;
}

function hideSectionLoader(targetId) {
    const target = document.getElementById(targetId);
    const loader = target?.querySelector(':scope > .medical-loader-overlay');
    if (loader) loader.remove();
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

// ── PASSWORD VISIBILITY TOGGLE ─────────────────────────────────────
// Adds a show/hide eye button to every password input on the page, wherever
// it lives (auth wizard, admin forms, reset-password) — no per-page markup.
function enhancePasswordToggles(root = document) {
    root.querySelectorAll('input[type="password"]').forEach((input) => {
        if (input.dataset.pwToggleEnhanced) return;
        input.dataset.pwToggleEnhanced = 'true';

        const wrap = document.createElement('span');
        wrap.className = 'pw-toggle-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        input.classList.add('pw-toggle-input');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pw-toggle-btn';
        btn.tabIndex = -1;
        btn.setAttribute('aria-label', 'Show password');
        btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
        btn.addEventListener('click', () => {
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            btn.innerHTML = showing ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>';
            btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        });
        wrap.appendChild(btn);
    });
}

// ── OTP BOX UI ──────────────────────────────────────────────────────
// Progressively enhances a 6-digit OTP <input> into 6 separate single-digit
// boxes. The original input is kept (hidden) as the source of truth via a
// value getter/setter, so any existing code that reads/writes/resets its
// .value elsewhere keeps working without changes.
function enhanceOtpInput(inputId, length = 6) {
    const original = document.getElementById(inputId);
    if (!original || original.dataset.otpEnhanced) return;
    original.dataset.otpEnhanced = 'true';
    original.type = 'hidden';

    const wrapper = document.createElement('div');
    wrapper.className = 'otp-box-group';
    original.insertAdjacentElement('afterend', wrapper);

    const boxes = [];
    for (let i = 0; i < length; i++) {
        const box = document.createElement('input');
        box.type = 'text';
        box.inputMode = 'numeric';
        box.autocomplete = i === 0 ? 'one-time-code' : 'off';
        box.maxLength = 1;
        box.className = 'otp-box';
        wrapper.appendChild(box);
        boxes.push(box);
    }

    let internalValue = '';
    Object.defineProperty(original, 'value', {
        get() { return internalValue; },
        set(v) {
            internalValue = (v || '').replace(/[^0-9]/g, '').slice(0, length);
            boxes.forEach((b, i) => { b.value = internalValue[i] || ''; });
        },
        configurable: true
    });

    function syncFromBoxes() {
        internalValue = boxes.map((b) => b.value).join('');
    }

    boxes.forEach((box, i) => {
        box.addEventListener('input', () => {
            box.value = box.value.replace(/[^0-9]/g, '').slice(-1);
            syncFromBoxes();
            if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !box.value && i > 0) {
                boxes[i - 1].focus();
                boxes[i - 1].value = '';
                syncFromBoxes();
            }
        });
        box.addEventListener('paste', (e) => {
            e.preventDefault();
            const digits = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, length);
            digits.split('').forEach((d, idx) => { if (boxes[idx]) boxes[idx].value = d; });
            syncFromBoxes();
            const next = boxes[Math.min(digits.length, boxes.length - 1)];
            if (next) next.focus();
        });
    });
}

// ── PASSWORD POLICY (length + whitespace hygiene) ──────────────────
// NIST SP 800-63B §5.1.1.2 sets an 8-char minimum and explicitly says the
// space character SHOULD be accepted in memorized secrets. This app caps the
// max at 16 (a product choice, not a NIST recommendation — NIST suggests
// allowing at least 64 to keep multi-word passphrases viable). Either way,
// the space character itself is never blocked or stripped mid-password; only
// leading/trailing whitespace is trimmed (never intentional — usually a
// copy-paste artifact — and would otherwise make a password silently fail to
// match on next login).
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 16;

function stripEdgeWhitespace(value) {
    return value.replace(/^\s+|\s+$/g, '');
}

function enforcePasswordPolicy(root = document) {
    root.querySelectorAll('input[type="password"]').forEach((input) => {
        if (input.dataset.pwPolicyEnhanced) return;
        input.dataset.pwPolicyEnhanced = 'true';

        input.maxLength = PASSWORD_MAX_LENGTH;
        if (!input.minLength || input.minLength < PASSWORD_MIN_LENGTH) input.minLength = PASSWORD_MIN_LENGTH;

        const hintId = input.dataset.lengthHint;
        const hint = hintId ? document.getElementById(hintId) : null;
        if (hint) {
            const existing = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
            if (!existing.includes(hintId)) input.setAttribute('aria-describedby', [...existing, hintId].join(' '));
        }

        // The visible requirements checklist item (static "8-16 characters" text)
        // gets a live checkmark toggle — separate from `hint` above, which is a
        // role=alert element reserved for the transient violation message and
        // shouldn't also carry permanent static content.
        const reqId = input.dataset.requirementItem;
        const reqItem = reqId ? document.getElementById(reqId) : null;

        function reportLength() {
            const len = input.value.length;
            const withinRange = len >= PASSWORD_MIN_LENGTH && len <= PASSWORD_MAX_LENGTH;
            if (reqItem) reqItem.classList.toggle('met', len > 0 && withinRange);
            if (!hint) return;
            if (len > 0 && len < PASSWORD_MIN_LENGTH) {
                hint.textContent = `Password must be at least ${PASSWORD_MIN_LENGTH} characters (${len}/${PASSWORD_MIN_LENGTH}).`;
                hint.classList.add('mismatch');
                input.setAttribute('aria-invalid', 'true');
            } else if (len >= PASSWORD_MAX_LENGTH) {
                hint.textContent = `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters.`;
                hint.classList.add('mismatch');
                input.setAttribute('aria-invalid', 'true');
            } else {
                hint.textContent = '';
                hint.classList.remove('mismatch');
                input.removeAttribute('aria-invalid');
            }
        }
        input.addEventListener('input', reportLength);

        // Trim only on blur (not live on every keystroke) — trimming while
        // typing would delete the space the instant it's pressed mid-passphrase,
        // since it's technically "trailing" until the next character is typed.
        input.addEventListener('blur', () => {
            const trimmed = stripEdgeWhitespace(input.value);
            if (trimmed !== input.value) {
                input.value = trimmed;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        input.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData)?.getData('text');
            if (text == null) return;
            const cleaned = stripEdgeWhitespace(text).slice(0, PASSWORD_MAX_LENGTH);
            if (cleaned === text) return;
            e.preventDefault();
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            const next = (input.value.slice(0, start) + cleaned + input.value.slice(end)).slice(0, PASSWORD_MAX_LENGTH);
            input.value = next;
            const pos = Math.min(start + cleaned.length, next.length);
            input.setSelectionRange(pos, pos);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
}

// ── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    enhancePasswordToggles();
    enforcePasswordPolicy();
});
