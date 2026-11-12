# 05 — External channels (EXT)

Every way into the server other than the main web UI session: the developer API (`/api/v1/*`),
the OpenAI-compatible API (`/api/v1/openai/*`), the public chat embed widget (`/api/embed/*`), the
Telegram bot, the mobile app (`/api/mobile/*`), the browser extension (`/api/browser-extension/*`)
and the web-push subscription path. For each channel this file records who the caller is, how
identity is established, which user an action is attributed to, and which limits apply, then
walks every path. Chat internals (prompt assembly, vector search, model router), agent runs,
document processing and push notification delivery are only touched where a channel hands off;
see section 7.

Sources: `server/index.js`, `server/endpoints/api/**`, `server/swagger/{utils,init}.js`,
`server/utils/middleware/{validApiKey,embedMiddleware,validBrowserExtensionApiKey,chatHistoryViewable,multiUserProtected}.js`,
`server/utils/chats/{apiChatHandler,openaiCompatible,embed,index}.js`, `server/endpoints/{embed/index,embedManagement,telegram,browserExtension,webPush}.js`,
`server/endpoints/mobile/**`, `server/utils/telegramBot/**`, `server/jobs/handle-telegram-chat.js`,
`server/models/{apiKeys,embedConfig,embedChats,mobileDevice,browserExtensionApiKey,externalCommunicationConnector,workspaceChats}.js`,
`server/utils/PushNotifications/index.js`, `server/prisma/schema.prisma`, `frontend/public/embed/anythingllm-chat-widget.min.js` (built widget).
The `embed/` and `browser-extension/` folders are git submodules (`.gitmodules`) and are **not
checked out** in this worktree; the widget was read from its built bundle, the extension not at all.

## 2. Mental model

**Actors.** Six kinds of external caller, each with its own credential:

| Channel | Credential | Store |
|---|---|---|
| `api`, `openai` | Developer API key, `Authorization: Bearer <secret>` | `api_keys` (`server/prisma/schema.prisma:18`) |
| `embed` | None. Public embed UUID in the URL + browser `Origin` header + client-made session UUID | `embed_configs`, `embed_chats` (`schema.prisma:235`, `:256`) |
| `telegram` | Telegram `chat.id` present in the connector's `approved_users` list | `external_communication_connectors.config` JSON (`schema.prisma:394`) |
| `mobile` | Device token header `x-anythingllm-mobile-device-token`, minted after a one-time pairing token | `desktop_mobile_devices` (`schema.prisma:364`), in-memory temp-token map (`server/models/mobileDevice.js:19`) |
| `extension` | `brx-` prefixed key, `Authorization: Bearer` | `browser_extension_api_keys` (`server/models/browserExtensionApiKey.js:10-13`) |
| `ui` (web push) | Normal UI session JWT (`validatedRequest`) | `users.web_push_subscription_config` or `storage/push-notifications/primary-subscription.json` |

**Pattern.** Each channel is an *adapter* in front of the same core: almost all chat traffic ends
in `ApiChatHandler` (`api`, `mobile`), `OpenAICompatibleChat` (`openai`), `streamChatWithForEmbed`
(`embed`) or the Telegram `streamResponse` in a forked worker (`telegram`). The adapters differ
mainly in how they resolve the acting user, which is the main risk surface.

**Invariants the code relies on.**
- A developer API key is instance-wide and carries no user: `validApiKey` only checks the key
  exists (`server/utils/middleware/validApiKey.js:17`) and never puts the key or its `createdBy`
  on `response.locals`. Every `/v1` route therefore acts as a super-admin.
- API-session chats (`api_session_id != null`) are hidden from the UI and thread history
  (`server/models/workspaceChats.js:46`, `:96`; `server/endpoints/api/workspaceThread/index.js:314`).
- Embed chats live in their own table (`embed_chats`) and never reach `workspace_chats`.
- The Telegram connector only exists in single-user mode; management routes use `isSingleUserMode`
  (`server/endpoints/telegram.js:19`) and the bot deletes itself if multi-user mode is detected
  (`server/utils/telegramBot/index.js:419-429`).
- A mobile device is usable only when `approved = true`, and its user (if any) must not be
  suspended (`server/endpoints/mobile/middleware/index.js:24-33`).

### Trust model comparison

| Channel | Caller | Identity established by | Action attributed to (`user_id` on writes) | Workspace scoping | Limits applied | Checks the UI applies that this channel skips |
|---|---|---|---|---|---|---|
| `api` (`/v1/*`) | Any holder of an API key (server-to-server) | Key exists in `api_keys` (`validApiKey.js:17`) | `null` for workspace chat (`api/workspace/index.js:704`); **caller-supplied `userId`** for thread chat (`api/workspaceThread/index.js:448`, `:634`) and thread create (`:74`) | None: any slug resolves (`Workspace.get({slug})`) | None besides key; no rate or quota limit | Role checks (`flexUserRoleValid`), workspace membership, `User.canSendChat` daily quota (`server/endpoints/chat.js:53`), suspension (`validatedRequest.js:101`), `chatHistoryViewable` on embed chats, multi-user check on `/v1/admin/workspace-chats` |
| `openai` (`/v1/openai/*`) | API key holder using an OpenAI SDK | Same `validApiKey` | `null` (no user passed: `api/openai/index.js:138-145`; save at `server/utils/chats/openaiCompatible.js:243-252`) | Workspace slug passed as `model` (`api/openai/index.js:115`) | None | Same as `api`; also the caller's `system` message replaces the workspace prompt (`openaiCompatible.js:211`) and no agent path exists |
| `embed` | Anonymous website visitor | Embed UUID (`embedMiddleware.js:12`) + `Origin` in allowlist (`:67-97`) + valid UUID `sessionId` (`:122`) | No user; `embed_chats.connection_information` holds Origin, IP and a self-declared `username` (`server/utils/chats/embed.js:236-241`) | Fixed to the embed's workspace | `enabled` (`embedMiddleware.js:53`), `max_chats_per_day` per embed (`:148-172`), `max_chats_per_session` per session (`:174-198`), 1 MB body (`server/index.js:70-74`), `message_limit` history window (`embed.js:37`) | Not a user path at all. `Origin` is only enforced by browsers; non-browser clients can send any value. Session limit keys on a client-chosen UUID |
| `telegram` | Anyone who messages the bot | `msg.chat.id` in `approved_users` (`server/utils/telegramBot/utils/verification.js:47-51`) | `null` (`server/utils/telegramBot/chat/stream.js:329-340`, agent `userId: null` at `chat/agent.js:234`) | Any workspace: `/switch` lists all (`commands/handlers/showWorkspaceMenu.js:13`); can create workspaces (`callbacks/handleWorkspaceCreate.js:13`) and change a workspace's model (`callbacks/handleModelSelect.js:42`) | Single-user mode only; one queue per chat (`telegramBot/index.js:690`); max 10 pending pairings (`verification.js:12`) | Everything role-based (mode is single-user, so there are no roles). All approved chats share one history per workspace/thread (no per-chat attribution) |
| `mobile` | Paired phone app | Approved device token (`mobile/middleware/index.js:14-36`) | Device's `userId` (set at registration from the pairing admin, `mobile/index.js:130`); `null` in single-user mode | `Workspace.getWithUser` when a user exists (`mobile/utils/index.js:51-53`), else any workspace | Device approval, user suspension | `User.canSendChat` daily quota is **not** called before `stream-chat` (`mobile/utils/index.js:180`) |
| `extension` | Browser extension | `brx-` key (`validBrowserExtensionApiKey.js:21`); in multi-user mode its owner must exist, not be suspended and be admin or manager (`:29-52`) | Key owner (`browserExtension.js:111`) | `Workspace.getWithUser` in multi-user (`browserExtension.js:88-90`); admins and managers see all (`server/models/workspace.js:421`) | Role gate on the key owner | None found; checks mirror the UI's document upload role (admin/manager) |
| `ui` web push | Logged-in UI user | Session JWT (`validatedRequest`) | Session user, or `"primary"` in single-user mode (`server/utils/PushNotifications/index.js:147`) | n/a | None | n/a |

## 3. Entry points

All routes below are mounted on `apiRouter` under `/api` (`server/index.js:98`). CORS reflects any
origin (`server/index.js:67`). Developer API routes are registered by `developerEndpoints`
(`server/endpoints/api/index.js:15-29`, called at `server/index.js:115`).

