import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

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

const Team = {
  // ---- Admin only ----

  /** @returns {Promise<Array<{id: number, name: string, description: string|null, policy_id: number|null, idp_group: string|null, memberCount: number, leadCount: number, workspaceCount: number}>>} */
  getAll: async () => {
    const res = await request("/admin/teams", { fallback: { teams: [] } });
    return res?.teams || [];
  },

  create: async (data) =>
    request("/admin/teams/new", {
      method: "POST",
      body: data,
      fallback: { team: null },
    }),

  update: async (teamId, data) =>
    request(`/admin/teams/${teamId}`, {
      method: "POST",
      body: data,
      fallback: { team: null },
    }),

  delete: async (teamId) =>
    request(`/admin/teams/${teamId}`, {
      method: "DELETE",
      fallback: { success: false },
    }),

  /** Give a workspace to a team, or detach it with teamId null. */
  setWorkspaceTeam: async (slug, teamId = null) =>
    request(`/admin/workspaces/${slug}/team`, {
      method: "POST",
      body: { teamId },
      fallback: { workspace: null },
    }),

  // ---- Any signed-in user ----

  /** @returns {Promise<{team: {id: number, name: string, description: string|null}|null, role: "member"|"lead"|null}>} */
  mine: async () => {
    const res = await request("/team/mine", {
      fallback: { team: null, role: null },
    });
    return { team: res?.team || null, role: res?.role || null };
  },

  // ---- Team lead of the team, or admin ----

  get: async (teamId) =>
    request(`/teams/${teamId}`, {
      fallback: { team: null, policy: null, teamRole: null },
    }),

  members: async (teamId) => {
    const res = await request(`/teams/${teamId}/members`, {
      fallback: { members: [] },
    });
    return res?.members || [];
  },

  candidates: async (teamId) => {
    const res = await request(`/teams/${teamId}/candidates`, {
      fallback: { users: [] },
    });
    return res?.users || [];
  },

  addMember: async (teamId, userId, role = "member") =>
    request(`/teams/${teamId}/members`, {
      method: "POST",
      body: { userId, role },
      fallback: { member: null },
    }),

  removeMember: async (teamId, userId) =>
    request(`/teams/${teamId}/members/${userId}`, {
      method: "DELETE",
      fallback: { success: false },
    }),

  setMemberRole: async (teamId, userId, role) =>
    request(`/teams/${teamId}/members/${userId}/role`, {
      method: "POST",
      body: { role },
      fallback: { success: false },
    }),

  workspaces: async (teamId) => {
    const res = await request(`/teams/${teamId}/workspaces`, {
      fallback: { workspaces: [] },
    });
    return res?.workspaces || [];
  },

  createWorkspace: async (teamId, name) =>
    request(`/teams/${teamId}/workspaces/new`, {
      method: "POST",
      body: { name },
      fallback: { workspace: null },
    }),

  updateWorkspace: async (teamId, slug, data) =>
    request(`/teams/${teamId}/workspaces/${slug}/update`, {
      method: "POST",
      body: data,
      fallback: { workspace: null },
    }),
};

export default Team;
