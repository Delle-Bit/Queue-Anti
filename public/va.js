/* ================================================================
   VIRTUAL NURSE ASSISTANT
   Animated avatar state machine · floating speech bubbles ·
   dialogue controller (service FAQ · calculation · queue dispatch)
   ================================================================ */

// ── STATE ─────────────────────────────────────────────────────────
// idle → listening → thinking → speaking → idle
const VA_STATES = ['idle', 'listening', 'thinking', 'speaking'];
const VA_HISTORY_KEY = 'vaHistory';
const VA_MAX_BUBBLES = 3;
const VA_SILENCE_TIMEOUT_MS = 3000; // auto-stop this long after the user stops speaking
const VA_INITIAL_LISTEN_TIMEOUT_MS = 8000; // grace period to start speaking after the mic activates

// Speech-recognition failure reasons, mapped to something the customer can act on.
// 'aborted' and 'no-speech' are expected during normal use and never surface.
const VA_SPEECH_ERRORS = {
    'not-allowed': 'Microphone access is blocked. Allow the microphone for this site, then click the nurse again.',
    'service-not-allowed': 'Microphone access is blocked. Allow the microphone for this site, then click the nurse again.',
    'audio-capture': "I can't find a microphone. Check that one is connected and selected, then try again.",
    'network': 'I lost the connection to the speech service. Check your internet and try again.',
    // The microphone never actually opened. Reported when start() resolved but
    // onstart never fired - Safari and some mobile browsers expose
    // webkitSpeechRecognition and then do exactly this.
    'mic-never-opened': 'My microphone would not open in this browser. Voice input needs Google Chrome on a computer \u2014 you can type to me instead.',
    // It opened, and no audio ever registered as speech.
    'heard-nothing': "I didn't hear anything. Click the nurse again and start speaking once the badge says Listening.",
    // It heard something but nothing survived as text.
    'nothing-usable': "I heard you but couldn't make out the words. Click the nurse and try again, a little slower.",
    // Opera carries no speech recogniser at all: Chromium reaches a Google
    // service with a key compiled into Chrome, and Opera does not ship it, so
    // recognition is absent or fails every session on Opera desktop and
    // Opera Mobile alike. Nothing here can change that, so it says so plainly
    // and points at the box the customer can actually use.
    'opera': 'Opera cannot listen \u2014 it has no speech recogniser built in. Type your question in the box below and I will answer it.',
    'unsupported': 'This browser cannot listen. Type your question in the box below, or use Google Chrome for voice.',
    'default': "I couldn't hear that clearly. Click the nurse and try again."
};

let vaState = 'idle';
let vaMuted = localStorage.getItem('vaMuted') === 'true';
let recognition = null;
let isListening = false;
let silenceTimer = null;
// Numbers the speech sessions in the console trace, so overlapping or repeated
// sessions can be told apart when diagnosing a microphone that will not stay on.
let sessionSerial = 0;
// Set when the customer stops a session themselves, so onend knows not to
// explain a silence they caused on purpose.
let speechCancelledByUser = false;