| ID | Channel | Method + path / event / job | Middleware chain | Handler (path:line) | Who can call |
|---|---|---|---|---|---|
| E-EXT-01 | api | GET `/api/docs` | none (unless `DISABLE_SWAGGER_DOCS=true`) | `server/swagger/utils.js:11-55` | Anyone |
| E-EXT-02 | api | GET `/v1/auth` | validApiKey | `server/endpoints/api/auth/index.js:6` | API key |
| E-EXT-03 | api | GET `/v1/admin/is-multi-user-mode` | validApiKey | `server/endpoints/api/admin/index.js:15` | API key |
| E-EXT-04 | api | GET `/v1/admin/users` | validApiKey | `api/admin/index.js:41` | API key, multi-user only |
| E-EXT-05 | api | POST `/v1/admin/users/new` | validApiKey | `api/admin/index.js:85` | API key, multi-user only |
| E-EXT-06 | api | POST `/v1/admin/users/:id` | validApiKey | `api/admin/index.js:143` | API key, multi-user only |
| E-EXT-07 | api | DELETE `/v1/admin/users/:id` | validApiKey | `api/admin/index.js:215` | API key, multi-user only |
| E-EXT-08 | api | GET `/v1/admin/invites` | validApiKey | `api/admin/index.js:270` | API key, multi-user only |
| E-EXT-09 | api | POST `/v1/admin/invite/new` | validApiKey | `api/admin/index.js:316` | API key, multi-user only |
| E-EXT-10 | api | DELETE `/v1/admin/invite/:id` | validApiKey | `api/admin/index.js:374` | API key, multi-user only |
| E-EXT-11 | api | GET `/v1/admin/workspaces/:workspaceId/users` | validApiKey | `api/admin/index.js:441` | API key, multi-user only |
| E-EXT-12 | api | POST `/v1/admin/workspaces/:workspaceId/update-users` | validApiKey | `api/admin/index.js:496` | API key, multi-user only |
| E-EXT-13 | api | POST `/v1/admin/workspaces/:workspaceSlug/manage-users` | validApiKey | `api/admin/index.js:563` | API key, multi-user only |
| E-EXT-14 | api | POST `/v1/admin/workspace-chats` | validApiKey | `api/admin/index.js:678` | API key, **any mode** |
| E-EXT-15 | api | POST `/v1/admin/preferences` | validApiKey | `api/admin/index.js:734` | API key, multi-user only |
| E-EXT-16 | api | GET `/v1/system/env-dump` | **none** | `server/endpoints/api/system/index.js:18` | Anyone |
| E-EXT-17 | api | GET `/v1/system` | validApiKey | `api/system/index.js:39` | API key |
| E-EXT-18 | api | GET `/v1/system/vector-count` | validApiKey | `api/system/index.js:76` | API key |
| E-EXT-19 | api | POST `/v1/system/update-env` | validApiKey | `api/system/index.js:108` | API key |
| E-EXT-20 | api | GET `/v1/system/export-chats` | validApiKey | `api/system/index.js:157` | API key |
| E-EXT-21 | api | DELETE `/v1/system/remove-documents` | validApiKey | `api/system/index.js:219` | API key |
| E-EXT-22 | api | GET `/v1/users` | validApiKey | `server/endpoints/api/userManagement/index.js:12` | API key, multi-user only |
| E-EXT-23 | api | GET `/v1/users/:id/issue-auth-token` | validApiKey, simpleSSOEnabled | `api/userManagement/index.js:67` | API key, Simple SSO enabled |
| E-EXT-24 | api | POST `/v1/workspace/new` | validApiKey | `server/endpoints/api/workspace/index.js:28` | API key |
| E-EXT-25 | api | GET `/v1/workspaces` | validApiKey | `api/workspace/index.js:109` | API key |
| E-EXT-26 | api | GET `/v1/workspace/:slug` | validApiKey | `api/workspace/index.js:163` | API key |
| E-EXT-27 | api | DELETE `/v1/workspace/:slug` | validApiKey, workspaceDeletionProtection | `api/workspace/index.js:228` | API key |
| E-EXT-28 | api | POST `/v1/workspace/:slug/update` | validApiKey | `api/workspace/index.js:279` | API key |
| E-EXT-29 | api | GET `/v1/workspace/:slug/chats` | validApiKey | `api/workspace/index.js:360` | API key |
| E-EXT-30 | api | POST `/v1/workspace/:slug/update-embeddings` | validApiKey | `api/workspace/index.js:457` | API key |
| E-EXT-31 | api | POST `/v1/workspace/:slug/update-pin` | validApiKey | `api/workspace/index.js:534` | API key |
| E-EXT-32 | api | POST `/v1/workspace/:slug/chat` | validApiKey | `api/workspace/index.js:603` | API key |
| E-EXT-33 | api | POST `/v1/workspace/:slug/stream-chat` | validApiKey | `api/workspace/index.js:737` | API key |
| E-EXT-34 | api | POST `/v1/workspace/:slug/vector-search` | validApiKey | `api/workspace/index.js:899` | API key |
| E-EXT-35 | api | POST `/v1/workspace/:slug/thread/new` | validApiKey | `server/endpoints/api/workspaceThread/index.js:21` | API key |
| E-EXT-36 | api | POST `/v1/workspace/:slug/thread/:threadSlug/update` | validApiKey | `api/workspaceThread/index.js:111` | API key |
| E-EXT-37 | api | DELETE `/v1/workspace/:slug/thread/:threadSlug` | validApiKey | `api/workspaceThread/index.js:196` | API key |
| E-EXT-38 | api | GET `/v1/workspace/:slug/thread/:threadSlug/chats` | validApiKey | `api/workspaceThread/index.js:245` | API key |
| E-EXT-39 | api | POST `/v1/workspace/:slug/thread/:threadSlug/chat` | validApiKey | `api/workspaceThread/index.js:329` | API key |
| E-EXT-40 | api | POST `/v1/workspace/:slug/thread/:threadSlug/stream-chat` | validApiKey | `api/workspaceThread/index.js:492` | API key |
| E-EXT-41 | api | POST `/v1/document/upload` | validApiKey, handleAPIFileUpload, validateWorkspaceSlugQuery | `server/endpoints/api/document/index.js:52` | API key |
| E-EXT-42 | api | POST `/v1/document/upload/:folderName` | same | `api/document/index.js:183` | API key |
| E-EXT-43 | api | POST `/v1/document/upload-link` | validApiKey, validateWorkspaceSlugQuery | `api/document/index.js:338` | API key |
| E-EXT-44 | api | POST `/v1/document/raw-text` | validApiKey, validateWorkspaceSlugQuery | `api/document/index.js:520` | API key |
| E-EXT-45 | api | GET `/v1/documents` | validApiKey | `api/document/index.js:669` | API key |
| E-EXT-46 | api | GET `/v1/documents/folder/:folderName` | validApiKey | `api/document/index.js:725` | API key |
| E-EXT-47 | api | GET `/v1/document/accepted-file-types` | validApiKey | `api/document/index.js:810` | API key |
| E-EXT-48 | api | GET `/v1/document/metadata-schema` | validApiKey | `api/document/index.js:867` | API key |
| E-EXT-49 | api | GET `/v1/document/:docName` | validApiKey | `api/document/index.js:919` | API key |
| E-EXT-50 | api | POST `/v1/document/create-folder` | validApiKey | `api/document/index.js:974` | API key |
| E-EXT-51 | api | DELETE `/v1/document/remove-folder` | validApiKey | `api/document/index.js:1048` | API key |
| E-EXT-52 | api | POST `/v1/document/move-files` | validApiKey | `api/document/index.js:1107` | API key |
| E-EXT-53 | api | GET `/v1/document/generated-files/:filename` | validApiKey | `api/document/index.js:1219` | API key |
| E-EXT-54 | api | GET `/v1/embed` | validApiKey | `server/endpoints/api/embed/index.js:10` | API key |
| E-EXT-55 | api | GET `/v1/embed/:embedUuid/chats` | validApiKey | `api/embed/index.js:78` | API key |
| E-EXT-56 | api | GET `/v1/embed/:embedUuid/chats/:sessionUuid` | validApiKey | `api/embed/index.js:140` | API key |
| E-EXT-57 | api | POST `/v1/embed/new` | validApiKey | `api/embed/index.js:201` | API key |
| E-EXT-58 | api | POST `/v1/embed/:embedUuid` | validApiKey | `api/embed/index.js:287` | API key |
| E-EXT-59 | api | DELETE `/v1/embed/:embedUuid` | validApiKey | `api/embed/index.js:357` | API key |
| E-EXT-60 | api | GET `/v1/mcp-servers` | validApiKey | `server/endpoints/api/mcpServers/index.js:8` | API key |
| E-EXT-61 | api | POST `/v1/mcp-servers/new` | validApiKey | `api/mcpServers/index.js:48` | API key |
| E-EXT-62 | api | POST `/v1/mcp-servers/reload` | validApiKey | `api/mcpServers/index.js:108` | API key |
| E-EXT-63 | api | POST `/v1/mcp-servers/:name/update` | validApiKey | `api/mcpServers/index.js:138` | API key |
| E-EXT-64 | api | POST `/v1/mcp-servers/:name/toggle` | validApiKey | `api/mcpServers/index.js:208` | API key |
| E-EXT-65 | api | POST `/v1/mcp-servers/:name/toggle-tool` | validApiKey | `api/mcpServers/index.js:251` | API key |
| E-EXT-66 | api | DELETE `/v1/mcp-servers/:name` | validApiKey | `api/mcpServers/index.js:321` | API key |
| E-EXT-67 | openai | GET `/v1/openai/models` | validApiKey | `server/endpoints/api/openai/index.js:19` | API key |
| E-EXT-68 | openai | POST `/v1/openai/chat/completions` | validApiKey | `api/openai/index.js:76` | API key |
| E-EXT-69 | openai | POST `/v1/openai/images/generations` | validApiKey, handleImageGenUpload | `api/openai/index.js:195` | API key |
| E-EXT-70 | openai | POST `/v1/openai/embeddings` | validApiKey | `api/openai/index.js:290` | API key |
| E-EXT-71 | openai | GET `/v1/openai/vector_stores` | validApiKey | `api/openai/index.js:357` | API key |
| E-EXT-72 | embed | POST `/embed/:embedId/stream-chat` | (1 MB body parser) validEmbedConfig, setConnectionMeta, canRespond | `server/endpoints/embed/index.js:20` | Anyone with the UUID, from an allowed Origin |
| E-EXT-73 | embed | GET `/embed/:embedId/:sessionId` | validEmbedConfig, canAccessHistory | `embed/index.js:70` | Same |
| E-EXT-74 | embed | DELETE `/embed/:embedId/:sessionId` | validEmbedConfig, canAccessHistory | `embed/index.js:93` | Same |
| E-EXT-75 | ui | GET `/embeds`, POST `/embeds/new`, POST `/embed/update/:embedId`, DELETE `/embed/:embedId` | validatedRequest, flexUserRoleValid([admin]) (+validEmbedConfigId) | `server/endpoints/embedManagement.js:18`, `:34`, `:55`, `:73` | Admin (or anyone in single-user) |
| E-EXT-76 | ui | POST `/embed/chats`, DELETE `/embed/chats/:chatId` | (chatHistoryViewable) validatedRequest, flexUserRoleValid([admin]) | `embedManagement.js:93`, `:117` | Admin |
| E-EXT-77 | ui | GET `/telegram/config`, `/telegram/status`, `/telegram/pending-users`, `/telegram/approved-users` | validatedRequest, isSingleUserMode | `server/endpoints/telegram.js:17`, `:178`, `:196`, `:212` | Single-user owner |
| E-EXT-78 | ui | POST `/telegram/connect`, `/telegram/disconnect`, `/telegram/update-config` | validatedRequest, isSingleUserMode | `telegram.js:75`, `:161`, `:293` | Single-user owner |
| E-EXT-79 | ui | POST `/telegram/approve-user`, `/telegram/deny-user`, `/telegram/revoke-user` | validatedRequest, isSingleUserMode | `telegram.js:227`, `:249`, `:271` | Single-user owner |
| E-EXT-80 | telegram | Bot `message` / `onText(/cmd)` / `callback_query` events (long polling) | `guard` (`isVerified`, `#assertSingleUserMode`) / `isVerified` for callbacks | `server/utils/telegramBot/index.js:440-490`; `utils/navigation/index.js:10-32` | Approved Telegram chats |
| E-EXT-81 | job | `handle-telegram-chat` Bree worker | IPC message from parent | `server/jobs/handle-telegram-chat.js:10` | Spawned by bot service |
| E-EXT-82 | boot | `TelegramBotService.bootIfActive()` | n/a | `telegramBot/index.js:813`; called from `server/utils/boot/index.js:43`, `:77` | Server start |
| E-EXT-83 | ui | GET `/mobile/devices`, POST `/mobile/update/:id`, DELETE `/mobile/:id`, GET `/mobile/connect-info` | validatedRequest, flexUserRoleValid([admin]) | `server/endpoints/mobile/index.js:19`, `:40`, `:65`, `:84` | Admin |
| E-EXT-84 | mobile | POST `/mobile/register` | validRegistrationToken | `mobile/index.js:121` | Holder of a fresh pairing token |
| E-EXT-85 | mobile | GET `/mobile/auth` | validDeviceToken | `mobile/index.js:103` | Approved device |
| E-EXT-86 | mobile | POST `/mobile/send/:command` (`workspaces`, `workspace-content`, `model-tag`, `reset-chat`, `new-thread`, `stream-chat`, `unregister-device`) | validDeviceToken | `mobile/index.js:146` → `server/endpoints/mobile/utils/index.js:17` | Approved device |
| E-EXT-87 | ui | GET `/browser-extension/api-keys`, POST `/browser-extension/api-keys/new`, DELETE `/browser-extension/api-keys/:id` | validatedRequest, flexUserRoleValid([admin, manager]) | `server/endpoints/browserExtension.js:155`, `:175`, `:195` | Admin, manager |
| E-EXT-88 | extension | GET `/browser-extension/check`, GET `/browser-extension/workspaces`, DELETE `/browser-extension/disconnect` | validBrowserExtensionApiKey | `browserExtension.js:19`, `:63`, `:44` | Extension key |
| E-EXT-89 | extension | POST `/browser-extension/embed-content`, POST `/browser-extension/upload-content` | validBrowserExtensionApiKey | `browserExtension.js:81`, `:128` | Extension key |
| E-EXT-90 | ui | POST `/web-push/subscribe`, GET `/web-push/pubkey` | validatedRequest | `server/endpoints/webPush.js:8`, `:21` | Any logged-in user |

