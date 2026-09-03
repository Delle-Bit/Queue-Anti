// The OCR and assistant fallback chains, asserted. Run by `npm test`, or on its own:
//
//   npm run verify:ai
//
// It stubs axios and the connection pool and loads a copy of ai_services.js
// that also exports its private helpers, so it needs no API key, no network
// and no database, and it can force a 429 or a 503 on demand - which is the
// only practical way to test what happens when a key runs out of quota or a
// model is oversubscribed.
//
// Every scenario here came from something that actually happened: a key
// exhausted mid-morning, gemini-2.5-flash retired underneath the assistant,
// gemini-3.6-flash answering 503 after 64 seconds, and a bug in the rotation
// loop itself that this file caught before it shipped.

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

// -- keep the developer's own .env out of the results ------------------------
// ai_services.js calls dotenv.config() as it loads, so without this the suite
// asserts different things on different machines: a real NVIDIA_API_KEY adds a
// third provider to the chain, a GEMINI_OCR_MODEL override changes the model
// names in the URLs, and a real GEMINI_API_KEY would be sent to Google if a
// scenario ever stopped stubbing axios.
//
// Set rather than deleted, because deleting is useless here - dotenv is about
// to run and will happily fill an absent key in from .env, while it leaves a
// variable that is already present alone. Empty string is falsy, so every
// `process.env.X || default` in the module resolves to its shipped default,
// which is what these scenarios are meant to be testing. Scenarios that want
// a real value set it, and scenario 25 deletes its two to get the defaults
// back - safe by then, because dotenv has already run and will not re-run.
for (const name of [
    'GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3',
    'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5',
    'GEMINI_BASE', 'GEMINI_OCR_MODEL', 'GEMINI_CHAT_MODEL',
    'GEMINI_OCR_MODEL_FALLBACK', 'GEMINI_OVERLOAD_RETRIES',
    'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE', 'DEEPSEEK_VISION_MODEL',
    'NVIDIA_API_KEY', 'API_ALLAROUND'
]) {
    process.env[name] = '';
}

