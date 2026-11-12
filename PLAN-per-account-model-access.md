# Plan: per-account access, Google sign-in, guardrails and HIPAA hardening for a centralized LLM

Status: draft, not started. Nothing in this plan has been built.

Revised 2026-11-10 against the repo map (`docs/repo-map/`) and the state-machine audit
(`docs/repo-map/12-state-machines.md` on branch `claude/state-machine-audit-23070d`). The
revision adds the identity bypasses, the account and settings races the new features build
on, and the prerequisites in "Delivery". A second pass added "Platform fixes from the repo
map" for the findings no other section covered. Findings are cited as `F-NN` (findings
register, file 09) and `SMF-NN` (state-machine register, file 12).

## Goal

When AnythingLLM is the single LLM gateway for an organization, an admin can decide for
each account:

1. which providers and models that account may use, and which model it gets by default;
2. whether its traffic goes through a specific model router;
3. which workspaces its API keys can reach;
4. which agent skills, agent flows, imported plugins and MCP servers or tools it may use,
   with a default for each role and an optional per-account override;
5. (phase 2) how many tokens, or how much spend, it may use;
6. which scheduled agent jobs it may run, in which workspace, and which of their tools
   may run unattended;
7. which team it belongs to. A team gives its members a shared access policy, shared
   workspaces, shared slash commands and prompt variables, and a set of skills and flows
   only that team is offered. A team lead manages the team's members and workspaces
   without being an instance-wide manager.

People sign in with their Google account, and Google is the identity provider for the
instance.

Guardrails check what people send and what comes back, keep agents from acting without
approval, and leave an audit trail an admin can review.

Compliance hardening closes the gaps found in `REVIEW-features-and-hipaa-risks.md` that
the work above doesn't cover: stored secrets, sessions, login abuse, CORS, access
logging, tamper-evident logs, complete deletion, settings change logging, and a single
HIPAA mode that locks down the high-risk features.

The same rules apply in the web UI, the developer API and the OpenAI-compatible
`/v1/openai/*` endpoints, so the API cannot be used to get around them.

## Why the current setup can't do this

- Roles are three fixed strings (`admin`, `manager`, `default`) checked by
  `strictMultiUserRoleValid` and `flexUserRoleValid` in
  `server/utils/middleware/multiUserProtected.js`. There is no concept of a permission.
- The model is chosen only by the workspace (`chatProvider/chatModel`,
  `agentProvider/agentModel`) or by `LLM_PROVIDER`. `resolveProviderConnector`
  (`server/utils/helpers/index.js:726`) accepts `user` but never uses it to decide.
- `api_keys` has no owner, scope or expiry, and `validApiKey` only checks that the key
  exists. Every key is effectively an admin key, and API chats are logged with `user: null`.
  Any API key can mint more keys through `/v1/admin`, and keys created in single-user
  mode keep that power after multi-user mode is turned on.
- Three routes into the model don't carry the signed-in user, so a per-user check placed
  only in `resolveProviderConnector` can be bypassed:
  - the developer API's thread chat uses whatever `userId` the caller puts in the body
    (`server/endpoints/api/workspaceThread/index.js:448`);
  - the agent websocket `/agent-invocation/:uuid` has no auth middleware
    (`server/endpoints/agentWebsocket.js:29-33`, F-04). The invocation UUID is the only
    credential, and whoever holds it drives the agent as the invoking user. The audit
    made each invocation single-use (`c49a3597`, SMF-06), but nothing checks who connects;
  - a paired mobile device acts as the admin who paired it (F-05), and an approved device
    with `userId = null` in multi-user mode sees every workspace (SMF-09, case M5).
- Model routers can be deleted while workspaces or `MODEL_ROUTER_ID` still point at them,
  which breaks those chats. Rule edits under `/model-routers/:id` aren't checked to
  belong to router `:id`, and the cache is cleared only for `:id` (SMF-12, F-23).
- The only quota is `users.dailyMessageLimit`, a message count from which admins are exempt.
- Agent skills (`disabled_agent_skills`, `default_agent_skills`) and MCP servers
  (`anythingllm.autoStart`, `anythingllm.suppressedTools`) are switched on or off for the
  whole instance. The only role check is that turning a tool on or off mid-chat is
  admin-only (`userCanToggleTools` in `utils/agents/aibitat/plugins/websocket.js:15`).
- Sign-in is a username and password (`POST /request-token` in
  `server/endpoints/system.js`), which returns a 30-day session JWT (`makeJWT` in
  `server/utils/http/index.js:25`). There is no OAuth or OIDC login. The closest thing is
  "Simple SSO": with `SIMPLE_SSO_ENABLED` set, an outside system holding an API key calls
  `POST /v1/users/:id/issue-auth-token` to get a single-use token valid for 10 minutes
  (`models/temporaryAuthToken.js`). The browser exchanges it for a session at
  `/sso/simple` (`GET /request-token/sso/simple`). `SIMPLE_SSO_NO_LOGIN` turns password
  login off.
- Nothing screens what users send to the model or what it returns: no PII or secret
  detection, no moderation, no prompt-injection checks. The content controls that exist
  are `query` mode with `queryRefusalResponse` (`utils/chats/stream.js:111` and `:244`)
  and workspace system prompts that only admins and managers can edit.
- Tools with side effects ask for approval (`requestToolApproval`), but any user can stop
  the prompt for themselves: `POST /agent-skills/whitelist/add` is open to every role
  (`endpoints/agentSkillWhitelist.js:67`). API agents check the whitelist with no user
  (`null`), so they use the system-wide list, and they refuse unlisted tools unless a
  Telegram approval is available (`utils/agents/aibitat/plugins/http-socket.js:147`).
- Chats are kept in `workspace_chats` with no retention limit. Blocked or flagged
  messages leave no record, because nothing blocks or flags them.
- See `REVIEW-features-and-hipaa-risks.md` for the platform-wide findings behind the
  compliance hardening section. Two found while writing it: admins can delete the whole
  event log (`DELETE /system/event-logs`, `endpoints/system.js:1171`), and
  `EncryptionManager` generates its key and salt and writes them into the same `.env` file
  as the secrets it protects (`utils/EncryptionManager/index.js:28`).
- The account and settings state machines that Google sign-in and policies build on have
  reachable bad states (file 12):
  - one invite can create two accounts, and a deactivated invite can still be claimed
    (SMF-14);
  - the last admin can be suspended or deleted, and two demotions at once can leave none
    (SMF-13);
  - `updateENV` applies a request key by key and stops at the first error, after earlier
    keys and their reset hooks have run (SMF-10). A crash while `.env` is rewritten can
    leave auth secrets missing (SMF-29);
  - turning on multi-user mode is a check-then-write that two submits can both pass, and
    its failure path deletes every user (SMF-09).
- What already works: role and suspension are read from the database on every request
  (`server/utils/middleware/validatedRequest.js:74-111`), so a role change or suspension
  takes effect at once. What's missing is revoking a session after a password change or
  on "sign out everywhere", and an idle timeout.

## Design

### Principle: no policy means today's behavior

A user with no policy assigned, and an API key with no owner, behave exactly as they do
now. That keeps the migration safe for existing installs and lets admins adopt policies
gradually. Admins are not exempt by design: a policy applies to whoever it is assigned to.

### Data model (one Prisma migration, all columns nullable, no new relations)

The schema avoids adding relations to existing tables because SQLite rebuilds the whole
table (see the `router_id` comment on `workspaces`). Follow that pattern and store plain
integer ids.

New table `access_policies`:

| column | type | meaning |
|---|---|---|
| `id` | Int PK | |
| `name` | String, unique | e.g. `engineering`, `contractors` |
| `description` | String? | |
| `allowed_models` | String (JSON) | `[{ "provider": "anthropic", "model": "*" }, { "provider": "openai", "model": "gpt-4o-mini" }]`. `"*"` matches any model of that provider. An empty list allows nothing. |
| `default_provider` | String? | used when the workspace's model isn't allowed (see open decision 1) |
| `default_model` | String? | |
| `router_id` | Int? | when set, chats for this account go through this model router |
| `allow_agents` | Boolean, default true | |
| `agent_tools` | String? (JSON) | a tool rule (see "Agent skill and MCP restrictions"); null means use the role default |
| `created_by` | Int? | |
| `createdAt`, `lastUpdatedAt` | DateTime | |

Changes to existing tables:

- `users.policy_id Int?`
- `api_keys.user_id Int?`: the owner; null means a legacy, unscoped key.
- `api_keys.workspace_ids String?`: a JSON array of workspace ids; null means every
  workspace the owner can reach.
- `api_keys.expiresAt DateTime?`
- `api_keys.lastUsedAt DateTime?`

Policies are reusable, so on their own they act as account types. Teams, which add
membership, team-owned workspaces and presets, and scoped team leads on top of policies,
are designed in "Teams" below.

### Policy module: `server/utils/accessPolicy/index.js` (new)

- `getPolicyForUser(user)`: returns the policy or `null`, cached per request through
  `response.locals` or a short-TTL cache like the one in `utils/router`.
- `isModelAllowed(policy, { provider, model })`: a pure function and the unit-test target.
- `resolveAllowedSelection(policy, { provider, model })`: returns
  `{ provider, model }`, or `{ error }` with a message the user can read.

The model (`server/models/accessPolicy.js`) follows the shape of `models/modelRouter.js`:
`create`, `update`, `get`, `where`, `delete`, plus validation that the JSON in
`allowed_models` is well formed.

### Enforcement points

| Path | File | Change |
|---|---|---|
| Web chat, developer API chat, OpenAI-compatible, Telegram | `resolveProviderConnector` in `server/utils/helpers/index.js:726` | Look up the user's policy. In the non-router branch, run the workspace's provider and model through `resolveAllowedSelection`. In the router branch, use the policy's `router_id` when set, then check `routingMetadata.routedTo` and fall back to the policy default when the routed model isn't allowed. |
| Agent chats (these run before the point above) | `server/utils/agents/index.js` (provider setup around lines 422–491) and `server/utils/agents/ephemeral.js:151–216` | Once provider and model are chosen, apply the same check. When `allow_agents` is false, refuse the agent invocation with a clear message. |
| Auxiliary LLM calls (thread titles, summarization, memory) | `endpoints/workspaces.js`, `endpoints/api/workspace/index.js`, `agents/aibitat/plugins/memory.js`, `agents/aibitat/utils/summarize.js` | These are system-internal, so leave them alone in phase 1 and document that choice. Check each one while implementing to confirm none of them can be driven by user input. |
| Embeds | `utils/chats/embed.js` | No change: embeds have no user, and they already have `allow_model_override`. |
| Agent websocket | `server/endpoints/agentWebsocket.js:29-33`, `#validInvocation` in `server/utils/agents/index.js` | Require the caller's session (token in the `Sec-WebSocket-Protocol` header or a cookie once sessions move to one) and check that it belongs to the invocation's `user_id` before the atomic claim. In single-user mode, check the single-user token instead. Without this, a policy can be used by anyone who learns the invocation UUID. |
| Developer API thread chat | `server/endpoints/api/workspaceThread/index.js:448` | For an owned key, ignore the `userId` in the body and use the key owner. For a legacy key, keep today's behavior until the cut-off date (see "Scoped API keys"). |
| Mobile app | `server/endpoints/mobile/middleware/index.js:12-42` | Resolve the device's own user and apply that user's policy. A device with `userId = null` in multi-user mode is refused rather than treated as unrestricted (SMF-09, M5). Pairing records the user being paired, not the admin who opened the pairing screen (F-05). |