## 4. User paths

### Developer API (`api`)

#### P-EXT-01 API key authentication and `/v1/auth`
- **Actor and preconditions:** any caller with a developer API key. Keys are issued in the UI by
  admins in multi-user mode (`server/endpoints/admin.js:523-530`, `strictMultiUserRoleValid([admin])`)
  or by the owner in single-user mode (`server/endpoints/system.js:1065-1074`, `createdBy = null`).
- **Steps:** request → `validApiKey` (`server/utils/middleware/validApiKey.js:4`) sets
  `response.locals.multiUserMode` (`:5-6`), splits the `Authorization` header on a space and takes
  the second part (`:8-9`), 403 when missing (`:10-15`), `ApiKey.get({ secret })` (`:17`,
  `server/models/apiKeys.js:31-39`), 403 when not found, then `next()`. `/v1/auth` returns
  `{ authenticated: true }` (`api/auth/index.js:29`).
- **Reads:** `api_keys`, `system_settings` (multi-user flag).
- **State changes:** none. `api_keys.lastUpdatedAt` is not touched.
- **Side effects:** none.
- **Failure and edge paths:** a DB error inside `ApiKey.get` returns `null` and becomes 403
  (`apiKeys.js:36-38`).
- **Notes:** the key is not bound to a user, role or workspace and is not attached to the request,
  so no downstream handler can attribute or restrict by key. No `lastUsed` audit, no expiry, no
  rate limit. The swagger security scheme labels it a JWT (`server/swagger/init.js:15-21`); it is a
  `uuid-apikey` string (`apiKeys.js:7-10`).

#### P-EXT-02 Swagger docs
- **Actor and preconditions:** anyone; docs on unless `DISABLE_SWAGGER_DOCS === "true"`
  (`server/swagger/utils.js:12-17`).
- **Steps:** `useSwagger(app)` is called from `developerEndpoints` (`server/endpoints/api/index.js:17`),
  mounts `swaggerUi.serve` at `/api/docs` (`utils.js:18`). Production serves the committed
  `server/swagger/openapi.json` once (`:28-37`); development re-requires it per request (`:39-51`).
  The spec is generated offline by `server/swagger/init.js` from the ten files at `init.js:31-42`.
- **Reads:** `server/swagger/openapi.json`, CSS/JS in `server/swagger/`.
- **State changes / side effects:** none at runtime.
- **Notes:** the docs are public; they list every route but expose no data. Routes must carry
  `#swagger` JSDoc (`server/endpoints/api/index.js:13-15`) or they are missing from the spec.

#### P-EXT-03 Admin user CRUD via API
- **Actor and preconditions:** API key; multi-user mode, otherwise 401 (`api/admin/index.js:72`,
  `:129`, `:190`, `:251`). `is-multi-user-mode` works in any mode (`:37-38`).
- **Steps:** list → `User.where()` (`:77`); create → `User.create(reqBody)` (`:134-136`); update →
  `User.get` (`:197`), `canModifyAdmin(user, updates)` (`:198`, `server/utils/helpers/admin/index.js:22`),
  `User.update(id, updates)` (`:207`); delete → `User.get` (`:257`), `User.delete` (`:258`),
  `EventLogs.logEvent("api_user_deleted")` (`:259`).
- **Reads:** `users`, `system_settings`.
- **State changes:** `users` row created / fields updated / row deleted.
- **Side effects:** `DB` users; `LOG` on delete only.
- **Failure and edge paths:** delete of an unknown id throws on `user.id` of `null` and returns 500
  (`:257-258`). Update failure returns 200 with `success: false` (`:201-203`).
- **Notes:** delete has no `canModifyAdmin` check, so the API can delete the last admin (UI delete
  guard not compared here, **(unverified)**). Create and update log nothing.

#### P-EXT-04 Admin invites via API
- **Actor and preconditions:** API key, multi-user mode.
- **Steps:** list → `Invite.whereWithUsers()` (`api/admin/index.js:308`); create →
  `Invite.create({ workspaceIds })` (`:364-366`); delete → `Number(id)` guard (`:416-421`),
  `Invite.deactivate` (`:424`), 404 if not found (`:425-431`).
- **State changes:** `invites` row created; `invites.status → disabled` **(unverified field name)**.
- **Side effects:** `DB` invites.
- **Notes:** `createdBy` is not set on API-created invites (no user available).

#### P-EXT-05 Admin workspace membership via API
- **Actor and preconditions:** API key, multi-user mode.
- **Steps:** `GET …/:workspaceId/users` → `Workspace.workspaceUsers` (`api/admin/index.js:486`);
  `update-users` → `Workspace.updateUsers(workspaceId, userIds)` (`:551`) (replace set);
  `manage-users` → filters `userIds` to existing users (`:622-624`), resolves workspace by slug
  (`:625`), `reset` replaces the set (`:647-657`), else adds missing users via
  `WorkspaceUser.createManyUsers` (`:659-665`).
- **State changes:** `workspace_users` rows deleted and/or created.
- **Side effects:** `DB` workspace_users. No `LOG`.
- **Failure and edge paths:** `manage-users` with `userIds` missing throws on `_uids.map` → 500
  (`:621-623`); empty valid list → 404 (`:637-643`).

#### P-EXT-06 Admin workspace-chats and preferences via API
- **Actor and preconditions:** API key. `workspace-chats` has **no multi-user check** (`api/admin/index.js:715-731`);
  `preferences` requires multi-user (`:775`).
- **Steps:** `workspace-chats` → 20 per page, `WorkspaceChats.whereWithData({}, 20, offset*20)`
  (`:716-723`); `preferences` → `SystemSettings.updateSettings(reqBody)` (`:780-781`).
- **Reads:** all `workspace_chats` across all users and workspaces, including API sessions.
- **State changes:** `system_settings` rows upserted.
- **Side effects:** `DB` system_settings.
- **Notes:** `workspace-chats` ignores `DISABLE_VIEW_CHAT_HISTORY` (`chatHistoryViewable` is not in
  its chain), unlike the UI and embed-management chat views.

#### P-EXT-07 System settings and env via API
- **Actor and preconditions:** API key, except `env-dump` which is unauthenticated.
- **Steps:** `GET /v1/system` → `SystemSettings.currentSettings()` (`api/system/index.js:68`);
  `vector-count` → `VectorDb.totalVectors()` (`:99-100`); `update-env` → `updateENV(body)`
  (`:147-148`) with no `userId` and no `force`, so `server/utils/helpers/updateENV.js:1519-1573`
  filters to `KEY_MAPPING` keys, runs validators and pre/post hooks, logs provider changes with
  `userId = null` (`updateENV.js:1572`, `:1585-1596`) and `dumpENV()` in production (`:1573`);
  `env-dump` → `dumpENV()` in production only (`api/system/index.js:29-31`).
- **Reads:** `system_settings`, `process.env`, vector DB.
- **State changes:** `process.env.*` changed; `.env` rewritten (production).
- **Side effects:** `ENV`; `LOG` (`update_llm_provider` etc.); `NET:vector-db` for count.
- **Notes:** the UI route for the same action requires admin (`server/endpoints/system.js:601-602`);
  the API has no role concept. `env-dump` is intentionally open (comment at `api/system/index.js:16-17`).

#### P-EXT-08 Chat export and document purge via API
- **Steps:** `export-chats` validates `type` (`api/system/index.js:196-202`),
  `exportChatsAsType(type, "workspace")` (`:204-207`), `EventLogs.logEvent("exported_chats")`
  (`:208`); `remove-documents` → `purgeDocument(name)` for each name (`:273-274`).
- **Reads:** all `workspace_chats`.
- **State changes:** `remove-documents` deletes document files, `workspace_documents` rows and
  vectors (via `purgeDocument`, see DOC file).
- **Side effects:** `LOG`; `FS` storage/documents; `VEC`; `DB` workspace_documents.
- **Failure and edge paths:** `names` not iterable → 500; a failure part-way leaves earlier names
  purged (sequential loop, no transaction).

#### P-EXT-09 User listing and Simple SSO token issue via API
- **Actor and preconditions:** `/v1/users` multi-user only (`api/userManagement/index.js:49-52`);
  `issue-auth-token` needs Simple SSO enabled (`simpleSSOEnabled`, `:69`).
- **Steps:** list returns `{id, username, role}` only (`:55-59`); issue → `User.get` (`:105`),
  `TemporaryAuthToken.issue(userId)` (`:109`), returns `loginPath: /sso/simple?token=…` (`:112-115`).
