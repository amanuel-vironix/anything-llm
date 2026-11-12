const { Prisma } = require("@prisma/client");
const prisma = require("../utils/prisma");
const { ModelRouterRule } = require("./modelRouterRule");

const ModelRouter = {
  validations: {
    name: (value) => {
      if (!value || typeof value !== "string") return null;
      return String(value).trim().slice(0, 255);
    },
    description: (value) => {
      if (!value || typeof value !== "string") return null;
      return String(value).trim();
    },
    fallback_provider: (value) => {
      if (!value || typeof value !== "string") return null;
      return String(value);
    },
    fallback_model: (value) => {
      if (!value || typeof value !== "string") return null;
      return String(value);
    },
    cooldown_seconds: (value) => {
      const num = Number(value);
      if (isNaN(num) || num < 0 || num > 3600) return null;
      return Math.round(num);
    },
  },

  create: async function (data = {}, creatorId = null) {
    const name = this.validations.name(data.name);
    if (!name) return { router: null, error: "Name is required." };

    const fallback_provider = this.validations.fallback_provider(
      data.fallback_provider
    );
    const fallback_model = this.validations.fallback_model(data.fallback_model);
    if (!fallback_provider || !fallback_model)
      return {
        router: null,
        error: "Fallback provider and model are required.",
      };

    const { ModelRouterService } = require("../utils/router");
    const cooldown_seconds =
      data.cooldown_seconds != null
        ? this.validations.cooldown_seconds(data.cooldown_seconds)
        : ModelRouterService.DEFAULT_STICKY_MS / 1000;

    try {
      const router = await prisma.model_routers.create({
        data: {
          name,
          description: this.validations.description(data.description),
          fallback_provider,
          fallback_model,
          cooldown_seconds: cooldown_seconds ?? 30,
          created_by: creatorId ? Number(creatorId) : null,
        },
      });
      return { router, error: null };
    } catch (error) {
      console.error(error.message);
      // P2002 is the unique constraint violation error code
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return {
          router: null,
          error: "A router with that name already exists.",
        };
      return { router: null, error: error.message };
    }
  },

  get: async function (clause = {}) {
    try {
      const router = await prisma.model_routers.findFirst({
        where: clause,
      });
      return router || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  getWithRules: async function (clause = {}) {
    try {
      const router = await prisma.model_routers.findFirst({
        where: clause,
        include: {
          rules: {
            orderBy: { priority: "asc" },
          },
        },
      });
      if (!router) return null;
      return { ...router, rules: router.rules.map(ModelRouterRule._hydrate) };
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  getWithRulesAndCount: async function (clause = {}) {
    try {
      const router = await prisma.model_routers.findFirst({
        where: clause,
        include: {
          rules: {
            orderBy: { priority: "asc" },
          },
        },
      });
      if (!router) return null;
      const workspaceCount = await this.workspaceCount(router.id);
      return {
        ...router,
        rules: router.rules.map(ModelRouterRule._hydrate),
        workspaceCount,
      };
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (clause = {}, limit = null, orderBy = null) {
    try {
      const results = await prisma.model_routers.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : { orderBy: { createdAt: "asc" } }),
      });
      return results;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  /**
   * Get all model routers with their rule and workspace counts.
   * @returns {Promise<Array<{id: number, name: string, description: string, fallback_provider: string, fallback_model: string, cooldown_seconds: number, createdAt: Date, ruleCount: number, workspaceCount: number}>>}
   */
  getAllWithCounts: async function () {
    try {
      const routers = await prisma.model_routers.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          _count: {
            select: {
              rules: true,
            },
          },
        },
      });
      const results = await Promise.all(
        routers.map(async ({ _count, ...router }) => ({
          ...router,
          ruleCount: _count.rules,
          workspaceCount: await this.workspaceCount(router.id),
        }))
      );
      return results;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  update: async function (id = null, data = {}) {
    if (!id) throw new Error("No router id provided for update");

    const updates = {};
    if (data.name !== undefined) {
      const name = this.validations.name(data.name);
      if (!name) return { router: null, error: "Name cannot be empty." };
      updates.name = name;
    }
    if (data.description !== undefined)
      updates.description = this.validations.description(data.description);
    if (data.fallback_provider !== undefined) {
      const provider = this.validations.fallback_provider(
        data.fallback_provider
      );
      if (!provider)
        return { router: null, error: "Fallback provider is required." };
      updates.fallback_provider = provider;
    }
    if (data.fallback_model !== undefined) {
      const model = this.validations.fallback_model(data.fallback_model);
      if (!model) return { router: null, error: "Fallback model is required." };
      updates.fallback_model = model;
    }
    if (data.cooldown_seconds !== undefined) {
      const cooldown = this.validations.cooldown_seconds(data.cooldown_seconds);
      if (cooldown === null)
        return {
          router: null,
          error: "Cooldown must be a number between 0 and 3600.",
        };
      updates.cooldown_seconds = cooldown;
    }

    if (Object.keys(updates).length === 0)
      return { router: { id }, error: "No valid fields to update." };

    try {
      const router = await prisma.model_routers.update({
        where: { id: Number(id) },
        data: updates,
      });
      return { router, error: null };
    } catch (error) {
      console.error(error.message);
      // P2002 is the unique constraint violation error code
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return {
          router: null,
          error: "A router with that name already exists.",
        };
      return { router: null, error: error.message };
    }
  },

  /**
   * Delete a router and unbind everything that uses it, in one transaction (decision 21:
   * unbind and fall back, SMF-12):
   * - workspaces bound to it (`router_id`) lose the binding; a chat or agent provider of
   *   `anythingllm-router` is cleared so they use the system provider;
   * - when it is `MODEL_ROUTER_ID`, workspaces that rely on that setting fall back the
   *   same way, and the setting is cleared by the caller (see `unsetSystemRouter`);
   * - access policies that name it lose their `router_id`.
   * Refused when the system provider itself is this router, since there is nothing to
   * fall back to.
   * @param {number} id
   * @returns {Promise<{success: boolean, error?: string, unbound?: {workspaces: number, policies: number, systemRouter: boolean}}>}
   */
  delete: async function (id = null) {
    if (!id) return { success: false, error: "No router id provided." };
    const routerId = Number(id);
    const isSystemRouter =
      !!process.env.MODEL_ROUTER_ID &&
      Number(process.env.MODEL_ROUTER_ID) === routerId;
    if (isSystemRouter && process.env.LLM_PROVIDER === "anythingllm-router")
      return {
        success: false,
        error:
          "This router is the system LLM provider. Choose another system LLM provider before deleting it.",
      };

    const ROUTER = "anythingllm-router";
    // Which workspaces use this router: their own binding, or (for the system router)
    // a router provider with no binding of their own.
    const bound = isSystemRouter
      ? { OR: [{ router_id: routerId }, { router_id: null }] }
      : { router_id: routerId };

    try {
      const [agentReset, chatReset, unbound, policies] =
        await prisma.$transaction([
          prisma.workspaces.updateMany({
            where: { ...bound, agentProvider: ROUTER },
            data: { agentProvider: null, agentModel: null },
          }),
          prisma.workspaces.updateMany({
            where: { ...bound, chatProvider: ROUTER },
            data: { chatProvider: null, chatModel: null },
          }),
          prisma.workspaces.updateMany({
            where: { router_id: routerId },
            data: { router_id: null },
          }),
          prisma.access_policies.updateMany({
            where: { router_id: routerId },
            data: { router_id: null },
          }),
          prisma.model_routers.delete({ where: { id: routerId } }),
        ]);
      return {
        success: true,
        unbound: {
          workspaces: Math.max(
            agentReset.count,
            chatReset.count,
            unbound.count
          ),
          policies: policies.count,
          systemRouter: isSystemRouter,
        },
      };
    } catch (error) {
      console.error(error.message);
      if (error?.code === "P2025")
        return { success: false, error: "Router not found." };
      return { success: false, error: error.message };
    }
  },

  workspaceCount: async function (routerId) {
    try {
      const count = await prisma.workspaces.count({
        where: { router_id: Number(routerId) },
      });
      return count;
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },
};

module.exports = { ModelRouter };