Every caller listed above must pass `user` into `resolveProviderConnector`. Today the API
handlers pass `user: null` (`endpoints/api/workspace/index.js:704` and `:866`, plus the
workspace-thread and openai handlers). Fixing that is part of the API key work below.

**Router binding.** A policy's `router_id` inherits the router problems above. Before a
policy can name a router: deleting a router that a workspace, `MODEL_ROUTER_ID` or a
policy still uses is either refused or falls back to the system provider (open decision
21); rule operations are scoped to their router; and a rule change clears the cache of
the router that owns the rule. This is audit issue 5 (SMF-12).

### Agent skill and MCP restrictions

**A tool rule** has the shape `{ "allow": [...] | null, "deny": [...] }`. A tool is
available only if it matches `allow` (when `allow` isn't null) and doesn't match `deny`.
Entries use the names the agent code already uses:

- built-in skills: `web-browsing`, or `parent#child` for a sub-skill;
- agent flows: `@@flow_<uuid>`;
- imported plugins: `@@<hubId>`;
- a whole MCP server: `@@mcp_<server>`;
- a single MCP tool: `<server>:<tool>`.

**Where rules come from,** first match wins:

1. the user's access policy, when its `agent_tools` isn't null;
2. their team's policy, when it has `agent_tools` (see "Teams");
3. the user's role default, from a new system setting `agent_tool_role_policy`
   (`{ "manager": <rule>, "default": <rule> }`; no entry for a role means no restriction);
4. no restriction, which is today's behavior.

Requests with no user (single-user mode, legacy API keys) and admins without a policy get
every tool, as now. An MCP server can also carry `anythingllm.allowedRoles: [...]` in its
config next to `autoStart` and `suppressedTools`. It is checked in addition to the rules
above, so the restriction can live with the server.

**Module:** `server/utils/accessPolicy/agentTools.js` (new):

- `getToolRuleForUser(user)`: resolves the rule from the order above.
- `filterAgentFunctions(functions, rule, user)`: a pure function and the unit-test target.
- `isMcpToolAllowed(rule, server, tool, user)`: also checks `anythingllm.allowedRoles`.

**Enforcement points:**

| Path | File | Change |
|---|---|---|
| Web agent tool list | `WORKSPACE_AGENT.getDefinition` in `utils/agents/defaults.js:72` | Run `functions` through `filterAgentFunctions`; the user is already passed in. |
| API and Telegram agent tool list | `EphemeralAgentHandler.#loadAgents` in `utils/agents/ephemeral.js:426` | Today this builds its own copy of the same list. Replace the copy with the filtered list from `getDefinition`, so the two can't drift apart. |
| Scheduled job tool overrides | `ephemeral.js:601` (`toolOverrides`) | Today jobs only run in single-user mode, with no owner. With "Scheduled jobs in multi-user mode", the job's tools are filtered against the owner's rule at every run, and only `approved_tools` run unattended. |
| Attaching each plugin (defense in depth, and per-tool MCP) | `#attachPluginByName` in `utils/agents/index.js:620` and the MCP branch in `ephemeral.js:332` | Re-check each entry before attaching. After an MCP server is split into its tools, drop any tool that `isMcpToolAllowed` rejects. |
| Turning a tool on mid-chat | `#toggleAgentTool` in `utils/agents/index.js:760` | Already admin-only. Still run the check, so an admin's own policy applies. |
| Listing tools in the UI | the endpoints that return the agent skill and MCP lists the chat UI shows | Return only the tools the user may use, so hidden tools aren't advertised. |

Filtering stops tools being offered to a user. MCP servers still boot once for the whole
instance. A server whose process has died stays in the hypervisor's `mcps` map and looks
running (SMF-21), so the filtered list must also drop servers whose client has closed;
otherwise a permitted tool is offered and then fails. Dropping dead clients on `onclose`
is part of audit issue 6. For MCP servers you control, the identity forwarding that already exists
(`utils/MCP/identity.js`, `X-AnythingLLM-User-Role`) lets the server refuse calls by role
on its own side too.

### Scoped API keys

- **`validApiKey`** (`server/utils/middleware/validApiKey.js`): reject expired keys; set
  `response.locals.apiKey`; when `user_id` is set, load the user, reject a suspended user
  with 403, and set `response.locals.user`. Update `lastUsedAt`, at most once a minute,
  so the database isn't written on every request.
- **New middleware `apiKeyRoleValid(roles)`**: legacy keys pass until the cut-off below.
  Owned keys must belong to a user whose role is in `roles`.
- **Legacy key cut-off.** Legacy keys have no owner, so they can never be limited by a
  policy, and keys made in single-user mode (`createdBy = null`) keep full `/v1/admin`
  power after multi-user is turned on (`server/utils/middleware/validApiKey.js:17`). Add
  `LEGACY_API_KEYS_UNTIL` (a date). Before it, legacy keys work and every use logs
  `legacy_api_key_used`, and the API keys page shows a banner to assign owners. After it,
  legacy keys get 403. In HIPAA mode the date is ignored and legacy keys are refused at
  once (open decision 24).
- **Key creation.** Only an owned admin key, or an admin session, may create keys
  through `/v1/admin`; a legacy key may not create another key. Apply `[admin]` to
  `api/admin`, `api/userManagement`, `api/system` write routes and `api/mcpServers`.
- **Workspace scoping:** in `api/workspace`, `api/workspaceThread`, `api/document` and
  `api/openai`, an owned key resolves workspaces through `Workspace.getWithUser(user, …)`
  and then through `workspace_ids`. `GET /v1/openai/models` lists only the workspaces
  the key can reach.
- **Pass the user through:** API chat handlers pass the real `user`. The chat is then
  logged against that user, and `User.canSendChat` applies to API traffic. For owned
  keys, any `userId` in the request body is ignored
  (`server/endpoints/api/workspaceThread/index.js:74,448` today trust it).
- **Key management:** `POST /admin/generate-api-key` (`endpoints/admin.js:524`) and
  `/system/generate-api-key` (`endpoints/system.js:1065`) accept `userId`,
  `workspaceIds` and `expiresAt`. `GET /admin/api-keys` returns the owner and scope.

### Teams

**What exists today.** There are no teams or groups. The schema has users, three fixed
roles and workspace membership (`workspace_users`). Admins and managers see every
workspace (`server/models/workspace.js:294`); managers manage every user. Skills, agent
flows, imported plugins and MCP servers are installed once for the whole instance
(`storage/plugins/agent-skills`, `storage/plugins/agent-flows`, the MCP config), and
installing them is admin-only (`server/endpoints/agentFlows.js`,
`server/endpoints/communityHub.js`). Slash command presets belong to one user
(`slash_command_presets.uid`), and system prompt variables are accidentally global
(F-18). So a skill can be given to everyone or no one, and nothing can be shared with
"my team".

**Model.** A team is a named set of users with:

- an access policy that applies to every member (models, router, agents, tool rule,
  guardrail profile), so the policy is the team's "account type";
- workspaces it owns, which every member can open;
- slash command presets and prompt variables shared with its members;
- one or more leads, who manage the team without being instance-wide managers.

Skills and flows stay installed once for the instance, because they are code and files.
"Sharing a skill with a team" means adding it to the team policy's `agent_tools.allow`
list, and leaving it out of the role default, so only that team is offered it. Installing
a skill stays admin-only.

**Data model** (same migration rules as above: nullable columns, plain integer ids):

| table / column | type | meaning |
|---|---|---|
| `teams.id` | Int PK | |
| `teams.name` | String, unique | e.g. `clinical-ops` |
| `teams.description` | String? | |
| `teams.policy_id` | Int? | the team's access policy; null means members fall back to their own policy or role default |
| `teams.idp_group` | String?, unique | a Google Group email, for group sync later (see "Google sign-in") |
| `teams.created_by`, `createdAt`, `lastUpdatedAt` | | |
| `team_members.team_id`, `team_members.user_id` | Int | unique on `(team_id, user_id)`; v1 also unique on `user_id` (one team per user, open decision 28) |
| `team_members.role` | String, default `member` | `member` or `lead` |
| `team_members.added_by`, `createdAt` | | |
| `workspaces.team_id` | Int? | owning team; null means today's behavior |
| `slash_command_presets.team_id` | Int? | shared with the team when set |
| `system_prompt_variables.team_id` | Int? | shared with the team when set (with platform fix 6 making user variables per user) |

**Policy resolution.** `getPolicyForUser(user)` resolves in this order: the user's own
`policy_id` (a per-person exception), then their team's `policy_id`, then none (today's
behavior). The tool rule order in "Agent skill and MCP restrictions" becomes: user policy,
team policy, role default, none. Membership is read per request, like role and
suspension, so adding or removing someone takes effect on their next request.

**Workspace access.**

- `Workspace.getWithUser` and `whereWithUser` (`server/models/workspace.js:294`, `:415`)
  also match workspaces where `team_id` is the user's team, in addition to
  `workspace_users`.
- A team lead can create workspaces owned by their team, add or remove team members on
  those workspaces, and edit their settings within what the team policy allows.
- Admins keep access to everything. Whether managers keep instance-wide access once teams
  exist is open decision 29; the proposal is yes for now, so nothing changes for existing
  installs.
- Moving a workspace between teams, or detaching it, is admin-only.

**Team leads.**

