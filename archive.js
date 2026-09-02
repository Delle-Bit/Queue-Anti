const { pool } = require('./database');
const { recordAudit, scrubSnapshot } = require('./audit');

// ── UNIVERSAL SOFT DELETE ───────────────────────────────────────────────────
// Nothing in this system is deleted outright. Every "delete" flags the row
// archived, files a full snapshot under archived_records so it can be put back
// with one action, and writes the change to the audit trail with the reason the
// operator gave.
//
// This lives in its own module rather than inside routes/admin.js because the
// service catalogue (routes/packages.js) archives through it too, and two
// copies of the archive logic would eventually disagree about what a soft
// delete means.

// A name a human can recognise in the archive list. Without it the list reads
// "user / 42", which is no help when deciding what to restore.
function describeRecord(row) {
    if (!row) return '';
    const label = row.full_name || row.name || row.username || row.service_name ||
                  row.ticket_number || row.number || row.package_name ||
                  (row.id != null ? `#${row.id}` : '');
    return String(label).slice(0, 255);
}

// Every entity that can be soft-deleted, and where to put it back. Restore and
// permanent-delete share this map so the two can never drift apart.
const ARCHIVE_TABLE_MAP = {
    user: ['users', 'id'],
    laboratory: ['laboratories', 'id'],
    doctor: ['doctors', 'id'],
    service_package: ['service_packages', 'id'],
    test_structure: ['test_structures', 'id'],
    package_laboratory: ['package_laboratories', 'id'],
    appointment: ['appointments', 'id'],
    announcement: ['announcements', 'id'],
    queue: ['queue', 'id'],
    queue_sequence: ['queue_sequences', 'id'],
    queue_log: ['queue_logs', 'id'],
    medical_record: ['medical_records', 'id'],
    lab_note: ['lab_notes', 'id']
};

async function archiveRecord(table, idColumn, idValue, entityType, req, reason) {
    const [rows] = await pool.query(`SELECT * FROM ${table} WHERE ${idColumn} = ?`, [idValue]);
    if (rows.length === 0) return false;
    const row = rows[0];
    // Already archived - filing a second snapshot would leave two archive
    // entries competing to restore the same row.
    if (row.archived) return false;

    const userId = req && req.user ? req.user.id : null;
    const why = reason != null ? reason : ((req && req.auditReason) || '');
    await pool.query(
        `INSERT INTO archived_records (entity_type, entity_id, snapshot, label, reason, archived_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entityType, String(idValue), JSON.stringify(scrubSnapshot(row)), describeRecord(row), why, userId]
    );
    await pool.query(`UPDATE ${table} SET archived=true, archived_at=NOW() WHERE ${idColumn} = ?`, [idValue]);
    await recordAudit({
        req,
        action: 'archive',
        entityType,
        entityId: idValue,
        summary: `Archived ${entityType} "${describeRecord(row)}"`,
        reason: why,
        before: row,
        after: null
    });
    return true;
}

module.exports = { describeRecord, ARCHIVE_TABLE_MAP, archiveRecord };
