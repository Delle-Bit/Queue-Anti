const axios = require('axios');
const { pool } = require('./database.js');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const dotenv = require('dotenv');
dotenv.config();

// NVIDIA fallback configuration (store token in .env as NVIDIA_API_KEY)
const NV_INVOKE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NV_API_KEY = process.env.NVIDIA_API_KEY;

// Gemini configuration (store token in .env as GEMINI_API_KEY) - primary provider for the Virtual Assistant
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Pytesseract OCR script path - configurable via env var, fallback to project-local script
const PYTESSERACT_SCRIPT = process.env.PYTESSERACT_SCRIPT || path.join(__dirname, 'pytesseract_ocr.py');

/**
 * Calls NVIDIA's Nemotron‑3 model as a fallback.
 * The `data` argument is stringified and sent as the user message.
 * Returns null if NVIDIA_API_KEY is not configured.
 */
async function nvidiaFallback(data) {
  if (!NV_API_KEY) {
    console.warn('[NVIDIA Fallback] NVIDIA_API_KEY not configured, skipping NVIDIA fallback');
    return null;
  }

  const payload = {
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    messages: [{ role: 'user', content: typeof data === 'string' ? data : JSON.stringify(data) }],
    temperature: 1,
    top_p: 0.95,
    max_tokens: 16384,
    reasoning_budget: 16384,
    chat_template_kwargs: { enable_thinking: true },
    stream: false
  };

  try {
    const res = await axios.post(NV_INVOKE_URL, payload, {
      headers: {
        Authorization: `Bearer ${NV_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return res.data;
  } catch (e) {
    console.error('[NVIDIA Fallback] Request failed:', e.message);
    return null; // Don't throw, let caller handle
  }
}

/**
 * Calls NVIDIA's chat completion endpoint with a proper system/user message split.
 * Unlike `nvidiaFallback`, this preserves the system prompt and conversation turns,
 * which the Virtual Assistant dialogue controller depends on.
 * Returns the assistant message content string, or null when unavailable.
 */
async function nvidiaChat(systemPrompt, messages) {
  if (!NV_API_KEY) {
    console.warn('[NVIDIA Chat] NVIDIA_API_KEY not configured, skipping LLM dialogue');
    return null;
  }

  const payload = {
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature: 0.3,
    top_p: 0.95,
    max_tokens: 1024,
    chat_template_kwargs: { enable_thinking: false },
    stream: false
  };

  try {
    const res = await axios.post(NV_INVOKE_URL, payload, {
      headers: {
        Authorization: `Bearer ${NV_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return res.data?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('[NVIDIA Chat] Request failed:', e.message);
    return null;
  }
}

/**
 * Calls Google Gemini 2.5 Flash for the Virtual Assistant dialogue.
 * Primary provider for `assistantDialogue`; falls back to `nvidiaChat` when this
 * returns null (missing key, quota, network issue) so a demo never goes silent.
 * Returns the assistant reply text, or null when unavailable.
 */
async function geminiChat(systemPrompt, messages) {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini Chat] GEMINI_API_KEY not configured, skipping');
    return null;
  }

  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.3, topP: 0.95, maxOutputTokens: 1024 }
  };

  try {
    const res = await axios.post(GEMINI_URL, payload, {
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      timeout: 15000
    });
    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('').trim();
    return text || null;
  } catch (e) {
    console.error('[Gemini Chat] Request failed:', e.response?.data?.error?.message || e.message);
    return null;
  }
}

/**
 * System prompt for the clinic Virtual Assistant (nurse persona).
 * Scope is intentionally narrow: service FAQs, on-the-fly arithmetic, and queue dispatch.
 * `context` carries live clinic state so the model never invents prices or wait times.
 */
