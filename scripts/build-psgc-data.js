#!/usr/bin/env node
/**
 * Builds the Philippine address dataset used by the cascading
 * Province -> City/Municipality -> Barangay dropdowns in the customer
 * medical form.
 *
 * Source: PSGC API (https://psgc.gitlab.io/api/) — Philippine Standard
 * Geographic Code, the official government geographic classification.
 *
 * Usage:  node scripts/build-psgc-data.js
 * Output: public/data/ph/provinces.json
 *         public/data/ph/cities.json
 *         public/data/ph/barangays/<provinceCode>.json
 *
 * The upstream records carry ~9 fields each; barangays alone are ~11MB.
 * We strip everything the dropdowns don't need and shard barangays by
 * province so the browser only ever downloads the one province the user
 * actually picked (~15-60KB) instead of the whole country.
 *
 * Emitted record shapes (short keys keep the payload small):
 *   provinces.json  [{ c: code, n: name }]
 *   cities.json     [{ c: code, n: name, p: provinceCode }]
 *   barangays/X.json[{ c: code, n: name, m: cityOrMunicipalityCode }]
 *
 * Re-run this whenever PSGC publishes updates (barangays get created,
 * merged, and renamed over time).
 */

const fs = require('fs');
const path = require('path');

const API = 'https://psgc.gitlab.io/api';
const OUT_DIR = path.join(__dirname, '..', 'public', 'data', 'ph');
const BRGY_DIR = path.join(OUT_DIR, 'barangays');

// 17 of the 19 province-less cities are in NCR (which has districts, not
// provinces); the other two are independent cities not under any province.
// The dropdown still needs a top-level option for them, so each such region
// gets one synthetic "province" entry.
const PSEUDO_PROVINCE_LABELS = {
    '130000000': 'Metro Manila (NCR)'
};

async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
}

// A city/municipality or barangay outside any province is grouped under its
// region instead, so nothing is silently unreachable from the dropdowns.
function provinceKeyOf(row) {
    return row.provinceCode || row.regionCode;
}

const byName = (a, b) => a.n.localeCompare(b.n, 'en');

async function main() {
    console.log('Fetching PSGC data...');
    const [regions, provinces, cities, barangays] = await Promise.all([
        getJson(`${API}/regions.json`),
        getJson(`${API}/provinces.json`),
        getJson(`${API}/cities-municipalities.json`),
        getJson(`${API}/barangays.json`)
    ]);
    console.log(`  regions=${regions.length} provinces=${provinces.length} cities=${cities.length} barangays=${barangays.length}`);

    const regionNames = new Map(regions.map(r => [r.code, r.name]));

    const provinceOut = provinces.map(p => ({ c: p.code, n: p.name }));

    // Synthesize a province-level entry for every region that owns cities
    // directly (NCR, plus the two independent cities).
    const orphanRegions = new Set(cities.filter(c => !c.provinceCode).map(c => c.regionCode));
    for (const regionCode of orphanRegions) {
        const label = PSEUDO_PROVINCE_LABELS[regionCode]
            || `${regionNames.get(regionCode) || regionCode} (Independent City)`;
        provinceOut.push({ c: regionCode, n: label });
    }
    provinceOut.sort(byName);

    const cityOut = cities
        .map(c => ({ c: c.code, n: c.name, p: provinceKeyOf(c) }))
        .sort(byName);

    // Every barangay carries cityCode or municipalityCode (Manila's
    // sub-municipality barangays still carry the parent cityCode), so the
    // parent is always resolvable.
    const brgyByProvince = new Map();
    let skipped = 0;
    for (const b of barangays) {
        const parent = b.cityCode || b.municipalityCode;
        if (!parent) { skipped++; continue; }
        const key = provinceKeyOf(b);
        if (!brgyByProvince.has(key)) brgyByProvince.set(key, []);
        brgyByProvince.get(key).push({ c: b.code, n: b.name, m: parent });
    }
    if (skipped) console.warn(`  WARNING: ${skipped} barangay(s) had no resolvable parent and were skipped`);

    // Fail loudly rather than shipping a province whose barangay dropdown
    // would silently come up empty.
    const provinceCodes = new Set(provinceOut.map(p => p.c));
    const missing = [...provinceCodes].filter(code => !brgyByProvince.has(code));
    if (missing.length) console.warn(`  WARNING: no barangays for province code(s): ${missing.join(', ')}`);
    const orphanKeys = [...brgyByProvince.keys()].filter(k => !provinceCodes.has(k));
    if (orphanKeys.length) throw new Error(`Barangays reference unknown province key(s): ${orphanKeys.join(', ')}`);

    fs.rmSync(BRGY_DIR, { recursive: true, force: true });
    fs.mkdirSync(BRGY_DIR, { recursive: true });

    fs.writeFileSync(path.join(OUT_DIR, 'provinces.json'), JSON.stringify(provinceOut));
    fs.writeFileSync(path.join(OUT_DIR, 'cities.json'), JSON.stringify(cityOut));

    let totalBrgy = 0, biggest = 0;
    for (const [key, list] of brgyByProvince) {
        list.sort(byName);
        totalBrgy += list.length;
        const json = JSON.stringify(list);
        biggest = Math.max(biggest, Buffer.byteLength(json));
        fs.writeFileSync(path.join(BRGY_DIR, `${key}.json`), json);
    }

    const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
    console.log('Wrote:');
    console.log(`  provinces.json  ${provinceOut.length} rows  ${kb(fs.statSync(path.join(OUT_DIR, 'provinces.json')).size)}`);
    console.log(`  cities.json     ${cityOut.length} rows  ${kb(fs.statSync(path.join(OUT_DIR, 'cities.json')).size)}`);
    console.log(`  barangays/      ${brgyByProvince.size} files, ${totalBrgy} rows, largest ${kb(biggest)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
