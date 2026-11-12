# 04 — Agents, tools and automation (AGENT)

## 1. Title and scope

Everything an agent can do and everything that runs without a person in the loop: how a chat
becomes an agent session (websocket, developer API, Telegram), the aibitat loop, provider
selection for agents, tool list assembly, mid-session tool toggles, tool approval and the
whitelist, every built-in skill, agent-generated files and their download routes, MCP servers,
agent flows, imported (Community Hub) agent skills, memories and their extraction job,
scheduled jobs and the web push notifications they send, the background worker service and the
Outlook / Gmail / Google Calendar setup endpoints. Ordinary (non-agent) chat streaming, document
ingestion, auth middleware internals, admin settings screens for agent skills and the Telegram
bot transport are left to the CHAT, DOC, AUTH, ADMIN and EXT files.

**Sources:** `server/utils/agents/` (index.js, ephemeral.js, defaults.js, imported.js,
aibitat/index.js, aibitat/plugins/**, aibitat/utils/summarize.js), `server/utils/chats/agents.js`,
`server/utils/chats/stream.js`, `server/utils/chats/apiChatHandler.js`,
`server/utils/telegramBot/chat/agent.js`, `server/utils/MCP/` (index.js, identity.js,
hypervisor/index.js), `server/utils/agentFlows/`, `server/utils/memories/index.js`,
`server/utils/BackgroundWorkers/index.js`, `server/utils/PushNotifications/index.js`,
`server/utils/helpers/agents.js`, `server/utils/helpers/shell.js`, `server/jobs/`
(run-scheduled-job.js, extract-memories.js, cleanup-generated-files.js,
cleanup-generated-images.js, helpers/*), `server/endpoints/` (agentWebsocket.js,
agentSkillWhitelist.js, agentFileServer.js, mcpServers.js, api/mcpServers/index.js,
agentFlows.js, experimental/imported-agent-plugins.js, communityHub.js, memory.js,
scheduledJobs.js, webPush.js, utils/outlookAgentUtils.js, utils/googleAgentSkillEndpoints.js),
`server/models/` (workspaceAgentInvocation.js, agentSkillWhitelist.js, scheduledJob.js,
scheduledJobRun.js, memory.js, communityHub.js, systemSettings.js excerpts),
`server/prisma/schema.prisma` (models at lines 198, 403, 417, 431),
`server/utils/middleware/communityHubDownloadsEnabled.js`, `server/utils/middleware/validWorkspace.js`.
Verified against commit `e82a80da`.

## 2. Mental model

### Actors

| Actor | How it reaches the agent domain |
|---|---|
| Person in the web UI | HTTP chat stream that hands off to `ws /api/agent-invocation/:uuid` |
| Developer API client | `/v1` chat endpoints, run synchronously through `EphemeralAgentHandler` |
| Telegram user | Telegram worker, `EphemeralAgentHandler` with Telegram IPC for approvals |
| Scheduler (no person) | `later` timers inside `BackgroundService` → child process `run-scheduled-job.js` |
| Bree cron (no person) | `extract-memories`, `cleanup-generated-files`, `cleanup-generated-images` |
| The LLM | chooses tool calls inside the aibitat loop; its arguments are untrusted input |
| External systems | search APIs, collector, SQL databases, Google Apps Script, Microsoft Graph, MCP servers, Community Hub, web push services |

### The agent session as a loop

An aibitat session is a two-node conversation, `USER` ↔ `@agent`
(`server/utils/agents/defaults.js:52-103`). `USER` has `interrupt: "ALWAYS"`, so after every
agent reply the loop parks and waits for the person (`server/utils/agents/aibitat/index.js:680-697,705-708`,
`server/utils/agents/aibitat/plugins/websocket.js:497-520`). Inside one agent reply the model can
chain tool calls recursively up to `maxToolCalls` (default 10, `AGENT_MAX_TOOL_CALLS`,
`server/utils/agents/aibitat/index.js:88-93`); after the limit it runs the last tool with no
tools offered and forces a text answer (`aibitat/index.js:1059-1069,1162`, `1226,1317`).

```mermaid
flowchart LR
  P[prompt / feedback] --> R[reply(): system prompt + history + parsed files]
  R --> RR{router attached?}
  RR -- yes --> RT[resolveRoute per turn]
  RR -- no --> M
  RT --> M[provider.stream / complete with tool schemas]
  M -- text --> OUT[newMessage → socket / handler] --> INT[interrupt: wait for USER]
  INT -- feedback --> P
  INT -- bail / timeout 5 min --> END[socket.close / terminate]
  M -- functionCall --> F{tool registered?}
  F -- no --> M
  F -- yes --> G{tool asks approval?}
  G -- no --> E[effect]
  G -- yes --> A{AGENT_AUTO_APPROVED_SKILLS / whitelist / runner override}
  A -- approved --> E
  A -- ask --> U[toolApprovalRequest → person, 120 s timeout]
  U -- approve --> E
  U -- reject / timeout --> RES
  E --> RES[result string as role:function]
  RES --> M
```

Key loop facts:

- The approval gate is **inside each tool**, not in the loop. A tool is gated only if its handler
  calls `this.super.requestToolApproval` (grep list in §6). MCP tools, flows, SQL, web, memory,
  filesystem reads and every Gmail/Outlook/Calendar read run ungated.
- `requestToolApproval` is supplied by the transport plugin: websocket asks the person
  (`websocket.js:254-364`); http-socket asks Telegram over IPC or **auto-denies**
  (`http-socket.js:118-230`); the scheduled-job runner replaces it with **auto-approve**
  (`server/jobs/run-scheduled-job.js:77-83`).
- A tool can short-circuit the loop with `skipHandleExecution` ("direct output"): the raw result
  becomes the reply (`aibitat/index.js:1113-1136`).
- Abort (stop button, socket close, bail command) sets `_aborted`, aborts the shared
  `AbortController` and settles pending approvals/clarifications as rejected
  (`aibitat/index.js:432-436`, `websocket.js:307-313`, `server/endpoints/agentWebsocket.js:41-47`).

### Tool effect classification

| Effect type | Tools |
|---|---|
| Read-only local | `rag-memory` (search), `document-summarizer`, `filesystem-read-text-file`, `filesystem-read-multiple-files`, `filesystem-list-directory`, `filesystem-search-files`, `filesystem-get-file-info`, `create-chart` (renders client-side only), `request-user-input` |
| Read external | `web-browsing` (search API), `web-scraping` (via collector), `sql-agent` list/schema tools, Gmail get-inbox/search/read-thread/get-draft/list-drafts/mailbox-stats, Calendar list/get/events, Outlook get-inbox/search/read-thread/list-drafts/mailbox-stats, MCP tools (unknown; treated as external), agent-flow `apiCall` GET |
| Write local | `rag-memory` (store → vector DB), `filesystem-write-text-file`, `-edit-file`, `-create-directory`, `-move-file`, `-copy-file`, all `create-files-agent` children (`storage/generated-files`), `generate-image` (`storage/generated-images`), `create-scheduled-job` (DB + timer), chat-history plugin (DB) |
| Write external | Gmail drafts/send/reply/mark/trash/archive/inbox, Calendar quick-add/create/update/set-status, Outlook drafts/send, `sql-agent-query` (no read-only enforcement), agent-flow `apiCall` with non-GET method, MCP tools that mutate |
| Code execution | MCP stdio servers (spawn arbitrary `command`), imported agent skills (`require(handler.js)` in-process), `sql-agent-query` (arbitrary SQL) |

### Resources, lifecycles, invariants

| Resource | Store | Lifecycle |
|---|---|---|
| Agent invocation | `workspace_agent_invocations` (`schema.prisma:198`) | created by `grepAgents` → consumed by one websocket → `closed=true` on socket close |
| aibitat session | memory only | built per websocket / per API call; discarded at close |
| Tool registry | `aibitat.functions` Map | filled by `#attachPlugins`; edited mid-session by `toggleAgentTool` |
| Approval whitelist | `system_settings` label `whitelisted_agent_skills` or `user_<id>_whitelisted_agent_skills` | append-only from UI; single-user list cleared on switch to multi-user (`server/endpoints/system.js:703`) |
| MCP server config | `storage/plugins/anythingllm_mcp_servers.json` | file edited by API/UI; processes live in the singleton `MCPCompatibilityLayer` |
| Agent flow | `storage/plugins/agent-flows/<uuid>.json` | file CRUD by admin |
| Imported skill | `storage/plugins/agent-skills/<hubId>/{plugin.json,handler.js}` | downloaded zip, inactive until toggled |
| Generated file/image | `storage/generated-files/<type>-<uuid>.<ext>`, `storage/generated-images/` | written by tool; referenced from `workspace_chats.response.outputs` or `scheduled_job_runs.result`; swept after 1 h if unreferenced |
| Scheduled job / run | `scheduled_jobs`, `scheduled_job_runs` (`schema.prisma:403-429`) | see §5 |
| Memory | `memories` (`schema.prisma:431`) | created by extraction job or UI; injected into system prompts |

Invariants the code relies on:

- An invocation is used once: `#validInvocation` throws if `closed` (`server/utils/agents/index.js:568-569`).
- A run row is created only if no `queued`/`running` row exists for the job (transaction in
  `server/models/scheduledJobRun.js:32-60`), so a job never overlaps itself.
- Terminal transitions on runs are conditional `updateMany` on non-terminal status, so the first
  writer wins (`scheduledJobRun.js:118-230`).
- Scheduled jobs, Gmail, Calendar, Outlook and `create-scheduled-job` are single-user only
  (`server/endpoints/scheduledJobs.js` uses `isSingleUserMode` throughout;
  `server/utils/agents/defaults.js:18,176`; `gmail/lib.js:265-272`).
- `BackgroundService`, `MCPCompatibilityLayer` and `PushNotifications` are process singletons
  (`BackgroundWorkers/index.js:63-71`, `MCP/index.js:54-58`, `PushNotifications/index.js:225-228`).

Patterns: the agent loop is a recursive tool-use loop with a human-interrupt node; plugins are a
**registry** keyed by name (`aibitat/plugins/index.js:19-56`) with the naming conventions
`parent#child`, `@@flow_<uuid>`, `@@mcp_<server>`, `@@<hubId>`
(`server/utils/agents/index.js:620-747`); the transport plugins are **adapters** that give the same
loop a websocket, an HTTP collector, or a scheduled-job collector; scheduled runs and memory
extraction are **state machines** driven by a cron + queue.

## 3. Entry points

| ID | Channel | Method + path / event / job | Middleware chain | Handler (path:line) | Who can call |
|---|---|---|---|---|---|
| E-AGENT-01 | ui | chat stream that matches `@agent…` or workspace `chatMode=automatic` with native tool support | (CHAT domain chat route) | `server/utils/chats/stream.js:55` → `server/utils/chats/agents.js:56` | any user who can chat in the workspace |
| E-AGENT-02 | ws | `WS /api/agent-invocation/:uuid` | **none** (no `validatedRequest`) | `server/endpoints/agentWebsocket.js:29` | anyone holding a live invocation UUID; user/workspace checked from the invocation row (`server/utils/agents/index.js:564-586`) |
| E-AGENT-03 | ws | socket messages `awaitingFeedback`, `toolApprovalResponse`, `clarificationHold`/`clarificationResponse`, `agentToolToggle`, bail words | — | `agentWebsocket.js:13-24`, `websocket.js:225,315,420,557` | the connected socket; toggles admin-only in multi-user |
| E-AGENT-04 | api | `/v1` workspace/thread chat when `isAgentInvocation` | `validApiKey` (EXT/API domain) | `server/utils/chats/apiChatHandler.js:190-260`, `:569-603` | API key holder |
| E-AGENT-05 | telegram | Telegram message routed to agent | Telegram worker (EXT domain) | `server/utils/telegramBot/chat/agent.js:230-244` | paired Telegram chat |
| E-AGENT-06 | ui | `GET /api/agent-skills/filesystem-agent/is-available`, `…/create-files-agent/is-available`, `…/image-generation/is-available` | `validatedRequest` | `server/endpoints/agentSkillWhitelist.js:13,31,49` | any authenticated session |
| E-AGENT-07 | ui | `POST /api/agent-skills/whitelist/add` | `validatedRequest`, `flexUserRoleValid(ROLES.all)` | `agentSkillWhitelist.js:66` | any role |
| E-AGENT-08 | ui | `GET /api/agent-skills/generated-files/:filename` | `validatedRequest`, `flexUserRoleValid([ROLES.all])` | `server/endpoints/agentFileServer.js:30` | any role with access to a workspace whose chat references the file |
| E-AGENT-09 | ui | `GET /api/image-generation/generated-images/:filename` | same | `agentFileServer.js:96` | same |
| E-AGENT-10 | ui | `GET /api/mcp-servers/force-reload`, `GET /list`, `POST /toggle`, `POST /delete`, `POST /toggle-tool` | `validatedRequest`, `flexUserRoleValid([ROLES.admin])` | `server/endpoints/mcpServers.js:13,36,56,79,100` | admin (or anyone in single-user) |
| E-AGENT-11 | api | `GET /v1/mcp-servers`, `POST /v1/mcp-servers/new`, `POST /reload`, `POST /:name/update`, `POST /:name/toggle`, `POST /:name/toggle-tool`, `DELETE /:name` | `validApiKey` | `server/endpoints/api/mcpServers/index.js:8,48,108,139,209,252,322` | API key holder |
| E-AGENT-12 | ui | `POST /api/agent-flows/save`, `GET /list`, `GET /:uuid`, `DELETE /:uuid`, `POST /:uuid/toggle` | `validatedRequest`, `flexUserRoleValid([ROLES.admin])` | `server/endpoints/agentFlows.js:14,55,76,139,168` | admin |
| E-AGENT-13 | ui | `POST /api/experimental/agent-plugins/:hubId/toggle`, `POST /:hubId/config`, `DELETE /:hubId` | `validatedRequest`, `flexUserRoleValid([ROLES.admin])` | `server/endpoints/experimental/imported-agent-plugins.js:13,31,50` | admin |
| E-AGENT-14 | ui | `GET/POST /api/community-hub/settings`, `GET /explore`, `POST /item`, `POST /apply`, `POST /import`, `GET /items`, `POST /:communityHubItemType/create` | `validatedRequest`, `flexUserRoleValid([ROLES.admin])` (+ `communityHubItem`, + `communityHubDownloadsEnabled` on import) | `server/endpoints/communityHub.js:20,34,50,68,92,131,171,186` | admin |
| E-AGENT-15 | ui | `GET/POST /api/workspaces/:slug/memories`, `PUT/DELETE /api/memories/:memoryId`, `POST /memories/:memoryId/promote`, `POST /memories/:memoryId/demote/:slug` | `validatedRequest`, `flexUserRoleValid([ROLES.all])`, `memoryFeatureEnabled`, `validWorkspaceSlug` / `validateMemoryOwner` | `server/endpoints/memory.js:45,72,101,126,146,168` | any role, own memories only in multi-user |
| E-AGENT-16 | ui | `GET /api/scheduled-jobs/available-tools`, `GET /runs/:runId`, `POST /runs/:runId/:action`, `GET /scheduled-jobs`, `POST /new`, `GET/PUT/DELETE /:id`, `POST /:id/toggle`, `POST /:id/trigger`, `GET /:id/runs` | `validatedRequest`, `isSingleUserMode` | `server/endpoints/scheduledJobs.js:19,34,64,116,142,199,221,277,294,335,359` | single-user instance only |
| E-AGENT-17 | ui | `POST /api/web-push/subscribe`, `GET /api/web-push/pubkey` | `validatedRequest` | `server/endpoints/webPush.js:9,21` | any authenticated session |
| E-AGENT-18 | ui | `POST /api/admin/agent-skills/outlook/auth-url`, `GET /status`, `POST /revoke` | `validatedRequest`, `isSingleUserMode` | `server/endpoints/utils/outlookAgentUtils.js:22,135,173` | single-user |
| E-AGENT-19 | ui (browser redirect from Microsoft) | `GET /api/agent-skills/outlook/auth-callback` | `validatedRequest`, `isSingleUserMode` | `outlookAgentUtils.js:90` | single-user |
| E-AGENT-20 | ui | `GET /api/admin/agent-skills/gmail/status`, `GET /api/admin/agent-skills/google-calendar/status` | `validatedRequest`, `isSingleUserMode` | `server/endpoints/utils/googleAgentSkillEndpoints.js:14,42` | single-user |
| E-AGENT-21 | job | `later.setInterval` per enabled scheduled job → `enqueueScheduledJob` → child `run-scheduled-job.js` | — | `server/utils/BackgroundWorkers/index.js:301-309,394-428,439-475`; `server/jobs/run-scheduled-job.js:23` | scheduler |
| E-AGENT-22 | job | Bree `extract-memories` every `MEMORY_EXTRACTION_INTERVAL` (default 3hr) when memories + auto extraction enabled | — | `BackgroundWorkers/index.js:47-52,168`; `server/jobs/extract-memories.js:25` | scheduler |
| E-AGENT-23 | job | Bree `cleanup-generated-files` (8hr), `cleanup-generated-images` (9hr) | — | `BackgroundWorkers/index.js:29-45`; `server/jobs/cleanup-generated-files.js:9`; `server/jobs/cleanup-generated-images.js` | scheduler |
| E-AGENT-24 | boot | `BackgroundService.boot()` (fails orphan runs, registers timers), `PushNotifications.setupPushNotificationService()` | — | `server/utils/boot/index.js:40-42,74-76`; `BackgroundWorkers/index.js:106-143` | server start |
| E-AGENT-25 | boot (lazy) | MCP servers boot on first `activeMCPServers()` / `servers()` call | — | `server/utils/MCP/index.js:65-68`; `MCP/hypervisor/index.js:572-643` | first agent session or MCP list |

## 4. User paths

### P-AGENT-01 — A web chat becomes an agent session

- **Actor and preconditions:** any user allowed to chat in the workspace (CHAT domain); message
  starts with `@agent`, or workspace `chatMode === "automatic"` and
  `Workspace.supportsNativeToolCalling(workspace)` is true. Both modes.
- **Steps:**
  1. Chat stream → `streamChatWithWorkspace` runs slash-command expansion then `grepAgents`
     (`server/utils/chats/stream.js:38,55-65`).
  2. `grepAgents` parses handles (`server/models/workspaceAgentInvocation.js:7-10`: only when the
     prompt starts with `@agent`), or checks native tooling in automatic mode
     (`server/utils/chats/agents.js:70-74`).
  3. Creates the invocation row (`workspaceAgentInvocation.js:22-39`), caches attachments and the
     session reasoning effort in in-process Maps keyed by invocation UUID
     (`chats/agents.js:14,43,101-103`).
  4. Streams `agentInitWebsocketConnection` with `websocketUUID`, then a closing
     `statusResponse` (`chats/agents.js:105-125`). The HTTP stream ends.
  5. Frontend opens `ws …/api/agent-invocation/<uuid>`
     (`frontend/src/components/WorkspaceChat/ChatContainer/index.jsx:385`).
  6. `AgentHandler.init()` → `#validInvocation` (row exists, not closed, has workspace; if
     `user_id` set: user exists, not suspended, `Workspace.getWithUser` finds the workspace)
     (`server/utils/agents/index.js:564-586`) → `#providerSetupAndCheck` (P-AGENT-02 provider
     rules) → pull cached attachments/effort (`index.js:803-815`).
  7. `Telemetry agent_chat_started` (`agentWebsocket.js:65`), `createAIbitat`
     (`index.js:915-1021`): attach `model-router-cooldown`, `websocket`, `chat-history`, load the
     two agents and their tool names, attach every tool.
  8. If the socket already closed, stop; else `startAgentCluster()` sends the prompt with
     `@agent` stripped (empty → `"Hello!"`) (`agentWebsocket.js:68-69`, `index.js:1031-1046`).
- **Reads:** `workspaces`, `workspace_agent_invocations`, `users`, `workspace_users` (via
  `getWithUser`), `workspace_chats` (last 20 for history, `index.js:89-134`),
  `system_settings` (skills), MCP config file, flows dir, imported skills dir.
- **State changes:** `workspace_agent_invocations` row created (`closed=false`); on socket close
  `closed: false → true` (`agentWebsocket.js:46`, `workspaceAgentInvocation.js:12-20`).
- **Side effects:** SE-AGENT-01, SE-AGENT-02, SE-AGENT-03, SE-AGENT-04; MCP boot on first session
  (SE-AGENT-30).
- **Failure and edge paths:** invocation create fails → stream says agents "could not be called"
  with `close: true`, then `grepAgents` returns `undefined` (`chats/agents.js:82-97`), so
  `isAgentChat` is falsy and the normal chat path keeps writing to the same response after the
  "closed" chunk (`stream.js:65`). Missing/closed invocation → socket closed with no message
  (`agentWebsocket.js:35-38`); validation/provider errors → `wssFailure` + close
  (`agentWebsocket.js:70-73`).
- **Notes:**
  - The websocket route has no auth middleware; possession of the UUID is the credential. An
    invocation whose socket never connects stays `closed=false` indefinitely; nothing expires it
    (no cleanup found) **(unverified that no other sweeper exists)**.
  - The attachment/effort caches are per process; a websocket landing on another server
    process would lose them (single-process deployment assumed) **(unverified)**.
  - In automatic mode every message in a capable workspace becomes an agent session.

### P-AGENT-02 — One agent turn: provider selection, tool assembly, loop, persistence

- **Actor and preconditions:** an active session from P-AGENT-01, P-AGENT-06, P-AGENT-07 or
  P-AGENT-29.
- **Steps:**
  1. **Provider:** `workspace.agentProvider` → else fallback: workspace `chatProvider`
     `anythingllm-router` → workspace `chatProvider+chatModel` → `LLM_PROVIDER` +
     `providerDefault` (`index.js:428-462,471-488,490-502`). Model: `workspace.agentModel` else
     `providerDefault` (env `*_MODEL_PREF` or hard-coded default, `index.js:330-418`).
     `anythingllm-router` resolves via `AnythingLLMModelRouter.resolve` with routing context
     (`index.js:504-562`). `checkSetup` throws if the provider's env key/base path is missing
     (`index.js:136-322`).
  2. **Tool list:** `WORKSPACE_AGENT.getDefinition` (`defaults.js:72-103`): system prompt
     (workspace prompt with variables + memories, `aibitat/providers/ai-provider.js:627-644`),
     then names from `agentSkillsFromSystemSettings` (`defaults.js:131-200`):
     DEFAULT_SKILLS (`rag-memory`, `document-summarizer`, `web-scraping`, `web-browsing`) minus
     `disabled_agent_skills`; plus each name in `default_agent_skills`, skipping
     `create-scheduled-job` in multi-user; multi-tool parents expand to `parent#child`, filtered
     by availability and `disabled_*_skills` (`defaults.js:24-50,157-193`); plus
     `request-user-input#…` children when `agent_clarifying_questions_enabled`
     (`defaults.js:112-124`); plus active imported skills, active flows, all running MCP servers
     (`defaults.js:97-99`).
  3. **Attach:** each name resolved by `#attachPluginByName` (`index.js:620-747`); unknown names
     are logged and skipped.
  4. **Loop:** `reply()` builds messages, injects fresh parsed-file + pinned-doc context into the
     last user message (`aibitat/index.js:890-918`, `index.js:822-882`), optionally reranks tools
     (`ToolReranker`, top 15, `aibitat/index.js:927-944`), re-resolves the route for every turn
     after the first (`index.js:951-988`), then streams or completes
     (`aibitat/index.js:957-985,1049,1216`) and recurses on tool calls (`aibitat/index.js:1027-1189`).
     Each executed tool emits `Telemetry agent_tool_call` and `toolCallResult`
     (`aibitat/index.js:1099-1105`).
  5. **Persist:** `chat-history` plugin pre-creates a `workspace_chats` row with empty response
     when the USER message arrives (`chat-history.js:23-66`), then upserts prompt + response +
     citations + outputs + metrics after the agent reply (`chat-history.js:68-137`), auto-renames
     the thread (`chat-history.js:180-204`) and emits `promptChatId` / `rename_thread`.
  6. **Wait:** `onInterrupt` → `WAITING_ON_INPUT`; feedback arrives as `awaitingFeedback`; 5 min
     idle → treated as `exit` (`websocket.js:54,497-598`). Before continuing, the 24 h message
     quota is re-checked in multi-user (`websocket.js:33-42,506-513`). `/img …` during the wait
     generates an image inline and carries it into the next turn (`websocket.js:103-160,564-573`).
- **Reads:** `system_settings`, `workspace_chats`, `workspace_parsed_files` / pinned documents,
  `memories`, router tables (CHAT/ADMIN domain), provider env vars.
- **State changes:** `workspace_chats` row created then updated; `workspace_threads.name` may
  change; `memories.lastUsedAt` updated (`server/utils/memories/index.js:51`).
- **Side effects:** SE-AGENT-02, SE-AGENT-03, SE-AGENT-05, SE-AGENT-06, SE-AGENT-07.
- **Failure and edge paths:** provider error → `APIError` → `newError` → `wssFailure` + terminate
  (`aibitat/index.js:989-1001`, `websocket.js:188-199`); route re-resolution failure keeps the
  old route (`index.js:981-987`); unknown tool name → model told "not found" and retried
  (`aibitat/index.js:1071-1086`); abort mid-stream discards partial tool calls
  (`aibitat/index.js:1052-1055`); chat-history skips saving after abort
  (`chat-history.js:18-20,70`). The pre-created chat row stays with empty text if the turn dies.
- **Notes:** `resolveRoute` re-reads the workspace row every turn, so admin config edits apply
  mid-session (`index.js:963-966`). The ephemeral handler only re-resolves when routed
  (`ephemeral.js:559-575`).

### P-AGENT-03 — Tool approval and "always allow" whitelist

- **Actor and preconditions:** a gated tool is called (see SE list / §6 for gated tools).
- **Steps:**
  1. Tool calls `requestToolApproval({skillName, payload, description})`.
  2. Websocket transport (`websocket.js:254-364`): if `AGENT_AUTO_APPROVED_SKILLS` lists the name
     or `<all>` → approve (`server/utils/helpers/agents.js:11-31`); else if
     `AgentSkillWhitelist.isWhitelisted(skillName, userId)` → approve
     (`server/models/agentSkillWhitelist.js:75-78`); else send `toolApprovalRequest` with
     `requestId`, wait for `toolApprovalResponse` with matching id, or time out after
     `TOOL_CALL_APPROVAL_TIMEOUT_MS` (default 120 s) → rejected (`websocket.js:49-55,351-362`).
  3. "Always allow" in the UI calls `POST /api/agent-skills/whitelist/add`
     (`agentSkillWhitelist.js:66-96`) → `AgentSkillWhitelist.add` upserts the JSON list under
     `whitelisted_agent_skills` (single-user) or `user_<id>_whitelisted_agent_skills`
     (`agentSkillWhitelist.js:12-15,41-67`).
- **Reads:** `system_settings` whitelist rows, env.
- **State changes:** `system_settings.value` (whitelist label): `[…] → […, skillName]` (row
  created if absent).
- **Side effects:** SE-AGENT-08, SE-AGENT-09.
- **Failure and edge paths:** unknown/blank `skillName` → 400; multi-user without session → 401.
  Rejected/timeout approvals return a message string to the model; the tool does nothing.
- **Notes:**
  - Any role can whitelist any string for itself; there is no remove endpoint in this domain
    (only the bulk single-user clear at `server/endpoints/system.js:703`).
  - http-socket checks the whitelist with `userId = null` (`http-socket.js:133-136`), so API and
    Telegram sessions use the single-user list even in multi-user mode, and that list is cleared
    on the switch to multi-user.
  - Without Telegram context the http-socket transport auto-denies (`http-socket.js:149-160`):
    gated tools never run over the developer API unless env-approved or whitelisted.
  - Approval granularity is the skill name, not the arguments: whitelisting
    `gmail-send-email` approves every future recipient/body.

### P-AGENT-04 — Mid-session tool toggle

- **Actor and preconditions:** multi-user admin, or anyone in single-user mode, with a live socket.
- **Steps:** socket message `{type:"agentToolToggle", skill, enabled, serverName}` is claimed
  first by `handleToolToggle` (`agentWebsocket.js:18`, `websocket.js:225-241`) →
  `userCanToggleTools` (`websocket.js:15-23`) → `aibitat.toggleAgentTool`
  (`index.js:760-779`) → `resolveAgentSkill` maps the id to loadable and registered names
  (`defaults.js:216-264`). Enable: push name into `@agent.functions` and re-attach; disable:
  `aibitat.removeFunction` (`aibitat/index.js:1618`).
- **Reads:** `users.role`, flows dir, imported dir, MCP config.
- **State changes:** in-memory only (`aibitat.functions`, `@agent.functions`).
- **Side effects:** SE-AGENT-10 (CACHE); enabling an MCP server tool reloads that server's tools
  (SE-AGENT-30).
- **Failure and edge paths:** non-admin toggles are silently ignored (logged only,
  `websocket.js:230-233`). Unknown ids fall through to "treat as name" (`defaults.js:262-263`)
  and the attach step logs and skips.
- **Notes:** enabling does not consult `default_agent_skills`, `disabled_*_skills`, availability
  or `SINGLE_USER_ONLY_SKILLS`, so an admin can enable a skill for this session that settings have
  turned off, including `create-scheduled-job` in multi-user **(behavior of that tool in
  multi-user then unverified)**.

### P-AGENT-05 — Clarifying questions (`request-user-input`)

- **Actor and preconditions:** `agent_clarifying_questions_enabled = "true"`; websocket session.
- **Steps:** children are added as `request-user-input#<child>` (`defaults.js:112-124`); the plugin
  only registers when `aibitat.requestUserClarification` exists
  (`request-user-input.js:109-111`); handler calls it (`request-user-input.js:243`), which sends
  `clarificationRequest` and waits (2 min, extended to 15 min on `clarificationHold`)
  (`websocket.js:56-59,380-479`); answers are stored as a survey for persistence
  (`request-user-input.js:252`, `chat-history.js:111-123`).
- **Reads:** `system_settings` (`agent_clarifying_questions_max_per_turn`, `request-user-input.js:49`).
- **State changes:** none beyond the chat row's `clarifyingQuestions`.
- **Side effects:** SE-AGENT-02 (WS).
- **Failure and edge paths:** timeout/abort → every answer marked skipped (`websocket.js:399-411`).
- **Notes:** the ephemeral handler omits these children from its load list
  (`ephemeral.js:426-431`) and http-socket provides no `requestUserClarification`, so API and
  Telegram sessions never offer the tool.

### P-AGENT-06 — Developer API agent chat (ephemeral)

- **Actor and preconditions:** API key holder; message is an agent invocation
  (`ephemeral.js:635-660`).
- **Steps:** `apiChatHandler` builds `EphemeralAgentHandler({workspace, prompt, userId, threadId,
  sessionId, attachments, parsedDocuments})` (`apiChatHandler.js:201-210`) → `init()` (provider
  only; **no invocation row and no user/workspace re-validation** inside the handler,
  `ephemeral.js:434-437`) → `createAIbitat({handler: EphemeralEventListener})` attaches
  `httpSocket` and all tools (`ephemeral.js:529-608`) → `startAgentCluster` → `waitForClose`
  packs thoughts/text/outputs/citations/metrics (`ephemeral.js:691-750`) → caller writes one
  `workspace_chats` row with `apiSessionId` (`apiChatHandler.js:229-245`). Streaming variant uses
  `streamAgentEvents` (`apiChatHandler.js:594-603`, `ephemeral.js:752-842`).
- **Reads:** same as P-AGENT-02 except history is filtered by `api_session_id`
  (`ephemeral.js:102-146`).
- **State changes:** `workspace_chats` row created by the caller (chat-history plugin is not
  attached).
- **Side effects:** SE-AGENT-03, SE-AGENT-11.
- **Failure and edge paths:** http-socket closes the handler on the **first** non-USER message
  (`http-socket.js:234-240`), so the session is one agent reply; approvals auto-deny
  (P-AGENT-03).
- **Notes:** authorization for the workspace/user is the caller's responsibility (EXT domain).

### P-AGENT-07 — Telegram agent chat

- **Actor and preconditions:** paired Telegram chat (EXT domain).
- **Steps:** `EphemeralAgentHandler` with `userId: null` (`telegramBot/chat/agent.js:230-237`),
  `createAIbitat({handler, telegramChatId})`, `maxRounds = 2` (`agent.js:238-242`). Approval
  requests go to the parent over worker IPC (`http-socket.js:14-39,206-214`) and are answered by
  Telegram callbacks (`server/utils/telegramBot/index.js:524,664`).
- **State changes:** chat persistence handled by the Telegram code (EXT domain).
- **Side effects:** SE-AGENT-12 (PUSH via Telegram), SE-AGENT-03.
- **Notes:** `userId: null` means per-user whitelist, memories and MCP identity forwarding see no
  user for Telegram sessions.

### P-AGENT-08 — `web-browsing` (search)

- **Actor and preconditions:** skill not in `disabled_agent_skills` (default on).
- **Steps:** handler → `search()` reads `system_settings.agent_search_provider`
  (`web-browsing.js:52-59,66-131`) and dispatches to one of: SerpApi, SearchApi, Serper.dev,
  Bing, Baidu, Serply, SearXNG (`AGENT_SEARXNG_API_URL`), Tavily, DuckDuckGo HTML, Exa,
  Perplexity, Brave, fastCRW (optional `AGENT_CRW_API_URL`), You.com, Keenable, AnySearch,
  Firecrawl, DeepSeek. Citations added from results (`web-browsing.js:138-165`).
- **Reads:** `system_settings`, `AGENT_*` API keys from env.
- **State changes:** none.
- **Side effects:** SE-AGENT-13.
- **Failure and edge paths:** missing key → introspect + "not set up" string; provider error →
  error string to the model.
- **Notes:** with no provider configured the default is **You.com's keyless tier**, falling back to
  DuckDuckGo on failure (`web-browsing.js:126-130,1602-1711`). The model's query (which can
  contain chat or document content) leaves the instance even if an admin never chose a search
  provider.

### P-AGENT-09 — `web-scraping`

- **Steps:** `new CollectorApi().getLinkContent(url)` (`web-scraping.js:97-102`); if under the
  model's context limit return content, else `summarizeContent` (`web-scraping.js:118-142`).
- **Side effects:** SE-AGENT-14 (NET:collector, then the collector fetches the URL); summarization
  calls the LLM (SE-AGENT-03).
- **Notes:** URL is model-chosen; any private-address filtering lives in the collector
  **(unverified here; see DOC/collector file)**. Summarization past
  `CHUNKS_BEFORE_APPROVAL` sections asks approval as `content-summarization`
  (`aibitat/utils/summarize.js:145-162`).

### P-AGENT-10 — `rag-memory` (vector search / store)

- **Steps:** dedupe repeated identical calls (`memory.js:64-71`); `search` →
  `vectorDB.performSimilaritySearch` on `workspace.slug` (`memory.js:84-125`); `store` →
  `vectorDB.addDocumentToNamespace` with a synthetic `agent-memory.txt` doc (`memory.js:126-161`).
- **Reads:** vector DB namespace.
- **State changes:** `store`: vector rows added to the workspace namespace.
- **Side effects:** SE-AGENT-15 (VEC), embedder call (NET:embedder, unverified provider).
- **Notes:** `store` is ungated and writes into the shared workspace namespace that every
  workspace member's RAG reads; no `workspace_documents` row is created, so the content cannot
  be found or removed through document management **(unverified that no DB row is written by
  `addDocumentToNamespace` with `null` fullFilePath)**. Distinct from the `memories` table
  (P-AGENT-31/32). In a scheduled job `invocation.workspace` is null so `workspace.slug` throws
  and the tool returns an error string.

### P-AGENT-11 — `document-summarizer`

- **Steps:** `list` → `Document.where({workspaceId})` (`summarize.js:70-93`); `summarize` → match
  filename, `Document.content(docId)` (reads the stored document JSON), return or summarize
  (`summarize.js:102-170`).
- **Reads:** `workspace_documents`, document files under `storage/documents` (DOC domain).
- **Side effects:** SE-AGENT-03 when summarizing.

### P-AGENT-12 — `sql-agent`

- **Actor and preconditions:** `sql-agent` in `default_agent_skills`; connections in
  `system_settings.agent_sql_connections` (`SQLConnectors/index.js:50-56`).
- **Steps:** `sql-list-databases` lists configured ids; list-tables/get-table-schema run fixed
  parameterized queries (`list-table.js:57-85`, `get-table-schema.js:64-92`);
  `sql-query` runs `db.runQuery(sql_query)` with the model's SQL verbatim
  (`query.js:61-95`). Engines: MySQL, PostgreSQL, SQL Server (`SQLConnectors/index.js:28-40`).
- **Reads:** `system_settings` (connection strings in plaintext JSON).
- **Side effects:** SE-AGENT-16.
- **Notes:** "read-only" is only stated in the tool description (`query.js:16`); no statement
  filtering, read-only transaction or approval exists (`Postgresql.js:31-49`). The DB user's
  privileges are the only guard. The SQL text is echoed to the client via introspect
  (`query.js:80`).

### P-AGENT-13 — `filesystem-agent`

- **Actor and preconditions:** in `default_agent_skills`; `isToolAvailable()` true only in Docker
  runtime or development (`filesystem/lib.js:41-44`). Not restricted in multi-user mode.
- **Steps:** each child validates paths against allowed directories (default
  `STORAGE_DIR/anythingllm-fs`, `lib.js:53-87`), including `realpath` symlink checks
  (`lib.js:445-490`). Writes ask approval: write-text-file (`write-text-file.js:61`), edit-file
  unless dry-run (`edit-file.js:95`), create-directory (`create-directory.js:52`), move
  (`move-file.js:64`), copy (`copy-file.js:93`). Reads (read-text, read-multiple, list,
  search, get-file-info) are ungated.
- **State changes:** files under `storage/anythingllm-fs` written/moved/copied; directory created
  on first use.
- **Side effects:** SE-AGENT-17.
- **Notes:** one shared root for all users and workspaces in multi-user mode; image files read are
  attached to the next model call as vision input (`lib.js:16-33`, `aibitat/index.js:1138-1158`)
  **(the attachment path for filesystem images is inferred from constants; unverified)**.

### P-AGENT-14 — `create-files-agent` and download

- **Actor and preconditions:** in `default_agent_skills`; Docker or development
  (`create-files/lib.js:57-60`).
- **Steps:** children `create-pptx-presentation`, `create-text-file`, `create-pdf-file`,
  `create-excel-file`, `create-docx-file` each request approval
  (`create-presentation.js:188`, `create-text-file.js:106`, `create-pdf-file.js:71`,
  `create-excel-file.js:203`, `create-docx-file.js:141`) → `saveGeneratedFile` writes
  `storage/generated-files/<type>-<uuid>.<ext>` (`create-files/lib.js:213-231`) → socket
  `fileDownloadCard` + `registerOutput` (`create-pdf-file.js:102-115`, `lib.js:151-166`) → saved
  into the chat row's `outputs`. PPTX sections are built by child aibitat agents
  (`pptx/section-agent.js:1-28`).
- **Download:** `GET /api/agent-skills/generated-files/:filename` → filename regex → find a chat in
  a workspace the requester can access whose `response` contains the filename and whose
  `outputs[].payload.storageFilename` matches; single-user also searches completed
  `scheduled_job_runs` → stream with `Content-Disposition: attachment`
  (`agentFileServer.js:30-88,153-230`).
- **State changes:** file written.
- **Side effects:** SE-AGENT-18, SE-AGENT-19, SE-AGENT-20 (docx image fetch), SE-AGENT-21 (TEL).
- **Failure and edge paths:** bad filename → 400; no referencing chat → 404.
- **Notes:** access is per **workspace**, not per chat owner: any member of the workspace who
  learns the UUID filename can download another member's generated file
  (`agentFileServer.js:173-207`). `create-docx-file` fetches any http(s) image URL in the
  markdown from the server (`docx/utils.js:188-201`) — server-side request to a model-chosen
  host.

### P-AGENT-15 — `generate-image` and serving

- **Preconditions:** an image provider configured (`IMAGE_GEN_PROVIDER`,
  `agentSkillWhitelist.js:49-63`).
- **Steps:** pick source images (attachments, last generated, history) (`generate-image.js:22-41`)
  → `generateImageForWorkspace` / `editImageForWorkspace` write to `storage/generated-images`
  (`ImageGenerators/index.js:3-41`) → push output and immediately persist it on the tracked chat
  row so the serve route can authorize (`generate-image.js:47-54,147-155`) → socket
  `imageGenerationCard`.
- **Serving:** `GET /api/image-generation/generated-images/:filename` with the same
  `findFileSource` rule (`agentFileServer.js:96-138`).
- **Side effects:** SE-AGENT-22 (NET:image-provider, FS), SE-AGENT-02.
- **Notes:** ungated; the scheduled-job file lookup only matches `status: "completed"` runs.

### P-AGENT-16 — `create-chart` (rechart)

- **Steps:** parse dataset JSON, send `rechartVisualize` over the socket, set
  `_replySpecialAttributes` so the reply is stored as type `rechartVisualize`
  (`rechart.js:61-108`, `chat-history.js:84-92`). Once per reply (`rechart.js:63-68`).
- **Side effects:** SE-AGENT-02 only. Read-only local.

### P-AGENT-17 — Gmail tools (`gmail-agent`)

- **Actor and preconditions:** single-user mode; `gmail_agent_config` has `deploymentId` and
  `apiKey` (`gmail/lib.js:235-312`); in `default_agent_skills`; children not in
  `disabled_gmail_skills`.
- **Steps:** every action POSTs to the user's Google Apps Script web app
  `https://script.google.com/macros/s/<deploymentId>/exec` with the key in the body
  (`gmail/lib.js:330-360`). Reads: get-inbox, search, read-thread, get-draft, list-drafts,
  mailbox-stats. Gated writes: create-draft, create-draft-reply, update-draft, delete-draft,
  send-draft, send-email, reply-to-thread, mark-read, mark-unread, move-to-trash,
  move-to-archive, move-to-inbox (file:line list in §6, SE-AGENT-23). Attachment parsing on
  read asks approval, writes the attachment to `os.tmpdir()` and parses it through the collector
  (`gmail/lib.js:75-110,151-175`).
- **Side effects:** SE-AGENT-23, SE-AGENT-24.
- **Failure and edge paths:** multi-user → initialize returns an error string
  (`gmail/lib.js:265-272`).
- **Notes:** email bodies, recipients and parsed attachments flow into the LLM prompt; send
  approval shows the payload but can be whitelisted per skill name.

### P-AGENT-18 — Google Calendar tools (`google-calendar-agent`)

- **Preconditions:** single-user; `google_calendar_agent_config` set
  (`google-calendar/lib.js:31-44,61-105`).
- **Steps:** same Apps Script bridge pattern (`google-calendar/lib.js:126`). Reads:
  list-calendars, get-calendar, get-event, get-events-for-day, get-events, get-upcoming-events.
  Gated writes: quick-add (`gcal-quick-add.js:52`), create-event (`gcal-create-event.js:138`),
  update-event (`gcal-update-event.js:104`), set-my-status (`gcal-set-my-status.js:63`).
- **Side effects:** SE-AGENT-25.

### P-AGENT-19 — Outlook tools (`outlook-agent`)

- **Preconditions:** single-user; `outlook_agent_config` with client credentials and tokens
  (`outlook/lib.js:551-570`).
- **Steps:** Microsoft Graph `https://graph.microsoft.com/v1.0` (`outlook/lib.js:467`); access
  token refreshed when expired via `login.microsoftonline.com` and written back to
  `system_settings` (`outlook/lib.js:691-757,760-795`). Reads: get-inbox, search, read-thread,
  list-drafts, mailbox-stats. Gated writes: create-draft (`outlook-create-draft.js:135`),
  update-draft (`:81`), delete-draft (`:46`), send-draft (`:44`), send-email
  (`outlook-send-email.js:134`); attachment parsing gated (`outlook/lib.js:171,389`).
- **State changes:** `system_settings.outlook_agent_config.{accessToken,refreshToken,tokenExpiry}`
  on refresh.
- **Side effects:** SE-AGENT-26, SE-AGENT-24.

### P-AGENT-20 — Integration setup endpoints (Outlook OAuth, Gmail/Calendar status)

- **Actor and preconditions:** single-user mode (`isSingleUserMode` returns 401 in multi-user,
  `multiUserProtected.js:16-21`).
- **Steps (Outlook):** `POST /admin/agent-skills/outlook/auth-url` saves client id/secret/tenant
  /authType into `outlook_agent_config` and returns an authorize URL
  (`outlookAgentUtils.js:22-87`, `outlook/lib.js:580-607`); Microsoft redirects to
  `GET /agent-skills/outlook/auth-callback?code=…` → `exchangeCodeForToken` stores tokens
  (`outlookAgentUtils.js:90-132`, `outlook/lib.js:611-680`); `GET …/status` returns masked config
  (`outlookAgentUtils.js:135-170`); `POST …/revoke` deletes the setting
  (`outlookAgentUtils.js:173-186`).
- **Steps (Gmail/Calendar):** status endpoints return `deploymentId` and a masked key
  (`googleAgentSkillEndpoints.js:14-40,42+`). The config itself is written through the generic
  system-settings update with merge validators (`server/models/systemSettings.js:273-312`) —
  ADMIN domain.
- **State changes:** `system_settings.outlook_agent_config` created/updated/deleted.
- **Side effects:** SE-AGENT-27.
- **Notes:** the redirect URI is built from `X-Forwarded-Proto`/`X-Forwarded-Host`
  (`outlookAgentUtils.js:12-16`); the authorize request carries no `state` or PKCE parameter
  (`outlook/lib.js:597-603`), so the callback cannot bind the code to the session that started
  the flow. Whether a browser redirect passes `validatedRequest` when an instance password is
  set is **(unverified; AUTH domain)**.

### P-AGENT-21 — Agent creates a scheduled job (`create-scheduled-job`)

- **Actor and preconditions:** single-user (excluded in multi-user, `defaults.js:18,176`); in
  `default_agent_skills`.
- **Steps:** convert the model's local cron to UTC using the user's timezone from
  `UserMetaCache` (`create-scheduled-job/index.js:122-130`); validate requested tools against the
  scheduled-job catalog (`:136-146`); check `canActivate` (`:149-152`, `MAX_ACTIVE` is `null` so
  unlimited, `scheduledJob.js:43`); request approval with the full payload (`:154-170`);
  `ScheduledJob.create` (`:172-178`); `new BackgroundService().addScheduledJob(job)` (`:182`);
  emit `scheduledJobCreated` card and pending output (`:191-206`).
- **State changes:** `scheduled_jobs` row created (`enabled=true`, `nextRunAt` computed).
- **Side effects:** SE-AGENT-28 (DB, TIME, WS).
- **Notes:** this tool is how a chat turns into unattended work; see P-AGENT-29 for what the job
  may then do without approval.

### P-AGENT-22 — MCP tool call (boot, conversion, suppression, identity)

- **Actor and preconditions:** at least one server in the MCP config file without
  `anythingllm.autoStart: false`.
- **Steps:**
  1. Config path: `storage/plugins/anythingllm_mcp_servers.json` (`STORAGE_DIR/plugins/…` in
     production), created empty if missing (`MCP/hypervisor/index.js:72-97`).
  2. First `activeMCPServers()` boots all servers once (`MCP/index.js:65-68`,
     `hypervisor/index.js:572-643`). stdio servers are spawned with `command`/`args` and an env of
     the **whole server `process.env`** (from `patchShellEnvironmentPath`,
     `server/utils/helpers/shell.js:8-21`) merged with the server's `env`
     (`hypervisor/index.js:376-413,481-490`); http/sse servers use
     `StreamableHTTPClientTransport`/`SSEClientTransport` (`hypervisor/index.js:497-520`); 30 s
     connect timeout (`:546-563`).
  3. Each session adds `@@mcp_<name>` for every running server (`defaults.js:99`);
     `convertServerToolsToPlugins` lists tools, drops names in `anythingllm.suppressedTools`, and
     registers each as `<server>-<tool>` (`MCP/index.js:76-197`).
  4. Identity forwarding: if `anythingllm.forwardIdentity` is set, user id/username/role and
     workspace id/slug are sent as `X-AnythingLLM-*` headers (http) and
     `_meta["com.anythingllm/identity"]` (all transports) (`MCP/identity.js:1-40,98-150`).
  5. Tool call: `callTool` with per-server timeout `anythingllm.timeout` seconds
     (`MCP/index.js:132-186`, `hypervisor/index.js:256-263`).
- **Reads:** MCP config file, `users` (for forwarded username/role).
- **State changes:** child processes / remote sessions held in `this.mcps`.
- **Side effects:** SE-AGENT-29, SE-AGENT-30.
- **Notes:** MCP tools never ask approval; their descriptions and results are untrusted text fed
  straight to the model. Every running server's tools load into every session in every workspace
  for every user. Suppression is per server, global.

### P-AGENT-23 — MCP admin in the UI

- **Actor:** admin (multi-user) or anyone (single-user).
- **Steps:** list (boots servers, returns config incl. `env` and process pid,
  `MCP/index.js:201-262`), toggle start/stop (`:265-289`), delete (kill + remove from file,
  `:292-317`), toggle-tool suppression (`:426+`, `hypervisor/index.js:183-230`), force-reload
  (`mcpServers.js:13-33`).
- **State changes:** MCP config file rewritten (delete, suppression); processes killed/started.
- **Side effects:** SE-AGENT-30, SE-AGENT-31.
- **Notes:** the UI router has no create/update route; new servers come from editing the file or
  the developer API (P-AGENT-24). The list response exposes each server's configured `env`
  values to the admin client.

### P-AGENT-24 — MCP management via the developer API

- **Actor and preconditions:** any valid developer API key.
- **Steps:** `POST /v1/mcp-servers/new {name, config}` → `saveServer(name, config, {create:true})`
  → `writeMCPServerToConfig` (requires `command` or `url`, `hypervisor/index.js:147-180`) → kill
  old instance → `startMCPServer` unless `autoStart:false` (`MCP/index.js:320-365`). Update,
  toggle, toggle-tool, delete and reload mirror the UI.
- **State changes:** MCP config file rewritten; process spawned.
- **Side effects:** SE-AGENT-31, SE-AGENT-30 (PROC).
- **Notes:** this lets an API key holder run an arbitrary host command with the server's full
  environment (secrets included). API keys are not role-scoped in this code path
  (`api/mcpServers/index.js:48` uses only `validApiKey`).

### P-AGENT-25 — Agent flows (CRUD and execution)

- **Actor:** admin for CRUD; any session for execution.
- **Steps:** save writes `storage/plugins/agent-flows/<uuid>.json` with path checks
  (`agentFlows/index.js:18-31,101-130`); list/load/delete/toggle (`agentFlows.js:14-190`,
  `agentFlows/index.js:69-99,135-170`). Active flows load as `@@flow_<uuid>`
  (`agentFlows/index.js:185-200`, `agents/index.js:654-674`). Execution substitutes `${var}`
  values (LLM-provided) into step configs (`agentFlows/executor.js:154-200`) and runs steps:
  `apiCall` → `fetch(url, …)` (`executors/api-call.js:50`), `llmInstruction`, `webScraping`.
- **State changes:** flow JSON files; none at run time.
- **Side effects:** SE-AGENT-32 (FS), SE-AGENT-33 (NET).
- **Notes:** flows are ungated. If a flow URL contains a variable, the model controls the request
  target.

### P-AGENT-26 — Imported agent skills (Community Hub)

- **Actor and preconditions:** admin; `COMMUNITY_HUB_BUNDLE_DOWNLOADS_ENABLED` set; item verified
  or private unless `allow_all` (`communityHubDownloadsEnabled.js:23-40`).
- **Steps:** `POST /community-hub/item` / `import` → `CommunityHub.getBundleItem` pulls
  `{url,item}` from `https://hub.external.anythingllm.com/v1/<type>/<id>/pull` with the hub
  connection key (`models/communityHub.js:8-12,72-100`) → `importBundleItem` →
  `ImportedPlugin.importCommunityItemFromUrl` downloads the zip over http/https, rejects Zip Slip
  entries, extracts to `storage/plugins/agent-skills/<hubId>/`, forces `active:false`
  (`agents/imported.js:254-363`). Admin toggles/configures/deletes
  (`imported-agent-plugins.js:13-60`, `imported.js:112-142`). Active skills load as `@@<hubId>`;
  the loader `require()`s `handler.js` in the server process (`imported.js:13-24,215-247`).
- **State changes:** plugin folder written/deleted; `plugin.json` rewritten.
- **Side effects:** SE-AGENT-34 (NET:community-hub, FS), SE-AGENT-35 (code execution).
- **Notes:** imported code runs with full server privileges; it may call its own
  `requestToolApproval` but nothing forces it to (`imported.js:178-195,240-245`).

### P-AGENT-27 — Community Hub settings, apply, create

- **Steps:** settings read/write `hub` connection key via `SystemSettings.updateSettings`
  (`communityHub.js:20-46`); explore and user items fetch from the hub
  (`models/communityHub.js:38-60,169-190`); apply `system-prompt` overwrites
  `workspaces.openAiPrompt` for the given slug, `slash-command` creates a preset
  (`models/communityHub.js:109-154`); create publishes a local item to the hub
  (`models/communityHub.js:193-210`).
- **State changes:** `workspaces.openAiPrompt: old → hub prompt`; `slash_command_presets` row
  created; `system_settings` hub key.
- **Side effects:** SE-AGENT-34, SE-AGENT-36.
- **Notes:** `apply` looks up the workspace by slug without a membership check (admin-only route).

### P-AGENT-28 — Scheduled job CRUD (UI)

- **Actor and preconditions:** single-user instance.
- **Steps:** create validates name/prompt/cron and that `tools` is an array (not that each id is in
  the catalog) (`scheduledJobs.js:142-190`) → `ScheduledJob.create` (`scheduledJob.js:89-107`) →
  `addScheduledJob` timer. Update/toggle → `syncScheduledJob` bumps a version, kills workers,
  cancels queued runs, re-adds the timer if enabled (`BackgroundWorkers/index.js:341-356`).
  Delete removes timer + workers then deletes the row (cascade deletes runs,
  `schema.prisma:426`). `available-tools` returns the full catalog
  (`scheduledJob.js:284+`).
- **State changes:** `scheduled_jobs` row created/updated/deleted; queued runs → `failed`.
- **Side effects:** SE-AGENT-37 (TIME, DB).

### P-AGENT-29 — Scheduled job execution (no person present)

- **Actor:** the scheduler, or the manual trigger endpoint.
- **Steps:**
  1. Timer fires → `enqueueScheduledJob`: stop if multi-user (also removes the timer) or stale;
     `ScheduledJobRun.start` creates a `queued` row unless one is in flight; add to `p-queue`
     (concurrency `SCHEDULED_JOB_MAX_CONCURRENT`, default 1) (`BackgroundWorkers/index.js:20-22,394-428`).
  2. Worker: Bree spawns `run-scheduled-job.js` as a child **process** and sends `{jobId,runId}`
     (`BackgroundWorkers/index.js:131,219-236,439-449`).
  3. Child: load job (missing → `not_found`), `markRunning` (`queued → running`, else bail),
     update `lastRunAt/nextRunAt` (`run-scheduled-job.js:37-58`).
  4. Build `EphemeralAgentHandler({prompt})` with **no workspace and no user**
     (`run-scheduled-job.js:62-65`) → provider falls back to `LLM_PROVIDER`
     (`ephemeral.js:157-213`); `toolOverrides = job.tools` parsed, `null → []` (no tools)
     (`run-scheduled-job.js:70-74`, `ephemeral.js:600-604`).
  5. **Every approval is auto-approved** (`run-scheduled-job.js:77-83`); tool results are
     captured in a trace (`:86-95`).
  6. Race the cluster against `SCHEDULED_JOB_TIMEOUT_MS` (default 5 min)
     (`run-scheduled-job.js:98-110`, `scheduled-job-helper.js:8-9`).
  7. Success → `complete` with `{text, thoughts, toolCalls, outputs, metrics, duration}`
     (`run-scheduled-job.js:117-127`) → web push to `primary` with the first 100 chars of the
     answer (thinking stripped) (`scheduled-job-helper.js:68-106`).
  8. Errors → `timed_out` / `failed`; SIGTERM → `kill` (`run-scheduled-job.js:16-21,130-152`).
- **Reads:** `scheduled_jobs`, provider env, tool settings for loaded tools.
- **State changes:** see §5 (run state machine); `scheduled_jobs.lastRunAt/nextRunAt`.
- **Side effects:** SE-AGENT-38 (PROC), SE-AGENT-39 (DB), SE-AGENT-40 (PUSH), plus whatever the
  selected tools do — now without approval.
- **Failure and edge paths:** worker exit non-zero → parent `failIfNotTerminal`
  (`BackgroundWorkers/index.js:422-425,451-463`); server restart → all non-terminal runs failed
  at boot (`scheduledJobRun.js:306-321`).
- **Notes:**
  - Prompt injection risk: a job that has, say, `web-browsing` + `gmail-send-email` will send
    mail on content fetched from the web with no human gate.
  - Workspace-bound tools (`rag-memory`, `document-summarizer`) have no workspace here
    (`invocation.workspace` is null) and fail **(document-summarizer behavior with
    `workspaceId: null` unverified)**.
  - The schema comment says `tools = null` means "use all enabled agent skills"
    (`schema.prisma:407`) but the runner treats null as no tools — the code and comment disagree.
  - `run-scheduled-job.js` keeps `status`/`runId` as module globals; a child handles one run.

### P-AGENT-30 — Scheduled run actions (read, continue, kill)

- **Steps:** `GET /scheduled-jobs/runs/:runId` returns run + job (`scheduledJobs.js:34-61`);
  `POST …/read` sets `readAt`; `continue` → `continueInThread` upserts a workspace slug
  `scheduled-jobs` (`chatMode: automatic`), creates a thread and a chat row with the run's text
  and outputs (`scheduledJobRun.js:329-385`); `kill` (only queued/running) → `killRun` sends
  SIGTERM to the job's workers, then `ScheduledJobRun.kill` (`scheduledJobs.js:91-108`,
  `BackgroundWorkers/index.js:368-382`).
- **State changes:** `scheduled_job_runs.readAt: null → now`; `workspaces` row maybe created;
  `workspace_threads` row created; `workspace_chats` row created; run → `failed` ("Job killed by
  user").
- **Side effects:** SE-AGENT-41.
- **Notes:** `kill` kills **all** workers of that job, not only the run id given
  (`BackgroundWorkers/index.js:368-382`).

### P-AGENT-31 — Memory extraction (background)

- **Actor and preconditions:** `memory_enabled` and `memory_auto_extraction` true; the Bree job is
  added/removed live when either setting changes (`systemSettings.js:200-230`,
  `BackgroundWorkers/index.js:178-197`).
- **Steps:** load all `workspace_chats` with `memoryProcessed: null, include: true`
  (`extract-memories.js:34-38`) → group by `user_id:workspaceId`
  (`memory-extraction-utils.js:68-76`) → per group: skip if < 5 chats or last chat younger than
  `MEMORY_IDLE_THRESHOLD_MS` (20 min) (`extract-memories.js:17-23,69-79,189-192`) → reload latest
  20 chats with text (`memory-extraction-utils.js:8,83-95`) → resolve LLM (workspace chat →
  workspace agent → system) (`:101-111`) → skip if at capacity (global 5, workspace 20,
  `models/memory.js:23-25`, `extract-memories.js:107-114`) → Observer aibitat run proposes
  candidates (`memory-extraction-utils.js:135`) → Reflector run decides add/update per scope
  (`:263`) → `Memory.applyExtractedMemories` (`models/memory.js:345`) → finally
  `markMemoryProcessed(ids)` (`extract-memories.js:180-182`).
- **Reads:** `workspace_chats`, `workspaces`, `memories`.
- **State changes:** `memories` rows created/updated; `workspace_chats.memoryProcessed: null → set`
  for the group (`models/workspaceChats.js:306`).
- **Side effects:** SE-AGENT-42 (NET:llm-provider with chat transcripts), SE-AGENT-43 (DB),
  SE-AGENT-44 (LOG: candidate and final memory text written to the worker log,
  `extract-memories.js:135-137,163-167`).
- **Failure and edge paths:** any error inside a group still marks those chats processed
  (`extract-memories.js:178-182`), so a provider outage permanently skips them; groups skipped
  for "too few" or "active" are not marked and retry next run.
- **Notes:** grouping ignores thread and API session, so API/embed chats with the same
  `user_id` (often `null`) are pooled **(whether embed chats carry `include: true` here is
  unverified)**. In single-user mode all chats have `user_id = null` and form one user per
  workspace.

### P-AGENT-32 — Memory CRUD and injection

- **Actor and preconditions:** any role; `memory_enabled` true (`memory.js:11-16`).
- **Steps:** list/create are scoped to the requester and a workspace they can access
  (`validWorkspaceSlug`, `middleware/validWorkspace.js:6-20`); edit/delete/promote/demote first
  load the memory with `userId = requester` in multi-user (`memory.js:22-39`). Creation enforces
  the 5/20 limits (`models/memory.js:98-130`). Injection: every chat and agent system prompt
  appends "## Things I Remember About You" with all global + up to 5 workspace memories,
  reranked by the native embedding reranker when more exist
  (`server/utils/memories/index.js:26-137`, `ai-provider.js:627-644`,
  `server/utils/chats/index.js:124-137`).
- **State changes:** `memories` rows created/updated/deleted; `scope` and `workspaceId` changed on
  promote/demote; `lastUsedAt` on injection.
- **Side effects:** SE-AGENT-43.
- **Notes:** in single-user mode `validateMemoryOwner` does not scope by user, which is fine since
  there is one user.

### P-AGENT-33 — Web push subscription

- **Steps:** boot generates VAPID keys into `storage/push-notifications/vapid-keys.json` if missing
  and loads subscriptions (`PushNotifications/index.js:201-222`); `POST /web-push/subscribe`
  stores the browser subscription on `users.web_push_subscription_config` (multi-user) or in
  `primary-subscription.json` (`PushNotifications/index.js:146-166`, `webPush.js:9-19`);
  `GET /web-push/pubkey` returns the public key (`webPush.js:21-24`).
- **State changes:** `users.web_push_subscription_config` or file written.
- **Side effects:** SE-AGENT-45.
- **Notes:** the subscription body is stored unvalidated; its `endpoint` is where the server will
  later POST. Only scheduled jobs send pushes (to `primary`), so multi-user subscriptions are
  stored but never used by this domain.

### P-AGENT-34 — Generated file and image cleanup

- **Steps:** every 8 h, list `storage/generated-files`; for entries older than 1 h, delete any
  whose name does not match the pattern or is not referenced by an `include: true` chat's or a
  run's `outputs[].payload.storageFilename` (`cleanup-generated-files.js:7-62,65-165`). Images: the
  9 h job deletes files in `storage/generated-images` older than 1 h that are unreferenced
  (`cleanup-generated-images.js:14-45`).
- **State changes:** files deleted.
- **Side effects:** SE-AGENT-46.
- **Failure and edge paths:** if the chat scan throws mid-way, the helper returns the filenames
  collected so far (`cleanup-generated-files.js:109-113`) and the job proceeds, so files from
  unscanned chats are treated as orphans and deleted.
- **Notes:** chats hidden by `/reset` (`include: false`) lose their files after the next sweep.

### P-AGENT-35 — Model-router LLM classification (agent used internally)

- **Actor:** the model router (CHAT/ADMIN domain) when rules use LLM classification.
- **Steps:** `classifyWithLLM` builds a one-round aibitat with the router's fallback provider and a
  single `select_category` tool that sets `classifiedCategory` and returns `TERMINATE`
  (`router-classifier.js:13-50,52-120`; caller `server/utils/router/index.js:490`).
  `model-router-cooldown` restarts the sticky-route cooldown on every interrupt/terminate in agent
  sessions (`model-router-cooldown.js:13-27`, `agents/index.js:993-997`).
- **Side effects:** SE-AGENT-03 (NET:llm-provider).
- **Notes:** `router-classifier` and `file-history` are not in the plugin registry
  (`aibitat/plugins/index.js:1-56`); `file-history` (writes `history/chat-history-*.json`) and
  `cli.js` are only used by `aibitat/example/*`.

### P-AGENT-36 — Agent websocket identity check
- **Actor and preconditions:** the browser opening `/agent-invocation/:uuid`.
- **Steps:** the client sends its session token as the second websocket subprotocol (`["anythingllm.auth", token]`, `frontend/src/components/WorkspaceChat/ChatContainer/index.jsx`). `authenticateSessionToken` checks it (`server/endpoints/agentWebsocket.js:38`); on failure the socket gets `wssFailure` and closes (LOG `agent_ws_rejected` `no_valid_session`). `AgentHandler` then checks, before claiming the invocation, that in multi-user mode the caller is the invocation's user (`server/utils/agents/index.js:610`, LOG `agent_ws_rejected` `other_user`) and that the invocation is under 10 minutes old (`INVOCATION_TTL_MS`, `:38,633`, decision 25).
- **State changes:** none on refusal.
- **Side effects:** WS (`wssFailure`), LOG.
- **Notes:** fixes F-04. Works with or without the single-use claim from `claude/state-machine-audit-23070d` (SMF-06).

### P-AGENT-37 — Access policy on agent sessions (web, API, Telegram)
- **Actor and preconditions:** a user with an access policy. Telegram runs only in single-user mode, so it never has a policy.
- **Steps:** `#providerSetupAndCheck` (`server/utils/agents/index.js:512`, `server/utils/agents/ephemeral.js:227`) refuses when the policy has `allow_agents=false` (LOG `tool_refused_by_policy` `allow_agents`), routes through the policy's router when `router_id` is set, and otherwise applies `enforceAllowedSelection` to the agent provider and model; per-turn router re-resolution keeps the same guard. An explicit `@agent` in chat with agents off returns an abort message (`server/utils/chats/agents.js:109`); automatic mode falls through to normal chat.
- **Side effects:** LOG (`tool_refused_by_policy`, `model_refused_by_policy`).

### P-AGENT-38 — Agent tool and MCP filtering
- **Actor and preconditions:** a user with a tool rule from (in order) their policy's `agent_tools`, their team policy's, or the role default in `system_settings.agent_tool_role_policy`. No rule, no user (single-user, legacy keys) or an admin without a policy: every tool.
- **Steps:** `agentToolAccessForUser` (`server/utils/accessPolicy/agentTools.js:248`) returns `isAllowed`, `filterFunctions` and an MCP tool filter that also applies the server's `anythingllm.allowedRoles`. `WORKSPACE_AGENT.getDefinition` filters the function list; `#attachPluginByName` (`server/utils/agents/index.js:686`) and the ephemeral `#attachPlugins` (`server/utils/agents/ephemeral.js:308`) re-check each entry (LOG `tool_refused_by_policy` `agent_tools`) and pass the MCP filter to `convertServerToolsToPlugins`; dead MCP servers (closed transport) are skipped.
- **Notes:** the chat UI's tool listing uses admin-only endpoints, so admin listings stay unfiltered.

### P-AGENT-39 — Role defaults and sharing a tool with teams
- **Actor and preconditions:** admin, multi-user mode.
- **Steps:** GET/POST `/admin/agent-tool-role-policy` (`server/endpoints/accessPolicies.js:172,187`) reads and writes `system_settings.agent_tool_role_policy` (`{manager, default}` rules). GET/POST `/admin/agent-tool-sharing` (`:222,236`) reports and sets which teams are offered a tool: `setToolTeams` (`server/utils/accessPolicy/toolSharing.js:108`) edits each team policy's rule, starting from the `default` role rule for a team with none, and creates a policy (no model restriction) for a team without one.
- **State changes:** `system_settings.agent_tool_role_policy`; `access_policies.agent_tools`; `access_policies` row created; `teams.policy_id` set.
- **Side effects:** DB, LOG (`role_default_updated`, `policy_updated`).
- **Notes:** a policy shared by other teams or users changes for them too; the response lists those as `sharedPolicies`.

## 5. State machines

### Scheduled job run (`scheduled_job_runs.status`)

| From | To | Trigger | Code |
|---|---|---|---|
| (none) | `queued` | timer or manual trigger, no in-flight run | `scheduledJobRun.js:32-60`, `BackgroundWorkers/index.js:408` |
| (none) | — (skipped) | in-flight run exists, multi-user, or stale version | `BackgroundWorkers/index.js:402-410` |
| `queued` | `failed` ("Job killed by user") | version went stale before/after enqueue; job edited/toggled | `BackgroundWorkers/index.js:412-420`; `scheduledJobRun.js:200-240` |
| `queued` | `running` | worker starts | `run-scheduled-job.js:47-53`, `scheduledJobRun.js:67-92` |
| `queued`/`running` | `failed` ("Job no longer exists") | job deleted before worker start | `run-scheduled-job.js:39-42,141-142` |
| `running` | `completed` | agent finished in time | `run-scheduled-job.js:117-127`, `scheduledJobRun.js:118-138` |
| `running` | `timed_out` | `SCHEDULED_JOB_TIMEOUT_MS` elapsed | `run-scheduled-job.js:131-145`, `scheduledJobRun.js:166-195` |
| `running` | `failed` (error text) | exception in worker | `run-scheduled-job.js:134-148` |
| `queued`/`running` | `failed` ("Job killed by user", `readAt` set) | kill endpoint, SIGTERM, job delete/update | `scheduledJobRun.js:200-221`, `BackgroundWorkers/index.js:318-334,455-458` |
| `queued`/`running` | `failed` (worker exit code) | worker crashed | `BackgroundWorkers/index.js:422-425,459-463` |
| `queued`/`running` | `failed` ("Server restarted during execution") | boot | `scheduledJobRun.js:306-321`, `BackgroundWorkers/index.js:115` |
| terminal | `readAt` set | user opens / reads run | `scheduledJobs.js:73-75` |

Terminal states: `completed`, `failed`, `timed_out`. All terminal writes are guarded by
`status IN (queued, running)`.

### Scheduled job (`scheduled_jobs.enabled`) and its timer

| State | Timer registered | Transitions |
|---|---|---|
| enabled | yes (`later.setInterval`, UTC) | toggle/update → `syncScheduledJob` re-registers; delete → timer cleared + row deleted; switch to multi-user → timer removed at next fire (`BackgroundWorkers/index.js:402-405`) |
| disabled | no | toggle → enabled (`scheduledJobs.js:294-330`) |

Timers live only in memory; at boot every enabled job gets `nextRunAt` recomputed and a timer
(`BackgroundWorkers/index.js:274-294`). Missed runs while the server was down are not replayed.

### Memory extraction per chat (`workspace_chats.memoryProcessed`)

| From | To | Trigger | Code |
|---|---|---|---|
| `null` | `null` (retry later) | group < 5 chats, or last chat < 20 min old | `extract-memories.js:69-79` |
| `null` | set | group processed: success, no candidates, workspace missing, no LLM, at capacity, or error | `extract-memories.js:82-182` |

Memory row (`memories`): created (`workspace` or `global` scope) → updated by Reflector/UI →
promoted (`workspace → global`, `workspaceId → null`) / demoted (`global → workspace`) → deleted by
UI or cascade on user/workspace delete (`schema.prisma:441-442`).

### Agent invocation (`workspace_agent_invocations.closed`)

`false` (created by `grepAgents`) → `true` on websocket close (`agentWebsocket.js:41-47`).
Reconnecting with a closed UUID throws (`agents/index.js:568-569`). No other transition found.

### Tool approval request (in memory)

`pending` → `approved` (env list, whitelist, user approve, scheduled-job override) /
`rejected` (user reject, timeout, session abort, no Telegram context on http-socket).
Code: `websocket.js:254-364`, `http-socket.js:118-230`, `run-scheduled-job.js:77-83`.

### Imported skill / flow / MCP server

- Imported skill: downloaded (`active:false`) → toggled active → loaded in new sessions → deleted
  (`imported.js:254-363,112-142`).
- Flow: saved (`active` default true) → toggled → deleted (`agentFlows/index.js:101-170`).
- MCP server: in config → booted (unless `autoStart:false`) → running / failed → stopped via toggle
  (`manuallyStopped` keeps it off at re-boot, `hypervisor/index.js:586-589`) → deleted.

## 6. Side-effect ledger

| ID | Trigger | Class | Target | Where (path:line) | Reversible? | Notes |
|---|---|---|---|---|---|---|
| SE-AGENT-01 | P-AGENT-01 | DB | `workspace_agent_invocations` create / `closed=true` | `models/workspaceAgentInvocation.js:12-39` | no (rows never deleted here) | |
| SE-AGENT-02 | P-AGENT-01/02/05/14/15/16/21 | WS | agent socket messages (`statusResponse`, `toolApprovalRequest`, `clarificationRequest`, `fileDownloadCard`, `imageGenerationCard`, `rechartVisualize`, `scheduledJobCreated`, `rename_thread`, `wssFailure`) | `aibitat/plugins/websocket.js:188-598`; plugin `socket.send` calls | n/a | |
| SE-AGENT-03 | P-AGENT-02/06/07/09/11/29/31/35 | NET:llm-provider | agent provider completions (system prompt incl. memories, history, attached docs, tool results) | `aibitat/index.js:1049,1216` | no | content leaves the instance for cloud providers |
| SE-AGENT-04 | P-AGENT-01 | TEL | `agent_chat_started` | `endpoints/agentWebsocket.js:65`; `apiChatHandler.js:197` | no | |
| SE-AGENT-05 | P-AGENT-02 | TEL | `agent_chat_sent`, `agent_tool_call {tool}` | `websocket.js:486-487`; `aibitat/index.js:1100` | no | tool names only |
| SE-AGENT-06 | P-AGENT-02 | DB | `workspace_chats` pre-create + upsert; `workspace_threads` rename | `plugins/chat-history.js:50-57,113-128,149-168,191-202` | yes (delete chat) | empty row left if turn dies |
| SE-AGENT-07 | P-AGENT-02/32 | DB | `memories.lastUsedAt` | `utils/memories/index.js:51` | n/a | fire-and-forget |
| SE-AGENT-08 | P-AGENT-03 | DB | `system_settings` whitelist label upsert | `models/agentSkillWhitelist.js:41-67` | only bulk clear (`endpoints/system.js:703`) | per skill name, not per args |
| SE-AGENT-09 | P-AGENT-03 | TIME | approval timeout timer (120 s default) | `websocket.js:351-362`; `http-socket.js:216-228` | n/a | |
| SE-AGENT-10 | P-AGENT-04 | CACHE | live `aibitat.functions` / `@agent.functions` | `agents/index.js:760-779` | yes (toggle back) | session only |
| SE-AGENT-11 | P-AGENT-06 | DB | `workspace_chats` row with `apiSessionId` | `utils/chats/apiChatHandler.js:229-245` | yes | written by caller |
| SE-AGENT-12 | P-AGENT-07 | PUSH | Telegram approval prompt via worker IPC | `http-socket.js:206-214`; `telegramBot/index.js:524` | n/a | |
| SE-AGENT-13 | P-AGENT-08 | NET:search-provider | one of SerpApi, SearchApi, Serper, Bing, Baidu, Serply, SearXNG, Tavily, DuckDuckGo, Exa, Perplexity, Brave, fastCRW, You.com, Keenable, AnySearch, Firecrawl, DeepSeek | `plugins/web-browsing.js:66-131` and provider methods 169-1990 | no | default You.com keyless → DuckDuckGo (`:126-130,1614-1711`) |
| SE-AGENT-14 | P-AGENT-09, Gmail/Outlook attachments, imported skills | NET:collector | `CollectorApi.getLinkContent` / `parseDocument` | `web-scraping.js:101-102`; `gmail/lib.js:87-90`; `outlook/lib.js:278-300` | no | collector then fetches the URL |
| SE-AGENT-15 | P-AGENT-10 | VEC | `addDocumentToNamespace(workspace.slug)` | `plugins/memory.js:130-147` | no UI path found | ungated |
| SE-AGENT-16 | P-AGENT-12 | NET:sql-db | arbitrary SQL on configured MySQL/Postgres/MSSQL | `sql-agent/query.js:81`; `SQLConnectors/Postgresql.js:31-49` | depends on DB | no read-only enforcement, ungated |
| SE-AGENT-17 | P-AGENT-13 | FS | `storage/anythingllm-fs/**` write/edit/mkdir/move/copy | `filesystem/write-text-file.js:61`, `edit-file.js:95`, `create-directory.js:52`, `move-file.js:64`, `copy-file.js:93`; root `filesystem/lib.js:53-87` | no (overwrite) | gated |
| SE-AGENT-18 | P-AGENT-14 | FS | `storage/generated-files/<type>-<uuid>.<ext>` | `create-files/lib.js:213-231` | swept by SE-AGENT-46 | gated per file |
| SE-AGENT-19 | P-AGENT-14/15 | DB | chat `response.outputs` reference (authorizes download) | `create-files/lib.js:151-166`; `generate-image.js:47-54` | yes | |
| SE-AGENT-20 | P-AGENT-14 | NET:arbitrary-host | docx embedded image fetch | `create-files/docx/utils.js:188-201` | no | model-chosen URL from the server |
| SE-AGENT-21 | P-AGENT-14 | TEL | `agent_generated_file_downloaded {type}` | `endpoints/agentFileServer.js:79-81` | no | |
| SE-AGENT-22 | P-AGENT-15 | NET:image-provider, FS | image generation/edit; `storage/generated-images` | `generate-image.js:135-155`; `ImageGenerators/index.js:3-41` | swept by SE-AGENT-46 | ungated |
| SE-AGENT-23 | P-AGENT-17 | NET:google-apps-script | Gmail actions; gated writes at `gmail-create-draft.js:141`, `gmail-create-draft-reply.js:143`, `gmail-update-draft.js:139`, `gmail-delete-draft.js:43`, `gmail-send-draft.js:44`, `gmail-send-email.js:136,167`, `gmail-reply-to-thread.js:134,165`, `gmail-mark-read.js:43`, `gmail-mark-unread.js:43`, `gmail-move-to-trash.js:45`, `gmail-move-to-archive.js:45`, `gmail-move-to-inbox.js:45` | `gmail/lib.js:330-386` | send: no | reads ungated |
| SE-AGENT-24 | P-AGENT-17/19 | FS | attachment temp file in `os.tmpdir()`, deleted after parse | `gmail/lib.js:75-95`; `outlook/lib.js:278-295` | yes (auto) | left behind if collector call throws before unlink **(unverified)** |
| SE-AGENT-25 | P-AGENT-18 | NET:google-apps-script | Calendar actions; gated writes `gcal-quick-add.js:52`, `gcal-create-event.js:138`, `gcal-update-event.js:104`, `gcal-set-my-status.js:63` | `google-calendar/lib.js:126` | partly | |
| SE-AGENT-26 | P-AGENT-19 | NET:microsoft-graph, DB | Graph calls; token refresh writes `system_settings.outlook_agent_config` | `outlook/lib.js:466-467,691-757`; gated writes `outlook-create-draft.js:135`, `outlook-update-draft.js:81`, `outlook-delete-draft.js:46`, `outlook-send-draft.js:44`, `outlook-send-email.js:134` | send: no | |
| SE-AGENT-27 | P-AGENT-20 | DB, NET:microsoft-identity | `outlook_agent_config` save/delete; code→token exchange | `outlookAgentUtils.js:70,111,179`; `outlook/lib.js:611-680` | yes (revoke) | no OAuth `state` |
| SE-AGENT-28 | P-AGENT-21 | DB, TIME, WS | `scheduled_jobs` create; `later` timer; `scheduledJobCreated` | `create-scheduled-job/index.js:172-206` | yes (delete job) | gated |
| SE-AGENT-29 | P-AGENT-22 | NET:mcp-server | `callTool` with optional identity headers/_meta | `MCP/index.js:148-156`; `MCP/identity.js:122-150` | depends on tool | ungated |
| SE-AGENT-30 | P-AGENT-01/22/23/24 | PROC | stdio MCP server spawned with full `process.env` + config env | `MCP/hypervisor/index.js:376-413,481-490` | yes (toggle/delete) | secrets exposed to child |
| SE-AGENT-31 | P-AGENT-23/24 | FS | `storage/plugins/anythingllm_mcp_servers.json` rewrite | `MCP/hypervisor/index.js:123-230` | yes | |
| SE-AGENT-32 | P-AGENT-25 | FS | `storage/plugins/agent-flows/<uuid>.json` write/delete | `agentFlows/index.js:101-170` | delete: no | |
| SE-AGENT-33 | P-AGENT-25 | NET:arbitrary-host | flow `apiCall` fetch | `agentFlows/executors/api-call.js:50` | no | ungated |
| SE-AGENT-34 | P-AGENT-26/27 | NET:community-hub, FS | hub API (`hub.external.anythingllm.com`), zip download, extract to `storage/plugins/agent-skills/<hubId>` | `models/communityHub.js:8-12,38-210`; `agents/imported.js:254-363` | delete endpoint | |
| SE-AGENT-35 | P-AGENT-26 | PROC (in-process code) | `require(handler.js)` of imported skill | `agents/imported.js:13-24` | delete plugin | full server privileges |
| SE-AGENT-36 | P-AGENT-27 | DB | `workspaces.openAiPrompt` overwrite; `slash_command_presets` create; hub key | `models/communityHub.js:109-154`; `endpoints/communityHub.js:34-46` | prompt: no history | |
| SE-AGENT-37 | P-AGENT-28 | DB, TIME | `scheduled_jobs` CRUD; timer add/remove; queued runs failed | `endpoints/scheduledJobs.js:142-331`; `BackgroundWorkers/index.js:301-356` | delete: no | |
| SE-AGENT-38 | P-AGENT-29 | PROC | Bree child process per run | `BackgroundWorkers/index.js:219-236,439-475` | killable | |
| SE-AGENT-39 | P-AGENT-29 | DB | `scheduled_job_runs` transitions; `scheduled_jobs.lastRunAt/nextRunAt` | `scheduledJobRun.js:32-240`; `scheduledJob.js:254-275` | no | result holds full trace incl. tool args/results |
| SE-AGENT-40 | P-AGENT-29 | PUSH, NET:web-push-service | push "<job> completed" + first 100 chars | `jobs/helpers/scheduled-job-helper.js:82-106`; `PushNotifications/index.js:175-194` | no | output text sent through the browser vendor's push service |
| SE-AGENT-41 | P-AGENT-30 | DB, PROC | `readAt`; `scheduled-jobs` workspace/thread/chat created; SIGTERM workers | `scheduledJobRun.js:329-385`; `BackgroundWorkers/index.js:368-382` | yes (delete) | |
| SE-AGENT-42 | P-AGENT-31 | NET:llm-provider | Observer + Reflector runs over the last 20 chats | `jobs/helpers/memory-extraction-utils.js:135,263` | no | |
| SE-AGENT-43 | P-AGENT-31/32 | DB | `memories` create/update/delete/promote/demote; `workspace_chats.memoryProcessed` | `models/memory.js:98-260,345`; `models/workspaceChats.js:306` | yes (UI delete) | |
| SE-AGENT-44 | P-AGENT-31 | LOG | worker log now holds counts and ids only (F-41 fixed in 912a0c28); `audit_events: memory.extracted` (created, updated, candidates counts) with a job actor acting on behalf of the user | `server/jobs/extract-memories.js:135,137,185` | no | no memory text in logs or audit rows |
| SE-AGENT-45 | P-AGENT-33 | DB / FS | `users.web_push_subscription_config` or `storage/push-notifications/primary-subscription.json`; `vapid-keys.json` at boot | `PushNotifications/index.js:146-166,201-222` | overwrite | |
| SE-AGENT-46 | P-AGENT-34 | FS | delete unreferenced files > 1 h in `storage/generated-files`, `storage/generated-images` | `jobs/cleanup-generated-files.js:22-51`; `jobs/cleanup-generated-images.js:18-45` | no | partial scan error → over-deletion |
| SE-AGENT-47 | E-AGENT-22/23/24 | TIME | Bree jobs (cleanup 8/9/12 hr, memory extraction 3 hr), scheduled-job timers | `BackgroundWorkers/index.js:29-61,106-143,178-197,274-309` | yes (setting toggle) | |
| SE-AGENT-48 | P-AGENT-36 | WS/LOG | `wssFailure` + close; `agent_ws_rejected` | `server/endpoints/agentWebsocket.js:38`, `server/utils/agents/index.js:610` | no | |
| SE-AGENT-49 | P-AGENT-37/38 | LOG | `tool_refused_by_policy`, `model_refused_by_policy` | `server/utils/accessPolicy/index.js:110,133`, `server/utils/agents/index.js:686` | no | fire-and-forget |
| SE-AGENT-50 | P-AGENT-39 | DB | `system_settings.agent_tool_role_policy` upsert | `server/endpoints/accessPolicies.js:187` | yes | LOG `role_default_updated` |
| SE-AGENT-51 | P-AGENT-39 | DB | `access_policies.agent_tools` update / policy create, `teams.policy_id` set | `server/utils/accessPolicy/toolSharing.js:108` | yes | LOG `policy_updated` |
| SE-AGENT-52 | P-AGENT-28 | LOG | `audit_events: scheduled_job.created` / `updated` / `deleted` / `run` (trigger, approve and reject runs) | `server/endpoints/scheduledJobs.js:109,201,287,315,364,396` | no | no row before |
| SE-AGENT-53 | P-AGENT-31/32 | LOG | `audit_events: memory.created` / `updated` (also promote and demote) / `deleted` | `server/endpoints/memory.js:95,134,164,195,232` | no | no row before |
| SE-AGENT-54 | MCP server toggle, delete, tool toggle (UI) | LOG | `audit_events: mcp.server_started` / `mcp.server_stopped` / `mcp.server_removed` / `mcp.tool_toggled` | `server/endpoints/mcpServers.js:71,106,145` | no | the `/v1/mcp-servers` equivalents are in SE-EXT-58 |
| SE-AGENT-55 | agent flows | LOG | `audit_events: flow.created` / `flow.updated` / `flow.deleted` | `server/endpoints/agentFlows.js:43,174,225` | no | no row before |
| SE-AGENT-56 | imported agent plugins, skill whitelist | LOG | `audit_events: skill.enabled` / `skill.disabled` / `skill.configured` / `skill.removed`; `agent.whitelist_added` | `server/endpoints/experimental/imported-agent-plugins.js:27,59,92`; `server/endpoints/agentSkillWhitelist.js:95` | no | no row before |
| SE-AGENT-57 | agent websocket session (P-AGENT-14 area) | LOG | not recorded: `agent.session_started` / `agent.session_ended` are declared pending for the access-policy branch (`server/utils/audit/routes/held.js`) | `server/endpoints/agentWebsocket.js` | n/a | |

## 7. Cross-domain links

| To | Where it hands off |
|---|---|
| CHAT | `streamChatWithWorkspace` → `grepAgents` (`utils/chats/stream.js:55`); normal-chat fallback when invocation create fails; system prompt + memories shared with normal chat (`utils/chats/index.js:124-137`); model router resolution (`utils/router`, `AiProviders/modelRouter`); `/img` command reuse (`websocket.js:114-160`) |
| AUTH | `validatedRequest`, `flexUserRoleValid`, `isSingleUserMode`, `validApiKey` semantics; the unauthenticated websocket route; suspended-user check in `#validInvocation`; daily chat quota re-check mid-session |
| DOC | collector link scraping and attachment parsing; `Document.where/content` for the summarizer; parsed files / pinned docs injected each turn; `cleanup-orphan-documents` Bree job shares the scheduler; vector DB writes from `rag-memory` |
| ADMIN | agent skill settings (`default_agent_skills`, `disabled_*`, search provider, SQL connections, Gmail/Calendar config validators in `models/systemSettings.js:50-312`), memory feature toggles, agent provider/model per workspace, `AGENT_*` env keys, multi-user switch clearing the single-user whitelist (`endpoints/system.js:703`) |
| EXT | developer API agent chat (`apiChatHandler.js`), `/v1/mcp-servers/*`, Telegram worker and its approval callbacks (`telegramBot/index.js:524,664`) |
| UI | agent chat socket client (`frontend/src/components/WorkspaceChat/ChatContainer/index.jsx:385`), web push hook (`frontend/src/hooks/useWebPushNotifications.js:6`), scheduled-job and MCP settings pages |
| STATE | tables `workspace_agent_invocations`, `scheduled_jobs`, `scheduled_job_runs`, `memories`, `system_settings` labels; files under `storage/plugins/`, `storage/generated-*`, `storage/anythingllm-fs`, `storage/push-notifications` |

Path IDs in the other files were not available when this file was written; links are by domain.

## 8. Open questions and unverified points

1. Whether any sweeper closes or deletes `workspace_agent_invocations` rows whose socket never
   connected (none found in the files read).
2. Whether the invocation attachment / reasoning caches (`utils/chats/agents.js:14,43`) break in a
   multi-process deployment.
3. Whether the collector blocks private/loopback addresses for `web-scraping`, flow
   `webScraping` and attachment parsing (collector code not read).
4. Whether `vectorDB.addDocumentToNamespace(..., null)` from `rag-memory.store` writes any DB row
   that document management could later find or delete.
5. How `document-summarizer` behaves with `workspaceId: null` inside a scheduled job.
6. Behavior of `create-scheduled-job` if an admin enables it mid-session in multi-user mode via
   P-AGENT-04 (the endpoints refuse multi-user, but the tool calls the model and
   `BackgroundService` directly; `enqueueScheduledJob` would then drop the timer).
7. Whether the Outlook OAuth callback passes `validatedRequest` as a top-level browser redirect
   when an instance password/JWT is required.
8. Whether `embed` chats are included in memory extraction groups (`include: true`, `user_id null`).
9. The exact filesystem image-attachment path to the model (inferred from `IMAGE_EXTENSIONS`
   constants in `filesystem/lib.js:16-33`).
10. Whether Gmail/Outlook temp attachment files are removed when the collector call throws before
    the `unlinkSync` (`gmail/lib.js:83-95`).
11. `server/endpoints/api/mcpServers/index.js` was read for routes and the create handler only;
    update/toggle/delete handlers were assumed to mirror `saveServer`/`toggleServerStatus`/
    `deleteServer` from their call sites (lines 195, 240, 308, 353).
12. Individual Gmail/Calendar/Outlook child handlers were read only at their approval call sites;
    exact request payloads per action were not traced.
13. Search-provider methods in `web-browsing.js` were read by host/env usage, not line-by-line.