// ── ENGINE CAPABILITIES ───────────────────────────────────────────
// This is deliberately user-agent based, which is normally the wrong tool.
// It is the only tool available here: there is no feature flag that answers
// "does continuous mode actually work" or "is a speech backend present", and
// both differ per engine while the API surface looks identical.
//
//   Chromium (Chrome, Edge): continuous and interim results both work.
//   WebKit (Safari 14.1+ macOS, 14.5+ iOS, and every browser on iOS since
//     they all use WebKit): continuous = true is broken - the microphone
//     never stops after the customer finishes and the recognised text never
//     arrives at all. interimResults is unreliable too and can throttle the
//     engine into switching recognisers mid-session. So on WebKit we ask for
//     one utterance and take only final results, and let Safari's own
//     end-of-speech detection close the session.
//   Opera: ships no speech backend. Chromium routes recognition through a
//     Google service using a key compiled into Chrome, and Opera does not
//     carry it, so webkitSpeechRecognition is absent or non-functional on
//     Opera desktop and Opera Mobile alike. Nothing in this file can fix
//     that; the typed input below is the answer for Opera.
function vaSpeechProfile() {
    const ua = navigator.userAgent;
    // Opera puts OPR/ in its Chromium user agent, and OPiOS/ on iOS.
    const isOpera = /\bOPR\//.test(ua) || /\bOPiOS\//.test(ua) || /\bOpera\b/.test(ua);
    // navigator.vendor is 'Apple Computer, Inc.' on Safari and on every iOS
    // browser - Chrome, Firefox and Edge on iOS are all WebKit underneath and
    // inherit its quirks - and 'Google Inc.' on desktop Chrome. It needs no
    // version table and has been stable for years, which is more than can be
    // said for parsing the user agent string itself.
    const isWebKit = /apple/i.test(navigator.vendor || '');
    const isFirefox = /\bFirefox\//.test(ua) && !isWebKit;

    return {
        engine: isOpera ? 'opera' : isWebKit ? 'webkit' : isFirefox ? 'firefox' : 'chromium',
        isOpera,
        isWebKit,
        // WebKit cannot hold a continuous session open correctly.
        continuous: !isWebKit,
        // WebKit's interim results throttle the recogniser; take finals only.
        interimResults: !isWebKit,
        // Opera exposes no working recogniser at all.
        speechUsable: !isOpera
    };
}
let synthesisSpeech = null;
let vaHistory = loadVaHistory();

// Lip-sync ticker state
let lipSyncRaf = null;
let mouthTarget = 0;
let mouthValue = 0;
let nextSyllableAt = 0;

document.addEventListener('DOMContentLoaded', () => {
    updateMuteButtonUI();
    bindVaListeners();
    renderVaHistory();
    setVaState('idle');
});

// ── AVATAR STATE MACHINE ──────────────────────────────────────────
// Drives every avatar animation through one data attribute on .va-stage,
// so CSS owns the transitions and JS only owns the state.
function setVaState(state, message) {
    if (!VA_STATES.includes(state)) state = 'idle';
    vaState = state;

    const stage = document.getElementById('va-stage');
    const badge = document.getElementById('va-state-badge');

    if (stage) stage.dataset.vaState = state;

    const labels = { idle: 'Idle', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };
    if (badge) badge.textContent = message || labels[state];

    // The mic button only recognizes two states — actively capturing audio, or not —
    // per the active/inactive mic-on/mic-off spec. Thinking and speaking count as inactive.
    updateMicButtonUI(state === 'listening');

    // Mouth rests closed outside the speaking state.
    if (state !== 'speaking') setMouthOpen(0);
}

// The microphone beside the avatar is an INDICATOR, not a control. It reports
// one thing - whether the microphone is currently open - and clicking it does
// nothing. The nurse herself is the control: click her to start and stop, or
// type in the box. Two controls that did the same job invited the customer to
// click the small one, and on WebKit only one of the two could ever work.
//
// Listening: mic-on icon, green. Not listening: mic-off icon, red.
function updateMicButtonUI(isActive) {
    const el = document.getElementById('va-action-btn');
    if (!el) return;
    el.classList.toggle('mic-active', isActive);
    // The icon carries no text, so the state is also written out for screen
    // readers inside the aria-live region this element declares.
    el.innerHTML = (isActive
        ? '<i class="fa-solid fa-microphone" aria-hidden="true"></i>'
        : '<i class="fa-solid fa-microphone-slash" aria-hidden="true"></i>')
        + `<span class="va-sr-only">${isActive ? 'Listening' : 'Not listening'}</span>`;
    // A tooltip that points at the thing that does work, rather than implying
    // this element is clickable.
    el.title = vaSpeechSupported()
        ? (isActive ? 'Listening \u2014 click the nurse to stop' : 'Click the nurse to speak')
        : 'This browser cannot listen \u2014 type your question instead';
}

// Cached because it is asked on every state change and cannot change within a
// page load.
let vaSpeechSupportedCache = null;
function vaSpeechSupported() {
    if (vaSpeechSupportedCache === null) {
        vaSpeechSupportedCache = !!(window.SpeechRecognition || window.webkitSpeechRecognition)
            && vaSpeechProfile().speechUsable;
    }
    return vaSpeechSupportedCache;
}

