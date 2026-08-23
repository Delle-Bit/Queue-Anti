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
