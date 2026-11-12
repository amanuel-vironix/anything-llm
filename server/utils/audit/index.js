/**
 * The audit writer (PLAN-audit-logging-and-compliance.md section 3.2).
 *
 *   const { audit } = require("../utils/audit");
 *   await audit.record(
 *     { action: "workspace.deleted", targetType: "workspace", targetId: ws.id,
 *       workspaceId: ws.id, metadata: { slug: ws.slug } },
 *     { response }            // or { ctx }, or nothing inside a request/job
 *   );
 *
 * - The action must be in the catalogue; an unknown action throws.
 * - Metadata keys not allowed for the action are dropped and counted.
 * - With `tx` (a Prisma interactive transaction client) the row is written in
 *   the caller's transaction and any error propagates.
 * - Without `tx` the row is inserted directly; if that fails it goes to the
 *   durable outbox. If both fail, a `must_record` action throws `AuditError`;
 *   any other action is counted in `stats().writeFailed`.
 * - The actor, channel, IP, user agent and request id come from the request
 *   context (`./context`), unless the event names an `actor`.
 */
const prisma = require("../prisma");
const { entryFor, OUTCOMES, ACTOR_TYPES, CHANNELS } = require("./catalogue");
const { sanitizeMetadata } = require("./sanitize");
const context = require("./context");
const outbox = require("./outbox");

class AuditError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "AuditError";
    if (cause) this.cause = cause;
  }
}

const counters = {
  written: 0,
  outboxed: 0,
  writeFailed: 0,
  droppedKeys: 0,
  denialsSuppressed: 0,
};

// Denials are rate-limited per actor, action and reason so a client in a loop
// can't flood the table (section 3.2): DENIAL_LIMIT rows per window.
const DENIAL_WINDOW_MS = 60_000;
const DENIAL_LIMIT = 20;
const denialWindows = new Map();

function allowDenial(key, now = Date.now()) {
  const win = denialWindows.get(key);
  if (!win || now - win.start > DENIAL_WINDOW_MS) {
    denialWindows.set(key, { start: now, count: 1 });
    if (denialWindows.size > 10_000) denialWindows.clear();
    return true;
  }
  win.count += 1;
  return win.count <= DENIAL_LIMIT;
}

function toId(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function toInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * @typedef {Object} AuditEvent
 * @property {string} action - catalogue name
 * @property {"success"|"denied"|"failed"} [outcome]
 * @property {string} [reason] - short code for denied or failed
 * @property {string} [targetType]
 * @property {string|number} [targetId]
 * @property {number} [workspaceId]
 * @property {number} [teamId]
 * @property {Object} [metadata] - allow-listed keys only
 * @property {{type: string, id?: (string|number|null), onBehalfOf?: (number|null)}} [actor] - overrides the context actor
 */

/**
 * Builds the row for an event without writing it.
 * @param {AuditEvent} event
 * @param {{ctx?: Object, response?: Object}} [opts]
 */
function buildRow(event, opts = {}) {
  if (!event || typeof event.action !== "string")
    throw new AuditError("audit.record needs an action");
  const entry = entryFor(event.action);
  if (!entry) throw new AuditError(`Unknown audit action: ${event.action}`);
  const outcome = event.outcome || "success";
  if (!OUTCOMES.includes(outcome))
    throw new AuditError(`Unknown audit outcome: ${outcome}`);

  const ctx =
    opts.ctx ||
    opts.response?.locals?.audit ||
    context.currentContext() ||
    null;
  let actor = context.resolveActor(ctx);
  if (event.actor) {
    if (!ACTOR_TYPES.includes(event.actor.type))
      throw new AuditError(`Unknown actor type: ${event.actor.type}`);
    actor = {
      actorType: event.actor.type,
      actorId: toId(event.actor.id),
      onBehalfOf:
        event.actor.onBehalfOf !== undefined
          ? toInt(event.actor.onBehalfOf)
          : event.actor.type === "user"
            ? toInt(event.actor.id)
            : null,
    };
  }
  const channel =
    ctx?.channel && CHANNELS.includes(ctx.channel) ? ctx.channel : "system";

  const { metadata, dropped } = sanitizeMetadata(
    event.metadata || {},
    entry.metadata
  );
  if (dropped.length > 0) counters.droppedKeys += dropped.length;

  return {
    entry,
    ctx,
    row: {
      occurred_at: new Date(),
      action: event.action,
      outcome,
      reason: event.reason ? String(event.reason).slice(0, 100) : null,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      on_behalf_of: toInt(actor.onBehalfOf),
      team_id: toInt(event.teamId),
      workspace_id: toInt(event.workspaceId),
      target_type: event.targetType ? String(event.targetType) : null,
      target_id: toId(event.targetId),
      channel,
      ip: ctx?.ip ?? null,
      user_agent: ctx?.userAgent ?? null,
      request_id: ctx?.requestId ?? null,
      metadata:
        Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    },
  };
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    outbox.flush(prisma).catch(() => {});
  }, 30_000);
  flushTimer.unref?.();
}

