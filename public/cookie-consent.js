// Cookie Consent Banner & Preferences Manager (Feature 5)
// Philippine Data Privacy Act of 2012 (RA 10173) Compliant
(function () {
    'use strict';

    const POLICY_VERSION = '1.0';
    const COOKIE_NAME = 'cookie_consent';
    const EXPIRY_DAYS = 365;

    function getCookie(name) {
        const matches = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[$()*+./?[\\\]^{|}-]/g, '\\$&') + '=([^;]*)'));
        return matches ? decodeURIComponent(matches[1]) : null;
    }

    function setCookie(name, val, days) {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${encodeURIComponent(val)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
    }

    function deleteCookie(name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Lax`;
    }

    function getConsent() {
        const raw = getCookie(COOKIE_NAME);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.version === POLICY_VERSION && parsed.categories) {
                return parsed;
            }
        } catch (_) {}
        return null;
    }

    function saveConsent(categories) {
        const record = {
            categories: {
                essential: true,
                preferences: !!categories.preferences,
                analytics: !!categories.analytics
            },
            version: POLICY_VERSION,
            timestamp: new Date().toISOString()
        };

        setCookie(COOKIE_NAME, JSON.stringify(record), EXPIRY_DAYS);

        // If analytics refused or withdrawn, clear common analytics trackers
        if (!record.categories.analytics) {
            ['_ga', '_gid', '_gat', '_ga_', '_pk_id', '_pk_ses'].forEach(prefix => {
                deleteCookie(prefix);
                // Also search for cookies starting with prefix
                document.cookie.split(';').forEach(c => {
                    const cName = c.split('=')[0].trim();
                    if (cName.startsWith(prefix)) deleteCookie(cName);
                });
            });
        }

        // Notify app
        try {
            document.dispatchEvent(new CustomEvent('consentUpdated', { detail: record.categories }));
        } catch (_) {}

        // Log consent asynchronously
        try {
            let anonId = getCookie('_rl_anon_consent');
            if (!anonId) {
                anonId = 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
                setCookie('_rl_anon_consent', anonId, EXPIRY_DAYS);
            }
            fetch('/api/consent-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    anonymous_id: anonId,
                    choice: record.categories,
                    policy_version: POLICY_VERSION
                })
            }).catch(() => {});
        } catch (_) {}

        closeBanner();
        closeCustomizeModal();
    }

    function closeBanner() {
        const banner = document.getElementById('cc-banner');
        if (banner) banner.remove();
    }

    function closeCustomizeModal() {
        const modal = document.getElementById('cc-modal-overlay');
        if (modal) modal.remove();
    }

    function showBanner() {
        if (document.getElementById('cc-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'cc-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Cookie consent notice');
        banner.setAttribute('aria-modal', 'true');
        banner.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #ffffff;
            color: #1f2937;
            padding: 16px 24px;
            box-shadow: 0 -4px 16px rgba(0,0,0,0.12);
            border-top: 3px solid #1a73e8;
            z-index: 999999;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 0.9rem;
        `;

        banner.innerHTML = `
            <div style="flex: 1 1 360px; line-height: 1.5;">
                <strong style="color: #111827; display: block; margin-bottom: 4px;">
                    <i class="fa-solid fa-cookie-bite" style="color: #f59e0b; margin-right: 6px;"></i> We respect your privacy &amp; data choices
                </strong>
                <span>
                    We use cookies to maintain secure sessions and keep our queue system running smoothly. You can choose to allow optional preference and analytics cookies.
                    Read our <a href="/cookie-policy.html" target="_blank" style="color: #1a73e8; text-decoration: underline; font-weight: 500;">Cookie Policy</a>.
                </span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                <button id="cc-btn-reject" style="background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: background 0.15s;">
                    Reject non-essential
                </button>
                <button id="cc-btn-customize" style="background: #ffffff; color: #1a73e8; border: 1px solid #1a73e8; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: background 0.15s;">
                    Customize
                </button>
                <button id="cc-btn-accept" style="background: #1a73e8; color: #ffffff; border: 1px solid #1a73e8; padding: 8px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: background 0.15s;">
                    Accept all
                </button>
            </div>
        `;

        document.body.appendChild(banner);

        document.getElementById('cc-btn-accept').onclick = function () {
            saveConsent({ essential: true, preferences: true, analytics: true });
        };
        document.getElementById('cc-btn-reject').onclick = function () {
            saveConsent({ essential: true, preferences: false, analytics: false });
        };
        document.getElementById('cc-btn-customize').onclick = function () {
            openCustomizeModal();
        };

        // Accessibility focus
        setTimeout(() => {
            const rejectBtn = document.getElementById('cc-btn-reject');
            if (rejectBtn) rejectBtn.focus();
        }, 100);
    }

    function openCustomizeModal() {
        closeCustomizeModal();

        const currentConsent = getConsent()?.categories || { essential: true, preferences: false, analytics: false };

        const overlay = document.createElement('div');
        overlay.id = 'cc-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Cookie Preferences');
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            z-index: 1000000;
            font-family: system-ui, -apple-system, sans-serif;
        `;

        overlay.innerHTML = `
            <div style="background: #ffffff; border-radius: 12px; max-width: 520px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.2); padding: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px;">
                    <h3 style="margin: 0; font-size: 1.25rem; color: #111827;">
                        <i class="fa-solid fa-sliders" style="color: #1a73e8; margin-right: 8px;"></i> Cookie Preferences
                    </h3>
                    <button id="cc-modal-close" style="background: none; border: none; font-size: 1.5rem; color: #6b7280; cursor: pointer; line-height: 1;">&times;</button>
                </div>

                <p style="font-size: 0.88rem; color: #4b5563; line-height: 1.5; margin-bottom: 20px;">
                    Customize which cookie categories you allow. Essential cookies cannot be disabled as they are required for security and core functionality.
                </p>

                <!-- Essential -->
                <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 12px; background: #f9fafb;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="color: #111827; font-size: 0.95rem;">Essential Cookies</strong>
                        <span style="font-size: 0.75rem; background: #e5e7eb; color: #374151; padding: 2px 8px; border-radius: 9999px; font-weight: 600;">Always Active</span>
                    </div>
                    <p style="margin: 6px 0 0; font-size: 0.82rem; color: #6b7280; line-height: 1.4;">
                        Authentication tokens, session integrity, CSRF defense, and critical patient queue state.
                    </p>
                </div>

                <!-- Preferences -->
                <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <label for="cc-toggle-pref" style="color: #111827; font-size: 0.95rem; font-weight: 600; cursor: pointer;">Preference Cookies</label>
                        <input type="checkbox" id="cc-toggle-pref" ${currentConsent.preferences ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                    </div>
                    <p style="margin: 6px 0 0; font-size: 0.82rem; color: #6b7280; line-height: 1.4;">
                        Remember visual display preferences like color themes and font density.
                    </p>
                </div>

                <!-- Analytics -->
                <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <label for="cc-toggle-analytics" style="color: #111827; font-size: 0.95rem; font-weight: 600; cursor: pointer;">Analytics Cookies</label>
                        <input type="checkbox" id="cc-toggle-analytics" ${currentConsent.analytics ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                    </div>
                    <p style="margin: 6px 0 0; font-size: 0.82rem; color: #6b7280; line-height: 1.4;">
                        Anonymized traffic metrics to evaluate and improve wait times and system responsiveness.
                    </p>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button id="cc-modal-cancel" style="background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer;">
                        Cancel
                    </button>
                    <button id="cc-modal-save" style="background: #1a73e8; color: #ffffff; border: 1px solid #1a73e8; padding: 8px 18px; border-radius: 6px; font-weight: 600; cursor: pointer;">
                        Save Preferences
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('cc-modal-close').onclick = closeCustomizeModal;
        document.getElementById('cc-modal-cancel').onclick = closeCustomizeModal;
        document.getElementById('cc-modal-save').onclick = function () {
            saveConsent({
                essential: true,
                preferences: document.getElementById('cc-toggle-pref').checked,
                analytics: document.getElementById('cc-toggle-analytics').checked
            });
        };
    }

    function init() {
        const consent = getConsent();
        if (!consent) {
            showBanner();
        }

        // Global opener so any footer link or button can trigger customize modal
        window.openCookieSettings = openCustomizeModal;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
