// Route audit declarations: see ./index.js.
// Embed widget, embed management, browser extension, Telegram, web push,
// Community Hub, data connectors and the utility routes.

const EMBED_MIDDLEWARE = "utils/middleware/embedMiddleware.js";
const CONNECTOR = {
  actions: ["connector.token_saved", "document.uploaded"],
  in: ["endpoints/extensions/index.js"],
};

module.exports = {
  // Embed management (admin)
  "POST /embeds/new": { actions: ["embed.created"] },
  "POST /embed/update/:embedId": { actions: ["embed.updated"] },
  "DELETE /embed/:embedId": { actions: ["embed.deleted"] },
  "POST /embed/chats": { actions: ["chat.viewed_other_user"] },
  "DELETE /embed/chats/:chatId": { actions: ["embed.chats_deleted"] },

  // Embed widget (public)
  "POST /embed/:embedId/stream-chat": {
    actions: ["embed.chat", "embed.rejected"],
    in: [EMBED_MIDDLEWARE],
  },
  "DELETE /embed/:embedId/:sessionId": {
    actions: ["embed.chats_deleted", "embed.rejected"],
    in: [EMBED_MIDDLEWARE],
  },

  // Browser extension
  "DELETE /browser-extension/disconnect": {
    actions: ["extension_key.deleted"],
  },
  "POST /browser-extension/embed-content": {
    actions: ["document.uploaded", "document.embedded"],
  },
  "POST /browser-extension/upload-content": { actions: ["document.uploaded"] },
  "POST /browser-extension/api-keys/new": {
    actions: ["extension_key.created"],
  },
  "DELETE /browser-extension/api-keys/:id": {
    actions: ["extension_key.deleted"],
  },

  // Telegram
  "POST /telegram/connect": { actions: ["telegram.bot_connected"] },
  "POST /telegram/disconnect": { actions: ["telegram.bot_disconnected"] },
  "POST /telegram/approve-user": { actions: ["telegram.user_approved"] },
  "POST /telegram/deny-user": { actions: ["telegram.user_denied"] },
  "POST /telegram/revoke-user": { actions: ["telegram.user_revoked"] },
  "POST /telegram/update-config": { actions: ["settings.changed"] },

  // Web push
  "POST /web-push/subscribe": {
    exempt:
      "Stores the caller's own browser push endpoint so they get notifications; no data is read or shared. The catalogue has no action for it.",
  },

  // Community Hub
  "POST /community-hub/settings": {
    actions: ["community_hub.connected", "settings.changed"],
  },
  "POST /community-hub/item": {
    exempt:
      "Fetches a Community Hub item for preview; stores nothing. The install is recorded by apply or import.",
  },
  "POST /community-hub/apply": { actions: ["skill.installed"] },
  "POST /community-hub/import": { actions: ["skill.installed"] },
  "POST /community-hub/:communityHubItemType/create": {
    actions: ["community_hub.published"],
  },

  // Data connectors
  "POST /ext/:repo_platform/branches": {
    exempt:
      "Lists a repository's branches through the collector; fetches and stores no documents.",
  },
  "POST /ext/:repo_platform/repo": CONNECTOR,
  "POST /ext/youtube/transcript": CONNECTOR,
  "POST /ext/confluence": CONNECTOR,
  "POST /ext/website-depth": CONNECTOR,
  "POST /ext/drupalwiki": CONNECTOR,
  "POST /ext/obsidian/vault": CONNECTOR,
  "POST /ext/paperless-ngx": CONNECTOR,

  // Utilities
  "POST /export-chat/:type": { actions: ["chat.exported"] },
  "POST /utils/lemonade/download-model": {
    exempt:
      "Asks the Lemonade server to pull a model onto that server; changes no AnythingLLM stored state. The catalogue has no action for it.",
  },
  "POST /utils/lemonade/delete-model": {
    exempt:
      "Asks the Lemonade server to delete a model on that server; changes no AnythingLLM stored state. The catalogue has no action for it.",
  },
  "POST /utils/foundry/capabilities": {
    exempt:
      "Probes a Foundry endpoint for its capabilities; reads only and stores nothing.",
  },
  "POST /admin/agent-skills/outlook/auth-url": {
    actions: ["oauth.connected"],
  },
  "GET /agent-skills/outlook/auth-callback": { actions: ["oauth.connected"] },
  "POST /admin/agent-skills/outlook/revoke": {
    actions: ["oauth.disconnected"],
  },
};
