const prisma = require("../utils/prisma");

/**
 * Shapes an `audit_events` row like the old `event_logs` row the Event Logs
 * page renders, with the new columns folded into its metadata.
 */
function asLegacyRow(row) {
  let metadata = {};
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    metadata = {};
  }
  const details = {
    ...metadata,
    outcome: row.outcome,
    ...(row.reason ? { reason: row.reason } : {}),
    actor: `${row.actor_type}${row.actor_id ? `:${row.actor_id}` : ""}`,
    channel: row.channel,
    ...(row.target_type
      ? {
          target: `${row.target_type}${row.target_id ? `:${row.target_id}` : ""}`,
        }
      : {}),
    ...(row.ip ? { ip: row.ip } : {}),
  };
  return {
    id: row.id,
    event: row.action,
    metadata: JSON.stringify(details),
    userId:
      row.actor_type === "user" && row.actor_id
        ? Number(row.actor_id)
        : row.on_behalf_of,
    occurredAt: row.occurred_at,
  };
}

/** Maps old `event_logs` filters and ordering to `audit_events` columns. */
function toAuditClause(clause = {}) {
  const out = {};
  for (const [key, value] of Object.entries(clause || {})) {
    if (key === "event") out.action = value;
    else if (key === "userId") out.on_behalf_of = value;
    else if (key === "occurredAt") out.occurred_at = value;
    else out[key] = value;
  }
  return out;
}

function toAuditOrder(orderBy) {
  if (!orderBy) return { occurred_at: "desc" };
  return toAuditClause(orderBy);
}

const EventLogs = {
  /**
   * Deprecated: call `audit.record` from `server/utils/audit` with a
   * catalogue action. Kept as a thin wrapper until every caller has moved.
   * Legacy callers aren't written to fail closed, so a failed write is
   * reported in the return value rather than thrown.
   */
  logEvent: async function (event, metadata = {}, userId = null) {
    const { audit } = require("../utils/audit");
    const { mapLegacyEvent } = require("../utils/audit/legacy");
    const events = mapLegacyEvent(event, metadata, userId);
    if (events.length === 0) {
      console.error(`[audit] unmapped legacy event: ${event}`);
      return { eventLog: null, message: `Unmapped legacy event ${event}` };
    }
    try {
      let eventLog = null;
      for (const auditEvent of events) {
        const row = await audit.record(auditEvent);
        if (!eventLog) eventLog = row;
      }
      return { eventLog, message: null };
    } catch (error) {
      console.error(`[audit] logging failed for ${event}: ${error.message}`);
      return { eventLog: null, message: error.message };
    }
  },

  getByEvent: async function (event, limit = null, orderBy = null) {
    return this.where({ event }, limit, orderBy);
  },

  getByUserId: async function (userId, limit = null, orderBy = null) {
    return this.where({ userId }, limit, orderBy);
  },

  /**
   * Reads `audit_events` (which also holds the copied `event_logs` rows) in
   * the old row shape. Filters use the old field names.
   */
  where: async function (
    clause = {},
    limit = null,
    orderBy = null,
    offset = null
  ) {
    try {
      const rows = await prisma.audit_events.findMany({
        where: toAuditClause(clause),
        ...(limit !== null ? { take: limit } : {}),
        ...(offset !== null ? { skip: offset } : {}),
        orderBy: toAuditOrder(orderBy),
      });
      return rows.map(asLegacyRow);
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  whereWithData: async function (
    clause = {},
    limit = null,
    offset = null,
    orderBy = null
  ) {
    const { User } = require("./user");

    try {
      const results = await this.where(clause, limit, orderBy, offset);

      for (const res of results) {
        const user = res.userId ? await User.get({ id: res.userId }) : null;
        res.user = user ? { username: user.username } : { username: null };
      }

      return results;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  count: async function (clause = {}) {
    try {
      return await prisma.audit_events.count({ where: toAuditClause(clause) });
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },

  /**
   * Deletes legacy `event_logs` rows only. Audit rows can't be deleted through
   * the app; PR B removes this and the route that calls it (F-54).
   */
  delete: async function (clause = {}) {
    try {
      await prisma.event_logs.deleteMany({
        where: clause,
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },
};

module.exports = { EventLogs };