// ── FLOATING SPEECH BUBBLES ───────────────────────────────────────
// Replaces the old fixed chat panel: bubbles float above the avatar and
// retire on their own, keeping the dashboard visible underneath.
function bubbleReadMs(text) {
    return Math.min(12000, Math.max(3500, text.length * 70));
}

function pushVaBubble(role, text, options = {}) {
    const wrap = document.getElementById('va-bubbles');
    if (!wrap || !text) return null;

    // Identical back-to-back messages (a repeated recognition error, a retried request)
    // only stack up as noise — refresh the existing bubble's timer instead of cloning it.
    const live = wrap.querySelectorAll('.va-bubble:not(.leaving)');
    const last = live[live.length - 1];
    if (last && last.classList.contains(role) &&
        last.querySelector('.va-bubble-text')?.textContent === text) {
        if (last.dataset.timer) clearTimeout(Number(last.dataset.timer));
        delete last.dataset.timer;
        if (!options.persist) last.dataset.timer = setTimeout(() => retireVaBubble(last), bubbleReadMs(text));
        return last;
    }

    const bubble = document.createElement('div');
    bubble.className = `va-bubble ${role}`;
    bubble.innerHTML = `
        <span class="va-bubble-role">${role === 'user' ? 'You' : 'Nurse'}</span>
        <span class="va-bubble-text">${escapeHtml(text)}</span>
    `;
    wrap.appendChild(bubble);

    // Keep the stack shallow so the avatar is never buried. Retiring is asynchronous
    // (the node lingers for the leave transition), so count only the bubbles that are
    // not already on their way out — counting those would never let this loop end.
    const liveBubbles = () => wrap.querySelectorAll('.va-bubble:not(.leaving)');
    while (liveBubbles().length > VA_MAX_BUBBLES) {
        retireVaBubble(liveBubbles()[0]);
    }

    if (!options.persist) {
        bubble.dataset.timer = setTimeout(() => retireVaBubble(bubble), bubbleReadMs(text));
    }
    return bubble;
}

function retireVaBubble(bubble) {
    if (!bubble) return;
    if (bubble.classList.contains('leaving')) return; // already retiring — don't queue a second removal
    if (bubble.dataset.timer) clearTimeout(Number(bubble.dataset.timer));
    bubble.classList.add('leaving');
    setTimeout(() => bubble.remove(), 260);
}

function dismissVaBubble(bubble, delay = 0) {
    if (!bubble) return;
    setTimeout(() => retireVaBubble(bubble), delay);
}

// Bubble + history + voice in one call — the assistant's only output path.
function vaSay(text, options = {}) {
    if (!text) return;
    addVaHistory('assistant', text);
    const bubble = pushVaBubble('assistant', text, { persist: true });
    speakAloud(text, () => dismissVaBubble(bubble, options.holdMs ?? 2200));
}

// ── INTERACTION BINDINGS ──────────────────────────────────────────
// Single click → start listening (silence detection stops it automatically,
// or a second click stops it early). Double click → conversation history.
function bindVaListeners() {
    const avatar = document.getElementById('va-avatar');

    const toggleListening = () => {
        if (isListening) stopSpeechRecognition();
        else startSpeechRecognition();
    };

    if (avatar) {
        avatar.addEventListener('click', (event) => {
            event.preventDefault();
            // Acted on immediately, inside the gesture. This used to be
            // deferred 260ms so a second click could claim it as a
            // double-click, and that deferral is fatal on WebKit: Safari
            // only permits a recognition start that happens directly inside a
            // user gesture, so every avatar click on Safari was refused
            // before it began. A double-click is handled by undoing this
            // instead - see below.
            toggleListening();
        });

        // Gesture: double-click the nurse to open the full conversation
        // history. The first of the two clicks has already started listening
        // by the time this fires, so it is stopped again rather than
        // prevented - which is what lets the single-click path stay inside
        // its gesture.
        avatar.addEventListener('dblclick', (event) => {
            event.preventDefault();
            if (isListening) stopSpeechRecognition();
            openVaHistory();
        });

        avatar.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleListening();
            }
            if (event.key.toLowerCase() === 'h') openVaHistory();
        });
    }

    // #va-action-btn is deliberately not bound: it is the listening indicator,
    // not a second start button. See updateMicButtonUI.

    bindVaTypedInput();
}

