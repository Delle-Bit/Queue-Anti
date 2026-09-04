/* ================================================================
   MEDICAL CLINIC — Landing Page JavaScript (Redesign)
   ================================================================ */

'use strict';

// ── Auto-redirect if already logged in ──────────────────────────
(function checkExisting() {
    const token = localStorage.getItem('clinicToken');
    const role = localStorage.getItem('clinicRole');
    if (token && role) {
        const map = {
            customer: '/customer.html',
            frontdesk: '/frontdesk.html',
            laboratory: '/laboratory.html',
            admintechnical: '/admintechnical.html',
            admin: '/admintechnical.html',
            owner: '/owner.html',
            doctor: '/doctor.html'
        };
        if (map[role]) window.location.href = map[role];
    }
})();

// ── Service Data ─────────────────────────────────────────────────
const SERVICES_DATA = [
    {
        name: 'Hematology (CBC)',
        icon: 'fa-solid fa-droplet',
        preview: 'Complete blood count evaluation',
        description: 'A comprehensive hematologic examination that evaluates erythrocytes, leukocytes, hemoglobin, hematocrit, and platelet count for the detection of anemia, infection, inflammation, and hematologic disorders.'
    },
    {
        name: 'Clinical Microscopy',
        icon: 'fa-solid fa-microscope',
        preview: 'Microscopic analysis of body fluids',
        description: 'A diagnostic laboratory procedure involving microscopic and chemical analysis of urine, stool, and other body fluids to identify infections, renal disorders, and parasitic diseases.'
    },
    {
        name: 'Ultrasound',
        icon: 'fa-solid fa-wave-square',
        preview: 'Non-invasive internal organ imaging',
        description: 'A non-invasive diagnostic imaging modality utilizing high-frequency sound waves to visualize internal organs, soft tissues, and vascular structures for clinical assessment.'
    },
    {
        name: 'X-Ray',
        icon: 'fa-solid fa-x-ray',
        preview: 'Radiologic skeletal & organ imaging',
        description: 'A radiologic imaging procedure that uses ionizing radiation to evaluate skeletal structures, thoracic organs, and other anatomical regions for fractures, abnormalities, and pathologic conditions.'
    },
    {
        name: '2D Echocardiography',
        icon: 'fa-solid fa-heart-pulse',
        preview: 'Real-time cardiac chamber visualization',
        description: 'A specialized cardiac ultrasound examination that provides real-time visualization of cardiac chambers, valves, wall motion, and overall heart function.'
    },
    {
        name: 'Venous Duplex Scan',
        icon: 'fa-solid fa-timeline',
        preview: 'Venous blood flow assessment',
        description: 'A vascular ultrasonography procedure combining Doppler and B-mode imaging to assess venous blood flow and detect thrombosis, insufficiency, or venous obstruction.'
    },
    {
        name: 'Arterial Duplex Scan',
        icon: 'fa-solid fa-heart-circle-check',
        preview: 'Arterial circulation evaluation',
        description: 'A diagnostic vascular imaging study used to evaluate arterial circulation, identify stenosis or occlusions, and assess peripheral arterial disease.'
    },
    {
        name: 'Carotid Duplex Scan',
        icon: 'fa-solid fa-brain',
        preview: 'Carotid artery Doppler assessment',
        description: 'A non-invasive Doppler ultrasound examination of the carotid arteries to assess blood flow abnormalities, plaque formation, and cerebrovascular risk.'
    },
    {
        name: 'Holter Monitoring',
        icon: 'fa-solid fa-radio',
        preview: '24–48 hour cardiac ECG recording',
        description: 'A continuous ambulatory electrocardiographic recording performed over 24–48 hours to detect transient cardiac arrhythmias and conduction abnormalities.'
    },
    {
        name: '24-Hour Ambulatory BP Monitoring',
        icon: 'fa-solid fa-gauge-high',
        preview: 'Blood pressure over 24 hours',
        description: 'A diagnostic procedure involving automated blood pressure measurements over a 24-hour period to evaluate hypertension and cardiovascular risk profiles.'
    },
    {
        name: 'ECG / FCG',
        icon: 'fa-solid fa-heart',
        preview: 'Electrical cardiac activity recording',
        description: 'A cardiovascular diagnostic examination that records the electrical activity and functional cardiac performance for the assessment of arrhythmias, ischemia, and other cardiac conditions.'
    },
    {
        name: 'Blood Chemistry',
        icon: 'fa-solid fa-flask',
        preview: 'Metabolic & organ function tests',
        description: 'A series of biochemical laboratory tests used to evaluate metabolic function, electrolyte balance, renal function, hepatic function, and overall systemic health.'
    },
    {
        name: 'Serology Exam',
        icon: 'fa-solid fa-vial-virus',
        preview: 'Antibody and antigen detection',
        description: 'An immunologic laboratory test that detects antibodies, antigens, or immune responses in the blood for the diagnosis of infectious and autoimmune diseases.'
    },
    {
        name: 'Drug Testing',
        icon: 'fa-solid fa-cannabis',
        preview: 'Substance screening in specimens',
        description: 'A toxicologic screening procedure performed to detect the presence of prohibited, controlled, or illicit substances in biological specimens.'
    },
    {
        name: 'HIV Screening',
        icon: 'fa-solid fa-shield-virus',
        preview: 'HIV antibody & antigen detection',
        description: 'A serologic diagnostic test performed to detect Human Immunodeficiency Virus (HIV) antibodies and/or antigens for early identification and management.'
    },
    {
        name: 'Annual Physical Exam',
        icon: 'fa-solid fa-stethoscope',
        preview: 'Comprehensive preventive health check',
        description: 'A comprehensive preventive medical evaluation involving physical assessment, medical history review, and routine diagnostic screening to monitor general health status.'
    },
    {
        name: 'Pre-Employment Exam',
        icon: 'fa-solid fa-briefcase-medical',
        preview: 'Medical fitness for work assessment',
        description: 'A medical fitness assessment conducted to determine an applicant\'s physical and functional capability to safely perform occupational responsibilities.'
    }
];

// ── Page Loader ──────────────────────────────────────────────────
window.addEventListener('load', () => {
    setTimeout(() => {
        const loader = document.getElementById('page-loader');
        if (loader) loader.classList.add('hidden');
    }, 800);
});

