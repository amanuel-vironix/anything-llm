const { Prisma } = require("@prisma/client");
const prisma = require("../utils/prisma");
const { parseAllowedModels, isModelAllowed } = require("../utils/accessPolicy");
const { validateToolRule } = require("../utils/accessPolicy/agentTools");

/**
 * Access policies (see server/utils/accessPolicy). Policies are assigned to users
 * (`users.policy_id`) and teams (`teams.policy_id`) by plain integer id.
 */
const AccessPolicy = {
  writable: [
    "name",
    "description",
    "allowed_models",
    "default_provider",
    "default_model",
    "router_id",
    "allow_agents",
    "agent_tools",
  ],

  validations: {
    name: (value) => {
      if (!value || typeof value !== "string") return null;
      const name = String(value).trim().slice(0, 255);
      return name.length ? name : null;
    },
    description: (value) => {
      if (!value || typeof value !== "string") return null;
      return String(value).trim();
    },
    optionalString: (value) => {
      if (!value || typeof value !== "string") return null;
      return String(value).trim() || null;
    },
  },

  /**
   * Validate `allowed_models`. Accepts an array or JSON string of `{provider, model}`.
   * @returns {{value: string} | {error: string}}
   */
  validateAllowedModels(value) {
    let list = value;
    if (typeof value === "string") {
      try {
        list = JSON.parse(value);
      } catch {
        return { error: "Allowed models must be valid JSON." };
      }
    }
    if (list === undefined || list === null) list = [];
    if (!Array.isArray(list))
      return { error: "Allowed models must be a list of {provider, model}." };
    const cleaned = parseAllowedModels(list);
    if (cleaned.length !== list.length)
      return {
        error:
          "Every allowed model needs a provider and a model (use * for any model of a provider).",
      };
    return { value: JSON.stringify(cleaned) };
  },

  /**
   * Validate and normalize a create or update payload.
   * @param {object} data
   * @param {object|null} existing - the current row, for updates
   * @returns {Promise<{data: object} | {error: string}>}
   */
  async sanitize(data = {}, existing = null) {
    const out = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(data, key);

    if (!existing || has("name")) {
      const name = this.validations.name(data.name);
      if (!name) return { error: "Name is required." };
      out.name = name;
    }
    if (has("description"))
      out.description = this.validations.description(data.description);

    if (!existing || has("allowed_models")) {
      const result = this.validateAllowedModels(data.allowed_models);
      if (result.error) return { error: result.error };
      out.allowed_models = result.value;
    }
    if (has("default_provider"))
      out.default_provider = this.validations.optionalString(
        data.default_provider
      );
    if (has("default_model"))
      out.default_model = this.validations.optionalString(data.default_model);

    if (has("router_id")) {
      if (data.router_id === null || data.router_id === "") {
        out.router_id = null;
      } else {
        const routerId = Number(data.router_id);
        if (!Number.isInteger(routerId) || routerId <= 0)
          return { error: "Router id must be a positive integer." };
        const router = await prisma.model_routers.findUnique({
          where: { id: routerId },
          select: { id: true },
        });
        if (!router) return { error: "That model router does not exist." };
        out.router_id = routerId;
      }
    }

    if (has("allow_agents")) out.allow_agents = data.allow_agents !== false;

    if (has("agent_tools")) {
      const { rule, error } = validateToolRule(data.agent_tools);
      if (error) return { error };
      out.agent_tools = rule ? JSON.stringify(rule) : null;
    }

    // The default, when set, must itself be allowed, or substituting it would be refused.
    const merged = { ...(existing || {}), ...out };
    if (merged.default_provider || merged.default_model) {
      if (!merged.default_provider)
        return { error: "A default model needs a default provider." };
      if (
        !isModelAllowed(merged, {
          provider: merged.default_provider,
          model: merged.default_model || null,
        })
      )
        return {
          error: "The default model must be one of the allowed models.",
        };
    }

    return { data: out };
  },

  create: async function (data = {}, creatorId = null) {
    const result = await this.sanitize(data, null);
    if (result.error) return { policy: null, error: result.error };
    try {
      const policy = await prisma.access_policies.create({
        data: {
          ...result.data,
          created_by: creatorId ? Number(creatorId) : null,
        },
      });
      return { policy, error: null };
    } catch (error) {
      return { policy: null, error: this._errorMessage(error) };
    }
  },

  update: async function (id = null, data = {}) {
    if (!id) return { policy: null, error: "No policy id provided." };
    const existing = await this.get({ id: Number(id) });
    if (!existing) return { policy: null, error: "Policy not found." };
    const result = await this.sanitize(data, existing);
    if (result.error) return { policy: null, error: result.error };
    if (Object.keys(result.data).length === 0)
      return { policy: existing, error: null };
    try {
      const policy = await prisma.access_policies.update({
        where: { id: Number(id) },
        data: { ...result.data, lastUpdatedAt: new Date() },
      });
      return { policy, error: null };
    } catch (error) {
      return { policy: null, error: this._errorMessage(error) };
    }
  },

  get: async function (clause = {}) {
    try {
      return await prisma.access_policies.findFirst({ where: clause });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (clause = {}, limit = null) {
    try {
      return await prisma.access_policies.findMany({
        where: clause,
        orderBy: { name: "asc" },
        ...(limit ? { take: limit } : {}),
      });
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  /** Policies with the number of users and teams assigned to each. */
  whereWithCounts: async function (clause = {}) {
    const policies = await this.where(clause);
    if (!policies.length) return [];
    const ids = policies.map((p) => p.id);
    const [users, teams] = await Promise.all([
      prisma.users.groupBy({
        by: ["policy_id"],
        where: { policy_id: { in: ids } },
        _count: { _all: true },
      }),
      prisma.teams.groupBy({
        by: ["policy_id"],
        where: { policy_id: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const count = (rows, id) =>
      rows.find((row) => row.policy_id === id)?._count?._all ?? 0;
    return policies.map((policy) => ({
      ...policy,
      userCount: count(users, policy.id),
      teamCount: count(teams, policy.id),
    }));
  },

  /**
   * Delete a policy and unassign it from users and teams in one transaction, so no
   * account points at a missing policy.
   * @returns {Promise<{success: boolean, unassigned?: {users: number, teams: number}, error?: string}>}
   */
  delete: async function (id = null) {
    if (!id) return { success: false, error: "No policy id provided." };
    try {
      const [users, teams] = await prisma.$transaction([
        prisma.users.updateMany({
          where: { policy_id: Number(id) },
          data: { policy_id: null },
        }),
        prisma.teams.updateMany({
          where: { policy_id: Number(id) },
          data: { policy_id: null },
        }),
        prisma.access_policies.delete({ where: { id: Number(id) } }),
      ]);
      return {
        success: true,
        unassigned: { users: users.count, teams: teams.count },
      };
    } catch (error) {
      return { success: false, error: this._errorMessage(error) };
    }
  },

  /**
   * Unbind a router from every policy that uses it. Used when the router is deleted
   * (decision 21: unbind and fall back).
   * @param {number} routerId
   * @param {object} [tx] - a Prisma transaction client
   */
  unbindRouter: async function (routerId, tx = prisma) {
    return tx.access_policies.updateMany({
      where: { router_id: Number(routerId) },
      data: { router_id: null },
    });
  },

  _errorMessage(error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return "A policy with that name already exists.";
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      return "Policy not found.";
    console.error(error.message);
    return error.message;
  },
};

module.exports = { AccessPolicy };
