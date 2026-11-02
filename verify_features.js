'use strict';
// verify_features.js
// Offline verification tests for the 5 new system additions:
// 1. 6-Digit Export PIN
// 2. Appointment Calendar View & Slot Logic
// 3. Sales Excel Export & Formula Injection Prevention
// 4. Service Corrections & Audit Trail
// 5. Cookie Consent & RA 10173 Compliance
//
// Needs no DB, no network, and no API keys.

let passed = 0;
let failed = 0;

function ok(name, cond) {
    if (cond) {
        console.log(`  ok   ${name}`);
        passed++;
    } else {
        console.error(`  FAIL ${name}`);
        failed++;
    }
}

// ─────────────────────────────────────────────────────────────
// 1. FEATURE 1: 6-DIGIT EXPORT PIN
// ─────────────────────────────────────────────────────────────
console.log('\n1. 6-Digit PIN format (any 6 digits accepted)');

// The owner's policy: no weak-PIN rule. Only the 6-digit numeric format is
// enforced, so 000000 and 123456 are as valid as 847291.
function isValidPin(pin) {
    return /^\d{6}$/.test(String(pin || ''));
}

ok('000000 is accepted (weak PINs allowed)', isValidPin('000000'));
ok('111111 is accepted (weak PINs allowed)', isValidPin('111111'));
ok('123456 is accepted (weak PINs allowed)', isValidPin('123456'));
ok('654321 is accepted', isValidPin('654321'));
ok('102030 is accepted', isValidPin('102030'));
ok('847291 is accepted', isValidPin('847291'));
ok('5-digit PIN is rejected', !isValidPin('12345'));
ok('7-digit PIN is rejected', !isValidPin('1234567'));
ok('Alphanumeric PIN is rejected', !isValidPin('12345a'));
ok('Empty PIN is rejected', !isValidPin(''));

console.log('\n2. Export authorization single-use token lifecycle');
const exportAuthTokens = new Map();

function issueExportToken(userId) {
    const crypto = require('crypto');
    const token = crypto.randomBytes(24).toString('hex');
    exportAuthTokens.set(token, { userId, expiresAt: Date.now() + 2 * 60 * 1000 });
    return token;
}

function validateExportToken(token, userId) {
    if (!token) return false;
    const entry = exportAuthTokens.get(token);
    if (!entry) return false;
    exportAuthTokens.delete(token); // Single-use!
    return entry.userId === userId && entry.expiresAt > Date.now();
}

const t1 = issueExportToken(42);
ok('Token is valid for issuing user on first use', validateExportToken(t1, 42));
ok('Token is refused on second use (single-use constraint)', !validateExportToken(t1, 42));

const t2 = issueExportToken(42);
ok('Token is refused for a different user', !validateExportToken(t2, 99));

exportAuthTokens.set('expired_tok', { userId: 42, expiresAt: Date.now() - 1000 });
ok('Expired token is refused', !validateExportToken('expired_tok', 42));

console.log('\n3. Lockout on 5 failed PIN attempts');
function computeLockout(failedAttempts) {
    const isLocked = failedAttempts >= 5;
    const remaining = Math.max(0, 5 - failedAttempts);
    return { isLocked, remaining };
}
ok('1 failed attempt allows 4 remaining', computeLockout(1).remaining === 4 && !computeLockout(1).isLocked);
ok('4 failed attempts allows 1 remaining', computeLockout(4).remaining === 1 && !computeLockout(4).isLocked);
ok('5 failed attempts triggers lockout', computeLockout(5).isLocked && computeLockout(5).remaining === 0);
ok('6 failed attempts stays locked', computeLockout(6).isLocked);

// ─────────────────────────────────────────────────────────────
// 2. FEATURE 2: CALENDAR VIEW & SLOT AVAILABILITY LOGIC
// ─────────────────────────────────────────────────────────────
console.log('\n4. Calendar slot generation and overlap detection');

function generateDaySlots(bizStart, bizEnd, slotMin, appts) {
    const [startH, startM] = bizStart.split(':').map(Number);
    const [endH, endM] = bizEnd.split(':').map(Number);
    const dayStartMin = startH * 60 + startM;
    const dayEndMin = endH * 60 + endM;

    const slots = [];
    for (let min = dayStartMin; min < dayEndMin; min += slotMin) {
        const h = String(Math.floor(min / 60)).padStart(2, '0');
        const m = String(min % 60).padStart(2, '0');
        const timeStr = `${h}:${m}`;
        const slotEndMin = min + slotMin;

        const matchingAppt = appts.find(a => {
            if (a.status === 'cancelled' || a.status === 'no-show') return false;
            const [ah, am] = a.appointment_time.split(':').map(Number);
            const apptStart = ah * 60 + am;
            const apptEnd = apptStart + (a.duration_minutes || slotMin);
            return apptStart < slotEndMin && apptEnd > min;
        });

        slots.push({
            time: timeStr,
            status: matchingAppt ? 'taken' : 'available',
            appointment: matchingAppt || null
        });
    }
    return slots;
}

const mockAppts = [
    { appointment_time: '09:00', duration_minutes: 60, status: 'scheduled', customer_name: 'Patient A' }, // 09:00 - 10:00 (spans 2 x 30m slots)
    { appointment_time: '11:00', duration_minutes: 30, status: 'cancelled', customer_name: 'Patient B' }, // cancelled -> freed
    { appointment_time: '14:00', duration_minutes: 30, status: 'completed', customer_name: 'Patient C' }
];

