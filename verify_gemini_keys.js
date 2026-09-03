// Throwaway harness for the Gemini key-rotation change. Stubs axios and the
// database pool, then drives geminiIdScan / geminiChat through a copy of
// ai_services.js that also exports its private helpers.
//
//   node verify_gemini_keys.js
//
// Delete this file once the change is verified.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, 'ai_services.js');
const COPY = path.join(__dirname, '__ai_services_under_test.js');

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { passed++; console.log(`  ok   ${label}`); }
    else { failed++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

// -- stubs -------------------------------------------------------------------
const calls = [];
let responder = () => { throw new Error('no responder set'); };

function stub(id, exports) {
    const resolved = require.resolve(id);
    require.cache[resolved] = new Module(resolved, null);
    require.cache[resolved].filename = resolved;
    require.cache[resolved].loaded = true;
    require.cache[resolved].exports = exports;
}

function httpError(status, body) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, data: body };
    return err;
}

function quota(status) {
    return httpError(status, { error: { code: status, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for requests per day' } });
}

function idPayload(name) {
    return {
        data: {
            candidates: [{
                content: {
                    parts: [{
                        text: JSON.stringify({
                            name, idType: 'Senior', age: 68, gender: 'Female',
                            birthdate: '1958-02-11', idNumber: 'OSCA-123',
                            address: 'Cebu City', text: `OSCA ${name}`
                        })
                    }]
                }
            }]
        }
    };
}

stub('axios', {
    post: async (url, body, opts) => {
        const key = opts.headers['x-goog-api-key'];
        calls.push({ url, key });
        return responder(key, url);
    }
});
stub(path.join(__dirname, 'database.js'), { pool: { query: async () => [[]] } });

// -- load a copy that exports the private helpers ----------------------------
const source = fs.readFileSync(SRC, 'utf8').replace(
    'module.exports = aiServices;',
    'module.exports = aiServices;\n'
    + 'module.exports.__test = { geminiApiKeys, geminiKeySpent, withGeminiKey, geminiIdScan, geminiChat, GEMINI_OCR_MODEL, GEMINI_CHAT_MODEL };'
);
fs.writeFileSync(COPY, source);

let ai;
try {
    ai = require(COPY);
} finally {
    fs.unlinkSync(COPY);
}
const T = ai.__test;

function setKeys(...values) {
    for (let i = 1; i <= 5; i++) delete process.env[i === 1 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i}`];
    values.forEach((v, i) => {
        if (v !== null) process.env[i === 0 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i + 1}`] = v;
    });
}

// A 40-byte JPEG-ish buffer standing in for an uploaded ID photo.
const IMAGE = 'data:image/jpeg;base64,' + Buffer.alloc(64, 7).toString('base64');

(async () => {
    console.log('\n1. geminiApiKeys() reads both spellings');
    setKeys('k1', 'k2');
    check('numbered slots', T.geminiApiKeys(), ['k1', 'k2']);
    setKeys('a, b ,c');
    check('comma-separated, trimmed', T.geminiApiKeys(), ['a', 'b', 'c']);
    setKeys('dup', 'dup', 'other');
    check('duplicates collapsed', T.geminiApiKeys(), ['dup', 'other']);
    setKeys();
    check('nothing configured', T.geminiApiKeys(), []);
    setKeys('   ');
    check('whitespace-only is not a key', T.geminiApiKeys(), []);

    console.log('\n2. geminiKeySpent() only claims the key is at fault when it is');
    check('429 rate/quota', T.geminiKeySpent(quota(429)), true);
    check('403 RESOURCE_EXHAUSTED', T.geminiKeySpent(quota(403)), true);
    check('400 API_KEY_INVALID', T.geminiKeySpent(httpError(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } })), true);
    check('400 schema error is NOT a spent key', T.geminiKeySpent(httpError(400, { error: { message: 'Invalid JSON payload received. Unknown name "responseSchemaa"' } })), false);
    check('500 is the service, not the key', T.geminiKeySpent(httpError(500, { error: { message: 'internal' } })), false);
    check('timeout is not the key', T.geminiKeySpent(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })), false);
    check('404 model gone is not the key', T.geminiKeySpent(httpError(404, { error: { message: 'models/x is not found' } })), false);

    console.log('\n3. OCR rotates off an exhausted key mid-registration');
    setKeys('key-one', 'key-two');
    calls.length = 0;
    responder = (key) => { if (key === 'key-one') throw quota(429); return idPayload('Ana Reyes'); };
    let out = await T.geminiIdScan(IMAGE);
    check('keys tried in order', calls.map(c => c.key), ['key-one', 'key-two']);
    check('scan still succeeded', out && out.name, 'Ana Reyes');
    check('category came through', out && out.category, 'Senior');
    check('source recorded', out && out.source, 'gemini');

    console.log('\n4. the next scan starts on the key that worked');
    calls.length = 0;
    out = await T.geminiIdScan(IMAGE);
    check('exhausted key not retried', calls.map(c => c.key), ['key-two']);
    check('and it still scans', out && out.name, 'Ana Reyes');

    console.log('\n5. every key exhausted hands over to the offline chain');
    calls.length = 0;
    responder = () => { throw quota(429); };
    out = await T.geminiIdScan(IMAGE);
    check('both keys attempted once each', calls.length, 2);
    check('returns null so the caller falls through', out, null);

    console.log('\n6. a non-key failure is reported, not retried five times');
    setKeys('k1', 'k2', 'k3');
    calls.length = 0;
    responder = () => { throw httpError(500, { error: { message: 'backend error' } }); };
    out = await T.geminiIdScan(IMAGE);
    check('one attempt only', calls.length, 1);
    check('still null', out, null);

    console.log('\n7. no key configured is silence, not a crash');
    setKeys();
    calls.length = 0;
    out = await T.geminiIdScan(IMAGE);
    check('no request attempted', calls.length, 0);
    check('null', out, null);

    console.log('\n8. the key never travels in the URL');
    setKeys('secret-key-value', 'second-secret');
    calls.length = 0;
    responder = () => idPayload('Ana Reyes');
    await T.geminiIdScan(IMAGE);
    check('url carries no key', calls.every(c => !c.url.includes('secret')), true);
    check('url is the pinned OCR model', calls[0].url.endsWith(`/models/${T.GEMINI_OCR_MODEL}:generateContent`), true);

    console.log('\n9. the Virtual Assistant rotates too, on a live model');
    // The cursor is module state shared with OCR, and the scenarios above left
    // it on the second key. Prime it back to the first with a one-key list so
    // this checks rotation rather than where the last test happened to stop.
    setKeys('chat-one');
    responder = () => ({ data: { candidates: [{ content: { parts: [{ text: 'primed' }] } }] } });
    await T.geminiChat('be brief', [{ role: 'user', content: 'hi' }]);

    setKeys('chat-one', 'chat-two');
    calls.length = 0;
    responder = (key) => {
        if (key === 'chat-one') throw quota(429);
        return { data: { candidates: [{ content: { parts: [{ text: 'Good morning.' }] } }] } };
    };
    const reply = await T.geminiChat('be brief', [{ role: 'user', content: 'hi' }]);
    check('rotated', calls.map(c => c.key), ['chat-one', 'chat-two']);
    check('reply returned', reply, 'Good morning.');
    check('chat model is not the retired 2.5-flash', T.GEMINI_CHAT_MODEL.includes('2.5'), false);
    check('chat url uses the configured base', calls[0].url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/'), true);

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
