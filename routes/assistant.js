const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const multer = require('multer');
const aiServices = require('../ai_services');
const { buildCustomerStatus } = require('./queue');

/**
 * Loads the live clinic context the assistant is allowed to reason over:
 * active packages (prices, durations, lab steps) and this customer's queue state.
 * Everything the assistant says about prices or wait times comes from here.
 */
async function loadAssistantContext(user) {
    const [packages] = await pool.query(
        `SELECT sp.id, sp.name, sp.description, sp.price, sp.est_time_minutes, d.name as doctor_name
         FROM service_packages sp
         LEFT JOIN doctors d ON sp.doctor_id = d.id AND d.archived = false
         WHERE sp.is_active = true AND sp.archived = false
         ORDER BY sp.name`
    );

    for (const pkg of packages) {
        const [labs] = await pool.query(
            `SELECT l.name as lab_name, l.service_type
             FROM package_laboratories pl
             JOIN laboratories l ON pl.laboratory_id = l.id
             WHERE pl.package_id = ? AND pl.archived = false AND l.archived = false
             ORDER BY pl.sequence_order`, [pkg.id]
        );
        pkg.laboratories = labs.map(l => l.lab_name);
    }

    const status = await buildCustomerStatus(user.id);
    const queue = status.active ? {
        active: true,
        ticket: status.current_queue ? status.current_queue.number : '--',
        current_station: status.steps.find(s => s.status === 'active')?.name || 'Front Desk',
        package_id: status.sequence.package_id,
        package_name: status.sequence.package_name,
        people_ahead: status.people_ahead,
        estimated_time: status.estimated_time,
        steps: status.steps.map(s => ({ name: s.name, status: s.status, eta_minutes: s.eta_minutes }))
    } : { active: false };

    return {
        packages,
        queue,
        customer_name: user.username || 'the customer',
        customer_category: user.category || 'Regular'
    };
}

/**
 * Resolves an LLM-proposed package name to a real package id.
 * Exact match first, then a word-overlap match, so "join the ultrasound queue"
 * still routes to "Ultrasound Screening".
 */
function resolvePackage(packages, name) {
    if (!name) return null;
    const wanted = String(name).toLowerCase().trim();
    const exact = packages.find(p => p.name.toLowerCase() === wanted);
    if (exact) return exact;
    return packages.find(p => {
        const pkgName = p.name.toLowerCase();
        return pkgName.includes(wanted) || wanted.includes(pkgName) ||
            pkgName.split(/\s+/).some(w => w.length > 3 && wanted.includes(w));
    }) || null;
}

/**
 * POST /api/assistant/dialogue
 * Body: { text, history: [{ role, text }] }
 * Returns: { reply, intent, action: { type, package_id, package_name, price } }
 *
 * The route never mutates the queue itself. It returns a resolved action and the
 * client confirms with the customer before calling /api/queue/start-package or /cancel.
 */
router.post('/dialogue', async (req, res) => {
    const { text, history } = req.body;
    if (!text || !String(text).trim()) {
        return res.status(400).json({ error: 'No input text provided' });
    }

    try {
        const context = await loadAssistantContext(req.user);
        const result = await aiServices.assistantDialogue({
            text: String(text).slice(0, 500),
            history: Array.isArray(history) ? history : [],
            context
        });

        const action = { type: result.action?.type || 'none', package_id: null, package_name: '', price: null };
        if (action.type === 'join_queue') {
            const pkg = resolvePackage(context.packages, result.action.package_name);
            if (pkg) {
                action.package_id = pkg.id;
                action.package_name = pkg.name;
                action.price = pkg.price;
            } else {
                // Named package could not be matched — downgrade to browsing rather than queueing blindly.
                action.type = 'open_services';
            }
        }
        if (action.type === 'cancel_queue' && !context.queue.active) {
            action.type = 'none';
        }

        // One visit at a time. Refused here, in the reply that is spoken, rather
        // than walking the customer through the service preview only for
        // /start-package to refuse at the last button. The model's own reply
        // ("Shall I queue you...") is replaced, not appended to.
        let reply = result.reply;
        if (action.type === 'join_queue' && context.queue.active) {
            const current = `You are already in the queue for ${context.queue.package_name}, ticket ${context.queue.ticket}.`;
            reply = action.package_id === context.queue.package_id
                ? `${current} You cannot join the same service twice.`
                : `${current} Please finish or cancel that visit before availing another service.`;
            Object.assign(action, { type: 'show_status', package_id: null, package_name: '', price: null });
        }

        res.json({ reply, intent: result.intent, action, queue_active: context.queue.active });
    } catch (err) {
        console.error('Assistant dialogue error:', err);
        res.status(500).json({ error: 'Assistant is unavailable right now' });
    }
});

// ── VOICE FOR BROWSERS WITHOUT A RECOGNISER ──────────────────────────────────
// Chrome, Firefox and Edge on iPhone, plus Firefox and Opera, cannot turn speech
// into text themselves. There the page records the question and posts it here,
// and OpenAI's transcription API returns the text, which then takes the same
// /dialogue path as recognised speech. Off unless OPENAI_API_KEY is set.
//
// Every clip is a paid request with no free tier, hence the caps: the page stops
// a recording at 15 seconds, the upload is bounded far above that, and each
// account gets a fixed number of clips per window.
const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
// ponytail: per-process memory, reset on every deploy; move to the DB if the
// service ever runs more than one instance.
const TRANSCRIBE_LIMIT = 20;
const TRANSCRIBE_WINDOW_MS = 10 * 60 * 1000;
const transcribeLog = new Map();

router.get('/voice', (req, res) => {
    res.json({ transcribe: aiServices.transcriptionConfigured() });
});

router.post('/transcribe', (req, res) => {
    if (!aiServices.transcriptionConfigured()) {
        return res.status(503).json({ error: 'Voice input is not available right now. Please type your question.' });
    }
    // Checked before the upload is read, so a refused request costs nothing.
    const now = Date.now();
    const recent = (transcribeLog.get(req.user.id) || []).filter(t => now - t < TRANSCRIBE_WINDOW_MS);
    if (recent.length >= TRANSCRIBE_LIMIT) {
        return res.status(429).json({ error: 'You have used voice a lot in the last few minutes. Please type your question for now.' });
    }
    voiceUpload.single('audio')(req, res, async (err) => {
        if (err || !req.file) {
            return res.status(400).json({ error: "I couldn't receive that recording. Please try again." });
        }
        recent.push(now);
        transcribeLog.set(req.user.id, recent);
        const text = await aiServices.transcribeSpeech(req.file.buffer, req.file.mimetype);
        if (text === null) {
            return res.status(502).json({ error: "I couldn't make out the recording. Please try again, or type your question." });
        }
        res.json({ text });
    });
});

module.exports = router;
