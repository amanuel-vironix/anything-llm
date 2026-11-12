/**
 * Agent skill and MCP restrictions.
 *
 * A tool rule is `{ allow: string[] | null, deny: string[] }`. A tool is available only if
 * it matches `allow` (when `allow` isn't null) and doesn't match `deny`. Entries use the
 * names the agent code already uses:
 * - built-in skills: `web-browsing`; `parent` covers every `parent#child`, `parent#child`
 *   covers one sub-skill;
 * - agent flows: `@@flow_<uuid>`;
 * - imported plugins: `@@<hubId>`;
 * - a whole MCP server: `@@mcp_<server>`;
 * - a single MCP tool: `<server>:<tool>`;
 * - `*` matches everything.
 *
 * Rule order, first match wins: the user's own policy (`agent_tools` not null), their
 * team's policy, the role default in system setting `agent_tool_role_policy`, then no
 * restriction (today's behavior). Requests with no user get every tool.
 */
const { resolvePolicyChain } = require("./index");

const ROLE_POLICY_SETTING = "agent_tool_role_policy";

/**
 * Normalize a rule from JSON or an object. Returns null for "no rule". Malformed JSON
 * becomes a deny-everything rule so a broken rule fails closed.
 * @param {string|object|null} value
 * @returns {{allow: string[]|null, deny: string[]}|null}
 */
function parseToolRule(value) {
  if (value === null || value === undefined || value === "") return null;
  let rule = value;
  if (typeof value === "string") {
    try {
      rule = JSON.parse(value);
    } catch {
      return { allow: [], deny: [] };
    }
  }
  if (!rule || typeof rule !== "object" || Array.isArray(rule))
    return { allow: [], deny: [] };
  const clean = (list) =>
    Array.isArray(list)
      ? list.filter((entry) => typeof entry === "string" && entry.length > 0)
      : [];
  return {
    allow:
      rule.allow === null || rule.allow === undefined
        ? null
        : clean(rule.allow),
    deny: clean(rule.deny),
  };
}

/**
 * Validate a rule submitted by an admin. Returns `{ rule }` or `{ error }`.
 * @param {any} value
 */
function validateToolRule(value) {
  if (value === null || value === undefined || value === "")
    return { rule: null };
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return { error: "Agent tool rule must be valid JSON." };
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: "Agent tool rule must be an object with allow and deny." };
  if (
    raw.allow !== null &&
    raw.allow !== undefined &&
    !Array.isArray(raw.allow)
  )
    return { error: "allow must be a list of tool names or null." };
  if (raw.deny !== undefined && !Array.isArray(raw.deny))
    return { error: "deny must be a list of tool names." };
  return { rule: parseToolRule(raw) };
}

/** @param {string} name e.g. `sql-agent#sql-list-databases` */
function nameVariants(name) {
  if (name.includes("#")) return [name, name.split("#")[0]];
  return [name];
}

function listMatchesFunction(list, name) {
  if (list.includes("*")) return true;
  return nameVariants(name).some((variant) => list.includes(variant));
}

/** Does an allow list name the MCP server, or any one of its tools? */
function listMentionsServer(list, server) {
  if (list.includes("*") || list.includes(`@@mcp_${server}`)) return true;
  return list.some((entry) => entry.startsWith(`${server}:`));
}

/**
 * Whether one function-list entry (as built by the agent code) is allowed by a rule.
 * An MCP server is kept when the allow list names it or any of its tools; per-tool
 * filtering happens later in `isMcpToolAllowed`.
 * @param {{allow: string[]|null, deny: string[]}|null} rule
 * @param {string} name
 */
function isFunctionAllowed(rule, name) {
  if (!rule || typeof name !== "string") return true;
  if (name.startsWith("@@mcp_")) {
    const server = name.slice("@@mcp_".length);
    if (rule.deny.includes("*") || rule.deny.includes(name)) return false;
    if (rule.allow === null) return true;
    return listMentionsServer(rule.allow, server);
  }
  if (listMatchesFunction(rule.deny, name)) return false;
  if (rule.allow === null) return true;
  return listMatchesFunction(rule.allow, name);
}

/**
 * Filter an agent function list by a rule.
 * @param {string[]} functions
 * @param {{allow: string[]|null, deny: string[]}|null} rule
 * @returns {string[]}
 */
function filterAgentFunctions(functions = [], rule = null) {
  if (!rule) return [...functions];
  return functions.filter((name) => isFunctionAllowed(rule, name));
}

/**
 * Whether a single MCP tool may be used. Also checks `anythingllm.allowedRoles` from the
 * server's config when a user is present.
 * @param {{allow: string[]|null, deny: string[]}|null} rule
 * @param {string} server
 * @param {string} tool
 * @param {{role?: string}|null} user
 * @param {string[]|null} allowedRoles - the server's `anythingllm.allowedRoles`
 */
