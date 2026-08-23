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

let vaState = 'idle';
let vaMuted = localStorage.getItem('vaMuted') === 'true';
let recognition = null;
let isListening = false;
let silenceTimer = null;
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

// Active (listening): mic-on icon, green background. Inactive: mic-off icon, red background.
function updateMicButtonUI(isActive) {
    const btn = document.getElementById('va-action-btn');
    if (!btn) return;
    btn.classList.toggle('mic-active', isActive);
    btn.innerHTML = isActive
        ? '<i class="fa-solid fa-microphone"></i>'
        : '<i class="fa-solid fa-microphone-slash"></i>';
    btn.setAttribute('aria-label', isActive ? 'Stop listening' : 'Talk to the nurse assistant');
}

// ── FLOATING SPEECH BUBBLES ───────────────────────────────────────
// Replaces the old fixed chat panel: bubbles float above the avatar and
// retire on their own, keeping the dashboard visible underneath.
function pushVaBubble(role, text, options = {}) {
    const wrap = document.getElementById('va-bubbles');
    if (!wrap || !text) return null;

    const bubble = document.createElement('div');
    bubble.className = `va-bubble ${role}`;
    bubble.innerHTML = `
        <span class="va-bubble-role">${role === 'user' ? 'You' : 'Nurse'}</span>
        <span class="va-bubble-text">${escapeHtml(text)}</span>
    `;
    wrap.appendChild(bubble);

    // Keep the stack shallow so the avatar is never buried.
    while (wrap.children.length > VA_MAX_BUBBLES) {
        retireVaBubble(wrap.firstElementChild);
    }

    if (!options.persist) {
        const readMs = Math.min(12000, Math.max(3500, text.length * 70));
        bubble.dataset.timer = setTimeout(() => retireVaBubble(bubble), readMs);
    }
    return bubble;
}

function retireVaBubble(bubble) {
    if (!bubble) return;
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
    const actionBtn = document.getElementById('va-action-btn');

    const toggleListening = () => {
        if (isListening) stopSpeechRecognition();
        else startSpeechRecognition();
    };

    if (avatar) {
        let clickTimer = null;

        avatar.addEventListener('click', (event) => {
            event.preventDefault();
            // Defer the tap action so a second click can claim it as a double-click.
            if (clickTimer) return;
            clickTimer = setTimeout(() => {
                clickTimer = null;
                toggleListening();
            }, 260);
        });

        // Gesture: double-click the nurse to open the full conversation history.
        avatar.addEventListener('dblclick', (event) => {
            event.preventDefault();
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
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

    if (actionBtn) {
        actionBtn.addEventListener('click', (event) => {
            event.preventDefault();
            toggleListening();
        });
    }
}

// ── CONVERSATION HISTORY ──────────────────────────────────────────
function loadVaHistory() {
    try {
        const stored = JSON.parse(localStorage.getItem(VA_HISTORY_KEY) || '[]');
        return Array.isArray(stored) ? stored.slice(-50) : [];
    } catch (e) { return []; }
}

function addVaHistory(role, text) {
    if (!text) return;
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
    vaHistory = [];
    localStorage.removeItem(VA_HISTORY_KEY);
    renderVaHistory();
    showToast('Conversation history cleared', 'info');
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
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Speech recognition needs Google Chrome.', 'error');
        pushVaBubble('assistant', 'Voice input is not supported by this browser. Please use Google Chrome.');
        return;
    }
    if (isListening) return;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let listeningBubble = null;
    let finalTranscript = '';

    const armSilenceTimer = (ms) => {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (recognition) { try { recognition.stop(); } catch (e) { /* already stopped */ } }
        }, ms);
    };

    recognition.onstart = () => {
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

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error !== 'aborted' && event.error !== 'no-speech') {
            pushVaBubble('assistant', "I couldn't hear that clearly. Click the nurse and try again.");
        }
    };

    recognition.onend = () => {
        clearTimeout(silenceTimer);
        isListening = false;
        if (vaState === 'listening') setVaState('idle');
        retireVaBubble(listeningBubble);
        listeningBubble = null;

        const text = finalTranscript.trim();
        if (text) {
            pushVaBubble('user', text);
            addVaHistory('user', text);
            processVoiceCommand(text);
        }
    };

    recognition.start();
}

// Manual stop (second click / Enter) goes through the same recognition.stop() path
// as the silence timer, so transcript finalization only ever happens in one place: onend.
function stopSpeechRecognition() {
    clearTimeout(silenceTimer);
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
