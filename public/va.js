/* ================================================================
   VOICE AI Virtual Assistant — Speech Recognition & Synthesis
   ================================================================ */

let vaMuted = localStorage.getItem('vaMuted') === 'true';
let recognition = null;
let isListening = false;
let synthesisSpeech = null;
let vaHoldActive = false;
let vaReleaseUntil = 0;
const vaHistory = [];

// Initialize mute UI state on load
document.addEventListener('DOMContentLoaded', () => {
    updateMuteButtonUI();
    bindVaListeners();
    renderVaHistory();
});

// Toggle Voice Assistant Panel
function toggleVaWidget() {
    const widget = document.getElementById('va-widget');
    const fab = document.querySelector('.va-fab');
    if (!widget) return;
    
    const isOpen = widget.classList.toggle('open');
    if (isOpen) {
        setVaStatus('idle');
        renderVaHistory();
    }
    if (!isOpen && isListening) {
        stopSpeechRecognition();
    }
    
    // Stop speaking if closed
    if (!isOpen && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
}

function bindVaListeners() {
    const fab = document.querySelector('.va-fab');
    const actionBtn = document.getElementById('va-action-btn');
    const widget = document.getElementById('va-widget');

    let fabHoldTimeout = null;
    let wasHold = false;

    if (fab) {
        const startFabHold = (event) => {
            event.preventDefault();
            if (isListening) return; // already listening
            wasHold = false;
            
            fabHoldTimeout = setTimeout(() => {
                wasHold = true;
                // Open the widget if it's not open so the user sees results
                if (widget && !widget.classList.contains('open')) {
                    toggleVaWidget();
                }
                startSpeechRecognition();
            }, 250);
        };

        const endFabHold = (event) => {
            event.preventDefault();
            if (fabHoldTimeout) {
                clearTimeout(fabHoldTimeout);
                fabHoldTimeout = null;
            }
            if (wasHold) {
                stopSpeechRecognition(true);
            }
        };

        const cancelFabHold = (event) => {
            if (fabHoldTimeout) {
                clearTimeout(fabHoldTimeout);
                fabHoldTimeout = null;
            }
            if (wasHold) {
                stopSpeechRecognition(true);
                wasHold = false;
            }
        };

        fab.addEventListener('pointerdown', startFabHold);
        fab.addEventListener('pointerup', endFabHold);
        fab.addEventListener('pointercancel', cancelFabHold);
        fab.addEventListener('pointerleave', cancelFabHold);

        fab.addEventListener('click', (event) => {
            if (wasHold) {
                // Intercept and prevent the click handler from toggling the panel
                event.preventDefault();
                event.stopPropagation();
                wasHold = false;
            } else {
                toggleVaWidget();
            }
        });
    }

    if (actionBtn) {
        actionBtn.addEventListener('click', (event) => {
            event.preventDefault();
            if (isListening) {
                stopSpeechRecognition(true);
            } else {
                startSpeechRecognition();
            }
        });
    }
}

function setVaStatus(state, message) {
    const widget = document.getElementById('va-widget');
    const fab = document.querySelector('.va-fab');
    const actionBtn = document.getElementById('va-action-btn');
    const status = document.getElementById('va-status');
    [widget, fab, actionBtn].forEach(el => {
        if (!el) return;
        el.classList.remove('listening', 'processing', 'released');
        if (state !== 'idle') el.classList.add(state);
    });
    if (status) {
        status.textContent = message || (state === 'listening' ? 'Listening' : state === 'processing' ? 'Processing' : state === 'released' ? 'Stopped' : 'Idle');
    }
    if (actionBtn) {
        const labels = {
            idle: '<i class="fa-solid fa-microphone"></i> Click to Speak',
            listening: '<i class="fa-solid fa-microphone-slash"></i> Stop Listening',
            processing: '<i class="fa-solid fa-spinner fa-spin"></i> Processing...',
            released: '<i class="fa-solid fa-circle-stop"></i> Stopped'
        };
        actionBtn.innerHTML = labels[state] || labels.idle;
    }
}

function addVaHistory(role, text) {
    if (!text) return;
    vaHistory.push({ role, text });
    if (vaHistory.length > 8) vaHistory.shift();
    renderVaHistory();
}

function renderVaHistory() {
    const box = document.getElementById('va-history');
    if (!box) return;
    if (vaHistory.length === 0) {
        box.innerHTML = '<div class="va-history-empty">No conversation yet.</div>';
        return;
    }
    box.innerHTML = vaHistory.map(item => `
        <div class="va-history-item ${item.role}">
            <strong>${item.role === 'user' ? 'You' : 'Assistant'}</strong>
            <span>${escapeHtml(item.text)}</span>
        </div>
    `).join('');
    box.scrollTop = box.scrollHeight;
}

// Toggle Mute Audio Output
function toggleVaMute() {
    vaMuted = !vaMuted;
    localStorage.setItem('vaMuted', vaMuted);
    updateMuteButtonUI();
    
    if (vaMuted && window.speechSynthesis) {
        window.speechSynthesis.cancel(); // Stop talking instantly
    } else if (!vaMuted) {
        speakAloud("Voice audio output enabled.");
    }
}

function updateMuteButtonUI() {
    const btn = document.getElementById('va-mute-btn');
    if (!btn) return;
    btn.innerHTML = vaMuted 
        ? '<i class="fa-solid fa-volume-xmark"></i>' 
        : '<i class="fa-solid fa-volume-high"></i>';
}

// Speak text aloud using SpeechSynthesis
function speakAloud(text) {
    if (vaMuted || !window.speechSynthesis) return;

    // Cancel active speech
    window.speechSynthesis.cancel();

    // Clean text of markdown links or tags
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    synthesisSpeech = new SpeechSynthesisUtterance(cleanText);
    
    // Attempt to select a clear natural English voice if available
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) || 
                  voices.find(v => v.lang.startsWith('en')) || 
                  voices[0];
    if (voice) synthesisSpeech.voice = voice;

    window.speechSynthesis.speak(synthesisSpeech);
}

