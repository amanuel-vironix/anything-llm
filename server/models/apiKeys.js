const prisma = require("../utils/prisma");

const ApiKey = {
  tablename: "api_keys",
  writable: ["name"],

  makeSecret: () => {
    const uuidAPIKey = require("uuid-apikey");
    return uuidAPIKey.create().apiKey;
  },

  /**
   * @param {number|null} createdByUserId
   * @param {string|null} name
   * @param {{userId?: number|null, workspaceIds?: number[]|null, expiresAt?: string|Date|null}} [scope]
   *   userId - the owner the key runs as; workspaceIds - narrow the key to these
   *   workspaces; expiresAt - refuse the key after this time.
   */
  create: async function (createdByUserId = null, name = null, scope = {}) {
    try {
      const normalizedName =
        typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
      const validated = await this.validateScope(scope);
      if (validated.error) return { apiKey: null, error: validated.error };
      const apiKey = await prisma.api_keys.create({
        data: {
          name: normalizedName,
          secret: this.makeSecret(),
          createdBy: createdByUserId,
          ...validated.data,
        },
      });

      return { apiKey, error: null };
    } catch (error) {
      console.error("FAILED TO CREATE API KEY.", error.message);
      return { apiKey: null, error: error.message };
    }
  },

  /**
   * Validate an owner, workspace scope and expiry. Only the keys present in `scope` are
   * returned, so this also serves partial updates.
   * @returns {Promise<{data: object} | {error: string}>}
   */
  validateScope: async function (scope = {}) {
    const data = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(scope, key);

    if (has("userId")) {
      if (scope.userId === null || scope.userId === "") data.user_id = null;
      else {
        const userId = Number(scope.userId);
        const owner = Number.isInteger(userId)
          ? await prisma.users.findUnique({
              where: { id: userId },
              select: { id: true },
            })
          : null;
        if (!owner) return { error: "The key owner does not exist." };
        data.user_id = userId;
      }
    }

    if (has("workspaceIds")) {
      if (scope.workspaceIds === null || scope.workspaceIds === undefined)
        data.workspace_ids = null;
      else if (!Array.isArray(scope.workspaceIds))
        return { error: "workspaceIds must be a list of workspace ids." };
      else {
        const ids = [...new Set(scope.workspaceIds.map(Number))];
        if (ids.some((id) => !Number.isInteger(id) || id <= 0))
          return { error: "workspaceIds must be a list of workspace ids." };
        const found = await prisma.workspaces.count({
          where: { id: { in: ids } },
        });
        if (found !== ids.length)
          return { error: "One or more workspaces do not exist." };
        data.workspace_ids = JSON.stringify(ids);
      }
    }

    if (has("expiresAt")) {
      if (scope.expiresAt === null || scope.expiresAt === "")
        data.expiresAt = null;
      else {
        const expiresAt = new Date(scope.expiresAt);
        if (isNaN(expiresAt.getTime()))
          return { error: "expiresAt must be a date." };
        if (expiresAt.getTime() <= Date.now())
          return { error: "expiresAt must be in the future." };
        data.expiresAt = expiresAt;
      }
    }

    return { data };
  },

  /**
   * Change a key's owner, workspace scope or expiry (admin only). Assigning an owner is
   * how a legacy key keeps working in multi-user mode.
   */
  updateScope: async function (id, scope = {}) {
    try {
      const validated = await this.validateScope(scope);
      if (validated.error) return { apiKey: null, error: validated.error };
      const apiKey = await prisma.api_keys.update({
        where: { id: Number(id) },
        data: { ...validated.data, lastUpdatedAt: new Date() },
      });
      return { apiKey, error: null };
    } catch (error) {
      if (error?.code === "P2025")
        return { apiKey: null, error: "API key not found." };
      console.error("FAILED TO UPDATE API KEY.", error.message);
      return { apiKey: null, error: error.message };
    }
  },

  /** Record that a key was used. */
  touch: async function (id) {
    await prisma.api_keys.update({
      where: { id: Number(id) },
      data: { lastUsedAt: new Date() },
    });
  },

  get: async function (clause = {}) {
    try {
      const apiKey = await prisma.api_keys.findFirst({ where: clause });
      return apiKey;
    } catch (error) {
      console.error("FAILED TO GET API KEY.", error.message);
      return null;
    }
  },

  count: async function (clause = {}) {
    try {
      const count = await prisma.api_keys.count({ where: clause });
      return count;
    } catch (error) {
      console.error("FAILED TO COUNT API KEYS.", error.message);
      return 0;
    }
  },

  delete: async function (clause = {}) {
    try {
      await prisma.api_keys.deleteMany({ where: clause });
      return true;
    } catch (error) {
      console.error("FAILED TO DELETE API KEY.", error.message);
      return false;
    }
  },

  where: async function (clause = {}, limit) {
    try {
      const apiKeys = await prisma.api_keys.findMany({
        where: clause,
        take: limit,
      });
      return apiKeys;
    } catch (error) {
      console.error("FAILED TO GET API KEYS.", error.message);
      return [];
    }
  },

  whereWithUser: async function (clause = {}, limit) {
    try {
      const { User } = require("./user");
      const apiKeys = await this.where(clause, limit);

      for (const apiKey of apiKeys) {
        if (apiKey.user_id) {
          const owner = await User.get({ id: apiKey.user_id });
          apiKey.owner = owner
            ? { id: owner.id, username: owner.username, role: owner.role }
            : null;
        } else apiKey.owner = null;
        apiKey.workspaceIds = apiKey.workspace_ids
          ? JSON.parse(apiKey.workspace_ids)
          : null;

        if (!apiKey.createdBy) continue;
        const user = await User.get({ id: apiKey.createdBy });
        if (!user) continue;

        apiKey.createdBy = {
          id: user.id,
          username: user.username,
          role: user.role,
        };
      }

      return apiKeys;
    } catch (error) {
      console.error("FAILED TO GET API KEYS WITH USER.", error.message);
      return [];
    }
  },
};

module.exports = { ApiKey };