function buildAssistantSystemPrompt(context = {}) {
  const packages = (context.packages || [])
    .map(p => `- ${p.name} | ₱${Number(p.price || 0).toFixed(2)} | ~${p.est_time_minutes || 0} min | ${p.description || 'no description'}`)
    .join('\n') || '- (no active service packages)';

  const queue = context.queue && context.queue.active
    ? `Ticket ${context.queue.ticket}; currently at "${context.queue.current_station}"; ${context.queue.people_ahead} ahead; ETA ${context.queue.estimated_time} min; remaining steps: ${(context.queue.steps || []).map(s => `${s.name} (${s.status})`).join(', ')}`
    : 'The customer has NO active queue ticket right now.';

  return `You are the Virtual Nurse Assistant for a medical clinic queueing system.
You speak to a customer named ${context.customer_name || 'the customer'} (priority category: ${context.customer_category || 'Regular'}).
Answer in warm, plain English, 1-3 short sentences. The reply is read aloud by a speech synthesizer, so never use markdown, bullet lists, emoji, or symbols like * or #. Write currency as "450 pesos", not "₱450".

You support exactly three capabilities:
1. SERVICE FAQ — answer questions about the services, packages, prices, inclusions, preparation, and clinic flow using ONLY the live data below. If the data does not contain the answer, say so and suggest the Services tab. Never invent a price, a lab test, or a medical diagnosis. For clinical/medical advice, tell the customer the doctor will assess them at the consultation step.
2. CALCULATION — perform arithmetic the customer asks for (totals for several packages, change from a payment, splitting a bill, discount estimates, summed wait times). Show the final number plainly and state what it covers. A Senior or PWD category customer is entitled to a 20 percent discount; apply it only when the customer asks about their own discount, and call it an estimate that the front desk confirms.
3. QUEUE ACTION — when the customer asks to join, enqueue, book, route, or leave a queue, emit an action instead of doing it yourself. Match the requested department or service to one of the packages below. Never claim a customer has been queued; the app performs the action and confirms.

GREETINGS: If the message is just a greeting (hi, hello, hey, good morning, etc.) with nothing else, reply with one short sentence introducing yourself. Do not list your capabilities or ask "how can I help" unless they ask what you can do.

CAPABILITY QUESTIONS: Only when the customer explicitly asks who you are or what you can do, state your three capabilities in one short sentence.

SERVICE LISTS: When the customer asks to see, show, or list the services in general — not naming a specific one, not asking about price — reply with AT MOST 5 service names as a short high-level list (never the full catalog), no prices, no durations, no descriptions, then point to the Services tab for the rest. Set action.type to "open_services". Only give the price, duration, or description of a service when the customer names that specific service or explicitly asks about cost.

LIVE SERVICE PACKAGES:
${packages}

LIVE QUEUE STATUS:
${queue}

DEPARTMENTS / STATIONS: Front Desk (verification and payment), Laboratory (the lab steps in the chosen package), Doctor (consultation).

Reply with ONLY a JSON object, no code fence, in this exact shape:
{"reply":"<what to say aloud>","intent":"faq|calculation|queue_action|smalltalk|out_of_scope","action":{"type":"none|join_queue|cancel_queue|show_status|open_services","package_name":"<exact package name or empty>"}}
Use action.type "none" unless the customer clearly asked for that action.`;
}

/**
 * Deterministic fallback used when the LLM is unavailable.
 * Handles the arithmetic and queue-intent cases locally so the assistant degrades
 * gracefully instead of going silent. Returns the same shape as the LLM path.
 */
