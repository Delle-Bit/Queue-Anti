// ── PUBLIC QUEUE DISPLAY ────────────────────────────────────────────────────
// The lobby board, and the audio announcement that goes with it.
//
// Who says what, and why it is split this way:
//   the front desk / admin  performs the action (calling next)
//   the server              broadcasts `queueAnnounce` from POST /api/queue/next
//                           and /call-back - only from those two, never from
//                           the general `queueUpdate`, which fires on every
//                           mutation and would have the board talking over
//                           itself continuously
//   this board              is the thing with speakers in the room, so it is
//                           what chimes and speaks
//
// The alternative - the staff dashboard speaking - puts the announcement at the
// counter, facing away from the people it is for.
//
// Standalone by design: no shared.js, because there is no session here.

// What an idle slot reads. Words rather than a dash: at headline size an em
// dash is a solid bar, which people read as a broken or still-loading screen.
const DISP_IDLE_STATION = 'Open';

const DISP_POLL_MS = 10000;      // fallback for a dropped socket
const DISP_ANNOUNCE_HOLD_MS = 45000;   // how long a station stays marked as calling

let dispSoundOn = false;
let dispAudioCtx = null;
let dispLastAnnouncement = null;
let dispAnnounceTimer = null;
let dispQueue = [];              // pending announcements, so two calls do not overlap
let dispSpeaking = false;

// ── Theme ──────────────────────────────────────────────────────────────────
// Its own copy of the theme switch, because this page loads no shared.js - the
// same localStorage key, so a board and a dashboard on one machine agree, and
// nothing server-side, so switching this panel cannot change what a patient
// sees on their own phone.
//
// Unlike the dashboards this defaults to **dark** when nothing has been chosen,
// rather than following prefers-color-scheme: a wall panel is a fixture with no
// viewer to have a preference, it is powered on all day, and the OS on whatever
// stick is driving it was never configured with this room in mind.
const DISP_THEME_KEY = 'clinicTheme';

function dispReadTheme() {
    try {
        return localStorage.getItem(DISP_THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch (err) {
        // Site data can be blocked outright, and a colour scheme is not worth
        // a board that fails to draw.
        return 'dark';
    }
}

function dispApplyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    const icon = document.getElementById('disp-theme-icon');
    const label = document.getElementById('disp-theme-label');
    // The button names what it will do, not what is already showing.
    if (icon) icon.className = theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    if (label) label.textContent = theme === 'light' ? 'Dark mode' : 'Light mode';
}

function dispToggleTheme() {
    const next = dispReadTheme() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(DISP_THEME_KEY, next); } catch (err) { /* holds for this session */ }
    dispApplyTheme(next);
}

// ── Clock ───────────────────────────────────────────────────────────────────
function dispTickClock() {
    const now = new Date();
    document.getElementById('disp-time').textContent =
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('disp-date').textContent =
        now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Audio ───────────────────────────────────────────────────────────────────
// Autoplay policy: audio needs a user gesture first. The button is that
// gesture, and it also resumes a context the browser suspended.
function dispToggleSound() {
    dispSoundOn = !dispSoundOn;
    const btn = document.getElementById('disp-sound');
    const icon = document.getElementById('disp-sound-icon');
    const label = document.getElementById('disp-sound-label');
    btn.dataset.on = String(dispSoundOn);
    icon.className = dispSoundOn ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
    label.textContent = dispSoundOn ? 'Sound on' : 'Enable sound';

    if (dispSoundOn) {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx && !dispAudioCtx) dispAudioCtx = new Ctx();
            if (dispAudioCtx && dispAudioCtx.state === 'suspended') dispAudioCtx.resume();
        } catch (err) {
            console.warn('Audio unavailable on this device', err);
        }
        // Confirms out loud that the board can now be heard - a silent toggle
        // gives whoever set the screen up no way to check the volume before
        // walking away from it.
        dispChime();
        dispSpeak('Queue announcements are now switched on.');
    }
}

