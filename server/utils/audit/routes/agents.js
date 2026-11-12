// Route audit declarations for agents, tools and automation: see ./index.js.
module.exports = {
  // server/endpoints/agentFlows.js
  "POST /agent-flows/save": { actions: ["flow.created", "flow.updated"] },
  "DELETE /agent-flows/:uuid": { actions: ["flow.deleted"] },
  "POST /agent-flows/:uuid/toggle": { actions: ["flow.updated"] },

  // server/endpoints/mcpServers.js
  "POST /mcp-servers/toggle": {
    actions: ["mcp.server_started", "mcp.server_stopped"],
  },
  "POST /mcp-servers/delete": { actions: ["mcp.server_removed"] },
  "POST /mcp-servers/toggle-tool": { actions: ["mcp.tool_toggled"] },

  // server/endpoints/agentSkillWhitelist.js
  "POST /agent-skills/whitelist/add": { actions: ["agent.whitelist_added"] },

  // server/endpoints/experimental/liveSync.js
  "POST /experimental/toggle-live-sync": { actions: ["feature.toggled"] },
  "POST /workspace/:slug/update-watch-status": {
    actions: ["document.watched"],
  },

  // server/endpoints/experimental/imported-agent-plugins.js
  "POST /experimental/agent-plugins/:hubId/toggle": {
    actions: ["skill.enabled", "skill.disabled"],
  },
  "POST /experimental/agent-plugins/:hubId/config": {
    actions: ["skill.configured"],
  },
  "DELETE /experimental/agent-plugins/:hubId": { actions: ["skill.removed"] },

  // server/endpoints/memory.js
  "POST /workspaces/:slug/memories": { actions: ["memory.created"] },
  "PUT /memories/:memoryId": { actions: ["memory.updated"] },
  "DELETE /memories/:memoryId": { actions: ["memory.deleted"] },
  "POST /memories/:memoryId/promote": { actions: ["memory.updated"] },
  "POST /memories/:memoryId/demote/:slug": { actions: ["memory.updated"] },

  // server/endpoints/scheduledJobs.js
  "POST /scheduled-jobs/runs/:runId/:action": {
    actions: ["scheduled_job.run"],
  },
  "POST /scheduled-jobs/new": { actions: ["scheduled_job.created"] },
  "PUT /scheduled-jobs/:id": { actions: ["scheduled_job.updated"] },
  "DELETE /scheduled-jobs/:id": { actions: ["scheduled_job.deleted"] },
  "POST /scheduled-jobs/:id/toggle": { actions: ["scheduled_job.updated"] },
  "POST /scheduled-jobs/:id/trigger": { actions: ["scheduled_job.run"] },
};