// ── TYPED INPUT ───────────────────────────────────────────────────
// The assistant's dialogue half works in every browser - it is an ordinary
// POST to /api/assistant/dialogue. Only the *listening* half is
// engine-specific, and on Opera it cannot work at all. So the assistant takes
// typing as well as speech, which is what actually makes it usable on Opera,
// on Firefox, and on a Safari session where the microphone misbehaves. It is
// also the better input in a waiting room with other people in it.
function bindVaTypedInput() {
    const form = document.getElementById('va-typed-form');
    const input = document.getElementById('va-typed-input');
    if (!form || !input) return;

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        // Stop listening first if the microphone happens to be open, so a
        // spoken and a typed question cannot arrive at once.
        if (isListening) stopSpeechRecognition();
        beginVaTurn();
        pushVaBubble('user', text);
        addVaHistory('user', text);
        processVoiceCommand(text);
    });

    // Tell the customer up front when speech is not an option here, rather
    // than after they click the nurse and get an explanation. The indicator's
    // own tooltip is handled in updateMicButtonUI, which runs on every state
    // change and would otherwise overwrite anything set here.
    if (!vaSpeechSupported()) {
        const hint = document.getElementById('va-hint');
        if (hint) hint.textContent = 'Type your question \u2014 voice input needs Google Chrome';
    }
}

function focusVaTypedInput() {
    const input = document.getElementById('va-typed-input');
    if (input) input.focus();
}

// ── CONVERSATION HISTORY ──────────────────────────────────────────
// Clearing has to survive a turn that is already in flight. A question asked
// before Clear was pressed is still waiting on /api/assistant/dialogue, and
// its reply used to land in the log the customer had just emptied - which
// reads as a Clear button that does not work.
//
// So every turn carries the epoch it began in, and a write from an older epoch
// is dropped. A question asked *after* the clear begins in the new epoch and
// is recorded normally.
let vaHistoryEpoch = 0;
let vaTurnEpoch = 0;

// Called when a new question starts, spoken or typed.
function beginVaTurn() {
    vaTurnEpoch = vaHistoryEpoch;
}

function loadVaHistory() {
    try {
        const stored = JSON.parse(localStorage.getItem(VA_HISTORY_KEY) || '[]');
        return Array.isArray(stored) ? stored.slice(-50) : [];
    } catch (e) { return []; }
}

function addVaHistory(role, text) {
    if (!text) return;
    if (vaTurnEpoch !== vaHistoryEpoch) return; // cleared while this turn was in flight
    vaHistory.push({ role, text, at: new Date().toISOString() });
    if (vaHistory.length > 50) vaHistory = vaHistory.slice(-50);
    try { localStorage.setItem(VA_HISTORY_KEY, JSON.stringify(vaHistory)); } catch (e) { /* quota — keep in memory */ }
    renderVaHistory();
}

function renderVaHistory() {
    const box = document.getElementById('va-history');
    if (!box) return;
    if (vaHistory.length === 0) {
        box.innerHTML = '<div class="va-history-empty">No conversation yet. Click the nurse avatar and speak.</div>';
        return;
    }
    box.innerHTML = vaHistory.map(item => `
        <div class="va-history-item ${item.role}">
            <strong>${item.role === 'user' ? 'You' : 'Nurse Assistant'}</strong>
            <span>${escapeHtml(item.text)}</span>
            <small>${item.at ? formatTime(item.at) : ''}</small>
        </div>
    `).join('');
    box.scrollTop = box.scrollHeight;
}

function openVaHistory() {
    renderVaHistory();
    openModal('va-history-modal');
}

