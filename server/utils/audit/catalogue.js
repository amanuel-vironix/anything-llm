/**
 * The audit event catalogue (PLAN-audit-logging-and-compliance.md section 4).
 *
 * Every action written to `audit_events` must be listed here. Each entry says:
 * - `must`: a `must_record` action. If neither the database nor the outbox
 *   accepts the row, `audit.record` throws and the request fails.
 * - `metadata`: the only keys allowed in the row's metadata. Anything else is
 *   dropped and counted (section 3.4). Never list a key that can hold chat,
 *   document or memory text, a password, token, key, code or file contents.
 * - `tables`: the sensitive tables this action accounts for. The database
 *   backstop (section 5.2) writes `db.write` for a write to one of these tables
 *   only when no action covering it was recorded in the same request.
 * - `source`: who adds the call (A = audit PR A, AP = access policies and
 *   teams, GS = Google sign-in, SJ = scheduled jobs, GR = guardrails,
 *   CH = compliance hardening). Actions whose source isn't A are listed so the
 *   feature branches can record them by name; nothing on this branch emits them.
 */

/**
 * @typedef {Object} CatalogueEntry
 * @property {boolean} must
 * @property {string[]} metadata
 * @property {string[]} tables
 * @property {string} source
 */

/**
 * @param {string} source
 * @param {{must?: boolean, metadata?: string[], tables?: string[]}} [opts]
 * @returns {CatalogueEntry}
 */
function a(source, { must = false, metadata = [], tables = [] } = {}) {
  return { must, metadata, tables, source };
}

// Keys shared by many actions. Each is an id, a count, a name or a hash.
const CHANGES = ["changedFields", "changes"];
const DOC = ["docId", "docName", "checksum", "workspaceName", "count"];
const CHAT = [
  "workspaceSlug",
  "threadId",
  "provider",
  "model",
  "promptTokens",
  "completionTokens",
  "messageLength",
  "attachments",
  "mode",
];