- New middleware `teamRoleValid(["lead"], { teamFrom })` in
  `server/utils/middleware/teamProtected.js`. It loads the caller's membership and checks
  that the team in the request (route param, or the workspace's `team_id`) is theirs.
  Admins pass.
- Leads can:
  - add existing users with the `default` role to their team, or remove them;
  - make another member a lead;
  - manage team workspaces, presets and variables;
  - view the team's usage and guardrail events.
- Leads can't change anyone's role, policy or suspension, edit the team's policy, create
  users or invites outside the team flow, or see other teams.
- Every lead action writes an event (`team_member_added`, `team_member_removed`,
  `team_lead_changed`, `team_workspace_created`), with the actor and the team.
- A team can't be left with no lead while it has members, unless an admin does it.
  Enforce this in a transaction with a conditional write, the same pattern as the
  last-admin guard (SMF-13).

**Sharing.**

- Presets and variables: a "Share with my team" toggle sets `team_id`. Members see shared
  items next to their own; only the owner, a lead or an admin can edit them. The preset
  unique key becomes `(uid, team_id, command)`, so a personal command can shadow a team
  one; personal wins.
- Skills, flows, MCP tools: on the agent skills page, an admin picks which teams are
  offered each item. This writes the team policies' `allow` lists. A team with no policy
  gets one created for it.
- Community Hub: unchanged and admin-only. Private hub items imported by an admin can
  then be shared with a team as above.

**Google Groups.** `teams.idp_group` links a team to a Google Group. Phase 1 stores it
and shows it, but doesn't sync. The follow-up (open decision 9) reads group membership at
each sign-in through the Directory API, and sets the user's team from the first matching
group. A user removed from the group drops out of the team at their next sign-in.

**Deleting a team.**

- Members fall back to their own policy or role default.
- Team workspaces become admin-only: `team_id` is set to null, and nobody else has
  `workspace_users` rows for them unless they were added directly. Open decision 30
  covers this.
- Shared presets and variables go back to their owners.
- One `team_deleted` event lists the counts.
- Everything runs in one transaction.

**Enforcement points:**

| Path | File | Change |
|---|---|---|
| Policy lookup | `server/utils/accessPolicy/index.js` | Resolve user policy, then team policy |
| Tool filter | `server/utils/accessPolicy/agentTools.js` | Add the team step to the rule order |
| Workspace reads and lists | `server/models/workspace.js` (`getWithUser`, `whereWithUser`) | Match team workspaces |
| Workspace and member management | `server/endpoints/workspaces.js`, `server/endpoints/admin.js` (workspace members) | Allow leads on their team's workspaces through `teamRoleValid` |
| Presets and variables | `server/endpoints/system.js:1302-1401`, `server/models/systemPromptVariables.js` | Return own plus team items; edit rights for owner, lead, admin |
| Developer API | scoped keys from "Scoped API keys" | An owned key reaches its owner's team workspaces too, narrowed by `workspace_ids` |
| Chat log viewer | `server/endpoints/system.js` chat export and list | Leads see their team's workspace chats only if open decision 31 allows it; every view is logged (Compliance hardening item 5) |

**Teams in HIPAA mode.** Team boundaries are a "minimum necessary" control: in HIPAA
mode, managers lose instance-wide workspace access, and work through team membership
like everyone else.

### Scheduled jobs in multi-user mode

**What exists today.**
- **Single-user only.** Scheduled jobs work only in single-user mode. Their routes use
  `isSingleUserMode` (`server/endpoints/scheduledJobs.js:20`), and timers registered
  before a switch to multi-user stop at their next fire
  (`server/utils/BackgroundWorkers/index.js:401-405`).
- **What a job is:** a name, a prompt, a cron schedule and an optional tool list
  (`scheduled_jobs`, `server/prisma/schema.prisma:403`).
- **How a run works.** Each run starts an `EphemeralAgentHandler` with no workspace and no
  user (`server/jobs/run-scheduled-job.js:61-74`), so it uses the system model and can't
  search any workspace's documents. Every tool approval is granted automatically
  (`:76-83`, F-24). Results go to `scheduled_job_runs`, and a browser push shows the start
  of the reply.
- **Limits:** a 5-minute timeout (`SCHEDULED_JOB_TIMEOUT_MS`) and one run at a time
  (`SCHEDULED_JOB_MAX_CONCURRENT`).
- **Open audit findings:** a run can hang before its timeout (SMF-24), and it's unknown
  whether two `ScheduledJobRun.start` calls can both insert (SMF-36). A worker killed by a
  signal was recorded as a success (SMF-05, fixed on the audit branch).

Lifting the single-user guard alone would give every user unattended agents that approve
their own tool calls. The design below makes each job run as a person, under that
person's rules, with approvals decided ahead of time by a human.

**Ownership.** New nullable columns on `scheduled_jobs`:

| column | type | meaning |
|---|---|---|
| `user_id` | Int? | owner; null only for jobs created in single-user mode |
| `workspace_id` | Int? | the workspace the job runs in; its documents, system prompt and model apply |
| `thread_id` | Int? | optional thread the results are posted to |
| `approved_tools` | String? (JSON) | tools pre-approved for unattended use (below) |
| `approved_by` | Int?, `approved_at` | who approved them and when |
| `notify` | String, default `push` | `push`, `none`, or `thread` |

`scheduled_job_runs` gains `user_id` (copied at run time), so runs can be filtered and
audited without joining.

**Running as the owner.** `run-scheduled-job.js` passes `workspace` and `userId` to
`EphemeralAgentHandler` (both are already constructor parameters,
`server/utils/agents/ephemeral.js:59-89`). Before each run, the runner checks:

- the owner exists, isn't suspended, and still has access to the workspace (through
  `workspace_users` or their team), or the run fails with `owner_lost_access`;
- the owner's policy allows agents, and the workspace's model passes
  `resolveAllowedSelection`;
- the owner is within `dailyMessageLimit` and, once budgets exist, their budget.

The job's tool list is run through `filterAgentFunctions` with the owner's tool rule, at
run time and not only when the job is saved. So a policy or team change takes effect on the
next run.

**Approvals.** Automatic approval is removed in multi-user mode:

- A tool with side effects runs unattended only when it is in `approved_tools`. Anything
  else is **refused**, not approved; the refusal is recorded in the run, and the agent is
  told the tool isn't available.
- **Who may approve:**
  - the owner may approve tools their policy allows them to self-approve
    (`allow_self_approval`, see "Guardrails");
  - otherwise a team lead or an admin approves, from the job's page.
  - Editing the prompt, workspace or tool list clears `approved_tools`, so a changed job
    needs approving again.
- **The create-scheduled-job skill** can create a job owned by the chatting user. It can
  never set `approved_tools`: approval only happens in the UI, so a planted instruction in
  a document or web page can't create a job that approves itself.
- Single-user mode keeps today's behavior (automatic approval), with a warning on the
  jobs page. HIPAA mode forces multi-user, so automatic approval is never used there.

**Visibility.**
- Owners see and manage their own jobs and runs.
- Team leads see their team's jobs.
- Admins see all of them.
- Results and generated files are served only to those people. Generated files follow
  platform fix 7 (authorized by owner).
- With `notify: thread`, results are posted to `thread_id` as a chat from the owner's
  workspace, so they appear in normal chat history and in retention and deletion.

**Limits.**
- New policy fields: `max_scheduled_jobs` (default 5), `min_job_interval_minutes`
  (default 60, which rejects cron expressions that fire more often), and an optional cap
  on runs per day.
- Concurrency stays global (`SCHEDULED_JOB_MAX_CONCURRENT`), with a fair queue so one user's
  jobs can't hold all slots.
- The 5-minute timeout stays.
- The parent process watches each run and kills it by run id, which fixes SMF-24 (audit
  issue 6).
- A unique partial index or conditional insert guarantees one running run per job (SMF-36).

**Audit and deletion.**
- New events `scheduled_job_created`, `scheduled_job_approved`, `scheduled_job_run`
  (status, tools used, refused tools) and `scheduled_job_deleted`, with actor and owner.
- Deleting a user, or removing them from a workspace, disables their jobs. A
  `dataDeletion.forUser` run (Compliance hardening item 7) deletes their jobs and runs.
- Run results count as chat data for retention.

**Notifications.** In HIPAA mode, push carries only the job name and status, never reply
text. This replaces the excerpt sent by `server/jobs/helpers/scheduled-job-helper.js`.

**Switching to multi-user mode.** Jobs created in single-user mode have no owner. When
multi-user is turned on, the migration in `enable-multi-user` assigns them to the first
admin, the same as other single-user rows, and clears `approved_tools`. They then stay
disabled until an admin reviews and approves them.

**Enforcement points:**

| Path | File | Change |
|---|---|---|
| Job routes | `server/endpoints/scheduledJobs.js` | Replace `isSingleUserMode` with `validatedRequest` plus owner, lead or admin checks; a separate approval endpoint |
| Timer registration | `server/utils/BackgroundWorkers/index.js:394-428` | Drop the multi-user stop; check owner status before enqueueing |
| Run | `server/jobs/run-scheduled-job.js` | Pass owner and workspace; filter tools; replace auto-approve with the `approved_tools` check; record refusals |
| Agent skill | `server/utils/agents/aibitat/plugins/create-scheduled-job/` | Set owner and workspace; never set approvals; respect policy limits |
| Push | `server/jobs/helpers/scheduled-job-helper.js` | HIPAA-mode payload without reply text |

### Google sign-in

**Option considered: a bridge with no AnythingLLM changes.** A small outside service
signs users in with Google, finds or creates the matching AnythingLLM user through the
admin API, calls `issue-auth-token`, and redirects to `/sso/simple?token=…`. This works
today with Simple SSO. It is rejected as the main path because it means running and
securing another service that holds an admin API key, and role and policy assignment
would live outside AnythingLLM. It remains a fallback if native sign-in is delayed.

**Proposed: native OpenID Connect sign-in, with Google as the first provider.** Google
sign-in is standard OIDC, so the same code also works later for Microsoft Entra, Okta or
Keycloak by changing configuration. Google-specific handling is limited to the `hd`
(Workspace domain) claim.

**Configuration.** Stored in `system_settings`, edited on the Security settings page, and
saved in one transaction after every field is validated. The client secret is encrypted
with `STORAGE_ENCRYPTION_KEY` when that key is set. Not through `updateENV`: it applies a
request key by key and stops at the first error, and a crash while `.env` is rewritten can
drop keys (SMF-10, SMF-29). A half-saved sign-in configuration, or one lost on restart,
can lock everyone out once `OIDC_ONLY` is on. Environment variables with the same names
override the stored values, for deployments that inject configuration. Settings:

