/**
 * Reads `audit_events` rows in tests. `EventLogs.logEvent` now writes there
 * through `server/utils/audit/legacy.js`, under catalogue action names, so
 * tests that used to read `event_logs` by legacy name read these instead.
 */

/** Parses a row's metadata JSON onto `row.meta`. */
function withMeta(row) {
  if (!row) return null;
  return { ...row, meta: row.metadata ? JSON.parse(row.metadata) : {} };
}

/**
 * The newest row for `action` that passes `filter`, or null.
 * @param {Object} prisma
 * @param {string} action - catalogue action, e.g. "auth.login_failed"
 * @param {(row: Object) => boolean} [filter] - sees the row with `meta`
 */
async function lastAudit(prisma, action, filter = () => true) {
  const rows = await prisma.audit_events.findMany({
    where: { action },
    orderBy: { id: "desc" },
  });
  return rows.map(withMeta).find(filter) || null;
}

/** How many rows for `action` pass `filter`. */
async function auditCount(prisma, action, filter = () => true) {
  const rows = await prisma.audit_events.findMany({ where: { action } });
  return rows.map(withMeta).filter(filter).length;
}

module.exports = { lastAudit, auditCount };
