/**
 * Route audit declarations (PLAN-audit-logging-and-compliance.md section 5.1).
 *
 * Every state-changing route (POST, PUT, PATCH, DELETE, websocket) must be
 * declared here, keyed "METHOD /path" exactly as registered (without "/api").
 * A GET route that reads other users' data or documents is declared too.
 * Each entry is one of:
 *
 * - `{ actions: ["area.verb", ...], in?: ["models/x.js"] }`: the handler
 *   records these catalogue actions. Each action name must appear as a string
 *   literal in the handler source, or in one of the `in` files (paths relative
 *   to server/) when a model or helper records it.
 * - `{ legacy: ["old_event"], in?: [...] }`: the handler still calls
 *   `EventLogs.logEvent` with these old names (files owned by another branch;
 *   see docs/merge-coordination.md). The wrapper maps them to catalogue actions.
 * - `{ exempt: "reason" }`: the route changes nothing worth an audit row, or
 *   only reads. The reason is required.
 * - `{ pending: "AP" | "GS", actions: [...] }`: the route is in a file another
 *   branch is editing; its events are added after that branch merges. Allowed
 *   only for files listed in `PENDING_FILES`.
 *
 * Declarations are split by area so parallel branches edit different files.
 */
const FRAGMENTS = [
  require("./held"),
  require("./system"),
  require("./workspaces"),
  require("./developerApi"),
  require("./channels"),
  require("./agents"),
];

// Files another branch is editing (docs/merge-coordination.md), by owner.
const PENDING_FILES = {
  "endpoints/admin": "AP",
  "endpoints/invite": "GS",
  "endpoints/modelRouter": "AP",
  "endpoints/mobile": "AP",
  "endpoints/agentWebsocket": "AP",
  "endpoints/api/admin": "GS",
  "endpoints/api/workspace": "AP",
  "endpoints/api/workspaceThread": "AP",
  "endpoints/api/openai": "AP",
};

// Routes in a shared file that one branch is editing. system.js: GS edits
// the login routes, AP the API-key, preset and prompt-variable routes; the
// rest of the file is this branch's.
const PENDING_ROUTES = {
  "POST /request-token": "GS",
  "GET /request-token/sso/simple": "GS",
  "POST /system/enable-multi-user": "GS",
  "POST /system/generate-api-key": "AP",
  "DELETE /system/api-key/:id": "AP",
  "POST /system/slash-command-presets": "AP",
  "POST /system/slash-command-presets/:slashCommandId": "AP",
  "DELETE /system/slash-command-presets/:slashCommandId": "AP",
  "POST /system/prompt-variables": "AP",
  "PUT /system/prompt-variables/:id": "AP",
  "DELETE /system/prompt-variables/:id": "AP",
};

/** @returns {Record<string, Object>} */
function allDeclarations() {
  const out = {};
  for (const fragment of FRAGMENTS) {
    for (const [key, entry] of Object.entries(fragment)) {
      if (out[key]) throw new Error(`Route ${key} declared twice`);
      out[key] = entry;
    }
  }
  return out;
}

/**
 * The branch editing a route's file or the route itself, if any.
 * @param {string} key - "METHOD /path"
 * @param {string} source - registrar file, e.g. "endpoints/api/admin"
 * @returns {string|null}
 */
function pendingOwner(key, source) {
  if (PENDING_ROUTES[key]) return PENDING_ROUTES[key];
  const file = Object.keys(PENDING_FILES).find(
    (f) => source === f || source.startsWith(`${f}/`)
  );
  return file ? PENDING_FILES[file] : null;
}

module.exports = {
  allDeclarations,
  pendingOwner,
  PENDING_FILES,
  PENDING_ROUTES,
};
