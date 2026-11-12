/**
 * Maps the old `EventLogs.logEvent(event, metadata, userId)` calls to catalogue
 * actions, so callers not yet moved to `audit.record` still write correct rows.
 *
 * The old third argument meant different things at different call sites: the
 * actor at most, the target for `user_updated` (F-55), and the new user for
 * `invite_accepted` and logins. Each mapping says how to read it. Once every
 * caller uses `audit.record`, this file and `EventLogs.logEvent` go.
 */
const { hashValue } = require("./sanitize");

const asActor = (userId) =>
  userId ? { type: "user", id: userId, onBehalfOf: Number(userId) } : undefined;

function hostOf(link) {
  try {
    return new URL(link).host;
  } catch {
    return null;
  }
}

function changesFrom(changes = {}) {
  const out = {};
  for (const [field, text] of Object.entries(changes || {})) {
    const [from, to] = String(text).split(" => ");
    out[field] = { from, to };
  }
  return out;
}

/**
 * Each entry: (metadata, userId) => one AuditEvent or an array of them.
 * @type {Record<string, (m: Object, userId: (number|null)) => (Object|Object[])>}
 */
const LEGACY_EVENT_MAP = {
  // Sign-in (server/endpoints/system.js). userId is the account tried, not an
  // authenticated actor; it's kept as the target.
  failed_login_invalid_username: (m, uid) => ({
    action: "auth.login_failed",
    outcome: "failed",
    reason: "invalid_username",
    targetType: "user",
    targetId: uid,
    metadata: { method: "password", username: m.username },
  }),
  failed_login_invalid_password: (m, uid) => ({
    action: "auth.login_failed",
    outcome: "failed",
    reason: "invalid_password",
    targetType: uid ? "user" : undefined,
    targetId: uid,
    metadata: {
      method: m.multiUserMode === false ? "single_user_password" : "password",
      username: m.username,
    },
  }),
  failed_login_account_suspended: (m, uid) => ({
    action: "auth.login_failed",
    outcome: "denied",
    reason: "suspended",
    targetType: "user",
    targetId: uid,
    metadata: { method: "password", username: m.username },
  }),
  failed_login_invalid_temporary_auth_token: () => ({
    action: "auth.login_failed",
    outcome: "failed",
    reason: "invalid_sso_token",
    metadata: { method: "simple_sso" },
  }),
  login_event: (m, uid) => ({
    action: "auth.login_succeeded",
    actor: asActor(uid),
    targetType: uid ? "user" : undefined,
    targetId: uid,
    metadata: {
      method: m.multiUserMode === false ? "single_user_password" : "password",
      username: m.username,
    },
  }),
  multi_user_mode_enabled: (m, uid) => ({
    action: "multi_user.enabled",
    actor: asActor(uid),
    targetType: "user",
    targetId: uid,
  }),

  // Accounts (admin.js, invite.js, api/admin, models/user.js)
  user_created: (m) => ({
    action: "user.created",
    metadata: { username: m.userName, via: "admin" },
  }),
  user_deleted: (m) => ({
    action: "user.deleted",
    metadata: { username: m.userName },
  }),
  api_user_deleted: (m) => ({
    action: "user.deleted",
    metadata: { username: m.userName, via: "api" },
  }),
  // F-55: userId here is the target; the actor comes from the request.
  user_updated: (m, uid) => {
    const changes = changesFrom(m.changes);
    const base = {
      targetType: "user",
      targetId: uid,
    };
    const events = [
      {
        ...base,
        action: "user.updated",
        metadata: {
          username: m.username,
          changedFields: Object.keys(changes),
          changes,
        },
      },
    ];
    if (changes.role)
      events.push({
        ...base,
        action: "user.role_changed",
        metadata: {
          username: m.username,
          from: changes.role.from,
          to: changes.role.to,
        },
      });
    if (changes.suspended)
      events.push({
        ...base,
        action:
          String(changes.suspended.to) === "1" ||
          changes.suspended.to === "true"
            ? "user.suspended"
            : "user.unsuspended",
        metadata: { username: m.username },
      });
    return events;
  },
  // F-55: store a hash of the invite code, never the code.
  invite_created: (m) => ({
    action: "invite.created",
    targetType: "invite",
    metadata: { codeHash: m.inviteCode ? hashValue(m.inviteCode) : null },
  }),
  invite_deleted: () => ({ action: "invite.disabled", targetType: "invite" }),
  invite_accepted: (m, uid) => ({
    action: "invite.claimed",
    actor: asActor(uid),
    targetType: "user",
    targetId: uid,
    metadata: { username: m.username },
  }),
  api_key_created: () => ({ action: "api_key.created", targetType: "api_key" }),
  api_key_deleted: () => ({ action: "api_key.deleted", targetType: "api_key" }),
  event_logs_cleared: () => ({ action: "audit.cleared" }),

  // Workspaces and chats
  workspace_created: (m) => ({
    action: "workspace.created",
    metadata: { workspaceName: m.workspaceName },
  }),
  api_workspace_created: (m) => ({
    action: "workspace.created",
    metadata: { workspaceName: m.workspaceName },
  }),
  workspace_deleted: (m) => ({
    action: "workspace.deleted",
    metadata: { workspaceName: m.workspaceName },
  }),
  api_workspace_deleted: (m) => ({
    action: "workspace.deleted",
    metadata: { workspaceName: m.workspaceName },
  }),
  // models/workspace.js: the prompt text itself never goes in a row.
  workspace_prompt_changed: () => ({
    action: "workspace.updated",
    metadata: { changedFields: ["openAiPrompt"] },
  }),
  workspace_vectors_reset: (m) => ({
    action: "workspace.vectors_reset",
    metadata: { workspaceName: m.workspaceName, reason: m.reason },
  }),
  workspace_thread_created: () => ({ action: "thread.created" }),
  api_workspace_thread_created: () => ({ action: "thread.created" }),
  thread_forked: () => ({ action: "thread.forked" }),
  sent_chat: (m) => ({ action: "chat.sent", metadata: { model: m.chatModel } }),
  api_sent_chat: (m) => ({
    action: "chat.sent",
    metadata: { model: m.chatModel },
  }),
  exported_chats: (m) => ({
    action: "chat.exported",
    metadata: { format: m.type, filter: m.chatType },
  }),

  // Documents
  document_uploaded: (m) => ({
    action: "document.uploaded",
    metadata: { docName: m.documentName, via: "upload" },
  }),
  api_document_uploaded: (m) => ({
    action: "document.uploaded",
    metadata: { docName: m.documentName, via: "upload" },
  }),
  api_raw_document_uploaded: () => ({
    action: "document.uploaded",
    metadata: { via: "raw_text" },
  }),
  link_uploaded: (m) => ({
    action: "document.uploaded",
    metadata: { docName: hostOf(m.link), via: "link" },
  }),
  api_link_uploaded: (m) => ({
    action: "document.uploaded",
    metadata: { docName: hostOf(m.link), via: "link" },
  }),
  workspace_documents_added: (m) => ({
    action: "document.embedded",
    metadata: {
      workspaceName: m.workspaceName,
      count: m.numberOfDocumentsAdded ?? m.embedded,
    },
  }),
  workspace_documents_removed: (m) => ({
    action: "document.removed",
    metadata: { workspaceName: m.workspaceName, count: m.numberOfDocuments },
  }),
  document_embedded: (m) => ({
    action: "parsed_file.embedded",
    workspaceId: m.workspaceId,
    metadata: { fileId: null },
  }),
  document_uploaded_to_chat: (m) => ({
    action: "parsed_file.created",
    metadata: { fileName: m.documentName, workspaceSlug: m.workspace },
  }),
  workspace_file_uploaded: (m) => ({
    action: "parsed_file.created",
    workspaceId: m.workspaceId,
    metadata: { fileName: m.filename },
  }),

  // Embeds, hub, features, providers, Telegram
  embed_created: (m) => ({
    action: "embed.created",
    targetType: "embed",
    targetId: m.embedId,
  }),
  embed_updated: (m) => ({
    action: "embed.updated",
    targetType: "embed",
    targetId: m.embedId,
  }),
  embed_deleted: (m) => ({
    action: "embed.deleted",
    targetType: "embed",
    targetId: m.embedId,
  }),
  community_hub_import: (m) => ({
    action: "skill.installed",
    metadata: { kind: m.itemType, hubId: m.itemId },
  }),
  community_hub_publish: (m) => ({
    action: "community_hub.published",
    metadata: { itemType: m.itemType },
  }),
  experimental_feature_enabled: (m) => ({
    action: "feature.toggled",
    metadata: { feature: m.feature, enabled: true },
  }),
  update_llm_provider: () => ({
    action: "vendor.changed",
    metadata: { kind: "llm" },
  }),
  update_embedding_engine: () => ({
    action: "vendor.changed",
    metadata: { kind: "embedder" },
  }),
  update_vector_db: () => ({
    action: "vendor.changed",
    metadata: { kind: "vector_db" },
  }),
  telegram_bot_connected: (m) => ({
    action: "telegram.bot_connected",
    metadata: { botUsername: m.bot_username },
  }),
  telegram_bot_disconnected: () => ({ action: "telegram.bot_disconnected" }),
  telegram_user_approved: (m) => ({
    action: "telegram.user_approved",
    targetType: "telegram_chat",
    targetId: m.chatId,
  }),
  telegram_user_denied: (m) => ({
    action: "telegram.user_denied",
    targetType: "telegram_chat",
    targetId: m.chatId,
  }),
  telegram_user_revoked: (m) => ({
    action: "telegram.user_revoked",
    targetType: "telegram_chat",
    targetId: m.chatId,
  }),
};

/**
 * @param {string} event
 * @param {Object} metadata
 * @param {number|null} userId
 * @returns {Object[]} catalogue events, empty if the name isn't known
 */
function mapLegacyEvent(event, metadata = {}, userId = null) {
  const mapper = LEGACY_EVENT_MAP[event];
  if (!mapper) return [];
  const out = mapper(metadata || {}, userId ? Number(userId) : null);
  return Array.isArray(out) ? out : [out];
}

module.exports = { LEGACY_EVENT_MAP, mapLegacyEvent };
