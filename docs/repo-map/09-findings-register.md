# Findings register

Bugs, security gaps and design inconsistencies found while mapping the repo, gathered from
files 01–08 into one list. Each row points to the domain file that has the detail and the
`path:line` evidence. Commit `e82a80da`.

**Severity:**
- **High:** someone can act as another user, or reach data or execution they shouldn't.
- **Medium:** data is lost, kept when it shouldn't be, or left in a wrong state.
- **Low:** a wrong record, wrong telemetry or a small defect.

**Checked:**
- **yes:** the reviewer who assembled this register re-read the cited code and confirmed it.
- **map:** documented by the domain mapping pass and not re-checked independently.

None of these were run or exploited; every finding comes from reading code.

## Identity, credentials and sessions

| ID | Finding | Severity | Evidence | Detail | Checked |
|---|---|---|---|---|---|
| F-01 | Developer API keys have no owner, scope or expiry, and are checked only for existence. Every `/v1` route runs with full admin power, including creating admins, minting a login for any user, and `update-env`. | High | `server/utils/middleware/validApiKey.js:17`, `server/endpoints/api/admin/index.js:135`, `server/endpoints/api/userManagement/index.js:109`, `server/endpoints/api/system/index.js:148` | [01](01-auth-and-users.md), [05](05-external-channels.md) | yes (validApiKey) |
| F-02 | Browser extension key listing returns each owner's full user row, including the bcrypt password hash and push config. | High | `server/models/browserExtensionApiKey.js:124,157`, `server/endpoints/browserExtension.js:165` | [01](01-auth-and-users.md) | yes |
| F-03 | Session JWTs (30 days) can't be revoked. There's no logout endpoint, and password change or reset leaves sessions valid. | High | `server/utils/http/index.js:25` | [01](01-auth-and-users.md), [07](07-frontend-routes-and-flows.md) | yes (makeJWT) |
| F-04 | The agent websocket has no auth middleware: the invocation UUID in the URL is the only credential. | High | `server/endpoints/agentWebsocket.js:28-37` | [04](04-agents-tools-and-automation.md), [07](07-frontend-routes-and-flows.md) | yes |
| F-05 | Mobile devices take the user id of the admin who paired them, so every device acts as an admin in multi-user mode. Device tokens never expire, and mobile chat skips the daily limit. | High | `server/endpoints/mobile/index.js:130`, `server/endpoints/mobile/utils/index.js:180` | [05](05-external-channels.md), [01](01-auth-and-users.md) | yes (pairing) |
| F-06 | API thread chat trusts a caller-supplied `userId`, with no check on membership, suspension, daily limit or thread ownership; the chat is saved under that user. | High | `server/endpoints/api/workspaceThread/index.js:448,634` | [05](05-external-channels.md) | yes |
| F-07 | On an open single-user instance (no password), anyone who can reach it can enable multi-user mode and become admin. Onboarding is marked complete before any password exists. | High | `frontend/src/pages/OnboardingFlow/Steps/LLMPreference/index.jsx:399`; multi-user enable in `server/endpoints/system.js` | [01](01-auth-and-users.md), [07](07-frontend-routes-and-flows.md) | map |
| F-08 | No rate limit or lockout on any login, recovery or token route. | Medium | `server/endpoints/system.js` (`/request-token`), `server/utils/PasswordRecovery` | [01](01-auth-and-users.md) | yes (no limiter in `server/index.js`) |
| F-09 | **Fixed in `169b68a0`** (SMF-13): every write that removes an active admin (demote, suspend, delete, UI and `/v1`) runs inside `User._withActiveAdminGuard`, which counts unsuspended admins in the same transaction. Test: `server/__tests__/models/userLastAdminGuard.test.js`. Was: "At least one admin" is enforced only on demotion. The last admin can be deleted or suspended, and suspended admins still count. | Medium | `server/utils/helpers/admin/index.js:22-38`, `server/endpoints/admin.js:129-160` | [01](01-auth-and-users.md) | yes |
| F-10 | **Partly fixed in `169b68a0`** (SMF-15): a rejected password changes nothing, and the token is consumed with a conditional delete in the same transaction as the password write. Test: `server/__tests__/utils/PasswordRecovery/resetPassword.test.js`. Still open: recovery isn't logged or rate limited (F-08), and works for suspended users. Was: password reset sets `seen_recovery_codes=false` even if the update fails, so the next login issues more codes while the old ones still work. | Medium | `server/utils/PasswordRecovery/index.js:93` | [01](01-auth-and-users.md) | yes |
| F-11 | **Fixed in `169b68a0`**: `/sso/simple` follows `redirectTo` only when it is a same-origin path (`frontend/src/utils/safeRedirect.js`). Test: `frontend/src/utils/safeRedirect.test.mjs`. Was: Simple SSO follows the `redirectTo` query parameter to any URL. | Medium | `frontend/src/pages/Login/SSO/simple.jsx:10,49` | [07](07-frontend-routes-and-flows.md) | yes |
| F-12 | `suspended: "0"` suspends the user (`Number(Boolean("0"))` is 1). | Low | `server/models/user.js` validations | [01](01-auth-and-users.md) | map |
| F-13 | UI route guards read the role from `localStorage`, so the server is the only real check. That is fine as long as every endpoint enforces its role, which it does except F-14. | Low | `frontend/src/components/PrivateRoute/index.jsx:89-90,122-123` | [07](07-frontend-routes-and-flows.md) | map |
| F-14 | Embedded Lemonade model download, cancel and remove are admin-only in the UI but allowed for managers on the server. | Low | `server/utils/AiProviders/embeddedLemonade/endpoints.js:26,35,50,100,110` | [07](07-frontend-routes-and-flows.md) | map |

