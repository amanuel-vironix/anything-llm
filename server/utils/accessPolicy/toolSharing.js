/**
 * Sharing an agent tool (skill, flow, imported plugin, MCP server or MCP tool) with
 * teams. Tools stay installed once for the instance; "sharing with a team" edits the
 * team policy's `agent_tools` rule so that team is offered the tool. Leave the tool out
 * of the role default (deny it there) so only the chosen teams get it.
 *
 * A team whose policy has no tool rule starts from the `default` role's rule, so
 * sharing one tool doesn't also hand the team everything the role default withholds.
 * A team with no policy gets one created for it, with no model restriction.
 */
const prisma = require("../prisma");
const {
  parseToolRule,
  isFunctionAllowed,
  isMcpToolAllowed,
  getRoleDefaults,
} = require("./agentTools");

/** Whether `rule` offers `tool`. Accepts `server:tool` for single MCP tools. */
function ruleAllowsTool(rule, tool) {
  if (!rule) return true;
  const mcpTool = /^([^:@#][^:]*):(.+)$/.exec(tool);
  if (mcpTool) return isMcpToolAllowed(rule, mcpTool[1], mcpTool[2]);
  return isFunctionAllowed(rule, tool);
}

const uniq = (list) => [...new Set(list)];

/** A copy of `rule` that offers `tool`. */
function grantTool(rule, tool) {
  const base = rule ?? { allow: null, deny: [] };
  return {
    allow: base.allow === null ? null : uniq([...base.allow, tool]),
    deny: base.deny.filter((entry) => entry !== tool),
  };
}

/** A copy of `rule` that doesn't offer `tool`. */
function revokeTool(rule, tool) {
  const base = rule ?? { allow: null, deny: [] };
  const next = {
    allow:
      base.allow === null ? null : base.allow.filter((entry) => entry !== tool),
    deny: [...base.deny],
  };
  // Still offered through `allow: null` or a wildcard: deny it explicitly.
  if (ruleAllowsTool(next, tool)) next.deny = uniq([...next.deny, tool]);
  return next;
}

const sameRule = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The rule a team's members get from the team: the team policy's rule, or (with no
 * team rule) the `default` role's rule, or null for no restriction.
 */
async function teamEffectiveRule(team, roleDefaults = null) {
  const defaults = roleDefaults ?? (await getRoleDefaults());
  if (team.policy_id) {
    const policy = await prisma.access_policies.findUnique({
      where: { id: team.policy_id },
    });
    if (policy?.agent_tools) return parseToolRule(policy.agent_tools);
  }
  return defaults.default ?? null;
}

/**
 * Which teams are offered `tool`.
 * @param {string} tool
 * @returns {Promise<{teamId: number, name: string, shared: boolean}[]>}
 */
async function toolSharingForTeams(tool) {
  const defaults = await getRoleDefaults();
  const teams = await prisma.teams.findMany({ orderBy: { name: "asc" } });
  const out = [];
  for (const team of teams) {
    const rule = await teamEffectiveRule(team, defaults);
    out.push({
      teamId: team.id,
      name: team.name,
      shared: ruleAllowsTool(rule, tool),
    });
  }
  return out;
}

async function uniquePolicyName(base) {
  let name = base;
  for (
    let i = 2;
    await prisma.access_policies.findUnique({ where: { name } });
    i++
  )
    name = `${base} (${i})`;
  return name;
}

/**
 * Offer `tool` to exactly the teams in `teamIds`, and stop offering it to the others
 * that have their own rule. Returns what changed. A policy also used by other teams or
 * by individual users changes for them too; `sharedPolicies` lists those so the UI can
 * warn.
 * @param {string} tool
 * @param {number[]} teamIds
 * @param {number|null} actorId
 */
async function setToolTeams(tool, teamIds = [], actorId = null) {
  if (typeof tool !== "string" || !tool.trim())
    return { error: "A tool name is required." };
  const wanted = new Set(teamIds.map(Number));
  const defaults = await getRoleDefaults();
  const teams = await prisma.teams.findMany();
  const known = new Set(teams.map((t) => t.id));
  for (const id of wanted)
    if (!known.has(id)) return { error: `Team ${id} does not exist.` };

  const changed = [];
  const sharedPolicies = [];
  for (const team of teams) {
    const share = wanted.has(team.id);
    const policy = team.policy_id
      ? await prisma.access_policies.findUnique({
          where: { id: team.policy_id },
        })
      : null;
    const ownRule = policy?.agent_tools
      ? parseToolRule(policy.agent_tools)
      : null;
    const current = ownRule ?? defaults.default ?? null;
    if (ruleAllowsTool(current, tool) === share) continue;

    const next = share ? grantTool(current, tool) : revokeTool(current, tool);
    if (ownRule && sameRule(ownRule, next)) continue;

    if (policy) {
      const others =
        (await prisma.users.count({ where: { policy_id: policy.id } })) +
        (await prisma.teams.count({
          where: { policy_id: policy.id, id: { not: team.id } },
        }));
      if (others > 0) sharedPolicies.push({ policyId: policy.id, others });
      await prisma.access_policies.update({
        where: { id: policy.id },
        data: { agent_tools: JSON.stringify(next), lastUpdatedAt: new Date() },
      });
    } else {
      const created = await prisma.access_policies.create({
        data: {
          name: await uniquePolicyName(`Team: ${team.name}`),
          description: `Created when sharing agent tools with team ${team.name}.`,
          allowed_models: null,
          agent_tools: JSON.stringify(next),
          created_by: actorId ? Number(actorId) : null,
        },
      });
      await prisma.teams.update({
        where: { id: team.id },
        data: { policy_id: created.id, lastUpdatedAt: new Date() },
      });
    }
    changed.push({ teamId: team.id, shared: share });
  }
  return { changed, sharedPolicies, error: null };
}

module.exports = {
  ruleAllowsTool,
  grantTool,
  revokeTool,
  toolSharingForTeams,
  setToolTeams,
};
