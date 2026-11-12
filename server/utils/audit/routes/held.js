// Route audit declarations for files another branch is editing (see ./index.js
// and docs/merge-coordination.md). Routes here either still use the legacy
// EventLogs.logEvent names, which the wrapper maps to catalogue actions, or
// are `pending` until the owning branch merges.

const USER_UPDATE = { legacy: ["user_updated"], in: ["models/user.js"] };

module.exports = {
  // server/endpoints/system.js (GS: login and recovery; held whole until GS merges)
  "POST /request-token": {
    legacy: [
      "failed_login_invalid_username",
      "failed_login_invalid_password",
      "failed_login_account_suspended",
      "login_event",
    ],
  },
  "GET /request-token/sso/simple": {
    legacy: ["failed_login_invalid_temporary_auth_token", "login_event"],
  },
  "POST /system/local-files/by-docpaths": {
    exempt:
      "Reads document metadata for paths the caller names; changes nothing.",
  },
  "POST /system/update-env": {
    actions: ["settings.changed", "vendor.changed"],
    in: ["utils/helpers/updateENV.js"],
  },
  "POST /system/enable-multi-user": { legacy: ["multi_user_mode_enabled"] },
  "POST /system/generate-api-key": { legacy: ["api_key_created"] },
  "DELETE /system/api-key/:id": { legacy: ["api_key_deleted"] },
  "POST /system/custom-models": {
    exempt: "Lists the models a provider offers; stores nothing.",
  },
  "DELETE /system/event-logs": { legacy: ["event_logs_cleared"] },
  "POST /system/slash-command-presets": {
    exempt: "A user's own slash command shortcuts; no access or data change.",
  },
  "POST /system/slash-command-presets/:slashCommandId": {
    exempt: "A user's own slash command shortcuts; no access or data change.",
  },
  "DELETE /system/slash-command-presets/:slashCommandId": {
    exempt: "A user's own slash command shortcuts; no access or data change.",
  },
  "POST /system/prompt-variables": {
    pending: "AP",
    actions: ["settings.changed"],
  },
  "PUT /system/prompt-variables/:id": {
    pending: "AP",
    actions: ["settings.changed"],
  },
  "DELETE /system/prompt-variables/:id": {
    pending: "AP",
    actions: ["settings.changed"],
  },
  "POST /system/transcribe-audio": {
    exempt:
      "Transcribes audio and returns text; stores nothing. The vendor call is counted by the outbound inventory.",
  },
  "POST /system/validate-sql-connection": {
    exempt: "Tests a database connection string; stores nothing.",
  },

  // server/endpoints/admin.js (AP and GS)
  "POST /admin/users/new": { legacy: ["user_created"] },
  "POST /admin/user/:id": USER_UPDATE,
  "DELETE /admin/user/:id": { legacy: ["user_deleted"] },
  "POST /admin/invite/new": { legacy: ["invite_created"] },
  "DELETE /admin/invite/:id": { legacy: ["invite_deleted"] },
  "POST /admin/workspaces/new": {
    pending: "AP",
    actions: ["workspace.created"],
  },
  "POST /admin/workspaces/:workspaceId/update-users": {
    pending: "AP",
    actions: ["workspace.members_changed"],
  },
  "DELETE /admin/workspaces/:id": {
    pending: "AP",
    actions: ["workspace.deleted"],
  },
  // F-51: logs nothing and always reports success.
  "POST /admin/system-preferences": {
    pending: "AP",
    actions: ["settings.changed"],
  },
  "POST /admin/generate-api-key": { legacy: ["api_key_created"] },
  "DELETE /admin/delete-api-key/:id": { legacy: ["api_key_deleted"] },

  // server/endpoints/invite.js (GS)
  "POST /invite/:code": { legacy: ["invite_accepted"] },

  // server/endpoints/modelRouter.js (AP)
  "POST /model-routers/new": { pending: "AP", actions: ["router.created"] },
  "PUT /model-routers/:id": { pending: "AP", actions: ["router.updated"] },
  "DELETE /model-routers/:id": { pending: "AP", actions: ["router.deleted"] },
  "POST /model-routers/:id/rules/new": {
    pending: "AP",
    actions: ["router.rule_changed"],
  },
  "PUT /model-routers/:id/rules/reorder": {
    pending: "AP",
    actions: ["router.rule_changed"],
  },
  "PUT /model-routers/:id/rules/:ruleId": {
    pending: "AP",
    actions: ["router.rule_changed"],
  },
  "DELETE /model-routers/:id/rules/:ruleId": {
    pending: "AP",
    actions: ["router.rule_changed"],
  },

  // server/endpoints/mobile (AP)
  "POST /mobile/update/:id": {
    pending: "AP",
    actions: ["mobile.device_approved"],
  },
  "DELETE /mobile/:id": { pending: "AP", actions: ["mobile.device_revoked"] },
  "POST /mobile/register": {
    pending: "AP",
    actions: ["mobile.device_registered"],
  },
  "POST /mobile/send/:command": { pending: "AP", actions: ["chat.sent"] },

  // server/endpoints/agentWebsocket.js (AP)
  "WS /agent-invocation/:uuid": {
    pending: "AP",
    actions: ["agent.session_started", "agent.session_ended"],
  },

  // server/endpoints/api/admin (GS)
  "POST /v1/admin/users/new": { pending: "GS", actions: ["user.created"] },
  "POST /v1/admin/users/:id": USER_UPDATE,
  "DELETE /v1/admin/users/:id": { legacy: ["api_user_deleted"] },
  "POST /v1/admin/invite/new": { pending: "GS", actions: ["invite.created"] },
  "DELETE /v1/admin/invite/:id": {
    pending: "GS",
    actions: ["invite.disabled"],
  },
  "POST /v1/admin/workspaces/:workspaceId/update-users": {
    pending: "GS",
    actions: ["workspace.members_changed"],
  },
  "POST /v1/admin/workspaces/:workspaceSlug/manage-users": {
    pending: "GS",
    actions: ["workspace.members_changed"],
  },
  "POST /v1/admin/workspace-chats": {
    pending: "GS",
    actions: ["chat.viewed_other_user"],
  },
  "POST /v1/admin/preferences": {
    pending: "GS",
    actions: ["settings.changed"],
  },

  // server/endpoints/api/workspace (AP)
  "POST /v1/workspace/new": { legacy: ["api_workspace_created"] },
  "DELETE /v1/workspace/:slug": { legacy: ["api_workspace_deleted"] },
  "POST /v1/workspace/:slug/update": {
    pending: "AP",
    actions: ["workspace.updated"],
  },
  "POST /v1/workspace/:slug/update-embeddings": {
    actions: ["document.embedded", "document.removed"],
    in: ["models/documents.js"],
  },
  "POST /v1/workspace/:slug/update-pin": {
    pending: "AP",
    actions: ["document.pinned"],
  },
  "POST /v1/workspace/:slug/chat": { legacy: ["api_sent_chat"] },
  "POST /v1/workspace/:slug/stream-chat": { legacy: ["api_sent_chat"] },
  "POST /v1/workspace/:slug/vector-search": {
    exempt:
      "Searches a workspace's vectors and returns matches; stores nothing. The embedder call is counted by the outbound inventory.",
  },

  // server/endpoints/api/workspaceThread (AP)
  "POST /v1/workspace/:slug/thread/new": {
    legacy: ["api_workspace_thread_created"],
  },
  "POST /v1/workspace/:slug/thread/:threadSlug/update": {
    pending: "AP",
    actions: ["thread.renamed"],
  },
  "DELETE /v1/workspace/:slug/thread/:threadSlug": {
    pending: "AP",
    actions: ["thread.deleted"],
  },
  "POST /v1/workspace/:slug/thread/:threadSlug/chat": {
    legacy: ["api_sent_chat"],
  },
  "POST /v1/workspace/:slug/thread/:threadSlug/stream-chat": {
    legacy: ["api_sent_chat"],
  },

  // server/endpoints/api/openai (AP)
  "POST /v1/openai/chat/completions": { legacy: ["api_sent_chat"] },
  "POST /v1/openai/images/generations": {
    pending: "AP",
    actions: ["chat.sent"],
  },
  "POST /v1/openai/embeddings": {
    exempt:
      "Returns embeddings for the caller's text; stores nothing. The embedder call is counted by the outbound inventory.",
  },
};
