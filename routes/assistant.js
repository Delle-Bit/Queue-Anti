const express = require('express');
const router = express.Router();
const { pool } = require('../database');
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

        res.json({ reply: result.reply, intent: result.intent, action, queue_active: context.queue.active });
    } catch (err) {
        console.error('Assistant dialogue error:', err);
        res.status(500).json({ error: 'Assistant is unavailable right now' });
    }
});

module.exports = router;