function clearVaHistory() {
    vaHistoryEpoch++;
    vaHistory = [];
    localStorage.removeItem(VA_HISTORY_KEY);
    renderVaHistory();
    // The floating bubbles are the same conversation, still on screen. An
    // assistant bubble is pushed with persist:true and is only dismissed when
    // its spoken line finishes, so with voice muted - or when the speech
    // engine never fires its end callback - it stays up indefinitely. Leaving
    // them there after a clear leaves the conversation visibly present next to
    // the avatar, which is the other half of "Clear does not clear".
    clearVaBubbles();
    // Anything still being read aloud belongs to the conversation as well.
    try { window.speechSynthesis.cancel(); } catch (e) { /* no speech engine */ }
    showToast('Conversation history cleared', 'info');
}

// Retires every bubble at once. Iterated over a static copy because retiring
// mutates the live NodeList the selector returns.
function clearVaBubbles() {
    const wrap = document.getElementById('va-bubbles');
    if (!wrap) return;
    Array.from(wrap.querySelectorAll('.va-bubble')).forEach(retireVaBubble);
}

// ── VOICE OUTPUT + LIP SYNC ───────────────────────────────────────
function toggleVaMute() {
    vaMuted = !vaMuted;
    localStorage.setItem('vaMuted', vaMuted);
    updateMuteButtonUI();

    if (vaMuted && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        stopLipSync();
        if (vaState === 'speaking') setVaState('idle');
    } else if (!vaMuted) {
        speakAloud('Voice output enabled.');
    }
}

function updateMuteButtonUI() {
    const btn = document.getElementById('va-mute-btn');
    if (!btn) return;
    btn.classList.toggle('muted', vaMuted);
    btn.innerHTML = vaMuted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
}

// Voice synthesis drives the speaking animation: the avatar's mouth opens while
// the utterance plays, and word boundaries punch the jaw open where supported.
function speakAloud(text, onDone) {
    if (!text) return;
    if (vaMuted || !window.speechSynthesis) {
        // Text output stays available even with audio muted — just skip the speaking state.
        if (vaState !== 'listening') setVaState('idle');
        if (typeof onDone === 'function') onDone();
        return;
    }

    window.speechSynthesis.cancel();

    const cleanText = text.replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    synthesisSpeech = new SpeechSynthesisUtterance(cleanText);
    synthesisSpeech.rate = 1;
    synthesisSpeech.pitch = 1.08; // slightly warmer nurse voice

    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith('en') && /female|zira|samantha|google/i.test(v.name)) ||
                  voices.find(v => v.lang.startsWith('en')) ||
                  voices[0];
    if (voice) synthesisSpeech.voice = voice;

    synthesisSpeech.onstart = () => {
        setVaState('speaking');
        startLipSync();
    };
    synthesisSpeech.onboundary = () => {
        // Real word boundary → force a full mouth opening for that syllable.
        mouthTarget = 1;
        nextSyllableAt = performance.now() + 90;
    };
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        stopLipSync();
        if (vaState === 'speaking' || vaState === 'thinking') setVaState('idle');
        if (typeof onDone === 'function') onDone();
    };
    synthesisSpeech.onend = finish;
    synthesisSpeech.onerror = finish;

    window.speechSynthesis.speak(synthesisSpeech);

    // Safety net: if the browser never fires onstart (autoplay policy, no voices),
    // don't strand the avatar in the thinking state.
    setTimeout(() => {
        if (vaState === 'thinking' && !window.speechSynthesis.speaking) finish();
    }, 1500);
}

function setMouthOpen(value) {
    const stage = document.getElementById('va-stage');
    if (stage) stage.style.setProperty('--va-mouth', Math.max(0, Math.min(1, value)).toFixed(3));
}

