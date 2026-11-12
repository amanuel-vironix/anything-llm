/**
 * Database backstop (PLAN-audit-logging-and-compliance.md section 5.2).
 *
 * A Prisma middleware notes every write to a sensitive table. When the request
 * (or job) that made it finishes, each table written without a catalogue
 * action covering it gets one low-detail `db.write` audit row. A `db.write`
 * row is a missing catalogue event: find the code path and record the right
 * action there.
 *
 * Writes outside any request or job context are pooled and flushed once a
 * minute, so a loop can't write a row per call.
 */
const context = require("./context");

// Table -> which operations count. `workspace_chats` counts only deletes and
// hides (include=false), not new chats.
const SENSITIVE_TABLES = {
  users: "all",
  api_keys: "all",
  workspace_users: "all",
  system_settings: "all",
  scheduled_jobs: "all",
  memories: "all",
  invites: "all",
  browser_extension_api_keys: "all",
  desktop_mobile_devices: "all",
  temporary_auth_tokens: "all",
  recovery_codes: "all",
  access_policies: "all",
  teams: "all",
  team_members: "all",
  user_identities: "all",
  workspace_chats: "delete_or_hide",
};

const WRITE_ACTIONS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

/**
 * @param {{model?: string, action: string, args?: Object}} params
 * @returns {string|null} the table name if this write counts
 */
function sensitiveTable(params) {
  if (!params?.model || !WRITE_ACTIONS.has(params.action)) return null;
  const rule = SENSITIVE_TABLES[params.model];
  if (!rule) return null;
  if (rule === "all") return params.model;
  if (params.action === "delete" || params.action === "deleteMany")
    return params.model;
  if (
    (params.action === "update" || params.action === "updateMany") &&
    params.args?.data?.include === false
  )
    return params.model;
  return null;
}

function countOf(result) {
  if (result && typeof result.count === "number") return result.count;
  return 1;
}

const orphan = context.newContext({ channel: "system" });
orphan.actor = { actorType: "system", actorId: null, onBehalfOf: null };
let orphanTimer = null;

/**
 * @param {Object} ctx
 * @param {string} table
 * @param {string} operation
 * @param {number} count
 */
function note(ctx, table, operation, count) {
  const prev = ctx.writes.get(table);
  ctx.writes.set(table, {
    operation: prev && prev.operation !== operation ? "mixed" : operation,
    count: (prev?.count || 0) + count,
  });
}

/**
 * The Prisma `$use` middleware.
 */
async function middleware(params, next) {
  // Read the store before awaiting the engine: its callbacks don't keep the
  // caller's async context.
  const ctx = context.currentContext();
  const result = await next(params);
  const table = sensitiveTable(params);
  if (!table) return result;
  if (ctx) {
    note(ctx, table, params.action, countOf(result));
  } else {
    note(orphan, table, params.action, countOf(result));
    if (!orphanTimer) {
      orphanTimer = setTimeout(() => {
        orphanTimer = null;
        flush(orphan).catch(() => {});
      }, 60_000);
      orphanTimer.unref?.();
    }
  }
  return result;
}

/**
 * Writes `db.write` for each table written in `ctx` with no covering action.
 * @param {Object} ctx
 * @returns {Promise<number>} rows written
 */
async function flush(ctx) {
  if (!ctx?.writes || ctx.writes.size === 0) return 0;
  const { audit } = require("./index");
  const pending = [...ctx.writes.entries()].filter(
    ([table]) => !ctx.covered.has(table)
  );
  ctx.writes.clear();
  let written = 0;
  for (const [table, { operation, count }] of pending) {
    try {
      await audit.record(
        {
          action: "db.write",
          targetType: table,
          metadata: { table, operation, count },
        },
        { ctx }
      );
      written += 1;
    } catch {
      // db.write is not must_record; record() only throws on programmer error.
    }
  }
  return written;
}

/**
 * Installs the middleware on a Prisma client once.
 * @param {import("@prisma/client").PrismaClient} client
 */
function install(client) {
  if (!client || client.__auditBackstop) return client;
  if (typeof client.$use === "function") client.$use(middleware);
  Object.defineProperty(client, "__auditBackstop", { value: true });
  return client;
}

module.exports = {
  install,
  flush,
  middleware,
  sensitiveTable,
  SENSITIVE_TABLES,
};