- **State changes:** `temporary_auth_tokens` row created **(unverified table name)**.
- **Side effects:** `DB`.
- **Notes:** an API key can mint a login for any user including admins; this is the designed SSO
  bridge. No `LOG` row.

#### P-EXT-10 Workspace CRUD via API
- **Steps:** create → `Workspace.new(name, null, additionalFields)` (`api/workspace/index.js:79-84`),
  `Telemetry.sendTelemetry("workspace_created")` (`:91`), `EventLogs.logEvent("api_workspace_created")` (`:99`);
  list → all workspaces with thread `user_id/slug/name` (`:144-155`); get → workspace with
  documents and threads (`:206-219`); update → `Workspace.update(id, data)` (`:345`), which filters
  to valid fields (`server/models/workspace.js:247-252`); delete (after `workspaceDeletionProtection`,
  `:230`) → `WorkspaceChats.delete`, `DocumentVectors.deleteForWorkspace`, `Document.delete`,
  `Workspace.delete` (`:258-261`), `LOG` (`:263`), `VectorDb["delete-namespace"]` (`:267`).
- **State changes:** `workspaces` row created/updated/deleted; on delete `workspace_chats`,
  `document_vectors`, `workspace_documents` rows deleted.
- **Side effects:** `DB`, `VEC` (namespace delete), `TEL`, `LOG`.
- **Failure and edge paths:** delete is not transactional: a failure after `WorkspaceChats.delete`
  leaves the workspace without chats; vector namespace delete errors are swallowed (`:266-270`).
- **Notes:** `GET /v1/workspace/:slug` returns an array from `_findMany` (`:206`), not an object.

#### P-EXT-11 Workspace embeddings and pin via API
- **Steps:** `update-embeddings` → `Document.removeDocuments(ws, deletes)` then
  `Document.addDocuments(ws, adds)` (`api/workspace/index.js:521-522`), no user id passed;
  `update-pin` → `Document.get({workspaceId, docpath})` (`:585-588`), `Document.update(id, {pinned})` (`:591`).
- **State changes:** `workspace_documents` rows created/deleted, `pinned` flipped.
- **Side effects:** `DB`, `VEC`, `NET:embedder` (embedding the added docs).
- **Failure and edge paths:** embed failures inside `addDocuments` are not reported back; the
  route returns the refreshed workspace (`:523-526`).

#### P-EXT-12 Workspace chat, synchronous (`/v1/workspace/:slug/chat`)
- **Actor and preconditions:** API key; workspace exists; `message` non-empty and mode valid unless
  `reset` (`api/workspace/index.js:682-698`).
- **Steps:** route → `ApiChatHandler.chatSync({ user: null, thread: null, sessionId })`
  (`:700-709`) → `server/utils/chats/apiChatHandler.js:143`:
  1. `reset` → `WorkspaceChats.markThreadHistoryInvalidV2({ workspaceId, user_id: user?.id, thread_id: null, api_session_id: sessionId })` (`:159-165`); returns early if no message (`:166-176`).
  2. slash commands expanded (`:181`).
  3. document attachments (`mime === application/anythingllm-document`) written to the collector
     hotdir and parsed (`:46-106`, `:186-188`).
  4. agent check `EphemeralAgentHandler.isAgentInvocation` (`:190-196`); if agent: runs the
     ephemeral agent with `userId: user?.id || null`, `sessionId` (`:201-218`), saves one
     `workspace_chats` row (`:230-246`).
  5. else `resolveProviderConnector` (`:261-269`), query-mode refusal with `include: false` row
     (`:278-308`), history from `recentChatHistory({ user, workspace, thread, apiSessionId })`
     (`:316-322`, filter at `server/utils/chats/index.js:90-101`), pinned docs, vector search,
     `chatPrompt`, `getChatCompletion` (`:439-458`), save (`:477-490`).
  6. route sends `sent_chat` telemetry (`api/workspace/index.js:711`) and `api_sent_chat` log (`:718`).
- **Reads:** `workspaces`, `workspace_chats` (history), `workspace_documents` (pinned), vector DB.
- **State changes:** `workspace_chats` row created (`user_id = null`, `thread_id = null`,
  `api_session_id = sessionId`); on reset, matching rows `include: true → false`.
- **Side effects:** `DB` workspace_chats; `FS` collector hotdir; `NET:collector`; `NET:llm-provider`;
  `NET:vector-db`; `TEL`; `LOG`; `PROC`/agent side effects if an agent runs (AGENT file).
- **Failure and edge paths:** collector offline → attachments silently dropped (`apiChatHandler.js:66-71`);
  vector search failure → `abort` response, nothing saved (`:373-383`); empty completion → `abort`,
  nothing saved (`:465-475`); thrown errors → 500 with `type: abort` (`api/workspace/index.js:723-733`).
- **Notes:** **reset without `sessionId` is instance-wide for the default thread**: `user_id` is
  `undefined` (no filter in Prisma) and `api_session_id` is `null`, so every user's default-thread
  chats in that workspace are marked `include: false`, not only API ones
  (`apiChatHandler.js:160-165`, `server/models/workspaceChats.js:165-173`). Prisma's treatment of
  `undefined` as "no filter" is library behavior, not read in this repo. No daily quota.

#### P-EXT-13 Workspace chat, streaming (`/v1/workspace/:slug/stream-chat`)
- **Steps:** same validation (`api/workspace/index.js:837-853`), SSE headers incl.
  `Access-Control-Allow-Origin: *` (`:855-859`), `ApiChatHandler.streamChat` (`:861-871`,
  `apiChatHandler.js:519`). Agent path streams events via `agentHandler.streamAgentEvents`
  (`apiChatHandler.js:603`); non-agent path calls `abortConnectorOnClientDisconnect` (`:652`),
  `streamGetChatCompletion` + `handleStream` (`:872-875`), save (`:884-896`).
- **State changes / side effects:** as P-EXT-12, plus `WS` (SSE chunks to the caller).
- **Failure and edge paths:** errors after headers are flushed are written as an `abort` chunk
  (`api/workspace/index.js:884-895`). Telemetry and log are sent even when the stream aborted.

#### P-EXT-14 Workspace chat history and vector search via API
- **Steps:** `chats` → with `apiSessionId` `WorkspaceChats.forWorkspaceByApiSessionId` else
  `WorkspaceChats.forWorkspace` (`api/workspace/index.js:439-448`), limit bounded (`:434`);
  `vector-search` → `resolveProviderConnector` (`:994-997`), `VectorDb.performSimilaritySearch`
  with caller `topN`/`scoreThreshold` (`:999-1006`), returns chunk text and metadata (`:1008-1026`).
- **Reads:** `workspace_chats` (all users' default-thread chats when no session id, **(unverified:
  whether `forWorkspace` filters `thread_id`/`api_session_id`)**), vector DB.
- **State changes:** none.
- **Side effects:** `NET:embedder`/`NET:vector-db`.
- **Notes:** `topN` has no upper bound (`:988-992`).

#### P-EXT-15 Thread CRUD via API
- **Steps:** new → `userId` from body nulled in single-user (`api/workspaceThread/index.js:85`),
  `WorkspaceThread.new(workspace, userId, {name, slug})` (`:87-91`), `TEL` (`:93`), `LOG` (`:100`);
  update name (`:175-187`); delete by `{slug, workspace_id}` (`:233-236`); chats → thread rows with
  `api_session_id: null` (`:310-319`).
- **State changes:** `workspace_threads` row created/renamed/deleted.
- **Side effects:** `DB`, `TEL`, `LOG` (create only).
- **Notes:** `userId` is not validated (comment at `:82-84`); any user can be made a thread owner
  in multi-user mode, including non-members of the workspace.

#### P-EXT-16 Thread chat with user attribution (sync and stream)
- **Actor and preconditions:** API key; workspace and thread exist (`api/workspaceThread/index.js:401-428`, `:590-615`).
- **Steps:** `user = userId ? User.get({ id }) : null` (`:448`, `:634`) → `ApiChatHandler.chatSync` /
  `streamChat` with `user`, `thread` (`:449-457`, `:642-651`) → `WorkspaceThread.autoRenameThread`
  (`:458-463`, `:653-667`; stream emits `rename_thread` action) → `TEL`, `LOG api_sent_chat` with
  `userId` (`:471-476`, `:675-680`).
- **Reads:** `users`, `workspace_threads`, `workspace_chats` filtered by that user and thread.
- **State changes:** `workspace_chats` row with `user_id = userId`, `thread_id`; thread name may
  change.
- **Side effects:** as P-EXT-12, plus `DB workspace_threads` (rename), `NET:llm-provider` for the
  rename **(unverified: rename uses an LLM call)**.
- **Notes:** the API trusts `userId` blindly: no membership, suspension, role or `canSendChat` check,
  and no check that the thread belongs to that user. The chat then appears in that user's UI
  thread history as if they had sent it. The system prompt is built with `chatPrompt(workspace, user, …)`
  (`apiChatHandler.js:439`), so that user's stored memories may be injected **(unverified: memory
  lookup inside `chatPrompt`)**.

#### P-EXT-17 Document file upload via API
- **Steps:** multer disk storage into the collector hotdir (`server/utils/files/multer.js:31-37`,
  `:116-131`) → `Collector.online()` (`api/document/index.js:131`) → `Collector.processDocument`
  (`:144-148`) → `TEL document_uploaded`, `LOG api_document_uploaded` (`:160-163`) → optional
  `Document.api.uploadToWorkspace(addToWorkspaces, locations)` (`:165-173`). Folder variant moves
  results with `moveProcessedDocsToFolder` (`:308`).
- **State changes:** file written to hotdir, then processed JSON in `storage/documents/<folder>/`;
  optional `workspace_documents` rows.
- **Side effects:** `FS`, `NET:collector`, `DB`, `VEC`, `NET:embedder`, `TEL`, `LOG`.
- **Failure and edge paths:** collector offline → 500 and the uploaded file stays in hotdir
  **(unverified cleanup)**; partial embed → 200 with `success: false` (`:170-173`).

#### P-EXT-18 Link and raw-text ingestion via API
- **Steps:** `upload-link` accepts one URL or an array (`api/document/index.js:417-431`) and
  caller-supplied `scraperHeaders` (`:410`), calls `Collector.processLink` in parallel (`:450-455`),
  `LOG api_link_uploaded` per success (`:475`); `raw-text` requires `metadata.title` (`:585-622`),
  `Collector.processRawText` (`:634`).
