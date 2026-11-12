const { reqBody } = require("../utils/http");
const MCPCompatibilityLayer = require("../utils/MCP");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { audit } = require("../utils/audit");

function mcpServersEndpoints(app) {
  if (!app) return;

  app.get(
    "/mcp-servers/force-reload",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const mcp = new MCPCompatibilityLayer();
        await mcp.reloadMCPServers();
        return response.status(200).json({
          success: true,
          error: null,
          servers: await mcp.servers(),
        });
      } catch (error) {
        console.error("Error force reloading MCP servers:", error);
        return response.status(500).json({
          success: false,
          error: error.message,
          servers: [],
        });
      }
    }
  );

  app.get(
    "/mcp-servers/list",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const servers = await new MCPCompatibilityLayer().servers();
        return response.status(200).json({
          success: true,
          servers,
        });
      } catch (error) {
        console.error("Error listing MCP servers:", error);
        return response.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );

  app.post(
    "/mcp-servers/toggle",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { name } = reqBody(request);
        const mcp = new MCPCompatibilityLayer();
        const result = await mcp.toggleServerStatus(name);
        if (result.success) {
          // MCPCompatibilityLayer is a singleton: after a successful toggle the
          // server is in `mcps` only if it was started.
          const started = Boolean(mcp.mcps?.[name]);
          if (
            !(await audit.recordOrFail(
              {
                action: started ? "mcp.server_started" : "mcp.server_stopped",
                targetType: "mcp_server",
                targetId: name,
                metadata: { server: name },
              },
              response
            ))
          )
            return;
        }
        return response.status(200).json({
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        console.error("Error toggling MCP server:", error);
        return response.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );

  app.post(
    "/mcp-servers/delete",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { name } = reqBody(request);
        const result = await new MCPCompatibilityLayer().deleteServer(name);
        if (result.success) {
          if (
            !(await audit.recordOrFail(
              {
                action: "mcp.server_removed",
                targetType: "mcp_server",
                targetId: name,
                metadata: { server: name },
              },
              response
            ))
          )
            return;
        }
        return response.status(200).json({
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        console.error("Error deleting MCP server:", error);
        return response.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );

  app.post(
    "/mcp-servers/toggle-tool",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { serverName, toolName, enabled } = reqBody(request);
        const result = await new MCPCompatibilityLayer().toggleToolSuppression(
          serverName,
          toolName,
          enabled
        );
        if (result.success) {
          if (
            !(await audit.recordOrFail(
              {
                action: "mcp.tool_toggled",
                targetType: "mcp_server",
                targetId: serverName,
                metadata: {
                  server: serverName,
                  tool: toolName,
                  enabled: Boolean(enabled),
                },
              },
              response
            ))
          )
            return;
        }
        return response.status(200).json({
          success: result.success,
          error: result.error,
          suppressedTools: result.suppressedTools,
        });
      } catch (error) {
        console.error("Error toggling MCP tool:", error);
        return response.status(500).json({
          success: false,
          error: error.message,
          suppressedTools: [],
        });
      }
    }
  );
}

module.exports = { mcpServersEndpoints };