// Start Speech Recognition
function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Speech Recognition not supported in this browser. Please type or use Chrome.', 'error');
        document.getElementById('va-response').textContent = "Voice recognition is not supported by your browser. Please use Google Chrome.";
        return;
    }

    if (isListening) {
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const widget = document.getElementById('va-widget');
    const orb = document.getElementById('va-orb');
    const actionBtn = document.getElementById('va-action-btn');
    const transcriptBox = document.getElementById('va-transcript');

    recognition.onstart = () => {
        isListening = true;
        setVaStatus('listening');
        if (orb) orb.classList.add('listening');
        transcriptBox.textContent = "Listening...";
        
        // Stop any active speech synthesis so it doesn't listen to itself
        if (window.speechSynthesis) window.speechSynthesis.cancel();
    };

    recognition.onresult = (event) => {
        const speechResult = event.results[0][0].transcript;
        transcriptBox.textContent = speechResult;
        addVaHistory('user', speechResult);
        processVoiceCommand(speechResult);
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        transcriptBox.textContent = "Sorry, I couldn't hear you clearly. Click below to try again.";
        stopSpeechRecognition(true);
    };

    recognition.onend = () => {
        stopSpeechRecognition(false);
    };

    recognition.start();
}

function stopSpeechRecognition(showRelease = false) {
    isListening = false;
    const widget = document.getElementById('va-widget');
    const orb = document.getElementById('va-orb');
    const actionBtn = document.getElementById('va-action-btn');
    
    if (widget) widget.classList.remove('listening');
    if (orb) orb.classList.remove('listening');
    if (showRelease) {
        vaReleaseUntil = Date.now() + 550;
        setVaStatus('released');
        setTimeout(() => {
            const currentStatus = document.getElementById('va-status')?.textContent;
            if (currentStatus === 'Stopped') setVaStatus('idle');
        }, 550);
    } else if (Date.now() >= vaReleaseUntil) {
        setVaStatus('idle');
    }

    if (recognition) {
        try { recognition.stop(); } catch(e) {}
    }
}