// Approximates visemes with a syllable clock; onboundary events sync it to real words.
function startLipSync() {
    stopLipSync();
    mouthTarget = 0.6;
    mouthValue = 0;
    nextSyllableAt = 0;

    const tick = (now) => {
        // Chrome sometimes drops the utterance's onend, which would otherwise leave this
        // ticker running at 60fps forever. The synthesizer itself is the source of truth.
        if (window.speechSynthesis && !window.speechSynthesis.speaking) { stopLipSync(); return; }
        if (now >= nextSyllableAt) {
            mouthTarget = 0.35 + Math.random() * 0.65;
            nextSyllableAt = now + 90 + Math.random() * 90;
        }
        mouthTarget *= 0.9;
        mouthValue += (mouthTarget - mouthValue) * 0.4;
        setMouthOpen(mouthValue);
        lipSyncRaf = requestAnimationFrame(tick);
    };
    lipSyncRaf = requestAnimationFrame(tick);
}

function stopLipSync() {
    if (lipSyncRaf) cancelAnimationFrame(lipSyncRaf);
    lipSyncRaf = null;
    mouthTarget = 0;
    mouthValue = 0;
    setMouthOpen(0);
}

// ── VOICE INPUT ───────────────────────────────────────────────────
// Continuous + interim recognition so we can see speech arriving in real time.
// A single debounced timer (VA_SILENCE_TIMEOUT_MS) is reset on every result —
// interim or final — and left to run out when the user goes quiet. When it fires,
// we stop recognition ourselves rather than waiting on the browser's own cutoff,
// which is what gives us an exact, predictable 3-second silence window.
function startSpeechRecognition() {
    const profile = vaSpeechProfile();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Opera is checked before the API is, because it sometimes exposes the
    // constructor and then fails every session with a network error - which
    // would otherwise be reported as a lost internet connection the customer
    // cannot do anything about.
    if (!SpeechRecognition || !profile.speechUsable) {
        pushVaBubble('assistant', profile.isOpera
            ? VA_SPEECH_ERRORS['opera']
            : VA_SPEECH_ERRORS['unsupported']);
        focusVaTypedInput();
        return;
    }
    if (isListening) return;

    // Drop any previous session first: a stale object's late onend/onerror would
    // otherwise fire into this one, clearing isListening and duplicating messages.
    if (recognition) {
        recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
        try { recognition.abort(); } catch (e) { /* already stopped */ }
        recognition = null;
    }

    recognition = new SpeechRecognition();
    // Per engine - see vaSpeechProfile. Chromium holds one continuous session
    // with live interim text; WebKit is asked for a single utterance and final
    // results only, because it does neither of the other two correctly.
    recognition.continuous = profile.continuous;
    recognition.lang = 'en-US';
    recognition.interimResults = profile.interimResults;
    recognition.maxAlternatives = 1;

    let listeningBubble = null;
    let finalTranscript = '';
    let errorShown = false;
    // Enough state to explain, at the end, why a session produced nothing.
    // Without these, four different outcomes - the browser heard nothing, the
    // session was aborted, our own grace timer ran out, or it simply ended -
    // are indistinguishable to the customer from the microphone switching
    // itself off, which is the whole reason this has been hard to pin down.
    let sawStart = false;      // did onstart ever fire, i.e. did the mic open
    let sawSpeech = false;     // did the browser report any audio it took for speech
    let lastError = null;      // the last error code raised on this session
    let stoppedOnPurpose = false; // our own stop(), from the silence timer or a click
    sessionSerial += 1;
    const sessionId = sessionSerial;

    // One line per lifecycle event, prefixed so it can be filtered in the
    // console. Speech capture is device- and browser-specific and cannot be
    // reproduced from here, so this trace is how a failing session is
    // diagnosed on the machine that actually has the microphone.
    const trace = (event, detail) => {
        console.log(`[VA speech #${sessionId}] ${event}${detail ? ': ' + detail : ''}`);
    };
    speechCancelledByUser = false;
    trace('session created', `engine=${profile.engine} continuous=${recognition.continuous} `
        + `interim=${recognition.interimResults} lang=${recognition.lang}`);

    const armSilenceTimer = (ms) => {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            trace('silence timeout', `${ms}ms elapsed - stopping`);
            stoppedOnPurpose = true;
            if (recognition) { try { recognition.stop(); } catch (e) { /* already stopped */ } }
        }, ms);
    };

    // These four are not used by the state machine; they are only here so the
    // trace can tell "the microphone never opened" apart from "it opened and
    // heard nothing", which need different advice.
    recognition.onaudiostart = () => trace('audio capture started');
    recognition.onspeechstart = () => { sawSpeech = true; trace('speech detected'); };
    recognition.onspeechend = () => trace('speech ended');
    recognition.onaudioend = () => trace('audio capture ended');

    recognition.onstart = () => {
        sawStart = true;
        trace('microphone open');
        isListening = true;
        setVaState('listening');
        // Stop the assistant talking over itself.
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        stopLipSync();
        listeningBubble = pushVaBubble('user', 'Listening…', { persist: true });
        // Grace period to start speaking — much longer than the post-speech cutoff,
        // since it takes a moment to react to the mic turning on.
        armSilenceTimer(VA_INITIAL_LISTEN_TIMEOUT_MS);
    };

    recognition.onresult = (event) => {
        sawSpeech = true;
        armSilenceTimer(VA_SILENCE_TIMEOUT_MS); // speech detected — tighten to the 3s post-speech countdown
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) finalTranscript += transcript + ' ';
            else interim += transcript;
        }
        const preview = (finalTranscript + interim).trim();
        if (listeningBubble && preview) {
            const textEl = listeningBubble.querySelector('.va-bubble-text');
            if (textEl) textEl.textContent = preview;
        }
    };

    // A continuous session can raise several errors in a row (Chrome repeats 'network'
    // and permission failures) — say what went wrong once, then stay quiet.
    //
    // 'aborted' and 'no-speech' still say nothing *here*, because they are
    // normal punctuation for a session that is about to end anyway - but they
    // are recorded, and onend now accounts for them rather than letting the
    // assistant go quiet with no explanation.
    recognition.onerror = (event) => {
        lastError = event.error;
        trace('error', event.error);
        if (event.error === 'aborted' || event.error === 'no-speech') return;
        if (errorShown) return;
        errorShown = true;
        pushVaBubble('assistant', VA_SPEECH_ERRORS[event.error] || VA_SPEECH_ERRORS.default);
    };

    recognition.onend = () => {
        clearTimeout(silenceTimer);
        isListening = false;
        if (vaState === 'listening') setVaState('idle');
        retireVaBubble(listeningBubble);
        listeningBubble = null;

        const text = finalTranscript.trim();
        trace('session ended', `heardSpeech=${sawSpeech} micOpened=${sawStart} `
            + `lastError=${lastError || 'none'} onPurpose=${stoppedOnPurpose} `
            + `transcript=${text ? JSON.stringify(text) : 'empty'}`);

        if (text) {
            beginVaTurn();
            pushVaBubble('user', text);
            addVaHistory('user', text);
            processVoiceCommand(text);
            return;
        }

        // Nothing was captured. Something has to be said, or the avatar simply
        // drops back to Idle and the customer is left thinking the assistant
        // switched itself off - which is exactly how this reads today.
        if (errorShown) return; // onerror already explained it
        // The customer clicked to stop, or double-clicked for history and
        // cancelled the session that first click started. They know why it
        // stopped; saying "I didn't hear anything" would be noise.
        if (speechCancelledByUser) { trace('cancelled by the customer'); return; }

        if (!sawStart) {
            // start() resolved but the browser never opened the microphone.
            // Safari and older mobile browsers expose webkitSpeechRecognition
            // and then do this, which is why the support check at the top of
            // this function is not enough on its own.
            pushVaBubble('assistant', VA_SPEECH_ERRORS['mic-never-opened']);
        } else if (!sawSpeech) {
            pushVaBubble('assistant', VA_SPEECH_ERRORS['heard-nothing']);
        } else {
            pushVaBubble('assistant', VA_SPEECH_ERRORS['nothing-usable']);
        }
    };

    // Claim the listening state before start() resolves: onstart can lag past the
    // avatar's 260ms click delay, and until it fires a second click would open a
    // rival session on the same microphone.
    isListening = true;
    try {
        recognition.start();
    } catch (e) {
        console.error('Speech recognition failed to start:', e);
        isListening = false;
        setVaState('idle');
        pushVaBubble('assistant', VA_SPEECH_ERRORS.default);
    }
}

