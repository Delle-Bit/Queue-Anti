const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const QRCode = require('qrcode');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Firebase Initialization (Placeholder - needs service account)
// const serviceAccount = require('./serviceAccountKey.json');
// initializeApp({
//   credential: cert(serviceAccount)
// });
// const db = getFirestore();

// API: Generate QR Code for the patient app
app.get('/api/qrcode', async (req, res) => {
    try {
        const url = `${req.protocol}://${req.get('host')}/index.html`; 
        const qrImage = await QRCode.toDataURL(url);
        res.json({ qrImage, url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// API: AI Chatbot Proxy (Placeholder for Gemini/OpenAI)
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    // TODO: Integrate actual AI API here
    // const response = await callGeminiAPI(message);
    
    // Mock response for now
    const response = `AI Response to: "${message}". Processed by server.`;
    res.json({ reply: response });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