function assistantLocalFallback(data) {
  const text = String(data.text || '').toLowerCase().trim();
  const packages = data.context?.packages || [];

  // Arithmetic: evaluate a safe expression built only from digits and operators.
  const spelled = text
    .replace(/\bplus\b|\band\b/g, '+').replace(/\bminus\b|\bless\b/g, '-')
    .replace(/\btimes\b|\bmultiplied by\b|\bx\b/g, '*').replace(/\bdivided by\b|\bover\b/g, '/')
    .replace(/[₱,]/g, '');
  const expr = spelled.match(/-?\d+(?:\.\d+)?(?:\s*[-+*/]\s*-?\d+(?:\.\d+)?)+/);
  if (expr && /(how much|total|compute|calculate|sum|plus|minus|times|divided|[-+*/])/.test(spelled)) {
    const safe = expr[0].replace(/[^0-9+\-*/.\s]/g, '');
    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${safe});`)();
      if (Number.isFinite(value)) {
        return {
          reply: `That comes to ${Math.round(value * 100) / 100}.`,
          intent: 'calculation',
          action: { type: 'none', package_name: '' }
        };
      }
    } catch (e) { /* fall through to other intents */ }
  }

  // Queue dispatch: match a package name mentioned in the request.
  if (/\b(join|enqueue|queue me|line up|book|register|sign me up|route)\b/.test(text)) {
    const match = packages.find(p => {
      const name = String(p.name || '').toLowerCase();
      return text.includes(name) || name.split(/\s+/).some(w => w.length > 3 && text.includes(w));
    });
    if (match) {
      return {
        reply: `Sure. Shall I queue you for ${match.name} at ${Number(match.price).toFixed(0)} pesos?`,
        intent: 'queue_action',
        action: { type: 'join_queue', package_name: match.name }
      };
    }
    return {
      reply: 'I can queue you for a service. Which package would you like? You can also browse them in the Services tab.',
      intent: 'queue_action',
      action: { type: 'open_services', package_name: '' }
    };
  }

  if (/\b(cancel|leave|exit|remove me)\b/.test(text) && /\b(queue|line|ticket)\b/.test(text)) {
    return {
      reply: 'Do you want me to remove you from the queue?',
      intent: 'queue_action',
      action: { type: 'cancel_queue', package_name: '' }
    };
  }

  // Explicit capability question — only state capabilities when asked directly.
  if (/who are you|what (can|do) you do|what are you|how can you help/.test(text)) {
    return {
      reply: 'I can answer questions about our services and prices, do quick calculations, and help you join a queue.',
      intent: 'smalltalk',
      action: { type: 'none', package_name: '' }
    };
  }

  // Service FAQ: price lookup against live packages.
  const priced = packages.find(p => {
    const name = String(p.name || '').toLowerCase();
    return text.includes(name) || name.split(/\s+/).some(w => w.length > 3 && text.includes(w));
  });
  if (priced) {
    return {
      reply: `${priced.name} costs ${Number(priced.price).toFixed(0)} pesos and takes about ${priced.est_time_minutes || 0} minutes.`,
      intent: 'faq',
      action: { type: 'none', package_name: '' }
    };
  }

  const asksServicesList = /\b(services|service|packages|package|offer|offers|options)\b/.test(text);
  if (asksServicesList && packages.length) {
    const asksPrice = /\b(price|cost|how much)\b/.test(text);
    if (asksPrice) {
      const top = packages.slice(0, 3).map(p => `${p.name} at ${Number(p.price).toFixed(0)} pesos`).join(', ');
      return {
        reply: `We offer ${top}. Ask me about any of them, or open the Services tab for the full list.`,
        intent: 'faq',
        action: { type: 'open_services', package_name: '' }
      };
    }
    // High-level list only — just names, no prices or descriptions.
    const names = packages.slice(0, 5).map(p => p.name).join(', ');
    const more = packages.length > 5 ? ', and more' : '';
    return {
      reply: `We offer ${names}${more}. Ask about any one for details, or open the Services tab.`,
      intent: 'faq',
      action: { type: 'open_services', package_name: '' }
    };
  }

  return {
    reply: "I can answer questions about our services and prices, do quick calculations, and queue you for a service. What would you like?",
    intent: 'out_of_scope',
    action: { type: 'none', package_name: '' }
  };
}

/**
 * Normalizes whatever the LLM returned into the assistant response contract.
 * Returns null when the payload cannot be trusted, so the caller can fall back.
 */
function parseAssistantReply(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed.reply) return null;
    return {
      reply: String(parsed.reply).replace(/[*#`]/g, '').trim(),
      intent: ['faq', 'calculation', 'queue_action', 'smalltalk', 'out_of_scope'].includes(parsed.intent) ? parsed.intent : 'faq',
      action: {
        type: ['none', 'join_queue', 'cancel_queue', 'show_status', 'open_services'].includes(parsed.action?.type) ? parsed.action.type : 'none',
        package_name: String(parsed.action?.package_name || '')
      }
    };
  } catch (e) {
    return null;
  }
}

/**
 * Calls the local pytesseract OCR Python script as a first‑level fallback.
 * Expects `data` to be an object with an `image` field (base64 string or URL).
 * Returns a promise that resolves to the OCR JSON result (structured fields if possible).
 * Returns null if script not found or execution fails.
 */
