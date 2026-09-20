// The cashier's arithmetic, asserted. Run by `npm test`, or on its own:
//
//   node verify_payment_math.js
//
// routes/queue.js keeps resolvePayment private, so this loads a copy of the
// file that also exports it - the same trick verify_ai_chain.js uses. It needs
// no database: resolvePayment is pure arithmetic over a price and a discount
// choice.
//
// It exists because this is the one place in the app where money is decided.
// A wrong rate here does not throw, does not show up in a log, and is only
// noticed when a senior citizen is overcharged or the month's sales do not
// match the receipt book.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, 'routes', 'queue.js');
const COPY = path.join(__dirname, 'routes', '__queue_under_test.js');

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { passed++; console.log(`  ok   ${label}`); }
    else { failed++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

// The router pulls in the pool, the queue engine and the audit trail as it
// loads. None of them are exercised here, so they are stubbed rather than
// connected - the alternative is a test that needs a database to check
// multiplication.
function stub(id, exports) {
    const resolved = require.resolve(id);
    require.cache[resolved] = new Module(resolved, null);
    require.cache[resolved].filename = resolved;
    require.cache[resolved].loaded = true;
    require.cache[resolved].exports = exports;
}
stub(path.join(__dirname, 'database.js'), { pool: { query: async () => [[], []] } });

const source = fs.readFileSync(SRC, 'utf8').replace(
    'module.exports = router;',
    'module.exports = router;\nmodule.exports.__test = { resolvePayment, defaultDiscountType, DISCOUNT_RATES, PAYMENT_METHODS };'
);
fs.writeFileSync(COPY, source);

let T;
try {
    T = require(COPY).__test;
} finally {
    fs.unlinkSync(COPY);
}

console.log('\n1. the statutory rates are the ones the law names');
check('senior is 20 percent (RA 9994)', T.DISCOUNT_RATES.senior, 20);
check('PWD is 20 percent (RA 10754)', T.DISCOUNT_RATES.pwd, 20);
check('no discount is zero', T.DISCOUNT_RATES.none, 0);
check('pregnancy is a queue priority, not a discount', 'pregnant' in T.DISCOUNT_RATES, false);

console.log('\n2. the form opens on the discount the patient is entitled to');
check('Senior', T.defaultDiscountType('Senior'), 'senior');
check('PWD', T.defaultDiscountType('PWD'), 'pwd');
check('pwd in any case', T.defaultDiscountType('pwd'), 'pwd');
check('Pregnant gets none', T.defaultDiscountType('Pregnant'), 'none');
check('Regular gets none', T.defaultDiscountType('Regular'), 'none');
check('an empty category gets none', T.defaultDiscountType(''), 'none');

console.log('\n3. the arithmetic');
check('450 with no discount', T.resolvePayment(450, { discount_type: 'none' }).amount_paid, 450);
check('450 for a senior', T.resolvePayment(450, { discount_type: 'senior' }).amount_paid, 360);
check('and the discount is recorded, not just the net', T.resolvePayment(450, { discount_type: 'senior' }).discount_amount, 90);
check('6000 for a PWD', T.resolvePayment(6000, { discount_type: 'pwd' }).amount_paid, 4800);
// 1299.99 * 0.2 = 259.998, which must not reach the ledger as three decimals.
check('an odd centavo amount rounds to two decimals',
    T.resolvePayment(1299.99, { discount_type: 'senior' }).discount_amount, 260);
check('and the net still adds back up',
    T.resolvePayment(1299.99, { discount_type: 'senior' }).amount_paid, 1039.99);
check('a courtesy discount uses the typed percentage',
    T.resolvePayment(1000, { discount_type: 'other', discount_percent: 15 }).amount_paid, 850);

console.log('\n4. the rate comes from the type, never from the request');
// The client sends both, and a hand-made request could name "senior" at 90
// percent. The percentage is read from DISCOUNT_RATES for every type but
// "other", so the claim is ignored.
check('senior at a claimed 90 percent is still 20',
    T.resolvePayment(450, { discount_type: 'senior', discount_percent: 90 }).amount_paid, 360);
check('an unknown discount type is refused',
    !!T.resolvePayment(450, { discount_type: 'employee' }).error, true);
check('a courtesy discount over 100 percent is refused',
    !!T.resolvePayment(450, { discount_type: 'other', discount_percent: 120 }).error, true);
check('a negative courtesy discount is refused',
    !!T.resolvePayment(450, { discount_type: 'other', discount_percent: -5 }).error, true);
check('a non-numeric courtesy discount is refused',
    !!T.resolvePayment(450, { discount_type: 'other', discount_percent: 'free' }).error, true);
check('cash is an accepted method', T.PAYMENT_METHODS.includes('cash'), true);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