## Authorization and scoping

| ID | Finding | Severity | Evidence | Detail | Checked |
|---|---|---|---|---|---|
| F-15 | Admins and managers skip workspace membership checks; managers can list, export and hard-delete every chat (all at once with id `-1`), with no event log and regardless of `DISABLE_VIEW_CHAT_HISTORY`. | High | `server/models/workspace.js:295`, `DELETE /system/workspace-chats/:id` in `server/endpoints/system.js` | [02](02-workspaces-and-chat.md), [06](06-admin-system-and-runtime.md) | yes (getWithUser) |
| F-16 | `/v1/admin/workspace-chats` returns every user's chats with no multi-user check, and ignores `DISABLE_VIEW_CHAT_HISTORY`. | Medium | `server/endpoints/api/admin/index.js:715` | [05](05-external-channels.md) | map |
| F-17 | API `reset: true` without a `sessionId` hides default-thread history for every user of the workspace, because an undefined `user_id` drops the filter. | Medium | `server/utils/chats/apiChatHandler.js:160-165` | [05](05-external-channels.md) | map |
| F-18 | System prompt variables are global: the stored `userId` is ignored. The API helper expands every user's slash presets. | Medium | `server/models/systemPromptVariables.js:147-149` | [02](02-workspaces-and-chat.md) | map |
| F-19 | `/img` edit reads any file in the shared generated-images folder by filename. Generated files are authorized per workspace, not per chat owner, and any API key can download them. | Medium | `server/utils/chats/commands/img.js:175-181`, `server/endpoints/agentFileServer.js:173-207` | [02](02-workspaces-and-chat.md), [04](04-agents-tools-and-automation.md), [05](05-external-channels.md) | map |
| F-20 | Telegram identifies a chat, not a person: all approved chats share one history with no user, can create workspaces and can change a workspace's model for every channel. `approve-user` accepts any chat id. | Medium | `server/utils/telegramBot/utils/verification.js:47`, `handleModelSelect.js:42` | [05](05-external-channels.md) | map |
| F-21 | The OpenAI-compatible API lists every workspace as a model. A caller `system` message replaces the workspace prompt, and chats are saved with no user. | Medium | `server/utils/chats/openaiCompatible.js:211` | [05](05-external-channels.md) | map |
| F-22 | The embed allowlist compares only the `Origin` header, which a non-browser client can set to anything. The per-session cap uses a session id the client makes up. | Medium | `server/utils/middleware/embedMiddleware.js` | [05](05-external-channels.md) | map |
| F-23 | Model-router rule update, delete and reorder don't check that the rule belongs to the router in the URL, so the wrong cache is invalidated and stale rules persist (no TTL). | Medium | `server/models/modelRouterRule.js:194,213,229` | [02](02-workspaces-and-chat.md) | map |

