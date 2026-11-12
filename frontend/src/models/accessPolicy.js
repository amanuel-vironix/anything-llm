import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

/**
 * @typedef {Object} ToolRule
 * @property {string[]|null} allow - null means every tool not denied.
 * @property {string[]} deny
 */

/**
 * @typedef {Object} AccessPolicy
 * @property {number} id
 * @property {string} name
 * @property {string|null} description
 * @property {{provider: string, model: string}[]|null} allowed_models - null means no restriction.
 * @property {string|null} default_provider
 * @property {string|null} default_model
 * @property {number|null} router_id
 * @property {boolean} allow_agents
 * @property {ToolRule|null} agent_tools
 * @property {number} userCount
 * @property {number} teamCount
 */

async function request(path, { method = "GET", body, fallback = {} } = {}) {
  return await fetch(`${API_BASE}${path}`, {
    method,
    headers: baseHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
    .then(async (res) => {
      const json = await res.json().catch(() => null);
      if (json) return json;
      throw new Error(res.statusText || `Request failed (${res.status}).`);
    })
    .catch((e) => {
      console.error(e);
      return { ...fallback, error: e.message };
    });
}

const AccessPolicy = {
  /** @returns {Promise<AccessPolicy[]>} */
  getAll: async () => {
    const res = await request("/admin/access-policies", {
      fallback: { policies: [] },
    });
    return res?.policies || [];
  },

  /** @returns {Promise<{policy: AccessPolicy|null, error: string|null}>} */
  create: async (data) =>
    request("/admin/access-policies/new", {
      method: "POST",
      body: data,
      fallback: { policy: null },
    }),

  /** @returns {Promise<{policy: AccessPolicy|null, error: string|null}>} */
  update: async (id, data) =>
    request(`/admin/access-policies/${id}`, {
      method: "POST",
      body: data,
      fallback: { policy: null },
    }),

  /** @returns {Promise<{success: boolean, unassigned?: {users: number, teams: number}, error: string|null}>} */
  delete: async (id) =>
    request(`/admin/access-policies/${id}`, {
      method: "DELETE",
      fallback: { success: false },
    }),

  /** Assign a policy to a user, or clear it with null. */
  assignToUser: async (userId, policyId = null) =>
    request(`/admin/users/${userId}/policy`, {
      method: "POST",
      body: { policyId },
      fallback: { success: false },
    }),

  /** @returns {Promise<{manager?: ToolRule, default?: ToolRule}>} */
  getRoleDefaults: async () => {
    const res = await request("/admin/agent-tool-role-policy", {
      fallback: { roleDefaults: {} },
    });
    return res?.roleDefaults || {};
  },

  /** @param {{manager: ToolRule|null, default: ToolRule|null}} rules */
  updateRoleDefaults: async (rules) =>
    request("/admin/agent-tool-role-policy", {
      method: "POST",
      body: rules,
      fallback: { success: false },
    }),

  /** @returns {Promise<{teams: {teamId: number, name: string, shared: boolean}[], error?: string}>} */
  toolSharing: async (tool) =>
    request(`/admin/agent-tool-sharing?tool=${encodeURIComponent(tool)}`, {
      fallback: { teams: [] },
    }),

  /** Offer a tool to exactly these teams. */
  setToolSharing: async (tool, teamIds = []) =>
    request("/admin/agent-tool-sharing", {
      method: "POST",
      body: { tool, teamIds },
      fallback: { success: false, sharedPolicies: [] },
    }),
};

export default AccessPolicy;