// ── Hero Particles ───────────────────────────────────────────────
function createParticles() {
    const container = document.getElementById('hero-particles');
    if (!container) return;
    const count = window.innerWidth < 768 ? 18 : 35;
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 4 + 2;
        p.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            left: ${Math.random() * 100}%;
            animation-duration: ${Math.random() * 10 + 8}s;
            animation-delay: ${Math.random() * 10}s;
            opacity: ${Math.random() * 0.4 + 0.1};
        `;
        container.appendChild(p);
    }
}

createParticles();

// ── Sticky Navbar ────────────────────────────────────────────────
const navbar = document.getElementById('navbar');

function updateNavbar() {
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
}

updateNavbar();
window.addEventListener('scroll', updateNavbar, { passive: true });

// ── Active nav link on scroll ────────────────────────────────────
const sections = ['home', 'services', 'about'];
const navLinks = document.querySelectorAll('.nav-link[data-section]');

function updateActiveNav() {
    let current = 'home';
    const scrollY = window.scrollY + 120;

    for (const id of sections) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= scrollY) {
            current = id;
        }
    }

    navLinks.forEach(link => {
        link.classList.toggle('active', link.dataset.section === current);
    });
}

window.addEventListener('scroll', updateActiveNav, { passive: true });

// ── Body scroll lock ─────────────────────────────────────────────
// The mobile menu and the auth panel overlap: tapping Sign In inside the menu
// opens the panel and closes the menu, in that order. With a single boolean the
// menu's close would clear the lock the panel had just taken and the page would
// scroll behind the modal, so locks are tracked per owner and the body only
// unlocks once nothing holds it.
const scrollLockOwners = new Set();

function setScrollLock(owner, locked) {
    if (locked) scrollLockOwners.add(owner);
    else scrollLockOwners.delete(owner);
    document.body.style.overflow = scrollLockOwners.size ? 'hidden' : '';
}

// ── Mobile Hamburger ─────────────────────────────────────────────
const hamburgerBtn = document.getElementById('hamburger-btn');
const navLinksEl = document.getElementById('nav-links');
const mobileOverlay = document.getElementById('mobile-nav-overlay');

function toggleMobileMenu() {
    const isOpen = hamburgerBtn.classList.toggle('open');
    hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
    navLinksEl.classList.toggle('mobile-open', isOpen);
    mobileOverlay.classList.toggle('active', isOpen);
    setScrollLock('mobile-menu', isOpen);
}

function closeMobileMenu() {
    hamburgerBtn.classList.remove('open');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    navLinksEl.classList.remove('mobile-open');
    mobileOverlay.classList.remove('active');
    setScrollLock('mobile-menu', false);
}

hamburgerBtn.addEventListener('click', toggleMobileMenu);
mobileOverlay.addEventListener('click', closeMobileMenu);

navLinksEl.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', closeMobileMenu);
});

// The .mobile-open styling only exists below 768px, so a menu left open while
// the device rotates into landscape would strand a dimmed overlay and a locked
// page over the desktop nav.
window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && navLinksEl.classList.contains('mobile-open')) closeMobileMenu();
});

// ── Smooth Scroll for nav links ──────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            e.preventDefault();
            const offset = 80;
            const top = target.getBoundingClientRect().top + window.scrollY - offset;
            window.scrollTo({ top, behavior: 'smooth' });
        }
    });
});

// ── Services Gallery ─────────────────────────────────────────────
function renderServices() {
    const grid = document.getElementById('services-grid');
    if (!grid) return;

    grid.innerHTML = SERVICES_DATA.map((svc, index) => `
        <article class="svc-card reveal reveal-delay-${(index % 3) + 1}" 
                 role="listitem"
                 id="svc-card-${index}">
            <div class="svc-card-header" 
                 onclick="toggleService(${index})" 
                 role="button"
                 aria-expanded="false"
                 aria-controls="svc-body-${index}"
                 tabindex="0"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleService(${index})}">
                <div class="svc-icon-wrap">
                    <i class="${svc.icon}" aria-hidden="true"></i>
                </div>
                <div class="svc-card-info">
                    <p class="svc-card-title">${svc.name}</p>
                    <p class="svc-card-preview">${svc.preview}</p>
                </div>
                <div class="svc-card-chevron" aria-hidden="true">
                    <i class="fa-solid fa-chevron-down"></i>
                </div>
            </div>
            <div class="svc-card-body" id="svc-body-${index}" role="region" aria-label="${svc.name} description">
                <p class="svc-card-desc">${svc.description}</p>
            </div>
        </article>
    `).join('');

    // Trigger reveal on existing cards
    observeReveal();
}

let currentOpen = null;

function toggleService(index) {
    const card = document.getElementById(`svc-card-${index}`);
    const header = card.querySelector('.svc-card-header');

    if (currentOpen !== null && currentOpen !== index) {
        const prevCard = document.getElementById(`svc-card-${currentOpen}`);
        if (prevCard) {
            prevCard.classList.remove('open');
            prevCard.querySelector('.svc-card-header').setAttribute('aria-expanded', 'false');
        }
    }

    const isOpen = card.classList.toggle('open');
    header.setAttribute('aria-expanded', String(isOpen));
    currentOpen = isOpen ? index : null;
}

renderServices();

// ── Scroll Reveal ────────────────────────────────────────────────
function observeReveal() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// Apply reveal to static elements
document.querySelectorAll('.section-header, .about-visual, .about-content, .about-feature').forEach((el, i) => {
    el.classList.add('reveal');
    if (i > 0) el.classList.add(`reveal-delay-${Math.min(i, 3)}`);
});

observeReveal();

// ── AUTH PANEL ───────────────────────────────────────────────────
const authOverlay = document.getElementById('auth-overlay');

function openAuthPanel(tab = 'login') {
    authOverlay.classList.add('active');
    setScrollLock('auth-panel', true);
    switchAuthTab(tab);
    // Focus trap
    setTimeout(() => {
        const focusable = authOverlay.querySelectorAll('input, button, [tabindex]');
        if (focusable.length) focusable[0].focus();
    }, 420);
}

function closeAuthPanel() {
    abandonPendingRegistration();
    authOverlay.classList.remove('active');
    setScrollLock('auth-panel', false);
}

// Voids an in-progress registration token server-side the moment the modal is
// closed/dismissed, instead of leaving the pending_registrations row (and any
// uploaded ID images) to expire naturally up to 24h later. sendBeacon so it
// still fires reliably on tab-close, not just explicit close-button clicks.
function abandonPendingRegistration() {
    if (!registrationState.token) return;
    const payload = new Blob([JSON.stringify({ token: registrationState.token })], { type: 'application/json' });
    navigator.sendBeacon('/api/auth/register/abandon', payload);
    registrationState.token = null;
}

window.addEventListener('pagehide', abandonPendingRegistration);

// Close on overlay backdrop click
authOverlay.addEventListener('click', function (e) {
    if (e.target === authOverlay) closeAuthPanel();
});

// Close on Escape
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (authOverlay.classList.contains('active')) closeAuthPanel();
        else if (navLinksEl.classList.contains('mobile-open')) closeMobileMenu();
    }
});

function switchAuthTab(tab) {
    document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('form-login-otp').style.display = 'none';
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    if (tab === 'register') {
        // Reset to step 1
        showRegStep(1);
        usernameManuallyEdited = false;
        fullNameManuallyEdited = false;
        // Ensure forms are reset
        document.getElementById('reg-step1-form').reset();
    syncTermsGate();
        syncNoMiddleGate();            // reset() restores the checkbox but not the disabled state it drove
        syncNoMiddleGate('reg-guardian');
        document.getElementById('reg-step2-form').reset();
        document.getElementById('reg-step3-form').reset();
        document.getElementById('preview-front').innerHTML = '<i class="fa-solid fa-address-card"></i>';
        document.getElementById('preview-back').innerHTML = '<i class="fa-solid fa-address-card"></i>';
        registrationState.blobs = { front: null, back: null, guardian: null };
        registrationState.guardianScan = null;
        setGuardianIdStatus(GUARDIAN_ID_HINT, 'muted');
        setVerificationMethod('id');
    }
}

// ── Register: the name, in three fields ────────────────────────────
// The form asks for first name, middle initial and last name, because that is
// what a Philippine clinic form asks for and what an ID prints. The server and
// `users.full_name` still take one string, so the three are composed here -
// one field on the wire means nothing downstream (the username suggester, the
// PDF letterhead, every screen that prints a patient's name) has to change.
// Both the customer's name and the guardian's name are asked for in three
// fields, so every helper takes the id prefix: 'reg' for the customer,
// 'reg-guardian' for the guardian.
function regNamePart(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function regMiddleInitial(prefix = 'reg') {
    const box = document.getElementById(`${prefix}-no-middle`);
    if (box && box.checked) return '';
    // One letter, uppercased; the field is maxlength=1 but a paste can still
    // put punctuation in it.
    return regNamePart(`${prefix}-middleinitial`).replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 1);
}

function regFullName(prefix = 'reg') {
    const mi = regMiddleInitial(prefix);
    return [regNamePart(`${prefix}-firstname`), mi ? mi + '.' : '', regNamePart(`${prefix}-lastname`)]
        .filter(Boolean).join(' ');
}

// The same three-field rule, for either name: both ends required, and the
// middle initial either given or explicitly disclaimed.
function regNameProblem(prefix, label) {
    if (!regNamePart(`${prefix}-firstname`) || !regNamePart(`${prefix}-lastname`)) {
        return `${label} first name and last name are required.`;
    }
    const box = document.getElementById(`${prefix}-no-middle`);
    if (!regMiddleInitial(prefix) && !(box && box.checked)) {
        return `Enter ${label.toLowerCase()} middle initial, or tick "No middle initial".`;
    }
    return null;
}

// ── Guardian ID check, client side ─────────────────────────────────
// A mirror of guardianNameMatches in routes/auth.js. The server is the
// boundary and re-runs this on submit; this copy exists so a wrong ID is
// caught when it is attached rather than after Continue, which is a long way
// to walk to be told the photo was of the wrong person.
function nameTokens(value) {
    return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase().replace(/[^A-Z\s]/g, ' ')
        .split(/\s+/).filter(t => t.length > 1);
}

function guardianNameMatches(typedName, scannedName) {
    const typed = nameTokens(typedName);
    const scanned = new Set(nameTokens(scannedName));
    if (typed.length === 0 || scanned.size === 0) return false;
    return [typed[0], typed[typed.length - 1]].every(t => scanned.has(t));
}

const GUARDIAN_ID_HINT = 'The name on this ID must match the guardian name above.';

function setGuardianIdStatus(text, state) {
    const el = document.getElementById('reg-guardian-id-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('reg-check-ok', state === 'ok');
    el.classList.toggle('reg-check-bad', state === 'bad');
    el.classList.toggle('text-muted', state !== 'ok' && state !== 'bad');
}

// Re-renders the verdict from whatever the last scan said. Called after a scan
// and again whenever the guardian's name is edited, so correcting a typo in the
// name clears the rejection without re-uploading the photo.
function refreshGuardianVerdict() {
    const scan = registrationState.guardianScan;
    if (!scan) { setGuardianIdStatus(GUARDIAN_ID_HINT, 'muted'); return; }
    if (!scan.name) {
        setGuardianIdStatus('\u2717 This ID could not be read. Retake it in better light, with the whole card in frame.', 'bad');
        return;
    }
    const typed = regFullName('reg-guardian');
    scan.matches = guardianNameMatches(typed, scan.name);
    setGuardianIdStatus(scan.matches
        ? `\u2713 Matches the ID, which reads "${scan.name}".`
        : `\u2717 This ID reads "${scan.name}", which is not the guardian name entered above.`,
        scan.matches ? 'ok' : 'bad');
}

async function checkGuardianId(blob) {
    registrationState.guardianScan = null;
    setGuardianIdStatus('Checking the ID against the guardian name\u2026', 'muted');
    try {
        const formData = new FormData();
        formData.append('idImage', blob, 'guardian-id.jpg');
        const res = await fetch('/api/auth/ocr', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error('scan failed');
        // A readable card with no name is still a verdict: nothing to match.
        registrationState.guardianScan = { name: (data.name || '').trim(), matches: false };
        refreshGuardianVerdict();
    } catch (err) {
        // The check could not run - not the same as a card that failed it. Left
        // unset so nothing is blocked here; the server checks it on submit.
        registrationState.guardianScan = null;
        setGuardianIdStatus('Could not check the ID here. It will be checked when you continue.', 'muted');
    }
}

// Splits a scanned name across the three fields. Prefill only - the patient
// sees the result and can correct it before submitting.
//
// ponytail: last token is the surname. A compound Filipino surname ("Delos
// Reyes", "San Juan") lands its first word in the middle initial instead. Fix
// by asking the OCR for the parts separately if that turns out to matter; the
// patient can already correct it on screen.
function splitScannedName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
    if (parts.length === 2) return { first: parts[0], last: parts[1], middle: '' };
    return { first: parts[0], last: parts[parts.length - 1], middle: parts[1].charAt(0) };
}

// The checkbox and the initial box are one control: ticking "no middle initial"
// clears the box and disables it, so the form cannot carry both claims at once.
function syncNoMiddleGate(prefix = 'reg') {
    const box = document.getElementById(`${prefix}-no-middle`);
    const mi = document.getElementById(`${prefix}-middleinitial`);
    if (!box || !mi) return;
    mi.disabled = box.checked;
    if (box.checked) mi.value = '';
}

// ── Register State ─────────────────────────────────────────────────
let usernameManuallyEdited = false;
let fullNameManuallyEdited = false;
let registrationState = {
    step: 1,
    token: null,
    verificationMethod: 'id',
    blobs: { front: null, back: null },
    ocrResult: null,
    otpCountdown: null
};

// ── Password Strength ───────────────────────────────────────────────
function checkPasswordStrength(password) {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    const levels = ['', 'weak', 'fair', 'good', 'strong'];
    return { score, level: levels[Math.min(score, 4)] };
}

function updatePasswordStrengthUI(password) {
    const fill = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');
    const strengthDiv = document.getElementById('password-strength');
    if (!password) {
        strengthDiv.style.display = 'none';
        return;
    }
    strengthDiv.style.display = 'block';
    const { score, level } = checkPasswordStrength(password);
    fill.className = 'strength-fill ' + level;
    const labels = { weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong' };
    text.textContent = labels[level] || '';
}

function checkPasswordMatch() {
    const pwd = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm-password').value;
    const hint = document.getElementById('password-match-hint');
    if (!confirm) {
        hint.textContent = '';
        hint.classList.remove('mismatch');
        return true;
    }
    if (pwd === confirm) {
        hint.textContent = '✓ Passwords match';
        hint.classList.remove('mismatch');
        return true;
    } else {
        hint.textContent = '✗ Passwords do not match';
        hint.classList.add('mismatch');
        return false;
    }
}

// ── Registration Wizard Navigation ──────────────────────────────────
function showRegStep(step) {
    registrationState.step = step;
    // Hide all step forms
    document.querySelectorAll('.reg-step-form').forEach(f => f.style.display = 'none');
    // Show target step
    const targetForm = document.getElementById(`reg-step${step}-form`);
    if (targetForm) targetForm.style.display = 'block';
    
    // Update progress indicator
    document.querySelectorAll('.reg-progress-step').forEach((el, i) => {
        const s = i + 1;
        el.classList.toggle('active', s === step);
        el.classList.toggle('completed', s < step);
    });
    
    // Update step title
    const titles = {
        1: 'Step 1 of 4: Account Details',
        2: 'Step 2 of 4: Create Password',
        3: 'Step 3 of 4: Verify Email',
        4: 'Step 4 of 4: Complete'
    };
    document.getElementById('reg-step-title').textContent = titles[step] || 'Create Account';
    
    // Clear errors/success
    document.getElementById('reg-error').classList.remove('show');
    document.getElementById('reg-success').classList.remove('show');
}

function goToStep(step) {
    // Validate current step before moving forward
    if (step > registrationState.step) {
        if (!validateCurrentStep()) return;
    }
    showRegStep(step);
}

// Keeps the step 1 Continue button in step with the consent box, so an
// unticked box reads as "you cannot proceed yet" rather than as a button that
// fails when pressed. Re-applied after the form is reset, which unticks it.
function syncTermsGate() {
    const box = document.getElementById('reg-terms-accept');
    const next = document.getElementById('reg-step1-next');
    if (!box || !next) return;
    next.disabled = !box.checked;
    next.classList.toggle('btn-disabled', !box.checked);
    if (box.checked) {
        const hint = document.getElementById('reg-terms-hint');
        if (hint) hint.textContent = '';
    }
}

function validateCurrentStep() {
    const step = registrationState.step;
    const errEl = document.getElementById('reg-error');
    
    if (step === 1) {
        const username = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        // An empty initial and "I have no middle name" are different answers,
        // and the desk cannot tell them apart later, so one of them has to be
        // stated here.
        const nameProblem = regNameProblem('reg', 'Your');
        if (nameProblem) {
            errEl.textContent = nameProblem;
            errEl.classList.add('show');
            return false;
        }
        if (!username || !email) {
            errEl.textContent = 'Username and email are required.';
            errEl.classList.add('show');
            return false;
        }
        if (registrationState.verificationMethod === 'id' && (!registrationState.blobs.front || !registrationState.blobs.back)) {
            errEl.textContent = 'Both Front and Back ID images are required.';
            errEl.classList.add('show');
            return false;
        }
        if (registrationState.verificationMethod === 'guardian') {
            const guardianProblem = regNameProblem('reg-guardian', "Guardian's");
            if (guardianProblem) {
                errEl.textContent = guardianProblem;
                errEl.classList.add('show');
                return false;
            }
            // The photo is what the server checks the typed name against, so
            // there is nothing to verify without it.
            if (!registrationState.blobs.guardian) {
                errEl.textContent = "A photo of the guardian's valid ID is required.";
                errEl.classList.add('show');
                return false;
            }
            // Only a verdict this browser actually reached blocks here. A check
            // that could not run leaves guardianScan null and the submit goes
            // ahead, because the server is the one that decides.
            const scan = registrationState.guardianScan;
            if (scan && !scan.matches) {
                errEl.textContent = scan.name
                    ? `The guardian's ID reads "${scan.name}", which is not the guardian name entered. Use the guardian's own ID, or correct the name.`
                    : "The guardian's ID could not be read. Please retake the photo in better light, with the whole card in frame.";
                errEl.classList.add('show');
                return false;
            }
            const missing = ['reg-guardian-contact', 'reg-guardian-relationship']
                .some(id => !document.getElementById(id).value.trim());
            if (missing) {
                errEl.textContent = 'Guardian contact and relationship are required.';
                errEl.classList.add('show');
                return false;
            }
        }
        // Consent before anything is submitted. The Continue button is disabled
        // until the box is ticked (syncTermsGate), so this is the backstop for a
        // form submitted by keyboard or with the button re-enabled by hand.
        const termsHint = document.getElementById('reg-terms-hint');
        if (termsHint) termsHint.textContent = '';
        if (!document.getElementById('reg-terms-accept').checked) {
            if (termsHint) termsHint.textContent = 'You must agree to the Terms and Conditions to continue.';
            errEl.textContent = 'You must agree to the Terms and Conditions to continue.';
            errEl.classList.add('show');
            return false;
        }
        // Submit step 1
        submitStep1();
        return false; // Wait for async response
    }
    
    if (step === 2) {
        const pwd = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-confirm-password').value;
        if (!pwd || !confirm) {
            errEl.textContent = 'Both password fields are required.';
            errEl.classList.add('show');
            return false;
        }
        if (pwd !== confirm) {
            errEl.textContent = 'Passwords do not match.';
            errEl.classList.add('show');
            return false;
        }
        if (pwd.length < 8) {
            errEl.textContent = 'Password must be at least 8 characters.';
            errEl.classList.add('show');
            return false;
        }
        // Submit step 2
        submitStep2(pwd);
        return false;
    }
    
    if (step === 3) {
        // The terms were agreed to in step 1 - there is no way to reach this
        // step without it - so the only thing left to check here is the code.
        const otp = document.getElementById('reg-otp').value.trim();
        if (!otp || otp.length !== 6) {
            errEl.textContent = 'Enter the 6-digit verification code.';
            errEl.classList.add('show');
            return false;
        }
        // Submit step 3
        submitStep3(otp);
        return false;
    }
    
    return true;
}

// ── Step 1: Account Details + ID Upload ─────────────────────────────
async function submitStep1() {
    const errEl = document.getElementById('reg-error');
    const sucEl = document.getElementById('reg-success');
    const btn = document.getElementById('reg-step1-next');
    
    errEl.classList.remove('show');
    sucEl.classList.remove('show');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    
    const formData = new FormData();
    formData.append('username', document.getElementById('reg-username').value.trim());
    formData.append('full_name', regFullName());
    formData.append('email', document.getElementById('reg-email').value.trim());
    formData.append('verification_method', registrationState.verificationMethod);
    
    if (registrationState.verificationMethod === 'id') {
        formData.append('frontId', registrationState.blobs.front, 'front-id.jpg');
        formData.append('backId', registrationState.blobs.back, 'back-id.jpg');
    } else {
        formData.append('guardian_name', regFullName('reg-guardian'));
        formData.append('guardian_contact', document.getElementById('reg-guardian-contact').value.trim());
        formData.append('guardian_relationship', document.getElementById('reg-guardian-relationship').value.trim());
        formData.append('guardianId', registrationState.blobs.guardian, 'guardian-id.jpg');
    }
    
    try {
        const res = await fetch('/api/auth/register/step1', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok && data.success) {
            registrationState.token = data.token;
            registrationState.ocrResult = { category: data.category, detectedName: data.detectedName };
            sucEl.textContent = data.message;
            sucEl.classList.add('show');
            // Auto-advance after short delay. showRegStep (not goToStep) — this already
            // succeeded, so re-running validateCurrentStep() here would resubmit step 1
            // again since registrationState.step hasn't advanced yet, looping until the
            // rate limiter blocks it.
            setTimeout(() => showRegStep(2), 1500);
        } else {
            errEl.textContent = data.error || 'Registration failed';
            errEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Continue';
}

// ── Step 2: Password Creation ──────────────────────────────────────
async function submitStep2(password) {
    const errEl = document.getElementById('reg-error');
    const sucEl = document.getElementById('reg-success');
    const btn = document.getElementById('reg-step2-next');
    
    errEl.classList.remove('show');
    sucEl.classList.remove('show');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    
    try {
        const res = await fetch('/api/auth/register/step2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: registrationState.token, password, confirm_password: password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            sucEl.textContent = data.message;
            sucEl.classList.add('show');
            // Step 3's UI claims a code was already sent, so it actually needs to be —
            // nothing else in this flow ever calls send-verification automatically.
            setTimeout(() => { showRegStep(3); sendOTP(); }, 1500);
        } else {
            errEl.textContent = data.error || 'Failed to set password';
            errEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Continue';
}

// ── Step 3: OTP Verification ────────────────────────────────────────
async function sendOTP() {
    const errEl = document.getElementById('reg-error');
    const btn = document.getElementById('reg-resend-otp');
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    
    try {
        const res = await fetch('/api/auth/register/send-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: registrationState.token })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            // startOTPCountdown() owns the button's disabled state and label from here
            // until the cooldown ends — falling through below would immediately replace
            // its <span id="otp-countdown"> with a fresh detached one, orphaning the
            // running interval (it'd keep ticking against a span no longer on screen)
            // and re-enable Resend right away, defeating the cooldown entirely.
            startOTPCountdown();
            return;
        }
        errEl.textContent = data.error || 'Failed to send code';
        errEl.classList.add('show');
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Resend Code (<span id="otp-countdown">00:00</span>)';
}

function startOTPCountdown() {
    const countdownEl = document.getElementById('otp-countdown');
    const btn = document.getElementById('reg-resend-otp');
    let seconds = 60;
    btn.disabled = true;
    countdownEl.textContent = formatTime(seconds);
    if (registrationState.otpCountdown) clearInterval(registrationState.otpCountdown);
    registrationState.otpCountdown = setInterval(() => {
        seconds--;
        countdownEl.textContent = formatTime(seconds);
        if (seconds <= 0) {
            clearInterval(registrationState.otpCountdown);
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Resend Code';
        }
    }, 1000);
}

function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

async function submitStep3(otp) {
    const errEl = document.getElementById('reg-error');
    const sucEl = document.getElementById('reg-success');
    const btn = document.getElementById('reg-step3-verify');
    
    errEl.classList.remove('show');
    sucEl.classList.remove('show');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';
    
    try {
        const res = await fetch('/api/auth/register/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: registrationState.token, otp, terms_accepted: document.getElementById('reg-terms-accept').checked })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            sucEl.textContent = data.message;
            sucEl.classList.add('show');
            // Show success step
            document.getElementById('reg-success-message').innerHTML = `Your account has been created!<br>Category: <strong>${data.category}</strong>`;
            registrationState.token = null; // already consumed server-side; don't let a later modal-close try to abandon it
            showRegStep(4);
        } else {
            errEl.textContent = data.error || 'Verification failed';
            errEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Verify & Create Account';
}

async function resendOTP() {
    await sendOTP();
}

// ── Step 4: Complete ────────────────────────────────────────────────
function finishRegistration() {
    closeAuthPanel();
    switchAuthTab('login');
    // Reset registration state
    registrationState = {
        step: 1,
        token: null,
        verificationMethod: 'id',
        blobs: { front: null, back: null },
        ocrResult: null,
        otpCountdown: null
    };
    // Reset forms
    document.getElementById('reg-step1-form').reset();
    syncTermsGate();
    document.getElementById('reg-step2-form').reset();
    document.getElementById('reg-step3-form').reset();
    document.getElementById('preview-front').innerHTML = '<i class="fa-solid fa-address-card"></i>';
    document.getElementById('preview-back').innerHTML = '<i class="fa-solid fa-address-card"></i>';
    registrationState.blobs = { front: null, back: null };
    setVerificationMethod('id');
}

// Override the original setVerificationMethod to update state
function setVerificationMethod(method) {
    registrationState.verificationMethod = method;
    document.getElementById('reg-verification-method').value = method;
    document.getElementById('verify-id-btn').classList.toggle('active', method === 'id');
    document.getElementById('verify-guardian-btn').classList.toggle('active', method === 'guardian');
    document.getElementById('id-verification-section').style.display = method === 'id' ? 'block' : 'none';
    document.getElementById('guardian-verification-section').style.display = method === 'guardian' ? 'block' : 'none';
}

// ── ID Camera ────────────────────────────────────────────────────
let regCameraStream = null;
let currentSide = 'front';

function startIdAction(side, type) {
    currentSide = side;
    if (type === 'camera') {
        openRegCamera();
    } else {
        document.getElementById(`upload-${side}`).click();
    }
}

function handleFileUpload(e, side) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const preview = document.getElementById(`preview-${side}`);
        preview.innerHTML = `<img src="${event.target.result}" alt="${side} id">`;
    };
    reader.readAsDataURL(file);
    registrationState.blobs[side] = file;
    runIdOcrPreview(file, side);
}

// Runs OCR on the front ID as soon as it's attached (upload or camera capture)
// and prefills Full Name from it — previously the backend only OCR'd the ID
// during the full step-1 submit, by which point the user had already had to
// type their name manually to get that far, so nothing was ever actually
// prefilled. /api/auth/ocr exists specifically for this early-preview use.
async function runIdOcrPreview(blob, side) {
    // The guardian's photo is checked against the typed guardian name instead
    // of prefilling anything.
    if (side === 'guardian') return checkGuardianId(blob);
    if (side !== 'front') return; // only the front ID carries name/category info anywhere else in the app
    const status = document.getElementById('reg-camera-status');
    if (status) status.textContent = 'Scanning ID...';
    try {
        const formData = new FormData();
        formData.append('idImage', blob, 'front-id.jpg');
        const res = await fetch('/api/auth/ocr', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok || !data.success) {
            // The images are attached - the scan itself failed (the server is
            // down, every reader is out of quota, the request timed out). Naming
            // the provider or the status code here would put a quota message in
            // front of a patient, which is the front desk's problem and not
            // theirs; "images are required" was worse still, sending them to
            // look for a file they had already attached.
            if (status) status.textContent = 'Could not scan the ID right now — please type your details in.';
            return;
        }
        registrationState.ocrResult = data;
        const scanned = data.name && !fullNameManuallyEdited ? splitScannedName(data.name) : null;
        if (scanned) {
            document.getElementById('reg-firstname').value = scanned.first || '';
            document.getElementById('reg-lastname').value = scanned.last || '';
            // The checkbox is deliberately left alone. A card that prints no
            // middle name is not proof the patient has none - only they can say
            // that, and validation makes them.
            const mi = document.getElementById('reg-middleinitial');
            if (scanned.middle && !mi.disabled) mi.value = scanned.middle;
            document.getElementById('reg-firstname').dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (status) {
            // id_read false means every reader was tried and none could make
            // the card out. The server no longer invents a name and a category
            // to fill that gap, so the honest thing is to ask for the details
            // and to say the ID itself is still fine to submit.
            //
            // It does not promise the front desk will confirm anything: there
            // is no approval step - verify-otp creates the account outright,
            // filed as Regular - and correcting a category is an administrator
            // action in Manage Accounts, which the front desk cannot perform.
            if (!data.id_read) {
                status.textContent = 'Could not read the ID — please type your details in. You can still continue.';
                return;
            }
            const parts = [];
            if (data.name) parts.push(data.name);
            if (data.category && data.category !== 'Regular') parts.push(data.category);
            status.textContent = parts.length ? `Detected: ${parts.join(' — ')}` : 'ID scanned — no details detected';
        }
    } catch (err) {
        // Network error, same reasoning as the non-ok branch above.
        if (status) status.textContent = 'Could not scan the ID right now — please type your details in.';
    }
}

async function openRegCamera() {
    const video = document.getElementById('reg-camera-stream');
    const overlay = document.getElementById('reg-camera-overlay');
    const status = document.getElementById('reg-camera-status');
    if (regCameraStream) stopRegCamera();
    try {
        overlay.style.display = 'block';
        status.textContent = `Capturing ${currentSide.toUpperCase()} ID...`;
        regCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = regCameraStream;
        video.play();
    } catch (err) {
        status.textContent = 'Camera access denied';
        console.error(err);
    }
}

function stopRegCamera() {
    if (regCameraStream) {
        regCameraStream.getTracks().forEach(track => track.stop());
        regCameraStream = null;
    }
    const overlay = document.getElementById('reg-camera-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function captureRegID() {
    const video = document.getElementById('reg-camera-stream');
    const canvas = document.getElementById('reg-capture-canvas');
    const status = document.getElementById('reg-camera-status');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
        registrationState.blobs[currentSide] = blob;
        const preview = document.getElementById(`preview-${currentSide}`);
        const dataUrl = canvas.toDataURL('image/jpeg');
        preview.innerHTML = `<img src="${dataUrl}" alt="${currentSide} id">`;
        // The guardian capture has its own hint line; the ID section's status
        // element is hidden while the guardian path is showing, so writing the
        // confirmation there would say it to nobody.
        const target = currentSide === 'guardian'
            ? (document.getElementById('reg-guardian-id-status') || status)
            : status;
        // For the guardian, the check that runs next owns this line, so it is
        // not overwritten with a confirmation that says nothing about the
        // thing actually being verified.
        if (currentSide !== 'guardian') target.textContent = `${currentSide.toUpperCase()} captured ✓`;
        stopRegCamera();
        runIdOcrPreview(blob, currentSide);
    }, 'image/jpeg', 0.9);
}

// ── Login ────────────────────────────────────────────────────────
function completeLogin(data) {
    localStorage.setItem('clinicToken', data.token);
    localStorage.setItem('clinicRole', data.role);
    localStorage.setItem('clinicUsername', data.username);
    localStorage.setItem('clinicCategory', data.category || 'Regular');
    window.location.href = data.redirect;
}

async function handleLogin(e) {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.classList.remove('show');
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';

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
        if (res.ok && data.success && data.otp_required) {
            showLoginOTPStep(data);
        } else if (res.ok && data.success) {
            completeLogin(data);
        } else {
            errEl.textContent = data.error || 'Login failed';
            errEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
}

// ── Login OTP (second factor for customer sign-in) ─────────────────
let loginOtpState = { challengeToken: null, countdown: null };

function showLoginOTPStep(data) {
    loginOtpState.challengeToken = data.challenge_token;
    document.getElementById('login-otp-email').textContent = data.email_hint || 'your email';
    document.getElementById('login-otp-error').classList.remove('show');
    document.getElementById('login-otp').value = '';
    document.getElementById('form-login').style.display = 'none';
    document.getElementById('form-register').style.display = 'none';
    document.getElementById('form-login-otp').style.display = 'block';
    startLoginOTPCountdown();
}

function cancelLoginOTP() {
    loginOtpState.challengeToken = null;
    if (loginOtpState.countdown) clearInterval(loginOtpState.countdown);
    switchAuthTab('login');
}

function startLoginOTPCountdown() {
    const countdownEl = document.getElementById('login-otp-countdown');
    const btn = document.getElementById('login-otp-resend');
    let seconds = 60;
    btn.disabled = true;
    countdownEl.textContent = formatTime(seconds);
    if (loginOtpState.countdown) clearInterval(loginOtpState.countdown);
    loginOtpState.countdown = setInterval(() => {
        seconds--;
        countdownEl.textContent = formatTime(seconds);
        if (seconds <= 0) {
            clearInterval(loginOtpState.countdown);
            btn.disabled = false;
        }
    }, 1000);
}

async function resendLoginOTP() {
    const errEl = document.getElementById('login-otp-error');
    const btn = document.getElementById('login-otp-resend');
    errEl.classList.remove('show');
    try {
        const res = await fetch('/api/auth/login/resend-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challenge_token: loginOtpState.challengeToken })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            startLoginOTPCountdown();
        } else {
            errEl.textContent = data.error || 'Failed to resend code';
            errEl.classList.add('show');
            btn.disabled = false;
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
}

async function submitLoginOTP(e) {
    e.preventDefault();
    const errEl = document.getElementById('login-otp-error');
    errEl.classList.remove('show');
    const btn = document.getElementById('login-otp-submit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

    try {
        const res = await fetch('/api/auth/login/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                challenge_token: loginOtpState.challengeToken,
                otp: document.getElementById('login-otp').value
            })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            if (loginOtpState.countdown) clearInterval(loginOtpState.countdown);
            completeLogin(data);
            return;
        } else {
            errEl.textContent = data.error || 'Verification failed';
            errEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Verify & Sign In';
}

// ── Register Form Handlers ──────────────────────────────────────────
function setupRegisterHandlers() {
    // Step 1 form
    document.getElementById('reg-step1-form').addEventListener('submit', (e) => {
        e.preventDefault();
        validateCurrentStep(); // This will call submitStep1 if valid
    });

    const termsBox = document.getElementById('reg-terms-accept');
    if (termsBox) termsBox.addEventListener('change', syncTermsGate);
    syncTermsGate();
    
    // Step 2 form
    document.getElementById('reg-step2-form').addEventListener('submit', (e) => {
        e.preventDefault();
        validateCurrentStep(); // This will call submitStep2 if valid
    });
    
    // Step 3 form
    document.getElementById('reg-step3-form').addEventListener('submit', (e) => {
        e.preventDefault();
        validateCurrentStep(); // This will call submitStep3 if valid
    });
    
    // Password strength and match checking
    document.getElementById('reg-password').addEventListener('input', (e) => {
        updatePasswordStrengthUI(e.target.value);
        checkPasswordMatch();
    });
    document.getElementById('reg-confirm-password').addEventListener('input', checkPasswordMatch);

    // Auto-suggest a username from the full name field, unless the user has
    // typed into the username field themselves (then leave their edit alone).
    const usernameField = document.getElementById('reg-username');
    usernameField.addEventListener('input', () => { usernameManuallyEdited = true; });

    // keydown (not input) so the OCR prefill below — which sets .value and
    // dispatches a synthetic 'input' event to trigger the suggestion below —
    // doesn't itself get mistaken for the user having typed their own name.
    const nameFields = ['reg-firstname', 'reg-middleinitial', 'reg-lastname']
        .map(id => document.getElementById(id)).filter(Boolean);
    nameFields.forEach(f => f.addEventListener('keydown', () => { fullNameManuallyEdited = true; }));

    const guardianNameFields = ['reg-guardian-firstname', 'reg-guardian-middleinitial', 'reg-guardian-lastname']
        .map(id => document.getElementById(id)).filter(Boolean);
    const guardianNoMiddle = document.getElementById('reg-guardian-no-middle');
    if (guardianNoMiddle) {
        guardianNoMiddle.addEventListener('change', () => syncNoMiddleGate('reg-guardian'));
        syncNoMiddleGate('reg-guardian');
    }
    // Re-typing the guardian's name after a rejected match should clear the
    // rejection, so the customer is not reading a stale verdict.
    // Editing the name re-judges the photo already attached, rather than
    // leaving a verdict on screen that was reached against the old spelling.
    guardianNameFields.forEach(f => f.addEventListener('input', refreshGuardianVerdict));
    if (guardianNoMiddle) guardianNoMiddle.addEventListener('change', refreshGuardianVerdict);

    const noMiddleBox = document.getElementById('reg-no-middle');
    if (noMiddleBox) {
        noMiddleBox.addEventListener('change', () => {
            fullNameManuallyEdited = true;
            syncNoMiddleGate();
            // The suggester reads the composed name, so a cleared initial has
            // to re-run it.
            nameFields[0].dispatchEvent(new Event('input', { bubbles: true }));
        });
        syncNoMiddleGate();
    }

    let suggestTimer = null;
    const onNameInput = () => {
        if (usernameManuallyEdited) return;
        clearTimeout(suggestTimer);
        const name = regFullName();
        if (!name) { usernameField.value = ''; return; }
        suggestTimer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/auth/register/suggest-username?name=${encodeURIComponent(name)}`);
                const data = await res.json();
                if (res.ok && data.username && !usernameManuallyEdited) {
                    usernameField.value = data.username;
                }
            } catch (err) { /* leave field as-is; user can type their own */ }
        }, 400);
    };
    nameFields.forEach(f => f.addEventListener('input', onNameInput));
}

