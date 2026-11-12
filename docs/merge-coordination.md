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

- 2026-11-11: AU proposed this protocol to AP and GS by session message.
- 2026-11-11: AP and GS both agreed, with the corrections recorded under **Replies** and
  folded into the rules and the table below.
- 2026-11-11: AP confirmed AU keeps its `server/endpoints/workspaces.js` edits; AP's
  final branch leaves that file untouched (team leads edit workspaces through
  `/teams/:teamId/workspaces/:slug/update`). AU's PR A is
  amanuel-vironix/anything-llm#3, GS's is #2.

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
   `schema.prisma`, not at the end, because AP and GS both append at the end. Migration
   order: `20261111120000_access_policies_teams` (AP), `20261111121000_user_identities`
   (GS), `20261111180000_audit_events` (AU). Whoever merges second rebases and runs
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
   state-changing route without a declaration under `server/utils/audit/routes/`), and
   tells the other sessions what it changed. A new route needs an entry there: its
   actions, or an exemption with a reason. Routes in files another branch edits are
   declared in `routes/held.js` as `legacy` (still calling `logEvent`) or `pending` (events
   added after that branch merges); `routes/index.js` lists those files
   (`PENDING_FILES`) and, for the shared `system.js`, the routes (`PENDING_ROUTES`).
9. **Legacy names.** Until the audit writer is on `origin/master`, AP and GS keep calling
   `EventLogs.logEvent`. AU maps their new names in `server/utils/audit/legacy.js`:
   - AP: `api_key_created` (now with `userId`, `workspaceIds`, `expiresAt`), `api_key_updated`
     → `api_key.updated`, `legacy_api_key_refused` → `access.denied` reason `key_scope`,
     `model_router_deleted` → `router.deleted`, `policy_*`, `team_*`, `role_default_updated`,
     `team_workspace_created` → `workspace.created` with `teamId`, `team_workspace_updated`
     and `workspace_team_changed` → `workspace.updated`, `tool_refused_by_policy`,
     `model_refused_by_policy`, `api_key_expired_refused`, `agent_ws_rejected`.
   - GS: `failed_login_oidc` → `auth.login_failed` (method `oidc`, the email's domain only),
     `failed_login_password_disabled` → `auth.login_failed` reason `password_login_disabled`,
     `user_created_oidc` → `auth.oidc_user_provisioned`, `login_event` with `method: "oidc"`,
     `oidc_settings_updated` → `settings.changed`, `password_reset` → `auth.password_reset`.

   Names not in the map are dropped with a warning, so a branch adding a new name tells AU.

## Files waiting on other branches

AU won't edit these until the owning branch merges:

| File | Owner | AU work waiting |
|---|---|---|
| `server/endpoints/admin.js` | AP, GS | F-51 (`system-preferences` logs nothing and always succeeds), `user.created`/`deleted`/`invite.*`/`api_key.*` as direct `audit.record` calls, `workspace.members_changed` |
| `server/models/user.js` | AP, GS | `user.updated` as a direct call with the right actor (the wrapper already fixes the actor, F-55), `auth.password_changed` |
| `server/endpoints/invite.js`, `server/models/invite.js` | GS | `invite.claimed` direct call with code hash |
| `server/endpoints/system.js`: `/request-token`, `/request-token/sso/simple`, `/system/enable-multi-user` | GS | `auth.*`, `multi_user.enable_failed`, `auth.sso_token_issued`. The rest of `system.js` is AU's, except the AP rows below. |
| `server/endpoints/system.js`: API-key, slash-command-preset and prompt-variable routes | AP | `api_key.*`, `settings.changed` for prompt variables |
| `server/endpoints/auth/oidc.js` (new on GS) | GS | declare `POST /admin/oidc-settings` → `settings.changed` and `GET /auth/oidc/callback` → `auth.login_succeeded`/`login_failed`, `auth.oidc_user_provisioned`, `invite.claimed` in `routes/` after GS merges |
| `server/utils/PasswordRecovery/index.js` | GS | `auth.password_reset`, `auth.recovery_used` as direct calls |
| `server/endpoints/api/admin/index.js` | GS | API user create and update events (F-55) |
| `server/endpoints/api/workspace`, `api/workspaceThread`, `api/openai` | AP | `chat.sent`, `workspace.*`, `thread.*` as direct calls; `document.pinned`, `thread.renamed`/`deleted`, image generation |
| `server/models/apiKeys.js` | AP | `api_key.*` as direct calls |
| `server/utils/chats/apiChatHandler.js`, `openaiCompatible.js` | AP | `chat.sent` from the API channels |
| `server/models/slashCommandsPresets.js`, `systemPromptVariables.js` | AP | `settings.changed` for prompt variables |
| `server/endpoints/teams.js` and other new AP endpoint files | AP | declare their routes in `server/utils/audit/routes/` after AP merges |
| `server/models/systemSettings.js` | GS | `settings.changed` for `system_settings` labels (item 9) |
| `server/utils/middleware/validatedRequest.js` | AP | `session.rejected` |
| `server/utils/middleware/validApiKey.js` | AP | key id in context |
| `server/models/workspace.js` | AP | `workspace.updated` with changed fields, as a direct call |
| `server/endpoints/modelRouter.js`, `server/models/modelRouter*.js` | AP | `router.*` |
| `server/endpoints/mobile/*` | AP | `mobile.*` |
| `server/endpoints/agentWebsocket.js`, `server/utils/agents/*`, `server/utils/chats/agents.js`, `server/utils/chats/stream.js`, `server/utils/MCP/*` | AP | `agent.session_*`, `agent.tool_called`, `agent.tool_approval`, `agent.tool_toggled`, `mcp.server_started/stopped` |

## Replies

**AP, 2026-11-11.** Agrees. Corrections, now folded in above:
- `response.locals.apiKey` holds the whole `api_keys` row, `secret` included. The audit
  context copies only `id` and `user_id`; the row never goes in metadata.
- More files (added to the table): the `system.js` API-key and preset/variable routes,
  `api/workspace`, `api/workspaceThread`, `api/openai`, `models/apiKeys.js`,
  `utils/chats/apiChatHandler.js` and `openaiCompatible.js`, `slashCommandsPresets.js`,
  `systemPromptVariables.js`, probably `endpoints/workspaces.js`, and new policy and team
  files.
- Needs `api_key.updated` (added to the catalogue) and the legacy names in rule 9.
- Will send its final list of new state-changing routes when it opens its PR, for AU to
  declare after the merge.

**GS, 2026-11-11.** Agrees. Corrections, now folded in above:
- Its migration is `20261111121000_user_identities`.
- In `system.js` it touches only `/request-token` (the password-off check),
  `/request-token/sso/simple` (now calls `swapTemporaryToken` inside try/catch) and the
  `enable-multi-user` rollback line; AU may edit the rest.
- Routes for AU to declare after its merge: `POST /admin/oidc-settings` and
  `GET /auth/oidc/callback` (a GET that writes).
- Will switch its `logEvent` calls to `audit.record` itself if the writer reaches
  `origin/master` while it still works on those files; otherwise they're AU's.
- `PasswordRecovery` now logs `password_reset` instead of `user_updated` with empty changes.
