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

// ── SITE SETTINGS (Customize page) ───────────────────────────────
// Branding and theme live in the single-row `settings` table and are edited from
// the Customize section of admintechnical.html / owner.html. GET /api/settings is
// public (served from server.js, not the admin router) so the landing page can
// brand itself before anyone signs in.
const SITE_DEFAULTS = {
    site_name: 'Medical Clinic',
    logo_path: '/images/examplelogo.svg',
    theme: 'light',
    navbar_color: '#24303A',   // matches --bg-sidebar in shared.css
    background_image: ''
};

// Elements that carry the clinic name or logo. Kept here rather than as data-
// attributes across seven pages, so there is one place to add a new brand spot.
const SITE_NAME_SELECTORS = ['.sidebar-brand-name', '.nav-clinic-name', '.footer-name', '.auth-panel-logo span'];
const SITE_LOGO_SELECTORS = ['.sidebar-logo', '.nav-logo', '.loader-logo', '.about-logo', '.footer-logo', '.auth-panel-logo-img'];

let siteSettings = { ...SITE_DEFAULTS };
let siteTitleTemplate = null;   // document.title as authored, before any swap

// Kick the fetch off as soon as shared.js runs rather than waiting for
// DOMContentLoaded, so branding lands with as little flash as possible.
const siteSettingsReady = fetchSiteSettings();

async function fetchSiteSettings() {
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) return siteSettings;
        const row = await res.json();
        if (row && typeof row === 'object') {
            for (const key of Object.keys(SITE_DEFAULTS)) {
                // '' is a real value for background_image, so only null/undefined fall back.
                if (row[key] !== null && row[key] !== undefined) siteSettings[key] = row[key];
            }
        }
    } catch (e) { /* branding is cosmetic - keep the defaults */ }
    return siteSettings;
}

function siteName() { return siteSettings.site_name || SITE_DEFAULTS.site_name; }
function siteLogo() { return siteSettings.logo_path || SITE_DEFAULTS.logo_path; }

