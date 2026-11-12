const { userFromSession, multiUserMode } = require("../http");

/**
 * Allow the request only for a member of the target team whose team role is in
 * `teamRoles` (e.g. `["lead"]`). Admins always pass. Teams exist only in multi-user
 * mode, so the check refuses in single-user mode.
 *
 * The UI gates on the role string in localStorage (F-13); this is the real check for
 * every lead action. The membership is read from the database on each request.
 *
 * Sets `response.locals.teamId` (the checked team) and `response.locals.teamRole`
 * (`"admin"` for admins).
 *
 * @param {string[]} teamRoles
 * @param {{teamFrom?: (request: import("express").Request) => Promise<number|null>|number|null}} [options]
 *   How to find the target team. Defaults to `request.params.teamId`.
 */
function teamRoleValid(teamRoles = ["lead"], { teamFrom = null } = {}) {
  return async (request, response, next) => {
    try {
      if (!multiUserMode(response)) {
        response.status(403).json({ error: "Teams require multi-user mode." });
        return;
      }
      const user = await userFromSession(request, response);
      if (!user) {
        response.sendStatus(401).end();
        return;
      }

      const raw = teamFrom
        ? await teamFrom(request)
        : request.params?.teamId ?? null;
      const teamId = Number(raw);
      if (!raw || !Number.isInteger(teamId) || teamId <= 0) {
        response.status(404).json({ error: "Team not found." });
        return;
      }

      const prisma = require("../prisma");
      const team = await prisma.teams.findUnique({
        where: { id: teamId },
        select: { id: true },
      });
      if (!team) {
        response.status(404).json({ error: "Team not found." });
        return;
      }

      if (user.role === "admin") {
        response.locals.teamId = teamId;
        response.locals.teamRole = "admin";
        next();
        return;
      }

      const membership = await prisma.team_members.findUnique({
        where: { user_id: Number(user.id) },
        select: { team_id: true, role: true },
      });
      if (
        !membership ||
        membership.team_id !== teamId ||
        !teamRoles.includes(membership.role)
      ) {
        response
          .status(403)
          .json({ error: "You are not allowed to manage this team." });
        return;
      }

      response.locals.teamId = teamId;
      response.locals.teamRole = membership.role;
      next();
    } catch (error) {
      console.error("[teamRoleValid]", error.message);
      response.sendStatus(500).end();
    }
  };
}

module.exports = { teamRoleValid };
