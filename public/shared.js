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
    localStorage.removeItem('clinicLastActivity');
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
const SITE_NAME_SELECTORS = ['.sidebar-brand-name', '.topbar-name', '.nav-clinic-name', '.footer-name', '.auth-panel-logo span'];
const SITE_LOGO_SELECTORS = ['.sidebar-logo', '.topbar-logo', '.nav-logo', '.loader-logo', '.about-logo', '.footer-logo', '.auth-panel-logo-img'];

// Shared by the sidebar header and the mobile topbar, so an account never reads
// as one thing in the drawer and another in the header.
const ROLE_LABELS = {
    admintechnical: 'Admin Technical',
    admin: 'Administrator',
    customer: 'Customer',
    frontdesk: 'Front Desk',
    laboratory: 'Laboratory',
    owner: 'Owner',
    doctor: 'Doctor'
};

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
    // Branding is clinic-wide configuration, so it goes on the audit trail with
    // a reason like every other configuration change. The server rejects the
    // request without one.
    const reason = await promptReason({
        title: 'Save appearance changes',
        message: 'These settings apply to every user of the clinic system.',
        placeholder: 'e.g. updated to the new clinic logo and brand colour',
        confirmLabel: 'Save settings',
        presets: ['Rebranding update', 'Corrected clinic name', 'Seasonal theme change']
    });
    if (!reason) return;
    try {
        const res = await fetch('/api/admin/settings', {
            method: 'PUT', headers: authHeaders(), body: JSON.stringify({ ...payload, reason })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Failed to save settings', 'error'); return; }
        showToast('Settings saved', 'success');
        await refreshSiteSettings();   // reflect it on this page immediately
    } catch (err) {
        showToast('Failed to save settings', 'error');
    }
}

// Restores the shipped defaults - SITE_DEFAULTS above, which mirrors the column
// defaults in database.js. Goes through the same PUT as a normal save, so it
// gets the same validation, audit_logs entry and settingsUpdate broadcast rather
// than a second code path that could drift from it.
async function resetCustomization() {
    const confirmed = await confirmAction({
        title: 'Reset appearance to defaults',
        message: 'Site name, logo, theme, navbar colour and background image will all go back to their shipped defaults.',
        detail: 'This affects every user of the clinic system, not just you.',
        icon: 'fa-solid fa-rotate-left',
        confirmLabel: 'Reset to defaults',
        confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    const reason = await promptReason({
        title: 'Reason for resetting appearance',
        placeholder: 'e.g. reverting an unapproved branding change',
        confirmLabel: 'Reset appearance',
        confirmClass: 'btn-danger',
        presets: ['Reverting an unapproved change', 'Starting branding over', 'Fixing a broken theme']
    });
    if (!reason) return;
    try {
        const res = await fetch('/api/admin/settings', {
            method: 'PUT', headers: authHeaders(), body: JSON.stringify({ ...SITE_DEFAULTS, reason })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || 'Failed to reset settings', 'error'); return; }
        showToast('Appearance reset to defaults', 'success');
        // Re-fills the form from the server rather than from SITE_DEFAULTS, so the
        // inputs show what was actually stored.
        await loadCustomization();
    } catch (err) {
        showToast('Failed to reset settings', 'error');
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

    const roleLabels = ROLE_LABELS;

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

// ── MOBILE TOPBAR ───────────────────────────────────────────────
// Below 768px the sidebar is a drawer, which left the hamburger as a lone
// floating square overlapping the page heading and no clinic branding anywhere
// on screen. This puts the hamburger, logo, clinic name and account category in
// one bar so nothing overlaps and the two text lines can ellipsis instead of
// wrapping. The hamburger element itself is relocated rather than recreated, so
// its listeners and id stay intact across all six role pages.
function accountCategoryLabel() {
    const role = getRole() || 'user';
    const label = ROLE_LABELS[role] || role;
    const category = getCategory();
    // Priority category only exists for customers, and 'Regular' adds nothing.
    if (role === 'customer' && category && category !== 'Regular') return `${label} • ${category}`;
    return label;
}

function buildMobileTopbar(hamburger) {
    if (document.querySelector('.topbar')) return;

    const bar = document.createElement('header');
    bar.className = 'topbar';
    document.body.prepend(bar);
    bar.appendChild(hamburger);

    const logo = document.createElement('img');
    logo.className = 'topbar-logo';
    logo.src = siteLogo();
    logo.alt = '';
    logo.width = 30;
    logo.height = 30;
    bar.appendChild(logo);

    const text = document.createElement('div');
    text.className = 'topbar-text';
    text.innerHTML = `
        <span class="topbar-name">${escapeHtml(siteName())}</span>
        <span class="topbar-meta">${escapeHtml(accountCategoryLabel())}</span>
    `;
    bar.appendChild(text);
}

// ── HAMBURGER (MOBILE) ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const hamburger = document.querySelector('.hamburger');
    const sidebar = document.getElementById('sidebar');
    if (!hamburger || !sidebar) return;

    // The markup is an icon-only button in all six role pages; label it here
    // rather than editing each one.
    hamburger.setAttribute('aria-label', 'Toggle navigation menu');
    hamburger.setAttribute('aria-controls', 'sidebar');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.querySelector('i')?.setAttribute('aria-hidden', 'true');

    buildMobileTopbar(hamburger);

    // Tap-outside-to-close target. Also lifts the drawer clear of the floating
    // VA widget and announcement FAB, which used to sit over its Sign Out row.
    const scrim = document.createElement('div');
    scrim.className = 'sidebar-scrim';
    document.body.appendChild(scrim);

    function setDrawer(open) {
        sidebar.classList.toggle('open', open);
        document.body.classList.toggle('sidebar-open', open);
        hamburger.setAttribute('aria-expanded', String(open));
    }

    hamburger.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
    scrim.addEventListener('click', () => setDrawer(false));

    // Close on link click (mobile)
    sidebar.addEventListener('click', (e) => {
        if (e.target.closest('.sidebar-link') && window.innerWidth <= 768) setDrawer(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) setDrawer(false);
    });

    // Above 768px the sidebar is always visible and the scrim/scroll lock have
    // no meaning, so a drawer left open through a rotation must be reset.
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && sidebar.classList.contains('open')) setDrawer(false);
    });
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

// The banner is position:fixed, so everything else that is fixed to the top of
// the viewport (the sidebar, the mobile hamburger) has to be told how tall it
// is. Its height changes with viewport width as the message rewraps, so it is
// measured continuously rather than once at render.
let announcementSizeObserver = null;

function publishAnnouncementHeight(bar) {
    const height = bar ? bar.offsetHeight : 0;
    document.body.style.paddingTop = height ? height + 'px' : '';
    document.documentElement.style.setProperty('--announcement-h', height + 'px');
}

function renderAnnouncementBanner(announcement) {
    let bar = document.getElementById('announcement-banner');
    if (!announcement) {
        if (bar) bar.remove();
        if (announcementSizeObserver) {
            announcementSizeObserver.disconnect();
            announcementSizeObserver = null;
        }
        publishAnnouncementHeight(null);
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'announcement-banner';
        bar.className = 'announcement-banner';
        bar.setAttribute('role', 'status');
        bar.setAttribute('aria-live', 'polite');
        document.body.prepend(bar);
        if (typeof ResizeObserver === 'function') {
            announcementSizeObserver = new ResizeObserver(() => publishAnnouncementHeight(bar));
            announcementSizeObserver.observe(bar);
        }
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
    publishAnnouncementHeight(bar);
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


// ── CONFIRMATION & REASON DIALOGS ────────────────────────────────────────────
// Built from JavaScript rather than added to each page's markup: the dashboards
// are six separate HTML files with no templating, so a shared dialog has to
// bring its own DOM or it has to be pasted six times.

let dialogSeq = 0;

function buildDialog({ title, icon, bodyHtml, confirmLabel, confirmClass, cancelLabel }) {
    const id = `shared-dialog-${++dialogSeq}`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = id;
    // Above the announcement banner (250) and the sidebar drawer (200), so a
    // dialog is never opened underneath something.
    overlay.style.zIndex = '400';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width:480px;">
            <div class="modal-header">
                <div class="modal-title">${icon ? `<i class="${icon}"></i> ` : ''}${escapeHtml(title)}</div>
                <button class="modal-close" type="button" data-dialog-cancel>&times;</button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-footer">
                <button class="btn btn-secondary" type="button" data-dialog-cancel>${escapeHtml(cancelLabel || 'Cancel')}</button>
                <button class="btn ${confirmClass || 'btn-primary'}" type="button" data-dialog-confirm>${escapeHtml(confirmLabel || 'Confirm')}</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    return overlay;
}

// Resolves true/false. Used for the mandatory "Next" confirmation and any other
// step that should not happen on a single stray click.
function confirmAction({ title = 'Please confirm', message = '', detail = '', icon = 'fa-solid fa-circle-question',
                         confirmLabel = 'Confirm', confirmClass = 'btn-primary', cancelLabel = 'Cancel' } = {}) {
    return new Promise(resolve => {
        const bodyHtml = `
            <p style="margin:0 0 ${detail ? '8px' : '0'};">${escapeHtml(message)}</p>
            ${detail ? `<p class="text-muted text-sm" style="margin:0;">${escapeHtml(detail)}</p>` : ''}`;
        const overlay = buildDialog({ title, icon, bodyHtml, confirmLabel, confirmClass, cancelLabel });

        function close(result) {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        }
        function onKey(e) {
            if (e.key === 'Escape') close(false);
            if (e.key === 'Enter') close(true);
        }
        overlay.querySelectorAll('[data-dialog-cancel]').forEach(b => b.addEventListener('click', () => close(false)));
        overlay.querySelector('[data-dialog-confirm]').addEventListener('click', () => close(true));
        overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
        document.addEventListener('keydown', onKey);

        overlay.classList.add('active');
        overlay.querySelector('[data-dialog-confirm]').focus();
    });
}

// Resolves the reason string, or null if cancelled. Every system-level
// configuration change asks for one, and the server rejects the request without
// it - so this is the client half of a rule enforced on both sides.
const REASON_MIN_LENGTH = 3;

function promptReason({ title = 'Reason for this change', message = '',
                        placeholder = 'e.g. price corrected per the 2026 rate sheet',
                        confirmLabel = 'Save change', confirmClass = 'btn-primary',
                        presets = [] } = {}) {
    return new Promise(resolve => {
        const bodyHtml = `
            ${message ? `<p style="margin:0 0 12px;">${escapeHtml(message)}</p>` : ''}
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" for="dialog-reason">Reason / remarks <span style="color:var(--danger)">*</span></label>
                <textarea class="form-input" id="dialog-reason" rows="3"
                          placeholder="${escapeHtml(placeholder)}" style="resize:vertical;"></textarea>
                <small class="text-muted">Recorded in the audit log against your account. Minimum ${REASON_MIN_LENGTH} characters.</small>
                <div id="dialog-reason-error" class="text-sm" style="display:none;color:var(--danger);margin-top:6px;"></div>
            </div>
            ${presets.length ? `<div class="mt-sm" style="display:flex;flex-wrap:wrap;gap:6px;">
                ${presets.map(pr => `<button type="button" class="btn btn-sm btn-outline" data-preset="${escapeHtml(pr)}">${escapeHtml(pr)}</button>`).join('')}
            </div>` : ''}`;
        const overlay = buildDialog({
            title, icon: 'fa-solid fa-clipboard-check', bodyHtml, confirmLabel, confirmClass
        });
        const field = overlay.querySelector('#dialog-reason');
        const error = overlay.querySelector('#dialog-reason-error');

        function close(result) {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        }
        function submit() {
            const value = field.value.trim();
            if (value.length < REASON_MIN_LENGTH) {
                error.textContent = `Please give a reason of at least ${REASON_MIN_LENGTH} characters.`;
                error.style.display = 'block';
                field.focus();
                return;
            }
            close(value);
        }
        function onKey(e) {
            if (e.key === 'Escape') close(null);
            // Enter alone inserts a newline in the textarea, so the shortcut is
            // the deliberate two-key one.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        }
        overlay.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
            field.value = btn.dataset.preset;
            error.style.display = 'none';
            field.focus();
        }));
        overlay.querySelectorAll('[data-dialog-cancel]').forEach(b => b.addEventListener('click', () => close(null)));
        overlay.querySelector('[data-dialog-confirm]').addEventListener('click', submit);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
        document.addEventListener('keydown', onKey);

        overlay.classList.add('active');
        field.focus();
    });
}

// ── STAFF INACTIVITY TIMEOUT ────────────────────────────────────────────────
// A staff terminal left alone for 15 minutes is signed out and returned to the
// sign-in page. Only the browser can tell an idle terminal from a busy one, so
// the clock lives here; the server is told about real activity through
// /api/session/heartbeat and enforces the same limit on the token, so a closed
// laptop cannot leave a usable session behind. See session_activity.js.

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const IDLE_WARN_MS = 60 * 1000;          // warn one minute out
const HEARTBEAT_MIN_INTERVAL_MS = 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 5 * 1000;

// Shared through localStorage so activity in one tab keeps the others alive -
// otherwise a staff member working in two tabs is logged out of the one they
// happen not to be looking at.
const IDLE_STORAGE_KEY = 'clinicLastActivity';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel', 'click'];

let idleTimer = null;
let idleWarningDialog = null;
let lastHeartbeatAt = 0;
let sessionEnding = false;

function readLastActivity() {
    const stored = Number(localStorage.getItem(IDLE_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : Date.now();
}

function markActivity() {
    if (sessionEnding) return;
    localStorage.setItem(IDLE_STORAGE_KEY, String(Date.now()));
    dismissIdleWarning();
    sendHeartbeat();
}

function sendHeartbeat(force = false) {
    const now = Date.now();
    if (!force && now - lastHeartbeatAt < HEARTBEAT_MIN_INTERVAL_MS) return;
    lastHeartbeatAt = now;
    fetch('/api/session/heartbeat', { method: 'POST', headers: authHeaders() }).catch(() => {});
}

function dismissIdleWarning() {
    if (!idleWarningDialog) return;
    idleWarningDialog.remove();
    idleWarningDialog = null;
}

function showIdleWarning(secondsLeft) {
    if (idleWarningDialog) {
        const counter = idleWarningDialog.querySelector('[data-idle-countdown]');
        if (counter) counter.textContent = secondsLeft;
        return;
    }
    idleWarningDialog = buildDialog({
        title: 'Still there?',
        icon: 'fa-solid fa-clock',
        bodyHtml: `<p style="margin:0;">You will be signed out in
                   <strong data-idle-countdown>${secondsLeft}</strong> seconds because of inactivity.</p>
                   <p class="text-muted text-sm" style="margin:8px 0 0;">This protects patient records on shared terminals.</p>`,
        confirmLabel: 'Keep me signed in',
        confirmClass: 'btn-primary',
        cancelLabel: 'Sign out now'
    });
    idleWarningDialog.querySelectorAll('[data-dialog-cancel]').forEach(b =>
        b.addEventListener('click', () => endSessionForInactivity(true)));
    idleWarningDialog.querySelector('[data-dialog-confirm]').addEventListener('click', () => {
        markActivity();
        sendHeartbeat(true);
    });
    idleWarningDialog.classList.add('active');
}

// `manual` distinguishes the user choosing to sign out from the timer running
// down, purely so the sign-in page can say which happened.
function endSessionForInactivity(manual = false) {
    if (sessionEnding) return;
    sessionEnding = true;
    if (idleTimer) clearInterval(idleTimer);
    dismissIdleWarning();
    localStorage.removeItem(IDLE_STORAGE_KEY);
    const token = getToken();
    const finish = () => { window.location.replace(manual ? '/index.html' : '/index.html?timeout=1'); };
    if (!token) return finish();
    // keepalive so the request survives the navigation that follows it.
    fetch('/api/session/timeout', { method: 'POST', headers: authHeaders(), keepalive: true })
        .catch(() => {})
        .finally(() => {
            localStorage.removeItem('clinicToken');
            localStorage.removeItem('clinicRole');
            localStorage.removeItem('clinicUsername');
            localStorage.removeItem('clinicCategory');
            finish();
        });
}

// The server can decide a session is over before the local clock does (another
// tab timed out, or the server restarted and rejected a stale token). Every
// /api response is checked for the header it sets, which is why this wraps
// fetch rather than being added to each of the dozens of existing call sites.
function installSessionExpiryInterceptor() {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        return nativeFetch(input, init).then(response => {
            if (response.status === 401 && response.headers.get('X-Session-Timeout') === '1' && !sessionEnding) {
                sessionEnding = true;
                localStorage.removeItem(IDLE_STORAGE_KEY);
                localStorage.removeItem('clinicToken');
                localStorage.removeItem('clinicRole');
                localStorage.removeItem('clinicUsername');
                localStorage.removeItem('clinicCategory');
                window.location.replace('/index.html?timeout=1');
            }
            return response;
        });
    };
}

function initIdleTimeout() {
    const role = getRole();
    // Customers are on their own phones; the requirement is about staff
    // terminals sitting unattended in a public clinic.
    if (!getToken() || !role || role === 'customer') return;

    installSessionExpiryInterceptor();
    localStorage.setItem(IDLE_STORAGE_KEY, String(Date.now()));
    sendHeartbeat(true);
    ACTIVITY_EVENTS.forEach(evt => document.addEventListener(evt, markActivity, { passive: true }));
    // Returning to the tab is itself a sign of life.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) markActivity(); });

    idleTimer = setInterval(() => {
        const idleFor = Date.now() - readLastActivity();
        if (idleFor >= IDLE_LIMIT_MS) return endSessionForInactivity();
        if (idleFor >= IDLE_LIMIT_MS - IDLE_WARN_MS) {
            showIdleWarning(Math.max(1, Math.ceil((IDLE_LIMIT_MS - idleFor) / 1000)));
        } else {
            dismissIdleWarning();
        }
    }, IDLE_CHECK_INTERVAL_MS);
}

// ── CLIENT-SIDE TABLE FILTERING ─────────────────────────────────────────────
// Shared by the account, audit and archive search boxes: match a search term
// against a chosen set of fields on each row, case-insensitively, so "senior",
// "MC-2026" and "42" all work in the same box.
function matchesSearch(row, term, fields) {
    const q = String(term || '').trim().toLowerCase();
    if (!q) return true;
    return fields.some(field => String(row[field] ?? '').toLowerCase().includes(q));
}

// Debounce for search boxes that hit the server, so typing does not fire a
// request per keystroke.
function debounce(fn, wait = 250) {
    let handle = null;
    return function (...args) {
        if (handle) clearTimeout(handle);
        handle = setTimeout(() => fn.apply(this, args), wait);
    };
}

// ── RICH TEXT NOTEPAD ──────────────────────────────
// The editor behind the "Other Diagnostics" result form: a formatting toolbar
// over a contenteditable box, for the tests that have no fixed set of fields
// and are written up as prose instead.
//
// It is built by hand rather than pulled from a library because this project has
// no bundler and loads no third-party scripts. Formatting goes through
// document.execCommand, which is deprecated but is the only dependency-free way
// to apply inline formatting to a selection; every browser still implements it,
// and the alternative is several hundred lines of Range surgery.
//
// What comes out is HTML, and HTML written by one user and shown to another has
// to be sanitised. That happens server-side in rich_text.js, which is the
// boundary; sanitizeRichHtml below is for rendering a stored note back into a
// page, so a record written before a rule changed still cannot inject anything.

const RICH_TEXT_TAGS = ['P', 'BR', 'DIV', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H3', 'H4', 'BLOCKQUOTE'];

// Tags whose text goes with them. For most disallowed tags the wording is worth
// keeping - a stripped <a> should still read as its label - but the body of a
// <script> is code, not clinical content, and leaving it behind as text put
// "alert(1)" in the record. Matches DROP_WITH_CONTENT in rich_text.js, which is
// the server-side boundary.
const RICH_TEXT_DROP_CONTENT = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT'];

// Parses into an inert document and rebuilds from an allow-list, dropping every
// attribute. Unlike a regex pass this cannot be fooled by odd nesting, because
// the browser has already resolved the markup into a tree.
function sanitizeRichHtml(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    const walk = (source, target) => {
        source.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                target.appendChild(document.createTextNode(node.nodeValue));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (RICH_TEXT_DROP_CONTENT.includes(node.tagName)) return;
            if (!RICH_TEXT_TAGS.includes(node.tagName)) {
                // Keep what it said, lose how it said it.
                walk(node, target);
                return;
            }
            const clean = document.createElement(node.tagName.toLowerCase());
            walk(node, clean);
            target.appendChild(clean);
        });
    };
    const out = document.createElement('div');
    walk(doc.body, out);
    return out.innerHTML;
}

// Plain-text twin, for a preview line or a character count.
function richTextToPlainText(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

const RICH_TEXT_COMMANDS = [
    { cmd: 'bold', icon: 'fa-bold', label: 'Bold', keys: 'Ctrl+B' },
    { cmd: 'italic', icon: 'fa-italic', label: 'Italic', keys: 'Ctrl+I' },
    { cmd: 'underline', icon: 'fa-underline', label: 'Underline', keys: 'Ctrl+U' },
    { cmd: 'insertUnorderedList', icon: 'fa-list-ul', label: 'Bulleted list' },
    { cmd: 'insertOrderedList', icon: 'fa-list-ol', label: 'Numbered list' },
    { cmd: 'formatBlock', value: 'h3', icon: 'fa-heading', label: 'Heading' },
    { cmd: 'removeFormat', icon: 'fa-eraser', label: 'Clear formatting' }
];

// Turns an empty container into an editor. Idempotent, so a page that re-renders
// its workspace does not stack two toolbars on one box.
function initRichTextEditor(target, { placeholder = 'Type your findings...' } = {}) {
    const host = typeof target === 'string' ? document.getElementById(target) : target;
    if (!host || host.querySelector(':scope > .rte')) return host && host.querySelector('.rte-body');

    const buttons = RICH_TEXT_COMMANDS.map(c => `
        <button type="button" class="rte-btn" data-cmd="${c.cmd}"
                ${c.value ? `data-value="${c.value}"` : ''}
                title="${escapeHtml(c.label + (c.keys ? ` (${c.keys})` : ''))}"
                aria-label="${escapeHtml(c.label)}" aria-pressed="false">
            <i class="fa-solid ${c.icon}"></i>
        </button>`).join('');

    host.innerHTML = `
        <div class="rte">
            <div class="rte-toolbar" role="toolbar" aria-label="Text formatting">${buttons}</div>
            <div class="rte-body" contenteditable="true" role="textbox" aria-multiline="true"
                 aria-label="${escapeHtml(placeholder)}" data-placeholder="${escapeHtml(placeholder)}"></div>
        </div>`;

    const body = host.querySelector('.rte-body');
    const toolbar = host.querySelector('.rte-toolbar');

    // mousedown, not click: the default action of pressing a button is to move
    // focus out of the editable area, which collapses the selection the command
    // is meant to act on.
    toolbar.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('.rte-btn');
        if (!btn) return;
        e.preventDefault();
        // Only focus when the caret is not already in the box. Calling focus()
        // on a contenteditable that already holds the selection collapses it to
        // the start in Chrome, so the command then applies to nothing - a
        // selection made with the mouse and then bolded came out unformatted.
        const selection = window.getSelection();
        const alreadyInside = selection && selection.rangeCount > 0
            && body.contains(selection.anchorNode);
        if (!alreadyInside) body.focus();
        const cmd = btn.getAttribute('data-cmd');
        const value = btn.getAttribute('data-value');
        if (cmd === 'formatBlock') {
            // Second press on a heading takes it back to a paragraph, so the
            // button reads as a toggle rather than a one-way trip.
            const inHeading = /^h3$/i.test(document.queryCommandValue('formatBlock') || '');
            document.execCommand('formatBlock', false, inHeading ? 'p' : value);
        } else {
            document.execCommand(cmd, false, null);
        }
        reflectRichTextState(host);
    });

    // Paste arrives as plain text on purpose. A paste out of Word or a browser
    // carries fonts, colours and absolute sizes that have nothing to do with
    // this page and would be stripped on save anyway - taking the text now is
    // more honest than showing formatting that will not survive.
    body.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
    });

    ['keyup', 'mouseup', 'focus'].forEach(evt =>
        body.addEventListener(evt, () => reflectRichTextState(host)));

    return body;
}

