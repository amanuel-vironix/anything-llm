# Side effects by class

Generated from the side-effect ledgers in files 01-08. Do not edit by hand; regenerate after changing a ledger (see README). A row with several classes appears under each.

371 ledger rows.

| Class | Rows |
|---|---|
| [DB](#db) | 130 |
| [FS](#fs) | 46 |
| [VEC](#vec) | 10 |
| [NET](#net) | 55 |
| [PROC](#proc) | 15 |
| [WS](#ws) | 11 |
| [PUSH](#push) | 6 |
| [ENV](#env) | 14 |
| [CACHE](#cache) | 29 |
| [LOG](#log) | 83 |
| [TEL](#tel) | 28 |
| [TIME](#time) | 11 |
| [OTHER](#other) | 6 |

## DB

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-AUTH-01](01-auth-and-users.md) | DB | `system_settings.onboarding_complete` | P-AUTH-01 | `server/models/systemSettings.js:818` | no API to reset |  |
| [SE-AUTH-08](01-auth-and-users.md) | DB | `users` (admin row) | P-AUTH-05 | `server/endpoints/system.js:679` | rollback deletes all users |  |
| [SE-AUTH-09](01-auth-and-users.md) | DB | `system_settings.multi_user_mode=true` | P-AUTH-05 | `server/endpoints/system.js:693` | **no** (one-way) |  |
| [SE-AUTH-10](01-auth-and-users.md) | DB | `browser_extension_api_keys`, `memories`, `workspace_chats`, `workspace_threads`, `workspace_parsed_files`, `desktop_mobile_devices`, `slash_command_presets` owner NULL → admin; single-user whitelist setting deleted | P-AUTH-05 | `server/endpoints/system.js:696-703` | no | the rollback cascade-deletes several of these |
| [SE-AUTH-16](01-auth-and-users.md) | DB | `recovery_codes` ×4, `users.seen_recovery_codes` | P-AUTH-06 | `server/utils/PasswordRecovery/index.js:23-28` | via reset |  |
| [SE-AUTH-18](01-auth-and-users.md) | DB | `temporary_auth_tokens` delete + create | P-AUTH-10 | `server/models/temporaryAuthToken.js:27,32` |  |  |
| [SE-AUTH-19](01-auth-and-users.md) | DB | `temporary_auth_tokens` delete | P-AUTH-11 | `server/models/temporaryAuthToken.js:98-99` |  |  |
| [SE-AUTH-22](01-auth-and-users.md) | DB | `invites` create | P-AUTH-12 | `server/models/invite.js:12` | disable |  |
| [SE-AUTH-24](01-auth-and-users.md) | DB | `users`, `invites`, `workspace_users` | P-AUTH-13 | `server/endpoints/invite.js:65,76`; `server/models/invite.js:46,61` | delete user |  |
| [SE-AUTH-26](01-auth-and-users.md) | DB | `invites.status=disabled` | P-AUTH-14 | `server/models/invite.js:33` | no |  |
| [SE-AUTH-28](01-auth-and-users.md) | DB | `users` create | P-AUTH-15 | `server/models/user.js:126` | delete |  |
| [SE-AUTH-30](01-auth-and-users.md) | DB | `users.*` | P-AUTH-16 | `server/models/user.js:201` | yes |  |
| [SE-AUTH-32](01-auth-and-users.md) | DB | `browser_extension_api_keys` delete; `workspace_chats` detach; `users` delete + cascades | P-AUTH-17 | `server/endpoints/admin.js:144-145`; `server/models/user.js:313-319` | **no** |  |
| [SE-AUTH-34](01-auth-and-users.md) | DB | `users`, `invites` | P-AUTH-18 | `server/endpoints/api/admin/index.js:135,207,258,364,424` |  |  |
| [SE-AUTH-36](01-auth-and-users.md) | DB | `users.username/password/bio` | P-AUTH-19 | `server/endpoints/system.js:1291` |  |  |
| [SE-AUTH-38](01-auth-and-users.md) | DB | `users.pfpFilename` | P-AUTH-20 | `server/endpoints/system.js:867,954` |  |  |
| [SE-AUTH-39](01-auth-and-users.md) | DB | `password_reset_tokens` create | P-AUTH-21 | `server/models/passwordRecovery.js:81` | expires | no LOG |
| [SE-AUTH-40](01-auth-and-users.md) | DB | `users.password`, `users.seen_recovery_codes`; delete `password_reset_tokens`, `recovery_codes` | P-AUTH-22 | `server/utils/PasswordRecovery/index.js:87-99` | no |  |
| [SE-AUTH-41](01-auth-and-users.md) | DB | `api_keys` create/delete | P-AUTH-23/24 | `server/models/apiKeys.js:16,53` |  | plaintext secret |
| [SE-AUTH-43](01-auth-and-users.md) | DB | `browser_extension_api_keys` create/delete | P-AUTH-26/27 | `server/models/browserExtensionApiKey.js:22,79` |  | LOG: see SE-AUTH-51 |
| [SE-AUTH-45](01-auth-and-users.md) | DB | `desktop_mobile_devices` create | P-AUTH-28 | `server/models/mobileDevice.js:125` | delete | no LOG |
| [SE-AUTH-46](01-auth-and-users.md) | DB | `desktop_mobile_devices.approved` / delete | P-AUTH-29 | `server/models/mobileDevice.js:160,192` |  | no LOG |
| [SE-AUTH-47](01-auth-and-users.md) | DB | `api_keys.lastUsedAt` (at most once a minute per key) | P-AUTH-31 | `server/utils/middleware/validApiKey.js:156` | overwritten | fire-and-forget |
| [SE-AUTH-49](01-auth-and-users.md) | DB | `api_keys` create / `user_id`, `workspace_ids`, `expiresAt` update | P-AUTH-32 | `server/models/apiKeys.js:19,103` | yes | LOG `api_key_created`, `api_key_updated` |
| [SE-AUTH-50](01-auth-and-users.md) | DB | `access_policies` create/update/delete; `users.policy_id`, `teams.policy_id` → null on delete | P-AUTH-33 | `server/models/accessPolicy.js` | delete is not | LOG `policy_*` |
| [SE-AUTH-51](01-auth-and-users.md) | DB | `users.policy_id` set/cleared | P-AUTH-33 | `server/endpoints/accessPolicies.js:139` | yes | LOG `policy_assigned` |
| [SE-AUTH-52](01-auth-and-users.md) | DB | `teams` create/update/delete; delete resets `workspaces.team_id`, preset and variable `team_id`, drops `team_members` | P-AUTH-34 | `server/models/team.js:309` | delete is not | LOG `team_*` |
| [SE-AUTH-53](01-auth-and-users.md) | DB | `team_members` create/delete, `role` update | P-AUTH-35 | `server/models/team.js:184,223,263` | yes | LOG `team_member_added/removed`, `team_lead_changed` |
| [SE-AUTH-57](01-auth-and-users.md) | DB | `users` create, `user_identities` create/update, `invites` claim, `temporary_auth_tokens` replace | P-AUTH-37 | `server/utils/auth/oidc.js:209-296`; `server/models/userIdentity.js:16-60` | delete user (cascades identity) |  |
| [SE-AUTH-59](01-auth-and-users.md) | DB | `system_settings.oidc_*` upsert in one transaction | P-AUTH-38 | `server/utils/auth/oidcSettings.js:232-271` | yes | secret encrypted |
| [SE-CHAT-01](02-workspaces-and-chat.md) | DB | `workspaces`, `workspace_users` | P-CHAT-02 | `workspace.js:221-233` | yes (delete) |  |
| [SE-CHAT-04](02-workspaces-and-chat.md) | DB | `workspaces` | P-CHAT-03 | `workspace.js:283` | manually |  |
| [SE-CHAT-05](02-workspaces-and-chat.md) | DB | `prompt_history` | P-CHAT-03 | `promptHistory.js:115` | yes (P-CHAT-07) | stores previous prompt |
| [SE-CHAT-07](02-workspaces-and-chat.md) | DB | `workspace_chats` hard delete | P-CHAT-04 | `workspaces.js:320` | no | lowers quota counts |
| [SE-CHAT-08](02-workspaces-and-chat.md) | DB | `document_vectors`, `workspace_documents`, `workspaces` + cascades | P-CHAT-04 | `workspaces.js:321-323` | no | no transaction |
| [SE-CHAT-11](02-workspaces-and-chat.md) | DB | `workspace_users` delete + create | P-CHAT-05 | `workspace.js:500-501` | manually | no transaction |
| [SE-CHAT-12](02-workspaces-and-chat.md) | DB | `workspace_suggested_messages` replace | P-CHAT-06 | `workspacesSuggestedMessages.js:38-53` | no | errors swallowed |
| [SE-CHAT-13](02-workspaces-and-chat.md) | DB | `prompt_history` delete | P-CHAT-07 | `workspace.js:636-659` | no |  |
| [SE-CHAT-14](02-workspaces-and-chat.md) | DB | `system_prompt_variables` | P-CHAT-08 | `system.js:1460`, `1496`, `1529` | yes | global effect on every prompt |
| [SE-CHAT-15](02-workspaces-and-chat.md) | DB | `slash_command_presets` | P-CHAT-09 | `system.js:1340`, `1387`, `1418` | yes |  |
| [SE-CHAT-17](02-workspaces-and-chat.md) | DB | `workspace_chats` refusal row `include=false` | P-CHAT-10 S5/S7 | `stream.js:124`, `257` | no | counts toward quota |
| [SE-CHAT-18](02-workspaces-and-chat.md) | DB | `workspace_chats` pending row | P-CHAT-10 S8 | `stream.js:275` | hide only | survives failures |
| [SE-CHAT-20](02-workspaces-and-chat.md) | DB | `memories.lastUsedAt` | P-CHAT-10 S9 | `memories/index.js:51`, `memory.js:257-267` | no | not awaited |
| [SE-CHAT-23](02-workspaces-and-chat.md) | DB | `workspace_chats` upsert | P-CHAT-10 S11 | `stream.js:373-375` | hide only |  |
| [SE-CHAT-25](02-workspaces-and-chat.md) | DB | `workspace_threads.name`, `rename_thread` chunk | P-CHAT-11 | `workspaceThread.js:166-170`, `chat.js:175-183` | yes |  |
| [SE-CHAT-26](02-workspaces-and-chat.md) | DB | `workspace_chats.include=false` | P-CHAT-12 | `commands/reset.js:11-17` | no |  |
| [SE-CHAT-28](02-workspaces-and-chat.md) | DB | image generation; file in generated-images folder; chat row | P-CHAT-13 | `commands/img.js:89-121` | no | FS write inside `ImageGenerators` (unverified) |
| [SE-CHAT-29](02-workspaces-and-chat.md) | DB | `workspace_agent_invocations`; attachment/effort maps; init chunk | P-CHAT-14 | `agents.js:75-125` | n/a | map entries can leak |
| [SE-CHAT-33](02-workspaces-and-chat.md) | DB | `workspace_chats.include=false` | P-CHAT-17 | `workspaces.js:500` | no |  |
| [SE-CHAT-34](02-workspaces-and-chat.md) | DB | `workspace_chats.prompt/response`, or `include=false` tail | P-CHAT-18 | `workspaces.js:529-576`, `workspaceThreads.js:211-262` | no | no edit history |
| [SE-CHAT-35](02-workspaces-and-chat.md) | DB | `workspace_chats.feedbackScore` | P-CHAT-19 | `workspaceChats.js:271` | yes |  |
| [SE-CHAT-36](02-workspaces-and-chat.md) | DB | `workspace_chats.include=false` | P-CHAT-20 | `workspaces.js:824` | no |  |
| [SE-CHAT-37](02-workspaces-and-chat.md) | DB | `workspace_threads`; `workspace_thread_created` telemetry; `audit_events: thread.created` | P-CHAT-21 | `server/endpoints/workspaceThreads.js:34-57` (audit at `:53`) | yes |  |
| [SE-CHAT-38](02-workspaces-and-chat.md) | DB | `workspace_threads.name` | P-CHAT-22 | `workspaceThread.js:68` | yes |  |
| [SE-CHAT-39](02-workspaces-and-chat.md) | DB | chats hidden; threads + parsed-file rows deleted | P-CHAT-23 | `workspaceThread.js:101-107` | no | parsed-file files on disk untouched (unverified) |
| [SE-CHAT-40](02-workspaces-and-chat.md) | DB | thread + copied chats; `audit_events: thread.forked` | P-CHAT-24 | `server/endpoints/workspaces.js:766-799`; audit at `:929` | partly | uses up quota |
| [SE-CHAT-41](02-workspaces-and-chat.md) | DB | `workspace_chats` hard delete (one or all) | P-CHAT-26 | `system.js:1224-1226` | no | not gated by `chatHistoryViewable` |
| [SE-CHAT-45](02-workspaces-and-chat.md) | DB | `model_routers`, `model_router_rules` | P-CHAT-28 | `modelRouter.js:51`, `212`, `236`; `modelRouterRule.js:77`, `194`, `213`, `229` | yes |  |
| [SE-CHAT-49](02-workspaces-and-chat.md) | DB | `workspaces` create with `team_id`, `team_id` change, lead settings update | P-CHAT-32 | `server/endpoints/teams.js:103,332,363` | yes | LOG `team_workspace_*`, `workspace_team_changed` |
| [SE-CHAT-50](02-workspaces-and-chat.md) | DB | `slash_command_presets.team_id`, `system_prompt_variables.team_id` | P-CHAT-33 | `server/endpoints/system.js` (preset and variable routes) | yes | no LOG |
| [SE-CHAT-51](02-workspaces-and-chat.md) | DB | `workspaces.router_id`/`chatProvider`/`agentProvider` cleared, `access_policies.router_id` → null, router deleted, in one transaction; `ModelRouterId` env cleared when it was the system router | router delete | `server/models/modelRouter.js:245`, `server/endpoints/modelRouter.js` | no | fixes F-50; LOG `model_router_deleted` |
| [SE-DOC-16](03-documents-and-ingestion.md) | DB | `workspace_documents`, `document_vectors`, `document_sync_queues` | P-DOC-09, -10, -12, -16, -18, -19 | `server/models/documents.js:179`, `:266-272`; `server/models/vectors.js:5`; `server/models/documentSyncQueue.js:108-118` | Yes |  |
| [SE-DOC-22](03-documents-and-ingestion.md) | DB | `system_settings.experimental_live_file_sync` | P-DOC-17 | `server/endpoints/experimental/liveSync.js:37-39` | Yes |  |
| [SE-DOC-28](03-documents-and-ingestion.md) | DB | `workspace_parsed_files` | P-DOC-20 | `server/endpoints/workspacesParsedFiles.js:202-209`; `server/models/workspaceParsedFiles.js:83-93` | Yes |  |
| [SE-AGENT-01](04-agents-tools-and-automation.md) | DB | `workspace_agent_invocations` create / `closed=true` | P-AGENT-01 | `models/workspaceAgentInvocation.js:12-39` | no (rows never deleted here) |  |
| [SE-AGENT-06](04-agents-tools-and-automation.md) | DB | `workspace_chats` pre-create + upsert; `workspace_threads` rename | P-AGENT-02 | `plugins/chat-history.js:50-57,113-128,149-168,191-202` | yes (delete chat) | empty row left if turn dies |
| [SE-AGENT-07](04-agents-tools-and-automation.md) | DB | `memories.lastUsedAt` | P-AGENT-02/32 | `utils/memories/index.js:51` | n/a | fire-and-forget |
| [SE-AGENT-08](04-agents-tools-and-automation.md) | DB | `system_settings` whitelist label upsert | P-AGENT-03 | `models/agentSkillWhitelist.js:41-67` | only bulk clear (`endpoints/system.js:703`) | per skill name, not per args |
| [SE-AGENT-11](04-agents-tools-and-automation.md) | DB | `workspace_chats` row with `apiSessionId` | P-AGENT-06 | `utils/chats/apiChatHandler.js:229-245` | yes | written by caller |
| [SE-AGENT-19](04-agents-tools-and-automation.md) | DB | chat `response.outputs` reference (authorizes download) | P-AGENT-14/15 | `create-files/lib.js:151-166`; `generate-image.js:47-54` | yes |  |
| [SE-AGENT-26](04-agents-tools-and-automation.md) | DB | Graph calls; token refresh writes `system_settings.outlook_agent_config` | P-AGENT-19 | `outlook/lib.js:466-467,691-757`; gated writes `outlook-create-draft.js:135`, `outlook-update-draft.js:81`, `outlook-delete-draft.js:46`, `outlook-send-draft.js:44`, `outlook-send-email.js:134` | send: no |  |
| [SE-AGENT-27](04-agents-tools-and-automation.md) | DB | `outlook_agent_config` save/delete; code→token exchange | P-AGENT-20 | `outlookAgentUtils.js:70,111,179`; `outlook/lib.js:611-680` | yes (revoke) | no OAuth `state` |
| [SE-AGENT-28](04-agents-tools-and-automation.md) | DB | `scheduled_jobs` create; `later` timer; `scheduledJobCreated` | P-AGENT-21 | `create-scheduled-job/index.js:172-206` | yes (delete job) | gated |
| [SE-AGENT-36](04-agents-tools-and-automation.md) | DB | `workspaces.openAiPrompt` overwrite; `slash_command_presets` create; hub key | P-AGENT-27 | `models/communityHub.js:109-154`; `endpoints/communityHub.js:34-46` | prompt: no history |  |
| [SE-AGENT-37](04-agents-tools-and-automation.md) | DB | `scheduled_jobs` CRUD; timer add/remove; queued runs failed | P-AGENT-28 | `endpoints/scheduledJobs.js:142-331`; `BackgroundWorkers/index.js:301-356` | delete: no |  |
| [SE-AGENT-39](04-agents-tools-and-automation.md) | DB | `scheduled_job_runs` transitions; `scheduled_jobs.lastRunAt/nextRunAt` | P-AGENT-29 | `scheduledJobRun.js:32-240`; `scheduledJob.js:254-275` | no | result holds full trace incl. tool args/results |
| [SE-AGENT-41](04-agents-tools-and-automation.md) | DB | `readAt`; `scheduled-jobs` workspace/thread/chat created; SIGTERM workers | P-AGENT-30 | `scheduledJobRun.js:329-385`; `BackgroundWorkers/index.js:368-382` | yes (delete) |  |
| [SE-AGENT-43](04-agents-tools-and-automation.md) | DB | `memories` create/update/delete/promote/demote; `workspace_chats.memoryProcessed` | P-AGENT-31/32 | `models/memory.js:98-260,345`; `models/workspaceChats.js:306` | yes (UI delete) |  |
| [SE-AGENT-45](04-agents-tools-and-automation.md) | DB | `users.web_push_subscription_config` or `storage/push-notifications/primary-subscription.json`; `vapid-keys.json` at boot | P-AGENT-33 | `PushNotifications/index.js:146-166,201-222` | overwrite |  |
| [SE-AGENT-50](04-agents-tools-and-automation.md) | DB | `system_settings.agent_tool_role_policy` upsert | P-AGENT-39 | `server/endpoints/accessPolicies.js:187` | yes | LOG `role_default_updated` |
| [SE-AGENT-51](04-agents-tools-and-automation.md) | DB | `access_policies.agent_tools` update / policy create, `teams.policy_id` set | P-AGENT-39 | `server/utils/accessPolicy/toolSharing.js:108` | yes | LOG `policy_updated` |
| [SE-EXT-01](05-external-channels.md) | DB | users (create/update/delete) | P-EXT-03 | `api/admin/index.js:135`, `:207`, `:258` | Delete: no | Create not recorded; the route is held for the Google sign-in branch (F-55) |
| [SE-EXT-03](05-external-channels.md) | DB | invites | P-EXT-04 | `api/admin/index.js:364`, `:424` | Yes (soft) |  |
| [SE-EXT-04](05-external-channels.md) | DB | workspace_users | P-EXT-05 | `api/admin/index.js:551`, `:648`, `:665` | Yes | No LOG |
| [SE-EXT-05](05-external-channels.md) | DB | system_settings | P-EXT-06 | `api/admin/index.js:781` | Yes |  |
| [SE-EXT-10](05-external-channels.md) | DB | documents purge; `audit_events: document.deleted` at `api/system/index.js:286` | P-EXT-08 | `api/system/index.js:274` | No | Sequential, partial on error |
| [SE-EXT-11](05-external-channels.md) | DB | temporary auth token | P-EXT-09 | `api/userManagement/index.js:109` | Expires | No LOG |
| [SE-EXT-12](05-external-channels.md) | DB | workspaces create/update | P-EXT-10 | `api/workspace/index.js:80`, `:345` | Yes |  |
| [SE-EXT-13](05-external-channels.md) | DB | workspace delete cascade | P-EXT-10 | `api/workspace/index.js:258-267` | No | Not transactional |
| [SE-EXT-15](05-external-channels.md) | DB | workspace_documents | P-EXT-11 | `api/workspace/index.js:521-522` | Yes | Errors not surfaced |
| [SE-EXT-16](05-external-channels.md) | DB | workspace_documents.pinned | P-EXT-11 | `api/workspace/index.js:591` | Yes |  |
| [SE-EXT-17](05-external-channels.md) | DB | workspace_chats insert | P-EXT-12/13/16/38 | `apiChatHandler.js:230`, `:283`, `:410`, `:477`, `:884` | Soft (reset) | user per channel |
| [SE-EXT-18](05-external-channels.md) | DB | workspace_chats.include → false | P-EXT-12/13/16 | `apiChatHandler.js:160-165`, `:537-542` | No API to undo | Instance-wide on default thread without sessionId |
| [SE-EXT-24](05-external-channels.md) | DB | workspace_threads | P-EXT-15 | `api/workspaceThread/index.js:87`, `:184`, `:233` | Delete: no | userId unvalidated |
| [SE-EXT-25](05-external-channels.md) | DB | thread auto-rename | P-EXT-16/38 | `api/workspaceThread/index.js:458`; `mobile/utils/index.js:192` | Yes |  |
| [SE-EXT-28](05-external-channels.md) | DB | addToWorkspaces | P-EXT-17/18 | `api/document/index.js:166`, `:481`, `:652` | Yes | Partial success possible |
| [SE-EXT-32](05-external-channels.md) | DB | embed_configs (+cascade embed_chats); `audit_events: embed.created` / `embed.updated` / `embed.deleted` (F-55, dcc0e052) | P-EXT-21 | `api/embed/index.js:275`, `:349`, `:397`; audit at `:309`, `:396`, `:462` | Delete: no |  |
| [SE-EXT-36](05-external-channels.md) | DB | embed_chats insert (Origin, IP, username) | P-EXT-27 | `embed.js:232-243` | Soft | Only if non-empty |
| [SE-EXT-38](05-external-channels.md) | DB | embed_chats.include → false | P-EXT-28 | `embedChats.js:94-101` | No |  |
| [SE-EXT-39](05-external-channels.md) | DB | embed config CRUD; `audit_events: embed.created` / `embed.updated` / `embed.deleted` | P-EXT-29 | `embedManagement.js:54`, `:85`, `:120` | Delete: no |  |
| [SE-EXT-40](05-external-channels.md) | DB | connector upsert/delete (encrypted token) | P-EXT-30 | `telegram.js:132-139`, `:168` | Yes |  |
| [SE-EXT-44](05-external-channels.md) | DB | `approved_users` and per-chat state JSON | P-EXT-31/32/34 | `verification.js:113`, `:159`; `telegramBot/index.js:381` | Yes |  |
| [SE-EXT-47](05-external-channels.md) | DB | workspace_chats insert (no user) | P-EXT-33 | `telegramBot/chat/stream.js:329-340` | Soft |  |
| [SE-EXT-49](05-external-channels.md) | DB | Workspace.new / chatModel / thread / reset | P-EXT-34 | `handleWorkspaceCreate.js:13`; `handleModelSelect.js:42`; `handleNewThread.js:17`; `handleReset.js:19` | Yes | Model change is global |
| [SE-EXT-50](05-external-channels.md) | DB | connector delete in multi-user | P-EXT-35 | `telegramBot/index.js:427` | No |  |
| [SE-EXT-52](05-external-channels.md) | DB | desktop_mobile_devices create/approve/delete | P-EXT-36/39 | `mobile/index.js:127`, `:46`, `:75`; `mobile/utils/index.js:213` | Yes | No LOG (mobile routes pending the access-policy branch) |
| [SE-EXT-53](05-external-channels.md) | DB | reset-chat / new-thread | P-EXT-37 | `mobile/utils/index.js:129`, `:145` | Soft |  |
| [SE-EXT-54](05-external-channels.md) | DB | browser_extension_api_keys; `audit_events: extension_key.created` / `extension_key.deleted` | P-EXT-40/41 | `browserExtension.js:181`, `:213`, `:51`; audit at `:240`, `:282`, `:57` | Delete: no |  |
| [SE-EXT-55](05-external-channels.md) | DB | add document to workspace; `audit_events: document.uploaded` / `document.embedded` | P-EXT-42 | `browserExtension.js:98-112`; audit at `:135`, `:149`, `:190` | Yes |  |
| [SE-EXT-57](05-external-channels.md) | DB | push subscription | P-EXT-43 | `PushNotifications/index.js:148-163` | Overwrite | One per user |
| [SE-EXT-58](05-external-channels.md) | DB | `workspace_chats` rows now carry the key owner's `user_id` | P-EXT-44/45 | `server/utils/chats/apiChatHandler.js`, `server/utils/chats/openaiCompatible.js` | no |  |
| [SE-EXT-59](05-external-channels.md) | DB | `workspace_threads.user_id` = key owner on thread create | P-EXT-44 | `server/endpoints/api/workspaceThread/index.js` | yes |  |
| [SE-EXT-60](05-external-channels.md) | DB | `desktop_mobile_devices.userId` = chosen user | P-EXT-46 | `server/endpoints/mobile/index.js` | revoke device |  |
| [SE-ADMIN-03](06-admin-system-and-runtime.md) | DB | `system_settings.__migration_web_browser_to_default`, `default_agent_skills`, `disabled_agent_skills` | P-ADMIN-01 | `server/utils/boot/migrateWebBrowsingToDefault.js:50-90` | manual | one-time |
| [SE-ADMIN-04](06-admin-system-and-runtime.md) | DB | `system_settings.onboarding_complete` | P-ADMIN-01 | `server/utils/boot/markOnboarded.js:19` | no |  |
| [SE-ADMIN-05](06-admin-system-and-runtime.md) | DB | `system_settings.telemetry_id` | P-ADMIN-01, P-ADMIN-32 | `server/models/telemetry.js:133-145` | yes (admin can overwrite) |  |
| [SE-ADMIN-08](06-admin-system-and-runtime.md) | DB | `scheduled_job_runs` non-terminal → failed | P-ADMIN-01 | `server/utils/BackgroundWorkers/index.js:115` | no | also on every `bootWorkers()` |
| [SE-ADMIN-14](06-admin-system-and-runtime.md) | DB | Prisma `migrate deploy` | P-ADMIN-02 | `docker/docker-entrypoint.sh:24` | no |  |
| [SE-ADMIN-23](06-admin-system-and-runtime.md) | DB | `document_vectors`, `workspace_documents` all rows | P-ADMIN-08, P-ADMIN-09 | `server/utils/vectorStore/resetAllVectorStores.js:21-22` | no | re-embed required |
| [SE-ADMIN-31](06-admin-system-and-runtime.md) | DB | `system_settings.<label>` upsert | P-ADMIN-14 | `server/models/systemSettings.js:743-757` | yes | `audit_events: settings.changed` per changed label (`server/models/systemSettings.js:794`); free text is named, not stored |
| [SE-ADMIN-36](06-admin-system-and-runtime.md) | DB | `storage/assets/*`, `logo_filename` | P-ADMIN-16 | `server/endpoints/system.js:989-995,1026-1030` | yes (re-upload) |  |
| [SE-ADMIN-38](06-admin-system-and-runtime.md) | DB | `experimental_live_file_sync`, `experimental_feature_enabled`; `audit_events: feature.toggled` | P-ADMIN-19 | `server/endpoints/experimental/liveSync.js:36-45`, audit at `:52` | yes |  |
| [SE-ADMIN-41](06-admin-system-and-runtime.md) | DB | `outlook_agent_config` create/delete | P-ADMIN-21 | `server/endpoints/utils/outlookAgentUtils.js:21-187` | yes | single-user only |
| [SE-ADMIN-43](06-admin-system-and-runtime.md) | DB | `users`, `system_settings.multi_user_mode`, ownership columns in 7 tables, whitelist delete | P-ADMIN-24 | `server/endpoints/system.js:679-703` | no | catch deletes all users |
| [SE-ADMIN-46](06-admin-system-and-runtime.md) | DB | legacy `event_logs` deleteMany + `audit_events: audit.cleared` (legacy `event_logs_cleared`) | P-ADMIN-25 | `server/endpoints/system.js:1351-1358`; `server/models/eventLogs.js:152-163` | no | `audit_events` rows survive; route removal planned for PR B (F-54) |
| [SE-ADMIN-47](06-admin-system-and-runtime.md) | DB | `workspace_chats` deleteMany (one or all); `audit_events: chat.deleted` / `chat.bulk_deleted` | P-ADMIN-26 | `server/endpoints/system.js:1425,1431` | no |  |
| [SE-ADMIN-49](06-admin-system-and-runtime.md) | DB | system prompt variables | P-ADMIN-27 | `server/endpoints/system.js:1460,1496,1529` | yes |  |
| [SE-ADMIN-51](06-admin-system-and-runtime.md) | DB | scheduled job / embedding / telegram workers | P-ADMIN-31 | `server/utils/BackgroundWorkers/index.js:219-236,439-475` | n/a |  |
| [SE-ADMIN-55](06-admin-system-and-runtime.md) | DB | `audit_events` row per `audit.record` | P-ADMIN-35 | `server/utils/audit/index.js` | no (no delete path in the app) |  |
| [SE-ADMIN-57](06-admin-system-and-runtime.md) | DB | `audit_events: db.write` backstop row for a sensitive-table write with no covering action | P-ADMIN-35 | `server/utils/audit/backstop.js`; `server/utils/prisma/index.js:14` | no | a row here means a missing catalogue event |

## FS

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-AUTH-37](01-auth-and-users.md) | FS | `STORAGE_DIR/assets/pfp/<uuid>` written; old file unlinked (wrong dir outside development) | P-AUTH-20 | `server/utils/files/multer.js:68-84`; `server/endpoints/system.js:857-864,944-951` |  | orphans files |
| [SE-CHAT-28](02-workspaces-and-chat.md) | FS | image generation; file in generated-images folder; chat row | P-CHAT-13 | `commands/img.js:89-121` | no | FS write inside `ImageGenerators` (unverified) |
| [SE-DOC-01](03-documents-and-ingestion.md) | FS | `collector/hotdir/<8hex>-<name>` | P-DOC-01, P-DOC-04, P-DOC-11, P-DOC-20 | `server/utils/files/multer.js:11-25` | Deleted by converter or collector boot | No size limit |
| [SE-DOC-03](03-documents-and-ingestion.md) | FS | `storage/documents/<folder>/*.json` | all ingestion paths | `collector/utils/files/index.js:140-142` | Purge | Written by collector process |
| [SE-DOC-11](03-documents-and-ingestion.md) | FS | credential persisted (AES) inside `chunkSource` | P-DOC-05, P-DOC-07 | `GithubRepo/index.js:146-158`; `Confluence/index.js:303`; `PaperlessNgx/index.js:114-121` | Purge doc | Copies in JSON, DB, vectors, cache |
| [SE-DOC-15](03-documents-and-ingestion.md) | FS | `storage/vector-cache/<uuidv5(docpath)>.json` | P-DOC-09, P-DOC-19 | `server/utils/files/index.js:290-301` | Purge | Holds full chunk text |
| [SE-DOC-19](03-documents-and-ingestion.md) | FS | delete JSON, cache, folder | P-DOC-12, P-DOC-13 | `server/utils/files/index.js:304-331`; `purgeDocument.js:81` | No |  |
| [SE-DOC-20](03-documents-and-ingestion.md) | FS | mkdir / rename under `documents` | P-DOC-14 | `server/endpoints/document.js:46`, `:92` | Yes |  |
| [SE-DOC-21](03-documents-and-ingestion.md) | FS | wipe `storage/vector-cache` | P-DOC-15 (global) | `server/utils/files/index.js:805-809` | No | Also on chunk-size/overlap writes |
| [SE-DOC-26](03-documents-and-ingestion.md) | FS | overwrite `storage/documents/<docpath>` | P-DOC-19 | `server/jobs/helpers/index.js:53-55` | No | Adds `docId` field to JSON |
| [SE-DOC-27](03-documents-and-ingestion.md) | FS | `storage/direct-uploads/*.json` | P-DOC-20, E-DOC-43 | `collector/utils/files/index.js:130` | Orphan job |  |
| [SE-DOC-30](03-documents-and-ingestion.md) | FS | delete in `storage/direct-uploads` | P-DOC-23 | `server/jobs/cleanup-orphan-documents.js:17-23` | No |  |
| [SE-DOC-31](03-documents-and-ingestion.md) | FS | `storage/comkey/ipc-{priv,pub}.pem` | P-DOC-25 | `server/utils/comKey/index.js:53-62` | Rolled each boot |  |
| [SE-DOC-33](03-documents-and-ingestion.md) | FS | wipe `collector/hotdir`, `collector/storage/tmp` | P-DOC-25 | `collector/utils/files/index.js:157-193` | No |  |
| [SE-AGENT-17](04-agents-tools-and-automation.md) | FS | `storage/anythingllm-fs/**` write/edit/mkdir/move/copy | P-AGENT-13 | `filesystem/write-text-file.js:61`, `edit-file.js:95`, `create-directory.js:52`, `move-file.js:64`, `copy-file.js:93`; root `filesystem/lib.js:53-87` | no (overwrite) | gated |
| [SE-AGENT-18](04-agents-tools-and-automation.md) | FS | `storage/generated-files/<type>-<uuid>.<ext>` | P-AGENT-14 | `create-files/lib.js:213-231` | swept by SE-AGENT-46 | gated per file |
| [SE-AGENT-22](04-agents-tools-and-automation.md) | FS | image generation/edit; `storage/generated-images` | P-AGENT-15 | `generate-image.js:135-155`; `ImageGenerators/index.js:3-41` | swept by SE-AGENT-46 | ungated |
| [SE-AGENT-24](04-agents-tools-and-automation.md) | FS | attachment temp file in `os.tmpdir()`, deleted after parse | P-AGENT-17/19 | `gmail/lib.js:75-95`; `outlook/lib.js:278-295` | yes (auto) | left behind if collector call throws before unlink **(unverified)** |
| [SE-AGENT-31](04-agents-tools-and-automation.md) | FS | `storage/plugins/anythingllm_mcp_servers.json` rewrite | P-AGENT-23/24 | `MCP/hypervisor/index.js:123-230` | yes |  |
| [SE-AGENT-32](04-agents-tools-and-automation.md) | FS | `storage/plugins/agent-flows/<uuid>.json` write/delete | P-AGENT-25 | `agentFlows/index.js:101-170` | delete: no |  |
| [SE-AGENT-34](04-agents-tools-and-automation.md) | FS | hub API (`hub.external.anythingllm.com`), zip download, extract to `storage/plugins/agent-skills/<hubId>` | P-AGENT-26/27 | `models/communityHub.js:8-12,38-210`; `agents/imported.js:254-363` | delete endpoint |  |
| [SE-AGENT-46](04-agents-tools-and-automation.md) | FS | delete unreferenced files > 1 h in `storage/generated-files`, `storage/generated-images` | P-AGENT-34 | `jobs/cleanup-generated-files.js:22-51`; `jobs/cleanup-generated-images.js:18-45` | no | partial scan error → over-deletion |
| [SE-EXT-10](05-external-channels.md) | FS | documents purge; `audit_events: document.deleted` at `api/system/index.js:286` | P-EXT-08 | `api/system/index.js:274` | No | Sequential, partial on error |
| [SE-EXT-19](05-external-channels.md) | FS | collector hotdir attachment | P-EXT-12/13 | `apiChatHandler.js:89` | Collector consumes |  |
| [SE-EXT-26](05-external-channels.md) | FS | hotdir upload, storage/documents | P-EXT-17/18 | `multer.js:31-37`; `api/document/index.js:144`, `:308` | Yes (delete doc) |  |
| [SE-EXT-31](05-external-channels.md) | FS | folder mkdir / purge / rename | P-EXT-20 | `api/document/index.js:1036`, `:1093`, `:1179` | Partly | Batch move not atomic |
| [SE-EXT-33](05-external-channels.md) | FS | MCP config file, spawn server | P-EXT-22 | `server/utils/MCP/index.js:320-348`; `hypervisor/index.js:528` | Yes | Arbitrary command |
| [SE-EXT-35](05-external-channels.md) | FS | generate/edit image, save | P-EXT-26 | `ImageGenerators/index.js:14-16` | Yes |  |
| [SE-EXT-55](05-external-channels.md) | FS | add document to workspace; `audit_events: document.uploaded` / `document.embedded` | P-EXT-42 | `browserExtension.js:98-112`; audit at `:135`, `:149`, `:190` | Yes |  |
| [SE-EXT-57](05-external-channels.md) | FS | push subscription | P-EXT-43 | `PushNotifications/index.js:148-163` | Overwrite | One per user |
| [SE-ADMIN-01](06-admin-system-and-runtime.md) | FS | `storage/comkey/ipc-{priv,pub}.pem` | P-ADMIN-01 | `server/utils/comKey/index.js:53-62` | n/a (rolled each boot) | collector trusts new key |
| [SE-ADMIN-02](06-admin-system-and-runtime.md) | FS | `SIG_KEY`, `SIG_SALT`, `server/.env` | P-ADMIN-01 | `server/utils/EncryptionManager/index.js:38-42` | no (losing them breaks decryption of stored secrets) | runs at require time and in any `NODE_ENV` |
| [SE-ADMIN-07](06-admin-system-and-runtime.md) | FS | `storage/models/pricing/*` | P-ADMIN-01 | `server/utils/helpers/modelPricing/index.js:180-193,237` | yes | 3-day cache |
| [SE-ADMIN-11](06-admin-system-and-runtime.md) | FS | `vapid-keys.json` | P-ADMIN-01 | `server/utils/PushNotifications/index.js:205-216` | no (rotating breaks subscriptions) |  |
| [SE-ADMIN-15](06-admin-system-and-runtime.md) | FS | collector storage wipe | P-ADMIN-03 | `collector/index.js:227` | no |  |
| [SE-ADMIN-17](06-admin-system-and-runtime.md) | FS | `server/.env` rewrite | P-ADMIN-06, P-ADMIN-23, P-ADMIN-28 | `server/utils/helpers/updateENV.js:1599-1733` | no | drops non-allowlisted keys, truncates values |
| [SE-ADMIN-22](06-admin-system-and-runtime.md) | FS | `storage/vector-cache` purge | P-ADMIN-08, P-ADMIN-09 | `server/utils/vectorStore/resetAllVectorStores.js:20` | no |  |
| [SE-ADMIN-26](06-admin-system-and-runtime.md) | FS | native embedder model download | P-ADMIN-08 | `server/utils/helpers/updateENV.js:1440-1449` | yes |  |
| [SE-ADMIN-32](06-admin-system-and-runtime.md) | FS | `vector-cache` purge on chunk size/overlap save | P-ADMIN-14 | `server/models/systemSettings.js:127-128,142-143` | no | runs even if unchanged |
| [SE-ADMIN-36](06-admin-system-and-runtime.md) | FS | `storage/assets/*`, `logo_filename` | P-ADMIN-16 | `server/endpoints/system.js:989-995,1026-1030` | yes (re-upload) |  |
| [SE-ADMIN-42](06-admin-system-and-runtime.md) | FS | `AUTH_TOKEN`, `JWT_SECRET` | P-ADMIN-23 | `server/endpoints/system.js:634-654` | yes | invalidates sessions |
| [SE-ADMIN-44](06-admin-system-and-runtime.md) | FS | `JWT_SECRET` ensured | P-ADMIN-24 | `server/endpoints/system.js:704-709` | n/a |  |
| [SE-ADMIN-50](06-admin-system-and-runtime.md) | FS | direct uploads, generated files, generated images deleted | P-ADMIN-29 | `server/jobs/cleanup-orphan-documents.js:82`, `server/jobs/cleanup-generated-files.js:45-54`, `server/jobs/cleanup-generated-images.js:37-44` | no |  |
| [SE-ADMIN-54](06-admin-system-and-runtime.md) | FS | `storage/plugins/anythingllm_mcp_servers.json` created on first MCP use | P-ADMIN-01 | `server/utils/MCP/hypervisor/index.js:87-95` | yes | lazy, not at boot |
| [SE-ADMIN-56](06-admin-system-and-runtime.md) | FS | `storage/audit-outbox/<pid>.jsonl` append + fsync on a failed insert; flushed after 30 s and at boot | P-ADMIN-35 | `server/utils/audit/outbox.js`; `server/utils/audit/index.js:155-165` | yes | at-least-once |
| [SE-UI-06](07-frontend-routes-and-flows.md) | FS | `saveAs`: `recovery_codes.txt`, chat export, chart JPEG, generated files/images, chat log export, embed chat export | P-UI-04, P-UI-13, P-UI-27, P-UI-28, P-UI-34 | `DisplayRecoveryCodeModal/index.jsx:21`; `ChatSettingsMenu/Export/index.jsx:37`; `Chartable/index.jsx:55`; `FileDownloadCard/index.jsx:23`; `ImageGenerationCard/index.jsx:65`; `GeneralSettings/Chats/index.jsx:68`; `EmbedChats/index.jsx:65`; `ScheduledJobs/components/GeneratedFileCard.jsx:91` | no |  |

## VEC

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-CHAT-09](02-workspaces-and-chat.md) | VEC | namespace `slug` dropped | P-CHAT-04 | `workspaces.js:334` | no | errors swallowed |
| [SE-DOC-14](03-documents-and-ingestion.md) | VEC | namespace `<slug>` | P-DOC-09, -10, -12, -13, -15, -19 | `lance/index.js:255-270`, `:319`, `:297-300` | Re-embed |  |
| [SE-AGENT-15](04-agents-tools-and-automation.md) | VEC | `addDocumentToNamespace(workspace.slug)` | P-AGENT-10 | `plugins/memory.js:130-147` | no UI path found | ungated |
| [SE-EXT-10](05-external-channels.md) | VEC | documents purge; `audit_events: document.deleted` at `api/system/index.js:286` | P-EXT-08 | `api/system/index.js:274` | No | Sequential, partial on error |
| [SE-EXT-13](05-external-channels.md) | VEC | workspace delete cascade | P-EXT-10 | `api/workspace/index.js:258-267` | No | Not transactional |
| [SE-EXT-15](05-external-channels.md) | VEC | workspace_documents | P-EXT-11 | `api/workspace/index.js:521-522` | Yes | Errors not surfaced |
| [SE-EXT-28](05-external-channels.md) | VEC | addToWorkspaces | P-EXT-17/18 | `api/document/index.js:166`, `:481`, `:652` | Yes | Partial success possible |
| [SE-EXT-55](05-external-channels.md) | VEC | add document to workspace; `audit_events: document.uploaded` / `document.embedded` | P-EXT-42 | `browserExtension.js:98-112`; audit at `:135`, `:149`, `:190` | Yes |  |
| [SE-ADMIN-24](06-admin-system-and-runtime.md) | VEC | every workspace namespace / pgvector table | P-ADMIN-08, P-ADMIN-09 | `server/utils/vectorStore/resetAllVectorStores.js:33-49` | no | previous DB for VectorDB change |
| [SE-ADMIN-53](06-admin-system-and-runtime.md) | VEC | arbitrary vector DB command | P-ADMIN-34 | `server/index.js:163-178` | no | development only |

## NET

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-UI-22](07-frontend-routes-and-flows.md) | NET:anythingllm-server | `GET /utils/metrics` app version, cached | P-UI-01 | `models/system.js:833-852`; `server/endpoints/utils.js:16` | n/a | public |
| [SE-UI-12](07-frontend-routes-and-flows.md) | NET:anythingllm-server (SSE) | stream-chat | P-UI-11 | `models/workspace.js:184`; `models/workspaceThread.js:111` | no | `openWhenHidden: true` |
| [SE-AGENT-20](04-agents-tools-and-automation.md) | NET:arbitrary-host | docx embedded image fetch | P-AGENT-14 | `create-files/docx/utils.js:188-201` | no | model-chosen URL from the server |
| [SE-AGENT-33](04-agents-tools-and-automation.md) | NET:arbitrary-host | flow `apiCall` fetch | P-AGENT-25 | `agentFlows/executors/api-call.js:50` | no | ungated |
| [SE-ADMIN-13](06-admin-system-and-runtime.md) | NET:cdn | embedded Lemonade install/spawn | P-ADMIN-01, P-ADMIN-07, P-ADMIN-12 | `server/utils/AiProviders/embeddedLemonade/endpoints.js:24`, `engine.js:132-151,194` | yes | Docker + flag only |
| [SE-DOC-02](03-documents-and-ingestion.md) | NET:collector | `http://127.0.0.1:8888` | all ingestion paths | `server/utils/collectorApi/index.js:126-147`, `:167`, `:202`, `:267`, `:307`, `:350` | n/a | Signed body carries `openAiKey` and generic Whisper key in plaintext |
| [SE-DOC-25](03-documents-and-ingestion.md) | NET:collector | `/ext/resync-source-document` | P-DOC-19 | `server/jobs/sync-watched-documents.js:58-62` | No | Decrypts stored credentials |
| [SE-AGENT-14](04-agents-tools-and-automation.md) | NET:collector | `CollectorApi.getLinkContent` / `parseDocument` | P-AGENT-09, Gmail/Outlook attachments, imported skills | `web-scraping.js:101-102`; `gmail/lib.js:87-90`; `outlook/lib.js:278-300` | no | collector then fetches the URL |
| [SE-EXT-20](05-external-channels.md) | NET:collector | parse attachment | P-EXT-12/13 | `apiChatHandler.js:91` | n/a |  |
| [SE-EXT-27](05-external-channels.md) | NET:collector | process document/link/text | P-EXT-17/18/42 | `api/document/index.js:144`, `:453`, `:634`; `browserExtension.js:98` | n/a | Link fetch is outbound to any URL |
| [SE-AGENT-34](04-agents-tools-and-automation.md) | NET:community-hub | hub API (`hub.external.anythingllm.com`), zip download, extract to `storage/plugins/agent-skills/<hubId>` | P-AGENT-26/27 | `models/communityHub.js:8-12,38-210`; `agents/imported.js:254-363` | delete endpoint |  |
| [SE-CHAT-19](02-workspaces-and-chat.md) | NET:embedder | query embedding for similarity search | P-CHAT-10 S6 | `stream.js:196-204` | n/a | (unverified: embedder-dependent) |
| [SE-EXT-15](05-external-channels.md) | NET:embedder | workspace_documents | P-EXT-11 | `api/workspace/index.js:521-522` | Yes | Errors not surfaced |
| [SE-EXT-34](05-external-channels.md) | NET:embedder | embed chunks | P-EXT-25 | `api/openai/index.js:335` | n/a |  |
| [SE-DOC-13](03-documents-and-ingestion.md) | NET:embedding-provider / PROC native model | embedder | P-DOC-09, P-DOC-19 | `server/utils/vectorDbProviders/lance/index.js:383` | No | Chunk text leaves the host for remote embedders |
| [SE-ADMIN-20](06-admin-system-and-runtime.md) | NET:foundry | unload previous model, refresh windows | P-ADMIN-07 | `server/utils/helpers/updateENV.js:967-978` | yes |  |
| [SE-DOC-10](03-documents-and-ingestion.md) | NET:github/gitlab/gitea/confluence/drupalwiki/paperless | user-supplied base URL | P-DOC-05, P-DOC-07 | `collector/utils/extensions/RepoLoader/GithubRepo/RepoLoader/index.js:135`, `:221`; `collector/utils/extensions/PaperlessNgx/PaperlessNgxLoader/index.js:41`; `collector/utils/extensions/DrupalWiki/DrupalWiki/index.js:239` | No | No IP guard |
| [SE-AUTH-54](01-auth-and-users.md) | NET:google | OpenID discovery document | P-AUTH-36 | `server/utils/auth/oidc.js:76-107` |  | cached 1 h |
| [SE-AUTH-56](01-auth-and-users.md) | NET:google | token endpoint (code + PKCE verifier), JWKS | P-AUTH-37 | `server/utils/auth/oidc.js:298` |  |  |
| [SE-AGENT-23](04-agents-tools-and-automation.md) | NET:google-apps-script | Gmail actions; gated writes at `gmail-create-draft.js:141`, `gmail-create-draft-reply.js:143`, `gmail-update-draft.js:139`, `gmail-delete-draft.js:43`, `gmail-send-draft.js:44`, `gmail-send-email.js:136,167`, `gmail-reply-to-thread.js:134,165`, `gmail-mark-read.js:43`, `gmail-mark-unread.js:43`, `gmail-move-to-trash.js:45`, `gmail-move-to-archive.js:45`, `gmail-move-to-inbox.js:45` | P-AGENT-17 | `gmail/lib.js:330-386` | send: no | reads ungated |
| [SE-AGENT-25](04-agents-tools-and-automation.md) | NET:google-apps-script | Calendar actions; gated writes `gcal-quick-add.js:52`, `gcal-create-event.js:138`, `gcal-update-event.js:104`, `gcal-set-my-status.js:63` | P-AGENT-18 | `google-calendar/lib.js:126` | partly |  |
| [SE-ADMIN-26](06-admin-system-and-runtime.md) | NET:huggingface (**unverified** host) | native embedder model download | P-ADMIN-08 | `server/utils/helpers/updateENV.js:1440-1449` | yes |  |
| [SE-DOC-04](03-documents-and-ingestion.md) | NET:huggingface / tesseract CDN | `storage/models/**` | P-DOC-01 (audio/image/scanned PDF) | `collector/utils/WhisperProviders/localWhisper.js:131-155`; `collector/utils/OCRLoader/index.js:111-121` | Manual delete | First use only |
| [SE-CHAT-28](02-workspaces-and-chat.md) | NET:image-provider | image generation; file in generated-images folder; chat row | P-CHAT-13 | `commands/img.js:89-121` | no | FS write inside `ImageGenerators` (unverified) |
| [SE-AGENT-22](04-agents-tools-and-automation.md) | NET:image-provider | image generation/edit; `storage/generated-images` | P-AGENT-15 | `generate-image.js:135-155`; `ImageGenerators/index.js:3-41` | swept by SE-AGENT-46 | ungated |
| [SE-EXT-35](05-external-channels.md) | NET:image-provider | generate/edit image, save | P-EXT-26 | `ImageGenerators/index.js:14-16` | Yes |  |
| [SE-CHAT-22](02-workspaces-and-chat.md) | NET:llm-provider | chat completion / stream | P-CHAT-10 S10 | `stream.js:321`, `342` | no | aborted on client close |
| [SE-CHAT-31](02-workspaces-and-chat.md) | NET:llm-provider | LLM rule classification using the router fallback model | P-CHAT-15 | `router/index.js:490`; `router-classifier.js:88-89` | n/a | sends the raw prompt |
| [SE-AGENT-03](04-agents-tools-and-automation.md) | NET:llm-provider | agent provider completions (system prompt incl. memories, history, attached docs, tool results) | P-AGENT-02/06/07/09/11/29/31/35 | `aibitat/index.js:1049,1216` | no | content leaves the instance for cloud providers |
| [SE-AGENT-42](04-agents-tools-and-automation.md) | NET:llm-provider | Observer + Reflector runs over the last 20 chats | P-AGENT-31 | `jobs/helpers/memory-extraction-utils.js:135,263` | no |  |
| [SE-EXT-21](05-external-channels.md) | NET:llm-provider | completion | P-EXT-12/13/16/24/27/33/38 | `apiChatHandler.js:456`, `:872`; `openaiCompatible.js` ; `embed.js` | n/a | Cost metered by `addChatCostToMetrics` |
| [SE-ADMIN-10](06-admin-system-and-runtime.md) | NET:llm-provider | local provider context windows | P-ADMIN-01 | `server/utils/boot/eagerLoadContextWindows.js:16-52` | yes |  |
| [SE-ADMIN-29](06-admin-system-and-runtime.md) | NET:llm-provider | model listing / pull / delete at admin-supplied base path, with stored bearer key | P-ADMIN-11, P-ADMIN-12 | `server/utils/helpers/customModels.js:82-210`, `server/endpoints/utils/lemonadeUtilsEndpoints.js:34-46,132-140` | n/a |  |
| [SE-CHAT-21](02-workspaces-and-chat.md) | NET:local | native reranker for memories when over the limit | P-CHAT-10 S9 | `memories/index.js:68-95` | n/a | local model (unverified whether it downloads) |
| [SE-AGENT-29](04-agents-tools-and-automation.md) | NET:mcp-server | `callTool` with optional identity headers/_meta | P-AGENT-22 | `MCP/index.js:148-156`; `MCP/identity.js:122-150` | depends on tool | ungated |
| [SE-ADMIN-41](06-admin-system-and-runtime.md) | NET:microsoft | `outlook_agent_config` create/delete | P-ADMIN-21 | `server/endpoints/utils/outlookAgentUtils.js:21-187` | yes | single-user only |
| [SE-AGENT-26](04-agents-tools-and-automation.md) | NET:microsoft-graph | Graph calls; token refresh writes `system_settings.outlook_agent_config` | P-AGENT-19 | `outlook/lib.js:466-467,691-757`; gated writes `outlook-create-draft.js:135`, `outlook-update-draft.js:81`, `outlook-delete-draft.js:46`, `outlook-send-draft.js:44`, `outlook-send-email.js:134` | send: no |  |
| [SE-AGENT-27](04-agents-tools-and-automation.md) | NET:microsoft-identity | `outlook_agent_config` save/delete; code→token exchange | P-AGENT-20 | `outlookAgentUtils.js:70,111,179`; `outlook/lib.js:611-680` | yes (revoke) | no OAuth `state` |
| [SE-ADMIN-07](06-admin-system-and-runtime.md) | NET:models.dev | `storage/models/pricing/*` | P-ADMIN-01 | `server/utils/helpers/modelPricing/index.js:180-193,237` | yes | 3-day cache |
| [SE-ADMIN-21](06-admin-system-and-runtime.md) | NET:nvidia-nim | base path rewrite, token limit | P-ADMIN-07 | `server/utils/helpers/updateENV.js:920-941` | yes |  |
| [SE-UI-03](07-frontend-routes-and-flows.md) | NET:onboarding.anythingllm.com | email, use case, comment | P-UI-02 survey | `pages/OnboardingFlow/Steps/Survey/index.jsx:12-43` | no | skipped in dev (`:13-16`); sets `anythingllm_completed_questionnaire` |
| [SE-DOC-05](03-documents-and-ingestion.md) | NET:openai / generic whisper | provider API | P-DOC-01 (audio) | `collector/processSingleFile/convert/asAudio.js:27-35` | No | Audio leaves the host |
| [SE-ADMIN-27](06-admin-system-and-runtime.md) | NET:postgres | PGVector validation, early env set | P-ADMIN-09 | `server/utils/helpers/updateENV.js:1471-1513` | yes |  |
| [SE-ADMIN-52](06-admin-system-and-runtime.md) | NET:posthog | all catalogue events | P-ADMIN-32 | `server/models/telemetry.js:114-118` | no |  |
| [SE-UI-17](07-frontend-routes-and-flows.md) | NET:push-service | service worker registration + `pushManager.subscribe` + `POST /web-push/subscribe` | P-UI-34 | `hooks/useWebPushNotifications.js:33,56,100-108` | partly (no unsubscribe path in UI found) | permission prompt only on explicit button |
| [SE-AGENT-13](04-agents-tools-and-automation.md) | NET:search-provider | one of SerpApi, SearchApi, Serper, Bing, Baidu, Serply, SearXNG, Tavily, DuckDuckGo, Exa, Perplexity, Brave, fastCRW, You.com, Keenable, AnySearch, Firecrawl, DeepSeek | P-AGENT-08 | `plugins/web-browsing.js:66-131` and provider methods 169-1990 | no | default You.com keyless → DuckDuckGo (`:126-130,1614-1711`) |
| [SE-AGENT-16](04-agents-tools-and-automation.md) | NET:sql-db | arbitrary SQL on configured MySQL/Postgres/MSSQL | P-AGENT-12 | `sql-agent/query.js:81`; `SQLConnectors/Postgresql.js:31-49` | depends on DB | no read-only enforcement, ungated |
| [SE-ADMIN-40](06-admin-system-and-runtime.md) | NET:sql-db | test connection | P-ADMIN-20 | `server/endpoints/system.js:1604` | n/a |  |
| [SE-EXT-41](05-external-channels.md) | NET:telegram | verify, long polling, retry timer | P-EXT-30 | `telegram.js:89`; `telegramBot/index.js:111-113`, `:281` | Stop |  |
| [SE-EXT-48](05-external-channels.md) | NET:telegram | bot reply, voice reply | P-EXT-33 | `telegramBot/chat/stream.js` (stream handler), `:342-345` | n/a |  |
| [SE-ADMIN-12](06-admin-system-and-runtime.md) | NET:telegram | Telegram bot polling | P-ADMIN-01 | `server/utils/telegramBot/index.js:813-832` | yes | single-user only |
| [SE-CHAT-43](02-workspaces-and-chat.md) | NET:tts-provider | `ttsBuffer` | P-CHAT-27 | `workspaces.js:714-715` | n/a |  |
| [SE-DOC-08](03-documents-and-ingestion.md) | NET:web | arbitrary URL | P-DOC-02, P-DOC-06, P-DOC-19 | `collector/processLink/helpers/index.js:35-38`; `collector/utils/downloadURIToFile/index.js:44`; `collector/processLink/convert/generic.js:187`, `:198` | No | Weak SSRF guard |
| [SE-AGENT-40](04-agents-tools-and-automation.md) | NET:web-push-service | push "<job> completed" + first 100 chars | P-AGENT-29 | `jobs/helpers/scheduled-job-helper.js:82-106`; `PushNotifications/index.js:175-194` | no | output text sent through the browser vendor's push service |
| [SE-DOC-12](03-documents-and-ingestion.md) | NET:youtube | youtube.com | P-DOC-08 | `collector/utils/extensions/YoutubeTranscript/YoutubeLoader/youtube-transcript.js` | No | **(file not read line by line)** |

## PROC

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-DOC-09](03-documents-and-ingestion.md) | PROC | headless Chromium | P-DOC-02, P-DOC-06 | `collector/processLink/convert/generic.js:168-187` | Exits | Args controllable via runtime settings |
| [SE-DOC-17](03-documents-and-ingestion.md) | PROC | Bree child `embedding-worker-<ts>` | P-DOC-09 (native) | `server/utils/EmbeddingWorkerManager.js:106-110` | Exits | One per slug |
| [SE-AGENT-30](04-agents-tools-and-automation.md) | PROC | stdio MCP server spawned with full `process.env` + config env | P-AGENT-01/22/23/24 | `MCP/hypervisor/index.js:376-413,481-490` | yes (toggle/delete) | secrets exposed to child |
| [SE-AGENT-35](04-agents-tools-and-automation.md) | PROC | `require(handler.js)` of imported skill | P-AGENT-26 | `agents/imported.js:13-24` | delete plugin | full server privileges |
| [SE-AGENT-38](04-agents-tools-and-automation.md) | PROC | Bree child process per run | P-AGENT-29 | `BackgroundWorkers/index.js:219-236,439-475` | killable |  |
| [SE-AGENT-41](04-agents-tools-and-automation.md) | PROC | `readAt`; `scheduled-jobs` workspace/thread/chat created; SIGTERM workers | P-AGENT-30 | `scheduledJobRun.js:329-385`; `BackgroundWorkers/index.js:368-382` | yes (delete) |  |
| [SE-EXT-33](05-external-channels.md) | PROC | MCP config file, spawn server | P-EXT-22 | `server/utils/MCP/index.js:320-348`; `hypervisor/index.js:528` | Yes | Arbitrary command |
| [SE-EXT-46](05-external-channels.md) | PROC | Bree worker `handle-telegram-chat` | P-EXT-33 | `telegramBot/index.js:495-507` | n/a | Plaintext token over IPC |
| [SE-ADMIN-09](06-admin-system-and-runtime.md) | PROC | Bree cleanup/memory/sync jobs; cron timers | P-ADMIN-01 | `server/utils/BackgroundWorkers/index.js:125-142,301-309` | yes |  |
| [SE-ADMIN-12](06-admin-system-and-runtime.md) | PROC | Telegram bot polling | P-ADMIN-01 | `server/utils/telegramBot/index.js:813-832` | yes | single-user only |
| [SE-ADMIN-13](06-admin-system-and-runtime.md) | PROC | embedded Lemonade install/spawn | P-ADMIN-01, P-ADMIN-07, P-ADMIN-12 | `server/utils/AiProviders/embeddedLemonade/endpoints.js:24`, `engine.js:132-151,194` | yes | Docker + flag only |
| [SE-ADMIN-19](06-admin-system-and-runtime.md) | PROC | embedded Lemonade stop/start | P-ADMIN-07 | `server/utils/AiProviders/embeddedLemonade/config.js:157-166` | yes | stop not awaited |
| [SE-ADMIN-35](06-admin-system-and-runtime.md) | PROC | add/remove `extract-memories` | P-ADMIN-14, P-ADMIN-22 | `server/utils/BackgroundWorkers/index.js:178-197` | yes | no-op if Bree stopped |
| [SE-ADMIN-39](06-admin-system-and-runtime.md) | PROC | whole BackgroundService boot (second Bree) or stop (all jobs, timers, `bree=null`) | P-ADMIN-19 | `server/models/documentSyncQueue.js:42-48`, `server/utils/BackgroundWorkers/index.js:106-163` | until restart | breaks embedding/telegram/scheduled jobs when disabled |
| [SE-ADMIN-51](06-admin-system-and-runtime.md) | PROC | scheduled job / embedding / telegram workers | P-ADMIN-31 | `server/utils/BackgroundWorkers/index.js:219-236,439-475` | n/a |  |

## WS

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-CHAT-16](02-workspaces-and-chat.md) | WS | SSE chunks to client | P-CHAT-10 S0..S11 | `responses.js:354-361` | n/a | dropped after client close |
| [SE-CHAT-25](02-workspaces-and-chat.md) | WS | `workspace_threads.name`, `rename_thread` chunk | P-CHAT-11 | `workspaceThread.js:166-170`, `chat.js:175-183` | yes |  |
| [SE-CHAT-29](02-workspaces-and-chat.md) | WS | `workspace_agent_invocations`; attachment/effort maps; init chunk | P-CHAT-14 | `agents.js:75-125` | n/a | map entries can leak |
| [SE-CHAT-32](02-workspaces-and-chat.md) | WS | `modelRouteNotification` | P-CHAT-15 | `stream.js:95-101` | n/a |  |
| [SE-DOC-18](03-documents-and-ingestion.md) | WS | SSE `/workspace/:slug/embed-progress` | P-DOC-09, P-DOC-21 | `server/utils/EmbeddingWorkerManager.js:17-36` | n/a | CORS `*` |
| [SE-AGENT-02](04-agents-tools-and-automation.md) | WS | agent socket messages (`statusResponse`, `toolApprovalRequest`, `clarificationRequest`, `fileDownloadCard`, `imageGenerationCard`, `rechartVisualize`, `scheduledJobCreated`, `rename_thread`, `wssFailure`) | P-AGENT-01/02/05/14/15/16/21 | `aibitat/plugins/websocket.js:188-598`; plugin `socket.send` calls | n/a |  |
| [SE-AGENT-28](04-agents-tools-and-automation.md) | WS | `scheduled_jobs` create; `later` timer; `scheduledJobCreated` | P-AGENT-21 | `create-scheduled-job/index.js:172-206` | yes (delete job) | gated |
| [SE-AGENT-48](04-agents-tools-and-automation.md) | WS | `wssFailure` + close; `agent_ws_rejected` | P-AGENT-36 | `server/endpoints/agentWebsocket.js:38`, `server/utils/agents/index.js:610` | no |  |
| [SE-EXT-22](05-external-channels.md) | WS | SSE stream to caller | P-EXT-13/16/24/27/38 | `api/workspace/index.js:855-859`; `embed/index.js:36-40`; `mobile/utils/index.js:175-179` | n/a | `Access-Control-Allow-Origin: *` |
| [SE-ADMIN-30](06-admin-system-and-runtime.md) | WS | SSE download progress | P-ADMIN-12 | `server/endpoints/utils/lemonadeUtilsEndpoints.js:28-32`, `server/utils/AiProviders/embeddedLemonade/endpoints.js:61-65` | n/a |  |
| [SE-UI-14](07-frontend-routes-and-flows.md) | WS | `/api/agent-invocation/:uuid` | P-UI-12 | `ChatContainer/index.jsx:384` | n/a | no token |

## PUSH

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-AGENT-12](04-agents-tools-and-automation.md) | PUSH | Telegram approval prompt via worker IPC | P-AGENT-07 | `http-socket.js:206-214`; `telegramBot/index.js:524` | n/a |  |
| [SE-AGENT-40](04-agents-tools-and-automation.md) | PUSH | push "<job> completed" + first 100 chars | P-AGENT-29 | `jobs/helpers/scheduled-job-helper.js:82-106`; `PushNotifications/index.js:175-194` | no | output text sent through the browser vendor's push service |
| [SE-EXT-43](05-external-channels.md) | PUSH | pairing code / approved / denied messages | P-EXT-31 | `verification.js:91`, `:121`, `:142` | n/a |  |
| [SE-EXT-48](05-external-channels.md) | PUSH | bot reply, voice reply | P-EXT-33 | `telegramBot/chat/stream.js` (stream handler), `:342-345` | n/a |  |
| [SE-UI-17](07-frontend-routes-and-flows.md) | PUSH | service worker registration + `pushManager.subscribe` + `POST /web-push/subscribe` | P-UI-34 | `hooks/useWebPushNotifications.js:33,56,100-108` | partly (no unsubscribe path in UI found) | permission prompt only on explicit button |
| [SE-UI-18](07-frontend-routes-and-flows.md) | PUSH | `showNotification`, `clients.openWindow(onClickUrl)` | P-UI-34 | `public/service-workers/push-notifications.js:15,25` | no | URL from server payload |

## ENV

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-AUTH-03](01-auth-and-users.md) | ENV | `AUTH_TOKEN`, `JWT_SECRET` | P-AUTH-02 | `server/endpoints/system.js:648-654` | yes (set again) | invalidates all single-user sessions |
| [SE-AUTH-04](01-auth-and-users.md) | ENV | `AUTH_TOKEN=""`, `JWT_SECRET=""`; `.env` dumped only in production | P-AUTH-03 | `server/endpoints/system.js:634-636` | yes |  |
| [SE-AUTH-11](01-auth-and-users.md) | ENV | `JWT_SECRET` (if unset) | P-AUTH-05 | `server/endpoints/system.js:704` |  |  |
| [SE-DOC-32](03-documents-and-ingestion.md) | ENV | `SIG_KEY`, `SIG_SALT` + `.env` rewrite | P-DOC-25 | `server/utils/EncryptionManager/index.js:38-43` | No | Loss breaks resync payloads |
| [SE-EXT-06](05-external-channels.md) | ENV | process.env + `.env` | P-EXT-07 | `api/system/index.js:148`; `updateENV.js:1573` | Yes | No user, admin gate absent |
| [SE-EXT-07](05-external-channels.md) | ENV | `.env` dump | P-EXT-07 | `api/system/index.js:31` | n/a | Unauthenticated |
| [SE-ADMIN-02](06-admin-system-and-runtime.md) | ENV | `SIG_KEY`, `SIG_SALT`, `server/.env` | P-ADMIN-01 | `server/utils/EncryptionManager/index.js:38-42` | no (losing them breaks decryption of stored secrets) | runs at require time and in any `NODE_ENV` |
| [SE-ADMIN-16](06-admin-system-and-runtime.md) | ENV | `process.env.<key>` | P-ADMIN-06 | `server/utils/helpers/updateENV.js:1563` | yes (re-save) | partial apply on error |
| [SE-ADMIN-17](06-admin-system-and-runtime.md) | ENV | `server/.env` rewrite | P-ADMIN-06, P-ADMIN-23, P-ADMIN-28 | `server/utils/helpers/updateENV.js:1599-1733` | no | drops non-allowlisted keys, truncates values |
| [SE-ADMIN-21](06-admin-system-and-runtime.md) | ENV | base path rewrite, token limit | P-ADMIN-07 | `server/utils/helpers/updateENV.js:920-941` | yes |  |
| [SE-ADMIN-27](06-admin-system-and-runtime.md) | ENV | PGVector validation, early env set | P-ADMIN-09 | `server/utils/helpers/updateENV.js:1471-1513` | yes |  |
| [SE-ADMIN-28](06-admin-system-and-runtime.md) | ENV | provider key env vars set from unsaved form input | P-ADMIN-11 | `server/utils/helpers/customModels.js:305,379,425,...,1497` | yes | persisted by next dumpENV |
| [SE-ADMIN-42](06-admin-system-and-runtime.md) | ENV | `AUTH_TOKEN`, `JWT_SECRET` | P-ADMIN-23 | `server/endpoints/system.js:634-654` | yes | invalidates sessions |
| [SE-ADMIN-44](06-admin-system-and-runtime.md) | ENV | `JWT_SECRET` ensured | P-ADMIN-24 | `server/endpoints/system.js:704-709` | n/a |  |

## CACHE

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-AUTH-17](01-auth-and-users.md) | CACHE | `UserMetaCache` | P-AUTH-07 | `server/utils/middleware/validatedRequest.js:21,70,109` |  | contents unverified |
| [SE-AUTH-44](01-auth-and-users.md) | CACHE | `TemporaryMobileDeviceRequests` Map set/delete/sweep | P-AUTH-28 | `server/models/mobileDevice.js:48,72,84-89` |  | in-memory |
| [SE-AUTH-55](01-auth-and-users.md) | CACHE | in-memory OIDC client | P-AUTH-36 | `server/utils/auth/oidc.js:47,76` |  | reset on settings save |
| [SE-AUTH-60](01-auth-and-users.md) | CACHE | OIDC client cache reset | P-AUTH-38 | `server/utils/auth/oidc.js:47` |  |  |
| [SE-CHAT-27](02-workspaces-and-chat.md) | CACHE | router sticky / LLM / notify entries | P-CHAT-12 | `router/index.js:191-207` | n/a | skipped for env-only router |
| [SE-CHAT-29](02-workspaces-and-chat.md) | CACHE | `workspace_agent_invocations`; attachment/effort maps; init chunk | P-CHAT-14 | `agents.js:75-125` | n/a | map entries can leak |
| [SE-CHAT-30](02-workspaces-and-chat.md) | CACHE | `routerCache`, sticky, llmCache, lastNotified | P-CHAT-15 | `router/index.js:67-312` | n/a | no TTL on config |
| [SE-CHAT-44](02-workspaces-and-chat.md) | CACHE | TTS `responseCache` | P-CHAT-27 | `workspaces.js:719` | n/a | unbounded, never invalidated |
| [SE-CHAT-46](02-workspaces-and-chat.md) | CACHE | `invalidateRouter(:id)` | P-CHAT-28 | `router/index.js:112-121` | n/a | wrong router if `:ruleId` is not under `:id` |
| [SE-DOC-29](03-documents-and-ingestion.md) | CACHE | `eventHistory`, `runningWorkers`, `sseConnections` maps | P-DOC-21 | `server/utils/EmbeddingWorkerManager.js:5-11` | Process lifetime |  |
| [SE-DOC-34](03-documents-and-ingestion.md) | CACHE | collector `RuntimeSettings` singleton | P-DOC-26 | `collector/utils/runtimeSettings/index.js:58-65`, `:90-94` | Overwritten by next request | Settable from client body via `/ext/*` |
| [SE-AGENT-10](04-agents-tools-and-automation.md) | CACHE | live `aibitat.functions` / `@agent.functions` | P-AGENT-04 | `agents/index.js:760-779` | yes (toggle back) | session only |
| [SE-EXT-51](05-external-channels.md) | CACHE | temp pairing token map | P-EXT-36 | `mobileDevice.js:72`, `:48` | Expires 3 min |  |
| [SE-EXT-57](05-external-channels.md) | CACHE | push subscription | P-EXT-43 | `PushNotifications/index.js:148-163` | Overwrite | One per user |
| [SE-ADMIN-10](06-admin-system-and-runtime.md) | CACHE | local provider context windows | P-ADMIN-01 | `server/utils/boot/eagerLoadContextWindows.js:16-52` | yes |  |
| [SE-ADMIN-20](06-admin-system-and-runtime.md) | CACHE | unload previous model, refresh windows | P-ADMIN-07 | `server/utils/helpers/updateENV.js:967-978` | yes |  |
| [SE-ADMIN-33](06-admin-system-and-runtime.md) | CACHE | `MetaGenerator.clearConfig()` | P-ADMIN-14, P-ADMIN-16 | `server/models/systemSettings.js:437,448` | yes |  |
| [SE-ADMIN-34](06-admin-system-and-runtime.md) | CACHE | Gmail/Calendar/Outlook bridge `.reset()` | P-ADMIN-14, P-ADMIN-21 | `server/models/systemSettings.js:300,343,396`, `server/endpoints/utils/outlookAgentUtils.js:180` | yes |  |
| [SE-UI-01](07-frontend-routes-and-flows.md) | CACHE | `localStorage.anythingllm_user` overwritten from server | P-UI-01 | `frontend/src/AuthContext.jsx:65` | yes | role sync |
| [SE-UI-02](07-frontend-routes-and-flows.md) | CACHE | `localStorage` caches: `anythingllm_footer_links` (1 h), `anythingllm_support_email`, `anythingllm_custom_app_name`, `anythingllm_can_view_chat_history` (24 h), `anythingllm_deployment_version`, `theme_palettes` | P-UI-01 | `models/system.js:334-424,783-805,834-852`; `palettes/index.js:93-108` | yes | stale for up to TTL |
| [SE-UI-04](07-frontend-routes-and-flows.md) | CACHE | auth token (and user) written to `localStorage` | P-UI-02/03/04/06/07 | `SingleUserAuth.jsx:41,57`; `MultiUserAuth.jsx:209-210,261-262`; `Login/SSO/simple.jsx:27-29`; `Invite/NewUserModal/index.jsx:36-37`; `OnboardingFlow/Steps/UserSetup/index.jsx:153,270-271` | yes (logout) | token readable by any script on the origin |
| [SE-UI-08](07-frontend-routes-and-flows.md) | CACHE | `localStorage.resetToken` | P-UI-05 | `MultiUserAuth.jsx:229,248` | partly | left on failure and on logout |
| [SE-UI-10](07-frontend-routes-and-flows.md) | CACHE | remove auth keys (+ last workspace, prompt map on logout) | P-UI-08, P-UI-39 | `UserMenu/UserButton/index.jsx:97-102`; `Security/index.jsx:64-66,237-239` | n/a | no server revocation |
| [SE-UI-11](07-frontend-routes-and-flows.md) | CACHE | `sessionStorage.anythingllm_pending_home_message` | P-UI-10 | `pages/Main/Home/index.jsx:268`; `ChatContainer/index.jsx:115,202,287-290` | yes | holds the first message text and attachments |
| [SE-UI-13](07-frontend-routes-and-flows.md) | CACHE | `localStorage.anythingllm_user_prompt_input_map` (drafts), `anythingllm_session_reasoning_effort_map` | P-UI-11 | `hooks/usePromptInputStorage.js:15,22`; `utils/chat/reasoningEffort.js:24,54` | yes | drafts may contain sensitive text |
| [SE-UI-15](07-frontend-routes-and-flows.md) | CACHE | blob object URLs (logo, pfp, TTS audio, images, Piper TTS) | P-UI-01, P-UI-13 | `models/system.js:478,498`; `models/workspace.js:402`; `ImageGenerationCard/index.jsx:38`; `utils/piperTTS/index.js:138,191`; `CustomLogo/index.jsx:28` | yes |  |
| [SE-UI-16](07-frontend-routes-and-flows.md) | CACHE | UI prefs: `anythingllm-workspace-order`, `anythingllm_sidebar_toggle`, settings-menu expand keys, `anythingllm_text_size`, `theme`, `palette`, `anythingllm_appearance_settings`, one-time alert keys | P-UI-14 etc. | `models/workspace.js:9,550`; `Sidebar/SidebarToggle/index.jsx:5,47,62`; `SettingsSidebar/MenuOption/index.jsx:67,159`; `TextSizeMenu/index.jsx:44`; `hooks/useTheme.js:74`; `palettes/index.js:106`; `models/appearance.js:65` | yes |  |
| [SE-UI-20](07-frontend-routes-and-flows.md) | CACHE | i18n language via `i18next-browser-languagedetector` | P-UI-21, P-UI-40 | `frontend/src/i18n.js:3,9`; `hooks/useLanguageOptions.js:9-11` | yes | detector's default cache is `localStorage.i18nextLng` (library default, unverified here) |
| [SE-UI-21](07-frontend-routes-and-flows.md) | CACHE | `anythingllm_tos_experimental_feature_set`, `anythingllm_experimental_feature_preview_unlocked` | P-UI-38 | `ExperimentalFeatures/index.jsx:186-191`; `SettingsSidebar/index.jsx:481` | yes |  |

## LOG

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-AUTH-05](01-auth-and-users.md) | LOG | `audit_events: auth.login_failed` (still called as legacy `failed_login_invalid_password`, mapped by `server/utils/audit/legacy.js`) | P-AUTH-04 | `server/endpoints/system.js:331` | rows are append-only; `DELETE /system/event-logs` records `audit.cleared` |  |
| [SE-AUTH-07](01-auth-and-users.md) | LOG | `audit_events: auth.login_succeeded` (legacy `login_event`) | P-AUTH-04 | `server/endpoints/system.js:344` |  |  |
| [SE-AUTH-12](01-auth-and-users.md) | LOG | `enabled_multi_user_mode`; `audit_events: multi_user.enabled` (legacy `multi_user_mode_enabled`) | P-AUTH-05 | `server/endpoints/system.js:850-854` |  |  |
| [SE-AUTH-13](01-auth-and-users.md) | LOG | `audit_events: auth.login_failed` (legacy `failed_login_invalid_username` / `_invalid_password` / `_account_suspended`) | P-AUTH-06 | `server/endpoints/system.js:230,248,266` |  | the attempted username and IP are still recorded (see `legacy.js` for the stored fields) |
| [SE-AUTH-15](01-auth-and-users.md) | LOG | `audit_events: auth.login_succeeded` (legacy `login_event`) | P-AUTH-06 | `server/endpoints/system.js:289` |  |  |
| [SE-AUTH-20](01-auth-and-users.md) | LOG | `audit_events: auth.login_failed` / `auth.login_succeeded` (legacy `failed_login_invalid_temporary_auth_token` / `login_event`) | P-AUTH-11 | `server/endpoints/system.js:372,388` |  |  |
| [SE-AUTH-23](01-auth-and-users.md) | LOG | `audit_events: invite.created` (legacy `invite_created`); metadata holds `codeHash` (sha256 of the code), not the code (F-55, a860f55a) | P-AUTH-12 | `server/endpoints/admin.js:192` |  |  |
| [SE-AUTH-25](01-auth-and-users.md) | LOG | `audit_events: invite.claimed` (legacy `invite_accepted`) | P-AUTH-13 | `server/endpoints/invite.js:77` |  |  |
| [SE-AUTH-27](01-auth-and-users.md) | LOG | `audit_events: invite.disabled` (legacy `invite_deleted`) | P-AUTH-14 | `server/endpoints/admin.js:215` |  | logged even if not found |
| [SE-AUTH-29](01-auth-and-users.md) | LOG | `audit_events: user.created` (legacy `user_created`) | P-AUTH-15 | `server/endpoints/admin.js:70` |  |  |
| [SE-AUTH-31](01-auth-and-users.md) | LOG | `audit_events: user.updated` (+ `user.role_changed`, `user.suspended` / `user.unsuspended` when those fields change); legacy `user_updated`. The actor is the acting admin from the request context; the updated user is the target (F-55, a860f55a). Free-text fields are named, not stored | P-AUTH-16/19/20/22 | `server/models/user.js:206`; mapping `server/utils/audit/legacy.js` |  |  |
| [SE-AUTH-33](01-auth-and-users.md) | LOG | `audit_events: user.deleted` (legacy `user_deleted`) | P-AUTH-17 | `server/endpoints/admin.js:146` |  |  |
| [SE-AUTH-35](01-auth-and-users.md) | LOG | `audit_events: user.deleted` (legacy `api_user_deleted`); the actor is the API key from the request context | P-AUTH-18 | `server/endpoints/api/admin/index.js:259` |  | API create/update still not logged except through `User.update` (`user_updated`); the file belongs to the Google sign-in branch (F-55) |
| [SE-AUTH-42](01-auth-and-users.md) | LOG | `audit_events: api_key.created` / `api_key.deleted` (legacy `api_key_created` / `api_key_deleted`) | P-AUTH-23/24 | `server/endpoints/admin.js:531,556`; the `/system/generate-api-key` and `/system/api-key/:id` routes are held for the access-policy branch (`server/utils/audit/routes/held.js`) |  |  |
| [SE-AUTH-48](01-auth-and-users.md) | LOG | `legacy_api_key_refused`, `api_key_expired_refused` | P-AUTH-31 | `server/utils/middleware/validApiKey.js:107,139` | no |  |
| [SE-AUTH-58](01-auth-and-users.md) | LOG | `failed_login_oidc` (reason, email, detail), `user_created_oidc`, `login_event {method:"oidc"}` | P-AUTH-37 | `server/endpoints/auth/oidc.js:87,112-122,131` |  | email stored in `event_logs` |
| [SE-AUTH-61](01-auth-and-users.md) | LOG | `oidc_settings_updated` | P-AUTH-38 | `server/endpoints/auth/oidc.js:166` |  |  |
| [SE-AUTH-62](01-auth-and-users.md) | LOG | `failed_login_password_disabled` | P-AUTH-06 | `server/endpoints/system.js:292` |  |  |
| [SE-AUTH-63](01-auth-and-users.md) | LOG | `password_reset` (username only) | P-AUTH-22 | `server/utils/PasswordRecovery/index.js:122` |  | was `user_updated` before this branch |
| [SE-AUTH-64](01-auth-and-users.md) | LOG | `audit_events: auth.password_changed` (outcome `success` / `failed` / `denied`; denied in multi-user mode; `password_disabled` noted in `reason`) | P-AUTH-02/03 | `server/endpoints/system.js:732,759,785` |  | recorded with `recordOrFail`: the request ends 500 if the row can't be stored or queued |
| [SE-AUTH-65](01-auth-and-users.md) | LOG | `audit_events: auth.recovery_used` (no username or codes stored) | P-AUTH-21 | `server/endpoints/system.js:425` |  |  |
| [SE-AUTH-66](01-auth-and-users.md) | LOG | `audit_events: auth.password_reset` (success, failed) | P-AUTH-22 | `server/endpoints/system.js:483,498` |  |  |
| [SE-AUTH-67](01-auth-and-users.md) | LOG | `audit_events: user.updated` (field names only) + `auth.password_changed` on `POST /system/user` | P-AUTH-19 | `server/endpoints/system.js:1516,1531` |  |  |
| [SE-AUTH-68](01-auth-and-users.md) | LOG | `audit_events: user.updated` (`changedFields: ["pfpFilename"]`) for upload and remove of the profile picture; `extension_key.created` / `extension_key.deleted` for browser extension keys | P-AUTH-20, P-AUTH-26/27 | `server/endpoints/system.js:1015,1118`; `server/endpoints/browserExtension.js:240,282` |  |  |
| [SE-CHAT-03](02-workspaces-and-chat.md) | LOG | `audit_events: workspace.created` | P-CHAT-02 | `server/endpoints/workspaces.js:77` | no |  |
| [SE-CHAT-06](02-workspaces-and-chat.md) | LOG | `workspace_prompt_changed` telemetry; `audit_events: workspace.updated` (legacy `workspace_prompt_changed`, metadata `changedFields: ["openAiPrompt"]`; the prompt text is no longer stored) | P-CHAT-03 | `server/models/workspace.js:548-555`; `server/utils/audit/legacy.js` | no | the route also records `workspace.updated` at `server/endpoints/workspaces.js:123` (field names only) |
| [SE-CHAT-10](02-workspaces-and-chat.md) | LOG | `audit_events: workspace.deleted` | P-CHAT-04 | `server/endpoints/workspaces.js:370` | no |  |
| [SE-CHAT-24](02-workspaces-and-chat.md) | LOG | `sent_chat` telemetry; `audit_events: chat.sent` (`recordChatSent`: workspace slug, thread id, provider, model, message length, attachment count, mode; never the message or answer) | P-CHAT-10 S12 | `server/endpoints/chat.js:33,117,220` | no | replaces the log row that held workspace and thread names |
| [SE-CHAT-37](02-workspaces-and-chat.md) | LOG | `workspace_threads`; `workspace_thread_created` telemetry; `audit_events: thread.created` | P-CHAT-21 | `server/endpoints/workspaceThreads.js:34-57` (audit at `:53`) | yes |  |
| [SE-CHAT-40](02-workspaces-and-chat.md) | LOG | thread + copied chats; `audit_events: thread.forked` | P-CHAT-24 | `server/endpoints/workspaces.js:766-799`; audit at `:929` | partly | uses up quota |
| [SE-CHAT-42](02-workspaces-and-chat.md) | LOG | `audit_events: chat.exported` (legacy `exported_chats` is no longer called here) | P-CHAT-26 | `server/endpoints/system.js:1465` | no |  |
| [SE-CHAT-48](02-workspaces-and-chat.md) | LOG | `model_refused_by_policy` | P-CHAT-31 | `server/utils/accessPolicy/index.js:110,133` | no | fire-and-forget |
| [SE-CHAT-52](02-workspaces-and-chat.md) | LOG | `audit_events: workspace.updated` (field names only) for update, suggested messages, prompt-history clear and delete | P-CHAT-03/06/07 | `server/endpoints/workspaces.js:123,756,1155,1192` | no | no row before |
| [SE-CHAT-53](02-workspaces-and-chat.md) | LOG | `audit_events: chat.hidden` (delete-chats, delete-edited-chats, hide one chat, fork cleanup), `chat.edited`, `chat.feedback`; thread routes record the same at `workspaceThreads.js:134,189,307` (`chat.hidden`) and `:355` (`chat.edited`) | P-CHAT-17/18/19/20 | `server/endpoints/workspaces.js:563,609,649,704,969` | no | no row before |
| [SE-CHAT-54](02-workspaces-and-chat.md) | LOG | `audit_events: thread.renamed`, `thread.deleted` (single and bulk) | P-CHAT-22/23 | `server/endpoints/workspaceThreads.js:256,116,174` | no | no row before |
| [SE-CHAT-55](02-workspaces-and-chat.md) | LOG | `audit_events: chat.viewed_other_user` (admin chat list), `chat.deleted` / `chat.bulk_deleted` | P-CHAT-26 | `server/endpoints/system.js:1395,1425,1431` | no | no row before |
| [SE-CHAT-56](02-workspaces-and-chat.md) | LOG | `audit_events: document.pinned` | `POST /workspace/:slug/update-pin` (path ID not checked) | `server/endpoints/workspaces.js:799` | no | no row before |
| [SE-CHAT-57](02-workspaces-and-chat.md) | LOG | model router CRUD: no row yet; `router.*` actions are declared as pending for the access-policy branch (`server/utils/audit/routes/held.js`) | P-CHAT-28 | `server/endpoints/modelRouter.js` | n/a | not recorded in this PR |
| [SE-DOC-07](03-documents-and-ingestion.md) | LOG | `audit_events`: `document.uploaded`, `document.embedded`, `document.removed`, `workspace.vectors_reset` | uploads, embeds, removals, resets | `server/endpoints/workspaces.js:200`, `:255`, `:420`, `:1039`; `server/models/documents.js:241`, `:290`; `server/utils/EmbeddingWorkerManager.js:45`; `server/utils/vectorStore/resetAllVectorStores.js:24` | No | Purge logs once per workspace; the old `event_logs` rows (`document_uploaded`, `link_uploaded`, `workspace_documents_added` ...) are mapped by `legacy.js` |
| [SE-DOC-35](03-documents-and-ingestion.md) | LOG | `audit_events: document.deleted` | P-DOC-01/02 (UI upload-and-embed, remove-and-unembed) and `system.js` removals | `server/endpoints/workspaces.js:1099`; `server/endpoints/system.js:548,575,601` | No | no row before |
| [SE-DOC-36](03-documents-and-ingestion.md) | LOG | `audit_events: parsed_file.created` / `parsed_file.embedded` / `parsed_file.deleted`; `document.uploaded` for move-parsed-files | P-DOC-20 | `server/models/workspaceParsedFiles.js:31`; `server/endpoints/workspacesParsedFiles.js:64,118,166` | No | no row before |
| [SE-DOC-37](03-documents-and-ingestion.md) | LOG | `audit_events: connector.token_saved` + `document.uploaded` | P-DOC-05, P-DOC-07 (connectors) | `server/endpoints/extensions/index.js:31,41` | No | no row before |
| [SE-DOC-38](03-documents-and-ingestion.md) | LOG | `audit_events: feature.toggled` (live sync), `document.watched` | P-DOC-17, P-DOC-18 | `server/endpoints/experimental/liveSync.js:52,120` | No |  |
| [SE-DOC-39](03-documents-and-ingestion.md) | LOG | `audit_events: document.uploaded`, `document.embedded` | P-DOC-22 (browser extension) | `server/endpoints/browserExtension.js:135,149,190` | No | no row before |
| [SE-AGENT-44](04-agents-tools-and-automation.md) | LOG | worker log now holds counts and ids only (F-41 fixed in 912a0c28); `audit_events: memory.extracted` (created, updated, candidates counts) with a job actor acting on behalf of the user | P-AGENT-31 | `server/jobs/extract-memories.js:135,137,185` | no | no memory text in logs or audit rows |
| [SE-AGENT-48](04-agents-tools-and-automation.md) | LOG | `wssFailure` + close; `agent_ws_rejected` | P-AGENT-36 | `server/endpoints/agentWebsocket.js:38`, `server/utils/agents/index.js:610` | no |  |
| [SE-AGENT-49](04-agents-tools-and-automation.md) | LOG | `tool_refused_by_policy`, `model_refused_by_policy` | P-AGENT-37/38 | `server/utils/accessPolicy/index.js:110,133`, `server/utils/agents/index.js:686` | no | fire-and-forget |
| [SE-AGENT-52](04-agents-tools-and-automation.md) | LOG | `audit_events: scheduled_job.created` / `updated` / `deleted` / `run` (trigger, approve and reject runs) | P-AGENT-28 | `server/endpoints/scheduledJobs.js:109,201,287,315,364,396` | no | no row before |
| [SE-AGENT-53](04-agents-tools-and-automation.md) | LOG | `audit_events: memory.created` / `updated` (also promote and demote) / `deleted` | P-AGENT-31/32 | `server/endpoints/memory.js:95,134,164,195,232` | no | no row before |
| [SE-AGENT-54](04-agents-tools-and-automation.md) | LOG | `audit_events: mcp.server_started` / `mcp.server_stopped` / `mcp.server_removed` / `mcp.tool_toggled` | MCP server toggle, delete, tool toggle (UI) | `server/endpoints/mcpServers.js:71,106,145` | no | the `/v1/mcp-servers` equivalents are in SE-EXT-58 |
| [SE-AGENT-55](04-agents-tools-and-automation.md) | LOG | `audit_events: flow.created` / `flow.updated` / `flow.deleted` | agent flows | `server/endpoints/agentFlows.js:43,174,225` | no | no row before |
| [SE-AGENT-56](04-agents-tools-and-automation.md) | LOG | `audit_events: skill.enabled` / `skill.disabled` / `skill.configured` / `skill.removed`; `agent.whitelist_added` | imported agent plugins, skill whitelist | `server/endpoints/experimental/imported-agent-plugins.js:27,59,92`; `server/endpoints/agentSkillWhitelist.js:95` | no | no row before |
| [SE-AGENT-57](04-agents-tools-and-automation.md) | LOG | not recorded: `agent.session_started` / `agent.session_ended` are declared pending for the access-policy branch (`server/utils/audit/routes/held.js`) | agent websocket session (P-AGENT-14 area) | `server/endpoints/agentWebsocket.js` | n/a |  |
| [SE-EXT-02](05-external-channels.md) | LOG | `audit_events: user.deleted` (legacy `api_user_deleted`); actor is the API key from the request context | P-EXT-03 | `api/admin/index.js:259` | n/a | `user.updated` via `User.update` is recorded (see SE-AUTH-31) |
| [SE-EXT-08](05-external-channels.md) | LOG | `audit_events: settings.changed` per changed key (secrets masked) and `vendor.changed` for LLM, embedder, vector DB, TTS/STT and similar settings; a failed key records `settings.changed` with outcome `failed` | P-EXT-07 | `server/utils/helpers/updateENV.js:1628,1641,1654` | n/a | the old `update_llm_provider` / `update_embedding_engine` / `update_vector_db` events are gone; actor is the API key |
| [SE-EXT-09](05-external-channels.md) | LOG | `audit_events: chat.exported` | P-EXT-08 | `server/endpoints/api/system/index.js:211` | n/a |  |
| [SE-EXT-14](05-external-channels.md) | LOG | `workspace_created` telemetry; `audit_events: workspace.created` / `workspace.deleted` (legacy `api_workspace_created` / `api_workspace_deleted`) | P-EXT-10 | `api/workspace/index.js:91`, `:99`, `:263` | n/a |  |
| [SE-EXT-23](05-external-channels.md) | LOG | `sent_chat` telemetry; `audit_events: chat.sent` (legacy `api_sent_chat`) | P-EXT-12/13/16/24 | `api/workspace/index.js:718`, `:879`; `api/workspaceThread/index.js:471`, `:675`; `api/openai/index.js:154`, `:183` | n/a | Not recorded for mobile (route pending the access-policy branch) |
| [SE-EXT-29](05-external-channels.md) | LOG | telemetry; `audit_events: document.uploaded` and `document.embedded` | P-EXT-17/18 | `api/document/index.js:191`, `:212`, `:360`, `:381`, `:538`, `:559`, `:730`, `:747` | n/a |  |
| [SE-EXT-32](05-external-channels.md) | LOG | embed_configs (+cascade embed_chats); `audit_events: embed.created` / `embed.updated` / `embed.deleted` (F-55, dcc0e052) | P-EXT-21 | `api/embed/index.js:275`, `:349`, `:397`; audit at `:309`, `:396`, `:462` | Delete: no |  |
| [SE-EXT-39](05-external-channels.md) | LOG | embed config CRUD; `audit_events: embed.created` / `embed.updated` / `embed.deleted` | P-EXT-29 | `embedManagement.js:54`, `:85`, `:120` | Delete: no |  |
| [SE-EXT-42](05-external-channels.md) | LOG | `audit_events: telegram.bot_connected` / `telegram.bot_disconnected` (+ `settings.changed` on update-config at `:362`) | P-EXT-30 | `server/endpoints/telegram.js:148`, `:175` | n/a |  |
| [SE-EXT-45](05-external-channels.md) | LOG | `audit_events: telegram.user_approved` / `telegram.user_denied` / `telegram.user_revoked` | P-EXT-31/32 | `server/endpoints/telegram.js:250`, `:280`, `:310` | n/a |  |
| [SE-EXT-54](05-external-channels.md) | LOG | browser_extension_api_keys; `audit_events: extension_key.created` / `extension_key.deleted` | P-EXT-40/41 | `browserExtension.js:181`, `:213`, `:51`; audit at `:240`, `:282`, `:57` | Delete: no |  |
| [SE-EXT-61](05-external-channels.md) | LOG | `audit_events: mcp.server_added` / `mcp.server_updated` / `mcp.server_started` / `mcp.server_stopped` / `mcp.tool_toggled` / `mcp.server_removed` (actor is the API key) | P-EXT-22 | `server/endpoints/api/mcpServers/index.js:106,222,283,369,424` | n/a | no row before |
| [SE-EXT-62](05-external-channels.md) | LOG | `audit_events: chat.viewed_other_user` for embed chat reads (developer API and admin UI), `embed.chats_deleted` | P-EXT-21, P-EXT-28 | `server/endpoints/api/embed/index.js:136,209`; `server/endpoints/embedManagement.js:159,190` | n/a | no row before |
| [SE-EXT-63](05-external-channels.md) | LOG | `audit_events: embed.chat` per widget chat; `embed.rejected` when the embed middleware refuses; `embed.chats_deleted` for a session delete | P-EXT-27 | `server/endpoints/embed/index.js:48,125`; `server/utils/middleware/embedMiddleware.js:19` | n/a | no row before |
| [SE-EXT-64](05-external-channels.md) | LOG | `audit_events: document.viewed`, `document.deleted`, `document.downloaded` | P-EXT-08 (developer API) | `server/endpoints/api/document/index.js:1061,1198,1414,1450` | n/a | no row before |
| [SE-EXT-65](05-external-channels.md) | LOG | `audit_events: community_hub.connected`, `community_hub.published`, `skill.installed`, `settings.changed` | Community Hub routes | `server/endpoints/communityHub.js:44,50,129,178,237` | n/a | no row before |
| [SE-EXT-66](05-external-channels.md) | LOG | `audit_events: oauth.connected` / `oauth.disconnected` | Outlook OAuth | `server/endpoints/utils/outlookAgentUtils.js:87,136,216` | n/a | no row before |
| [SE-EXT-67](05-external-channels.md) | LOG | `audit_events: chat.exported` | `POST /export-chat/:type` | `server/endpoints/utils.js:86` | n/a | no row before |
| [SE-ADMIN-18](06-admin-system-and-runtime.md) | LOG | `audit_events: settings.changed` per key (secrets masked) and `vendor.changed` for vendor settings; the old `update_*` events are gone | P-ADMIN-06 | `server/utils/helpers/updateENV.js:1628,1641,1654` | n/a | a failed key records `settings.changed` with outcome `failed` |
| [SE-ADMIN-25](06-admin-system-and-runtime.md) | LOG | `audit_events: workspace.vectors_reset` | P-ADMIN-08, P-ADMIN-09 | `server/utils/vectorStore/resetAllVectorStores.js:24` | n/a |  |
| [SE-ADMIN-38](06-admin-system-and-runtime.md) | LOG | `experimental_live_file_sync`, `experimental_feature_enabled`; `audit_events: feature.toggled` | P-ADMIN-19 | `server/endpoints/experimental/liveSync.js:36-45`, audit at `:52` | yes |  |
| [SE-ADMIN-45](06-admin-system-and-runtime.md) | LOG | `enabled_multi_user_mode`; `audit_events: multi_user.enabled` (legacy `multi_user_mode_enabled`) | P-ADMIN-24 | `server/endpoints/system.js:850-854` | n/a |  |
| [SE-ADMIN-46](06-admin-system-and-runtime.md) | LOG | legacy `event_logs` deleteMany + `audit_events: audit.cleared` (legacy `event_logs_cleared`) | P-ADMIN-25 | `server/endpoints/system.js:1351-1358`; `server/models/eventLogs.js:152-163` | no | `audit_events` rows survive; route removal planned for PR B (F-54) |
| [SE-ADMIN-47](06-admin-system-and-runtime.md) | LOG | `workspace_chats` deleteMany (one or all); `audit_events: chat.deleted` / `chat.bulk_deleted` | P-ADMIN-26 | `server/endpoints/system.js:1425,1431` | no |  |
| [SE-ADMIN-48](06-admin-system-and-runtime.md) | LOG | `audit_events: chat.exported` | P-ADMIN-26 | `server/endpoints/system.js:1465` | n/a |  |
| [SE-ADMIN-55](06-admin-system-and-runtime.md) | LOG | `audit_events` row per `audit.record` | P-ADMIN-35 | `server/utils/audit/index.js` | no (no delete path in the app) |  |
| [SE-ADMIN-57](06-admin-system-and-runtime.md) | LOG | `audit_events: db.write` backstop row for a sensitive-table write with no covering action | P-ADMIN-35 | `server/utils/audit/backstop.js`; `server/utils/prisma/index.js:14` | no | a row here means a missing catalogue event |
| [SE-ADMIN-58](06-admin-system-and-runtime.md) | LOG | `audit_events: system.boot`; `system.shutdown` on SIGTERM/SIGINT | P-ADMIN-35, P-ADMIN-01 | `server/utils/audit/boot.js`; `server/utils/boot/index.js:36,71` | no |  |
| [SE-ADMIN-59](06-admin-system-and-runtime.md) | LOG | `audit_events: vendor.data_sent` hourly counts per vendor, channel and hour (no content); timer flush | P-ADMIN-35 | `server/utils/audit/vendors.js` | no | provider classes wrapped at boot |
| [SE-ADMIN-60](06-admin-system-and-runtime.md) | LOG | `audit_events: audit.viewed` when the Event Logs page is read | P-ADMIN-35 | `server/endpoints/system.js:1336` | no |  |

## TEL

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-AUTH-02](01-auth-and-users.md) | TEL | `onboarding_complete` | P-AUTH-01 | `server/models/systemSettings.js:820` | no |  |
| [SE-AUTH-06](01-auth-and-users.md) | TEL | `login_event {multiUserMode:false}` | P-AUTH-04 | `server/endpoints/system.js:340` | no |  |
| [SE-AUTH-12](01-auth-and-users.md) | TEL | `enabled_multi_user_mode`; `audit_events: multi_user.enabled` (legacy `multi_user_mode_enabled`) | P-AUTH-05 | `server/endpoints/system.js:850-854` |  |  |
| [SE-AUTH-14](01-auth-and-users.md) | TEL | `login_event` (wrong `multiUserMode:false`) | P-AUTH-06 | `server/endpoints/system.js:280` |  |  |
| [SE-AUTH-21](01-auth-and-users.md) | TEL | `login_event {multiUserMode:true}` | P-AUTH-11 | `server/endpoints/system.js:380` |  |  |
| [SE-CHAT-02](02-workspaces-and-chat.md) | TEL | `workspace_created` | P-CHAT-02 | `workspaces.js:62` | no | fires even on failure |
| [SE-CHAT-06](02-workspaces-and-chat.md) | TEL | `workspace_prompt_changed` telemetry; `audit_events: workspace.updated` (legacy `workspace_prompt_changed`, metadata `changedFields: ["openAiPrompt"]`; the prompt text is no longer stored) | P-CHAT-03 | `server/models/workspace.js:548-555`; `server/utils/audit/legacy.js` | no | the route also records `workspace.updated` at `server/endpoints/workspaces.js:123` (field names only) |
| [SE-CHAT-24](02-workspaces-and-chat.md) | TEL | `sent_chat` telemetry; `audit_events: chat.sent` (`recordChatSent`: workspace slug, thread id, provider, model, message length, attachment count, mode; never the message or answer) | P-CHAT-10 S12 | `server/endpoints/chat.js:33,117,220` | no | replaces the log row that held workspace and thread names |
| [SE-CHAT-37](02-workspaces-and-chat.md) | TEL | `workspace_threads`; `workspace_thread_created` telemetry; `audit_events: thread.created` | P-CHAT-21 | `server/endpoints/workspaceThreads.js:34-57` (audit at `:53`) | yes |  |
| [SE-CHAT-47](02-workspaces-and-chat.md) | TEL | `model_router_created`, `model_router_rule_created` | P-CHAT-28 | `modelRouter.js:65`, `128` | no |  |
| [SE-DOC-06](03-documents-and-ingestion.md) | TEL | telemetry | uploads, links, connectors, embeds, watch | `server/endpoints/workspaces.js:173`, `:219`, `:882`; `server/endpoints/extensions/index.js:55` etc.; `server/models/documents.js:233`; `server/models/documentSyncQueue.js:263`, `:268` | No |  |
| [SE-AGENT-04](04-agents-tools-and-automation.md) | TEL | `agent_chat_started` | P-AGENT-01 | `endpoints/agentWebsocket.js:65`; `apiChatHandler.js:197` | no |  |
| [SE-AGENT-05](04-agents-tools-and-automation.md) | TEL | `agent_chat_sent`, `agent_tool_call {tool}` | P-AGENT-02 | `websocket.js:486-487`; `aibitat/index.js:1100` | no | tool names only |
| [SE-AGENT-21](04-agents-tools-and-automation.md) | TEL | `agent_generated_file_downloaded {type}` | P-AGENT-14 | `endpoints/agentFileServer.js:79-81` | no |  |
| [SE-EXT-14](05-external-channels.md) | TEL | `workspace_created` telemetry; `audit_events: workspace.created` / `workspace.deleted` (legacy `api_workspace_created` / `api_workspace_deleted`) | P-EXT-10 | `api/workspace/index.js:91`, `:99`, `:263` | n/a |  |
| [SE-EXT-23](05-external-channels.md) | TEL | `sent_chat` telemetry; `audit_events: chat.sent` (legacy `api_sent_chat`) | P-EXT-12/13/16/24 | `api/workspace/index.js:718`, `:879`; `api/workspaceThread/index.js:471`, `:675`; `api/openai/index.js:154`, `:183` | n/a | Not recorded for mobile (route pending the access-policy branch) |
| [SE-EXT-29](05-external-channels.md) | TEL | telemetry; `audit_events: document.uploaded` and `document.embedded` | P-EXT-17/18 | `api/document/index.js:191`, `:212`, `:360`, `:381`, `:538`, `:559`, `:730`, `:747` | n/a |  |
| [SE-EXT-30](05-external-channels.md) | TEL | `agent_generated_file_downloaded` | P-EXT-19 | `api/document/index.js:1300`, `:1328` | n/a |  |
| [SE-EXT-37](05-external-channels.md) | TEL | `embed_sent_chat` | P-EXT-27 | `embed/index.js:48` | n/a |  |
| [SE-EXT-42](05-external-channels.md) | TEL | `audit_events: telegram.bot_connected` / `telegram.bot_disconnected` (+ `settings.changed` on update-config at `:362`) | P-EXT-30 | `server/endpoints/telegram.js:148`, `:175` | n/a |  |
| [SE-EXT-56](05-external-channels.md) | TEL | `browser_extension_*` | P-EXT-42 | `browserExtension.js:119`, `:145` | n/a |  |
| [SE-ADMIN-04](06-admin-system-and-runtime.md) | TEL | `system_settings.onboarding_complete` | P-ADMIN-01 | `server/utils/boot/markOnboarded.js:19` | no |  |
| [SE-ADMIN-06](06-admin-system-and-runtime.md) | TEL | `server_boot` | P-ADMIN-01 | `server/utils/telemetry/index.js:27` | no | skipped if disabled/dev |
| [SE-ADMIN-37](06-admin-system-and-runtime.md) | TEL | `telemetry_disabled` | P-ADMIN-18 | `server/utils/helpers/updateENV.js:636` | no | last event before opt-out |
| [SE-ADMIN-38](06-admin-system-and-runtime.md) | TEL | `experimental_live_file_sync`, `experimental_feature_enabled`; `audit_events: feature.toggled` | P-ADMIN-19 | `server/endpoints/experimental/liveSync.js:36-45`, audit at `:52` | yes |  |
| [SE-ADMIN-45](06-admin-system-and-runtime.md) | TEL | `enabled_multi_user_mode`; `audit_events: multi_user.enabled` (legacy `multi_user_mode_enabled`) | P-ADMIN-24 | `server/endpoints/system.js:850-854` | n/a |  |
| [SE-ADMIN-52](06-admin-system-and-runtime.md) | TEL | all catalogue events | P-ADMIN-32 | `server/models/telemetry.js:114-118` | no |  |
| [SE-UI-03](07-frontend-routes-and-flows.md) | TEL | email, use case, comment | P-UI-02 survey | `pages/OnboardingFlow/Steps/Survey/index.jsx:12-43` | no | skipped in dev (`:13-16`); sets `anythingllm_completed_questionnaire` |

## TIME

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-DOC-23](03-documents-and-ingestion.md) | TIME | Bree boot/stop (all jobs) | P-DOC-17 | `server/models/documentSyncQueue.js:42-48`; `server/utils/BackgroundWorkers/index.js:156-163` | Yes | Stops unrelated jobs |
| [SE-DOC-24](03-documents-and-ingestion.md) | TIME | `document_sync_queues.nextSyncAt` | P-DOC-18 | `server/models/documentSyncQueue.js:108-114` | Yes |  |
| [SE-AGENT-09](04-agents-tools-and-automation.md) | TIME | approval timeout timer (120 s default) | P-AGENT-03 | `websocket.js:351-362`; `http-socket.js:216-228` | n/a |  |
| [SE-AGENT-28](04-agents-tools-and-automation.md) | TIME | `scheduled_jobs` create; `later` timer; `scheduledJobCreated` | P-AGENT-21 | `create-scheduled-job/index.js:172-206` | yes (delete job) | gated |
| [SE-AGENT-37](04-agents-tools-and-automation.md) | TIME | `scheduled_jobs` CRUD; timer add/remove; queued runs failed | P-AGENT-28 | `endpoints/scheduledJobs.js:142-331`; `BackgroundWorkers/index.js:301-356` | delete: no |  |
| [SE-AGENT-47](04-agents-tools-and-automation.md) | TIME | Bree jobs (cleanup 8/9/12 hr, memory extraction 3 hr), scheduled-job timers | E-AGENT-22/23/24 | `BackgroundWorkers/index.js:29-61,106-143,178-197,274-309` | yes (setting toggle) |  |
| [SE-EXT-41](05-external-channels.md) | TIME | verify, long polling, retry timer | P-EXT-30 | `telegram.js:89`; `telegramBot/index.js:111-113`, `:281` | Stop |  |
| [SE-ADMIN-09](06-admin-system-and-runtime.md) | TIME | Bree cleanup/memory/sync jobs; cron timers | P-ADMIN-01 | `server/utils/BackgroundWorkers/index.js:125-142,301-309` | yes |  |
| [SE-ADMIN-35](06-admin-system-and-runtime.md) | TIME | add/remove `extract-memories` | P-ADMIN-14, P-ADMIN-22 | `server/utils/BackgroundWorkers/index.js:178-197` | yes | no-op if Bree stopped |
| [SE-ADMIN-39](06-admin-system-and-runtime.md) | TIME | whole BackgroundService boot (second Bree) or stop (all jobs, timers, `bree=null`) | P-ADMIN-19 | `server/models/documentSyncQueue.js:42-48`, `server/utils/BackgroundWorkers/index.js:106-163` | until restart | breaks embedding/telegram/scheduled jobs when disabled |
| [SE-ADMIN-59](06-admin-system-and-runtime.md) | TIME | `audit_events: vendor.data_sent` hourly counts per vendor, channel and hour (no content); timer flush | P-ADMIN-35 | `server/utils/audit/vendors.js` | no | provider classes wrapped at boot |

## OTHER

| ID | Class | Target | Trigger | Where | Reversible? | Notes |
|---|---|---|---|---|---|---|
| [SE-UI-07](07-frontend-routes-and-flows.md) | (clipboard) | `navigator.clipboard` write | many | `utils/clipboard.js:21`; `DisplayRecoveryCodeModal/index.jsx:33`; `ErrorBoundaryFallback/index.jsx:33`; `WorkspaceChat/index.jsx:192`; `CopyLinkToChat/index.jsx:22`; `ImageGenerationCard/index.jsx:72`; `ApiKeys/NewApiKeyModal/index.jsx:42`; `ApiKeyRow/index.jsx:23`; `BrowserExtensionApiKeyRow/index.jsx:39`; `NewBrowserExtensionApiKeyModal/index.jsx:42`; `CodeSnippetModal/index.jsx:60`; `Invitations/InviteRow/index.jsx:26`; `NewInviteModal/index.jsx:40` | no | secrets (API keys, recovery codes) put on the clipboard |
| [SE-UI-19](07-frontend-routes-and-flows.md) | (external link) | `window.open(outlookAuthUrl, "_blank")` | P-UI-35 | `pages/Admin/Agents/OutlookSkillPanel/index.jsx:162` | n/a |  |
| [SE-UI-23](07-frontend-routes-and-flows.md) | (header) | `X-Timezone`, `X-Language` sent to server | every request | `utils/request.js:15-16` | n/a | server stores per-user locale (`UserMetaCache`, `validatedRequest.js:21,108`) |
| [SE-UI-05](07-frontend-routes-and-flows.md) | (navigation) | full page reload / `window.location` | many | `SingleUserAuth.jsx:42`; `MultiUserAuth.jsx:211,263`; `Admin/Users/NewUserModal/index.jsx:40`; `EditUserModal/index.jsx:56`; `Admin/Workspaces/NewWorkspaceModal/index.jsx:21`; `ChatEmbedWidgets/.../NewEmbedModal/index.jsx:45`; `EditEmbedModal/index.jsx:33`; `WorkspaceSettings/Members/AddMemberModal/index.jsx:25`; `DeleteWorkspace/index.jsx:32-33`; `Security/index.jsx:67,240`; `ExperimentalFeatures/index.jsx:143,200` | n/a |  |
| [SE-UI-09](07-frontend-routes-and-flows.md) | (redirect) | `window.location.replace(redirectTo / SimpleSSONoLoginRedirect)` | P-UI-04, P-UI-06 | `Login/SSO/simple.jsx:49`; `Login/index.jsx:28` | n/a | `redirectTo` unvalidated client-side |
| [SE-DOC-25](03-documents-and-ingestion.md) | source | `/ext/resync-source-document` | P-DOC-19 | `server/jobs/sync-watched-documents.js:58-62` | No | Decrypts stored credentials |