// Manual stop (second click / Enter) goes through the same recognition.stop() path
// as the silence timer, so transcript finalization only ever happens in one place: onend.
function stopSpeechRecognition() {
    clearTimeout(silenceTimer);
    // Distinguishes "the customer stopped it" from "it went quiet on its own",
    // which onend needs in order to decide whether silence deserves an
    // explanation.
    speechCancelledByUser = true;
    if (recognition) {
        try { recognition.stop(); } catch (e) { /* already stopped */ }
    }
}

// ── DIALOGUE CONTROLLER ───────────────────────────────────────────
// Deterministic queue intents are answered locally from live status (instant, no API).
// Everything else goes to /api/assistant/dialogue, which handles service FAQs,
// arithmetic, and queue dispatch, and returns a resolved action for the client.
async function processVoiceCommand(text) {
    const query = String(text || '').toLowerCase().trim();
    if (!query) return;
    setVaState('thinking');

    try {
        // Plain greeting — brief intro only, no capability laundry list.
        if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(query)) {
            vaSay("Hello! I'm your virtual nurse assistant.");
            return;
        }

        // Explicit capability question — state what it can do, only when asked.
        if (/who are you|what (can|do) you do|what are you|how can you help/.test(query)) {
            vaSay('I can answer questions about our services and prices, do quick calculations, and help you join a queue.');
            return;
        }

        if (/\b(status|my ticket|my number|my position|what.?s my queue)\b/.test(query) ||
            (/\bqueue\b/.test(query) && !/\b(join|enqueue|line me|book|put me|cancel|leave)\b/.test(query))) {
            await answerQueueStatus();
            return;
        }

        if (/\b(wait|how long|eta|estimate)\b/.test(query) && !/\b(cost|price|much)\b/.test(query)) {
            await answerWaitTime();
            return;
        }

        // Service FAQ · calculation · queue dispatch
        const res = await fetch('/api/assistant/dialogue', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ text, history: vaHistory.slice(-6) })
        });
        if (!res.ok) throw new Error('Assistant request failed');
        const data = await res.json();

        vaSay(data.reply);
        executeVaAction(data.action);
    } catch (err) {
        console.error('Assistant error:', err);
        vaSay("I'm having trouble reaching the clinic assistant right now. Please try again in a moment.");
    }
}

