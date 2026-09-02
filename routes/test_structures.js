// Medical test structures: the shape of the result form for a kind of test.
//
// These were a hardcoded `testTemplates` object inside public/laboratory.js, so
// adding a test or fixing a reference range meant editing and redeploying the
// frontend. They are now data: administrators own them, the laboratory reads
// them, and a service can name the one it expects.
//
// Reads are open to any staff member because the laboratory workspace needs
// them to render its form. Writes are administrator-only and carry a reason,
// like every other configuration change here (see the audit-trail convention in
// CLAUDE.md) - a changed reference range is a clinical decision and the log has
// to say who made it and why.
const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { requireStaff, requireAdmin } = require('../config');
const { recordAudit, requireReason, snapshotRow } = require('../audit');
const { archiveRecord } = require('../archive');

const INPUT_MODES = ['structured', 'freeform'];
const FIELD_TYPES = ['number', 'text', 'select'];
const MAX_FIELDS = 60;

function cleanText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
}

// A field row as the editor sends it, trimmed to what the columns hold. A field
// with no label is dropped rather than rejected: the editor always keeps one
// blank row at the bottom for typing into.
function normalizeField(raw, order) {
    const label = cleanText(raw && raw.label, 120);
    if (!label) return null;
    const fieldType = FIELD_TYPES.includes(raw.field_type) ? raw.field_type : 'number';
    return {
        label,
        unit: cleanText(raw.unit, 40) || null,
        reference_range: cleanText(raw.reference_range, 120) || null,
        field_type: fieldType,
        // Only a select has options, and a select with none is a text box with
        // extra steps - so it falls back rather than rendering an empty list.
        options: fieldType === 'select' ? (cleanText(raw.options, 500) || null) : null,
        default_value: cleanText(raw.default_value, 120) || null,
        sort_order: order
    };
}

async function loadStructures({ includeInactive = false, id = null } = {}) {
    const where = ['ts.archived = false'];
    const params = [];
    if (!includeInactive) where.push('ts.is_active = true');
    if (id != null) { where.push('ts.id = ?'); params.push(id); }

    const [structures] = await pool.query(
        `SELECT ts.*,
                (SELECT COUNT(*) FROM service_packages sp
                  WHERE sp.test_structure_id = ts.id AND sp.archived = false) AS service_count
         FROM test_structures ts
         WHERE ${where.join(' AND ')}
         ORDER BY ts.name ASC`, params
    );
    if (structures.length === 0) return [];

    const [fields] = await pool.query(
        `SELECT * FROM test_structure_fields
         WHERE archived = false AND structure_id IN (${structures.map(() => '?').join(',')})
         ORDER BY structure_id, sort_order, id`,
        structures.map(s => s.id)
    );
    const byStructure = new Map();
    for (const field of fields) {
        if (!byStructure.has(field.structure_id)) byStructure.set(field.structure_id, []);
        byStructure.get(field.structure_id).push(field);
    }
    for (const structure of structures) {
        structure.fields = byStructure.get(structure.id) || [];
    }
    return structures;
}

