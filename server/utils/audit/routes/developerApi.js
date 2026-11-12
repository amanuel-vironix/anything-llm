// Route audit declarations for the developer API under /v1 (the actor is the
// API key). See ./index.js.
module.exports = {
  // endpoints/api/document
  "POST /v1/document/upload": {
    actions: ["document.uploaded", "document.embedded"],
  },
  "POST /v1/document/upload/:folderName": {
    actions: ["document.uploaded", "document.embedded"],
  },
  "POST /v1/document/upload-link": {
    actions: ["document.uploaded", "document.embedded"],
  },
  "POST /v1/document/raw-text": {
    actions: ["document.uploaded", "document.embedded"],
  },
  "GET /v1/document/:docName": { actions: ["document.viewed"] },
  "POST /v1/document/create-folder": {
    exempt: "Creates an empty folder on disk; no document or content changes",
  },
  "DELETE /v1/document/remove-folder": { actions: ["document.deleted"] },
  "POST /v1/document/move-files": {
    exempt:
      "Moves unembedded files between folders; content is unchanged and the catalogue has no document.moved action",
  },
  "GET /v1/document/generated-files/:filename": {
    actions: ["document.downloaded"],
  },

  // endpoints/api/system
  "POST /v1/system/update-env": {
    actions: ["settings.changed"],
    in: ["utils/helpers/updateENV.js"],
  },
  "GET /v1/system/export-chats": { actions: ["chat.exported"] },
  "DELETE /v1/system/remove-documents": { actions: ["document.deleted"] },

  // endpoints/api/embed
  "GET /v1/embed/:embedUuid/chats": { actions: ["chat.viewed_other_user"] },
  "GET /v1/embed/:embedUuid/chats/:sessionUuid": {
    actions: ["chat.viewed_other_user"],
  },
  "POST /v1/embed/new": { actions: ["embed.created"] },
  "POST /v1/embed/:embedUuid": { actions: ["embed.updated"] },
  "DELETE /v1/embed/:embedUuid": { actions: ["embed.deleted"] },

  // endpoints/api/mcpServers
  "POST /v1/mcp-servers/new": { actions: ["mcp.server_added"] },
  "POST /v1/mcp-servers/reload": {
    exempt:
      "Reloads servers from the existing config file; the stored config is not changed",
  },
  "POST /v1/mcp-servers/:name/update": { actions: ["mcp.server_updated"] },
  "POST /v1/mcp-servers/:name/toggle": {
    actions: ["mcp.server_started", "mcp.server_stopped"],
  },
  "POST /v1/mcp-servers/:name/toggle-tool": { actions: ["mcp.tool_toggled"] },
  "DELETE /v1/mcp-servers/:name": { actions: ["mcp.server_removed"] },
};
