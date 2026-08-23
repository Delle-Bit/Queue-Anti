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

// ── Mobile Hamburger ─────────────────────────────────────────────
const hamburgerBtn = document.getElementById('hamburger-btn');
const navLinksEl = document.getElementById('nav-links');
const mobileOverlay = document.getElementById('mobile-nav-overlay');

function toggleMobileMenu() {
    const isOpen = hamburgerBtn.classList.toggle('open');
    hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
    navLinksEl.classList.toggle('mobile-open', isOpen);
    mobileOverlay.classList.toggle('active', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
}

function closeMobileMenu() {
    hamburgerBtn.classList.remove('open');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    navLinksEl.classList.remove('mobile-open');
    mobileOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

hamburgerBtn.addEventListener('click', toggleMobileMenu);
mobileOverlay.addEventListener('click', closeMobileMenu);

navLinksEl.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', closeMobileMenu);
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
    document.body.style.overflow = 'hidden';
    switchAuthTab(tab);
    // Focus trap
    setTimeout(() => {
        const focusable = authOverlay.querySelectorAll('input, button, [tabindex]');
        if (focusable.length) focusable[0].focus();
    }, 420);
}

function closeAuthPanel() {
    authOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// Close on overlay backdrop click
authOverlay.addEventListener('click', function (e) {
    if (e.target === authOverlay) closeAuthPanel();
});

// Close on Escape
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (authOverlay.classList.contains('active')) closeAuthPanel();
    }
});

function switchAuthTab(tab) {
    document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    if (tab === 'register') {
        // Reset to step 1
        showRegStep(1);
        // Ensure forms are reset
        document.getElementById('reg-step1-form').reset();
        document.getElementById('reg-step2-form').reset();
        document.getElementById('reg-step3-form').reset();
        document.getElementById('preview-front').innerHTML = '<i class="fa-solid fa-address-card"></i>';
        document.getElementById('preview-back').innerHTML = '<i class="fa-solid fa-address-card"></i>';
        registrationState.blobs = { front: null, back: null };
        setVerificationMethod('id');
    }
}

// ── Register State ─────────────────────────────────────────────────
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

function validateCurrentStep() {
    const step = registrationState.step;
    const errEl = document.getElementById('reg-error');
    
    if (step === 1) {
        const username = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
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
            const missing = ['reg-guardian-name', 'reg-guardian-contact', 'reg-guardian-relationship']
                .some(id => !document.getElementById(id).value.trim());
            if (missing) {
                errEl.textContent = 'Guardian name, contact, and relationship are required.';
                errEl.classList.add('show');
                return false;
            }
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
    formData.append('email', document.getElementById('reg-email').value.trim());
    formData.append('verification_method', registrationState.verificationMethod);
    
    if (registrationState.verificationMethod === 'id') {
        formData.append('frontId', registrationState.blobs.front, 'front-id.jpg');
        formData.append('backId', registrationState.blobs.back, 'back-id.jpg');
    } else {
        formData.append('guardian_name', document.getElementById('reg-guardian-name').value.trim());
        formData.append('guardian_contact', document.getElementById('reg-guardian-contact').value.trim());
        formData.append('guardian_relationship', document.getElementById('reg-guardian-relationship').value.trim());
    }
    
    try {
        const res = await fetch('/api/auth/register/step1', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok && data.success) {
            registrationState.token = data.token;
            registrationState.ocrResult = { category: data.category, detectedName: data.detectedName };
            sucEl.textContent = data.message;
            sucEl.classList.add('show');
            // Auto-advance after short delay
            setTimeout(() => goToStep(2), 1500);
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
            setTimeout(() => goToStep(3), 1500);
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
            startOTPCountdown();
        } else {
            errEl.textContent = data.error || 'Failed to send code';
            errEl.classList.add('show');
        }
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
            body: JSON.stringify({ token: registrationState.token, otp })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            sucEl.textContent = data.message;
            sucEl.classList.add('show');
            // Show success step
            document.getElementById('reg-success-message').innerHTML = `Your account has been created!<br>Category: <strong>${data.category}</strong>`;
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
let regBlobs = { front: null, back: null };
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
        regBlobs[currentSide] = blob;
        const preview = document.getElementById(`preview-${currentSide}`);
        const dataUrl = canvas.toDataURL('image/jpeg');
        preview.innerHTML = `<img src="${dataUrl}" alt="${currentSide} id">`;
        status.textContent = `${currentSide.toUpperCase()} captured ✓`;
        stopRegCamera();
    }, 'image/jpeg', 0.9);
}

// ── Login ────────────────────────────────────────────────────────
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
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
}

// ── Register Form Handlers ──────────────────────────────────────────
function setupRegisterHandlers() {
    // Step 1 form
    document.getElementById('reg-step1-form').addEventListener('submit', (e) => {
        e.preventDefault();
        validateCurrentStep(); // This will call submitStep1 if valid
    });
    
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
}

// Initialize register handlers on load
document.addEventListener('DOMContentLoaded', () => {
    setupRegisterHandlers();
});

// ── Forgot Password Modal ────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

async function requestReset() {
    const username = document.getElementById('forgot-username').value.trim();
    if (!username) return;
    const btn = document.getElementById('forgot-send-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
        const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        const msg = document.getElementById('forgot-msg');
        msg.textContent = data.message;
        msg.classList.add('show');
    } catch (err) {
        console.error(err);
    }
    btn.disabled = false;
    btn.innerHTML = 'Send Reset';
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
window.goToStep = goToStep;
window.resendOTP = resendOTP;
window.finishRegistration = finishRegistration;
window.toggleService = toggleService;