// Command Processing with Intent Matching
async function processVoiceCommand(text) {
    const query = text.toLowerCase().trim();
    const responseBox = document.getElementById('va-response');
    setVaStatus('processing');
    responseBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing command...';

    // 1. Intent Check: Welcome / Greetings
    if (query === 'hello' || query === 'hi' || query.includes('who are you')) {
        const reply = "Hello! I am your Voice AI Assistant. Ask me about your queue status, service pricing, or estimated wait times.";
        responseBox.textContent = reply;
        addVaHistory('assistant', reply);
        setVaStatus('idle');
        speakAloud(reply);
        return;
    }

    // 2. Intent Check: Active Queue Status
    if (query.includes('status') || query.includes('queue') || query.includes('ticket') || query.includes('my position')) {
        try {
            const res = await fetch('/api/queue/my-status', { headers: authHeaders() });
            const status = await res.json();
            if (status.active) {
                const currentStation = status.current_queue 
                    ? (status.current_queue.station_type === 'frontdesk' ? 'Front Desk' : status.steps.find(s=>s.status==='active')?.name || 'next step')
                    : 'your current step';
                const reply = `Your ticket number is ${status.current_queue.number}. You are currently at the ${currentStation}. There are ${status.people_ahead} people ahead of you, and your estimated wait time is ${status.estimated_time} minutes.`;
                responseBox.textContent = reply;
                addVaHistory('assistant', reply);
                setVaStatus('idle');
                speakAloud(reply);
            } else {
                const reply = "You do not have an active queue ticket right now. Go to the Services tab to select a package and join the queue.";
                responseBox.textContent = reply;
                addVaHistory('assistant', reply);
                setVaStatus('idle');
                speakAloud(reply);
            }
        } catch(e) {
            responseBox.textContent = "Error fetching queue status.";
            setVaStatus('idle');
        }
        return;
    }

    // 3. Intent Check: Wait Time Estimation
    if (query.includes('wait') || query.includes('how long') || query.includes('eta') || query.includes('time')) {
        try {
            const res = await fetch('/api/queue/my-status', { headers: authHeaders() });
            const status = await res.json();
            if (status.active) {
                const reply = `Your estimated wait time is ${status.estimated_time} minutes.`;
                responseBox.textContent = reply;
                addVaHistory('assistant', reply);
                setVaStatus('idle');
                speakAloud(reply);
            } else {
                const reply = "You do not have an active ticket. Average waiting time for check-ins is around ten minutes per station.";
                responseBox.textContent = reply;
                addVaHistory('assistant', reply);
                setVaStatus('idle');
                speakAloud(reply);
            }
        } catch(e) {
            responseBox.textContent = "Error fetching wait time.";
            setVaStatus('idle');
        }
        return;
    }

    // 4. Intent Check: Price Matching (General Pricing FAQs)
    if (query.includes('price') || query.includes('how much') || query.includes('cost') || query.includes('package') || query.includes('service')) {
        try {
            const res = await fetch('/api/packages');
            const packages = await res.json();
            
            // Look for specific package name matches
            let foundPkg = null;
            for (const p of packages) {
                if (query.includes(p.name.toLowerCase()) || p.name.toLowerCase().split(/\s+/).some(word => word.length > 3 && query.includes(word))) {
                    foundPkg = p;
                    break;
                }
            }

            if (foundPkg) {
                const reply = `The price for ${foundPkg.name} is ${formatCurrency(foundPkg.price)}. The estimated processing time is ${foundPkg.est_time_minutes} minutes.`;
                responseBox.textContent = reply;
                addVaHistory('assistant', reply);
                setVaStatus('idle');
                speakAloud(reply);
            } else {
                // Return generic pricing list
                const reply = "Available packages include Complete Blood Count for 450 pesos, Ultrasound for 2800 pesos, and Pre employment Medical for 3500 pesos. You can browse the full price list in the Services tab.";
                responseBox.textContent = reply;
                addVaHistory('assistant', reply);
                setVaStatus('idle');
                speakAloud(reply);
            }
        } catch(e) {
            responseBox.textContent = "Error loading package pricing list.";
            setVaStatus('idle');
        }
        return;
    }

    const reply = "I can help with queue status, estimated wait time, and service pricing. Please ask one of those clinic service questions.";
    responseBox.textContent = reply;
    addVaHistory('assistant', reply);
    speakAloud(reply);
    setVaStatus('idle');
}