// Initialize register handlers on load
// Staff sent here by the 15-minute inactivity timeout arrive with ?timeout=1
// (see initIdleTimeout in shared.js). Saying why they are back at the sign-in
// page is the difference between a security feature and an apparent bug.
function announceSessionTimeout() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('timeout') !== '1') return;
    showToast('You were signed out after 15 minutes of inactivity. Please sign in again.', 'warning', 8000);
    // Cleared from the URL so a refresh or a bookmark does not repeat it.
    params.delete('timeout');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? '?' + query : ''));
    if (typeof openAuthPanel === 'function') openAuthPanel('login');
}

document.addEventListener('DOMContentLoaded', () => {
    setupRegisterHandlers();
    enhanceOtpInput('reg-otp');
    enhanceOtpInput('login-otp');
    enhanceOtpInput('forgot-otp');
    announceSessionTimeout();
});

// ── Forgot Password Modal ────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ── Forgot Password: request code -> enter code -> new password ─────
let forgotState = { step: 1, token: null };

function openForgotModal() {
    forgotState = { step: 1, token: null };
    document.getElementById('forgot-username').value = '';
    document.getElementById('forgot-otp').value = '';
    document.getElementById('forgot-new-password').value = '';
    document.getElementById('forgot-confirm-password').value = '';
    showForgotStep(1);
    openModal('forgot-modal');
}