// -- load a copy that exports the private helpers ----------------------------
const source = fs.readFileSync(SRC, 'utf8').replace(
    'module.exports = aiServices;',
    'module.exports = aiServices;\n'
    + 'module.exports.__test = { geminiApiKeys, geminiKeySpent, withGeminiKey,'
    + ' geminiIdScan, geminiChat, ageFromBirthdate, GEMINI_OCR_MODEL, GEMINI_CHAT_MODEL,'
    + ' deepseekIdScan, normaliseIdScan, readImageBase64, DEEPSEEK_VISION_MODEL,'
    + ' deepseekState: () => deepseekOffReason,'
    + ' resetDeepseek: () => { deepseekOffReason = null; } };'
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

// The pause between overload retries is real time, and several scenarios below
// trip it. The waiting itself is not what any of them are testing.
process.env.GEMINI_OVERLOAD_BACKOFF_MS = '0';

// Scenarios 1-13 are about keys, and count requests to prove it. The shipped
// fallback model would double every one of those counts for reasons that have
// nothing to do with keys, so it is off here and turned on deliberately in 14
// and 15. Scenario 25 clears both of these and asserts the real defaults.
process.env.GEMINI_OCR_MODEL_FALLBACK = '';

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

    console.log('\n6. a failure that is not the key\'s fault never rotates');
    setKeys('k1', 'k2', 'k3');

    // A 5xx is transient, so it is retried - but on the one key, because three
    // keys against a busy model is three times the wait and the same answer.
    calls.length = 0;
    responder = () => { throw httpError(500, { error: { message: 'backend error' } }); };
    out = await T.geminiIdScan(IMAGE);
    check('retried within its budget', calls.length, 3);
    check('all on the same key', new Set(calls.map(c => c.key)).size, 1);
    check('null, not nine attempts', out, null);

    // A schema mistake is neither transient nor the key's doing: attempted
    // once, reported as itself.
    calls.length = 0;
    responder = () => { throw httpError(400, { error: { message: 'Invalid JSON payload received. Unknown name "responseSchemaa"' } }); };
    out = await T.geminiIdScan(IMAGE);
    check('our own bug is attempted once', calls.length, 1);
    check('and reported as null', out, null);

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

    console.log('\n10. an overloaded model is retried on the same key, not rotated');
    // Observed in production: 503 "This model is currently experiencing high
    // demand." A second key cannot help with that, so the same one is retried.
    const busy = () => httpError(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand.' } });

    setKeys('only-key');
    calls.length = 0;
    let n = 0;
    responder = () => { if (++n === 1) throw busy(); return idPayload('Ana Reyes'); };
    out = await T.geminiIdScan(IMAGE);
    check('retried once', calls.length, 2);
    check('same key both times', new Set(calls.map(c => c.key)).size, 1);
    check('scan recovered', out && out.name, 'Ana Reyes');

    console.log('\n11. the retry budget is bounded');
    calls.length = 0;
    responder = () => { throw busy(); };
    out = await T.geminiIdScan(IMAGE);
    check('one attempt plus two retries, then stop', calls.length, 3);
    check('falls through to the offline chain', out, null);

    console.log('\n12. a busy model does not burn the spare key');
    setKeys('key-one', 'key-two');
    calls.length = 0;
    out = await T.geminiIdScan(IMAGE);
    check('only the current key was tried', new Set(calls.map(c => c.key)).size, 1);
    check('three attempts, not six', calls.length, 3);

    console.log('\n13. a quota refusal still rotates, and the retry does not multiply it');
    setKeys('key-one', 'key-two');
    calls.length = 0;
    responder = (key) => { if (key === 'key-one') throw quota(429); return idPayload('Ana Reyes'); };
    out = await T.geminiIdScan(IMAGE);
    check('one attempt per key', calls.length, 2);
    check('recovered on the spare', out && out.name, 'Ana Reyes');

    console.log('\n14. a model that stays busy is swapped for another one');
    // The retry above covers a blip. This covers what was actually observed:
    // gemini-3.6-flash taking 64s and then answering 503, for minutes on end.
    process.env.GEMINI_OVERLOAD_BACKOFF_MS = '0';
    process.env.GEMINI_OCR_MODEL_FALLBACK = 'spare-model';
    setKeys('only-key');
    calls.length = 0;
    responder = (key, url) => {
      if (url.includes('spare-model')) return idPayload('Ana Reyes');
      throw busy();
    };
    out = await T.geminiIdScan(IMAGE);
    check('primary exhausted its retries, then the spare ran', calls.length, 4);
    check('the spare was the pinned fallback', calls[3].url.includes('spare-model'), true);
    check('scan recovered on the other model', out && out.name, 'Ana Reyes');

    console.log('\n15. the model list is configuration, and can be emptied');
    process.env.GEMINI_OCR_MODEL_FALLBACK = '';
    calls.length = 0;
    out = await T.geminiIdScan(IMAGE);
    check('no fallback model attempted', calls.length, 3);
    check('null', out, null);

    console.log('\n16. a missing key is not something another model fixes');
    setKeys();
    calls.length = 0;
    delete process.env.GEMINI_OCR_MODEL_FALLBACK;
    out = await T.geminiIdScan(IMAGE);
    check('nothing attempted', calls.length, 0);
    check('null', out, null);
    delete process.env.GEMINI_OCR_MODEL_FALLBACK;

    console.log('\n17. age is counted from the card, not taken from the model');
    // Observed live: the card read 1957-11-24 and the model answered 66.
    const thisYear = new Date().getUTCFullYear();
    check('a birthday already past this year', T.ageFromBirthdate(`${thisYear - 40}-01-01`), 40);
    check('a birthday still to come', T.ageFromBirthdate(`${thisYear - 40}-12-31`), 39);
    check('born today', T.ageFromBirthdate(new Date().toISOString().slice(0, 10)), 0);
    check('empty', T.ageFromBirthdate(''), null);
    check('not an ISO date', T.ageFromBirthdate('24 November 1957'), null);
    check('impossible day refused, not rolled forward', T.ageFromBirthdate('2020-02-30'), null);
    check('a misread century is refused', T.ageFromBirthdate('1057-11-24'), null);
    check('the future is refused', T.ageFromBirthdate(`${thisYear + 2}-01-01`), null);

    setKeys('only-key');
    process.env.GEMINI_OCR_MODEL_FALLBACK = '';
    calls.length = 0;
    responder = () => ({
        data: { candidates: [{ content: { parts: [{ text: JSON.stringify({
            name: 'MARIA CLARA SANTOS', idType: 'Senior', age: 66,
            gender: 'Female', birthdate: `${thisYear - 68}-01-01`,
            idNumber: 'OSCA-2024-004871', address: 'Cebu City', text: 'OSCA'
        }) }] } }] }
    });
    out = await T.geminiIdScan(IMAGE);
    check('the printed date wins over the model arithmetic', out && out.age, 68);
    check('the rest of the card is untouched', out && out.birthdate, `${thisYear - 68}-01-01`);

    // With no date printed there is nothing to count, so the model's own
    // answer stands rather than being replaced with a zero.
    responder = () => ({
        data: { candidates: [{ content: { parts: [{ text: JSON.stringify({
            name: 'JUAN CRUZ', idType: 'Regular', age: 41, gender: 'Male',
            birthdate: '', idNumber: 'N-1', address: '', text: 'ID'
        }) }] } }] }
    });
    out = await T.geminiIdScan(IMAGE);
    check('no printed date falls back to the model', out && out.age, 41);

    console.log('\n18. DeepSeek is the second opinion when Gemini cannot read the card');
    // NOTE: this provider cannot be verified against the live API - the key on
    // the account answers 402 Insufficient Balance to every request, including
    // the cheapest text one, because DeepSeek has no free tier. So these are
    // the verification, driven through the same stubbed axios.
    process.env.DEEPSEEK_API_KEY = 'ds-test-key';
    process.env.GEMINI_OCR_MODEL_FALLBACK = '';

    const dsReply = (obj, wrap) => ({
        data: { choices: [{ message: { content: wrap ? '```json\n' + JSON.stringify(obj) + '\n```' : JSON.stringify(obj) } }] }
    });
    const card = {
        name: 'MARIA CLARA SANTOS', idType: 'Senior', age: 0, gender: 'Female',
        birthdate: '1957-11-24', idNumber: 'OSCA-2024-004871',
        address: 'Cebu City', text: 'OSCA SENIOR CITIZEN'
    };

    setKeys('only-key');
    T.resetDeepseek();
    calls.length = 0;
    responder = (key, url) => {
        if (url.includes('deepseek')) return dsReply(card);
        throw quota(429);            // Gemini out of quota
    };
    out = await T.geminiIdScan(IMAGE) || await T.deepseekIdScan(IMAGE);
    check('DeepSeek was asked after Gemini gave up', calls.filter(c => c.url.includes('deepseek')).length, 1);
    check('the card was read', out && out.name, 'MARIA CLARA SANTOS');
    check('source is attributed to DeepSeek', out && out.source, 'deepseek');
    check('priority category came through', out && out.category, 'Senior');
    check('age counted from the date, not the model 0', out && out.age, T.ageFromBirthdate('1957-11-24'));

    console.log('\n19. a fenced reply is still read');
    calls.length = 0;
    responder = () => dsReply(card, true);
    out = await T.deepseekIdScan(IMAGE);
    check('code fence stripped', out && out.name, 'MARIA CLARA SANTOS');

    console.log('\n20. an unfunded account switches the provider off, once');
    T.resetDeepseek();
    calls.length = 0;
    responder = () => { throw httpError(402, { error: { message: 'Insufficient Balance', code: 'invalid_request_error' } }); };
    check('before the first call it is armed', T.deepseekState(), null);
    out = await T.deepseekIdScan(IMAGE);
    check('first call attempted and failed', calls.length, 1);
    check('null, so the chain carries on', out, null);
    check('and it recorded why', String(T.deepseekState()).includes('402'), true);
    // The whole point: no further round trips in front of any registration.
    out = await T.deepseekIdScan(IMAGE);
    out = await T.deepseekIdScan(IMAGE);
    check('no further requests are made', calls.length, 1);

    console.log('\n21. a transient failure does NOT switch it off');
    T.resetDeepseek();
    calls.length = 0;
    responder = () => { throw httpError(503, { error: { message: 'busy' } }); };
    await T.deepseekIdScan(IMAGE);
    check('still armed after a 503', T.deepseekState(), null);
    await T.deepseekIdScan(IMAGE);
    check('so it is tried again next scan', calls.length, 2);

    console.log('\n22. a provider answering in prose cannot invent a category');
    // Only Gemini is held to an enum by responseSchema. normaliseIdScan is
    // what stops "Senior Citizen" or "vip" becoming a queue priority.
    check('a made-up category becomes Regular', T.normaliseIdScan({ idType: 'Senior Citizen', name: 'X' }, 'deepseek').category, 'Regular');
    check('lower case is not a category either', T.normaliseIdScan({ idType: 'senior', name: 'X' }, 'deepseek').category, 'Regular');
    check('Unknown becomes Regular', T.normaliseIdScan({ idType: 'Unknown', name: 'X' }, 'deepseek').category, 'Regular');
    check('a real one is kept', T.normaliseIdScan({ idType: 'PWD', name: 'X' }, 'deepseek').category, 'PWD');
    check('Pregnant is kept', T.normaliseIdScan({ idType: 'Pregnant', name: 'X' }, 'deepseek').category, 'Pregnant');
    check('a junk gender is dropped, not passed on', T.normaliseIdScan({ gender: 'F', name: 'X' }, 'deepseek').gender, null);
    check('a real gender is kept', T.normaliseIdScan({ gender: 'Female', name: 'X' }, 'deepseek').gender, 'Female');

    console.log('\n23. no DeepSeek key means no DeepSeek request');
    delete process.env.DEEPSEEK_API_KEY;
    T.resetDeepseek();
    calls.length = 0;
    out = await T.deepseekIdScan(IMAGE);
    check('nothing attempted', calls.length, 0);
    check('null', out, null);

    console.log('\n24. the image reader keeps the declared type');
    check('png data URL', T.readImageBase64('data:image/png;base64,' + 'A'.repeat(64)).mimeType, 'image/png');
    check('bare base64 assumes jpeg', T.readImageBase64('B'.repeat(64)).mimeType, 'image/jpeg');
    check('too short to be an image', T.readImageBase64('short'), null);
    check('not a string', T.readImageBase64(null), null);

    console.log('\n25. the shipped defaults are small enough for a counter');
    // Nothing overridden from here down: this is what the clinic actually runs
    // when Gemini is unreachable for everyone.
    delete process.env.GEMINI_OVERLOAD_BACKOFF_MS;
    delete process.env.GEMINI_OVERLOAD_RETRIES;
    delete process.env.GEMINI_OCR_MODEL_FALLBACK;
    setKeys('only-key');
    calls.length = 0;
    responder = () => { throw busy(); };
    const started = Date.now();
    out = await T.geminiIdScan(IMAGE);
    const elapsed = Date.now() - started;
    // Two models, three attempts each: 700ms then 1400ms of backoff per model.
    check('default budget is two models of three attempts', calls.length, 6);
    check('the two models were distinct', new Set(calls.map(c => c.url)).size, 2);
    // So the desk waits about four seconds of backoff, plus the requests
    // themselves, before it gets the offline answer.
    check('default backoff totals ~4.2s, under 8s', elapsed >= 4000 && elapsed < 8000, true);
    check('and it ends in null, never a throw', out, null);

    console.log('\n26. the whole chain, through the entry point the route calls');
    // ocrScan is what POST /api/auth/ocr reaches. The scenarios above drive the
    // two providers directly, which does not prove they are wired together.
    process.env.GEMINI_OVERLOAD_BACKOFF_MS = '0';
    process.env.GEMINI_OCR_MODEL_FALLBACK = '';
    process.env.DEEPSEEK_API_KEY = 'ds-test-key';
    setKeys('gem-key');
    T.resetDeepseek();

    calls.length = 0;
    responder = (key, url) => {
        if (url.includes('deepseek')) return dsReply(card);
        throw quota(429);
    };
    let scan = await ai.ocrScan(IMAGE);
    check('Gemini asked first', calls[0].url.includes('generativelanguage'), true);
    check('DeepSeek asked second', calls[1].url.includes('deepseek'), true);
    check('two providers, no more', calls.length, 2);
    check('the desk gets the real name', scan && scan.name, 'MARIA CLARA SANTOS');
    check('not the invented one', scan && scan.name === 'Detected Patient', false);
    check('and it is attributed', scan && scan.source, 'deepseek');

    console.log('\n27. Gemini working means DeepSeek is never billed');
    calls.length = 0;
    responder = () => idPayload('Ana Reyes');
    scan = await ai.ocrScan(IMAGE);
    check('one request only', calls.length, 1);
    check('no DeepSeek request at all', calls.some(c => c.url.includes('deepseek')), false);
    check('Gemini answered', scan && scan.source, 'gemini');

    console.log('\n28. both providers down is where the invented patient lives');
    // Not an assertion of good behaviour - a record of what still happens when
    // every hosted provider fails: python is absent from the runtime image,
    // NVIDIA has no key, and mockOcrFallback rolls a random age and category.
    calls.length = 0;
    T.resetDeepseek();
    responder = () => { throw quota(429); };
    scan = await ai.ocrScan(IMAGE);
    check('both providers were tried', calls.length, 2);
    check('and the result is fabricated', scan && scan.name, 'Detected Patient');
    check('with a random age', typeof (scan && scan.age), 'number');

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