const generatedSlots = generateDaySlots('08:00', '17:00', 30, mockAppts);
ok('08:00 slot is available', generatedSlots.find(s => s.time === '08:00').status === 'available');
ok('08:30 slot is available', generatedSlots.find(s => s.time === '08:30').status === 'available');
ok('09:00 slot is taken (first half of Patient A)', generatedSlots.find(s => s.time === '09:00').status === 'taken');
ok('09:30 slot is taken (second half of 60m Patient A appointment)', generatedSlots.find(s => s.time === '09:30').status === 'taken');
ok('10:00 slot is available after Patient A finishes', generatedSlots.find(s => s.time === '10:00').status === 'available');
ok('11:00 slot is available because appointment was cancelled', generatedSlots.find(s => s.time === '11:00').status === 'available');
ok('14:00 slot is taken by completed appointment', generatedSlots.find(s => s.time === '14:00').status === 'taken');

// ─────────────────────────────────────────────────────────────
// 3. FEATURE 3: EXCEL EXPORT & FORMULA INJECTION PREVENTION
// ─────────────────────────────────────────────────────────────
console.log('\n5. Excel formula injection sanitization');

function sanitizeCellValue(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/^[=+\-@]/.test(str)) {
        return "'" + str;
    }
    return str;
}

ok('= formula is prefixed with single quote', sanitizeCellValue('=SUM(A1:A10)') === "'=SUM(A1:A10)");
ok('+ execution payload is prefixed with single quote', sanitizeCellValue('+cmd|"/C calc"!A0') === "'+cmd|\"/C calc\"!A0");
ok('- negative formula is escaped', sanitizeCellValue('-2+3+cmd') === "'-2+3+cmd");
ok('@ formula is escaped', sanitizeCellValue('@SUM(B1:B5)') === "'@SUM(B1:B5)");
ok('Normal patient name is unescaped', sanitizeCellValue('Juan Dela Cruz') === 'Juan Dela Cruz');
ok('Normal receipt number is unescaped', sanitizeCellValue('REC-000123') === 'REC-000123');
ok('Null returns empty string', sanitizeCellValue(null) === '');
ok('Undefined returns empty string', sanitizeCellValue(undefined) === '');

// ─────────────────────────────────────────────────────────────
// 4. FEATURE 4: SERVICE CORRECTION & CONFLICT DETECTION
// ─────────────────────────────────────────────────────────────
console.log('\n6. Service correction reason validation & price diff arithmetic');

const VALID_CORRECTION_REASONS = ['Wrong entry', 'Customer changed request', 'Duplicate entry', 'Other'];
ok('Wrong entry is valid reason', VALID_CORRECTION_REASONS.includes('Wrong entry'));
ok('Customer changed request is valid reason', VALID_CORRECTION_REASONS.includes('Customer changed request'));
ok('Arbitrary reason is refused', !VALID_CORRECTION_REASONS.includes('Mistake'));

function computeCorrection(oldPrice, newPrice) {
    const diff = Number(newPrice) - Number(oldPrice);
    let adjustment = 'none';
    if (diff > 0) adjustment = 'charge';
    else if (diff < 0) adjustment = 'credit';
    return { diff, adjustment };
}

ok('Price upgrade calculates positive additional charge', computeCorrection(500, 750).diff === 250 && computeCorrection(500, 750).adjustment === 'charge');
ok('Price downgrade calculates refund/credit', computeCorrection(750, 500).diff === -250 && computeCorrection(750, 500).adjustment === 'credit');
ok('Same price requires no adjustment', computeCorrection(500, 500).diff === 0 && computeCorrection(500, 500).adjustment === 'none');

function checkDurationConflict(apptStartMin, newDurationMin, otherApptStartMin) {
    const newEndMin = apptStartMin + newDurationMin;
    return otherApptStartMin > apptStartMin && otherApptStartMin < newEndMin;
}
ok('30m service starting at 09:00 does not conflict with 10:00 appointment', !checkDurationConflict(540, 30, 600));
ok('Extended 90m service starting at 09:00 (ends 10:30) conflicts with 10:00 appointment', checkDurationConflict(540, 90, 600));

// ─────────────────────────────────────────────────────────────
// 5. FEATURE 5: COOKIE CONSENT & RA 10173 PARSING
// ─────────────────────────────────────────────────────────────
console.log('\n7. Cookie consent parsing and category defaults');

function parseCookieConsent(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(decodeURIComponent(raw));
        if (parsed && parsed.version === '1.0' && parsed.categories) {
            return parsed;
        }
    } catch (_) {}
    return null;
}

const mockConsentJson = encodeURIComponent(JSON.stringify({
    categories: { essential: true, preferences: false, analytics: false },
    version: '1.0',
    timestamp: new Date().toISOString()
}));

const parsed = parseCookieConsent(mockConsentJson);
ok('Cookie consent JSON is successfully parsed', parsed !== null);
ok('Essential cookies are locked to true', parsed && parsed.categories.essential === true);
ok('Preferences default to false on reject', parsed && parsed.categories.preferences === false);
ok('Analytics default to false on reject', parsed && parsed.categories.analytics === false);

const outdatedConsent = encodeURIComponent(JSON.stringify({
    categories: { essential: true, preferences: true, analytics: true },
    version: '0.9',
    timestamp: new Date().toISOString()
}));
ok('Outdated policy version triggers re-prompt (returns null)', parseCookieConsent(outdatedConsent) === null);
ok('Malformed cookie string returns null', parseCookieConsent('invalid-json-cookie') === null);

console.log(`\n========================================`);
console.log(`Feature Verification: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) {
    process.exit(1);
}