- **Side effects:** `NET:collector` (and through it `NET:<any URL>`), `FS`, `DB`, `VEC`, `TEL`, `LOG`.
- **Notes:** URL validation is delegated to the collector (`:414-416`); SSRF protection lives there
  (COLLECTOR, not read here).

#### P-EXT-19 Document reads via API
- **Steps:** `/v1/documents` → `getDocumentsByFolder` when `?folder=` else full `viewLocalFiles()`
  (`api/document/index.js:705-717`); folder route defaults to `limit=all` (`:788-795`);
  `accepted-file-types` → collector (`:853`); `metadata-schema` static (`:898-908`);
  `/v1/document/:docName` → `findDocumentInDocuments` (`:962`); `generated-files/:filename` →
  generated image dir with `isWithin` (`:1284-1303`) else `createFilesLib.getGeneratedFile` (`:1306-1326`).
- **Side effects:** `NET:collector` (types); `TEL agent_generated_file_downloaded`.
- **Notes:** no workspace or owner scoping on generated files: any key can download any agent
  output by name (contrast the UI download route that checks chat ownership, **(unverified)**).

#### P-EXT-20 Document folder management via API
- **Steps:** create → `normalizeFolderName`, `isWithin` (`api/document/index.js:1018-1026`), `mkdirSync`
  (`:1036`); remove → `purgeFolder(name)` (`:1093`); move → destination must be `folder/file.json`
  (`:1154-1161`), embedded files are skipped (`:1163-1168`), `fs.rename` with `isWithin` on both
  ends (`:1169-1188`).
- **State changes:** directories created/removed under `storage/documents`; files renamed; on
  remove, documents and vectors purged.
- **Side effects:** `FS`, `DB`, `VEC` (remove).
- **Failure and edge paths:** move uses `Promise.all`, so one bad path rejects the batch after
  earlier renames may have completed (`:1189-1209`).

#### P-EXT-21 Embed configuration via API
- **Steps:** list (`api/embed/index.js:58-70`); chats per embed (`:129-131`) and per session
  (`:189-192`); new → workspace by slug (`:268-273`), `EmbedConfig.new({...data, workspace_id})`
  (`:275-278`) with `createdBy = null`; update → `EmbedConfig.update(embed.id, data)` (`:349`);
  delete (`:397`).
- **State changes:** `embed_configs` row created/updated/deleted (cascade deletes `embed_chats`,
  `schema.prisma:266`).
- **Side effects:** `DB`. No `LOG` (UI equivalents log `embed_created/updated/deleted`,
  `server/endpoints/embedManagement.js:42`, `:64`, `:80`).
- **Notes:** chat reads ignore `DISABLE_VIEW_CHAT_HISTORY`; the UI's `/embed/chats` applies
  `chatHistoryViewable` (`embedManagement.js:95`). Embed chats include visitor IP and Origin.

#### P-EXT-22 MCP server management via API
- **Steps:** list → `MCPCompatibilityLayer().servers()` (`api/mcpServers/index.js:40`); new/update →
  `saveServer(name, config, {create})` (`:96-100`, `:195-199`) which writes the MCP config and
  starts the server (`server/utils/MCP/index.js:320-348`); reload (`:129-131`); toggle (`:239-240`);
  toggle-tool (`:308-312`); delete (`:352-353`).
- **State changes:** `storage/plugins/anythingllm_mcp_servers.json` rewritten **(unverified path;
  writes at `server/utils/MCP/hypervisor/index.js:89`, `:131`, `:164`, `:215`)**.
- **Side effects:** `FS`; `PROC` (stdio MCP servers are spawned, `hypervisor/index.js:528`); `NET:<mcp server>`.
- **Notes:** an API key can register and start an arbitrary command as an MCP server, i.e. run
  code on the host. This is the same power the admin UI has, but with no user and no `LOG`.

### OpenAI-compatible API (`openai`)

#### P-EXT-23 Models and vector stores list
- **Steps:** `/models` maps every workspace to `{ id: slug, object: "model", owned_by: chatProvider || LLM_PROVIDER }`
  (`api/openai/index.js:57-65`); `/vector_stores` maps every workspace to `{ id: slug, name, file_counts.total }`
  (`:405-419`) and returns an empty page whenever any query param is present (`:396-401`).
- **Reads:** `workspaces`, `workspace_documents` count.
- **Notes:** "model" = workspace slug; all workspaces are listed, no scoping.

#### P-EXT-24 Chat completions
- **Actor and preconditions:** API key; `model` must be a workspace slug, else **401 with no body**
  (`api/openai/index.js:115-116`); last message must have role `user` (`:118-130`).
- **Steps:** system message text → `systemPrompt` (`:131-134`); remaining non-system messages →
  `history` (`:135`); `extractTextContent` / `extractAttachments` turn `image_url` parts into
  attachments (`server/endpoints/api/openai/helpers.js:7-46`). Non-stream →
  `OpenAICompatibleChat.chatSync` (`:138-145`); stream → SSE headers and `streamChat` (`:161-175`).
  In `server/utils/chats/openaiCompatible.js:52`: chat mode is the workspace's (`:61`), router uses the
  caller's history as override (`:63-76`), query-mode refusals saved with `include: false` (`:84-98`,
  `:177-191`), system prompt is the caller's or `chatPrompt(workspace)` (`:211`), result saved with
  no user, thread or session (`:243-252`), response formatted as OpenAI JSON (`formatJSON`, `:566`).
- **Reads:** `workspaces`, `workspace_documents` (pinned), vector DB. Server-side history is **not**
  read; the caller's `messages` are the history.
- **State changes:** `workspace_chats` row created with `user_id = null`, `thread_id = null`,
  `api_session_id = null`.
- **Side effects:** `DB`, `NET:llm-provider`, `NET:vector-db`, `TEL`, `LOG`, `WS` (stream).
- **Failure and edge paths:** stream errors end the response with 500 if headers not yet sent
  (`api/openai/index.js:190`).
- **Notes:** because `api_session_id` is null, these chats look like default-thread chats with no
  user, so they can appear in UI history for single-user mode **(unverified rendering)**. No agent
  invocation path; `@agent` is passed as plain text. `temperature` overrides the workspace.

#### P-EXT-25 Embeddings
- **Steps:** `input` or legacy `inputs`, coerced to string array and validated
  (`api/openai/index.js:322-332`) → system embedder `embedChunks` (`:334-335`).
- **Side effects:** `NET:embedder`. No DB write, no `LOG`, no `TEL`.
- **Notes:** uses the instance embedder regardless of `model`; this turns the key into an embedding
  proxy billed to the instance.

#### P-EXT-26 Image generation and edit
- **Steps:** multipart via `handleImageGenUpload` (memory storage, 25 MB, `image/*`,
  `server/utils/files/multer.js:202-210`) → `editImageForWorkspace` when files present else
  `generateImageForWorkspace` (`api/openai/index.js:252-265`) → `getImageGeneratorProvider()` and
  `saveGeneratedImage` (`server/utils/ImageGenerators/index.js:9-17`); response as base64 JSON or
  raw PNG (`api/openai/index.js:266-280`); client disconnect aborts (`:242-244`).
- **State changes:** image file written to the generated-images directory.
- **Side effects:** `NET:image-provider`, `FS`.
- **Notes:** despite the name, no workspace is involved (`ImageGenerators/index.js:9`).

### Chat embed widget (`embed`)

#### P-EXT-27 Visitor sends a message
- **Actor and preconditions:** anonymous browser on a page with the widget snippet
  (`data-embed-id`, `data-base-api-url="<server>/api/embed"`,
  `frontend/src/pages/GeneralSettings/ChatEmbedWidgets/EmbedConfigs/EmbedRow/CodeSnippetModal/index.jsx:38-41`).
  Embed `enabled`, Origin allowed.
- **Steps:**
  1. Widget reads or creates a session id in `localStorage` key `allm_<embedId>_session_id` and
     POSTs `${baseApiUrl}/${embedId}/stream-chat` with `{message, sessionId, username, prompt?, model?, temperature?}`
     (built bundle `frontend/public/embed/anythingllm-chat-widget.min.js`, minified, no line numbers).
  2. 1 MB body parsers for `/api/embed` (`server/index.js:70-74`).
  3. `validEmbedConfig` → `EmbedConfig.getWithWorkspace({uuid})`, 404 if absent (`embedMiddleware.js:9-20`).
  4. `setConnectionMeta` stores `{host: Origin, ip}` (`:22-28`).
  5. `canRespond` (`:116-212`): `enabled` (`:53-64`); allowlist (`:67-97`; no allowlist + `EMBED_REQUIRE_ALLOWLIST` set → deny; allowlist parsed to origins by `EmbedConfig.parseAllowedHosts`, `server/models/embedConfig.js:194-209`); `sessionId` is a UUID (`:122-132`); message non-empty (`:134-146`); daily per-embed count (`:148-172`); daily per-session count (`:174-198`).
  6. `streamChatWithForEmbed` (`server/utils/chats/embed.js:13`): `automatic` mode forced to `chat`
     (`:24-25`); overrides applied only when the embed allows them (`:27-34`); router via
     `resolveLLMConnectorForEmbed` using embed history (`:266-322`); client-disconnect abort (`:64`);
     history by `(embed_id, session_id)` (`:254-262`); pinned docs, vector search; prompt with
     `skipMemories: true` (`:186-187`); save to `embed_chats` only if text is non-empty (`:231-244`).
  7. Route sends `TEL embed_sent_chat` (`server/endpoints/embed/index.js:48`).
- **Reads:** `embed_configs`, `workspaces`, `embed_chats`, `workspace_documents`, vector DB.
- **State changes:** `embed_chats` row created with `connection_information = {host, ip, username}`.
- **Side effects:** `DB embed_chats`, `NET:llm-provider`, `NET:vector-db`, `TEL`, `WS` (SSE).
- **Failure and edge paths:** router error → abort chunk (`embed.js:51-60`); vector DB failure →
  generic abort (`:134-144`); query mode with empty workspace returns the refusal text and saves
  nothing (`:73-85`).
- **Notes:**
  - The allowlist is an `Origin` check; any non-browser client can set `Origin` and pass it.
  - `max_chats_per_session` keys on a client-generated UUID, so a script can rotate sessions; only
    `max_chats_per_day` is a real cap. Failed responses are not saved and do not count.
  - `allow_model_override` lets the visitor name any model string for the workspace provider
    (`embed.js:27`, `:275-277`); `allow_prompt_override` replaces the workspace system prompt
    (`:30-31`) by mutating the loaded `embed.workspace` object (in memory only).
  - `username` is self-declared and stored as-is.
  - No agent path: embeds never run agents (no `isAgentInvocation` call in `embed.js`).

