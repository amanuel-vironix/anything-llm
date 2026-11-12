/**
 * Per-account access policies.
 *
 * A policy decides which providers and models an account may use, whether its chats go
 * through a model router, whether it may use agents, and (see ./agentTools.js) which agent
 * tools it is offered. A user gets a policy from their own `users.policy_id` first, then
 * from their team's `teams.policy_id`. No policy means today's behavior.
 *
 * Every lookup reads the database, like role and suspension, so a change takes effect on
 * the account's next request.
 */
const prisma = require("../prisma");

class AccessPolicyError extends Error {
  /**
   * @param {string} message - shown to the user
   * @param {"model_not_allowed"|"agents_disabled"} code
   */
  constructor(message, code = "model_not_allowed") {
    super(message);
    this.name = "AccessPolicyError";
    this.code = code;
  }
}

/**
 * Parse a policy's `allowed_models` JSON into a clean list. Malformed input yields `[]`
 * (allows nothing), so a broken policy fails closed.
 * @param {string|Array|null} value
 * @returns {{provider: string, model: string}[]}
 */
function parseAllowedModels(value) {
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (entry) =>
        entry &&
        typeof entry.provider === "string" &&
        entry.provider.length > 0 &&
        typeof entry.model === "string" &&
        entry.model.length > 0
    )
    .map((entry) => ({ provider: entry.provider, model: entry.model }));
}

/**
 * Whether a provider and model pair is allowed by a policy. A null policy allows
 * everything. `"*"` matches any model of that provider, including an unknown one
 * (`model` null means the provider picks its own default).
 * @param {object|null} policy
 * @param {{provider: string|null, model: string|null}} selection
 * @returns {boolean}
 */
function isModelAllowed(policy, { provider = null, model = null } = {}) {
  if (!policy) return true;
  if (!provider) return false;
  const allowed = parseAllowedModels(policy.allowed_models);
  return allowed.some(
    (entry) =>
      entry.provider === provider &&
      (entry.model === "*" || (model !== null && entry.model === model))
  );
}

/**
 * Turn a requested selection into the one this policy permits.
 * - allowed: returned unchanged;
 * - not allowed, policy has an allowed default: the default is returned (decision 1);
 * - otherwise: `{ error }` with a message the user can read.
 * @param {object|null} policy
 * @param {{provider: string|null, model: string|null}} selection
 * @returns {{provider: string, model: string|null, substituted: boolean} | {error: string}}
 */
function resolveAllowedSelection(
  policy,
  { provider = null, model = null } = {}
) {
  if (!policy || isModelAllowed(policy, { provider, model }))
    return { provider, model, substituted: false };

  const fallback = {
    provider: policy.default_provider || null,
    model: policy.default_model || null,
  };
  if (fallback.provider && isModelAllowed(policy, fallback))
    return { ...fallback, substituted: true };

  return {
    error: `Your account is not allowed to use ${provider || "this provider"}${
      model ? ` / ${model}` : ""
    }, and your access policy has no allowed default model. Ask an administrator to update your access policy.`,
  };
}

/**
 * Same as resolveAllowedSelection, but throws an AccessPolicyError instead of returning
 * `{ error }`.
 */
function enforceAllowedSelection(policy, selection) {
  const result = resolveAllowedSelection(policy, selection);
  if (result.error) throw new AccessPolicyError(result.error);
  return result;
}

/**
 * Throws when the policy turns agents off for this account.
 * @param {object|null} policy
 */
function enforceAgentsAllowed(policy) {
  if (policy && policy.allow_agents === false)
    throw new AccessPolicyError(
      "Agents are disabled for your account. Ask an administrator if you need them.",
      "agents_disabled"
    );
}

/**
 * Everything that decides a user's access: their own policy, their team and its policy,
 * and their role. Read fresh from the database on each call.
 * @param {{id: number}|null} user
 * @returns {Promise<{role: string|null, userPolicy: object|null, teamId: number|null, teamRole: string|null, teamPolicy: object|null}>}
 */
async function resolvePolicyChain(user = null) {
  const none = {
    role: null,
    userPolicy: null,
    teamId: null,
    teamRole: null,
    teamPolicy: null,
  };
  if (!user?.id) return none;
  try {
    const record = await prisma.users.findUnique({
      where: { id: Number(user.id) },
      select: { policy_id: true, role: true },
    });
    if (!record) return none;

    const membership = await prisma.team_members.findUnique({
      where: { user_id: Number(user.id) },
      select: { team_id: true, role: true },
    });
    const teamId = membership?.team_id ?? null;

    const userPolicy = record.policy_id
      ? await prisma.access_policies.findUnique({
          where: { id: record.policy_id },
        })
      : null;

    let teamPolicy = null;
    if (teamId) {
      const team = await prisma.teams.findUnique({
        where: { id: teamId },
        select: { policy_id: true },
      });
      if (team?.policy_id)
        teamPolicy = await prisma.access_policies.findUnique({
          where: { id: team.policy_id },
        });
    }

    return {
      role: record.role ?? null,
      userPolicy: userPolicy ?? null,
      teamId,
      teamRole: membership?.role ?? null,
      teamPolicy: teamPolicy ?? null,
    };
  } catch (error) {
    console.error("[accessPolicy] resolvePolicyChain failed", error.message);
    // Fail closed: a lookup error must not lift a restriction.
    throw new AccessPolicyError(
      "Could not check your access policy. Try again shortly."
    );
  }
}

/**
 * Where a user's policy comes from: their own, then their team's.
 * @param {{id: number}|null} user
 * @returns {Promise<{policy: object|null, source: "user"|"team"|null, teamId: number|null}>}
 */
async function resolvePolicyForUser(user = null) {
  const chain = await resolvePolicyChain(user);
  if (chain.userPolicy)
    return { policy: chain.userPolicy, source: "user", teamId: chain.teamId };
  if (chain.teamPolicy)
    return { policy: chain.teamPolicy, source: "team", teamId: chain.teamId };
  return { policy: null, source: null, teamId: chain.teamId };
}

/**
 * The effective policy for a user, or null.
 * @param {{id: number}|null} user
 * @returns {Promise<object|null>}
 */
async function getPolicyForUser(user = null) {
  return (await resolvePolicyForUser(user)).policy;
}

module.exports = {
  AccessPolicyError,
  parseAllowedModels,
  isModelAllowed,
  resolveAllowedSelection,
  enforceAllowedSelection,
  enforceAgentsAllowed,
  resolvePolicyChain,
  resolvePolicyForUser,
  getPolicyForUser,
};