function isMcpToolAllowed(
  rule,
  server,
  tool,
  user = null,
  allowedRoles = null
) {
  if (user && Array.isArray(allowedRoles) && !allowedRoles.includes(user.role))
    return false;
  if (!rule) return true;
  const serverEntry = `@@mcp_${server}`;
  const toolEntry = `${server}:${tool}`;
  if (
    rule.deny.includes("*") ||
    rule.deny.includes(serverEntry) ||
    rule.deny.includes(toolEntry)
  )
    return false;
  if (rule.allow === null) return true;
  return (
    rule.allow.includes("*") ||
    rule.allow.includes(serverEntry) ||
    rule.allow.includes(toolEntry)
  );
}

/**
 * Read the role defaults setting.
 * @returns {Promise<Record<string, {allow: string[]|null, deny: string[]}>>}
 */
async function getRoleDefaults() {
  const { SystemSettings } = require("../../models/systemSettings");
  const raw = await SystemSettings.getValueOrFallback(
    { label: ROLE_POLICY_SETTING },
    null
  );
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const out = {};
  for (const role of ["manager", "default"]) {
    if (parsed[role] !== undefined && parsed[role] !== null)
      out[role] = parseToolRule(parsed[role]);
  }
  return out;
}

/**
 * Resolve the tool rule for a user, and where it came from.
 * @param {{id: number}|null} user
 * @returns {Promise<{rule: object|null, source: "user"|"team"|"role"|null, role: string|null}>}
 */
async function resolveToolRuleForUser(user = null) {
  if (!user?.id) return { rule: null, source: null, role: null };
  const chain = await resolvePolicyChain(user);
  if (chain.userPolicy && chain.userPolicy.agent_tools !== null)
    return {
      rule: parseToolRule(chain.userPolicy.agent_tools),
      source: "user",
      role: chain.role,
    };
  if (chain.teamPolicy && chain.teamPolicy.agent_tools !== null)
    return {
      rule: parseToolRule(chain.teamPolicy.agent_tools),
      source: "team",
      role: chain.role,
    };
  const defaults = await getRoleDefaults();
  if (chain.role && defaults[chain.role])
    return { rule: defaults[chain.role], source: "role", role: chain.role };
  return { rule: null, source: null, role: chain.role };
}

/**
 * The tool rule for a user, or null for no restriction.
 * @param {{id: number}|null} user
 */
async function getToolRuleForUser(user = null) {
  return (await resolveToolRuleForUser(user)).rule;
}

/**
 * Build a per-tool filter for MCP servers, bound to a user. Returns null when nothing
 * would be filtered, so callers can skip the work.
 * @param {{id: number}|null} user
 * @returns {Promise<null | ((server: string, tool: string, allowedRoles: string[]|null) => boolean)>}
 */
async function mcpToolFilterForUser(user = null) {
  if (!user?.id) return null;
  const { rule, role } = await resolveToolRuleForUser(user);
  return (server, tool, allowedRoles = null) =>
    isMcpToolAllowed(rule, server, tool, { role }, allowedRoles);
}

/**
 * Everything an agent handler needs to restrict tools for one user, resolved once:
 * - `isAllowed(name)`: a function-list entry (`web-browsing`, `@@flow_x`, `@@mcp_x`…) is
 *   allowed by the rule, and for an MCP server the user's role is in its
 *   `anythingllm.allowedRoles`;
 * - `filterFunctions(list)`;
 * - `mcpToolFilter`: per-tool filter for `convertServerToolsToPlugins`, or null.
 * With no user (single-user mode, legacy keys), nothing is restricted.
 * @param {{id: number}|null} user
 */
async function agentToolAccessForUser(user = null) {
  if (!user?.id)
    return {
      rule: null,
      role: null,
      isAllowed: () => true,
      filterFunctions: (functions = []) => [...functions],
      mcpToolFilter: null,
    };
  const { rule, role } = await resolveToolRuleForUser(user);
  const MCPCompatibilityLayer = require("../MCP");
  const serverRoleAllowed = (server) => {
    const roles = new MCPCompatibilityLayer().getAllowedRoles(server);
    return !roles || roles.includes(role);
  };
  const isAllowed = (name) => {
    if (typeof name !== "string") return false;
    if (name.startsWith("@@mcp_") && !serverRoleAllowed(name.slice(6)))
      return false;
    return isFunctionAllowed(rule, name);
  };
  return {
    rule,
    role,
    isAllowed,
    filterFunctions: (functions = []) => functions.filter(isAllowed),
    mcpToolFilter: (server, tool, allowedRoles = null) =>
      isMcpToolAllowed(rule, server, tool, { role }, allowedRoles),
  };
}

module.exports = {
  ROLE_POLICY_SETTING,
  agentToolAccessForUser,
  parseToolRule,
  validateToolRule,
  isFunctionAllowed,
  filterAgentFunctions,
  isMcpToolAllowed,
  getRoleDefaults,
  resolveToolRuleForUser,
  getToolRuleForUser,
  mcpToolFilterForUser,
};