async function pytesseractOcrFallback(data) {
  if (!fs.existsSync(PYTESSERACT_SCRIPT)) {
    console.warn(`[Pytesseract Fallback] Script not found at ${PYTESSERACT_SCRIPT}`);
    return null;
  }

  return new Promise((resolve) => {
    // Settled once, from whichever of the three paths below fires first.
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    let py;
    try {
      py = spawn('python', [PYTESSERACT_SCRIPT]);
    } catch (err) {
      console.warn(`[Pytesseract Fallback] Could not start python: ${err.message}`);
      return done(null);
    }

    // The important one. Without an 'error' listener, a missing `python`
    // binary makes spawn emit an unhandled 'error' event, and an unhandled
    // 'error' on an EventEmitter throws - which crashed the whole server.
    //
    // That is not hypothetical on a deployment: the runtime image has no
    // python at all (the toolchain lives in the build stage and is
    // deliberately left behind), so any registration that got this far - a
    // failed Gemini call, or no GEMINI_API_KEY - took the site down. This
    // fallback is meant to be the safety net, not a second way to fail.
    py.on('error', (err) => {
      console.warn(`[Pytesseract Fallback] python unavailable (${err.code || err.message}) - skipping to the next fallback.`);
      done(null);
    });

    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => (stdout += d));
    py.stderr.on('data', (d) => (stderr += d));
    py.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[Pytesseract Fallback] Script exited ${code}: ${stderr}`);
        done(null);
      } else {
        try {
          done(JSON.parse(stdout));
        } catch (e) {
          console.warn('[Pytesseract Fallback] Failed to parse output:', e.message);
          done(null);
        }
      }
    });

    // Writing to the stdin of a process that never started throws EPIPE, so
    // this needs the same protection as the spawn itself.
    try {
      py.stdin.on('error', () => { /* the 'error' handler above reports it */ });
      py.stdin.write(JSON.stringify(data));
      py.stdin.end();
    } catch (err) {
      console.warn(`[Pytesseract Fallback] Could not write to python: ${err.message}`);
      done(null);
    }
  });
}

/**
 * Mock OCR fallback - returns randomized category detection for testing/offline use.
 * Used when all external OCR services fail.
 */
function mockOcrFallback(data) {
  const rand = Math.random();
  let age, idType, category;
  if (rand < 0.33) {
    age = 65 + Math.floor(Math.random() * 15);
    idType = 'Senior';
    category = 'Senior';
  } else if (rand < 0.5) {
    age = 25 + Math.floor(Math.random() * 30);
    idType = 'PWD';
    category = 'PWD';
  } else {
    age = 20 + Math.floor(Math.random() * 30);
    idType = 'Regular';
    category = 'Regular';
  }
  return {
    name: "Detected Patient",
    age,
    idType,
    category
  };
}


async function checkAIToggle(featureName) {
    try {
        const [rows] = await pool.query('SELECT * FROM ai_settings WHERE id = 1');
        if (rows.length > 0) {
            return rows[0][`${featureName}_enabled`] === 1;
        }
    } catch (e) {
        console.error('Error checking AI toggle', e);
    }
    return true; // default true
}

// Features whose payloads are a customer's identity document. The uploaded
// image is deleted inside the request that reads it, so writing the fields
// lifted off it into ai_logs would put the same data back on disk by another
// route - a name, birth date, ID number and address, indefinitely, in a table
// nothing needs them in. For these, the log records that a scan happened and
// which fields came back, not what they said.
const IDENTITY_FEATURES = /ocr|id scanning/i;

const IDENTITY_SAFE_KEYS = ['idType', 'category', 'source', 'model'];

function redactIdentityPayload(value) {
    if (!value || typeof value !== 'object') return { redacted: true };
    const kept = {};
    for (const key of IDENTITY_SAFE_KEYS) {
        if (value[key] !== undefined && value[key] !== null) kept[key] = value[key];
    }
    // Field names only - enough to tell a failed read from a partial one when
    // somebody asks why a registration prefilled badly.
    kept.fields_returned = Object.keys(value).filter(k =>
        !IDENTITY_SAFE_KEYS.includes(k) && value[k] !== null && value[k] !== '' && value[k] !== 0);
    return kept;
}

async function logAI(feature, input, output) {
    if (IDENTITY_FEATURES.test(String(feature || ''))) {
        input = { redacted: 'identity document' };
        output = redactIdentityPayload(output);
    }
    try {
        await pool.query(
            'INSERT INTO ai_logs (feature, input_data, output_data) VALUES (?, ?, ?)',
            [feature, JSON.stringify(input), JSON.stringify(output)]
        );
    } catch (e) {
        console.error('Error logging AI', e);
    }
}

// HuggingFace retired api-inference.huggingface.co - the hostname no longer
// resolves at all, so every primary call was failing at DNS and falling through
// to the local logic. Inference now goes through the router, which routes to a
// provider: hf-inference is HuggingFace's own. Verified against the live API -
// this path answers, while router.huggingface.co/models/<model> returns 404.
//
// One constant rather than eight literals, and overridable, so the next time
// they move it this is a line in .env instead of a hunt through the file.
const HF_INFERENCE_BASE = process.env.HF_INFERENCE_BASE
  || 'https://router.huggingface.co/hf-inference/models';

const hfModel = (model) => `${HF_INFERENCE_BASE}/${model}`;

// Which features actually have a model behind them.
//
// OCR (trocr, image-to-text) and report generation (gpt2, text-generation) ask
// a model something it can answer, and they now work once the token is valid.
//
// The six analytics features did not. They posted queue figures to
// distilbert-base-uncased, a masked-language model: it replies with fill-mask
// predictions - [{ score, token_str, sequence }] - which have no bearing on how
// long a station takes. Because the primary's response is returned as the
// feature's answer, a *successful* call was worse than a failed one: with a
// working endpoint, `serviceTimeEstimation` returned an object with no
// estimatedMins, and /api/packages/estimate-time answered
// est_time_minutes: null for every station. That went unnoticed only because
// the old hostname had stopped resolving, so the local logic always ran.
//
// So those six pass no endpoint and use their local logic directly, which is
// exactly what they have been doing in practice. To put a real model behind one
// of them, give it an endpoint whose response the feature's caller can actually
// read - not this one.

// HuggingFace wants { inputs: ... }; this code was posting its own shapes
// ({ image: ... }, or a raw analytics object), which a live endpoint rejects as
// a 400. Kept narrow deliberately: it converts what the callers already pass
// into the documented envelope rather than inventing a new one.
function hfPayload(data) {
  if (data == null) return { inputs: '' };
  if (typeof data === 'string') return { inputs: data };
  if (data.image) return { inputs: data.image };
  if (data.inputs !== undefined) return data;
  return { inputs: JSON.stringify(data) };
}

// ── GEMINI ID READER ────────────────────────────────────────────────────
// Primary OCR for registration ID photos.
//
// This replaces microsoft/trocr-base-handwritten, which never had a chance at
// the job: it is a single-line *handwriting* recognizer, and it was being
// handed `{ image: '<file path>' }` - the path string, not the image - so the
// call could not have worked even against a live endpoint. Gemini is
// multimodal: it reads the whole card in one request.
//
// It also returns the fields directly rather than a wall of text, which retires
// the regex guessing in parseSimpleOcr for the common case: responseSchema
// makes the model answer in a fixed JSON shape instead of prose we then have to
// pattern-match. parseSimpleOcr stays for the fallbacks, which still return
// raw text.
//
// The key goes in the x-goog-api-key header rather than ?key= in the URL, so it
// does not end up in an access log or an error message.
const GEMINI_BASE = process.env.GEMINI_BASE
  || 'https://generativelanguage.googleapis.com/v1beta';
// Pinned, not `gemini-flash-latest`: an alias can be repointed at a new model
// underneath a running clinic, and this one reads identity documents. Google
// refuses gemini-2.5-flash for keys issued now ("no longer available to new
// users") and names 3.6-flash as the replacement. Override per deployment with
// GEMINI_OCR_MODEL.
const GEMINI_OCR_MODEL = process.env.GEMINI_OCR_MODEL || 'gemini-3.6-flash';

const GEMINI_MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif'
};

// The shape the registration flow reads back: routes/auth.js uses idType, name,
// age and gender; the rest prefills the form the customer would otherwise type
// out by hand.
const GEMINI_ID_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Full name exactly as printed, or empty if unreadable' },
    idType: {
      type: 'string',
      enum: ['Senior', 'PWD', 'Pregnant', 'Regular', 'Unknown'],
      description: 'Senior for a senior citizen or OSCA card, PWD for a person-with-disability card, Regular for any other government ID, Unknown if it cannot be told'
    },
    age: { type: 'integer', description: 'Age in years if printed or derivable from a birth date, else 0' },
    birthdate: { type: 'string', description: 'ISO yyyy-mm-dd if printed, else empty' },
    // 'Unknown' rather than an empty option: Gemini rejects a schema with an
    // empty string in an enum (enum[n]: cannot be empty), and the whole request
    // 400s - which sent every scan to the fallback.
    gender: { type: 'string', enum: ['Male', 'Female', 'Unknown'], description: 'Unknown if not printed' },
    idNumber: { type: 'string', description: 'The card or licence number, else empty' },
    address: { type: 'string', description: 'Address as printed, else empty' },
    text: { type: 'string', description: 'All text visible on the card, for the record' }
  },
  required: ['name', 'idType', 'age', 'gender', 'text']
};

const GEMINI_ID_PROMPT = [
  'You are reading a photograph of a Philippine government-issued identification card',
  'for a medical clinic registration desk. Transcribe only what is printed on the card.',
  'Do not guess a name, a number or a date that you cannot actually read - return an',
  'empty string for anything unreadable and 0 for an unknown age. If the card is a',
  'senior citizen (OSCA) card use idType "Senior"; if it is a PWD card use "PWD";',
  'any other valid ID is "Regular".'
].join(' ');

// Accepts a file path (what routes/auth.js passes) or a raw base64 string, the
// same two shapes pytesseract_ocr.py tolerates.
function geminiImagePart(imageData) {
  if (typeof imageData !== 'string') return null;
  if (fs.existsSync(imageData)) {
    const ext = path.extname(imageData).toLowerCase();
    return {
      inline_data: {
        mime_type: GEMINI_MIME_BY_EXT[ext] || 'image/jpeg',
        data: fs.readFileSync(imageData).toString('base64')
      }
    };
  }
  // Strips a data: URL prefix if one came through.
  const base64 = imageData.replace(/^data:[^;]+;base64,/, '');
  if (base64.length < 32) return null;
  return { inline_data: { mime_type: 'image/jpeg', data: base64 } };
}

// Returns the parsed fields, or null so the caller falls through to the local
// chain. Never throws: a registration must not fail because OCR did.
async function geminiIdScan(imageData) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const imagePart = geminiImagePart(imageData);
  if (!imagePart) {
    console.warn('[Gemini OCR] No readable image supplied');
    return null;
  }

  try {
    const res = await axios.post(
      `${GEMINI_BASE}/models/${GEMINI_OCR_MODEL}:generateContent`,
      {
        contents: [{ parts: [{ text: GEMINI_ID_PROMPT }, imagePart] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_ID_SCHEMA,
          temperature: 0
        }
      },
      { headers: { 'x-goog-api-key': apiKey }, timeout: 30000 }
    );

    const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      console.warn('[Gemini OCR] Empty response');
      return null;
    }

    const parsed = JSON.parse(raw);
    const age = Number(parsed.age) || 0;
    const result = {
      name: (parsed.name || '').trim(),
      // 'Unknown' is the model saying it could not tell, which is not a
      // customer category - the desk treats it as Regular and can correct it.
      idType: parsed.idType && parsed.idType !== 'Unknown' ? parsed.idType : 'Regular',
      age,
      gender: parsed.gender && parsed.gender !== 'Unknown' ? parsed.gender : null,
      birthdate: parsed.birthdate || null,
      idNumber: parsed.idNumber || null,
      address: parsed.address || null,
      text: parsed.text || '',
      source: 'gemini'
    };
    result.category = result.idType;

    // Nothing legible means nothing to prefill; better to hand over to
    // pytesseract than to return a confidently empty form.
    if (!result.name && !result.age && !result.text) {
      console.warn('[Gemini OCR] Nothing legible on the card');
      return null;
    }

    // logAI redacts identity payloads - see IDENTITY_FEATURES.
    await logAI('ID Scanning OCR (Gemini)', { model: GEMINI_OCR_MODEL }, result);
    return result;
  } catch (err) {
    const status = err.response ? err.response.status : err.code;
    const detail = err.response?.data?.error?.message || err.message;
    console.warn(`[Gemini OCR] Failed (${status}): ${String(detail).slice(0, 160)}`);
    return null;
  }
}

async function callMockAI(featureKey, endpoint, apiKey, data, firstFallback, mockFallback, featureLogName) {
  const isEnabled = await checkAIToggle(featureKey);
  let output;

  // Fallback chain: firstFallback → NVIDIA → mockFallback
  const runFallbackChain = async () => {
    // 1. Try first fallback (e.g., pytesseract)
    try {
      const result = await firstFallback(data);
      if (result) return result;
      console.warn(`[AI First Fallback] ${featureLogName} returned null, trying NVIDIA fallback`);
    } catch (fallbackErr) {
      console.warn(`[AI First Fallback Failed] ${featureLogName}:`, fallbackErr.message);
    }

    // 2. Try NVIDIA fallback
    try {
      const nvidiaResult = await nvidiaFallback(data);
      if (nvidiaResult) return nvidiaResult;
    } catch (nvidiaErr) {
      console.warn(`[NVIDIA Fallback Failed] ${featureLogName}:`, nvidiaErr.message);
    }

    // 3. Try mock fallback
    // Type-checked, not truthiness-checked: with the arguments shifted, a log
    // name sat in this slot and was called as a function.
    if (typeof mockFallback === 'function') {
      try {
        return await mockFallback(data);
      } catch (mockErr) {
        console.error(`[Mock Fallback Failed] ${featureLogName}:`, mockErr.message);
      }
    }

    return null;
  };

  // No endpoint means there is no remote model worth asking - the feature's
  // local logic is the answer, not a fallback from one. See the note on
  // hfModel() below for which features are which and why.
  if (isEnabled && endpoint) {
    try {
      // Primary API call (may fail)
      const res = await axios.post(endpoint, hfPayload(data), {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000
      });
      output = res.data;
    } catch (primaryErr) {
      console.log(`[AI Primary Failed] ${featureLogName}:`, primaryErr.message);
      output = await runFallbackChain();
    }
  } else {
    // Feature disabled, or no remote model for it – run the local chain.
    if (isEnabled) console.log(`[AI Local] ${featureLogName}`);
    else console.log(`[AI Disabled] ${featureLogName}`);
    output = await runFallbackChain();
  }

  if (!output) {
    output = { error: 'All AI methods failed' };
  }

  await logAI(featureLogName, data, output);
  return output;
}

const aiServices = {
    ocrScan: async (imageData) => {
        // Gemini reads the card and returns the fields.
        // First fallback: pytesseract OCR via local Python script (offline).
        // Second fallback (automatic inside callMockAI): NVIDIA Nemotron-3.
        // Final fallback: mock random category detection.
        //
        // Gemini sits outside callMockAI because that helper posts one fixed
        // request shape; a multimodal call is a different shape, and threading
        // another callback through those seven parameters is how the argument
        // order got shifted in the first place. The chain reads top to bottom
        // here instead.
        let rawResult = null;
        if (await checkAIToggle('ocr')) {
          rawResult = await geminiIdScan(imageData);
        }
        if (!rawResult) {
          rawResult = await callMockAI(
            'ocr',
            null,
            process.env.API_ALLAROUND,
            { image: imageData },
            pytesseractOcrFallback,
            mockOcrFallback,
            'ID Scanning OCR'
          );
        }
        // If the fallback returns raw text only, attempt simple parsing for form prefill
        if (rawResult && rawResult.text && !rawResult.idType) {
          const parsed = parseSimpleOcr(rawResult.text);
          return { ...parsed, text: rawResult.text };
        }
        return rawResult;
    },

    anomalyDetection: async (queueData) => {
        return await callMockAI('anomaly', null, process.env.API_ALLAROUND, queueData, (data) => {
            return { anomaly: data.waitTime > 30, reason: "Wait time exceeded threshold of 30 mins" };
        }, null, 'Anomaly Detection');
    },

    /**
     * Announcement Generator — template-based Natural Language Generation, Node.js only (no external API call).
     * Fills predefined templates with live queue data to produce a ready-to-send announcement draft.
     * `statusData` = { waitingCount, nextServing, department, avgWaitMinutes }
     */
    announcementGen: async (statusData) => {
        const isEnabled = await checkAIToggle('announcement');
        if (!isEnabled) {
            console.log('[AI Disabled] Announcement Generator');
            const output = { message: '' };
            await logAI('Announcement NLG', statusData, output);
            return output;
        }

        const waitingCount = Number(statusData?.waitingCount || 0);
        const nextServing = statusData?.nextServing || null;
        const department = statusData?.department || 'the clinic';
        const avgWaitMinutes = statusData?.avgWaitMinutes != null ? Math.round(Number(statusData.avgWaitMinutes)) : null;

        const templates = [];
        if (waitingCount === 0) {
            templates.push(`${department} currently has no one waiting. Walk-ins are welcome.`);
        } else {
            templates.push(`${department} currently has ${waitingCount} ${waitingCount === 1 ? 'patient' : 'patients'} waiting${nextServing ? `. Now serving ticket ${nextServing}` : ''}.`);
            if (avgWaitMinutes != null) {
                templates.push(`Average wait time at ${department} is about ${avgWaitMinutes} minute${avgWaitMinutes === 1 ? '' : 's'} for ${waitingCount} waiting ${waitingCount === 1 ? 'patient' : 'patients'}.`);
            }
            if (waitingCount >= 10) {
                templates.push(`${department} is experiencing higher than usual volume (${waitingCount} waiting). Thank you for your patience.`);
            }
        }

        const message = templates[Math.floor(Math.random() * templates.length)] || `Update from ${department}.`;
        const output = { message };
        await logAI('Announcement NLG', statusData, output);
        return output;
    },

    cutoffRecommendation: async (metrics) => {
        return await callMockAI('cutoff', null, process.env.API_ALLAROUND, metrics, (data) => {
            const accept = data.queueLength * data.avgServiceTime < 120;
            return { decision: accept ? "ACCEPT" : "STOP", confidence: 0.8 };
        }, null, 'Cut-off Recommendation');
    },

    serviceTimeEstimation: async (data) => {
        return await callMockAI('estimation', null, process.env.API_ALLAROUND, data, (d) => {
            return { estimatedMins: (d.historicalAvg || 15) * 1.1 };
        }, null, 'Service Time ML');
    },

    departmentPerformance: async (stats) => {
        return await callMockAI('performance', null, process.env.API_ALLAROUND, stats, (data) => {
            let score = 100 - (data.delayRate * 10) + (data.satisfaction * 10);
            return { efficiencyScore: score, rank: score > 80 ? "High" : "Average" };
        }, null, 'Performance Board');
    },

    feedbackAnalysis: async (feedbackArray) => {
        return await callMockAI('feedback', null, process.env.API_ALLAROUND, feedbackArray, (data) => {
            return { sentiment: "Mixed", issues: ["Long wait times"] };
        }, null, 'Feedback NLP');
    },

    reportGeneration: async (reportData) => {
        return await callMockAI('report', hfModel('gpt2'), process.env.API_ALLAROUND, reportData, (data) => {
            const { period, patientVolume, waitTimeAvg, revenue, topService } = data;
            return {
                summary: `Reporting Insight for ${period}: The clinic observed a patient volume of ${patientVolume} individuals.
                Operational efficiency was maintained with an average wait time of ${waitTimeAvg} minutes.
                Financial performance reached a total revenue of ₱${revenue.toLocaleString()}.
                The most utilized service was ${topService}. Overall, the system shows stable throughput with opportunities for wait time optimization during peak periods.`
            };
        }, null, 'Report Generation');
    },

    /**
     * Virtual Assistant dialogue controller.
     * `payload` = { text, history: [{role,text}], context: { packages, queue, customer_name, customer_category } }
     * Resolution order: Gemini 2.5 Flash → NVIDIA Nemotron-3 (demo-safety fallback) → deterministic local intent parser.
     */
    assistantDialogue: async (payload) => {
        const isEnabled = await checkAIToggle('assistant');
        let output = null;
        let provider = 'local';

        if (isEnabled) {
            const history = (payload.history || []).slice(-6).map(h => ({
                role: h.role === 'user' ? 'user' : 'assistant',
                content: String(h.text || '')
            }));
            const systemPrompt = buildAssistantSystemPrompt(payload.context);
            const turns = [...history, { role: 'user', content: String(payload.text || '') }];

            let raw = await geminiChat(systemPrompt, turns);
            if (raw) provider = 'gemini';
            if (!raw) {
                raw = await nvidiaChat(systemPrompt, turns);
                if (raw) provider = 'nvidia';
            }
            output = parseAssistantReply(raw);
            if (!output) {
                provider = 'local';
                console.warn('[Virtual Assistant] LLM unavailable or unparseable, using local intent parser');
            }
        } else {
            console.log('[AI Disabled] Virtual Assistant Dialogue');
        }

        if (!output) output = assistantLocalFallback(payload);

        await logAI('Virtual Assistant Dialogue', { text: payload.text, provider }, output);
        return output;
    },

    peakHourPrediction: async (historicalData) => {
        return await callMockAI('prediction', null, process.env.API_ALLAROUND, historicalData, (data) => {
            return { peakHour: "10:00 AM", confidence: 0.9 };
        }, null, 'Peak Hour ML');
    }
};

    // Helper to parse simple OCR text into structured fields (idType, name, age, gender)
    function parseSimpleOcr(text) {
      const lower = text.toLowerCase();
      const result = {};
      if (/senior|elderly/.test(lower)) result.idType = 'Senior';
      else if (/pwd/.test(lower)) result.idType = 'PWD';
      // Attempt to capture a name line (all caps with letters and spaces, at least two words)
      const nameMatch = text.match(/([A-Z]{2,}(?:\s+[A-Z]{2,})+)/);
      if (nameMatch) {
        result.name = nameMatch[1].trim();
      }
      // Attempt to find a year of birth and compute approximate age
      const yearMatch = text.match(/(19|20)\d{2}/);
      if (yearMatch) {
        const birthYear = parseInt(yearMatch[0]);
        const currentYear = new Date().getFullYear();
        result.age = currentYear - birthYear;
      }
      // Gender detection
      if (/\b(male|female|m|f)\b/.test(lower)) {
        const genderMatch = /\b(male|female)\b/.exec(lower);
        if (genderMatch) {
          const gender = genderMatch[1];
          result.gender = gender.charAt(0).toUpperCase() + gender.slice(1);
        }
      }
      return result;
    }

module.exports = aiServices;
