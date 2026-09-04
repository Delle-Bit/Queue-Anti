// Checks that the classic scripts a page loads do not declare the same
// top-level name twice.
//
// These pages have no bundler and no modules: every `public/*.js` file shares
// one global scope, so two `const ROLE_LABELS` in two files loaded by the same
// page is a SyntaxError that takes the *whole page* down - blank screen, one
// console line, and nothing rendered. It is invisible to `node --check`, which
// only ever sees one file at a time, and invisible to a page you happen not to
// open. It has bitten this project once already: a helper added to
// admin-shared.js redeclared a name shared.js had defined 270 lines earlier.
//
// So this walks each HTML page's own <script src> list in order and reports any
// name declared twice. Deliberately a regex pass over top-level declarations
// rather than a parser: no dependency, and the failure it is looking for is
// exactly a duplicate at column 0.
//
// Run from npm test. Exits non-zero on a clash.

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

// Only column-0 declarations are top-level in these files; anything indented is
// inside a function or a block and cannot collide.
const DECL = /^(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;

// `const`, `let` and `class` throw on redeclaration and take the page with
// them. `function` and `var` are legal to redeclare - the last file loaded
// silently wins - so those are reported but do not fail the run: index.js
// deliberately overrides shared.js's openModal/closeModal today.
const FATAL_KINDS = new Set(['const', 'let', 'class']);

function topLevelNames(file) {
    const names = [];
    const src = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    let inBlockComment = false;

    src.split(/\r?\n/).forEach((line, i) => {
        // Comments are the only thing that can put a fake declaration at
        // column 0 - a commented-out `const x = 1` in a doc block, say.
        if (inBlockComment) {
            if (line.includes('*/')) inBlockComment = false;
            return;
        }
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//')) return;
        if (trimmed.startsWith('/*')) {
            if (!line.includes('*/')) inBlockComment = true;
            return;
        }
        const match = DECL.exec(line);
        if (match) names.push({ kind: match[1], name: match[2], line: i + 1 });
    });

    return names;
}

// Local scripts only, in document order. A CDN script is somebody else's scope
// problem, and `src` values with a query or a protocol are skipped.
function pageScripts(htmlFile) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, htmlFile), 'utf8');
    const scripts = [];
    const tag = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = tag.exec(html)) !== null) {
        const src = match[1];
        if (/^(?:https?:)?\/\//.test(src)) continue;         // CDN
        if (src.startsWith('/socket.io/')) continue;          // served by the server
        const file = src.replace(/^\.?\//, '');
        if (fs.existsSync(path.join(PUBLIC_DIR, file))) scripts.push(file);
    }
    return scripts;
}

let failures = 0;
let overrides = 0;
let pagesChecked = 0;

fs.readdirSync(PUBLIC_DIR).filter(f => f.endsWith('.html')).sort().forEach(htmlFile => {
    const scripts = pageScripts(htmlFile);
    if (scripts.length < 2) return;
    pagesChecked++;

    const seen = new Map();   // name -> { file, line, kind }
    const fatal = [];
    const shadowed = [];

    scripts.forEach(file => {
        topLevelNames(file).forEach(({ kind, name, line }) => {
            const prior = seen.get(name);
            // A name declared twice in one file is node --check's business;
            // this is only about two different files colliding.
            if (prior && prior.file !== file) {
                const clash = { name, first: prior, second: { file, line, kind } };
                if (FATAL_KINDS.has(kind) || FATAL_KINDS.has(prior.kind)) fatal.push(clash);
                else shadowed.push(clash);
            } else if (!prior) {
                seen.set(name, { file, line, kind });
            }
        });
    });

    if (fatal.length === 0) {
        console.log(`  ok   ${htmlFile} - ${scripts.length} scripts, no fatal top-level clashes`);
    } else {
        failures += fatal.length;
        console.error(`  FAIL ${htmlFile}`);
        fatal.forEach(c => {
            console.error(`       ${c.second.kind} "${c.name}" in ${c.second.file}:${c.second.line} redeclares ${c.first.kind} from ${c.first.file}:${c.first.line}`);
        });
    }

    shadowed.forEach(c => {
        overrides++;
        console.log(`       note: ${c.second.file}:${c.second.line} overrides ${c.name}() from ${c.first.file}:${c.first.line} - the later file wins`);
    });
});

console.log(`\n${pagesChecked} page(s) checked, ${failures} fatal clash(es), ${overrides} silent override(s).`);
if (failures > 0) {
    console.error('A duplicate const/let/class at top level is a SyntaxError that blanks the page. Rename one, or share the first.');
    process.exit(1);
}
