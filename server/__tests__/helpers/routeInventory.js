/**
 * Lists every HTTP and websocket route the server registers, without booting
 * it: each `xxxEndpoints(app)` registrar from server/index.js is called with a
 * recording `app`. Used by the audit route coverage test.
 */
const fs = require("fs");
const path = require("path");

const SERVER = path.resolve(__dirname, "../..");

// Registrars, as server/index.js mounts them under "/api". Keep in step with
// index.js; the coverage test fails if index.js names one missing here.
const REGISTRARS = [
  ["endpoints/system", "systemEndpoints"],
  ["endpoints/themePalettes", "themePalettesEndpoints"],
  ["endpoints/extensions", "extensionEndpoints"],
  ["endpoints/workspaces", "workspaceEndpoints"],
  ["endpoints/workspaceThreads", "workspaceThreadEndpoints"],
  ["endpoints/chat", "chatEndpoints"],
  ["endpoints/admin", "adminEndpoints"],
  ["endpoints/modelRouter", "modelRouterEndpoints"],
  ["endpoints/invite", "inviteEndpoints"],
  ["endpoints/embedManagement", "embedManagementEndpoints"],
  ["endpoints/utils", "utilEndpoints"],
  ["endpoints/document", "documentEndpoints"],
  ["endpoints/agentWebsocket", "agentWebsocket"],
  ["endpoints/agentSkillWhitelist", "agentSkillWhitelistEndpoints"],
  ["endpoints/agentFileServer", "agentFileServerEndpoints"],
  ["endpoints/experimental", "experimentalEndpoints"],
  ["endpoints/api", "developerEndpoints"],
  ["endpoints/communityHub", "communityHubEndpoints"],
  ["endpoints/agentFlows", "agentFlowEndpoints"],
  ["endpoints/mcpServers", "mcpServersEndpoints"],
  ["endpoints/mobile", "mobileEndpoints"],
  ["endpoints/webPush", "webPushEndpoints"],
  ["endpoints/telegram", "telegramEndpoints"],
  ["endpoints/scheduledJobs", "scheduledJobEndpoints"],
  ["endpoints/utils/outlookAgentUtils", "outlookAgentEndpoints"],
  ["endpoints/utils/googleAgentSkillEndpoints", "googleAgentSkillEndpoints"],
  ["endpoints/memory", "memoryEndpoints"],
  ["endpoints/embed", "embeddedEndpoints"],
  ["endpoints/browserExtension", "browserExtensionEndpoints"],
  ["endpoints/auth/oidc", "oidcEndpoints"],
];

function recorder(routes, source) {
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete", "all"]) {
    app[method] = (routePath, ...handlers) => {
      if (typeof routePath !== "string") return app;
      routes.push({
        method: method.toUpperCase(),
        path: routePath,
        handlers: handlers.flat().filter((h) => typeof h === "function"),
        source,
      });
      return app;
    };
  }
  app.ws = (routePath, ...handlers) => {
    routes.push({
      method: "WS",
      path: routePath,
      handlers: handlers.flat().filter((h) => typeof h === "function"),
      source,
    });
    return app;
  };
  app.use = () => app;
  return app;
}

/**
 * @returns {{method: string, path: string, handlers: Function[], source: string}[]}
 */
function listRoutes() {
  const routes = [];
  for (const [file, name] of REGISTRARS) {
    const mod = require(path.join(SERVER, file));
    const register = mod[name];
    if (typeof register !== "function")
      throw new Error(`${file} does not export ${name}`);
    const app = recorder(routes, file);
    // developerEndpoints(app, apiRouter) registers on the router.
    register(app, app);
  }
  // The developer API's sub-files have different owners; name each route's
  // sub-file ("endpoints/api/admin") as its source.
  const apiDir = path.join(SERVER, "endpoints/api");
  const bySub = new Map();
  for (const sub of fs.readdirSync(apiDir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const mod = require(path.join(apiDir, sub.name));
    for (const register of Object.values(mod)) {
      if (typeof register !== "function") continue;
      const found = [];
      register(recorder(found, ""));
      for (const r of found) bySub.set(`${r.method} ${r.path}`, sub.name);
    }
  }
  for (const r of routes)
    if (r.source === "endpoints/api" && bySub.has(`${r.method} ${r.path}`))
      r.source = `endpoints/api/${bySub.get(`${r.method} ${r.path}`)}`;
  return routes;
}

module.exports = { listRoutes, REGISTRARS };