function closeForgotModal() {
    closeModal('forgot-modal');
}

function showForgotStep(step) {
    forgotState.step = step;
    [1, 2, 3, 4].forEach((s) => {
        document.getElementById(`forgot-step-${s}`).style.display = s === step ? 'block' : 'none';
    });
    document.getElementById('forgot-error').classList.remove('show');
    const btn = document.getElementById('forgot-action-btn');
    const cancelBtn = document.getElementById('forgot-cancel-btn');
    const labels = { 1: 'Send Code', 2: 'Verify Code', 3: 'Reset Password' };
    btn.textContent = labels[step] || 'Continue';
    btn.style.display = step === 4 ? 'none' : 'inline-flex';
    cancelBtn.textContent = step === 4 ? 'Close' : 'Cancel';
}

function forgotStepAction() {
    if (forgotState.step === 1) return requestResetCode();
    if (forgotState.step === 2) return verifyResetOtp();
    if (forgotState.step === 3) return submitNewPassword();
}

async function requestResetCode() {
    const username = document.getElementById('forgot-username').value.trim();
    const errEl = document.getElementById('forgot-error');
    if (!username) {
        errEl.textContent = 'Username is required.';
        errEl.classList.add('show');
        return;
    }
    const btn = document.getElementById('forgot-action-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
        const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            forgotState.token = data.token;
            showForgotStep(2);
            btn.disabled = false;
            return;
        }
        errEl.textContent = data.error || 'Failed to send code.';
        errEl.classList.add('show');
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.textContent = 'Send Code';
}