#### P-EXT-28 Visitor reads or resets history
- **Steps:** `GET /embed/:embedId/:sessionId` → `canAccessHistory` (same enabled + Origin checks and
  UUID session, `embedMiddleware.js:104-114`) → `EmbedChats.forEmbedByUser(embed.id, sessionId, …)`
  (`server/endpoints/embed/index.js:77-83`); `DELETE` → `EmbedChats.markHistoryInvalid` (`:101`,
  `server/models/embedChats.js:90-102`).
- **State changes:** reset sets `embed_chats.include: true → false` for that session.
- **Side effects:** `DB`.
- **Notes:** anyone who knows an embed UUID and a session UUID can read that session; the session
  UUID is the only secret. Reset does not lower the rate-limit count (counts ignore `include`,
  `embedMiddleware.js:152-157`).

#### P-EXT-29 Admin manages embeds in the UI
- **Steps:** list (`embedManagement.js:23`), create with `createdBy = user.id` (`:41`) + `LOG embed_created`,
  update (`:63-64`) + `LOG`, delete (`:79-84`) + `LOG`, chat list with `chatHistoryViewable` (`:95-109`),
  delete one chat (`:123`). `EmbedConfig.new` warns when created with no allowlist (`embedConfig.js:68-78`).
- **State changes:** `embed_configs`, `embed_chats` rows.
- **Side effects:** `DB`, `LOG`.
- **Notes:** `delete /embed/:embedId` logs `response.locals.user?.id` (`:83`), the others use
  `userFromSession`. Route `/embed/chats/:chatId` is registered before the public
  `/embed/:embedId/:sessionId` (`server/index.js:108` vs `:127`), so it wins the match.

### Telegram bot (`telegram`)

#### P-EXT-30 Owner connects, configures and disconnects the bot
- **Actor and preconditions:** single-user mode (`isSingleUserMode` → 401 otherwise,
  `server/utils/middleware/multiUserProtected.js:16-21`).
- **Steps:** connect → `TelegramBotService.verifyToken` (`server/endpoints/telegram.js:89`,
  `telegramBot/index.js:797`); pick `default_workspace` or the first workspace, or create
  `"<bot> Workspace"` (`telegram.js:99-112`); keep existing `approved_users` (`:122-129`);
  `ExternalCommunicationConnector.upsert("telegram", {..., bot_token: encryptToken(token), active: true})`
  (`:132-139`, `server/utils/telegramBot/utils/index.js:133-138`); `service.start` (`:144`,
  `telegramBot/index.js:105`) clears backlog keeping last message per chat, starts long polling,
  restores per-chat state, registers handlers and commands; `LOG telegram_bot_connected`, `TEL`
  (`:146-149`). Config → reads first approved user's active workspace (`:31-63`). Update-config →
  only `voice_response_mode` (`:301-306`). Disconnect → `service.stop()`, delete connector, `LOG` (`:166-169`).
- **Reads:** `external_communication_connectors`, `workspaces`, `workspace_threads`.
- **State changes:** connector row upserted (`config` JSON with encrypted token) or deleted; may
  create a workspace.
- **Side effects:** `DB`, `NET:telegram`, `LOG`, `TEL`, `TIME` (polling loop, retry timers
  `telegramBot/index.js:242-300`).
- **Failure and edge paths:** invalid token → 400 (`telegram.js:92-97`). Repeated HTTP polling
  errors stop polling (`telegramBot/index.js:257`); network errors retry with backoff up to 10 times
  (`:33-35`, `:263-293`) **(unverified: whether `#selfCleanup` deletes the connector after retries)**.
- **Notes:** `/telegram/config` crashes with 500 when there are no workspaces at all
  (`workspace.id` on null, `telegram.js:46-49`).

#### P-EXT-31 Pairing: unknown chat → pending → approve or deny
- **Actor and preconditions:** any Telegram user who finds the bot.
- **Steps:** message → `guard` (`telegramBot/index.js:442-454`) → not verified →
  `sendPairingRequest` (`utils/verification.js:59-92`): reuse or create a 6-digit code
  (`crypto.randomInt`, `:18-20`), cap 10 pending, evicting oldest (`:26-38`), store in the in-memory
  `#pendingPairings` map, reply with the code. Owner sees `/telegram/pending-users`
  (`telegram.js:196-204`) and compares codes, then `approve-user` → `approveUser` appends
  `{chatId, username, firstName}` to `approved_users` and persists (`verification.js:101-129`), or
  `deny-user` → removes from the map and notifies (`:137-147`). `LOG telegram_user_approved/denied`.
- **State changes:** `external_communication_connectors.config.approved_users` appended.
- **Side effects:** `PUSH` (Telegram message to the requester), `DB`, `LOG`.
- **Failure and edge paths:** pending pairings are memory-only and lost on restart. Approve does
  not require the chat id to be pending: any `chatId` posted is approved (`verification.js:105-116`).
  If the bot is not running, `this.#config` is null and approve throws → 500 **(unverified)**.
- **Notes:** identity is the Telegram **chat** id, not the sender: approving a group chat would
  admit every member of it **(unverified: whether group chats reach the handler)**. An attacker can
  push out a legitimate pending request by filling the 10-slot cap.

#### P-EXT-32 Revoke an approved chat
- **Steps:** `revoke-user` → `revokeUser(chatId, this.#config)` filters and persists
  `approved_users` (`verification.js:154-162`); `LOG telegram_user_revoked` (`telegram.js:284`).
- **State changes:** `approved_users` entry removed.
- **Side effects:** `DB`, `LOG`. No message to the revoked user.
- **Notes:** takes effect on the next message because `guard` reads the same mutated config
  object; a job already running for that chat is not aborted, and its `#chatState` entry stays in
  memory.

#### P-EXT-33 Approved chat sends a message
- **Steps:** `bot.on("message")` (`telegramBot/index.js:482-485`) → `guard` (verified +
  `#assertSingleUserMode`, `:442-454`) → `#handleMessage` (`:685`): voice/audio → download and
  transcribe (`:689-722`); photo → vision attachment (`:726-744`); document → collector text, wrapped
  into the prompt (`:748-780`); text → as-is. Each enqueued per chat (`this.#queue`). `#runChatJob`
  (`:492`) adds and runs a Bree job `handle-telegram-chat-<ts>` (`:495-507`), sends
  `{botToken, chatId, workspaceSlug, threadSlug, message, attachments, voiceResponse}` over IPC
  (`:510-519`). Worker (`server/jobs/handle-telegram-chat.js:10-67`) resolves the workspace by slug
  (`:32`) and the thread **by slug only** (`:42-44`), calls `streamResponse`
  (`server/utils/telegramBot/chat/stream.js:56`): history with no user (`:72-76`), agent path if
  history is agentic or `isAgentInvocation` (`:78-93`), else stream to Telegram with throttled
  message edits and save (`:329-340`); optional voice reply.
- **Reads:** connector config, `workspaces`, `workspace_threads`, `workspace_chats`, vector DB.
- **State changes:** `workspace_chats` row (`user_id = null`, thread id or null).
- **Side effects:** `PROC` (Bree worker), `NET:telegram`, `NET:llm-provider`, `NET:stt`/`NET:tts`
  (voice), `NET:collector` (documents), `DB`, `PUSH` (bot replies), agent side effects
  (`EphemeralAgentHandler`, `chat/agent.js:229-237`).
- **Failure and edge paths:** worker error → generic apology (`handle-telegram-chat.js:55-63`);
  non-zero exit rejects and the parent sends an error message (`telegramBot/index.js:532-565`).
- **Notes:** the decrypted bot token is sent to the worker in plaintext IPC. All approved chats
  write the same anonymous history; one approved chat can read another's conversation through
  `/history` or by sharing a workspace/thread. Thread lookup is not scoped to the workspace
  (`handle-telegram-chat.js:43`).

#### P-EXT-34 Commands and inline-keyboard callbacks
- **Steps:** commands registered from `BOT_COMMANDS` (`utils/commands/index.js:32-115`: start,
  switch, model, new, history, status, reset, help, proof, abort) through `guard`
  (`telegramBot/index.js:457-473`). Callbacks → `handleKeyboardQueryCallback` checks `isVerified`
  only (`utils/navigation/index.js:15-20`) → `resolveCallbackHandler` (`callbacks/index.js:41-53`).
  Notable writes: `ws-create` → `Workspace.new` (`callbacks/handleWorkspaceCreate.js:13`);
  `mdl:` → `Workspace.update(id, {chatModel})` (`callbacks/handleModelSelect.js:42`); `/new` →
  `WorkspaceThread.new` (`commands/handlers/handleNewThread.js:17`); `/reset` →
  `markThreadHistoryInvalidV2` (`handleReset.js:19`); `ctx.setState` → `#persistChatState` writes
  `active_workspace`/`active_thread` into `approved_users` (`telegramBot/index.js:363-388`);
  `tool:` → resolves a pending agent tool approval (`callbacks/handleToolApproval.js:13`).
- **State changes:** `workspaces` row created / `chatModel` changed; `workspace_threads` row;
  `workspace_chats.include → false`; connector config JSON.
- **Side effects:** `DB`, `NET:telegram`, `NET:llm-provider` (model list).
- **Notes:** callbacks skip `#assertSingleUserMode`. `/model` changes the workspace's model for every
  channel, not only Telegram. Workspace and thread ids come from callback data and are looked up
  without further checks (`handleThreadSelect.js:17`, `:28`).

#### P-EXT-35 Bot boot
- **Steps:** `bootIfActive` (`telegramBot/index.js:813-835`): connector must be active with a token;
  `#assertSingleUserMode` deletes the connector in multi-user mode (`:419-429`); `decryptToken`
  (`utils/index.js:146-151`); `start(config)`.
- **State changes:** possibly connector row deleted.
- **Side effects:** `NET:telegram`, `TIME` (polling), `DB` (delete).
- **Notes:** pending messages sent while the server was down are reduced to the last per chat and
  replayed only for verified chats (`:129-138`).

### Mobile app (`mobile`)

