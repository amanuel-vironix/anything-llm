const ImportedPlugin = require("../../utils/agents/imported");
const { reqBody } = require("../../utils/http");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const { audit } = require("../../utils/audit");

function importedAgentPluginEndpoints(app) {
  if (!app) return;

  app.post(
    "/experimental/agent-plugins/:hubId/toggle",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { hubId } = request.params;
        const { active } = reqBody(request);
        const updatedConfig = ImportedPlugin.updateImportedPlugin(hubId, {
          active: Boolean(active),
        });
        if (
          updatedConfig &&
          !(await audit.recordOrFail(
            {
              action: active ? "skill.enabled" : "skill.disabled",
              targetType: "skill",
              targetId: hubId,
              metadata: { skill: hubId, kind: "imported" },
            },
            response
          ))
        )
          return;
        response.status(200).json(updatedConfig);
      } catch (e) {
        console.error(e);
        response.status(500).end();
      }
    }
  );

  app.post(
    "/experimental/agent-plugins/:hubId/config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { hubId } = request.params;
        const { updates } = reqBody(request);
        const updatedConfig = ImportedPlugin.updateImportedPlugin(
          hubId,
          updates
        );
        if (
          updatedConfig &&
          !(await audit.recordOrFail(
            {
              action: "skill.configured",
              targetType: "skill",
              targetId: hubId,
              metadata: {
                skill: hubId,
                changedFields: Object.keys(updates || {}).filter(
                  (key) => key !== "hubId"
                ),
              },
            },
            response
          ))
        )
          return;
        response.status(200).json(updatedConfig);
      } catch (e) {
        console.error(e);
        response.status(500).end();
      }
    }
  );

  app.delete(
    "/experimental/agent-plugins/:hubId",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { hubId } = request.params;
        const result = ImportedPlugin.deletePlugin(hubId);
        if (
          result &&
          !(await audit.recordOrFail(
            {
              action: "skill.removed",
              targetType: "skill",
              targetId: hubId,
              metadata: { skill: hubId, kind: "imported" },
            },
            response
          ))
        )
          return;
        response.status(200).json(result);
      } catch (e) {
        console.error(e);
        response.status(500).end();
      }
    }
  );
}

module.exports = { importedAgentPluginEndpoints };