/**
 * Records one audit event.
 * @param {AuditEvent} event
 * @param {{tx?: Object, ctx?: Object, response?: Object}} [opts]
 * @returns {Promise<Object|null>} the row, `{queued: true}` if it went to the outbox, or null if dropped
 */
async function record(event, opts = {}) {
  const { entry, ctx, row } = buildRow(event, opts);

  if (row.outcome === "denied") {
    const key = `${row.actor_type}:${row.actor_id}:${row.action}:${row.reason}`;
    if (!allowDenial(key)) {
      counters.denialsSuppressed += 1;
      return null;
    }
  }

  // The backstop treats these tables as accounted for in this request.
  if (ctx?.covered) for (const table of entry.tables) ctx.covered.add(table);

  if (opts.tx) {
    const created = await opts.tx.audit_events.create({ data: row });
    counters.written += 1;
    return created;
  }

  try {
    const created = await prisma.audit_events.create({ data: row });
    counters.written += 1;
    return created;
  } catch (dbError) {
    try {
      outbox.append(row);
      counters.outboxed += 1;
      scheduleFlush();
      return { queued: true };
    } catch (outboxError) {
      counters.writeFailed += 1;
      console.error(
        `[audit] write failed for ${row.action}: ${dbError.message}; outbox: ${outboxError.message}`
      );
      if (entry.must)
        throw new AuditError(
          `Audit record for ${row.action} could not be written`,
          { cause: dbError }
        );
      return null;
    }
  }
}

/**
 * Records an event and, if it is `must_record` and fails, ends the request
 * with 500. Returns false when the caller must stop.
 *
 *   if (!(await audit.recordOrFail(event, response))) return;
 *
 * @param {AuditEvent} event
 * @param {Object} response - Express response
 * @param {{tx?: Object}} [opts]
 * @returns {Promise<boolean>}
 */
async function recordOrFail(event, response, opts = {}) {
  try {
    await record(event, { ...opts, response });
    return true;
  } catch (e) {
    if (!(e instanceof AuditError)) throw e;
    console.error(e.message);
    if (!response.headersSent)
      response.status(500).json({
        success: false,
        error: "This action could not be recorded in the audit log.",
      });
    return false;
  }
}

/**
 * A context for code with no request: boot, jobs, workers.
 * @param {"boot"|"job"|"system"} channel
 * @param {{actorType?: string, actorId?: (string|number|null), onBehalfOf?: (number|null)}} [who]
 */
function systemContext(channel = "system", who = {}) {
  const ctx = context.newContext({ channel });
  ctx.actor = {
    actorType: who.actorType || (channel === "job" ? "job" : "system"),
    actorId: toId(who.actorId),
    onBehalfOf: toInt(who.onBehalfOf),
  };
  return ctx;
}

function stats() {
  return { ...counters, outboxBacklog: outbox.backlog() };
}

/** For tests. */
function _resetForTests() {
  for (const key of Object.keys(counters)) counters[key] = 0;
  denialWindows.clear();
}

const audit = {
  record,
  recordOrFail,
  buildRow,
  systemContext,
  runAs: context.runAs,
  middleware: context.auditContext,
  stats,
  flushOutbox: (dir) => outbox.flush(prisma, dir),
  AuditError,
  _resetForTests,
};

module.exports = { audit, AuditError };