// Executes the action the dialogue controller resolved. Queue dispatch always
// routes through the existing preview/confirm flow — the nurse never queues silently.
function executeVaAction(action) {
    if (!action || action.type === 'none') return;

    switch (action.type) {
        case 'join_queue':
            if (action.package_id && typeof vaStartPackageFlow === 'function') {
                vaStartPackageFlow(action.package_id);
            }
            break;
        case 'cancel_queue':
            if (typeof cancelQueue === 'function') cancelQueue();
            break;
        case 'show_status':
            navigateTo('dashboard');
            break;
        case 'open_services':
            navigateTo('services');
            break;
    }
}

async function answerQueueStatus() {
    const res = await fetch('/api/queue/my-status', { headers: authHeaders() });
    const status = await res.json();
    if (!status.active) {
        vaSay('You do not have an active ticket right now. Tell me which service you need and I can queue you for it.');
        return;
    }
    const station = status.steps.find(s => s.status === 'active')?.name || 'the front desk';
    vaSay(`Your ticket is ${status.current_queue?.number || 'pending'}. You are at ${station} with ${status.people_ahead} ahead of you, and about ${status.estimated_time} minutes to go.`);
    navigateTo('dashboard');
}

async function answerWaitTime() {
    const res = await fetch('/api/queue/my-status', { headers: authHeaders() });
    const status = await res.json();
    if (!status.active) {
        vaSay('You have no active ticket. Check in at the front desk usually takes about ten minutes per station.');
        return;
    }
    const next = status.steps.find(s => s.status === 'pending');
    const tail = next ? ` After that, ${next.name} starts in roughly ${next.eta_minutes} minutes.` : '';
    vaSay(`Your estimated remaining wait is ${status.estimated_time} minutes.${tail}`);
}