async function verifyResetOtp() {
    const otp = document.getElementById('forgot-otp').value;
    const errEl = document.getElementById('forgot-error');
    if (!otp || otp.length !== 6) {
        errEl.textContent = 'Enter the 6-digit code.';
        errEl.classList.add('show');
        return;
    }
    const btn = document.getElementById('forgot-action-btn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    try {
        const res = await fetch('/api/auth/reset-password/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: forgotState.token, otp })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showForgotStep(3);
            btn.disabled = false;
            return;
        }
        errEl.textContent = data.error || 'Invalid code.';
        errEl.classList.add('show');
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.textContent = 'Verify Code';
}

async function submitNewPassword() {
    const pwd = document.getElementById('forgot-new-password').value;
    const confirm = document.getElementById('forgot-confirm-password').value;
    const errEl = document.getElementById('forgot-error');
    if (!pwd || !confirm) {
        errEl.textContent = 'Both password fields are required.';
        errEl.classList.add('show');
        return;
    }
    if (pwd.length < 8) {
        errEl.textContent = 'Password must be at least 8 characters.';
        errEl.classList.add('show');
        return;
    }
    if (pwd !== confirm) {
        errEl.textContent = 'Passwords do not match.';
        errEl.classList.add('show');
        return;
    }
    const btn = document.getElementById('forgot-action-btn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: forgotState.token, newPassword: pwd })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showForgotStep(4);
            btn.disabled = false;
            return;
        }
        errEl.textContent = data.error || 'Failed to reset password.';
        errEl.classList.add('show');
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.textContent = 'Reset Password';
}

// ── Expose globals for inline HTML handlers ──────────────────────
window.openAuthPanel = openAuthPanel;
window.closeAuthPanel = closeAuthPanel;
window.switchAuthTab = switchAuthTab;
window.setVerificationMethod = setVerificationMethod;
window.startIdAction = startIdAction;
window.handleFileUpload = handleFileUpload;
window.openRegCamera = openRegCamera;
window.stopRegCamera = stopRegCamera;
window.captureRegID = captureRegID;
window.handleLogin = handleLogin;
window.submitLoginOTP = submitLoginOTP;
window.resendLoginOTP = resendLoginOTP;
window.cancelLoginOTP = cancelLoginOTP;
window.goToStep = goToStep;
window.resendOTP = resendOTP;
window.finishRegistration = finishRegistration;
window.toggleService = toggleService;
