const prisma = require("../utils/prisma");
const { AccessPolicy } = require("../models/accessPolicy");
const { EventLogs } = require("../models/eventLogs");
const { SystemSettings } = require("../models/systemSettings");
const { reqBody, userFromSession } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  strictMultiUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const {
  ROLE_POLICY_SETTING,
  getRoleDefaults,
  validateToolRule,
} = require("../utils/accessPolicy/agentTools");
const {
  toolSharingForTeams,
  setToolTeams,
} = require("../utils/accessPolicy/toolSharing");

const adminOnly = [validatedRequest, strictMultiUserRoleValid([ROLES.admin])];

/** Parse the stored JSON columns so the UI gets arrays and objects. */
function presentPolicy(policy) {
  if (!policy) return null;
  const parse = (value) => {
    if (value === null || value === undefined) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  return {
    ...policy,
    allowed_models: parse(policy.allowed_models),
    agent_tools: parse(policy.agent_tools),
  };
}

/**
 * Access policies, the role-default tool rule, policy assignment and sharing agent
 * tools with teams. All admin only (decision 3), and multi-user only, since policies
 * apply to users.
 */
function accessPolicyEndpoints(app) {
  if (!app) return;

  app.get("/admin/access-policies", adminOnly, async (_request, response) => {
    try {
      const policies = await AccessPolicy.whereWithCounts({});
      response.status(200).json({ policies: policies.map(presentPolicy) });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.post(
    "/admin/access-policies/new",
    adminOnly,
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { policy, error } = await AccessPolicy.create(
          reqBody(request),
          user?.id
        );
        if (error) return response.status(400).json({ policy: null, error });
        await EventLogs.logEvent(
          "policy_created",
          { policyId: policy.id, name: policy.name },
          user?.id
        );
        response
          .status(200)
          .json({ policy: presentPolicy(policy), error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/admin/access-policies/:id",
    adminOnly,
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const body = reqBody(request);
        const { policy, error } = await AccessPolicy.update(
          Number(request.params.id),
          body
        );
        if (error) return response.status(400).json({ policy: null, error });
        await EventLogs.logEvent(
          "policy_updated",
          { policyId: policy.id, changedFields: Object.keys(body) },
          user?.id
        );
        response
          .status(200)
          .json({ policy: presentPolicy(policy), error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/admin/access-policies/:id",
    adminOnly,
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const id = Number(request.params.id);
        const result = await AccessPolicy.delete(id);
        if (!result.success)
          return response
            .status(400)
            .json({ success: false, error: result.error });
        await EventLogs.logEvent(
          "policy_deleted",
          { policyId: id, unassigned: result.unassigned },
          user?.id
        );
        response.status(200).json({ ...result, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  // Assign (or clear, with null) a user's own policy. Separate from the user edit route
  // so managers, who can edit users, can't assign policies.
  app.post("/admin/users/:id/policy", adminOnly, async (request, response) => {
    try {
      const actor = await userFromSession(request, response);
      const userId = Number(request.params.id);
      const { policyId = null } = reqBody(request);
      if (policyId !== null) {
        const policy = await AccessPolicy.get({ id: Number(policyId) });
        if (!policy)
          return response
            .status(400)
            .json({ success: false, error: "That policy does not exist." });
      }
      const { count } = await prisma.users.updateMany({
        where: { id: userId },
        data: { policy_id: policyId === null ? null : Number(policyId) },
      });
      if (count !== 1)
        return response
          .status(404)
          .json({ success: false, error: "User not found." });
      await EventLogs.logEvent(
        "policy_assigned",
        { userId, policyId: policyId === null ? null : Number(policyId) },
        actor?.id
      );
      response.status(200).json({ success: true, error: null });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.get(
    "/admin/agent-tool-role-policy",
    adminOnly,
    async (_request, response) => {
      try {
        response.status(200).json({ roleDefaults: await getRoleDefaults() });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  // Body: { manager: rule|null, default: rule|null }. A null or missing role means no
  // restriction for that role.
  app.post(
    "/admin/agent-tool-role-policy",
    adminOnly,
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const body = reqBody(request);
        const next = {};
        for (const role of ["manager", "default"]) {
          const { rule, error } = validateToolRule(body?.[role] ?? null);
          if (error)
            return response
              .status(400)
              .json({ success: false, error: `${role}: ${error}` });
          if (rule) next[role] = rule;
        }
        const saved = await SystemSettings._updateSettings({
          [ROLE_POLICY_SETTING]: Object.keys(next).length
            ? JSON.stringify(next)
            : null,
        });
        if (!saved?.success)
          return response.status(500).json({
            success: false,
            error: saved?.error || "Could not save the role defaults.",
          });
        await EventLogs.logEvent(
          "role_default_updated",
          { roles: Object.keys(next) },
          user?.id
        );
        response
          .status(200)
          .json({ success: true, roleDefaults: next, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get("/admin/agent-tool-sharing", adminOnly, async (request, response) => {
    try {
      const tool = String(request.query?.tool || "");
      if (!tool)
        return response.status(400).json({ error: "A tool name is required." });
      response.status(200).json({ teams: await toolSharingForTeams(tool) });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  // Body: { tool, teamIds }. Offers the tool to exactly these teams.
  app.post(
    "/admin/agent-tool-sharing",
    adminOnly,
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { tool, teamIds = [] } = reqBody(request);
        if (!Array.isArray(teamIds))
          return response
            .status(400)
            .json({ error: "teamIds must be a list." });
        const result = await setToolTeams(tool, teamIds, user?.id);
        if (result.error)
          return response.status(400).json({ success: false, ...result });
        for (const change of result.changed)
          await EventLogs.logEvent(
            "policy_updated",
            {
              teamId: change.teamId,
              changedFields: ["agent_tools"],
              tool,
              shared: change.shared,
            },
            user?.id
          );
        response.status(200).json({ success: true, ...result });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { accessPolicyEndpoints, presentPolicy };
