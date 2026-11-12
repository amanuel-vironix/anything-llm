const { Prisma } = require("@prisma/client");
const prisma = require("../utils/prisma");

const TEAM_ROLES = { member: "member", lead: "lead" };

/**
 * Teams: a named set of users with a shared access policy, team-owned workspaces,
 * shared presets and prompt variables, and leads who manage the team.
 * v1 allows one team per user (`team_members.user_id` is unique).
 */
const Team = {
  roles: TEAM_ROLES,

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
    idp_group: (value) => {
      if (!value || typeof value !== "string") return null;
      const group = String(value).trim().toLowerCase();
      return group.length ? group : null;
    },
  },

  async _validPolicyId(value) {
    if (value === null || value === undefined || value === "")
      return { value: null };
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0)
      return { error: "Policy id must be a positive integer." };
    const policy = await prisma.access_policies.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!policy) return { error: "That access policy does not exist." };
    return { value: id };
  },

  async _sanitize(data = {}, isCreate = false) {
    const out = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(data, key);
    if (isCreate || has("name")) {
      const name = this.validations.name(data.name);
      if (!name) return { error: "Team name is required." };
      out.name = name;
    }
    if (has("description"))
      out.description = this.validations.description(data.description);
    if (has("idp_group"))
      out.idp_group = this.validations.idp_group(data.idp_group);
    if (has("policy_id")) {
      const { value, error } = await this._validPolicyId(data.policy_id);
      if (error) return { error };
      out.policy_id = value;
    }
    return { data: out };
  },

  create: async function (data = {}, creatorId = null) {
    const result = await this._sanitize(data, true);
    if (result.error) return { team: null, error: result.error };
    try {
      const team = await prisma.teams.create({
        data: {
          ...result.data,
          created_by: creatorId ? Number(creatorId) : null,
        },
      });
      return { team, error: null };
    } catch (error) {
      return { team: null, error: this._errorMessage(error) };
    }
  },

  update: async function (id = null, data = {}) {
    if (!id) return { team: null, error: "No team id provided." };
    const result = await this._sanitize(data, false);
    if (result.error) return { team: null, error: result.error };
    try {
      const team = await prisma.teams.update({
        where: { id: Number(id) },
        data: { ...result.data, lastUpdatedAt: new Date() },
      });
      return { team, error: null };
    } catch (error) {
      return { team: null, error: this._errorMessage(error) };
    }
  },

  get: async function (clause = {}) {
    try {
      return await prisma.teams.findFirst({ where: clause });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  /** Teams with member, lead and workspace counts. */
  whereWithCounts: async function (clause = {}) {
    try {
      const teams = await prisma.teams.findMany({
        where: clause,
        orderBy: { name: "asc" },
        include: { members: { select: { role: true } } },
      });
      const ids = teams.map((t) => t.id);
      const workspaceCounts = ids.length
        ? await prisma.workspaces.groupBy({
            by: ["team_id"],
            where: { team_id: { in: ids } },
            _count: { _all: true },
          })
        : [];
      return teams.map(({ members, ...team }) => ({
        ...team,
        memberCount: members.length,
        leadCount: members.filter((m) => m.role === TEAM_ROLES.lead).length,
        workspaceCount:
          workspaceCounts.find((row) => row.team_id === team.id)?._count
            ?._all ?? 0,
      }));
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  /** Members of a team with safe user fields. */
  members: async function (teamId) {
    try {
      const rows = await prisma.team_members.findMany({
        where: { team_id: Number(teamId) },
        orderBy: { createdAt: "asc" },
        include: {
          user: {
            select: { id: true, username: true, role: true, suspended: true },
          },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        teamId: row.team_id,
        userId: row.user_id,
        role: row.role,
        addedBy: row.added_by,
        createdAt: row.createdAt,
        user: row.user,
      }));
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  /**
   * The team membership of a user, or null.
   * @param {number} userId
   * @returns {Promise<{team_id: number, user_id: number, role: string}|null>}
   */
  membershipFor: async function (userId) {
    if (!userId) return null;
    try {
      return await prisma.team_members.findUnique({
        where: { user_id: Number(userId) },
      });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  /**
   * Add a user to a team. A user already on a team (any team) is refused; the unique
   * index on `user_id` makes this safe under concurrent adds.
   * @returns {Promise<{member: object|null, error: string|null}>}
   */
  addMember: async function (
    teamId,
    userId,
    { role = TEAM_ROLES.member, addedBy = null } = {}
  ) {
    if (!Object.values(TEAM_ROLES).includes(role))
      return { member: null, error: "Team role must be member or lead." };
    try {
      const member = await prisma.team_members.create({
        data: {
          team_id: Number(teamId),
          user_id: Number(userId),
          role,
          added_by: addedBy ? Number(addedBy) : null,
        },
      });
      return { member, error: null };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return { member: null, error: "That user already belongs to a team." };
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      )
        return { member: null, error: "Team or user not found." };
      console.error(error.message);
      return { member: null, error: error.message };
    }
  },

  /**
   * Remove a member. Unless `force` (an admin acting), the last lead of a team that
   * still has other members can't be removed. The check and the delete are one
   * conditional DELETE, so two concurrent removals can't both pass it.
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  removeMember: async function (teamId, userId, { force = false } = {}) {
    const team_id = Number(teamId);
    const user_id = Number(userId);
    const where = { team_id, user_id };
    if (!force)
      where.OR = [
        { role: TEAM_ROLES.member },
        {
          team: {
            members: {
              some: { role: TEAM_ROLES.lead, user_id: { not: user_id } },
            },
          },
        },
        { team: { members: { none: { user_id: { not: user_id } } } } },
      ];
    try {
      const { count } = await prisma.team_members.deleteMany({ where });
      if (count === 1) return { success: true, error: null };
      const exists = await prisma.team_members.findFirst({
        where: { team_id, user_id },
      });
      if (!exists)
        return { success: false, error: "That user is not on this team." };
      return {
        success: false,
        error:
          "A team with members needs at least one lead. Make another member a lead first.",
      };
    } catch (error) {
      console.error(error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Change a member's team role. Demoting the last lead is refused unless `force`.
   * One conditional UPDATE, like removeMember.
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  setMemberRole: async function (teamId, userId, role, { force = false } = {}) {
    if (!Object.values(TEAM_ROLES).includes(role))
      return { success: false, error: "Team role must be member or lead." };
    const team_id = Number(teamId);
    const user_id = Number(userId);
    const where = { team_id, user_id };
    if (role === TEAM_ROLES.member && !force)
      where.OR = [
        { role: TEAM_ROLES.member },
        {
          team: {
            members: {
              some: { role: TEAM_ROLES.lead, user_id: { not: user_id } },
            },
          },
        },
      ];
    try {
      const { count } = await prisma.team_members.updateMany({
        where,
        data: { role },
      });
      if (count === 1) return { success: true, error: null };
      const exists = await prisma.team_members.findFirst({
        where: { team_id, user_id },
      });
      if (!exists)
        return { success: false, error: "That user is not on this team." };
      return {
        success: false,
        error:
          "A team with members needs at least one lead. Make another member a lead first.",
      };
    } catch (error) {
      console.error(error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Delete a team in one transaction:
   * - members fall back to their own policy or role default (membership rows go);
   * - team workspaces become admin-only (`team_id` null, decision 30);
   * - shared presets and variables go back to their owners.
   * @returns {Promise<{success: boolean, counts?: object, error?: string}>}
   */
  delete: async function (id = null) {
    if (!id) return { success: false, error: "No team id provided." };
    const team_id = Number(id);
    try {
      const [, members, workspaces, presets, variables] =
        await prisma.$transaction([
          // A shared preset whose owner also has a personal one with the same command
          // would collide on (uid, team_id, command); personal wins, so drop the copy.
          prisma.$executeRaw`DELETE FROM slash_command_presets
            WHERE team_id = ${team_id}
            AND EXISTS (
              SELECT 1 FROM slash_command_presets AS personal
              WHERE personal.uid = slash_command_presets.uid
              AND personal.team_id = 0
              AND personal.command = slash_command_presets.command
            )`,
          prisma.team_members.deleteMany({ where: { team_id } }),
          prisma.workspaces.updateMany({
            where: { team_id },
            data: { team_id: null },
          }),
          prisma.slash_command_presets.updateMany({
            where: { team_id },
            data: { team_id: 0 },
          }),
          prisma.system_prompt_variables.updateMany({
            where: { team_id },
            data: { team_id: null },
          }),
          prisma.teams.delete({ where: { id: team_id } }),
        ]);
      return {
        success: true,
        counts: {
          members: members.count,
          workspaces: workspaces.count,
          presets: presets.count,
          variables: variables.count,
        },
      };
    } catch (error) {
      return { success: false, error: this._errorMessage(error) };
    }
  },

  _errorMessage(error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target = String(error.meta?.target || "");
      if (target.includes("idp_group"))
        return "Another team already uses that group.";
      if (target.includes("command"))
        return "A shared preset with that command already exists.";
      return "A team with that name already exists.";
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      return "Team not found.";
    console.error(error.message);
    return error.message;
  },
};

module.exports = { Team, TEAM_ROLES };