// A two-tone chime, synthesised rather than loaded: it needs no asset to ship,
// no request to fail, and no licence. Two notes rising, which is the
// conventional "attention" pattern a waiting room already understands.
function dispChime() {
    if (!dispSoundOn || !dispAudioCtx) return;
    const now = dispAudioCtx.currentTime;
    [[880, 0], [1174.7, 0.18]].forEach(([freq, offset]) => {
        const osc = dispAudioCtx.createOscillator();
        const gain = dispAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        // Shaped rather than switched: a bare start/stop on a sine wave clicks.
        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(0.28, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.45);
        osc.connect(gain).connect(dispAudioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.5);
    });
}

// "Q-004" read as "Q, 0, 0, 4". Left whole, a speech engine says "Q minus four"
// or "Q dash four" - and the digits it drops are exactly the ones printed on
// the patient's ticket, so what they hear has to match what they are holding.
function dispSpokenTicket(ticket) {
    return String(ticket || '')
        .replace(/[-_]/g, ' ')
        .split('')
        .map(ch => /\d/.test(ch) ? ch + ',' : ch)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function dispSpeak(text) {
    if (!dispSoundOn || !window.speechSynthesis) return;
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.88;      // a shade under natural pace; it is read once, at distance
        utterance.pitch = 1;
        utterance.volume = 1;
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v => /^en[-_]?(PH|GB|US)/i.test(v.lang))
            || voices.find(v => v.lang && v.lang.startsWith('en'));
        if (preferred) utterance.voice = preferred;
        utterance.onend = () => { dispSpeaking = false; dispDrainQueue(); };
        utterance.onerror = () => { dispSpeaking = false; dispDrainQueue(); };
        dispSpeaking = true;
        window.speechSynthesis.speak(utterance);
    } catch (err) {
        console.warn('Speech synthesis failed', err);
        dispSpeaking = false;
    }
}

// Two stations calling within a second of each other must not talk over one
// another - the second waits for the first to finish.
function dispDrainQueue() {
    if (dispSpeaking || dispQueue.length === 0) return;
    const next = dispQueue.shift();
    dispChime();
    // Enough of a gap that the chime is not still ringing under the first word.
    setTimeout(() => dispSpeak(next), 620);
}

function dispEnqueueAnnouncement(payload) {
    const line = `Now serving, ticket ${dispSpokenTicket(payload.ticket)} at ${payload.station_name}.`;
    dispQueue.push(line);
    // Repeated once, the way a station announcement always is: somebody who
    // looked up at the chime has missed the first reading.
    dispQueue.push(line);
    dispDrainQueue();
}

// ── The call ─────────────────────────────────────────────────────────────────
// A call used to be painted into a band of its own above the grid. It now
// marks the station that made it, which is the only place the ticket number and
// the counter to walk to already sit side by side - the band had to repeat the
// station name to be useful, and two copies of one fact on a screen are two
// things that can disagree.
//
// So this writes no markup: it records which station is calling and re-renders,
// and dispRenderStations() gives that panel the highlight.
function dispShowAnnouncement(payload) {
    dispLastAnnouncement = payload;

    // The band was the page's aria-live region. Without it the announcement has
    // no spoken form at all, so it is written here instead.
    const live = document.getElementById('disp-live');
    if (live) live.textContent = `Now serving ticket ${payload.ticket || ''} at ${payload.station_name || ''}.`;

    dispLoad();

    if (dispAnnounceTimer) clearTimeout(dispAnnounceTimer);
    dispAnnounceTimer = setTimeout(() => {
        dispLastAnnouncement = null;
        if (live) live.textContent = '';
        // The highlight is derived from dispLastAnnouncement at render time, so
        // dropping it is only half the job - the panel keeps its gradient until
        // something repaints. Without this it would clear on the next poll
        // instead, up to ten seconds late.
        dispLoad();
    }, DISP_ANNOUNCE_HOLD_MS);
}

