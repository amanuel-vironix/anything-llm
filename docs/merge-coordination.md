# Merge coordination between the parallel branches

Three branches build on the fork's `master` at the same time. This file is the protocol they
follow so they merge cleanly. It lives on the audit branch; the others keep a pointer to it.

| Branch | Session | Owns |
|---|---|---|
| `claude/access-policies-teams-b1be97` (AP) | Access policies, teams and scoped API keys | access policies, teams, the tool and MCP filter, scoped API keys, their admin UI |
| `claude/google-oidc-signin-856485` (GS) | Google sign-in restricted to vironix.ai | OIDC, `user_identities`, the last-admin guard, the invite claim, recovery, `TemporaryAuthToken`, the login page, the Security settings OIDC section |
| `claude/audit-logging-compliance-403f4f` (AU) | Audit logging and compliance | `server/utils/audit/`, `audit_events`, the event catalogue, coverage tests, log scrubbing |

`claude/state-machine-audit-23070d` has 8 unmerged fixes and is left alone by all three.

## Status of the agreement

- 2026-11-11: AU proposed this protocol to AP and GS by session message. Replies are
  recorded below as they arrive. Until a session agrees, AU treats every file on its list as
  owned by it.

## Rules

1. **The audit writer lands first and is additive.** `server/utils/audit/` (`audit.record`,
   `catalogue.js`, the request-context middleware, the outbox, the database backstop) and the
   `audit_events` table. `EventLogs.logEvent(event, metadata, userId)` keeps its signature and
   becomes a wrapper over `audit.record` (`server/utils/audit/legacy.js` maps each old name),
   so no existing call breaks. Legacy calls never throw; they return `{eventLog: null,
   message}` on failure, as before.
2. **Each feature branch records its own catalogue actions** with `audit.record`, in its own
   files. AU doesn't edit AP or GS files for them. The API:

   ```js
   const { audit } = require("../utils/audit");
   await audit.record(
     { action, outcome /* success|denied|failed */, reason, targetType, targetId,
       workspaceId, teamId, metadata /* allow-listed keys only */ },
     { response /* or ctx */, tx /* optional Prisma transaction client */ }
   );
   // In a route, for must_record actions:
   if (!(await audit.recordOrFail(event, response))) return;
   ```

   Actions and their allowed metadata keys are in `server/utils/audit/catalogue.js`. A
   branch that needs a new action or key adds it there in its own commit (a one-line hunk;
   conflicts there are trivial to resolve).
3. **Action names per branch** (plan sections 4.1–4.5):
   - AP: `policy.created|updated|deleted|assigned`, `team.created|updated|deleted|member_added|member_removed|lead_changed`,
     `role_default.updated`, `access.denied` (outcome `denied`, reason code), `auth.ws_rejected`,
     `api_key.created|deleted` (with `keyId`, `ownerId`, `scope`, `expiresAt`), `api_key.used`,
     `api_key.expired_rejected`, `agent.tool_refused`. AP also sets `response.locals.apiKey`
     (with `id` and the owner's `user_id`) in `validApiKey`, so API rows name the key and its
     owner.
   - GS: `auth.login_succeeded` / `auth.login_failed` (metadata `method`: `password`,
     `simple_sso`, `oidc`; `reason` codes such as `oidc_token_rejected`,
     `oidc_domain_not_allowed`), `auth.oidc_linked|oidc_unlinked|oidc_user_provisioned`,
     `invite.claimed`, `user.created` (`via`), `auth.password_reset`, `auth.recovery_used`,
     `auth.recovery_codes_issued`, `auth.sso_token_issued`, `settings.changed` for OIDC
     settings (secrets masked with `maskSecret` from `server/utils/audit/sanitize.js`).
4. **Prisma.** AU's model `audit_events` sits directly after `event_logs` in
   `schema.prisma`, not at the end, because AP and GS both append at the end. AU's
   migration folder is `20261111180000_audit_events`, later than both feature migrations
   (both use `20261111120000_*`). Whoever merges second rebases and runs
   `npx prisma generate`.
5. **Call-site migration.** AU moves `logEvent` calls to catalogue actions and adds missing
   events only in files no other branch edits. Files AP or GS edit wait until that branch
   is merged into `origin/master`; then AU rebases and does them, or asks the owning session
   to add the calls while it still works on the file.
6. **Shared test helpers.** `server/__tests__/helpers/routeHarness.js`,
   `server/__tests__/helpers/sqliteTestDb.js` and the `jest.config.cjs` change are byte for
   byte the same on all three branches, so they merge without conflict. Change them only
   in a separate commit and tell the other sessions.
7. **`server/index.js`.** AU adds one line after `app.use(cors(...))` to mount the audit
   middleware. GS edits route registration lower down; the hunks don't touch.
8. **Before opening a PR,** each branch rebases on `origin/master`, re-runs
   `npx jest server/__tests__/utils/audit` (the route coverage test fails on any new
   state-changing route without a declaration in `server/utils/audit/routes.js`), and tells
   the other sessions what it changed. A new route needs an entry there: its actions, or an
   exemption with a reason.

## Files waiting on other branches

AU won't edit these until the owning branch merges:

| File | Owner | AU work waiting |
|---|---|---|
| `server/endpoints/admin.js` | AP, GS | F-51 (`system-preferences` logs nothing and always succeeds), `user.created`/`deleted`/`invite.*`/`api_key.*` as direct `audit.record` calls, `workspace.members_changed` |
| `server/models/user.js` | AP, GS | `user.updated` as a direct call with the right actor (the wrapper already fixes the actor, F-55), `auth.password_changed` |
| `server/endpoints/invite.js`, `server/models/invite.js` | GS | `invite.claimed` direct call with code hash |
| `server/endpoints/system.js` (login, recovery, `enable-multi-user`) | GS | `auth.*`, `multi_user.enable_failed`, `auth.recovery_*`, `auth.password_reset`, `auth.sso_token_issued` |
| `server/endpoints/api/admin/index.js` | GS | API user create and update events (F-55) |
| `server/models/systemSettings.js` | GS | `settings.changed` for `system_settings` labels (item 9) |
| `server/utils/middleware/validatedRequest.js` | AP | `session.rejected` |
| `server/utils/middleware/validApiKey.js` | AP | key id in context |
| `server/models/workspace.js` | AP | `workspace.updated` with changed fields, as a direct call |
| `server/endpoints/modelRouter.js`, `server/models/modelRouter*.js` | AP | `router.*` |
| `server/endpoints/mobile/*` | AP | `mobile.*` |
| `server/endpoints/agentWebsocket.js`, `server/utils/agents/*`, `server/utils/chats/agents.js`, `server/utils/chats/stream.js`, `server/utils/MCP/*` | AP | `agent.session_*`, `agent.tool_called`, `agent.tool_approval`, `agent.tool_toggled`, `mcp.server_started/stopped` |

## Replies

(none yet)