## Agents, tools and code execution

| ID | Finding | Severity | Evidence | Detail | Checked |
|---|---|---|---|---|---|
| F-24 | Scheduled jobs auto-approve every tool and run with no user or workspace. | High | `server/jobs/run-scheduled-job.js:77-83` | [04](04-agents-tools-and-automation.md) | yes |
| F-25 | Approval is opt-in per tool. MCP tools, flows, SQL, web, memory store, image generation and Gmail, Outlook and Calendar reads never ask. The SQL agent runs model-written SQL as is; "read-only" is only in the description. | High | `server/utils/agents/aibitat/plugins/sql-agent/query.js:16,81` | [04](04-agents-tools-and-automation.md) | map |
| F-26 | Any API key can register an MCP stdio server, which runs a host command. The child inherits the server's full `process.env`, secrets included, and every running MCP server's tools load for every user. | High | `server/utils/MCP/index.js:320-348`, `server/utils/MCP/hypervisor/index.js:376-413` | [04](04-agents-tools-and-automation.md), [05](05-external-channels.md) | map |
| F-27 | Imported Community Hub skills are `require()`d into the server process with full privileges. | High | `server/utils/agents/imported.js:13-24` | [04](04-agents-tools-and-automation.md) | map |
| F-28 | Any user can add skills to their own approval whitelist; there's no remove endpoint. API and Telegram agents read the single-user list (`userId=null`) even in multi-user mode. | Medium | `server/endpoints/agentSkillWhitelist.js:67`, `server/utils/agents/aibitat/plugins/http-socket.js:133` | [04](04-agents-tools-and-automation.md) | yes (ROLES.all) |
| F-29 | `create-docx-file` and flow `apiCall` steps fetch model-chosen URLs from the server. | Medium | `server/utils/agents/aibitat/plugins/create-files/` | [04](04-agents-tools-and-automation.md) | map |
| F-30 | The Outlook OAuth flow sends no `state` and builds its redirect URI from `X-Forwarded-*` headers. | Medium | `server/endpoints/utils/outlookAgentUtils.js` | [04](04-agents-tools-and-automation.md) | map |
| F-31 | Web search with no provider configured defaults to You.com's keyless tier, then DuckDuckGo. | Low | `server/utils/agents/aibitat/plugins/web-browsing.js:126-130` | [04](04-agents-tools-and-automation.md) | map |

## Ingestion, network and the collector

| ID | Finding | Severity | Evidence | Detail | Checked |
|---|---|---|---|---|---|
| F-32 | `/ext/*` routes forward the browser's body to the collector unchanged, and the collector applies `options.runtimeSettings` from it to a process-wide singleton. A caller can turn on `allowAnyIp` (switching off the SSRF guard) or set Chromium launch flags. | High | `server/endpoints/extensions/index.js:26`, `server/utils/collectorApi/index.js:266`, `collector/middleware/verifyIntegrity.js:9,26`, `collector/utils/url/index.js:28` | [03](03-documents-and-ingestion.md) | yes |
| F-33 | The SSRF guard checks only literal IPv4 hostnames by first octet, allows `127.0.0.1` and `0.0.0.0`, and does no DNS or redirect re-check. Puppeteer runs page JS with `ignoreHTTPSErrors`. | High | `collector/utils/url/index.js` | [03](03-documents-and-ingestion.md) | map |
| F-34 | Every server-to-collector request carries `openAiKey` and the Whisper key in plaintext. Signatures have no nonce, so they can be replayed. The collector listens on all interfaces and skips signature checks when `NODE_ENV=development`. | High | `server/utils/collectorApi/index.js:126-147`, `collector/middleware/verifyIntegrity.js:7` | [03](03-documents-and-ingestion.md) | yes (dev skip) |
| F-35 | Connector tokens, stored encrypted in `chunkSource`, are copied into document JSON, `workspace_documents.metadata`, every vector row and the vector cache. They're hidden from output only for Confluence and GitHub. | Medium | `collector/utils/extensions/*` | [03](03-documents-and-ingestion.md) | map |
| F-36 | No upload size limit; the collector body limit is 3 GB. Files stay in the hotdir if the collector is down or `/parse` rejects them. | Low | `server/utils/files/multer.js:11-25` | [03](03-documents-and-ingestion.md) | map |