function dispEscape(text) {
    return String(text ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── The station grid ────────────────────────────────────────────────────────
function dispRenderStations(data) {
    document.getElementById('disp-clinic').textContent = data.clinic_name || 'Medical Clinic';
    document.title = `Queue Display — ${data.clinic_name || 'Medical Clinic'}`;

    const callingKey = dispLastAnnouncement
        ? (dispLastAnnouncement.station_type === 'frontdesk'
            ? 'frontdesk'
            : `${dispLastAnnouncement.station_type}:${dispLastAnnouncement.station_id}`)
        : null;

    document.getElementById('disp-grid').innerHTML = (data.stations || []).map(station => {
        const idle = !station.now_serving;
        const upcoming = (station.upcoming || []);
        return `
        <section class="disp-station${station.key === callingKey ? ' is-calling' : ''}">
            ${station.key === callingKey
                ? '<span class="disp-calling-tag">Now calling</span>'
                : ''}
            <div class="disp-station-name">
                <span class="disp-dot" data-idle="${idle}"></span>
                <span class="disp-station-label">${dispEscape(station.name)}</span>
                <span class="disp-waiting-count">${station.waiting_count} waiting</span>
            </div>
            <div class="disp-now" data-idle="${idle}">${
                dispEscape(station.now_serving || DISP_IDLE_STATION)}</div>
            <div class="disp-station-next-block">
                <div class="disp-next-label">Next up</div>
                <div class="disp-next">
                    ${upcoming.length
                        ? upcoming.map(t => `<span class="disp-chip">${dispEscape(t)}</span>`).join('')
                        : '<span class="disp-empty">Nobody waiting</span>'}
                </div>
            </div>
        </section>`;
    }).join('');
}

async function dispLoad() {
    try {
        const res = await fetch('/api/display');
        if (!res.ok) throw new Error('display fetch failed: ' + res.status);
        const data = await res.json();
        dispRenderStations(data);
        dispSetStatus(`Live — updated ${new Date().toLocaleTimeString()}`, false);
    } catch (err) {
        console.error('Display load error:', err);
        dispSetStatus('Cannot reach the clinic system — retrying', true);
    }
}

function dispSetStatus(text, isError) {
    const el = document.getElementById('disp-status');
    el.textContent = text;
    el.className = isError ? 'disp-offline' : '';
}

function dispToggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err =>
            console.warn('Fullscreen refused', err));
    } else {
        document.exitFullscreen();
    }
}

// ── Wiring ──────────────────────────────────────────────────────────────────
dispApplyTheme(dispReadTheme());
dispTickClock();
setInterval(dispTickClock, 1000);
dispLoad();

// Polling is the fallback, not the mechanism: the socket is what makes a call
// appear the instant it happens. Ten seconds is only there to heal a board that
// lost its connection overnight and to keep the waiting counts honest.
setInterval(dispLoad, DISP_POLL_MS);

const dispSocket = io();
dispSocket.on('connect', () => dispSetStatus('Live', false));
dispSocket.on('disconnect', () => dispSetStatus('Reconnecting…', true));
dispSocket.on('queueUpdate', dispLoad);
dispSocket.on('queueAnnounce', (payload) => {
    if (!payload || !payload.ticket) return;
    dispShowAnnouncement(payload);   // reloads the grid itself, so the panel lights up
    dispEnqueueAnnouncement(payload);
});

// Chrome populates the voice list asynchronously; without this the first
// announcement of the session falls back to the default voice.
if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// The clinic's own logo, if one has been set in Customize.
fetch('/api/settings')
    .then(res => res.ok ? res.json() : null)
    .then(settings => {
        if (settings && settings.logo_path) document.getElementById('disp-logo').src = settings.logo_path;
    })
    .catch(() => { /* the default logo is already in the markup */ });