const CATALOGUE = {
  // 4.1 Sign-in and sessions
  "auth.login_succeeded": a("A", { metadata: ["method", "username"] }),
  "auth.login_failed": a("A", {
    metadata: ["method", "username", "emailDomain"],
  }),
  "auth.locked_out": a("CH", {
    must: true,
    metadata: ["username", "failures"],
  }),
  "auth.unlocked": a("CH", { must: true, metadata: ["username"] }),
  "auth.rate_limited": a("CH", { metadata: ["route"] }),
  "session.created": a("CH", { metadata: ["method"] }),
  "session.revoked": a("CH", { must: true, metadata: ["sessionId", "count"] }),
  "session.expired_idle": a("CH", { metadata: ["sessionId"] }),
  "session.rejected": a("A", { metadata: ["route"] }),
  "auth.password_changed": a("A", { must: true, tables: ["users"] }),
  "auth.password_reset": a("A", { must: true, tables: ["users"] }),
  "auth.recovery_codes_issued": a("A", {
    must: false,
    metadata: ["count"],
    tables: ["recovery_codes"],
  }),
  "auth.recovery_used": a("A", { must: true, tables: ["recovery_codes"] }),
  "auth.sso_token_issued": a("A", {
    must: true,
    metadata: ["expiresInSeconds"],
    tables: ["temporary_auth_tokens"],
  }),
  "auth.oidc_linked": a("GS", {
    must: true,
    metadata: ["provider", "subjectHash", "emailDomain"],
    tables: ["user_identities"],
  }),
  "auth.oidc_unlinked": a("GS", {
    must: true,
    metadata: ["provider", "subjectHash"],
    tables: ["user_identities"],
  }),
  "auth.oidc_user_provisioned": a("GS", {
    must: true,
    metadata: ["provider", "role", "emailDomain"],
    tables: ["users", "user_identities"],
  }),
  "auth.ws_rejected": a("AP", { metadata: ["route"] }),

  // 4.2 Accounts, roles, teams and policies
  "user.created": a("A", {
    must: true,
    metadata: ["username", "role", "via"],
    tables: ["users"],
  }),
  "user.deleted": a("A", {
    must: true,
    metadata: ["username"],
    tables: ["users", "workspace_users"],
  }),
  "user.updated": a("A", {
    must: true,
    metadata: [...CHANGES, "username"],
    tables: ["users"],
  }),
  "user.suspended": a("A", {
    must: true,
    metadata: ["username"],
    tables: ["users"],
  }),
  "user.unsuspended": a("A", {
    must: true,
    metadata: ["username"],
    tables: ["users"],
  }),
  "user.role_changed": a("A", {
    must: true,
    metadata: ["username", "from", "to"],
    tables: ["users"],
  }),
  "invite.created": a("A", {
    must: true,
    metadata: ["codeHash", "workspaceIds"],
    tables: ["invites"],
  }),
  "invite.claimed": a("A", {
    must: true,
    metadata: ["codeHash", "username"],
    tables: ["invites", "users"],
  }),
  "invite.disabled": a("A", {
    must: true,
    metadata: ["codeHash"],
    tables: ["invites"],
  }),
  "multi_user.enabled": a("A", {
    must: true,
    metadata: ["username"],
    tables: ["users"],
  }),
  "multi_user.enable_failed": a("A", { must: true, metadata: ["step"] }),
  "policy.created": a("AP", {
    must: true,
    metadata: [...CHANGES, "name"],
    tables: ["access_policies"],
  }),
  "policy.updated": a("AP", {
    must: true,
    metadata: [...CHANGES, "name"],
    tables: ["access_policies"],
  }),
  "policy.deleted": a("AP", {
    must: true,
    metadata: ["name"],
    tables: ["access_policies"],
  }),
  "policy.assigned": a("AP", {
    must: true,
    metadata: ["policyId", "userId", "teamId", "from", "to"],
    tables: ["users", "teams"],
  }),
  "team.created": a("AP", {
    must: true,
    metadata: ["name"],
    tables: ["teams"],
  }),
  "team.updated": a("AP", {
    must: true,
    metadata: [...CHANGES, "name"],
    tables: ["teams"],
  }),
  "team.deleted": a("AP", {
    must: true,
    metadata: ["name", "count"],
    tables: ["teams", "team_members"],
  }),
  "team.member_added": a("AP", {
    must: true,
    metadata: ["userId", "role"],
    tables: ["team_members"],
  }),
  "team.member_removed": a("AP", {
    must: true,
    metadata: ["userId"],
    tables: ["team_members"],
  }),
  "team.lead_changed": a("AP", {
    must: true,
    metadata: ["userId", "from", "to"],
    tables: ["team_members"],
  }),
  "role_default.updated": a("AP", {
    must: true,
    metadata: CHANGES,
    tables: ["system_settings"],
  }),
  "access.denied": a("AP", { metadata: ["route", "check", "resource"] }),

  // 4.3 Keys, devices and integrations
  "api_key.created": a("A", {
    must: true,
    metadata: ["keyId", "ownerId", "scope", "workspaceIds", "expiresAt"],
    tables: ["api_keys"],
  }),
  // An owner, workspace scope or expiry change (access-policy branch).
  "api_key.updated": a("AP", {
    must: true,
    metadata: ["keyId", "ownerId", "workspaceIds", "expiresAt"],
    tables: ["api_keys"],
  }),
  "api_key.deleted": a("A", {
    must: true,
    metadata: ["keyId", "ownerId"],
    tables: ["api_keys"],
  }),
  "api_key.used": a("AP", { metadata: ["keyId", "legacy"] }),
  "api_key.expired_rejected": a("AP", { metadata: ["keyId", "check"] }),
  "extension_key.created": a("A", {
    must: true,
    metadata: ["keyId"],
    tables: ["browser_extension_api_keys"],
  }),
  "extension_key.deleted": a("A", {
    must: true,
    metadata: ["keyId", "count"],
    tables: ["browser_extension_api_keys"],
  }),
  "mobile.pairing_started": a("A", { must: true, metadata: ["deviceName"] }),
  "mobile.device_registered": a("A", {
    must: true,
    metadata: ["deviceId", "deviceName", "deviceOs"],
    tables: ["desktop_mobile_devices"],
  }),
  "mobile.device_approved": a("A", {
    must: true,
    metadata: ["deviceId", "approved"],
    tables: ["desktop_mobile_devices"],
  }),
  "mobile.device_revoked": a("A", {
    must: true,
    metadata: ["deviceId"],
    tables: ["desktop_mobile_devices"],
  }),
  "telegram.bot_connected": a("A", { metadata: ["botUsername"] }),
  "telegram.bot_disconnected": a("A", {}),
  "telegram.user_approved": a("A", { metadata: ["telegramUserId"] }),
  "telegram.user_denied": a("A", { metadata: ["telegramUserId"] }),
  "telegram.user_revoked": a("A", { metadata: ["telegramUserId"] }),
  "oauth.connected": a("A", { must: true, metadata: ["provider"] }),
  "oauth.disconnected": a("A", { must: true, metadata: ["provider"] }),
  "connector.token_saved": a("A", { metadata: ["connector"] }),

  // 4.4 Workspaces, chats and documents
  "workspace.created": a("A", {
    must: false,
    metadata: ["workspaceName", "slug"],
    tables: ["workspaces"],
  }),
  "workspace.deleted": a("A", {
    must: true,
    metadata: ["workspaceName", "slug"],
    tables: ["workspaces", "workspace_users"],
  }),
  "workspace.updated": a("A", {
    metadata: [...CHANGES, "slug"],
    tables: ["workspaces"],
  }),
  "workspace.members_changed": a("A", {
    must: true,
    metadata: ["added", "removed", "slug"],
    tables: ["workspace_users"],
  }),
  "chat.sent": a("A", { metadata: [...CHAT, "outcome"] }),
  "chat.viewed_other_user": a("A", {
    must: true,
    metadata: ["viewedUserId", "count", "workspaceSlug", "filter"],
  }),
  "chat.exported": a("A", {
    must: true,
    metadata: ["format", "count", "filter"],
  }),
  "chat.deleted": a("A", {
    must: true,
    metadata: ["count", "workspaceSlug", "threadId"],
    tables: ["workspace_chats"],
  }),
  // A user rewrote the stored text of their own prompt or of the answer.
  // Which side was edited, never the text.
  "chat.edited": a("A", {
    must: true,
    metadata: ["role", "workspaceSlug", "threadId"],
    tables: ["workspace_chats"],
  }),
  "chat.hidden": a("A", {
    must: true,
    metadata: ["count", "workspaceSlug", "threadId"],
    tables: ["workspace_chats"],
  }),
  "chat.bulk_deleted": a("A", {
    must: true,
    metadata: ["count"],
    tables: ["workspace_chats"],
  }),
  "chat.feedback": a("A", { metadata: ["feedback"] }),
  "thread.created": a("A", { metadata: ["threadSlug", "workspaceSlug"] }),
  "thread.deleted": a("A", {
    metadata: ["threadSlug", "workspaceSlug", "count"],
    tables: ["workspace_chats"],
  }),
  "thread.forked": a("A", {
    metadata: ["threadSlug", "workspaceSlug", "fromChatId"],
  }),
  "thread.renamed": a("A", { metadata: ["threadSlug", "workspaceSlug"] }),
  "document.uploaded": a("A", { metadata: [...DOC, "via"] }),
  "document.embedded": a("A", { metadata: [...DOC, "docPaths"] }),
  "document.removed": a("A", { metadata: [...DOC, "docPaths"] }),
  "document.deleted": a("A", { must: true, metadata: [...DOC, "docPaths"] }),
  "document.viewed": a("A", { metadata: ["docName", "workspaceSlug"] }),
  "document.downloaded": a("A", {
    metadata: ["docName", "workspaceSlug", "kind"],
  }),
  "document.pinned": a("A", {
    metadata: ["docName", "workspaceSlug", "pinned"],
  }),
  "document.watched": a("A", {
    metadata: ["docName", "workspaceSlug", "watched"],
  }),
  "workspace.vectors_reset": a("A", {
    must: true,
    metadata: ["workspaceName", "slug", "count", "reason"],
  }),
  "parsed_file.created": a("A", {
    metadata: ["fileId", "fileName", "workspaceSlug"],
  }),
  "parsed_file.deleted": a("A", {
    metadata: ["fileIds", "count", "workspaceSlug"],
  }),
  "parsed_file.embedded": a("A", { metadata: ["fileId", "workspaceSlug"] }),
  "memory.created": a("A", {
    metadata: ["memoryId", "scope", "workspaceId"],
    tables: ["memories"],
  }),
  "memory.updated": a("A", {
    metadata: ["memoryId", "scope"],
    tables: ["memories"],
  }),
  "memory.deleted": a("A", {
    metadata: ["memoryId", "count", "scope"],
    tables: ["memories"],
  }),
  "memory.viewed_other_user": a("A", {
    must: true,
    metadata: ["viewedUserId", "count"],
  }),
  "memory.extracted": a("A", {
    metadata: ["created", "updated", "candidates", "workspaceId"],
    tables: ["memories"],
  }),
  "data.deleted": a("CH", { must: true, metadata: ["stores", "count"] }),
  "retention.purged": a("GR", {
    must: true,
    metadata: ["table", "count", "checkpoint"],
  }),

  // 4.5 Agents, tools and automation
  "agent.session_started": a("A", {
    metadata: ["workspaceSlug", "threadId", "invocationUuid"],
  }),
  "agent.session_ended": a("A", {
    metadata: ["invocationUuid", "durationMs", "reason"],
  }),
  "agent.tool_called": a("A", {
    metadata: ["tool", "durationMs", "invocationUuid"],
  }),
  "agent.tool_approval": a("A", {
    metadata: ["tool", "decision", "invocationUuid"],
  }),
  "agent.tool_refused": a("AP", { metadata: ["tool", "check", "policyId"] }),
  "agent.whitelist_added": a("GR", {
    must: true,
    metadata: ["tool"],
    tables: ["system_settings"],
  }),
  "agent.whitelist_removed": a("GR", { must: true, metadata: ["tool"] }),
  "agent.tool_toggled": a("A", { metadata: ["tool", "enabled"] }),
  "skill.installed": a("A", {
    must: true,
    metadata: ["skill", "kind", "hubId"],
  }),
  "skill.removed": a("A", { must: true, metadata: ["skill", "kind"] }),
  "skill.enabled": a("A", { must: true, metadata: ["skill", "kind"] }),
  "skill.disabled": a("A", { must: true, metadata: ["skill", "kind"] }),
  "skill.configured": a("A", {
    must: true,
    metadata: ["skill", "changedFields"],
  }),
  "flow.created": a("A", { must: true, metadata: ["flowUuid", "name"] }),
  "flow.updated": a("A", {
    must: true,
    metadata: ["flowUuid", "name", "active"],
  }),
  "flow.deleted": a("A", { must: true, metadata: ["flowUuid"] }),
  "mcp.server_added": a("A", { must: true, metadata: ["server", "transport"] }),
  "mcp.server_updated": a("A", {
    must: true,
    metadata: ["server", "changedFields"],
  }),
  "mcp.server_removed": a("A", { must: true, metadata: ["server"] }),
  "mcp.server_started": a("A", { must: true, metadata: ["server"] }),
  "mcp.server_stopped": a("A", { must: true, metadata: ["server"] }),
  "mcp.tool_toggled": a("A", {
    must: true,
    metadata: ["server", "tool", "enabled"],
  }),
  "scheduled_job.created": a("SJ", {
    metadata: ["jobId", "name"],
    tables: ["scheduled_jobs"],
  }),
  "scheduled_job.updated": a("SJ", {
    metadata: ["jobId", ...CHANGES],
    tables: ["scheduled_jobs"],
  }),
  "scheduled_job.deleted": a("SJ", {
    metadata: ["jobId"],
    tables: ["scheduled_jobs"],
  }),
  "scheduled_job.approved": a("SJ", {
    must: true,
    metadata: ["jobId", "tools"],
    tables: ["scheduled_jobs"],
  }),
  "scheduled_job.run": a("SJ", { metadata: ["jobId", "runId", "status"] }),
  "router.created": a("A", { must: true, metadata: ["routerId", "name"] }),
  "router.updated": a("A", { must: true, metadata: ["routerId", ...CHANGES] }),
  "router.deleted": a("A", { must: true, metadata: ["routerId"] }),
  "router.rule_changed": a("A", {
    must: true,
    metadata: ["routerId", "ruleId", "op"],
  }),

  // 4.6 Settings, vendors and the audit trail itself
  "settings.changed": a("A", {
    must: true,
    metadata: ["key", "from", "to", "failedKey", "applied", "source"],
    tables: ["system_settings"],
  }),
  "vendor.changed": a("A", { must: true, metadata: ["kind", "from", "to"] }),
  "vendor.data_sent": a("A", { metadata: ["vendor", "kind", "count", "hour"] }),
  "baa.recorded": a("CH", { must: true, metadata: ["vendor", "expiresAt"] }),
  "baa.expired": a("CH", { must: true, metadata: ["vendor", "expiresAt"] }),
  "feature.toggled": a("A", { must: true, metadata: ["feature", "enabled"] }),
  "hipaa_mode.conflict": a("CH", { metadata: ["checks"] }),
  "hipaa_mode.ok": a("CH", {}),
  "guardrail.triggered": a("GR", { metadata: ["rule", "action"] }),
  "audit.exported": a("A", {
    must: true,
    metadata: ["format", "count", "from", "to"],
  }),
  "audit.viewed": a("A", { metadata: ["filter", "count"] }),
  "audit.verified": a("A", { metadata: ["count", "fromId"] }),
  "audit.chain_broken": a("A", { metadata: ["atId"] }),
  "audit.write_failed": a("A", { metadata: ["action", "count"] }),
  "audit.forward_backlog": a("A", { metadata: ["count", "oldestAgeSeconds"] }),
  "audit.cleared": a("A", { must: true, metadata: ["count"] }),
  "system.boot": a("A", { metadata: ["version", "multiUserMode", "nodeEnv"] }),
  "system.shutdown": a("A", { metadata: ["signal"] }),
  "collector.request": a("A", { metadata: ["route", "count"] }),
  "db.write": a("A", { metadata: ["table", "operation", "count"] }),
  "compliance.checked": a("A", {
    metadata: ["passed", "failed", "notApplicable"],
  }),
  "compliance.evidence_exported": a("A", { must: true, metadata: ["count"] }),

  // 4.7 Embed widget
  "embed.created": a("A", {
    must: true,
    metadata: ["embedUuid", "workspaceSlug"],
  }),
  "embed.updated": a("A", { must: true, metadata: ["embedUuid", ...CHANGES] }),
  "embed.deleted": a("A", { must: true, metadata: ["embedUuid"] }),
  "embed.chat": a("A", {
    metadata: ["embedUuid", "sessionHash", "origin", "messageLength"],
  }),
  "embed.rejected": a("A", { metadata: ["embedUuid", "origin", "check"] }),
  "embed.chats_deleted": a("A", {
    must: true,
    metadata: ["embedUuid", "count"],
  }),

  // Community Hub
  "community_hub.published": a("A", { metadata: ["itemType", "visibility"] }),
  "community_hub.connected": a("A", { metadata: [] }),
};

const ACTOR_TYPES = [
  "user",
  "api_key",
  "system",
  "job",
  "telegram_chat",
  "embed_session",
  "mobile_device",
  "extension_key",
  "oidc",
  "unknown",
];
const CHANNELS = [
  "ui",
  "api",
  "openai",
  "embed",
  "telegram",
  "mobile",
  "extension",
  "ws",
  "job",
  "boot",
  "system",
  "unknown",
];
const OUTCOMES = ["success", "denied", "failed"];

/**
 * @param {string} action
 * @returns {CatalogueEntry|null}
 */
function entryFor(action) {
  return Object.prototype.hasOwnProperty.call(CATALOGUE, action)
    ? CATALOGUE[action]
    : null;
}

module.exports = { CATALOGUE, ACTOR_TYPES, CHANNELS, OUTCOMES, entryFor };
