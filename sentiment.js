// sentiment.js — a JavaScript port of VADER (Valence Aware Dictionary and
// sEntiment Reasoner), the lexicon- and rule-based model from Hutto & Gilbert
// (ICWSM 2014). The `vader-sentiment` package is that same algorithm ported to
// JS, so this runs in the existing Node image with no Python and no network.
//
// Scope note: VADER scores *valence* (how positive or negative), not topics. The
// issue rules below are a small keyword layer on top, because "the line is slow"
// and "everything was perfect" can carry the same sentiment but are not the same
// message to the clinic.
const vader = require('vader-sentiment');

const LABELS = { pos: 'Positive', neu: 'Neutral', neg: 'Negative' };

// VADER's documented thresholds on the normalized compound score.
function classify(compound) {
    if (compound >= 0.05) return 'Positive';
    if (compound <= -0.05) return 'Negative';
    return 'Neutral';
}

const ISSUE_RULES = [
    { label: 'Long wait times', re: /\b(wait|waiting|slow|delayed|delay|line|queue)\b/i },
    { label: 'Staff attitude', re: /\b(rude|unfriendly|attitude|disrespect|impolite)\b/i },
    { label: 'Unclear instructions', re: /\b(confus|unclear|didn'?t know|not sure where|no direction)\b/i },
    { label: 'Cleanliness', re: /\b(dirty|unclean|messy|filthy)\b/i },
    { label: 'Cost / billing', re: /\b(expensive|overpriced|cost|price|charge|bill|payment|receipt)\b/i }
];

function analyzeSentiment(text) {
    const clean = String(text || '').trim();
    if (!clean) {
        return { label: 'Neutral', compound: 0, scores: { pos: 0, neu: 1, neg: 0 }, issues: [] };
    }
    const scores = vader.SentimentIntensityAnalyzer.polarity_scores(clean);
    return {
        label: classify(scores.compound),
        compound: Math.round(scores.compound * 10000) / 10000,
        scores: { pos: scores.pos, neu: scores.neu, neg: scores.neg },
        issues: ISSUE_RULES.filter(r => r.re.test(clean)).map(r => r.label)
    };
}

module.exports = { analyzeSentiment, classify, ISSUE_RULES, LABELS };