#### P-EXT-36 Device pairing and approval
- **Actor and preconditions:** an admin (multi-user) or the owner (single-user) in the UI.
- **Steps:** `GET /mobile/connect-info` (`mobile/index.js:84-97`) → `MobileDevice.connectionURL(user)`
  (`server/models/mobileDevice.js:99-108`) → `registerTempToken` stores `{userId, expiresAt: +3 min}`
  in an in-memory map keyed by 12 hex chars of a UUID (`:61-77`). The app calls
  `POST /mobile/register` with `Authorization: Bearer <temp>` → `validRegistrationToken`
  (`mobile/middleware/index.js:52-92`): `MobileDevice.tempToken` consumes the token whether valid
  or not (`mobileDevice.js:39-50`); in multi-user mode the token's user must exist and not be
  suspended (`middleware/index.js:70-83`). `MobileDevice.create` (only `android`,
  `mobileDevice.js:118-138`) with a new UUID token, `approved: false`. Admin approves through
  `POST /mobile/update/:id` (`mobile/index.js:40-57`; only `approved` writable, `mobileDevice.js:25-31`).
- **State changes:** temp token added and consumed (memory); `desktop_mobile_devices` row created;
  `approved: false → true`.
- **Side effects:** `DB`, `CACHE` (temp-token map).
- **Notes:** the device inherits the **pairing admin's** user id (`mobile/index.js:130`), so in
  multi-user mode every mobile device acts as an admin; there is no path for a normal user to pair
  their own device. Device tokens never expire.

#### P-EXT-37 Device commands (read and manage)
- **Steps:** `validDeviceToken` (`mobile/middleware/index.js:12-42`) → `handleMobileCommand`
  (`mobile/utils/index.js:17`): `workspaces` → `Workspace.whereWithUser(user)` or all (`:22-47`);
  `workspace-content` → threads and **all** chats of that workspace filtered by `user_id` only when a
  user exists (`:50-89`); `model-tag` (`:92-103`); `reset-chat` → `markThreadHistoryInvalidV2`
  with `user_id` only if a user exists (`:105-135`); `new-thread` → `WorkspaceThread.new(ws, user?.id)`
  (`:137-147`); `unregister-device` → delete own device (`:210-215`).
- **Reads:** `workspaces`, `workspace_threads`, `workspace_chats` (raw rows, all columns).
- **State changes:** `workspace_chats.include → false`; `workspace_threads` row; device row deleted.
- **Side effects:** `DB`.
- **Notes:** with no user (single-user mode, or a device registered before multi-user was enabled
  **(unverified scenario)**) the device sees every chat of every workspace.

#### P-EXT-38 Device stream chat
- **Steps:** `stream-chat` (`mobile/utils/index.js:149-208`): workspace via `getWithUser` or any
  (`:156-158`); thread scoped to workspace and user (`:162-173`); SSE headers (`:175-179`);
  `ApiChatHandler.streamChat({ user, thread, sessionId: null, attachments: [] })` (`:180-190`);
  `autoRenameThread` (`:192-206`).
- **State changes / side effects:** as P-EXT-13 with `user_id` = device user.
- **Notes:** no `User.canSendChat` quota check (the UI applies it at `server/endpoints/chat.js:53`),
  no `TEL`/`LOG` call. Mode is always the workspace's.

#### P-EXT-39 Admin lists and deletes devices
- **Steps:** list with `user {id, username}` (`mobile/index.js:24-26`); delete (`:70-75`).
- **State changes:** device row deleted (revokes the token immediately).
- **Side effects:** `DB`. No `LOG` on approve or delete.

### Browser extension (`extension`)

#### P-EXT-40 Key management in the UI
- **Steps:** list (`browserExtension.js:160-163`), create with `user?.id || null` (`:180-183`) →
  `brx-<uuid-apikey>` (`server/models/browserExtensionApiKey.js:10-13`, `:20-27`), delete (managers only
  their own, `:203-211`).
- **State changes:** `browser_extension_api_keys` row created/deleted.
- **Side effects:** `DB`.

#### P-EXT-41 Extension handshake and workspace list
- **Steps:** `validBrowserExtensionApiKey` (`server/utils/middleware/validBrowserExtensionApiKey.js:8-57`):
  bearer key → `BrowserExtensionApiKey.validate` (prefix check, lookup; single-user returns any key,
  `browserExtensionApiKey.js:40-49`); multi-user: owner exists, not suspended, admin/manager
  (`:29-50`). `check`/`workspaces` → `whereWithUser(user)` or all (`browserExtension.js:24-27`,
  `:68-71`); `disconnect` deletes the presented key (`:49-51`).
- **State changes:** key row deleted on disconnect.
- **Side effects:** `DB`.

#### P-EXT-42 Extension saves page content
- **Steps:** `embed-content` → workspace by id via `getWithUser` in multi-user (`browserExtension.js:88-90`),
  `Collector.processRawText(textContent, metadata)` (`:98-101`), `Document.addDocuments(ws, [loc], user?.id)`
  (`:108-112`), `TEL`; `upload-content` → `processRawText` only (`:135-138`), `TEL`.
- **State changes:** document JSON in `storage/documents/custom-documents` **(unverified folder)**;
  `workspace_documents` row (embed-content).
- **Side effects:** `NET:collector`, `FS`, `DB`, `VEC`, `NET:embedder`, `TEL`. No `LOG`.
- **Failure and edge paths:** `documents[0]` undefined on an empty collector result → 500 (`:110`).

### Web push (`ui`)

#### P-EXT-43 Subscribe to push
- **Steps:** `GET /web-push/pubkey` returns the VAPID public key (`webPush.js:21-24`);
  `POST /web-push/subscribe` → `pushNotificationService.registerSubscription(user, body)`
  (`webPush.js:12-16`, `server/utils/PushNotifications/index.js:146-166`): in-memory map keyed by
  user id or `"primary"`; with a user, `users.web_push_subscription_config` updated; without,
  `storage/push-notifications/primary-subscription.json` written (`:72-79`, `:157-162`).
- **State changes:** `users.web_push_subscription_config: old → JSON(subscription)` or file written;
  one subscription per user (overwrites previous device).
- **Side effects:** `DB` or `FS`, `CACHE`.
- **Failure and edge paths:** no validation of the subscription body and no try/catch in the route
  (`webPush.js:11-18`); a thrown error is unhandled by the route **(unverified: Express 4 async
  error behavior here)**.

## 5. State machines

**Embed config** (`embed_configs.enabled`, default `false`, `schema.prisma:238`)

| From | To | Trigger | Code |
|---|---|---|---|
| — | disabled | create (UI or API) | `embedConfig.js:26-61`; `embedManagement.js:41`; `api/embed/index.js:275` |
| disabled | enabled / back | update | `embedManagement.js:63`; `api/embed/index.js:349` |
| any | deleted (chats cascade) | delete | `embedManagement.js:79`; `api/embed/index.js:397` |

**Embed chat row** (`embed_chats.include`): created `true` (`embed.js:232`) → `false` on visitor
reset (`embedChats.js:90-102`) → deleted by admin (`embedManagement.js:123`) or cascade.

**Telegram chat identity**

| From | To | Trigger | Code |
|---|---|---|---|
| unknown | pending (memory, code issued) | first message | `verification.js:59-92` |
| pending | evicted | 10-slot cap reached | `verification.js:26-38` |
| pending / any | approved (`approved_users`) | owner approve | `telegram.js:239`, `verification.js:101-129` |
| pending | removed | owner deny | `verification.js:137-147` |
| approved | removed | owner revoke | `verification.js:154-162` |
| any | all cleared | disconnect, multi-user detected | `telegram.js:167-168`; `telegramBot/index.js:419-429` |

**Telegram connector**: absent → active (connect, `telegram.js:132`) → polling / retrying
(`telegramBot/index.js:242-300`) → stopped or deleted (disconnect, multi-user, self-cleanup `:219-227`).

**Mobile pairing**

| From | To | Trigger | Code |
|---|---|---|---|
| — | temp token (3 min, memory) | admin opens connect info | `mobileDevice.js:61-77` |
| temp token | consumed | any `/mobile/register` attempt with it | `mobileDevice.js:47-48` |
| consumed (valid) | device `approved=false` | register | `mobile/index.js:127-131` |
| unapproved | approved | admin update | `mobile/index.js:46-49` |
| any | deleted | admin delete or `unregister-device` | `mobile/index.js:75`; `mobile/utils/index.js:213` |

**Telegram chat job**: queued per chat → Bree worker running (`#activeWorkers`) → exit 0 / aborted
(`/abort`, `telegramBot/index.js:574-590`) / error → job removed (`:532-547`).

## 6. Side-effect ledger