// ── colour helpers ──
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// WCAG relative luminance - decides whether the sidebar needs light or dark ink.
function relativeLuminance({ r, g, b }) {
    const channel = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function mixHex(hex, towardWhite, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const target = towardWhite ? 255 : 0;
    const mix = (c) => Math.round(c + (target - c) * amount);
    return '#' + [mix(rgb.r), mix(rgb.g), mix(rgb.b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

// ── appliers ──
// navbar_color drives the sidebar, which is this app's navbar. The hover/active
// shades and the ink are derived from it, otherwise picking a light colour leaves
// white-on-white text and a dark hover state.
function applyNavbarColor(color) {
    const rgb = hexToRgb(color);
    if (!rgb) return;
    const isLight = relativeLuminance(rgb) > 0.4;
    const root = document.documentElement.style;
    root.setProperty('--bg-sidebar', color);
    root.setProperty('--bg-sidebar-hover', mixHex(color, !isLight, 0.10));
    root.setProperty('--bg-sidebar-active', mixHex(color, !isLight, 0.18));
    root.setProperty('--text-sidebar', isLight ? 'rgba(26,32,40,0.72)' : '#C8D1DA');
    root.setProperty('--text-sidebar-strong', isLight ? '#1A2028' : '#FFFFFF');
    root.setProperty('--sidebar-section-text', isLight ? 'rgba(26,32,40,0.45)' : 'rgba(255,255,255,0.3)');
    root.setProperty('--sidebar-divider', isLight ? 'rgba(26,32,40,0.12)' : 'rgba(255,255,255,0.08)');
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

// Strip anything that could close the url() literal or the surrounding quotes.
function cssUrlValue(url) {
    return String(url || '').replace(/["'()\\\s]/g, encodeURIComponent);
}

function applyBackgroundImage(url) {
    const body = document.body;
    if (!body) return;
    if (!url) {
        ['backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundAttachment', 'backgroundRepeat']
            .forEach(prop => { body.style[prop] = ''; });
        return;
    }
    // A scrim over the photo keeps page titles and muted text legible; the cards
    // on top of it are already opaque.
    const scrim = siteSettings.theme === 'dark' ? 'rgba(21,27,33,0.78)' : 'rgba(247,248,250,0.78)';
    body.style.backgroundImage = `linear-gradient(${scrim}, ${scrim}), url("${cssUrlValue(url)}")`;
    body.style.backgroundSize = 'cover';
    body.style.backgroundPosition = 'center';
    body.style.backgroundAttachment = 'fixed';
    body.style.backgroundRepeat = 'no-repeat';
}

function applyBranding() {
    const name = siteName();
    const logo = siteLogo();

    // Titles are authored as "<Page> — Medical Clinic"; swap the clinic name in
    // place rather than replacing the whole title.
    if (siteTitleTemplate === null) siteTitleTemplate = document.title;
    document.title = siteTitleTemplate.split(SITE_DEFAULTS.site_name).join(name);

    document.querySelectorAll('link[rel="icon"]').forEach(el => el.setAttribute('href', logo));

    document.querySelectorAll(SITE_LOGO_SELECTORS.join(', ')).forEach(img => {
        img.setAttribute('src', logo);
        if ((img.getAttribute('alt') || '').includes(SITE_DEFAULTS.site_name)) {
            img.setAttribute('alt', `${name} Logo`);
        }
    });

    document.querySelectorAll(SITE_NAME_SELECTORS.join(', ')).forEach(el => { el.textContent = name; });

    // Sentences that mention the clinic by name (e.g. the footer copyright).
    document.querySelectorAll('.footer-copy').forEach(el => {
        el.textContent = el.textContent.split(SITE_DEFAULTS.site_name).join(name);
    });
}

// Branding (name, logo, tab title, favicon) applies everywhere. Theme and the
// background image are scoped to the dashboard shell - index.html brings its own
// hand-designed palette and hero artwork in index.css, and half-darkening that or
// dropping a photo behind the hero looks broken rather than themed.
function applyLoadedSettings() {
    const isAppShell = !!document.getElementById('sidebar');
    if (isAppShell) {
        applyTheme(siteSettings.theme);
        applyNavbarColor(siteSettings.navbar_color);
        applyBackgroundImage(siteSettings.background_image);
    }
    applyBranding();
}

// Called on every page from the DOMContentLoaded block below.
async function applySiteSettings() {
    await siteSettingsReady;
    applyLoadedSettings();
}

// Re-pull and re-apply: after an admin saves, and on other open clients via the
// settingsUpdate socket event, so a change lands without a manual reload.
async function refreshSiteSettings() {
    await fetchSiteSettings();
    applyLoadedSettings();
}

// ── CUSTOMIZE FORM (admin + owner) ───────────────────────────────
// admintechnical.html and owner.html host the same #section-customize markup, so
// the load/save pair lives here rather than being duplicated in each page's JS
// (they were byte-for-byte identical apart from the endpoint they POSTed to).
// Both pages register `customize: loadCustomization` in window.onSectionLoad.
const CUSTOMIZE_FIELDS = {
    site_name: 'cust-site-name',
    logo_path: 'cust-logo-path',
    theme: 'cust-theme',
    navbar_color: 'cust-nav-color',
    background_image: 'cust-bg-url'
};

async function loadCustomization() {
    await refreshSiteSettings();
    for (const [field, id] of Object.entries(CUSTOMIZE_FIELDS)) {
        const el = document.getElementById(id);
        if (el) el.value = siteSettings[field] || '';
    }
    const colorText = document.getElementById('cust-nav-color-text');
    if (colorText) colorText.value = siteSettings.navbar_color || SITE_DEFAULTS.navbar_color;
}

async function saveCustomization() {
    // Only the fields this form actually renders are sent, and the backend only
    // writes the columns it receives - so no field can null out another.
    const payload = {};
    for (const [field, id] of Object.entries(CUSTOMIZE_FIELDS)) {
        const el = document.getElementById(id);
        if (el) payload[field] = String(el.value || '').trim();
    }
    if (Object.keys(payload).length === 0) return;
    try {
        const res = await fetch('/api/admin/settings', {
            method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Failed to save settings', 'error'); return; }
        showToast('Settings saved', 'success');
        await refreshSiteSettings();   // reflect it on this page immediately
    } catch (err) {
        showToast('Failed to save settings', 'error');
    }
}

// Keeps the colour swatch and the hex text box showing the same value.
function syncNavColorInputs(source) {
    const picker = document.getElementById('cust-nav-color');
    const text = document.getElementById('cust-nav-color-text');
    if (!picker || !text) return;
    if (source === 'text') {
        if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.value.trim())) picker.value = text.value.trim();
    } else {
        text.value = picker.value;
    }
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
            <img src="${escapeHtml(siteLogo())}" alt="Logo" class="sidebar-logo">
            <div class="sidebar-brand">
                <span class="sidebar-brand-name">${escapeHtml(siteName())}</span>
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
        socket.on('announcementUpdate', () => {
            if (getRole() === 'customer') refreshAnnouncementBanner();
        });
        // An admin saved the Customize page - re-pull branding and re-apply it.
        socket.on('settingsUpdate', () => refreshSiteSettings());
    }
}

// ── ANNOUNCEMENTS ───────────────────────────────────────────────
const ANNOUNCEMENT_STAFF_ROLES = ['frontdesk', 'laboratory', 'doctor', 'admin', 'admintechnical', 'owner'];
const ANNOUNCEMENT_STATION_BY_ROLE = { frontdesk: 'frontdesk', laboratory: 'laboratory', doctor: 'doctor' };
let dismissedAnnouncementIds = new Set();
try { dismissedAnnouncementIds = new Set(JSON.parse(sessionStorage.getItem('dismissedAnnouncements') || '[]')); } catch (e) {}

function initAnnouncements() {
    const role = getRole();
    if (!role) return;
    if (role === 'customer') setupAnnouncementBanner();
    else if (ANNOUNCEMENT_STAFF_ROLES.includes(role)) setupAnnouncementComposer();
}

function setupAnnouncementBanner() {
    refreshAnnouncementBanner();
}

async function refreshAnnouncementBanner() {
    try {
        const res = await fetch('/api/announcements/active', { headers: authHeaders() });
        if (!res.ok) return;
        const rows = await res.json();
        const visible = rows.filter(a => !dismissedAnnouncementIds.has(a.id));
        renderAnnouncementBanner(visible[0] || null);
    } catch (e) { /* non-critical, fail silently */ }
}

function renderAnnouncementBanner(announcement) {
    let bar = document.getElementById('announcement-banner');
    if (!announcement) {
        if (bar) bar.remove();
        document.body.style.paddingTop = '';
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'announcement-banner';
        bar.className = 'announcement-banner';
        document.body.prepend(bar);
    }
    bar.innerHTML = `
        <i class="fa-solid fa-bullhorn"></i>
        <span class="announcement-banner-text">${escapeHtml(announcement.message)}</span>
        <button type="button" class="announcement-banner-close" aria-label="Dismiss announcement">&times;</button>
    `;
    bar.querySelector('.announcement-banner-close').addEventListener('click', () => {
        dismissedAnnouncementIds.add(announcement.id);
        try { sessionStorage.setItem('dismissedAnnouncements', JSON.stringify([...dismissedAnnouncementIds])); } catch (e) {}
        refreshAnnouncementBanner();
    });
    document.body.style.paddingTop = bar.offsetHeight + 'px';
}

function setupAnnouncementComposer() {
    if (document.getElementById('announcement-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'announcement-fab';
    fab.type = 'button';
    fab.className = 'announcement-fab';
    fab.title = 'Send an announcement';
    fab.innerHTML = '<i class="fa-solid fa-bullhorn"></i>';
    fab.addEventListener('click', openAnnouncementComposer);
    document.body.appendChild(fab);

    const overlay = document.createElement('div');
    overlay.id = 'announcement-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-box">
            <div class="modal-header">
                <div class="modal-title"><i class="fa-solid fa-bullhorn"></i> Send Announcement</div>
                <button type="button" class="modal-close" data-close-announcement>&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Message</label>
                    <textarea class="form-input" id="announcement-message" rows="4" placeholder="Type an announcement for customers..."></textarea>
                </div>
                <button type="button" class="btn btn-outline" id="announcement-draft-btn">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> Auto-draft from live queue
                </button>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-outline" data-close-announcement>Cancel</button>
                <button type="button" class="btn btn-primary" id="announcement-send-btn">Send</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('[data-close-announcement]').forEach(el => el.addEventListener('click', () => closeModal('announcement-modal')));
    overlay.querySelector('#announcement-draft-btn').addEventListener('click', draftAnnouncement);
    overlay.querySelector('#announcement-send-btn').addEventListener('click', sendAnnouncement);
}

function openAnnouncementComposer() {
    const textarea = document.getElementById('announcement-message');
    if (textarea) textarea.value = '';
    openModal('announcement-modal');
}

async function draftAnnouncement() {
    const station = ANNOUNCEMENT_STATION_BY_ROLE[getRole()] || 'frontdesk';
    const btn = document.getElementById('announcement-draft-btn');
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Drafting...'; }
    try {
        const res = await fetch(`/api/announcements/draft?station_type=${station}`, { headers: authHeaders() });
        const data = await res.json();
        const textarea = document.getElementById('announcement-message');
        if (textarea && data.message) textarea.value = data.message;
        else if (!data.message) showToast('AI announcements are currently disabled', 'info');
    } catch (e) {
        showToast('Could not draft an announcement right now', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
}

async function sendAnnouncement() {
    const textarea = document.getElementById('announcement-message');
    const message = (textarea?.value || '').trim();
    if (!message) { showToast('Write a message first', 'error'); return; }
    const btn = document.getElementById('announcement-send-btn');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/announcements', {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ message })
        });
        if (!res.ok) throw new Error('Failed');
        showToast('Announcement sent', 'success');
        closeModal('announcement-modal');
    } catch (e) {
        showToast('Failed to send announcement', 'error');
    } finally {
        if (btn) btn.disabled = false;
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
// spaces are blocked entirely (spacebar keystrokes are suppressed, and any
// whitespace that slips in via paste/autofill/IME is stripped immediately).
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 16;

function stripWhitespace(value) {
    return value.replace(/\s+/g, '');
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

        // Block the spacebar keystroke outright so a space is never entered
        // in the first place.
        input.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.code === 'Space') e.preventDefault();
        });

        // Belt-and-suspenders: strip any whitespace that slips in via paste,
        // autofill, or IME composition (keydown alone won't catch those).
        input.addEventListener('input', () => {
            const cleaned = stripWhitespace(input.value);
            if (cleaned !== input.value) {
                const pos = input.selectionStart ?? cleaned.length;
                input.value = cleaned;
                input.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        input.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData)?.getData('text');
            if (text == null) return;
            const cleaned = stripWhitespace(text).slice(0, PASSWORD_MAX_LENGTH);
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
    applySiteSettings();
    enhancePasswordToggles();
    enforcePasswordPolicy();
    initAnnouncements();
});