// Lights the toolbar buttons that apply where the cursor is.
function reflectRichTextState(host) {
    const el = typeof host === 'string' ? document.getElementById(host) : host;
    if (!el) return;
    el.querySelectorAll('.rte-btn').forEach(btn => {
        const cmd = btn.getAttribute('data-cmd');
        let on = false;
        try {
            on = cmd === 'formatBlock'
                ? /^h3$/i.test(document.queryCommandValue('formatBlock') || '')
                : document.queryCommandState(cmd);
        } catch (e) { on = false; }
        btn.classList.toggle('rte-btn-active', !!on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

function richTextValue(target) {
    const host = typeof target === 'string' ? document.getElementById(target) : target;
    const body = host && host.querySelector('.rte-body');
    return body ? sanitizeRichHtml(body.innerHTML) : '';
}

function setRichTextValue(target, html) {
    const host = typeof target === 'string' ? document.getElementById(target) : target;
    const body = host && host.querySelector('.rte-body');
    if (body) body.innerHTML = sanitizeRichHtml(html || '');
}

function richTextIsEmpty(target) {
    return richTextToPlainText(richTextValue(target)).length === 0;
}

// ── SKELETON LOADING ───────────────────────────────
// Placeholder geometry to show while a section's first fetch is in flight,
// in place of a spinner. The measurements live in the SKELETON LOADING block
// of shared.css and are chosen so that swapping a placeholder for the real
// content changes no height - see the comment there.
//
// Every painter here refuses to overwrite anything real. That is not a nicety:
// the staff dashboards re-fetch their queue every five seconds, and a skeleton
// flashing over a list somebody is reading would be worse than the spinner it
// replaced.

const SKEL_MARK = 'data-skeleton';

// Ragged edges, but reproducible ones - a cycle rather than Math.random(), so
// the same table always renders the same placeholder.
const SKEL_WIDTHS = ['skel-w-70', 'skel-w-50', 'skel-w-80', 'skel-w-60'];

// Text a page ships in the markup as a stand-in for a number it has not
// fetched yet. Painting over one of these is safe; anything else is real data
// and must be left alone.
const SKEL_PLACEHOLDER = /^(--|-|0|0m|0%|₱0|₱0\.00)?$/;

function skeletonTarget(target) {
    return typeof target === 'string' ? document.getElementById(target) : target;
}

// Paintable means: holds nothing, or holds nothing but a previous skeleton.
function skeletonSafe(el) {
    if (!el) return false;
    const children = Array.from(el.children);
    if (children.length === 0) return el.textContent.trim() === '';
    return children.every(c => c.hasAttribute(SKEL_MARK));
}

// `replace` is for the few tables that ship a static stand-in row in the HTML
// ("No patients waiting in queue."), which is not real data but is not a
// skeleton either. Only a first-load caller may pass it.
function paintSkeleton(target, html, replace = false) {
    const el = skeletonTarget(target);
    if (!el) return false;
    if (!replace && !skeletonSafe(el)) return false;
    el.innerHTML = html;
    // The host is busy; its children are decorative. Without this a screen
    // reader would read out a table of empty cells as though it were data.
    el.setAttribute('aria-busy', 'true');
    return true;
}

// Placeholder rows for a real <table>. They are real <tr>/<td>, so they take
// the table's own cell padding and column widths and the columns do not jump
// when the data arrives.
//
// `cols` is a column count, or an array of shapes - one per column - where a
// shape is either a class string, or a list of class strings for a cell that
// holds more than one line. That second form matters more than it looks: most
// tables here have one column with a value and a <small> line under it, and
// that column alone sets the row height. Measured on the audit log: uniform
// one-line cells came out 23px short of every real row.
function skeletonTable(target, { rows = 5, cols = 5, replace = false } = {}) {
    const shapes = Array.isArray(cols) ? cols : null;
    const width = (r, c) => SKEL_WIDTHS[(r + c) % SKEL_WIDTHS.length];
    const bars = (shape) => (Array.isArray(shape) ? shape : [shape])
        .map(cls => `<span class="skel ${cls}"></span>`).join('');
    const html = Array.from({ length: rows }, (_, r) => {
        const count = shapes ? shapes.length : cols;
        const cells = Array.from({ length: count }, (_, c) =>
            `<td>${bars(shapes ? shapes[c] : 'skel-line ' + width(r, c))}</td>`).join('');
        return `<tr class="skel-row" ${SKEL_MARK} aria-hidden="true">${cells}</tr>`;
    }).join('');
    return paintSkeleton(target, html, replace);
}

// Placeholder cards for a grid. `cardClass` is the page's real card class, so
// the grid tracks, padding and border radius are the ones the content will use.
//
// `body` is the inside of one card, and the reason it is a parameter is worth
// stating: the accurate way to build one is to reuse the real card's own inner
// element classes (`<h3>`, `.pkg-card-footer`, and so on) with a `.skel` span
// inside each. `.skel-line` is sized in em, so it collapses to exactly one
// line box of whatever element contains it - the heights then come from the
// page's existing CSS instead of from numbers copied into this file, and they
// stay correct when that CSS changes. Guessing at generic bars instead cost
// 90px per card when this was measured against the real thing.
function skeletonCards(target, { count = 6, cardClass = 'pkg-card', body = null, replace = false } = {}) {
    const inner = body || `
            <span class="skel skel-title skel-w-70"></span>
            <span class="skel skel-pill skel-w-30"></span>
            <span class="skel skel-line skel-w-full"></span>
            <span class="skel skel-line skel-w-80"></span>
            <span class="skel skel-line skel-w-40 skel-spaced"></span>`;
    const card = `<div class="${cardClass} skel-card" ${SKEL_MARK} aria-hidden="true">${inner}</div>`;
    return paintSkeleton(target, card.repeat(count), replace);
}

// Placeholder stat cards, for a strip of figures the page builds from a fetch
// rather than shipping in the markup.
function skeletonStats(target, { count = 4, replace = false } = {}) {
    // .stat-label and .stat-value carry the font sizes that set this card's
    // height, so the placeholder lines sit inside them rather than beside them.
    const card = `
        <div class="stat-card skel-card" ${SKEL_MARK} aria-hidden="true">
            <span class="skel skel-icon"></span>
            <div class="stat-info">
                <div class="stat-label skel-box"><span class="skel skel-line skel-w-60"></span></div>
                <div class="stat-value"><span class="skel skel-value"></span></div>
            </div>
        </div>`;
    return paintSkeleton(target, card.repeat(count), replace);
}

// A stack of lines, for a panel that is neither a table nor a card grid -
// a distribution list, a timeline, a notes column. `avatar` adds the leading
// circle those lists usually start with.
function skeletonLines(target, { rows = 4, avatar = false, replace = false } = {}) {
    const row = `
        <div class="skel-stack-row">
            ${avatar ? '<span class="skel skel-circle skel-avatar"></span>' : ''}
            <span class="skel skel-line"></span>
            <span class="skel skel-line skel-w-20"></span>
        </div>`;
    return paintSkeleton(target,
        `<div class="skel-stack" ${SKEL_MARK} aria-hidden="true">${row.repeat(rows)}</div>`, replace);
}

// A single figure inside a .stat-value (or any element whose text is replaced
// wholesale). Accepts one id or several. The markup for these ships with "0"
// or "--" in place, which reads as real data until it is corrected a moment
// later; a placeholder is the more honest thing to show. `cls` swaps the
// placeholder shape - a name line wants a line, not a figure-sized block - and
// `replace` covers the elements whose markup ships a whole sentence ("No
// patient currently active"), which is an answer the page does not have yet.
function skeletonValue(targets, { cls = 'skel-value', replace = false } = {}) {
    (Array.isArray(targets) ? targets : [targets]).forEach(t => {
        const el = skeletonTarget(t);
        if (!el) return;
        if (!replace && !skeletonSafe(el) && !SKEL_PLACEHOLDER.test(el.textContent.trim())) return;
        el.innerHTML = `<span class="skel ${cls}" ${SKEL_MARK} aria-hidden="true"></span>`;
        el.setAttribute('aria-busy', 'true');
    });
}

// Drop the busy flag, and any placeholder the render did not overwrite - a
// failed fetch would otherwise leave the section shimmering for good.
function clearSkeleton(...targets) {
    targets.flat().forEach(t => {
        const el = skeletonTarget(t);
        if (!el) return;
        el.removeAttribute('aria-busy');
        Array.from(el.children)
            .filter(c => c.hasAttribute(SKEL_MARK))
            .forEach(c => c.remove());
    });
}

// True the first time it is asked about a section, false forever after. The
// station dashboards poll, and a figure that legitimately reads "0" would
// otherwise be treated as a placeholder and re-skeletoned every five seconds.
const skelLoaded = new Set();
function skeletonFirstLoad(key) {
    if (skelLoaded.has(key)) return false;
    skelLoaded.add(key);
    return true;
}

// ── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    applySiteSettings();
    enhancePasswordToggles();
    enforcePasswordPolicy();
    initAnnouncements();
    initIdleTimeout();
});
