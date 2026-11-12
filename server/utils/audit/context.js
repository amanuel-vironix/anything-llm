/**
 * Request context for audit events (PLAN-audit-logging-and-compliance.md
 * section 3.2).
 *
 * `auditContext` runs before every route. It gives the request an id, works
 * out the channel from the path, and records IP and user agent in
 * `response.locals.audit` and in an AsyncLocalStorage store, so code far from
 * the handler (models, helpers, the database backstop) can find it.
 *
 * The actor isn't known yet when this middleware runs: authentication
 * middleware runs later and fills `response.locals`. `resolveActor` reads it
 * at record time.
 */
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const storage = new AsyncLocalStorage();
const BACKSTOP_DELAY_MS = 2_000;

/**
 * @typedef {Object} AuditContext
 * @property {string} requestId
 * @property {string} channel
 * @property {string|null} ip
 * @property {string|null} userAgent
 * @property {Object|null} locals - the response's `locals`, read for the actor
 * @property {{actorType: string, actorId: (string|null), onBehalfOf: (number|null)}|null} actor - fixed actor (jobs, boot)
 * @property {Map<string, {operation: string, count: number}>} writes - sensitive tables written (backstop)
 * @property {Set<string>} covered - tables covered by a recorded catalogue action
 */

/**
 * @param {string} path
 * @returns {string}
 */
function channelForPath(path = "") {
  if (path.startsWith("/api/v1/openai")) return "openai";
  if (path.startsWith("/api/v1/")) return "api";
  if (path.startsWith("/api/embed")) return "embed";
  if (path.startsWith("/api/mobile")) return "mobile";
  if (path.startsWith("/api/browser-extension")) return "extension";
  if (path.endsWith(".websocket") || path.includes("/agent-invocation/"))
    return "ws";
  return "ui";
}

/**
 * @param {Partial<AuditContext>} fields
 * @returns {AuditContext}
 */
function newContext(fields = {}) {
  return {
    requestId: fields.requestId || crypto.randomUUID(),
    channel: fields.channel || "system",
    ip: fields.ip ?? null,
    userAgent: fields.userAgent ?? null,
    locals: fields.locals ?? null,
    actor: fields.actor ?? null,
    writes: new Map(),
    covered: new Set(),
  };
}

/**
 * Express middleware. Mount before any route.
 */
function auditContext(request, response, next) {
  const incoming = request.headers?.["x-request-id"];
  const ctx = newContext({
    requestId:
      typeof incoming === "string" && /^[A-Za-z0-9._-]{8,64}$/.test(incoming)
        ? incoming
        : undefined,
    channel: channelForPath(request.originalUrl || request.path || ""),
    ip: request.ip || request.socket?.remoteAddress || null,
    userAgent: request.headers?.["user-agent"]?.slice(0, 256) || null,
    locals: response.locals,
  });
  response.locals.audit = ctx;
  if (typeof response.setHeader === "function")
    response.setHeader("X-Request-Id", ctx.requestId);
  if (typeof response.on === "function") {
    response.on("finish", () => {
      // Some handlers record after sending the response; give them a moment
      // before the backstop decides a write went unrecorded. Lazy require:
      // the backstop needs the writer, which needs this file.
      const timer = setTimeout(() => {
        require("./backstop")
          .flush(ctx)
          .catch(() => {});
      }, BACKSTOP_DELAY_MS);
      timer.unref?.();
    });
  }
  storage.run(ctx, () => next());
}

/**
 * Runs `fn` with a fixed, non-request actor (a job, boot, the collector
 * client). Writes made inside are checked by the backstop when `fn` settles.
 * @template T
 * @param {{actorType: string, actorId?: (string|number|null), onBehalfOf?: (number|null), channel: string}} who
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runAs(who, fn) {
  const ctx = newContext({
    channel: who.channel,
    actor: {
      actorType: who.actorType,
      actorId:
        who.actorId === undefined || who.actorId === null
          ? null
          : String(who.actorId),
      onBehalfOf: who.onBehalfOf ?? null,
    },
  });
  try {
    // Await inside the store: a Prisma query is a lazy thenable that would
    // otherwise run after the store is gone.
    return await storage.run(ctx, async () => await fn());
  } finally {
    await require("./backstop").flush(ctx);
  }
}

/** @returns {AuditContext|undefined} */
function currentContext() {
  return storage.getStore();
}

/**
 * Works out who is acting from a context's `locals`, filled by the auth
 * middleware of each channel.
 * @param {AuditContext|null|undefined} ctx
 * @returns {{actorType: string, actorId: (string|null), onBehalfOf: (number|null)}}
 */
function resolveActor(ctx) {
  if (!ctx) return { actorType: "system", actorId: null, onBehalfOf: null };
  if (ctx.actor) return ctx.actor;
  const locals = ctx.locals || {};
  const userId = locals.user?.id ? Number(locals.user.id) : null;

  if (locals.device)
    return {
      actorType: "mobile_device",
      actorId: String(locals.device.id ?? locals.device.deviceId ?? ""),
      onBehalfOf: userId,
    };
  if (ctx.channel === "extension" && locals.apiKey)
    return {
      actorType: "extension_key",
      actorId: locals.apiKey.id ? String(locals.apiKey.id) : null,
      onBehalfOf: userId,
    };
  if (locals.apiKey && (ctx.channel === "api" || ctx.channel === "openai"))
    return {
      actorType: "api_key",
      actorId: locals.apiKey.id ? String(locals.apiKey.id) : null,
      onBehalfOf: locals.apiKey.user_id ?? locals.apiKey.ownerId ?? userId,
    };
  if (ctx.channel === "api" || ctx.channel === "openai")
    // Developer keys have no owner or id in context until scoped keys land.
    return { actorType: "api_key", actorId: null, onBehalfOf: userId };
  // Embed admin routes also put an embedConfig in locals, after
  // validatedRequest has set a user or multiUserMode; only the widget's
  // routes have an embedConfig and neither.
  if (locals.embedConfig && !userId && locals.multiUserMode === undefined)
    return {
      actorType: "embed_session",
      actorId: locals.embedConfig.uuid ? String(locals.embedConfig.uuid) : null,
      onBehalfOf: null,
    };
  if (userId)
    return { actorType: "user", actorId: String(userId), onBehalfOf: userId };
  // Single-user mode: the instance owner, with no user row.
  if (locals.multiUserMode === false)
    return { actorType: "user", actorId: null, onBehalfOf: null };
  return { actorType: "unknown", actorId: null, onBehalfOf: null };
}

module.exports = {
  auditContext,
  runAs,
  currentContext,
  resolveActor,
  channelForPath,
  newContext,
  storage,
};
