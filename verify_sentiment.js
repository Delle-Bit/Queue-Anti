// verify_sentiment.js — VADER scoring and issue mining, asserted.
// Run by `npm test`, or on its own: node verify_sentiment.js
// Needs no key, no network, no database.
const { analyzeSentiment, classify } = require('./sentiment');

let passed = 0, failed = 0;
function check(label, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { passed++; console.log(`  ok   ${label}`); }
    else { failed++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

console.log('\n1. the VADER thresholds');
check('clearly positive', classify(0.85), 'Positive');
check('the +0.05 boundary is positive', classify(0.05), 'Positive');
check('just under the boundary is neutral', classify(0.0499), 'Neutral');
check('clearly negative', classify(-0.7), 'Negative');
check('the -0.05 boundary is negative', classify(-0.05), 'Negative');
check('zero is neutral', classify(0), 'Neutral');

console.log('\n2. scoring real sentences');
check('praise reads positive', analyzeSentiment('The staff were kind and fast, thank you!').label, 'Positive');
check('a complaint reads negative', analyzeSentiment('I waited so long and the room was dirty.').label, 'Negative');
check('a flat statement reads neutral', analyzeSentiment('I visited the clinic on Monday.').label, 'Neutral');
check('empty input is neutral, not an error', analyzeSentiment('').label, 'Neutral');
check('whitespace-only is neutral', analyzeSentiment('   ').label, 'Neutral');

console.log('\n3. issue mining is independent of polarity');
const complaint = analyzeSentiment('Very slow, waited over an hour, and expensive.');
check('long wait flagged', complaint.issues.includes('Long wait times'), true);
check('cost flagged', complaint.issues.includes('Cost / billing'), true);
check('a praise with no topic flags nothing', analyzeSentiment('Thank you!').issues.length, 0);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