## Data lifecycle and deletion

| ID | Finding | Severity | Evidence | Detail | Checked |
|---|---|---|---|---|---|
| F-37 | Deleting a chat, thread or user only hides chats (`include=false`, `user_id=null`), and the text stays. Rows are removed only by an admin hard delete or by deleting the workspace. Admin export includes hidden chats. | Medium | `server/models/user.js:311-319` | [08](08-state-stores.md), [02](02-workspaces-and-chat.md) | yes |
| F-38 | After a user is deleted, their event logs, API keys, invites, profile picture file and whitelist setting row remain. | Medium | [08](08-state-stores.md) lifecycle matrix | [08](08-state-stores.md) | map |
| F-39 | Detaching a document from a workspace leaves its JSON and vector cache on disk. Only a system purge removes them. The vector cache also survives workspace delete. | Medium | [03](03-documents-and-ingestion.md) lifecycle table | [03](03-documents-and-ingestion.md), [08](08-state-stores.md) | map |
| F-40 | Six tables are never pruned: `scheduled_job_runs`, `workspace_agent_invocations`, `invites`, `event_logs`, `password_reset_tokens` and expired `temporary_auth_tokens`. | Low | [08](08-state-stores.md) database catalogue | [08](08-state-stores.md) | map |
| F-41 | Memory extraction marks chats processed even when the run fails, so they're lost for good, and it writes memory contents to the worker log. | Medium | `server/jobs/extract-memories.js` | [04](04-agents-tools-and-automation.md) | map |
| F-42 | Deleting a workspace hard-deletes its chats, which gives back daily-limit quota, unlike every other delete. Forking a thread copies chats with no limit check. | Low | `server/endpoints/workspaces.js:320`, `server/models/user.js:385-390` | [02](02-workspaces-and-chat.md) | map |

## Configuration and runtime

| ID | Finding | Severity | Evidence | Detail | Checked |
|---|---|---|---|---|---|
| F-43 | If enabling multi-user mode fails, the rollback runs `User.delete({})` after ownership migrations. Cascades then delete single-user threads, memories, presets, parsed files, extension keys and devices. | High | `server/endpoints/system.js:715-719` | [01](01-auth-and-users.md), [06](06-admin-system-and-runtime.md) | map |
| F-44 | Toggling live sync starts or stops the whole background service. Off clears every job timer and breaks embedding and Telegram workers until restart. On creates a second scheduler and fails all queued job runs. | High | `server/endpoints/experimental/liveSync.js:46-49`, `server/utils/BackgroundWorkers/index.js:115,156-163,219-221` | [06](06-admin-system-and-runtime.md), [03](03-documents-and-ingestion.md) | map |
| F-45 | `updateENV` applies settings partially. On a validation failure, earlier keys stay applied, their hooks (including vector resets) have run and `.env` is written, but the response is a 200 with an error string. | Medium | `server/utils/helpers/updateENV.js:1543-1573` | [06](06-admin-system-and-runtime.md) | map |
| F-46 | `dumpENV` writes only a fixed key list, dropping hand-added variables, and cuts values at the first quote, `#` or whitespace-class character. | Medium | `server/utils/helpers/updateENV.js:1599-1733` | [06](06-admin-system-and-runtime.md), [08](08-state-stores.md) | map |
| F-47 | Changing the embedder, its model or the vector DB wipes every embedding and namespace without warning, and a vector DB change wipes the previous DB. Saving chunk settings purges the vector cache even when nothing changed. | Medium | `server/utils/vectorStore/resetAllVectorStores.js:19-49`, `server/models/systemSettings.js:127,142` | [06](06-admin-system-and-runtime.md) | map |
| F-48 | `POST /system/custom-models` writes submitted API keys into `process.env` before the user saves, and the next dump persists them. | Medium | `server/utils/helpers/customModels.js` | [06](06-admin-system-and-runtime.md) | map |
| F-49 | `EncryptionManager` writes its own key and salt into the `.env` that holds the secrets it protects. Outlook tokens, SQL connection strings and other keys sit in `system_settings` with no encryption seen, and admins get SQL passwords in clear text. | Medium | `server/utils/EncryptionManager/index.js:28-42`, `server/models/systemSettings.js:1103-1128` | [06](06-admin-system-and-runtime.md), [08](08-state-stores.md) | yes (key write) |
| F-50 | Deleting a model router doesn't clear `workspaces.router_id`, so every chat in those workspaces fails. | Medium | `server/models/modelRouter.js` | [02](02-workspaces-and-chat.md) | map |
| F-51 | `POST /admin/system-preferences` always returns `success:true`, no `system_settings` change is logged, and `protectedFields` is never read. | Low | `server/endpoints/admin.js` | [06](06-admin-system-and-runtime.md) | map |
| F-52 | The SIGINT telemetry flush is attached only as the listen error handler, so it never runs. | Low | `server/utils/boot/index.js:46,80` | [06](06-admin-system-and-runtime.md) | map |
| F-53 | In the native embedding worker, a failed `workspace_documents` insert leaves vectors behind (the in-process path rolls back). Upload-and-embed attaches only the first document of an xlsx or mbox. | Low | [03](03-documents-and-ingestion.md) | [03](03-documents-and-ingestion.md) | map |

