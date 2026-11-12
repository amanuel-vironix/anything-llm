const { ApiKey } = require("../../models/apiKeys");
const { SystemSettings } = require("../../models/systemSettings");

/** `lastUsedAt` is written at most this often per key, so requests don't all write. */
const LAST_USED_INTERVAL_MS = 60 * 1000;

const ALL_ROLES = ["admin", "manager", "default"];
const STAFF_ROLES = ["admin", "manager"];

/**
 * Which owner roles may call each developer API route, keyed by `METHOD route-pattern`
 * (Express's `request.route.path`). A route missing from this table is admin-only, so
 * a newly added `/v1` route fails closed until someone decides who may use it.
 * Workspace routes additionally scope to the owner's workspaces (`apiKeyWorkspace`).
 */
const API_ROUTE_ROLES = {
  "GET /v1/auth": ALL_ROLES,
  "GET /v1/admin/is-multi-user-mode": ALL_ROLES,
  "GET /v1/workspaces": ALL_ROLES,
  "GET /v1/workspace/:slug": ALL_ROLES,
  "POST /v1/workspace/:slug/chat": ALL_ROLES,
  "POST /v1/workspace/:slug/stream-chat": ALL_ROLES,
  "POST /v1/workspace/:slug/vector-search": ALL_ROLES,
  "POST /v1/workspace/:slug/thread/new": ALL_ROLES,
  "POST /v1/workspace/:slug/thread/:threadSlug/update": ALL_ROLES,
  "DELETE /v1/workspace/:slug/thread/:threadSlug": ALL_ROLES,
  "GET /v1/workspace/:slug/thread/:threadSlug/chats": ALL_ROLES,
  "POST /v1/workspace/:slug/thread/:threadSlug/chat": ALL_ROLES,
  "POST /v1/workspace/:slug/thread/:threadSlug/stream-chat": ALL_ROLES,
  "GET /v1/openai/models": ALL_ROLES,
  "POST /v1/openai/chat/completions": ALL_ROLES,
  "POST /v1/openai/embeddings": ALL_ROLES,
  "GET /v1/openai/vector_stores": ALL_ROLES,
  "GET /v1/document/accepted-file-types": ALL_ROLES,
  "GET /v1/document/metadata-schema": ALL_ROLES,

  // Workspace and document management: what managers can do in the app.
  "POST /v1/workspace/new": STAFF_ROLES,
  "DELETE /v1/workspace/:slug": STAFF_ROLES,
  "POST /v1/workspace/:slug/update": STAFF_ROLES,
  "GET /v1/workspace/:slug/chats": STAFF_ROLES,
  "POST /v1/workspace/:slug/update-embeddings": STAFF_ROLES,
  "POST /v1/workspace/:slug/update-pin": STAFF_ROLES,
  "POST /v1/document/upload": STAFF_ROLES,
  "POST /v1/document/upload/:folderName": STAFF_ROLES,
  "POST /v1/document/upload-link": STAFF_ROLES,
  "POST /v1/document/raw-text": STAFF_ROLES,
  "GET /v1/documents": STAFF_ROLES,
  "GET /v1/documents/folder/:folderName": STAFF_ROLES,
  "GET /v1/document/:docName": STAFF_ROLES,
  "POST /v1/document/create-folder": STAFF_ROLES,
  "DELETE /v1/document/remove-folder": STAFF_ROLES,
  "POST /v1/document/move-files": STAFF_ROLES,
  "GET /v1/document/generated-files/:filename": STAFF_ROLES,
  // Image generation bypasses the account's allowed models.
  "POST /v1/openai/images/generations": STAFF_ROLES,
};

/**
 * Owner roles allowed on the request's route. Admin-only when the route is not listed.
 * @param {import("express").Request} request
 * @returns {string[]}
 */
function apiRolesForRoute(request) {
  const pattern = request.route?.path;
  const key = `${String(request.method).toUpperCase()} ${pattern}`;
  return API_ROUTE_ROLES[key] ?? ["admin"];
}

/**
 * Developer API key check.
 *
 * - Expired keys are refused.
 * - An owned key (`user_id` set) runs as its owner: a missing or suspended owner is
 *   refused, and `response.locals.user` is the owner, so chats are logged under them and
 *   their policy, workspaces and daily limit apply.
 * - A legacy key (no owner) is refused in multi-user mode (decision 24: refuse at once),
 *   since it can't be limited by any policy. In single-user mode there are no users, so
 *   legacy keys work as before.
 *
 * Sets `response.locals.apiKey` and `response.locals.multiUserMode`.
 */
