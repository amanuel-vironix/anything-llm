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

const USER_FIELDS_WITH_VALUES = [
  "role",
  "suspended",
  "dailyMessageLimit",
  "username",
];

function domainOf(email) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  return email.split("@").pop().toLowerCase();
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
      method:
        m.method === "oidc"
          ? "oidc"
          : m.multiUserMode === false
            ? "single_user_password"
            : "password",
      username: m.username,
    },
  }),
  // Google sign-in branch (endpoints/auth/oidc.js, system.js). The email and
  // the provider's error detail never go in a row: only the email's domain.
  failed_login_oidc: (m) => ({
    action: "auth.login_failed",
    outcome: "failed",
    reason: m.reason || "oidc_failed",
    metadata: { method: "oidc", emailDomain: domainOf(m.email) },
  }),
  failed_login_password_disabled: (m, uid) => ({
    action: "auth.login_failed",
    outcome: "denied",
    reason: "password_login_disabled",
    targetType: "user",
    targetId: uid,
    metadata: { method: "password", username: m.username },
  }),
  user_created_oidc: (m, uid) => ({
    action: "auth.oidc_user_provisioned",
    actor: asActor(uid),
    targetType: "user",
    targetId: uid,
    metadata: { provider: "oidc", role: m.role },
  }),
  oidc_settings_updated: () => ({
    action: "settings.changed",
    metadata: { key: "oidc", source: "admin" },
  }),
  password_reset: (_m, uid) => ({
    action: "auth.password_reset",
    actor: asActor(uid),
    targetType: "user",
    targetId: uid,
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
        // Values only for access-relevant fields; a bio or other free
        // text is named, never stored.
        metadata: {
          username: m.username,
          changedFields: Object.keys(changes),
          changes: Object.fromEntries(
            Object.entries(changes).filter(([field]) =>
              USER_FIELDS_WITH_VALUES.includes(field)
            )
          ),
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
  // The access-policy branch adds an owner, workspace scope and expiry.
  api_key_created: (m) => ({
    action: "api_key.created",
    targetType: "api_key",
    metadata: {
      ownerId: m.userId,
      workspaceIds: m.workspaceIds,
      expiresAt: m.expiresAt,
    },
  }),
  api_key_updated: (m) => ({
    action: "api_key.updated",
    targetType: "api_key",
    targetId: m.apiKeyId,
    metadata: {
      keyId: m.apiKeyId,
      ownerId: m.userId,
      workspaceIds: m.workspaceIds,
      expiresAt: m.expiresAt,
    },
  }),
  api_key_deleted: () => ({ action: "api_key.deleted", targetType: "api_key" }),
  legacy_api_key_refused: (m) => ({
    action: "access.denied",
    outcome: "denied",
    reason: "key_scope",
    actor: { type: "api_key", id: m.apiKeyId, onBehalfOf: null },
    metadata: { route: m.path, check: "key_owner" },
  }),

  // Access-policy branch: policies, teams and role defaults. Their metadata
  // passes through the catalogue's allow-list.
  ...Object.fromEntries(
    [
      ["policy_created", "policy.created", "policy"],
      ["policy_updated", "policy.updated", "policy"],
      ["policy_deleted", "policy.deleted", "policy"],
      ["policy_assigned", "policy.assigned", "policy"],
      ["role_default_updated", "role_default.updated", "setting"],
      ["team_created", "team.created", "team"],
      ["team_updated", "team.updated", "team"],
      ["team_deleted", "team.deleted", "team"],
      ["team_member_added", "team.member_added", "team"],
      ["team_member_removed", "team.member_removed", "team"],
      ["team_lead_changed", "team.lead_changed", "team"],
    ].map(([event, action, targetType]) => [
      event,
      (m) => ({
        action,
        targetType,
        targetId: m.policyId ?? m.teamId ?? m.id,
        teamId: targetType === "team" ? m.teamId ?? m.id : undefined,
        metadata: m,
      }),
    ])
  ),
  // endpoints/teams.js: {teamId, workspaceId, workspaceName}
  team_workspace_created: (m) => ({
    action: "workspace.created",
    teamId: m.teamId,
    workspaceId: m.workspaceId,
    targetType: "workspace",
    targetId: m.workspaceId,
    metadata: { workspaceName: m.workspaceName, slug: m.slug },
  }),
  // A team lead's edit: {teamId, workspaceId, changedFields}
  team_workspace_updated: (m) => ({
    action: "workspace.updated",
    teamId: m.teamId,
    workspaceId: m.workspaceId,
    targetType: "workspace",
    targetId: m.workspaceId,
    metadata: { changedFields: m.changedFields },
  }),
  // A workspace moved between teams: {workspaceId, fromTeamId, toTeamId}
  workspace_team_changed: (m) => ({
    action: "workspace.updated",
    teamId: m.toTeamId,
    workspaceId: m.workspaceId,
    targetType: "workspace",
    targetId: m.workspaceId,
    metadata: {
      changedFields: ["team_id"],
      changes: { team_id: { from: m.fromTeamId, to: m.toTeamId } },
    },
  }),
  model_router_deleted: (m) => ({
    action: "router.deleted",
    targetType: "router",
    targetId: m.routerId,
    metadata: { routerId: m.routerId },
  }),
  // AP refusals: userId is the acting user when one is known.
  // {tool: "agent" | <plugin>, check: "allow_agents" | "agent_tools"}
  tool_refused_by_policy: (m, uid) => ({
    action: "agent.tool_refused",
    outcome: "denied",
    reason: "policy",
    actor: asActor(uid),
    metadata: { tool: m.tool, check: m.check, policyId: m.policyId },
  }),
  // {provider, model, check: "allowed_models"}
  model_refused_by_policy: (m, uid) => ({
    action: "access.denied",
    outcome: "denied",
    reason: "policy",
    actor: asActor(uid),
    metadata: {
      check: m.check || "allowed_models",
      resource: [m.provider, m.model].filter(Boolean).join(":") || null,
    },
  }),
  // {keyId}, with the key owner's id as userId
  api_key_expired_refused: (m, uid) => ({
    action: "api_key.expired_rejected",
    outcome: "denied",
    reason: "expired",
    actor: {
      type: "api_key",
      id: m.keyId ?? m.apiKeyId,
      onBehalfOf: uid,
    },
    metadata: { keyId: m.keyId ?? m.apiKeyId, check: "expiry" },
  }),
  // {reason: "no_valid_session"} with no user, or {reason: "other_user", invocationId}
  agent_ws_rejected: (m, uid) => ({
    action: "auth.ws_rejected",
    outcome: "denied",
    reason: m.reason || "rejected",
    actor: asActor(uid),
    metadata: { route: "agent-invocation" },
  }),
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