## Audit and telemetry accuracy

| ID | Finding | Severity | Evidence | Detail | Checked |
|---|---|---|---|---|---|
| F-54 | Admins can delete the whole event log from the UI. | Medium | `server/endpoints/system.js:1171-1175` | [06](06-admin-system-and-runtime.md) | yes |
| F-55 | `user_updated` is logged against the target, not the actor. `invite_created` stores the invite code in plaintext. API user create and update, and API embed CRUD, write no log. | Low | `server/models/user.js:212` | [01](01-auth-and-users.md), [05](05-external-channels.md) | map |
| F-56 | Multi-user login telemetry sends `multiUserMode:false`, and `workspace_created` fires even on failure. | Low | `server/endpoints/system.js:282` | [01](01-auth-and-users.md), [02](02-workspaces-and-chat.md) | map |
| F-57 | The onboarding survey sends the entered email to `onboarding.anythingllm.com`. | Low | [07](07-frontend-routes-and-flows.md) P-UI-02 | [07](07-frontend-routes-and-flows.md) | map |

## State-machine findings fixed on the Google sign-in branch

`12-state-machines.md` lives on `claude/state-machine-audit-23070d`. Until both branches merge,
these SMF entries are recorded here; mark them fixed in that file at merge time.

| SMF | Fix | Commit | Regression test |
|---|---|---|---|
| SMF-13 | Last-active-admin guard runs in the same transaction as the demote, suspend or delete | `169b68a0` | `server/__tests__/models/userLastAdminGuard.test.js` |
| SMF-14 | Invite claim is a conditional `updateMany where status="pending"` in one transaction with the user insert | `169b68a0` | `server/__tests__/endpoints/inviteClaim.test.js` |
| SMF-15 | Password reset validates first; token consumed by conditional delete in the same transaction as the password write | `169b68a0` | `server/__tests__/utils/PasswordRecovery/resetPassword.test.js` |
| SMF-32 | `TemporaryAuthToken.issue` deletes and creates in one transaction | `169b68a0` | `server/__tests__/models/temporaryAuthTokenIssue.test.js` |
| SMF-01 | `TemporaryAuthToken.validate` consumes the token with a conditional delete; same change as `615056a9` on the audit branch, applied here because Google sign-in made the double swap reachable by any allowed-domain user | `ce57fd6f` | `server/__tests__/models/temporaryAuthTokenIssue.test.js` |
| SMF-13 (follow-up) | The guard's "does this remove an admin" decision is now read inside the transaction, closing a stale-read gap found in review | `ce57fd6f` | `server/__tests__/models/userLastAdminGuard.test.js` ("stale read") |