async function validApiKey(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;

  const auth = request.header("Authorization");
  const bearerKey = auth ? auth.split(" ")[1] : null;
  if (!bearerKey) {
    response.status(403).json({
      error: "No valid api key found.",
    });
    return;
  }

  const apiKey = await ApiKey.get({ secret: bearerKey });
  if (!apiKey) {
    response.status(403).json({
      error: "No valid api key found.",
    });
    return;
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now()) {
    response.status(403).json({ error: "This API key has expired." });
    return;
  }

  if (apiKey.user_id) {
    const { User } = require("../../models/user");
    const owner = await User.get({ id: Number(apiKey.user_id) });
    if (!owner) {
      response
        .status(403)
        .json({ error: "The owner of this API key no longer exists." });
      return;
    }
    if (owner.suspended) {
      response
        .status(403)
        .json({ error: "The owner of this API key is suspended." });
      return;
    }
    if (!apiRolesForRoute(request).includes(owner.role)) {
      response.status(403).json({
        error: "This API key's owner is not allowed to use this endpoint.",
      });
      return;
    }
    response.locals.user = owner;
  } else if (multiUserMode) {
    const { EventLogs } = require("../../models/eventLogs");
    await EventLogs.logEvent("legacy_api_key_refused", {
      apiKeyId: apiKey.id,
      path: request.path,
    });
    response.status(403).json({
      error:
        "This API key has no owner and can't be used in multi-user mode. Ask an administrator to assign it an owner or issue a new key.",
    });
    return;
  }

  response.locals.apiKey = apiKey;
  touchLastUsed(apiKey);
  next();
}

/** Record `lastUsedAt` without blocking the request, at most once a minute per key. */
function touchLastUsed(apiKey) {
  const last = apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).getTime() : 0;
  if (Date.now() - last < LAST_USED_INTERVAL_MS) return;
  // Never let a failed write (or a throw before the promise exists) fail the request.
  Promise.resolve()
    .then(() => ApiKey.touch(apiKey.id))
    .catch(() => {});
}

/**
 * The user a developer API request runs as: the key's owner, or null for a legacy key
 * (single-user mode).
 * @param {import("express").Response} response
 * @returns {object|null}
 */
function apiKeyUser(response) {
  return response.locals.apiKey?.user_id ? response.locals.user ?? null : null;
}

/** Parse a key's `workspace_ids` into numbers, or null for "every reachable workspace". */
function apiKeyWorkspaceIds(apiKey) {
  if (!apiKey?.workspace_ids) return null;
  try {
    const ids = JSON.parse(apiKey.workspace_ids);
    return Array.isArray(ids) ? ids.map(Number) : [];
  } catch {
    return [];
  }
}

/**
 * Find one workspace the request's key may reach: its owner's workspaces (direct
 * membership, team, or all for admins and managers), narrowed by the key's
 * `workspace_ids`. Legacy keys (single-user mode) reach any workspace.
 * @param {import("express").Response} response
 * @param {object} clause - Prisma where clause, e.g. `{ slug }`
 * @returns {Promise<object|null>}
 */
async function apiKeyWorkspace(response, clause = {}) {
  const { Workspace } = require("../../models/workspace");
  const user = apiKeyUser(response);
  if (!user) return await Workspace.get(clause);
  const workspace = await Workspace.getWithUser(user, clause);
  if (!workspace) return null;
  const ids = apiKeyWorkspaceIds(response.locals.apiKey);
  if (ids && !ids.includes(Number(workspace.id))) return null;
  return workspace;
}

/**
 * List the workspaces the request's key may reach. See `apiKeyWorkspace`.
 * @param {import("express").Response} response
 * @param {object} clause
 * @returns {Promise<object[]>}
 */
async function apiKeyWorkspaces(response, clause = {}) {
  const { Workspace } = require("../../models/workspace");
  const user = apiKeyUser(response);
  const ids = apiKeyWorkspaceIds(response.locals.apiKey);
  const scoped = ids ? { ...clause, id: { in: ids } } : clause;
  if (!user) return await Workspace.where(scoped);
  return await Workspace.whereWithUser(user, scoped);
}

/**
 * A Prisma `where` fragment limiting a raw workspace query to what the key may reach,
 * or `{}` when the key reaches every workspace. For routes that query workspaces with
 * their own `include`s.
 * @param {import("express").Response} response
 * @returns {Promise<object>}
 */
async function apiKeyWorkspaceWhere(response) {
  const user = apiKeyUser(response);
  const ids = apiKeyWorkspaceIds(response.locals.apiKey);
  const unrestricted = !user || STAFF_ROLES.includes(user.role);
  if (unrestricted) return ids ? { id: { in: ids } } : {};
  const reachable = await apiKeyWorkspaces(response);
  return { id: { in: reachable.map((ws) => Number(ws.id)) } };
}

/**
 * Whether the request's owner may only see their own threads (default-role owners).
 * Admins, managers and legacy single-user keys see every thread.
 */
function apiKeyOwnThreadsOnly(response) {
  const user = apiKeyUser(response);
  return !!user && !STAFF_ROLES.includes(user.role);
}

module.exports = {
  validApiKey,
  API_ROUTE_ROLES,
  apiRolesForRoute,
  apiKeyUser,
  apiKeyWorkspace,
  apiKeyWorkspaces,
  apiKeyWorkspaceIds,
  apiKeyWorkspaceWhere,
  apiKeyOwnThreadsOnly,
};