- `OIDC_ENABLED`
- `OIDC_ISSUER` (`https://accounts.google.com`)
- `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
- `OIDC_REDIRECT_URI`: set explicitly, never built from request headers, so a forged
  `Host` header can't redirect the login.
- `OIDC_ALLOWED_DOMAINS`: e.g. `example.com`; checked against `hd` and the email domain.
- `OIDC_PROVISIONING`: `invite_only` (default) or `auto`.
- `OIDC_DEFAULT_ROLE` and `OIDC_DEFAULT_POLICY_ID`: used for accounts created
  automatically.
- `OIDC_ONLY`: turns password login off, like `SIMPLE_SSO_NO_LOGIN` does.

**Data model** (same migration rules as above):

New table `user_identities`: `id`, `user_id`, `provider` (`google`), `subject` (the ID
token's `sub`), `email`, `createdAt`, `lastLoginAt`, unique on `(provider, subject)`.
Accounts are linked by `sub`, never by email alone, because an email address can be
reassigned. `users` has no email column, so the identity row holds it.

**Flow** (new `server/endpoints/auth/oidc.js` and `server/utils/auth/oidc.js`, using the
`openid-client` package):

1. `GET /auth/oidc/start` generates `state`, `nonce` and a PKCE verifier, stores them in a
   short-lived signed cookie, and redirects to Google with scope `openid email profile`.
2. `GET /auth/oidc/callback` checks `state`, exchanges the code, and verifies the ID token:
   signature against Google's published keys, `iss`, `aud`, `exp`, `nonce`,
   `email_verified`, and the allowed domain.
3. Find the user: by `(provider, sub)` first. If there's no match, use invite-only or
   automatic provisioning:
   - **Invite-only:** link to an existing user only when an admin set up that link
     ahead of time. Admins do this by creating the user with a "Google email" field, or
     with an invite that names an email. A user nobody set up is refused. Claiming an
     invite is a conditional write (`updateMany where status = "pending"`, act only on
     count = 1) in the same transaction as creating the user and the identity row.
     Today's claim reads the status, creates the user, then marks the invite, so two
     callbacks at once create two accounts (SMF-14, audit issue 9). The
     `(provider, subject)` unique index stops a second identity row; the claim stops a
     second user.
   - **Automatic:** create the user with `OIDC_DEFAULT_ROLE`, `OIDC_DEFAULT_POLICY_ID`, a
     username taken from the email, and an unusable random password hash (`password` is
     a required column).
4. Refuse suspended users. Log `login_event` or `failed_login_oidc` in `event_logs`.
5. Issue a `TemporaryAuthToken` and redirect to the existing `/sso/simple?token=…` page.
   That page swaps it for a session JWT, the same way Simple SSO does. The session JWT
   never appears in a URL, and no new frontend session handling is needed. The swap is
   already single-use under concurrency (`615056a9`, SMF-01). Issuing still deletes and
   then creates the user's token outside a transaction, so two live tokens can exist
   (SMF-32); wrap `issue` in a transaction as part of this work.

**Where roles and policies come from.** Google ID tokens don't include group membership.
Phase 1 keeps roles and policies managed in AnythingLLM. Accounts created automatically
get the defaults, and admins adjust them afterwards. Mapping Google Groups to roles and
policies needs the Google Admin SDK Directory API (or the Cloud Identity Groups API) with
a service account. That is listed as a follow-up. It uses `teams.idp_group` (see
"Teams"), so a Google Group maps to a team, and through the team to a policy. Membership
is re-evaluated at each sign-in. Roles stay managed in AnythingLLM.

**Sessions.** Session JWTs last 30 days, so turning off someone's Google account doesn't
sign them out of AnythingLLM. Sessions created through OIDC therefore get a shorter
expiry (new `OIDC_SESSION_EXPIRY`, default `12h`) and require signing in to Google again
after that. Suspending the user, or changing their role, in AnythingLLM still takes effect
immediately, as it does today, because both are read from the database on each request.

**Admin access if Google fails.** With `OIDC_ONLY` set, keep password login working for
users with the `admin` role. That way a Google misconfiguration can't lock everyone out.
Recovery codes keep working for those accounts.

The fallback only helps while an active admin exists. Today the last admin can be
suspended or deleted, because only demotion is guarded. That guard counts suspended
admins too, and reads the count before writing, so two demotions at once can leave none
(SMF-13). Before `OIDC_ONLY` ships: suspend, delete and demote all check "at least one
other active admin" inside the same transaction as the write (audit issue 9). Password
reset must also stop clearing `seen_recovery_codes` when the new password is rejected
(SMF-15), or an admin's recovery codes can be left unusable.

**API keys** are unaffected. Scoped keys belong to users whether they sign in with Google
or a password.

### Guardrails

**Guardrail profiles.** New table `guardrail_profiles`:

| column | type | meaning |
|---|---|---|
| `id` | Int PK | |
| `name` | String, unique | e.g. `standard`, `sensitive-data` |
| `input_rules` | String (JSON) | list of rules (below) applied to what the user sends |
| `output_rules` | String (JSON) | list of rules applied to the model's reply |
| `output_mode` | String, default `after` | `after`, `hold` or `chunked` (see output checks) |
| `checker` | String? | moderation service: null (local rules only), `model-armor`, `openai-moderation`, `azure-content-safety`, `bedrock-guardrails`, `ollama-guard` |
| `checker_config` | String? (JSON) | service-specific settings, e.g. a Model Armor template; credentials stay in environment variables |
| `on_checker_error` | String, default `allow` | `allow` or `block` when the service is unreachable |
| `created_by`, `createdAt`, `lastUpdatedAt` | | |

A rule is `{ "type": "keyword" | "regex" | "pii" | "secret" | "checker", "match": …,
"action": "block" | "redact" | "warn" | "log", "message": "shown to the user on block" }`.
Built-in `pii` detectors: email, phone, government ID formats, card numbers checked with a
checksum. Built-in `secret` detectors: common API key formats and private key blocks.

A profile attaches in two places: `access_policies.guardrail_profile_id Int?` and
`workspaces.guardrail_profile_id Int?` (no relation, as before). When both apply, the
stricter result wins: block over redact, over warn, over log. A system setting
`default_guardrail_profile_id` covers users and workspaces with neither. No profile
anywhere means no checks, which is today's behavior.

**Module:** `server/utils/guardrails/` (new):

- `index.js`: `resolveProfiles({ user, workspace })`, `checkInput(...)`,
  `checkOutput(...)`. Each returns `{ action, text, matches }`, where `text` is the
  redacted text when the action is `redact`.
- `rules.js`: the local keyword, regex, PII and secret detectors. Pure functions and the
  main unit-test target.
- `checkers/`: one file per moderation service, same interface, chosen the way LLM
  providers are chosen in `utils/helpers/index.js`. `ollama-guard` runs Llama Guard or
  ShieldGemma locally, so no chat text leaves your machines.

**Input checks.** `checkInput({ user, workspace, channel, message, attachments })` runs at
the start of each chat path, before agents take over, so agent chats are covered too:

| Channel | File | Where |
|---|---|---|
| web | `utils/chats/stream.js` | right after `grepCommand` (line 38), before `grepAgents` |
| developer API | `utils/chats/apiChatHandler.js` | at the start of both chat functions (lines 147 and 524) |
| OpenAI-compatible | `utils/chats/openaiCompatible.js` | before the workspace chat is resolved |
| embed | `utils/chats/embed.js` | before `resolveLLMConnectorForEmbed` |
| Telegram | `utils/telegramBot/chat/stream.js`, `utils/telegramBot/chat/agent.js` | before the LLM or agent call |

On `block`, the chat ends with the rule's message, in the same way the daily-limit error
is returned today, and nothing is sent to the LLM. On `redact`, the redacted text is what
the LLM sees and what is saved. Attachments: text from parsed files is checked; images
are passed only to a checker that supports images.

**Output checks.** `checkOutput(...)` runs on the model's reply:

- `after` (default): run where the chat is saved (`WorkspaceChats.new`; 4 calls in
  `stream.js`, 8 in `apiChatHandler.js`, 6 in `openaiCompatible.js`, 1 each in the
  Telegram files). A match flags the chat and can replace the saved text. The user has
  already seen the reply, so this mode is for logging and review.
- `hold`: buffer the whole reply, check it, then send it. Nothing reaches the user
  unchecked, at the cost of losing streaming for that workspace. Send keep-alive events
  while holding. The client treats any failed request during its auth check as signed out
  and clears storage (`frontend/src/AuthContext.jsx:50-72`, SMF-30), so long silent
  holds make false sign-outs more likely. Audit issue 11 (tell network errors apart from
  401) ships with or before `hold`.
- `chunked`: check each sentence as it's produced and stop the stream on a block.

**Agent and tool guardrails:**

- `POST /agent-skills/whitelist/add` becomes admin-only, unless the user's policy has
  `allow_self_approval` true (new boolean on `access_policies`, default false). The
  whitelist is one JSON array per user in `system_settings`
  (`user_<id>_whitelisted_agent_skills`), rewritten whole on each add, so two adds at once
  lose one (SMF-23). Do the read and write in one transaction.
- New `access_policies.require_tool_approval` boolean, default true: when true, the
  user's own whitelist entries are ignored and every side-effecting tool asks.
- API agents with a scoped key check the key owner's whitelist and policy instead of the
  system-wide list.
- Risky combinations: a policy can name tool pairs that may not both be enabled in one
  session, e.g. web browsing with sending email, so content from a web page can't make
  the agent send data out. Enforced in the shared tool filter from "Agent skill and MCP
  restrictions".
- Tool output from documents, web pages and MCP servers runs through the same input
  rules before it goes back to the model, so a planted instruction or leaked secret is
  caught by the same checks as user input.

**Audit and detection:**

- New table `guardrail_events`: `id`, `user_id`, `workspace_id`, `api_key_id`, `channel`,
  `direction` (`input`, `output`, `tool`), `profile_id`, `rule`, `action`, `excerpt_hash`,
  `excerpt` (a short redacted snippet), `createdAt`. The matched text isn't stored in
  full, so the log doesn't become a second copy of the sensitive data.
- Guardrail events get their own write function that throws on failure. They don't go
  through `EventLogs.logEvent`, which swallows write errors (`server/models/eventLogs.js:4-23`).
  On a failed write in `block` mode, the chat is still blocked; in other modes, the
  failure is logged and counted on the review page. Related audit-trail bugs to fix in the
  same PR: clearing the event log reports success when the delete failed (SMF-28), and
  deleting a user reports success on failure (SMF-31); both are audit issue 10.
- API traffic is attributed only after the scoped API key work lands. Until then,
  guardrail events for API chats have no `user_id`, and a policy's profile can't apply to
  them.
- Admin review page listing events with filters by user, workspace, rule and action, and
  a link to the chat.
- Alerts by webhook, Slack or email when a user crosses a threshold (for example, 5
  blocks in an hour). These reuse the external connectors in
  `external_communication_connectors` where one fits.
- Unusual-volume alerts using `usage_events`, once the budgets PR lands.
- Retention: a system setting `chat_retention_days`; a Bree background job (like
  `sync-watched-documents`, not the user-facing scheduled jobs feature, which only runs in
  single-user mode) deletes older `workspace_chats`, `embed_chats` and `guardrail_events`
  rows. It deletes rows, rather than hiding them the way user and thread deletes do today.
- Optional forwarding of `event_logs` and `guardrail_events` to a SIEM by webhook.

**Acceptable-use policy:**

- A system setting holds the acceptable-use text. Users must accept it at first sign-in
  and again when it changes; acceptance is recorded in a new `users.aup_accepted_at`
  column and the version they accepted. This runs after Google sign-in as well.
- A system-wide prompt prefix that is always placed before the workspace system prompt,
  so baseline rules apply in every workspace and can't be removed by editing one.

### Compliance hardening

Each item below matches one of the nine gaps at the end of the review.

**1. Encrypt stored credentials.**

- New `STORAGE_ENCRYPTION_KEY`, supplied from outside the app (a secrets manager, or a
  Docker or Kubernetes secret). It is never written to `.env` or the database. Without
  it, the app keeps today's behavior and shows a warning on the Security page.
- Add authenticated encryption (AES-256-GCM) to `EncryptionManager` next to the existing
  CBC methods, which the collector still uses.
- Encrypt on write and decrypt on read: `agent_sql_connections`, Gmail, Google Calendar
  and Outlook OAuth tokens, connector tokens, MCP server environment values and headers,
  and OIDC client secrets. A one-time migration encrypts existing values.
- Provider API keys in `.env`: document running with keys injected as environment
  variables from a secrets manager, and add `ENV_READ_ONLY=true` so `updateENV.js` never
  writes secrets to disk in that setup.
- Document that `storage/` (database, documents, vectors) must sit on an encrypted disk
  or volume. The app doesn't encrypt those files itself; see "Considered and left out".

**2. Sessions: idle timeout, revocation, and no token in `localStorage`.**

- New table `user_sessions`: `id`, `user_id`, `createdAt`, `lastSeenAt`, `expiresAt`,
  `revokedAt`, `ip`, `user_agent`, `auth_method` (`password`, `oidc`, `simple_sso`).
  The session JWT carries the session `id`, and `validatedRequest` checks the row.
- Idle timeout: `SESSION_IDLE_TIMEOUT` (default `15m` in HIPAA mode, off otherwise).
  `lastSeenAt` is updated at most once a minute.
- Revocation: a password change, deleting the user, or "sign out everywhere" revokes their
  sessions at once. Suspension and role changes already take effect on the next request,
  because `validatedRequest` reads both from the database; revoking on suspension as well
  is still useful so the session list shows it.
- Browser sessions move to an `HttpOnly; Secure; SameSite=Strict` cookie, so page scripts
  can't read the token. State-changing requests also send a CSRF token header. Bearer
  tokens stay supported for the mobile app, browser extension and developer API, which
  have their own credentials.
- The agent websocket has no session check today (F-04); the "Enforcement points" table
  adds one that ties the connection to the invocation's user. When sessions move to a
  cookie, that check reads the cookie. Agent invocations also need an expiry, and a sweep
  of open rows at boot, so an unused invocation UUID doesn't stay valid forever (SMF-35).
- Check how file downloads authenticate today, and move them to the same session check.
- Frontend: `frontend/src/AuthContext.jsx` and `frontend/src/utils/request.js` stop
  storing and sending the token, and show a "signed out for inactivity" message.

**3. Login rate limiting and lockout.**

- Add `express-rate-limit` to `POST /request-token`, the OIDC start and callback, account
  recovery, password reset and invite acceptance: per IP and per username.
- Lockout after `LOGIN_MAX_FAILURES` (default 5) failures within 15 minutes, for
  `LOGIN_LOCKOUT_MINUTES` (default 15), stored in a new `login_attempts` table so it
  survives restarts. Admins can unlock a user from the Users page.
- Log `login_locked_out` and `login_rate_limited` events.

**4. Narrow CORS.**

- Replace `cors({ origin: true })` (`index.js:67`) with `CORS_ALLOWED_ORIGINS` (default:
  the app's own origin).
- The embed routes keep their own CORS rules from each embed's `allowlist_domains` in
  `utils/middleware/embedMiddleware.js`.
- `/v1/*` developer API routes accept a separate `API_CORS_ALLOWED_ORIGINS`, empty by
  default, since server-to-server calls don't need CORS.

**5. Access logging and an auditor role.**

The audit event format, writer and full event catalogue are in
`PLAN-audit-logging-and-compliance.md`, which takes over the logging parts of items 5,
6 and 9. The bullets below stay as the controls this plan builds; their events use that
plan's catalogue names.

- New events: `chat_viewed` (an admin or manager opening another user's chats),
  `chats_exported` (with filters and row count), `workspace_opened`, `document_viewed`,
  `document_downloaded`, `generated_file_downloaded`, `memory_viewed`,
  `event_logs_viewed`, `guardrail_events_viewed`.
- New role `auditor`: read-only access to chat logs, event logs and guardrail events,
  with no settings or user management.
- In HIPAA mode, admins don't get the chat log viewer or export by default; an admin
  grants it to specific users through the `auditor` role. That follows the "minimum
  necessary" rule.

**6. Tamper-evident audit log.** Built in `PLAN-audit-logging-and-compliance.md` PR B
(hash chain, verification, retention, forwarding). Kept here for reference:

- Add `prev_hash` and `hash` columns to `event_logs` and `guardrail_events`. Each row's
  hash covers its content and the previous row's hash, so an edit or deletion breaks the
  chain.
- `GET /system/event-logs/verify` checks the chain and reports where it breaks.
- `DELETE /system/event-logs` is turned off in HIPAA mode. Old rows are removed only by
  the retention job, which records a checkpoint hash. Outside HIPAA mode, the delete
  checks its result and returns 500 on failure instead of logging a "cleared" marker
  (SMF-28).
- Forwarding to a store admins can't edit: syslog, a webhook, or a cloud logging service
  set to write once. `AUDIT_FORWARD_URL` and `AUDIT_FORWARD_FORMAT` (`json`, `cef`).
  Failed sends are queued and retried.

**7. Deletion that reaches every copy.**

- New `server/utils/dataDeletion/index.js` with `forUser`, `forWorkspace`, `forDocument`
  and `forThread`.
- What each removes: chats, threads, embed chats, the document's JSON text, its vectors,
  the vector cache, parsed files, memories, generated files, push subscriptions, prompt
  history and system prompt variables.
- Order and checks follow audit issue 2. Today a document's database rows, vectors and
  files aren't kept in step: a sync can re-create vectors for a removed document (fixed in
  `659f4118`), the same document could be attached twice (fixed in `a2ae3994`), and
  several cases are still open (SMF-11, SMF-16 to SMF-19). `forDocument` and
  `forWorkspace` delete vectors before database rows, re-read the rows afterwards, and
  report any copy that survived, rather than assuming one delete reached every store.
- Audit rows are kept according to their own retention setting
  (`audit_retention_days`), since HIPAA documentation is often kept for six years.
- Each run writes a `data_deleted` event listing counts per store, and the admin UI
  shows that report.
- The retention job from the guardrails section calls the same functions, so scheduled
  and manual deletion behave the same.

**8. HIPAA mode.**

`HIPAA_MODE=true`, set only as an environment variable, so it can't be switched off from
the admin UI. On boot the app checks the configuration and shows any conflict on a
"Compliance status" page. Chats are refused with a clear message until each conflict is
fixed.

- **Vendor BAA register:** new table `vendor_baas` (`vendor`, `provider_keys` JSON,
  `signed_on`, `expires_on`, `recorded_by`, `notes`).
- **Providers:** an LLM, embedder, reranker, vector database, search provider, speech
  provider or image generator that sends data off the server must be in the register;
  others can't be selected. Local providers are always allowed.
- **Forced on:** multi-user mode, telemetry off, short sessions, idle timeout, and
  `COLLECTOR_ALLOW_ANY_IP` ignored. Start a HIPAA install in multi-user mode from the
  first boot rather than converting a single-user one: `POST /system/enable-multi-user`
  is open to anyone on an instance without a password (F-07), and its failure path
  deletes every user (SMF-09, audit issue 3).
- **Scheduled jobs:** in single-user mode they approve every tool call automatically
  (`run-scheduled-job.js:77-83`). HIPAA mode forces multi-user, where jobs run as their
  owner and only pre-approved tools run unattended (see "Scheduled jobs in multi-user
  mode"). Push notifications carry no reply text.
- **Memory extraction** can mark chats as processed after a failed extraction (SMF-22),
  so memories don't match the chats they came from. This is one more reason it's off by
  default in HIPAA mode.
- **Turned off:** Telegram, Community Hub, imported agent plugins, the experimental
  features toggle, and memory extraction unless `HIPAA_ALLOW_MEMORIES=true`.
- **Restricted:**
  - Web push sends only a title, never job output.
  - The embed widget is off unless a workspace is marked as not holding PHI.
  - MCP identity forwarding is off unless that server is in the register.
  - Agent flows' HTTP blocks may only call hosts on an allowlist.
- **Defaults:** guardrail input checks on, with PII and secret rules on `log`, so admins
  can tune them before switching to `block`.

**9. Log settings changes.** Built in `PLAN-audit-logging-and-compliance.md` PR A
(`settings.changed`, `vendor.changed`). Kept here for reference:

- Wrap `updateENV` and the `SystemSettings` update functions so every change writes a
  `settings_changed` event with the user, the key, and the old and new values. Secrets
  are masked to their last 4 characters.
- Log what was actually applied. Today a request can be applied in part (SMF-10), and
  `_updateSettings` runs its upserts with `Promise.all` and no transaction. Until audit
  issue 4 lands, the event must list the keys that were applied and the key that failed,
  not the request body.
- Changes to the LLM, embedder, vector database and speech providers also show on the
  Compliance status page as "data now flows to X".

### Platform fixes from the repo map

The findings below come from the review's "Added to the plan as Platform fixes" table. They don't
fit a feature section, so they're listed here and each is placed in an existing PR under
"Delivery". IDs are from `docs/repo-map/09-findings-register.md`.

**High:**

1. **Extension key list leaks password hashes (F-02).** `models/browserExtensionApiKey.js`
   (`:124`, `:157`) includes the owner's full user row. Select only `id`, `username` and
   `role`, and add a test that no listing returns `password` or push configuration.
2. **Collector internal-address block can be switched off from a browser (F-32, F-33).**
   - `forwardExtensionRequest` (`server/utils/collectorApi/index.js:265`) drops
     `options.runtimeSettings` from the body before signing it. Its callers are the
     `/ext/*` routes (`server/endpoints/extensions/index.js`), which pass the browser's
     body, and `jobs/sync-watched-documents.js:58`, which doesn't set `runtimeSettings`, so
     nothing legitimate is lost.
   - The collector applies `runtimeSettings` per request, not to the process-wide
     singleton (`collector/middleware/verifyIntegrity.js:9,26`).
   - The guard resolves the hostname, rejects private, loopback, link-local and unspecified
     addresses (IPv4 and IPv6, including `127.0.0.1` and `0.0.0.0`), and re-checks after
     every redirect and for Puppeteer navigations.
3. **Any API key can add an MCP server that runs a host command (F-26).**
   `/v1/mcp-servers/*` takes `apiKeyRoleValid([admin])` from "Scoped API keys"; legacy
   keys lose access at the cut-off. In HIPAA mode, adding or changing a local (stdio)
   server through the API is refused.

**Medium:**

4. **Collector channel (F-34).** Stop sending `openAiKey` and the Whisper key with every
   request; the collector reads them from its own environment or gets them encrypted with
   the existing `EncryptionManager` payload. Add a timestamp and nonce to the signature and
   reject replays within a 5-minute window.
5. **Connector tokens copied into documents and vectors (F-35).** Keep the token only in
   `chunkSource`, encrypted. Strip it from document JSON, `workspace_documents.metadata`,
   vector metadata and the vector cache. A migration rewrites existing copies; vector rows
   are re-written on the next sync, or by a one-off re-embed the admin starts.
6. **System prompt variables are global (F-18).** Scope user variables by `userId`; the API
   helper expands only the caller's slash presets.
7. **Generated files (F-19).** Authorize downloads by chat owner (admins through the
   access-logging rules in Compliance hardening item 5), and resolve `/img` names inside
   the owner's folder only.
8. **Simple SSO open redirect (F-11).** `frontend/src/pages/Login/SSO/simple.jsx` follows
   `redirectTo` only when it is a same-origin path. Google sign-in reuses this page, so this
   lands with or before it.
9. **Outlook OAuth (F-30).** Add a signed `state`, and take the redirect URI from
   configuration rather than `X-Forwarded-*` headers.
10. **Memory contents in the worker log (F-41).** Log counts and ids, never memory text.
11. **Settings writer (F-46, F-48).** `dumpENV` keeps variables it doesn't know and quotes
    values instead of cutting them; `POST /system/custom-models` stops writing submitted
    keys into `process.env`. Both are part of audit issue 4.
12. **Manager chat hard-delete (F-15).** Bulk delete (id `-1`) becomes admin-only, and every
    chat delete writes a `chats_deleted` event with the count.

**Low:**

13. **Web search fallback (F-31).** With no search provider set, web browsing fails with a
    clear message instead of falling back to You.com or DuckDuckGo.
14. **Event log details (F-55).** Log the acting user on `user_updated`, and store a hash of
    the invite code in `invite_created`.

### Admin UI (frontend)

- Login page (`frontend/src/pages/Login/`): a "Sign in with Google" button when OIDC is
  enabled, and the password form hidden when `OIDC_ONLY` is set (except on an admin-only
  link). The system endpoint the login page already calls exposes these two flags.
- Security settings: an OIDC section for the configuration above.
- Users page: a "Google email" field for invite-only linking, and the linked identity
  shown on each user, with an "Unlink" action.
- Guardrails: a profiles page (rules editor with a "test this text" box), a profile
  picker on policies and workspaces, the event review page, alert settings, retention,
  acceptable-use text and the system prompt prefix.
- Chat UI: show a block message, and a notice when part of a message was redacted.
- Compliance status page: HIPAA mode state, configuration conflicts, the vendor BAA
  register, where data flows, audit chain check, and the last deletion reports.
- Users page: active sessions with "sign out" per session and "sign out everywhere",
  lockout status with "unlock", and the `auditor` role.

- New page `frontend/src/pages/GeneralSettings/AccessPolicies/`, modeled on
  `ModelRouters/`: list, create and edit policies. The model picker reuses the existing
  provider and model listing used by `LLMPreference`. Admin only.
- The policy editor gets an "Agent tools" section: allow and deny pickers listing the
  installed skills, flows, imported plugins, MCP servers and MCP tools by display name,
  so nobody types `@@flow_<uuid>` by hand.
- The agent skills settings page gets a "Role defaults" section that edits
  `agent_tool_role_policy` with the same pickers.
- `frontend/src/pages/Admin/Users/` (`UserRow`, `NewUserModal`): add a policy dropdown.
- `frontend/src/pages/GeneralSettings/ApiKeys/`: add owner, workspace scope and expiry
  fields, and show them in the list.
- Chat UI: show the new "model not allowed" and "agents disabled for your account"
  errors the same way the daily-limit error is shown today.
- Add a sidebar entry and route guard for the new page next to Model Routers.
- New page `frontend/src/pages/GeneralSettings/Teams/`: list teams; create, rename and
  delete them (admin); pick the team's policy and Google Group (admin). Members and leads
  are managed on the same page by admins and by that team's leads, with an "add existing
  user" picker limited to `default`-role users with no team.
- Users page: a team column and a team picker (admin).
- Workspace settings: an "Owning team" field (admin), and team leads see the members tab
  for their team's workspaces.
- Agent skills page: a "Teams" picker on each skill, flow and MCP server, writing the team
  policies' allow lists (admin).
- Slash command and prompt variable editors: a "Share with my team" toggle.
- Sidebar: team workspaces grouped under the team name.
- Scheduled jobs page (`frontend/src/pages/GeneralSettings/ScheduledJobs/`): available in multi-user mode, showing the caller's own jobs (a team or all
  tab for leads and admins), a workspace picker, an "Approvals" panel listing tools that
  need approval with who approved them, and refused tool calls in each run's detail.
- The frontend gates on the role string in `localStorage` (F-13), so every lead action
  must be enforced by `teamRoleValid` on the server; the UI only hides controls.

### Phase 2 (separate PR, optional): usage budgets

- New `usage_events` table (`user_id`, `api_key_id`, `workspace_id`, `provider`,
  `model`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `createdAt`), written next to
  each `addChatCostToMetrics` call (`stream.js`, `apiChatHandler.js`,
  `openaiCompatible.js`, `telegramBot/chat/stream.js`) and in the agent path.
- Policy columns `daily_token_limit Int?` and `monthly_cost_limit Float?`, checked next
  to `User.canSendChat` at its 5 call sites.
- A per-user usage view in the admin UI.

Phase 2 needs a ledger because cost is stored today inside the JSON string in
`workspace_chats.response`, and that can't be summed efficiently in SQL.

## Delivery

**Prerequisites from the state-machine audit.** The features in this plan build on
account, settings and router state machines that have reachable bad states. These audit
issues (file 12, section 12) land before, or as the first commits of, the PR that needs
them:

| Audit issue | Needed by | Status |
|---|---|---|
| 1. Single-use claims for credentials (SMF-01, SMF-06 fixed; SMF-32, SMF-35 open) | Google sign-in (token swap), agent websocket check | 01 and 06 fixed on `claude/state-machine-audit-23070d`, not merged |
| 3. Safe enable-multi-user (SMF-09) | HIPAA mode, any conversion of an existing install | Waits on open decision 23 |
| 4. Validate settings before applying any (SMF-10, SMF-29) | Settings logging; any setting stored through `updateENV` | Waits on open decision 22 |
| 5. Router delete and rule scoping (SMF-12) | Policy `router_id` | Waits on open decision 21 |
| 9. Last admin, invites, recovery (SMF-13, 14, 15, 31) | Google sign-in (invite-only, `OIDC_ONLY` fallback) | Open, no decision needed |
| 10. Report failures (SMF-28, 31) | Guardrail audit, tamper-evident log | Open, no decision needed |
| 11. Frontend auth guards (SMF-30) | Guardrail `hold` mode, cookie sessions | Open, no decision needed |

The audit branch has 8 fixes waiting for review as one PR. Merging it first avoids
conflicts with the repo map, which both branches add.

One PR for phase 1, built as committed subsets in this order:

1. Migration, `AccessPolicy` model, `accessPolicy` utils, and their unit tests.
2. Enforcement in `resolveProviderConnector` and the agent paths, the agent websocket
   user check, the mobile device user, and router delete and rule scoping (audit issue
   5), with tests.
3. Agent skill and MCP restrictions: `agentTools` module, filtering in both agent
   handlers, the attach-step check, and filtered UI lists, with tests.
4. Scoped API keys: middleware, endpoint changes, passing `user` through, ignoring a body
   `userId` for owned keys, the legacy key cut-off, and admin-only `/v1/mcp-servers`
   (platform fix 3), with tests.
5. Admin endpoints for policy CRUD and the role-default setting (admin only,
   `flexUserRoleValid([ROLES.admin])`).
6. Frontend pages and fields.
7. Documentation: the Swagger descriptions for the changed key endpoints, and a short
   admin guide that covers tool rules and `anythingllm.allowedRoles`.

**Teams** (proposed: in the access policy PR after step 5, open decision 32), built in this
order:

1. Migration for `teams`, `team_members` and the `team_id` columns; the `Team` model with
   the one-lead-left guard and the transactional delete; unit tests.
2. Team step in `getPolicyForUser` and the tool rule order; team workspaces in
   `getWithUser` and `whereWithUser`; tests.
3. `teamRoleValid` and the lead endpoints (members, leads, team workspaces), with event
   logs; tests.
4. Shared presets and variables (after platform fix 6), and per-team skill sharing on the
   agent skills page.
5. Frontend: Teams page, team fields on users and workspaces, sharing toggles, sidebar
   grouping.
6. Documentation: setting up teams, what leads can and can't do, and how to share a
   skill with one team.

**Scheduled jobs in multi-user mode as their own PR** (proposed, open decision 33), after
the access policy PR, since it needs policies, teams and the tool filter. It also needs
the audit branch's SMF-05 fix. Built in this order:

1. Migration for the new `scheduled_jobs` and `scheduled_job_runs` columns; ownership,
   and the single-user to multi-user migration of existing jobs; tests.
2. Routes with owner, lead and admin checks; the approval endpoint; policy limits.
3. Runner: run as the owner in the workspace, run-time tool filtering, `approved_tools`
   in place of automatic approval, refusals recorded; the run watchdog (SMF-24) and one
   running run per job (SMF-36).
4. The create-scheduled-job skill: owner and workspace, never approvals.
5. Frontend: jobs page per user, approval panel for owners, leads and admins, team view.
6. Audit events, deletion hooks and the HIPAA-mode push payload.

Teams need policies (steps 1–2 of the access policy PR) and scoped API keys for the API
path. Google Group sync is a later follow-up and isn't in this PR.

Step 3 doesn't depend on step 4, so it could ship as its own PR if you'd rather keep the
change smaller (open decision 5).

**Google sign-in as its own PR** (proposed, open decision 7). It touches different files
from the access policy work, and it can merge before or after it. The one link between
them is `OIDC_DEFAULT_POLICY_ID`, which is added once policies exist. Steps:

0. Audit issue 9: last-active-admin guard on suspend, delete and demote; atomic invite
   claim; recovery-code fixes; wrapping `TemporaryAuthToken.issue` in a transaction
   (SMF-32); and the `/sso/simple` same-origin redirect (platform fix 8).
1. Migration for `user_identities`, the `oidc` utils with ID token verification, the
   OIDC settings in `system_settings`, and unit tests.
2. The start and callback endpoints, user lookup and provisioning, event logs, and tests.
3. Shorter session expiry for OIDC sessions, `OIDC_ONLY`, and the admin password fallback.
4. Frontend: login button, Security settings section, Users page fields.
5. Documentation: setting up the Google Cloud OAuth client, the redirect URI, and the
   domain restriction.

**Guardrails as their own PR** (proposed, open decision 11), built in this order:

1. `guardrail_events` table with its own failing write path, audit issue 10 (report
   failed deletes), local rules (keyword, regex, PII, secret) with block and redact,
   input checks in all chat paths, and tests.
2. The tool whitelist fix (admin-only, `allow_self_approval`, `require_tool_approval`)
   and owner-based whitelists for API agents.
3. `guardrail_profiles`, attaching them to policies and workspaces, and the moderation
   checker interface with `ollama-guard` and `model-armor` first.
4. Output checks (`after` first, then audit issue 11, then `hold` and `chunked`), and
   tool output checks.
5. Review page, alerts, retention job, acceptable-use acceptance, system prompt prefix.
6. Documentation: writing rules, choosing a checker, what each output mode costs.

Steps 1 and 2 don't need the access policy PR. Attaching profiles to policies and
per-owner API agent whitelists do, so if guardrails merge first, those pieces wait.

**Compliance hardening as its own PR** (proposed, open decision 16), built in this order:

0. Platform fixes 1 and 2 (password hashes in key listings, collector internal-address
   block). These are the most urgent items in the plan and touch nothing else here, so
   they go first. If you'd rather not wait for this PR, they can ship alone (open
   decision 26).
1. Audit issue 4 (validate settings before applying any, atomic `.env` write) with
   platform fix 11, then the `auditor` role and platform fix 12. Settings change
   logging, access logging and platform fix 14 move to the audit plan's PR A.
2. Login rate limiting and lockout; narrowed CORS.
3. Credential encryption with `STORAGE_ENCRYPTION_KEY`, and the migration of existing
   values; the collector channel and connector-token copies (platform fixes 4 and 5); the
   Outlook OAuth `state` (platform fix 9). Then data exposure between users: per-user
   prompt variables, generated files by owner, no memory text in logs, and no web search
   fallback (platform fixes 6, 7, 10 and 13).
4. `dataDeletion` and the deletion reports.
5. (Moved to the audit plan's PR B: tamper-evident hashes, the verify endpoint and
   forwarding.)
6. Audit issue 3 (safe enable-multi-user), then HIPAA mode, the vendor BAA register, and
   the Compliance status page.
7. Sessions: `user_sessions`, idle timeout, revocation, and the move to an `HttpOnly`
   cookie.

Step 7 changes how every browser request authenticates, so it carries the most risk of
breaking something. It's last so the other steps aren't held up, and it could be a
separate PR (open decision 17). HIPAA mode needs the access policy and guardrails PRs for
its tool and guardrail defaults; if it merges first, those defaults are added later.

That gives six PRs in all: access policies (with teams by default), Google sign-in,
scheduled jobs in multi-user mode, guardrails, compliance hardening, and optional
budgets. Splitting out sessions or teams adds one each. None are stacked
on each other. The audit PR (`claude/state-machine-audit-23070d`) is separate and should
merge first; the open audit issues land as the first commits of the PR that needs them,
as listed above, so they don't add PRs.

Phase 2 (budgets) is a second, independent PR that can follow later.

## Tests

Existing suites to extend live in `server/__tests__/`:

- `models/accessPolicy.test.js` (new): validating `allowed_models`, wildcard matching,
  CRUD.
- `utils/accessPolicy/*.test.js` (new): `isModelAllowed` and `resolveAllowedSelection`,
  including empty lists, wildcards, a missing default, and a router that picks a model
  the policy doesn't allow.
- `utils/chats/apiChatHandler.test.js`, `utils/chats/openaiCompatible.test.js`: an owned
  key's chat is attributed to its user, a disallowed model is blocked or substituted, and
  a legacy key behaves as before.
- `utils/chats/agents.test.js`, `endpoints/agentWebsocket.test.js`: agents respect the
  model check and `allow_agents`; a websocket connection without a session, or with
  another user's session, is refused before the invocation is claimed.
- Mobile middleware test: a device runs as its own user under that user's policy; a
  device with `userId = null` in multi-user mode is refused.
- `api/workspaceThread` endpoint test: an owned key's chat is saved under the owner even
  when the body names another `userId`.
- `models/modelRouter.test.js`: deleting a router that is still bound follows decision 21;
  updating a rule under the wrong router id returns 404.
- `utils/accessPolicy/agentTools.test.js` (new): rule order (policy, then role, then
  none), allow versus deny, `parent#child`, `@@mcp_<server>` versus `<server>:<tool>`,
  `anythingllm.allowedRoles`, a user with no role entry, a request with no user.
- `utils/chats/agents.test.js`: a `default` user's web agent and API agent both get the
  same filtered tool list; a denied MCP tool is dropped after the server is split into
  tools; a tool from an MCP server whose client has closed isn't offered.
- `models/user.test.js`: `policy_id` can be updated and is validated.
- A new middleware test for `validApiKey` and `apiKeyRoleValid`: expired keys, suspended
  owners, a non-admin owner on admin routes, legacy keys before and after
  `LEGACY_API_KEYS_UNTIL`, a legacy key trying to create a key.

For teams (new `models/team.test.js`, `utils/middleware/teamProtected.test.js`, and
additions to the policy, tool filter and workspace tests):

- Policy order: user policy beats team policy beats role default beats none; removing a
  user from a team changes their policy on the next request.
- A member opens a team workspace with no `workspace_users` row; a non-member gets 404;
  admins see everything; managers follow decision 29.
- A lead adds and removes members of their own team, and gets 403 on another team, on
  role or policy changes, and on moving a workspace between teams.
- The last lead of a team with members can't be removed or demoted, including two
  concurrent removals (in-memory Prisma fake with real `updateMany` counts).
- A skill shared with team A is offered to A's members in the web agent, the API agent
  and Telegram, and not to team B.
- A shared preset is visible to the team and editable only by its owner, a lead or an
  admin; a personal preset with the same command wins for its owner.
- Deleting a team runs in one transaction, and leaves members on their fallback policy
  and workspaces admin-only.
- Every lead action writes an event with the actor and team.

For scheduled jobs in multi-user mode (additions to `jobs/run-scheduled-job` and
`endpoints/scheduledJobs` tests, with the agent and LLM faked):

- A run uses the owner's workspace, model and filtered tools; a tool the owner's policy
  denies isn't loaded even if the job lists it.
- A side-effecting tool not in `approved_tools` is refused and recorded, never approved;
  an approved one runs.
- Editing the prompt, workspace or tools clears `approved_tools`.
- The create-scheduled-job skill can't set approvals, even when the prompt asks it to.
- A suspended owner, an owner removed from the workspace, or a policy with agents off
  makes the run fail with the right status and no tool call.
- A user can't see or edit another user's jobs; a lead sees their team's; an admin sees
  all.
- `max_scheduled_jobs` and `min_job_interval_minutes` are enforced, including two
  concurrent creates.
- Switching to multi-user assigns existing jobs to the first admin, disabled with no
  approvals.
- In HIPAA mode the push payload has no reply text.
- Two concurrent starts of one job leave one running run.

For Google sign-in (new `utils/auth/oidc.test.js` and an endpoint test, with Google's
token endpoint and keys mocked):

- ID token checks reject a wrong `aud`, a wrong `iss`, an expired token, a bad `nonce`,
  `email_verified: false`, and a domain outside `OIDC_ALLOWED_DOMAINS`.
- The callback rejects a missing or mismatched `state`.
- A known `sub` signs in; an unknown `sub` is refused in invite-only mode and creates a
  user with the default role and policy in automatic mode.
- A suspended user is refused.
- An OIDC session expires after `OIDC_SESSION_EXPIRY`.
- With `OIDC_ONLY`, password login fails for non-admins and still works for admins.
- Two callbacks claiming the same invite at once create exactly one user (use the
  in-memory Prisma fake with real `updateMany` counts from the audit's tests).
- Suspending, deleting or demoting the last active admin is refused, including two
  concurrent demotions of the last two admins.
- Saving OIDC settings with one invalid field changes nothing.

For guardrails (new `utils/guardrails/*.test.js`, plus additions to the chat handler
tests):

- Each local detector: true matches, near misses (a 16-digit number that fails the card
  checksum), and redaction output.
- Profile resolution: policy only, workspace only, both (stricter wins), the system
  default, none.
- A blocked input never reaches the LLM in each of the 5 channels, including agent chats.
- A redacted input is what the LLM receives and what is saved.
- Output modes: `after` flags the saved chat; `hold` never streams a blocked reply;
  `chunked` stops the stream at the blocked sentence.
- A checker outage follows `on_checker_error`.
- A `default` user can't add to the tool whitelist unless `allow_self_approval` is set.
- Retention deletes only rows older than the setting.
- A failed `guardrail_events` write still blocks in `block` mode and is reported.
- Two concurrent whitelist adds both persist.

For compliance hardening:

- Credential encryption: values are unreadable in the database, decrypt on read, the
  migration is safe to run twice, and a missing key keeps today's behavior.
- Sessions: an idle session is refused after the timeout; a password change and "sign
  out everywhere" revoke sessions; an agent invocation older than its expiry can't be
  claimed; the cookie has `HttpOnly`, `Secure` and `SameSite=Strict`; a
  state-changing request without the CSRF header fails; mobile and extension tokens
  still work.
- Rate limiting and lockout: the 6th failure locks the account; the lock expires; an
  admin can unlock; a lockout survives a restart.
- CORS: an unlisted origin is refused; embed routes follow each embed's allowlist.
- Audit chain: editing or deleting a row is reported by the verify endpoint; the
  retention checkpoint keeps the chain valid.
- Deletion: `forUser` leaves no rows or files in any listed store, checked one by one,
  including a document attached to two workspaces and a document whose sync job runs
  during the delete.
- Settings: a request with a later invalid key changes nothing and runs no reset hook;
  the event log records what was applied.

For the platform fixes:

- No key listing (browser extension, API keys) returns `password` or push configuration.
- An `/ext/*` request carrying `options.runtimeSettings.allowAnyIp` is still refused for
  `127.0.0.1`, `0.0.0.0`, `[::1]`, a hostname that resolves to a private address, and a
  public URL that redirects to one; the collector's process-wide settings are unchanged
  afterwards.
- A replayed collector request is rejected; requests no longer carry provider keys in
  plain text.
- After the connector-token migration, no document JSON, metadata or vector row holds a
  token.
- One user's prompt variables and generated files aren't visible to another member of the
  same workspace.
- `/sso/simple?redirectTo=https://example.org` lands on the home page.
- A manager's bulk chat delete is refused; an admin's writes `chats_deleted`.
- The worker log never contains memory text.
- HIPAA mode: an unregistered cloud provider can't be selected and blocks chats if
  already set; each turned-off feature returns 403; telemetry doesn't start.
- Settings logging: secrets are masked; old and new values are recorded.

Before each PR, plant a bug in each enforcement point (for example, skip the check in the
agent path) and confirm a test fails.

## Acceptance criteria

1. Users without a policy, and legacy API keys before `LEGACY_API_KEYS_UNTIL`, behave
   exactly as before. The existing test suite passes unchanged.
2. A user whose policy allows only `openai/gpt-4o-mini` cannot get a response from any
   other model through the web chat, agent chat, `/v1/workspace/*/chat`, `/v1/openai/*`
   or Telegram.
3. A policy with `router_id` sends that user's chats through that router, and a routed
   model the policy doesn't allow is never called.
4. An API key owned by a `default` user gets 401 or 403 on admin API routes, and can only
   reach its owner's workspaces, narrowed further by `workspace_ids`.
5. Expired keys and keys owned by suspended users are rejected.
6. API chats made with an owned key appear in chat logs under the owner and count toward
   `dailyMessageLimit`.
7. With `agent_tool_role_policy` denying `@@mcp_github` for `default`, a `default` user
   is never offered and can't call any tool from that server, in the web agent, the API
   agent or Telegram. A user whose policy allows it does get it.
8. With no role defaults and no policy tool rules set, every user gets exactly the tools
   they get today.
9. A user can sign in with a Google account from an allowed domain and lands in
   AnythingLLM with the right role and policy. An account from any other domain is
   refused.
10. Once a user's Google identity is linked, changing their Google email doesn't break
    sign-in, and a different Google account with a reused email can't take it over.
11. With OIDC turned off, sign-in works exactly as before.
12. With a profile that blocks card numbers, a message containing a valid card number is
    refused in web, API, OpenAI-compatible, embed and Telegram chats, the LLM is never
    called, and a `guardrail_events` row records it without the full number.
13. With a redact rule, the LLM receives and the chat log stores the redacted text.
14. A `default` user can't stop approval prompts for side-effecting tools unless their
    policy allows it.
15. With no guardrail profiles configured, chats behave exactly as before.
16. With `HIPAA_MODE=true`, no feature marked High in the review can send data off the
    server to a vendor missing from the BAA register.
17. Stored credentials can't be read from a copy of the database without
    `STORAGE_ENCRYPTION_KEY`.
18. A browser session ends after the idle timeout, and the session token can't be read
    by page scripts.
19. Every view or export of another user's chats leaves an audit row, and any change to
    past audit rows is detected.
20. Deleting a user removes their data from every store listed in item 7.
21. With HIPAA mode off and no new settings, the app behaves as before, apart from login
    rate limiting and narrowed CORS, which are on for everyone.
22. A user's policy can't be used by anyone else: the agent websocket refuses a caller
    who isn't the invocation's user, a thread chat through an owned key can't name
    another user, and a mobile device runs as its own user.
23. After `LEGACY_API_KEYS_UNTIL`, a key with no owner gets 403 on every `/v1` route.
24. No sequence of suspend, delete or demote, run one at a time or at once, leaves a
    multi-user instance without an active admin.
25. One invite creates at most one account, whether claimed by password or by Google.
26. A policy's router can't be deleted out from under it without the outcome chosen in
    decision 21.
27. No API response contains a password hash.
28. Nothing a browser sends can make the collector fetch a private, loopback or
    link-local address.
29. Only an admin-owned API key or an admin session can add or change an MCP server.
30. Provider keys and connector tokens appear only where they're stored, encrypted, and
    never in collector requests, document files or vector rows.
31. A user added to a team gets the team's models, tools and workspaces on their next
    request, with no other change; a user with their own policy keeps it.
32. A skill shared with one team is never offered to users outside it, in any agent
    channel.
33. A team lead can manage their own team's members and workspaces and nothing else, and
    every lead action is in the event log.
34. With no teams created, every user, workspace, preset and tool behaves as before.
35. In multi-user mode, a scheduled job runs as its owner in its workspace, with the
    owner's model and tool rules, and stops running when the owner loses access.
36. No scheduled job in multi-user mode ever runs a side-effecting tool that a person
    didn't approve for that job, and an agent can't approve tools for a job.
37. Users see only their own jobs and runs, leads their team's, admins all.
38. Single-user installs keep today's scheduled job behavior.

## Risks

- **A bypass in a path not listed here.** Before step 2, search for every
  `getLLMProvider(` and `resolveProviderConnector(` caller again. The inventory used for
  this plan found 11 files. Also check every place that turns a request into a user: the
  repo map's path index (`docs/repo-map/10-path-index.md`) lists 241 entry paths, and
  three of them (thread API `userId`, agent websocket, mobile) were missed by the first
  version of this plan.
- **Races in the new state.** Policies, identities, invites and sessions are new state
  machines. The audit found most existing bugs in check-then-write code and in writes
  spread across several stores. Use conditional writes and transactions from the start,
  and test two concurrent calls for each claim or limit.
- **Team workspaces widen access.** Matching on `team_id` in `getWithUser` gives every
  member every team workspace. A workspace holding data only some members should see must
  stay out of the team (no `team_id`) and use direct membership. Say so in the Teams page
  and docs, and log `team_workspace_created`.
- **Three sources of a user's access** (own policy, team policy, role) can confuse admins.
  The Users page shows the effective policy and where it came from.
- **The audit branch and this branch both add `docs/repo-map/`.** Merge the audit PR
  first and drop this branch's untracked copy of the map.
- **Caching:** `utils/router` caches router config. A policy change has to invalidate the
  policy cache in the same way (see the recent fix "invalidate model router decisions
  after config edits", #7099).
- **Desktop single-user mode:** policies only apply in multi-user mode. Document this.
- **Tool names that change per install.** Flow uuids and hub ids differ between installs,
  and a rule can point at a tool that's since been deleted. Ignore unknown entries rather
  than failing, and flag them in the policy editor.
- **Locking everyone out.** A bad OIDC configuration combined with `OIDC_ONLY` would block
  all sign-ins. The admin password fallback covers this; document it prominently.
- **Removing someone at Google doesn't remove them here** until their session expires.
  The short OIDC session limits the gap; group sync or SCIM-style deprovisioning would
  close it.
- **False positives.** Broad PII or keyword rules will block legitimate work. Ship with
  `warn` or `log` as the suggested starting action, and use the review page to tune
  rules before switching to `block`.
- **Delay and cost of moderation services.** Each call to an outside checker adds a round
  trip and may cost money per request; `hold` mode also removes streaming. Local rules
  run first so a checker is only called when needed.
- **Sending chat text to a moderation service** is itself a data flow to review. For
  sensitive data, use local rules and `ollama-guard`.
- **Output checks in `after` mode don't prevent anything.** Workspaces that need
  prevention must use `hold` or `chunked`.
- **Moving sessions to a cookie** touches every authenticated request and the websocket;
  a mistake signs everyone out or opens a CSRF hole. Ship behind a setting and keep
  bearer tokens working during the switch.
- **Narrowing CORS by default** can break setups that call the API from another site.
  Mention it in the release notes with the setting that restores it.
- **Losing `STORAGE_ENCRYPTION_KEY`** makes the encrypted credentials unrecoverable.
  Document key backup, and let admins re-enter credentials.
- **HIPAA mode isn't compliance by itself.** It narrows what the software can do;
  policies, BAAs, hosting and training are still needed. Say so on the Compliance
  status page.
- **Reverse proxies.** The callback URL must match the Google OAuth client exactly. Set
  it with `OIDC_REDIRECT_URI` rather than working it out per request.
- **The frontend gates on role strings.** The new page needs the same admin-only guard as
  Model Routers.

## Open decisions

1. When a workspace's model isn't allowed for the user: substitute the policy default
   (proposed, with an error only when there's no default), or always reject?
2. May non-admin users mint their own scoped API keys, or only admins?
3. Should managers be able to assign policies (only policies that already exist), or
   admins only?
4. Phase 2 budgets: a follow-up PR (proposed), or folded into this one?
5. Agent skill and MCP restrictions: in this PR (proposed), or a PR of their own?
6. Should admins without a policy keep every tool (proposed), or also follow an `admin`
   role default?
7. Google sign-in: its own PR (proposed), or part of the access policy PR?
8. New Google users: invite-only (proposed), or created automatically for anyone in the
   allowed domains?
9. Should Google Groups decide team membership (and through it, policies)? That needs a
   Google Workspace service account with Directory API access, and is proposed as a
   follow-up; `teams.idp_group` is stored from the start.
10. Generic OIDC with Google as the first provider (proposed), or Google only?
11. Guardrails: their own PR (proposed), or part of the access policy PR?
12. Which moderation service first: local `ollama-guard` (proposed, keeps data in
    house), Google Model Armor, or another?
13. Default output mode: `after` (proposed), or `hold` for every workspace?
14. Chat retention: how many days, or keep forever (today's behavior)?
15. Should blocked messages alert admins immediately, or only appear on the review page?
16. Compliance hardening: its own PR (proposed), or split across the other PRs?
17. Sessions (cookie, idle timeout, revocation): part of the compliance PR (proposed), or
    a separate PR?
18. In HIPAA mode, should admins lose chat log access unless they also hold the `auditor`
    role (proposed)?
19. Should login rate limiting and narrowed CORS be on for every install (proposed), or
    only in HIPAA mode?
20. Idle timeout in HIPAA mode: 15 minutes (proposed), or another value?
21. Deleting a model router that a workspace, `MODEL_ROUTER_ID` or a policy still uses:
    refuse with the list of users (proposed), or unbind and fall back to the system
    provider? (Audit issue 5.)
22. Should `/system/update-env` be all-or-nothing (proposed), and should destructive
    resets (changing the embedder or vector database) need a confirmation? (Audit issue
    4.)
23. If turning on multi-user mode fails partway: roll back to single-user, deleting only
    the admin that request created (proposed), or stop half-way and let the admin retry?
    (Audit issue 3.)
24. Legacy API keys: cut off on a date with a warning period (proposed), refuse them as
    soon as policies ship, or keep them forever outside HIPAA mode?
25. Agent invocation expiry: how long an unused invocation UUID stays valid (proposed: 10
    minutes, the same as the SSO token).
26. Platform fixes 1 and 2 (password hashes in key listings, the collector's
    internal-address block): first commits of the compliance PR (proposed), or a small
    PR of their own that can merge sooner?
27. Connector tokens already copied into vector rows: re-write them on the next sync
    (proposed), or require a one-off re-embed before HIPAA mode can be turned on?
28. Teams per user: one team per user in v1 (proposed; policy resolution stays simple),
    or several teams, with workspace access from all of them and the policy from a
    chosen primary team?
29. Once teams exist, do managers keep instance-wide workspace and user access (proposed
    outside HIPAA mode), or are they limited to teams they lead?
30. When a team is deleted, its workspaces: become admin-only (proposed), stay visible to
    former members through `workspace_users` rows created at deletion, or are blocked
    from deletion while the team owns workspaces?
31. Can team leads read their team members' chats in team workspaces (with every view
    logged), or only admins and auditors (proposed in HIPAA mode)?
32. Teams: inside the access policy PR (proposed), or a PR of their own after it?
33. Scheduled jobs in multi-user mode: their own PR after access policies (proposed), or
    folded into the access policy PR?
34. Who approves unattended tools for a job: the owner when their policy allows
    self-approval, otherwise a lead or admin (proposed); or always an admin?
35. Default job limits per policy: 5 jobs and a 60-minute minimum interval (proposed), or
    other values?
36. Single-user jobs on switching to multi-user: assigned to the first admin and disabled
    until reviewed (proposed), or deleted?

## Considered and left out

- **User-aware router rules** (adding `userRole`/`userId` to `VALID_PROPERTIES`). This is
  redundant once a policy can carry its own `router_id`, and it only works when the
  provider is `anythingllm-router`.
- **Roles per workspace** (a role column on `workspace_users`). Useful, but separate from
  model access. Team leads cover the common case of someone managing a group's
  workspaces.
- **Installing skills per team.** Skills, flows and plugins stay installed once for the
  instance and are shared with teams through policy allow lists. Per-team install folders
  would mean loading third-party code per team, with no benefit for access control.
- **Nested teams.** Teams are flat; a department with sub-teams uses separate teams and
  policies.
- **Tool rules per workspace.** Rules attach to users and roles, not workspaces. Could be
  added later as a third source in the rule order.
- **SAML.** Google Workspace also supports SAML, but OIDC is simpler and fits the existing
  token flow.
- **Google sign-in for the developer API.** API clients keep using scoped API keys;
  accepting Google access tokens on `/v1/*` is out of scope.
- **Checking documents at upload time.** Guardrails check text when it's used in a chat,
  not when a document is added to a workspace. Upload-time scanning could reuse the same
  rules later.
- **Training or fine-tuning a custom classifier.** Rules plus an off-the-shelf checker
  first; revisit if false positives stay high.
- **Encrypting the database, documents and vectors inside the app.** SQLite and LanceDB
  files are better protected by disk or volume encryption. App-level encryption would
  touch every query and vector search; revisit only if disk encryption isn't available.
- **MFA inside AnythingLLM.** Google sign-in provides MFA through Google; password users
  keep single-factor sign-in, and HIPAA mode can require OIDC instead.
- **Frontend XSS review, dependency audit, and Docker image hardening.** Listed as gaps
  in the review; worth a separate security pass.
- **Starting MCP servers per user.** Servers stay shared across the instance; only which
  users are offered their tools changes.
