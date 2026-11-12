const prisma = require("../utils/prisma");
const { Team, TEAM_ROLES } = require("../models/team");
const { Workspace } = require("../models/workspace");
const { EventLogs } = require("../models/eventLogs");
const { reqBody, userFromSession, multiUserMode } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  strictMultiUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { teamRoleValid } = require("../utils/middleware/teamProtected");

const adminOnly = [validatedRequest, strictMultiUserRoleValid([ROLES.admin])];
const leadOrAdmin = [validatedRequest, teamRoleValid([TEAM_ROLES.lead])];

/** Settings a lead may change on a team workspace. Model and provider stay admin-only. */
const LEAD_WORKSPACE_FIELDS = [
  "name",
  "openAiPrompt",
  "openAiTemp",
  "openAiHistory",
  "similarityThreshold",
  "topN",
  "chatMode",
  "queryRefusalResponse",
];

function teamEndpoints(app) {
  if (!app) return;

  // ---- Admin: team CRUD and workspace ownership ----

  app.get("/admin/teams", adminOnly, async (_request, response) => {
    try {
      response.status(200).json({ teams: await Team.whereWithCounts({}) });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.post("/admin/teams/new", adminOnly, async (request, response) => {
    try {
      const user = await userFromSession(request, response);
      const { team, error } = await Team.create(reqBody(request), user?.id);
      if (error) return response.status(400).json({ team: null, error });
      await EventLogs.logEvent(
        "team_created",
        { teamId: team.id, name: team.name, policyId: team.policy_id },
        user?.id
      );
      response.status(200).json({ team, error: null });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.post("/admin/teams/:teamId", adminOnly, async (request, response) => {
    try {
      const user = await userFromSession(request, response);
      const body = reqBody(request);
      const { team, error } = await Team.update(
        Number(request.params.teamId),
        body
      );
      if (error) return response.status(400).json({ team: null, error });
      await EventLogs.logEvent(
        "team_updated",
        { teamId: team.id, changedFields: Object.keys(body) },
        user?.id
      );
      response.status(200).json({ team, error: null });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.delete("/admin/teams/:teamId", adminOnly, async (request, response) => {
    try {
      const user = await userFromSession(request, response);
      const teamId = Number(request.params.teamId);
      const result = await Team.delete(teamId);
      if (!result.success)
        return response
          .status(400)
          .json({ success: false, error: result.error });
      await EventLogs.logEvent(
        "team_deleted",
        { teamId, counts: result.counts },
        user?.id
      );
      response.status(200).json({ ...result, error: null });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  // Give a workspace to a team or detach it (teamId null). Admin only.
  app.post(
    "/admin/workspaces/:slug/team",
    adminOnly,
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = await Workspace.get({
          slug: String(request.params.slug),
        });
        if (!workspace)
          return response
            .status(404)
            .json({ workspace: null, error: "Workspace not found." });
        const { teamId = null } = reqBody(request);
        const result = await Workspace.setTeam(
          workspace.id,
          teamId === null ? null : Number(teamId)
        );
        if (result.error)
          return response
            .status(400)
            .json({ workspace: null, error: result.error });
        await EventLogs.logEvent(
          "workspace_team_changed",
          {
            workspaceId: workspace.id,
            fromTeamId: workspace.team_id ?? null,
            toTeamId: result.workspace.team_id ?? null,
          },
          user?.id
        );
        response.status(200).json({ workspace: result.workspace, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  // ---- Any signed-in user: their own team ----

  app.get("/team/mine", [validatedRequest], async (request, response) => {
    try {
      if (!multiUserMode(response))
        return response.status(200).json({ team: null, role: null });
      const user = await userFromSession(request, response);
      const membership = await Team.membershipFor(user?.id);
      if (!membership)
        return response.status(200).json({ team: null, role: null });
      const team = await Team.get({ id: membership.team_id });
      response.status(200).json({
        team: team
          ? { id: team.id, name: team.name, description: team.description }
          : null,
        role: membership.role,
      });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  // ---- Team leads (and admins): members, leads, workspaces ----

  app.get("/teams/:teamId", leadOrAdmin, async (_request, response) => {
    try {
      const team = await Team.get({ id: response.locals.teamId });
      const policy = team?.policy_id
        ? await prisma.access_policies.findUnique({
            where: { id: team.policy_id },
            select: { id: true, name: true },
          })
        : null;
      response
        .status(200)
        .json({ team, policy, teamRole: response.locals.teamRole });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.get("/teams/:teamId/members", leadOrAdmin, async (_request, response) => {
    try {
      response
        .status(200)
        .json({ members: await Team.members(response.locals.teamId) });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  // Users who can be added: not on any team, not suspended; leads may only add
  // `default`-role users.
  app.get(
    "/teams/:teamId/candidates",
    leadOrAdmin,
    async (_request, response) => {
      try {
        const users = await prisma.users.findMany({
          where: {
            suspended: 0,
            team_membership: null,
            ...(response.locals.teamRole === "admin"
              ? {}
              : { role: ROLES.default }),
          },
          select: { id: true, username: true, role: true },
          orderBy: { username: "asc" },
        });
        response.status(200).json({ users });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post("/teams/:teamId/members", leadOrAdmin, async (request, response) => {
    try {
      const actor = await userFromSession(request, response);
      const teamId = response.locals.teamId;
      const isAdmin = response.locals.teamRole === "admin";
      const { userId, role = TEAM_ROLES.member } = reqBody(request);
      const target = await prisma.users.findUnique({
        where: { id: Number(userId) },
        select: { id: true, role: true, suspended: true },
      });
      if (!target)
        return response
          .status(400)
          .json({ member: null, error: "User not found." });
      // Leads can't pull managers or admins into their team, or suspended users.
      if (!isAdmin && (target.role !== ROLES.default || target.suspended))
        return response.status(403).json({
          member: null,
          error: "Team leads can only add active users with the default role.",
        });
      const { member, error } = await Team.addMember(teamId, target.id, {
        role,
        addedBy: actor?.id,
      });
      if (error) return response.status(400).json({ member: null, error });
      await EventLogs.logEvent(
        "team_member_added",
        { teamId, userId: target.id, role: member.role },
        actor?.id
      );
      response.status(200).json({ member, error: null });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.delete(
    "/teams/:teamId/members/:userId",
    leadOrAdmin,
    async (request, response) => {
      try {
        const actor = await userFromSession(request, response);
        const teamId = response.locals.teamId;
        const userId = Number(request.params.userId);
        const result = await Team.removeMember(teamId, userId, {
          force: response.locals.teamRole === "admin",
        });
        if (!result.success)
          return response
            .status(400)
            .json({ success: false, error: result.error });
        await EventLogs.logEvent(
          "team_member_removed",
          { teamId, userId },
          actor?.id
        );
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/teams/:teamId/members/:userId/role",
    leadOrAdmin,
    async (request, response) => {
      try {
        const actor = await userFromSession(request, response);
        const teamId = response.locals.teamId;
        const userId = Number(request.params.userId);
        const { role } = reqBody(request);
        const result = await Team.setMemberRole(teamId, userId, role, {
          force: response.locals.teamRole === "admin",
        });
        if (!result.success)
          return response
            .status(400)
            .json({ success: false, error: result.error });
        await EventLogs.logEvent(
          "team_lead_changed",
          { teamId, userId, role },
          actor?.id
        );
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/teams/:teamId/workspaces",
    leadOrAdmin,
    async (_request, response) => {
      try {
        const workspaces = await Workspace.where({
          team_id: response.locals.teamId,
        });
        response.status(200).json({ workspaces });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/teams/:teamId/workspaces/new",
    leadOrAdmin,
    async (request, response) => {
      try {
        const actor = await userFromSession(request, response);
        const teamId = response.locals.teamId;
        const { name = null } = reqBody(request);
        const { workspace, message } = await Workspace.new(name, null);
        if (!workspace)
          return response.status(400).json({ workspace: null, error: message });
        const result = await Workspace.setTeam(workspace.id, teamId);
        if (result.error) {
          await Workspace.delete({ id: workspace.id });
          return response
            .status(400)
            .json({ workspace: null, error: result.error });
        }
        await EventLogs.logEvent(
          "team_workspace_created",
          { teamId, workspaceId: workspace.id, workspaceName: workspace.name },
          actor?.id
        );
        response.status(200).json({ workspace: result.workspace, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/teams/:teamId/workspaces/:slug/update",
    leadOrAdmin,
    async (request, response) => {
      try {
        const actor = await userFromSession(request, response);
        const teamId = response.locals.teamId;
        const workspace = await Workspace.get({
          slug: String(request.params.slug),
          team_id: teamId,
        });
        if (!workspace)
          return response
            .status(404)
            .json({ workspace: null, error: "Workspace not found." });
        const body = reqBody(request);
        const updates = {};
        for (const key of LEAD_WORKSPACE_FIELDS)
          if (Object.prototype.hasOwnProperty.call(body, key))
            updates[key] = body[key];
        const { workspace: updated, message } = await Workspace.update(
          workspace.id,
          updates
        );
        if (!updated)
          return response.status(400).json({ workspace: null, error: message });
        await EventLogs.logEvent(
          "team_workspace_updated",
          {
            teamId,
            workspaceId: workspace.id,
            changedFields: Object.keys(updates),
          },
          actor?.id
        );
        response.status(200).json({ workspace: updated, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { teamEndpoints, LEAD_WORKSPACE_FIELDS };