// Replaces a structure's fields wholesale. The editor sends the whole list, and
// reconciling row by row would need stable ids the UI has no reason to carry;
// the previous set is archived rather than deleted so a result recorded against
// an old field can still be explained.
async function replaceFields(structureId, rawFields) {
    const fields = (rawFields || [])
        .slice(0, MAX_FIELDS)
        .map(normalizeField)
        .filter(Boolean)
        .map((field, index) => ({ ...field, sort_order: index }));

    await pool.query(
        'UPDATE test_structure_fields SET archived = true, archived_at = NOW() WHERE structure_id = ? AND archived = false',
        [structureId]
    );
    for (const field of fields) {
        await pool.query(
            `INSERT INTO test_structure_fields
                (structure_id, label, unit, reference_range, field_type, options, default_value, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [structureId, field.label, field.unit, field.reference_range,
             field.field_type, field.options, field.default_value, field.sort_order]
        );
    }
    return fields;
}

// ── READ (any staff member) ────────────────────────────────────────────────
router.get('/', requireStaff, async (req, res) => {
    try {
        const includeInactive = req.query.all === '1' || req.query.all === 'true';
        res.json(await loadStructures({ includeInactive }));
    } catch (err) {
        console.error('Test structures load error:', err);
        res.status(500).json({ error: 'Failed to load test structures' });
    }
});

router.get('/:id', requireStaff, async (req, res) => {
    try {
        const rows = await loadStructures({ includeInactive: true, id: Number(req.params.id) });
        if (rows.length === 0) return res.status(404).json({ error: 'Test structure not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Test structure load error:', err);
        res.status(500).json({ error: 'Failed to load test structure' });
    }
});

// ── WRITE (administrators, with a reason) ──────────────────────────────────
router.post('/', requireAdmin, requireReason, async (req, res) => {
    const { name, description, input_mode, is_active, fields } = req.body;
    try {
        const cleanName = cleanText(name, 120);
        if (!cleanName) return res.status(400).json({ error: 'A name is required.' });
        const mode = INPUT_MODES.includes(input_mode) ? input_mode : 'structured';

        const [clash] = await pool.query(
            'SELECT id FROM test_structures WHERE name = ? AND archived = false LIMIT 1', [cleanName]);
        if (clash.length > 0) {
            return res.status(409).json({ error: `A test structure called "${cleanName}" already exists.` });
        }

        const [result] = await pool.query(
            'INSERT INTO test_structures (name, description, input_mode, is_active) VALUES (?, ?, ?, ?)',
            [cleanName, cleanText(description, 255) || null, mode, is_active === false ? false : true]
        );
        // A freeform structure has no fields by definition - that is what makes
        // it freeform - so any sent with one are ignored rather than stored and
        // never rendered.
        const saved = mode === 'freeform' ? [] : await replaceFields(result.insertId, fields);

        await recordAudit({
            req, action: 'create', entityType: 'test_structure', entityId: result.insertId,
            summary: `Added the "${cleanName}" result form (${mode}, ${saved.length} field(s))`,
            reason: req.auditReason,
            after: { name: cleanName, input_mode: mode, fields: saved.map(f => f.label) }
        });
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Test structure create error:', err);
        res.status(500).json({ error: 'Failed to create test structure' });
    }
});

router.put('/:id', requireAdmin, requireReason, async (req, res) => {
    const { name, description, input_mode, is_active, fields } = req.body;
    const id = Number(req.params.id);
    try {
        const before = await loadStructures({ includeInactive: true, id });
        if (before.length === 0) return res.status(404).json({ error: 'Test structure not found' });
        const cleanName = cleanText(name, 120) || before[0].name;
        const mode = INPUT_MODES.includes(input_mode) ? input_mode : before[0].input_mode;

        const [clash] = await pool.query(
            'SELECT id FROM test_structures WHERE name = ? AND id <> ? AND archived = false LIMIT 1', [cleanName, id]);
        if (clash.length > 0) {
            return res.status(409).json({ error: `A test structure called "${cleanName}" already exists.` });
        }

        await pool.query(
            'UPDATE test_structures SET name=?, description=?, input_mode=?, is_active=? WHERE id=?',
            [cleanName, cleanText(description, 255) || null, mode, is_active === false ? false : true, id]
        );
        const saved = mode === 'freeform' ? await replaceFields(id, []) : await replaceFields(id, fields);

        await recordAudit({
            req, action: 'update', entityType: 'test_structure', entityId: id,
            summary: `Updated the "${cleanName}" result form (${mode}, ${saved.length} field(s))`,
            reason: req.auditReason,
            before: {
                name: before[0].name, input_mode: before[0].input_mode, is_active: !!before[0].is_active,
                fields: before[0].fields.map(f => `${f.label}${f.reference_range ? ` [${f.reference_range}]` : ''}`)
            },
            after: {
                name: cleanName, input_mode: mode, is_active: is_active === false ? false : true,
                fields: saved.map(f => `${f.label}${f.reference_range ? ` [${f.reference_range}]` : ''}`)
            }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Test structure update error:', err);
        res.status(500).json({ error: 'Failed to update test structure' });
    }
});

router.delete('/:id', requireAdmin, requireReason, async (req, res) => {
    const id = Number(req.params.id);
    try {
        const [rows] = await pool.query('SELECT * FROM test_structures WHERE id=? AND archived=false', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Test structure not found' });

        // A service pointing at a form that no longer exists would open the
        // workspace on nothing, so the link has to be dealt with first. Naming
        // the services is more useful than refusing without saying which.
        const [inUse] = await pool.query(
            'SELECT name FROM service_packages WHERE test_structure_id=? AND archived=false', [id]);
        if (inUse.length > 0) {
            return res.status(409).json({
                error: `${inUse.length} service(s) still expect this result form: ${inUse.map(s => s.name).join(', ')}. Point them at another form first.`,
                services: inUse.map(s => s.name)
            });
        }

        const archived = await archiveRecord('test_structures', 'id', id, 'test_structure', req, req.auditReason);
        if (!archived) return res.status(400).json({ error: 'That test structure is already archived.' });
        res.json({ success: true });
    } catch (err) {
        console.error('Test structure archive error:', err);
        res.status(500).json({ error: 'Failed to archive test structure' });
    }
});

module.exports = router;
module.exports.loadStructures = loadStructures;
