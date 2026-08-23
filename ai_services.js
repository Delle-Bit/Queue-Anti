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

  return new Promise((resolve, reject) => {
    const py = spawn('python', [PYTESSERACT_SCRIPT]);
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => (stdout += d));
    py.stderr.on('data', (d) => (stderr += d));
    py.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[Pytesseract Fallback] Script exited ${code}: ${stderr}`);
        resolve(null);
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          console.warn('[Pytesseract Fallback] Failed to parse output:', e.message);
          resolve(null);
        }
      }
    });
    py.stdin.write(JSON.stringify(data));
    py.stdin.end();
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

async function logAI(feature, input, output) {
    try {
        await pool.query(
            'INSERT INTO ai_logs (feature, input_data, output_data) VALUES (?, ?, ?)',
            [feature, JSON.stringify(input), JSON.stringify(output)]
        );
    } catch (e) {
        console.error('Error logging AI', e);
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
    if (mockFallback) {
      try {
        return await mockFallback(data);
      } catch (mockErr) {
        console.error(`[Mock Fallback Failed] ${featureLogName}:`, mockErr.message);
      }
    }

    return null;
  };

  if (isEnabled) {
    try {
      // Primary API call (may fail)
      const res = await axios.post(endpoint, data, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000
      });
      output = res.data;
    } catch (primaryErr) {
      console.log(`[AI Primary Failed] ${featureLogName}:`, primaryErr.message);
      output = await runFallbackChain();
    }
  } else {
    // Feature disabled – still run fallback chain
    console.log(`[AI Disabled] ${featureLogName}`);
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
        // Primary OCR model (HuggingFace TroCR) – may fail.
        // First fallback: pytesseract OCR via local Python script.
        // Second fallback (automatic inside callMockAI): NVIDIA Nemotron‑3.
        // Final fallback: mock random category detection.
        const rawResult = await callMockAI(
          'ocr',
          'https://api-inference.huggingface.co/models/microsoft/trocr-base-handwritten',
          process.env.API_ALLAROUND,
          { image: imageData },
          pytesseractOcrFallback,
          mockOcrFallback,
          'ID Scanning OCR'
        );
        // If the fallback returns raw text only, attempt simple parsing for form prefill
        if (rawResult && rawResult.text && !rawResult.idType) {
          const parsed = parseSimpleOcr(rawResult.text);
          return { ...parsed, text: rawResult.text };
        }
        return rawResult;
    },

    anomalyDetection: async (queueData) => {
        return await callMockAI('anomaly', 'https://api-inference.huggingface.co/models/distilbert-base-uncased', process.env.API_ALLAROUND, queueData, (data) => {
            return { anomaly: data.waitTime > 30, reason: "Wait time exceeded threshold of 30 mins" };
        }, 'Anomaly Detection');
    },

    announcementGen: async (statusData) => {
        return await callMockAI('announcement', 'https://api-inference.huggingface.co/models/gpt2', process.env.API_ALLAROUND, statusData, (data) => {
            return { message: `The clinic has ${data.waitingCount} patients waiting. Next in line is ${data.nextServing}.` };
        }, 'Announcement NLP');
    },

    cutoffRecommendation: async (metrics) => {
        return await callMockAI('cutoff', 'https://api-inference.huggingface.co/models/distilbert-base-uncased', process.env.API_ALLAROUND, metrics, (data) => {
            const accept = data.queueLength * data.avgServiceTime < 120;
            return { decision: accept ? "ACCEPT" : "STOP", confidence: 0.8 };
        }, 'Cut-off Recommendation');
    },

    serviceTimeEstimation: async (data) => {
        return await callMockAI('estimation', 'https://api-inference.huggingface.co/models/distilbert-base-uncased', process.env.API_ALLAROUND, data, (d) => {
            return { estimatedMins: (d.historicalAvg || 15) * 1.1 };
        }, 'Service Time ML');
    },

    departmentPerformance: async (stats) => {
        return await callMockAI('performance', 'https://api-inference.huggingface.co/models/distilbert-base-uncased', process.env.API_ALLAROUND, stats, (data) => {
            let score = 100 - (data.delayRate * 10) + (data.satisfaction * 10);
            return { efficiencyScore: score, rank: score > 80 ? "High" : "Average" };
        }, 'Performance Board');
    },

    feedbackAnalysis: async (feedbackArray) => {
        return await callMockAI('feedback', 'https://api-inference.huggingface.co/models/distilbert-base-uncased', process.env.API_ALLAROUND, feedbackArray, (data) => {
            return { sentiment: "Mixed", issues: ["Long wait times"] };
        }, 'Feedback NLP');
    },

    reportGeneration: async (reportData) => {
        return await callMockAI('report', 'https://api-inference.huggingface.co/models/gpt2', process.env.API_ALLAROUND, reportData, (data) => {
            const { period, patientVolume, waitTimeAvg, revenue, topService } = data;
            return {
                summary: `Reporting Insight for ${period}: The clinic observed a patient volume of ${patientVolume} individuals.
                Operational efficiency was maintained with an average wait time of ${waitTimeAvg} minutes.
                Financial performance reached a total revenue of ₱${revenue.toLocaleString()}.
                The most utilized service was ${topService}. Overall, the system shows stable throughput with opportunities for wait time optimization during peak periods.`
            };
        }, 'Report Generation');
    },

    /**
     * Virtual Assistant dialogue controller.
     * `payload` = { text, history: [{role,text}], context: { packages, queue, customer_name, customer_category } }
     * Resolution order: NVIDIA chat (system prompt above) → deterministic local intent parser.
     */
    assistantDialogue: async (payload) => {
        const isEnabled = await checkAIToggle('assistant');
        let output = null;

        if (isEnabled) {
            const history = (payload.history || []).slice(-6).map(h => ({
                role: h.role === 'user' ? 'user' : 'assistant',
                content: String(h.text || '')
            }));
            const raw = await nvidiaChat(
                buildAssistantSystemPrompt(payload.context),
                [...history, { role: 'user', content: String(payload.text || '') }]
            );
            output = parseAssistantReply(raw);
            if (!output) console.warn('[Virtual Assistant] LLM unavailable or unparseable, using local intent parser');
        } else {
            console.log('[AI Disabled] Virtual Assistant Dialogue');
        }

        if (!output) output = assistantLocalFallback(payload);

        await logAI('Virtual Assistant Dialogue', { text: payload.text }, output);
        return output;
    },

    peakHourPrediction: async (historicalData) => {
        return await callMockAI('prediction', 'https://api-inference.huggingface.co/models/distilbert-base-uncased', process.env.API_ALLAROUND, historicalData, (data) => {
            return { peakHour: "10:00 AM", confidence: 0.9 };
        }, 'Peak Hour ML');
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
