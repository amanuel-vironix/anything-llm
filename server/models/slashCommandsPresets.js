const { v4 } = require("uuid");
const prisma = require("../utils/prisma");
const CMD_REGEX = new RegExp(/[^a-zA-Z0-9_-]/g);

const SlashCommandPresets = {
  formatCommand: function (command = "") {
    if (!command || command.length < 2) return `/${v4().split("-")[0]}`;

    let adjustedCmd = command.toLowerCase(); // force lowercase
    if (!adjustedCmd.startsWith("/")) adjustedCmd = `/${adjustedCmd}`; // Fix if no preceding / is found.
    return `/${adjustedCmd.slice(1).toLowerCase().replace(CMD_REGEX, "-")}`; // replace any invalid chars with '-'
  },

  get: async function (clause = {}) {
    try {
      const preset = await prisma.slash_command_presets.findFirst({
        where: clause,
      });
      return preset || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (clause = {}, limit) {
    try {
      const presets = await prisma.slash_command_presets.findMany({
        where: clause,
        take: limit || undefined,
      });
      return presets;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  // Command + userId + team must be unique combination. `teamId` shares the preset with
  // that team (0 = personal).
  create: async function (userId = null, presetData = {}, { teamId = 0 } = {}) {
    try {
      const existingPreset = await this.get({
        userId: userId ? Number(userId) : null,
        command: String(presetData.command),
        team_id: Number(teamId) || 0,
      });

      if (existingPreset) {
        console.log(
          "SlashCommandPresets.create - preset already exists - will not create"
        );
        return existingPreset;
      }

      const preset = await prisma.slash_command_presets.create({
        data: {
          ...presetData,
          // This field (uid) is either the user_id or 0 (for non-multi-user mode).
          // the UID field enforces the @@unique(userId, command) constraint since
          // the real relational field (userId) cannot be non-null so this 'dummy' field gives us something
          // to constrain against within the context of prisma and sqlite that works.
          uid: userId ? Number(userId) : 0,
          userId: userId ? Number(userId) : null,
          team_id: Number(teamId) || 0,
        },
      });
      return preset;
    } catch (error) {
      console.error("Failed to create preset", error.message);
      return null;
    }
  },

  /**
   * The presets a user can use: their own, plus those shared with their team. When two
   * share a command, the user's personal one wins, then their own shared one.
   * @param {number|null} userId
   */
  getUserPresets: async function (userId = null) {
    try {
      const uid = userId ? Number(userId) : null;
      const membership = uid
        ? await prisma.team_members.findUnique({
            where: { user_id: uid },
            select: { team_id: true },
          })
        : null;
      const rows = await prisma.slash_command_presets.findMany({
        where: membership
          ? { OR: [{ userId: uid }, { team_id: membership.team_id }] }
          : { userId: uid },
        orderBy: { createdAt: "asc" },
      });
      // Own rows count only when personal or shared with the current team.
      const visible = rows.filter(
        (p) =>
          p.userId !== uid || !p.team_id || p.team_id === membership?.team_id
      );
      const rank = (p) => (p.userId === uid ? (p.team_id ? 1 : 0) : 2);
      const byCommand = new Map();
      for (const preset of visible) {
        const current = byCommand.get(preset.command);
        if (!current || rank(preset) < rank(current))
          byCommand.set(preset.command, preset);
      }
      return visible
        .filter((preset) => byCommand.get(preset.command) === preset)
        .map((preset) => ({
          id: preset.id,
          command: preset.command,
          prompt: preset.prompt,
          description: preset.description,
          teamId: preset.team_id || null,
          shared: !!preset.team_id,
          isOwner: preset.userId === uid,
        }));
    } catch (error) {
      console.error("Failed to get user presets", error.message);
      return [];
    }
  },

  /**
   * The preset if `user` may edit or delete it: its owner, an admin, or a lead of the
   * team it is shared with. In single-user mode (no user) only unowned presets match.
   * @returns {Promise<object|null>}
   */
  editableBy: async function (presetId, user = null) {
    const preset = await this.get({ id: Number(presetId) });
    if (!preset) return null;
    if (!user) return preset.userId === null ? preset : null;
    if (preset.userId === Number(user.id)) return preset;
    if (user.role === "admin") return preset;
    if (preset.team_id) {
      const lead = await prisma.team_members.findFirst({
        where: {
          user_id: Number(user.id),
          team_id: preset.team_id,
          role: "lead",
        },
      });
      if (lead) return preset;
    }
    return null;
  },

  update: async function (presetId = null, presetData = {}) {
    try {
      const preset = await prisma.slash_command_presets.update({
        where: { id: Number(presetId) },
        data: presetData,
      });
      return preset;
    } catch (error) {
      console.error("Failed to update preset", error.message);
      return null;
    }
  },

  delete: async function (presetId = null) {
    try {
      await prisma.slash_command_presets.delete({
        where: { id: Number(presetId) },
      });
      return true;
    } catch (error) {
      console.error("Failed to delete preset", error.message);
      return false;
    }
  },

  /**
   * Migrates all slash command presets with null userId to the specified admin user.
   * Called during multi-user mode enablement to assign orphaned presets to the new admin.
   * @param {number} adminUserId - The admin user ID to assign presets to
   * @returns {Promise<void>}
   */
  migrateToMultiUser: async function (adminUserId) {
    try {
      await prisma.slash_command_presets.updateMany({
        where: { userId: null },
        data: {
          userId: adminUserId,
          uid: adminUserId,
        },
      });
      console.log(
        "Successfully migrated slash command presets to multi-user mode"
      );
    } catch (error) {
      console.error(
        "Error migrating slash command presets to multi-user mode:",
        error
      );
    }
  },
};

module.exports.SlashCommandPresets = SlashCommandPresets;
