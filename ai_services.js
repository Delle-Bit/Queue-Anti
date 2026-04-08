const axios = require('axios');
const { pool } = require('./database.js');

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

async function callMockAI(featureKey, endpoint, apiKey, data, fallbackLogic, featureLogName) {
    const isEnabled = await checkAIToggle(featureKey);
    let output;

    if (isEnabled) {
        try {
            // Mock API call that will fail and trigger fallback
            const res = await axios.post(endpoint, data, {
                headers: { Authorization: `Bearer ${apiKey}`, timeout: 1000 }
            });
            output = res.data;
        } catch (err) {
            // Fallback trigger!
            console.log(`[AI Triggered Fallback] ${featureLogName}`);
            output = fallbackLogic(data);
        }
    } else {
        console.log(`[AI Disabled Fallback] ${featureLogName}`);
        output = fallbackLogic(data);
    }

    await logAI(featureLogName, data, output);
    return output;
}

const aiServices = {
    chatbot: async (message) => {
        return await callMockAI('chatbot', process.env.AI_CHATBOT_ENDPOINT, process.env.AI_CHATBOT_API_KEY, { message }, (data) => {
            return { reply: "Fallback: Please check our pricing FAQs or ask the front desk." };
        }, 'Chatbot NLP');
    },
    
    ocrScan: async (imageData) => {
        return await callMockAI('ocr', process.env.OCR_API_ENDPOINT, process.env.OCR_API_KEY, { image: "mock" }, (data) => {
            // Mock random fallback data — randomly assigns Senior, PWD, or Regular
            const rand = Math.random();
            let age, idType, category;
            if (rand < 0.33) {
                age = 65 + Math.floor(Math.random() * 15);
                idType = 'Senior';
                category = 'E';
            } else if (rand < 0.5) {
                age = 25 + Math.floor(Math.random() * 30);
                idType = 'PWD';
                category = 'D';
            } else {
                age = 20 + Math.floor(Math.random() * 30);
                idType = 'Regular';
                category = 'Q';
            }
            return { 
                name: "Mock Patient " + Math.floor(Math.random() * 100), 
                age, 
                idType,
                category
            };
        }, 'ID Scanning OCR');
    },

    anomalyDetection: async (queueData) => {
        return await callMockAI('anomaly', process.env.ANOMALY_API_ENDPOINT, process.env.ANOMALY_API_KEY, queueData, (data) => {
            return { anomaly: data.waitTime > 30, reason: "Wait time exceeded threshold of 30 mins" };
        }, 'Anomaly Detection');
    },

    announcementGen: async (statusData) => {
        return await callMockAI('announcement', process.env.ANNOUNCEMENT_AI_ENDPOINT, process.env.ANNOUNCEMENT_AI_KEY, statusData, (data) => {
            return { message: `The clinic has ${data.waitingCount} patients waiting. Next in line is ${data.nextServing}.` };
        }, 'Announcement NLP');
    },

    cutoffRecommendation: async (metrics) => {
        return await callMockAI('cutoff', process.env.CUTOFF_AI_ENDPOINT, process.env.CUTOFF_AI_KEY, metrics, (data) => {
            const accept = data.queueLength * data.avgServiceTime < 120; // Accept if less than 2 hours left
            return { decision: accept ? "ACCEPT" : "STOP", confidence: 0.8 };
        }, 'Cut-off Recommendation');
    },

    serviceTimeEstimation: async (data) => {
        return await callMockAI('estimation', process.env.ESTIMATION_API_ENDPOINT, process.env.ESTIMATION_API_KEY, data, (d) => {
            return { estimatedMins: (d.historicalAvg || 15) * 1.1 };
        }, 'Service Time ML');
    },

    departmentPerformance: async (stats) => {
        return await callMockAI('performance', process.env.PERFORMANCE_AI_ENDPOINT, process.env.PERFORMANCE_AI_KEY, stats, (data) => {
            let score = 100 - (data.delayRate * 10) + (data.satisfaction * 10);
            return { efficiencyScore: score, rank: score > 80 ? "High" : "Average" };
        }, 'Performance Board');
    },

    feedbackAnalysis: async (feedbackArray) => {
        return await callMockAI('feedback', process.env.FEEDBACK_AI_ENDPOINT, process.env.FEEDBACK_AI_KEY, feedbackArray, (data) => {
            return { sentiment: "Mixed", issues: ["Long wait times"] };
        }, 'Feedback NLP');
    },

    reportGeneration: async (dailyStats) => {
        return await callMockAI('report', process.env.REPORT_AI_ENDPOINT, process.env.REPORT_AI_KEY, dailyStats, (data) => {
            return { summary: `Today the clinic served ${data.totalServed} patients. Average wait time was ${data.avgWait} mins.` };
        }, 'Report Generation');
    },

    peakHourPrediction: async (historicalData) => {
        return await callMockAI('prediction', process.env.PREDICTION_API_ENDPOINT, process.env.PREDICTION_API_KEY, historicalData, (data) => {
            return { peakHour: "10:00 AM", confidence: 0.9 };
        }, 'Peak Hour ML');
    }
};

module.exports = aiServices;