| ID | Trigger | Class | Target | Where (path:line) | Reversible? | Notes |
|---|---|---|---|---|---|---|
| SE-EXT-01 | P-EXT-03 | DB | users (create/update/delete) | `api/admin/index.js:135`, `:207`, `:258` | Delete: no | No LOG on create/update |
| SE-EXT-02 | P-EXT-03 | LOG | event_logs `api_user_deleted` | `api/admin/index.js:259` | n/a | userId null |
| SE-EXT-03 | P-EXT-04 | DB | invites | `api/admin/index.js:364`, `:424` | Yes (soft) | |
| SE-EXT-04 | P-EXT-05 | DB | workspace_users | `api/admin/index.js:551`, `:648`, `:665` | Yes | No LOG |
| SE-EXT-05 | P-EXT-06 | DB | system_settings | `api/admin/index.js:781` | Yes | |
| SE-EXT-06 | P-EXT-07 | ENV | process.env + `.env` | `api/system/index.js:148`; `updateENV.js:1573` | Yes | No user, admin gate absent |
| SE-EXT-07 | P-EXT-07 | ENV | `.env` dump | `api/system/index.js:31` | n/a | Unauthenticated |
| SE-EXT-08 | P-EXT-07 | LOG | provider change events | `updateENV.js:1585-1596` | n/a | userId null |
| SE-EXT-09 | P-EXT-08 | LOG | `exported_chats` | `api/system/index.js:208` | n/a | |
| SE-EXT-10 | P-EXT-08 | FS/DB/VEC | documents purge | `api/system/index.js:274` | No | Sequential, partial on error |
| SE-EXT-11 | P-EXT-09 | DB | temporary auth token | `api/userManagement/index.js:109` | Expires | No LOG |
| SE-EXT-12 | P-EXT-10 | DB | workspaces create/update | `api/workspace/index.js:80`, `:345` | Yes | |
| SE-EXT-13 | P-EXT-10 | DB/VEC | workspace delete cascade | `api/workspace/index.js:258-267` | No | Not transactional |
| SE-EXT-14 | P-EXT-10 | TEL/LOG | `workspace_created`, `api_workspace_*` | `api/workspace/index.js:91`, `:99`, `:263` | n/a | |
| SE-EXT-15 | P-EXT-11 | DB/VEC/NET:embedder | workspace_documents | `api/workspace/index.js:521-522` | Yes | Errors not surfaced |
| SE-EXT-16 | P-EXT-11 | DB | workspace_documents.pinned | `api/workspace/index.js:591` | Yes | |
| SE-EXT-17 | P-EXT-12/13/16/38 | DB | workspace_chats insert | `apiChatHandler.js:230`, `:283`, `:410`, `:477`, `:884` | Soft (reset) | user per channel |
| SE-EXT-18 | P-EXT-12/13/16 | DB | workspace_chats.include → false | `apiChatHandler.js:160-165`, `:537-542` | No API to undo | Instance-wide on default thread without sessionId |
| SE-EXT-19 | P-EXT-12/13 | FS | collector hotdir attachment | `apiChatHandler.js:89` | Collector consumes | |
| SE-EXT-20 | P-EXT-12/13 | NET:collector | parse attachment | `apiChatHandler.js:91` | n/a | |
| SE-EXT-21 | P-EXT-12/13/16/24/27/33/38 | NET:llm-provider | completion | `apiChatHandler.js:456`, `:872`; `openaiCompatible.js` ; `embed.js` | n/a | Cost metered by `addChatCostToMetrics` |
| SE-EXT-22 | P-EXT-13/16/24/27/38 | WS | SSE stream to caller | `api/workspace/index.js:855-859`; `embed/index.js:36-40`; `mobile/utils/index.js:175-179` | n/a | `Access-Control-Allow-Origin: *` |
| SE-EXT-23 | P-EXT-12/13/16/24 | TEL/LOG | `sent_chat`, `api_sent_chat` | `api/workspace/index.js:711`, `:718`; `api/openai/index.js:147`, `:154` | n/a | Not sent by mobile |
| SE-EXT-24 | P-EXT-15 | DB | workspace_threads | `api/workspaceThread/index.js:87`, `:184`, `:233` | Delete: no | userId unvalidated |
| SE-EXT-25 | P-EXT-16/38 | DB | thread auto-rename | `api/workspaceThread/index.js:458`; `mobile/utils/index.js:192` | Yes | |
| SE-EXT-26 | P-EXT-17/18 | FS | hotdir upload, storage/documents | `multer.js:31-37`; `api/document/index.js:144`, `:308` | Yes (delete doc) | |
| SE-EXT-27 | P-EXT-17/18/42 | NET:collector | process document/link/text | `api/document/index.js:144`, `:453`, `:634`; `browserExtension.js:98` | n/a | Link fetch is outbound to any URL |
| SE-EXT-28 | P-EXT-17/18 | DB/VEC | addToWorkspaces | `api/document/index.js:166`, `:481`, `:652` | Yes | Partial success possible |
| SE-EXT-29 | P-EXT-17/18 | TEL/LOG | `document_uploaded`, `api_*_uploaded` | `api/document/index.js:160-163`, `:474-475`, `:648-649` | n/a | |
| SE-EXT-30 | P-EXT-19 | TEL | `agent_generated_file_downloaded` | `api/document/index.js:1300`, `:1328` | n/a | |
| SE-EXT-31 | P-EXT-20 | FS | folder mkdir / purge / rename | `api/document/index.js:1036`, `:1093`, `:1179` | Partly | Batch move not atomic |
| SE-EXT-32 | P-EXT-21 | DB | embed_configs (+cascade embed_chats) | `api/embed/index.js:275`, `:349`, `:397` | Delete: no | No LOG |
| SE-EXT-33 | P-EXT-22 | FS/PROC | MCP config file, spawn server | `server/utils/MCP/index.js:320-348`; `hypervisor/index.js:528` | Yes | Arbitrary command |
| SE-EXT-34 | P-EXT-25 | NET:embedder | embed chunks | `api/openai/index.js:335` | n/a | |
| SE-EXT-35 | P-EXT-26 | NET:image-provider + FS | generate/edit image, save | `ImageGenerators/index.js:14-16` | Yes | |
| SE-EXT-36 | P-EXT-27 | DB | embed_chats insert (Origin, IP, username) | `embed.js:232-243` | Soft | Only if non-empty |
| SE-EXT-37 | P-EXT-27 | TEL | `embed_sent_chat` | `embed/index.js:48` | n/a | |
| SE-EXT-38 | P-EXT-28 | DB | embed_chats.include → false | `embedChats.js:94-101` | No | |
| SE-EXT-39 | P-EXT-29 | DB/LOG | embed config CRUD + `embed_*` | `embedManagement.js:41-46`, `:63-64`, `:79-84`, `:123` | Delete: no | |
| SE-EXT-40 | P-EXT-30 | DB | connector upsert/delete (encrypted token) | `telegram.js:132-139`, `:168` | Yes | |
| SE-EXT-41 | P-EXT-30 | NET:telegram + TIME | verify, long polling, retry timer | `telegram.js:89`; `telegramBot/index.js:111-113`, `:281` | Stop | |
| SE-EXT-42 | P-EXT-30 | LOG/TEL | `telegram_bot_connected/disconnected` | `telegram.js:146-149`, `:169` | n/a | |
| SE-EXT-43 | P-EXT-31 | PUSH | pairing code / approved / denied messages | `verification.js:91`, `:121`, `:142` | n/a | |
| SE-EXT-44 | P-EXT-31/32/34 | DB | `approved_users` and per-chat state JSON | `verification.js:113`, `:159`; `telegramBot/index.js:381` | Yes | |
| SE-EXT-45 | P-EXT-31/32 | LOG | `telegram_user_approved/denied/revoked` | `telegram.js:240`, `:262`, `:284` | n/a | |
| SE-EXT-46 | P-EXT-33 | PROC | Bree worker `handle-telegram-chat` | `telegramBot/index.js:495-507` | n/a | Plaintext token over IPC |
| SE-EXT-47 | P-EXT-33 | DB | workspace_chats insert (no user) | `telegramBot/chat/stream.js:329-340` | Soft | |
| SE-EXT-48 | P-EXT-33 | PUSH/NET:telegram | bot reply, voice reply | `telegramBot/chat/stream.js` (stream handler), `:342-345` | n/a | |
| SE-EXT-49 | P-EXT-34 | DB | Workspace.new / chatModel / thread / reset | `handleWorkspaceCreate.js:13`; `handleModelSelect.js:42`; `handleNewThread.js:17`; `handleReset.js:19` | Yes | Model change is global |
| SE-EXT-50 | P-EXT-35 | DB | connector delete in multi-user | `telegramBot/index.js:427` | No | |
| SE-EXT-51 | P-EXT-36 | CACHE | temp pairing token map | `mobileDevice.js:72`, `:48` | Expires 3 min | |
| SE-EXT-52 | P-EXT-36/39 | DB | desktop_mobile_devices create/approve/delete | `mobile/index.js:127`, `:46`, `:75`; `mobile/utils/index.js:213` | Yes | No LOG |
| SE-EXT-53 | P-EXT-37 | DB | reset-chat / new-thread | `mobile/utils/index.js:129`, `:145` | Soft | |
| SE-EXT-54 | P-EXT-40/41 | DB | browser_extension_api_keys | `browserExtension.js:181`, `:213`, `:51` | Delete: no | |
| SE-EXT-55 | P-EXT-42 | DB/VEC/FS | add document to workspace | `browserExtension.js:98-112` | Yes | No LOG |
| SE-EXT-56 | P-EXT-42 | TEL | `browser_extension_*` | `browserExtension.js:119`, `:145` | n/a | |
| SE-EXT-57 | P-EXT-43 | DB/FS/CACHE | push subscription | `PushNotifications/index.js:148-163` | Overwrite | One per user |

## 7. Cross-domain links

- **AUTH** — UI session (`validatedRequest`), roles (`flexUserRoleValid`, `strictMultiUserRoleValid`),
  developer API key issuance (`server/endpoints/admin.js:523`, `server/endpoints/system.js:1065`),
  Simple SSO login consuming `issue-auth-token` (P-EXT-09).
- **CHAT** — `recentChatHistory`, `chatPrompt`, `resolveProviderConnector` / model router, vector
  search, `fillSourceWindow`, `WorkspaceChats` semantics used by P-EXT-12/13/16/24/27/33/38.
- **AGENT** — `EphemeralAgentHandler` for API and Telegram agent runs, tool approval over Telegram
  (`server/utils/agents/aibitat/plugins/http-socket.js:46-149`), MCP hypervisor (P-EXT-22), push
  notification delivery (subscribers from P-EXT-43), generated files (P-EXT-19).
- **DOC** — collector processing, `Document.addDocuments/removeDocuments`, `purgeDocument`,
  `purgeFolder`, folder utilities (P-EXT-17..20, P-EXT-42).
- **ADMIN** — user, invite, workspace membership, system settings and env management that the API
  duplicates (P-EXT-03..08); embed, mobile and Telegram settings pages.
- **STATE** — tables `api_keys`, `embed_configs`, `embed_chats`, `external_communication_connectors`,
  `desktop_mobile_devices`, `browser_extension_api_keys`.

## 8. Open questions and unverified points

1. `embed/` and `browser-extension/` submodules are not checked out; widget behavior was read only
   from the minified bundle `frontend/public/embed/anythingllm-chat-widget.min.js`, and the extension
   client was not read at all.
2. Prisma treats `undefined` in a `where` clause as "no filter" (library behavior); the
   instance-wide reset in P-EXT-12 depends on it.
3. Whether `WorkspaceChats.forWorkspace` (P-EXT-14) and UI history rendering include OpenAI-compatible
   chats (`api_session_id = null`, no user) was not traced.
4. Whether `chatPrompt(workspace, user)` injects the attributed user's memories for API thread chats.
5. Whether `autoRenameThread` makes an LLM call.
6. `invites` deactivate field name, `TemporaryAuthToken` table name, MCP config file path and
   extension document folder were not read.
7. Whether UI user deletion guards against removing the last admin (to compare with P-EXT-03).
8. Whether the UI generated-file download checks chat ownership (to compare with P-EXT-19).
9. Telegram: behavior of `approve-user` when the bot is not running (`#config` null); whether group
   chats reach the handler; whether `#selfCleanup` runs after max polling retries.
10. Mobile: whether a device registered in single-user mode keeps `userId = null` after switching to
    multi-user mode, which would give it unscoped access.
11. Express async error handling for the un-caught `/web-push/subscribe` route.

