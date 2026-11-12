# Plan: complete audit logging and HIPAA compliance verification

Status: draft, not started. Nothing in this plan has been built.

This plan has two parts:

1. **Audit logging that covers everything:** one event format, a catalogue of every
   event the app must record, a writer that can't silently drop rows, and checks that new
   code can't skip it.
2. **Compliance verification:** a control matrix that maps each HIPAA requirement the
   software can help with to a control, the code or setting that provides it, the
   evidence, and an automated check. The checks run in CI and on a live instance, so
   compliance can be shown on demand.

Two other documents feed this plan:

- **`PLAN-per-account-model-access.md`** (the "main plan") builds the features this plan
  audits: access policies, teams, Google sign-in, scheduled jobs, guardrails, and
  compliance hardening. This plan takes over the logging parts of its compliance items 5
  (access logging), 6 (tamper-evident log) and 9 (settings change logging). The main plan
  keeps the controls themselves.
- **`REVIEW-features-and-hipaa-risks.md`** and `docs/repo-map/` (findings `F-NN`,
  state-machine findings `SMF-NN`) are the evidence base.

This is an engineering plan, not legal advice. HIPAA compliance also depends on hosting,
business associate agreements (BAAs), written policies, risk analysis, training and
incident response, which software can support but not provide. Section 6 lists what stays
outside the code.

## 1. Where audit logging stands today

Read from the code at `e82a80da`.

- **One table, `event_logs`:** `event`, `metadata` (JSON text), `userId`, `occurredAt`
  (`server/prisma/schema.prisma`). There's no actor type, target, outcome, IP address,
  user agent, request id or channel.
- **About 50 event names, written from 67 call sites.** Coverage is uneven:
  - the endpoint files have 194 state-changing routes (POST, PUT, PATCH, DELETE) and 59
    `logEvent` calls;
  - 20 endpoint files with state-changing routes log nothing, among them
    `modelRouter.js`, `scheduledJobs.js`, `api/mcpServers`, `mcpServers.js`, `memory.js`,
    `browserExtension.js`, `mobile`, `agentFlows.js`, `extensions` and
    `agentSkillWhitelist.js`;
  - nothing outside HTTP routes is audited: the agent websocket, background jobs, the
    Telegram bot loop, boot, and the collector.
- **Nothing logs reads.** Opening another user's chats, a workspace, a document or
  memories leaves no record.
- **Write failures disappear.** `EventLogs.logEvent` catches and drops errors
  (`server/models/eventLogs.js:4-23`).
- **Admins can delete the whole log** (`DELETE /system/event-logs`,
  `server/endpoints/system.js:1171-1186`). That route logs a "cleared" marker even when
  the delete failed (SMF-28, F-54).
- **Wrong or sensitive details:**
  - `user_updated` records the target user, not the actor (F-55);
  - `invite_created` stores the invite code in plain text (F-55);
  - `POST /admin/system-preferences` logs nothing and always reports success (F-51).
- **No retention, no export, no forwarding.** Rows live in the same SQLite file admins
  control.
- **Application logs** go through Winston to the console only (`server/utils/logger`), with
  no request access log. Memory extraction writes memory text to the worker log (F-41),
  which puts PHI in logs.

## 2. Requirements

HIPAA references are to 45 CFR. "Software" means what this codebase can provide; the rest
is in section 6.

| ID | Requirement | Source | What the software must do |
|---|---|---|---|
| R1 | Audit controls | §164.312(b) | Record activity in systems that hold ePHI: who did what to which record, when, from where, and whether it succeeded |
| R2 | Information system activity review | §164.308(a)(1)(ii)(D) | Make the records reviewable: search, filters, reports, alerts |
| R3 | Log-in monitoring | §164.308(a)(5)(ii)(C) | Record and alert on sign-in attempts, failures and lockouts |
| R4 | Integrity | §164.312(c)(1), (c)(2) | Detect changes to ePHI and to the audit trail itself |
| R5 | Person or entity authentication | §164.312(d) | Every action is tied to an authenticated person, key or service identity |
| R6 | Unique user identification | §164.312(a)(2)(i) | No shared identities; API keys and devices tied to an owner |
| R7 | Automatic logoff | §164.312(a)(2)(iii) | Idle timeout and session revocation |
| R8 | Encryption | §164.312(a)(2)(iv), (e)(2)(ii) | Encrypt stored credentials; transport encryption documented |
| R9 | Access control and minimum necessary | §164.312(a)(1), §164.502(b), §164.514(d) | Access by role, team and policy; access to others' data limited and logged |
| R10 | Documentation retention | §164.316(b)(2) | Keep audit and compliance records 6 years |
| R11 | Disclosures to vendors | §164.502(e), §164.504(e), §164.528 | Know which vendor received ePHI and when; allow only vendors with a BAA |
| R12 | Contingency support | §164.308(a)(7) | Backups and restore are possible and documented; audit records survive |
| R13 | Breach assessment | §164.402-414 | Enough records to work out what was accessed or sent, by whom, during an incident |
| R14 | Security incident procedures | §164.308(a)(6) | Alerts for suspicious activity, and an export for investigation |

## 3. Audit events: format, writer and storage

### 3.1 Event format

A new table, `audit_events`, replaces `event_logs` for new writes. `event_logs` stays
readable, and a migration copies its rows in, with `actor_type: unknown` where the actor
can't be told apart.

| column | type | meaning |
|---|---|---|
| `id` | Int PK | |
| `occurred_at` | DateTime | server time, UTC |
| `action` | String | from the catalogue, `area.verb` (e.g. `chat.viewed`, `policy.updated`) |
| `outcome` | String | `success`, `denied`, `failed` |
| `reason` | String? | short code for `denied` or `failed` (e.g. `policy_model_not_allowed`) |
| `actor_type` | String | `user`, `api_key`, `system`, `job`, `telegram_chat`, `embed_session`, `mobile_device`, `extension_key`, `oidc` |
| `actor_id` | String? | user id, key id, job id, device id |
| `on_behalf_of` | Int? | the user a key, device, job or session acts for |
| `team_id`, `workspace_id` | Int? | for filtering and team views |
| `target_type`, `target_id` | String? | the record acted on |
| `channel` | String | `ui`, `api`, `openai`, `embed`, `telegram`, `mobile`, `extension`, `ws`, `job`, `boot` |
| `ip`, `user_agent` | String? | from the request, after the trusted-proxy setting is applied |
| `request_id` | String? | one id per request, also written to application logs |
| `metadata` | String (JSON) | details, with no PHI and no secrets (3.4) |
| `prev_hash`, `hash` | String | hash chain (3.5) |

### 3.2 Writer

New module `server/utils/audit/index.js`:

- `audit.record(event, { tx })` validates `action` against the catalogue and strips
  fields that aren't allowed in `metadata`.
  - With `tx`, it writes inside the caller's Prisma transaction, so the change and its
    record commit together. This is required for policy, role, team, key, approval and
    deletion changes.
  - Without `tx`, it appends to a durable outbox: a file under `storage/audit-outbox/`,
    synced to disk, then inserted by a flusher.
  - Failures **throw** for the events listed as `must_record` in the catalogue. The
    request then fails rather than happening unrecorded. Other failures increment a
    counter shown on the Compliance status page.
- **Request context:** a middleware sets `response.locals.audit` with actor, channel, IP,
  user agent and `request_id`, so handlers pass only the action, target and outcome.
- **Denials are recorded as well as successes:**
  - the role, policy, team, key-scope and lead checks in the main plan call
    `audit.record` with `outcome: denied` before returning 401, 403 or 404;
  - `validatedRequest` records `session.rejected`, with the reason (expired, suspended,
    revoked);
  - repeated denials are rate-limited per actor, so a loop can't flood the table.
- `EventLogs.logEvent` becomes a thin wrapper over `audit.record` until every caller is
  moved, then it's removed.

### 3.3 Storage, retention and export

- **Retention:** `audit_retention_days`, default 2190 (six years), and never below 2190
  in HIPAA mode. A background job deletes older rows in batches. Each batch writes a
  checkpoint row with the hash of the last row it removed, so the chain stays
  verifiable.
- **No delete route.** `DELETE /system/event-logs` is removed. The UI clear button goes,
  and an admin can only export.
- **Export:**
  - `GET /audit/export?from&to&format=jsonl|csv`, for admins and auditors;
  - it streams in pages and signs the file with an HMAC key from
    `AUDIT_EXPORT_SIGNING_KEY`;
  - every export writes `audit.exported` with filters and row count.
- **Forwarding:**
  - `AUDIT_FORWARD_URL` and `AUDIT_FORWARD_FORMAT` (`jsonl`, `cef`, `syslog`) send each row
    to a store admins can't edit (a SIEM, or write-once cloud logging);
  - failed sends queue in the outbox and retry with backoff;
  - the backlog shows on the Compliance status page.
  - In HIPAA mode, forwarding is required; without it the status page shows a conflict.
- **Backups:** the restore guide says that a restore older than the last forwarded row
  leaves a gap, and how to re-import from the forward store.

### 3.4 What may go in an audit row

- **Never in a row:** chat or prompt text, document text, memory text, file contents,
  passwords, tokens, API keys, invite codes, recovery codes, or OAuth codes.
- **Allowed:**
  - ids, counts and names of workspaces and documents;
  - model and provider names;
  - tool names and outcomes;
  - hashes (`sha256` of a value, e.g. an invite code or document checksum);
  - the length of a message.
- The writer enforces this with an allow-list of metadata keys per action; unknown keys
  are dropped and counted.
- **Application logs:**
  - a log scrubber removes the same classes of value from Winston output;
  - the memory extraction log (F-41) and any `console.log` of request bodies are fixed;
  - a CI test greps for logging of known sensitive variables.

### 3.5 Integrity

- **Hash chain:** `hash = sha256(prev_hash || canonical_json(row without hash))`, computed
  in the writer inside a transaction that reads the previous hash. SQLite runs one writer
  at a time, so the chain stays ordered. With Postgres, use an advisory lock.
- **Verification:** `GET /audit/verify` walks the chain from the last checkpoint and
  reports the first broken link. A daily job runs it and writes `audit.verified` or
  `audit.chain_broken`, which raises an alert.
- The forward store holds an independent copy, so an edit to the database is visible by
  comparing the two.

## 4. Event catalogue

Every action the app must record, by area. "Today" says whether an event exists now
(`yes`), exists but needs fixing (`fix`), or is new (`new`). "Must" marks `must_record`
events, which fail the request if they can't be written. "Source" is the PR that adds the
behavior being audited: this plan's PR A (section 7), or a main-plan PR (AP = access
policies and teams, GS = Google sign-in, SJ = scheduled jobs, GR = guardrails, CH =
compliance hardening).

### 4.1 Sign-in and sessions

| Action | Trigger | Today | Must | Source |
|---|---|---|---|---|
| `auth.login_succeeded` | password, Simple SSO or Google sign-in | yes (`login_event`) | | A |
| `auth.login_failed` | bad password, unknown user, suspended, bad SSO token, Google token rejected (with reason) | yes, partly | | A, GS |
| `auth.locked_out`, `auth.unlocked` | lockout after failures; admin unlock | new | yes | CH |
| `auth.rate_limited` | login rate limit hit | new | | CH |
| `session.created`, `session.revoked`, `session.expired_idle` | session lifecycle | new | yes (revoked) | CH |
| `session.rejected` | expired, suspended, revoked or unknown token on any request | new | | A |
| `auth.password_changed`, `auth.password_reset` | own change; reset through recovery | new | yes | A |
| `auth.recovery_codes_issued`, `auth.recovery_used` | codes shown; codes used to get a reset token | new | yes (used) | A |
| `auth.sso_token_issued` | `POST /v1/users/:id/issue-auth-token` | new | yes | A |
| `auth.oidc_linked`, `auth.oidc_unlinked`, `auth.oidc_user_provisioned` | Google identity events | new | yes | GS |
| `auth.ws_rejected` | agent websocket without a valid session or for another user | new | | AP |

### 4.2 Accounts, roles, teams and policies

| Action | Trigger | Today | Must | Source |
|---|---|---|---|---|
| `user.created`, `user.deleted` | admin, manager, API, invite claim, Google provisioning | yes | yes | A |
| `user.updated` | any field change, with field names and old/new for role, suspension, policy and limits; actor recorded correctly (F-55) | fix | yes | A |
| `user.suspended`, `user.unsuspended`, `user.role_changed` | split out of `user.updated` for filtering | new | yes | A |
| `invite.created`, `invite.claimed`, `invite.disabled` | invite lifecycle; code stored as a hash (F-55) | fix | yes | A |
| `multi_user.enabled`, `multi_user.enable_failed` | mode switch and its rollback (SMF-09) | yes, partly | yes | A |
| `policy.created`, `policy.updated`, `policy.deleted`, `policy.assigned` | access policies, with changed fields | new | yes | AP |
| `team.created`, `team.updated`, `team.deleted`, `team.member_added`, `team.member_removed`, `team.lead_changed` | teams and leads | new | yes | AP |
| `role_default.updated` | `agent_tool_role_policy` changed | new | yes | AP |
| `access.denied` | any role, policy, team, key-scope or lead check that refuses a request | new | | AP, A |

### 4.3 Keys, devices and integrations

| Action | Trigger | Today | Must | Source |
|---|---|---|---|---|
| `api_key.created`, `api_key.deleted` | with owner, scope and expiry | yes, partly | yes | A, AP |
| `api_key.used` | first use per key per hour, with channel, plus `legacy_api_key_used` until the cut-off | new | | AP |
| `api_key.expired_rejected` | an expired or out-of-scope key | new | | AP |
| `extension_key.created`, `extension_key.deleted` | browser extension keys | new | yes | A |
| `mobile.pairing_started`, `mobile.device_registered`, `mobile.device_approved`, `mobile.device_revoked` | mobile pairing (F-05) | new | yes | A |
| `telegram.*` | bot connect and disconnect; chat approve, deny, revoke | yes | | — |
| `oauth.connected`, `oauth.disconnected` | Gmail, Calendar and Outlook agent connections | new | yes | A |
| `connector.token_saved` | data connector credentials saved (Confluence, GitHub and so on) | new | | A |

### 4.4 Workspaces, chats and documents

| Action | Trigger | Today | Must | Source |
|---|---|---|---|---|
| `workspace.created`, `workspace.deleted`, `workspace.updated` | with changed settings: model, provider, router, prompt, mode, team | yes, partly | yes (delete) | A |
| `workspace.members_changed` | members added or removed, with ids | new | yes | A |
| `chat.sent` | one per message: workspace, thread, model, channel, token counts, guardrail outcome; no text | yes (`sent_chat`) | | A |
| `chat.viewed_other_user` | an admin, manager, lead or auditor opens another user's chats | new | yes | A |
| `chat.exported` | export, with filters and row count | yes | yes | A |
| `chat.deleted`, `chat.hidden`, `chat.bulk_deleted` | each delete or hide, with counts; manager bulk delete (F-15) | new | yes | A |
| `thread.created`, `thread.deleted`, `thread.forked`, `thread.renamed` | thread lifecycle | yes, partly | | A |
| `document.uploaded`, `document.embedded`, `document.removed`, `document.deleted` | per document, with workspace and checksum | yes, partly | yes (deleted) | A |
| `document.viewed`, `document.downloaded` | opening or downloading a source document or generated file | new | | A |
| `workspace.vectors_reset` | reset or embedder change | yes | yes | A |
| `parsed_file.created`, `parsed_file.deleted` | files attached in chat | yes, partly | | A |
| `memory.created`, `memory.updated`, `memory.deleted`, `memory.viewed_other_user` | memories | new | | A |
| `data.deleted` | a `dataDeletion` run, with per-store counts | new | yes | CH |
| `retention.purged` | a retention run, with counts and checkpoint | new | yes | GR, A |

### 4.5 Agents, tools and automation

| Action | Trigger | Today | Must | Source |
|---|---|---|---|---|
| `agent.session_started`, `agent.session_ended` | invocation claimed and closed, with channel and workspace | new | | A |
| `agent.tool_called` | each tool call: tool name, outcome, duration; no arguments or results | new | | A |
| `agent.tool_approval` | requested, approved, rejected or timed out, and by whom | new | yes (approved) | A, GR |
| `agent.tool_refused` | filtered out by policy or not in a job's `approved_tools` | new | | AP, SJ |
| `agent.whitelist_added`, `agent.whitelist_removed` | "always allow" choices | new | yes | GR |
| `agent.tool_toggled` | admin turns a tool on or off mid-chat | new | | A |
| `skill.installed`, `skill.removed`, `skill.enabled`, `skill.disabled` | custom skills, imported plugins, Community Hub imports | yes, partly | yes | A |
| `flow.created`, `flow.updated`, `flow.deleted` | agent flows | new | yes | A |
| `mcp.server_added`, `mcp.server_updated`, `mcp.server_removed`, `mcp.server_started`, `mcp.server_stopped` | UI and API (F-26) | new | yes | A |
| `scheduled_job.created`, `scheduled_job.updated`, `scheduled_job.deleted`, `scheduled_job.approved`, `scheduled_job.run` | jobs and runs | new | yes (approved) | SJ |
| `router.created`, `router.updated`, `router.deleted`, `router.rule_changed` | model routers | new | yes | A |

### 4.6 Settings, vendors and the audit trail itself

| Action | Trigger | Today | Must | Source |
|---|---|---|---|---|
| `settings.changed` | every `updateENV` key and `system_settings` label actually applied, with old and new value (secrets masked to their last 4 characters) and the key that failed, if any (SMF-10) | new | yes | A |
| `vendor.changed` | LLM, embedder, vector database, reranker, speech, search, image or telemetry vendor changed; also on the Compliance status page as "data now flows to X" | new | yes | A |
| `vendor.data_sent` | outbound call carrying user data, grouped per vendor, workspace and hour, with counts and no content (R11) | new | | A |
| `baa.recorded`, `baa.expired` | vendor BAA register changes; expiry within 30 days | new | yes | CH |
| `feature.toggled` | experimental features, embed, Telegram, live sync, memories, Community Hub | yes, partly | yes | A |
| `hipaa_mode.conflict`, `hipaa_mode.ok` | boot and settings-change checks | new | | CH |
| `guardrail.triggered` | in `guardrail_events`, mirrored as an audit row with the rule and action | new | | GR |
| `audit.exported`, `audit.viewed`, `audit.verified`, `audit.chain_broken`, `audit.write_failed`, `audit.forward_backlog` | the audit trail's own events | new | yes (exported) | A |
| `system.boot`, `system.shutdown` | process start and stop, with version and mode | new | | A |
| `collector.request` | a server-to-collector call: route, document count, outcome (the collector has no users) | new | | A |

### 4.7 Embed widget

| Action | Trigger | Today | Must | Source |
|---|---|---|---|---|
| `embed.created`, `embed.updated`, `embed.deleted` | embed configs | yes | yes | A |
| `embed.chat` | per message: embed id, session id, origin, outcome; no text | new | | A |
| `embed.rejected` | origin not allowed, cap reached | new | | A |

## 5. Making sure nothing is missed

### 5.1 Route coverage test

A test loads the Express app, lists every registered route (`app._router.stack`, plus the
websocket and job entry points from a registry), and checks that each state-changing
route is either:

- declared in `server/utils/audit/routes.js` with the actions it records, and those
  actions appear in that handler's tests; or
- on an explicit exemption list, with a reason (e.g. a POST that only reads).

A new route with neither fails CI. The repo map's path index
(`docs/repo-map/10-path-index.md`, 241 paths) is the starting list. Each path's ledger
rows tagged `LOG` show what it records today, and rows with `DB`, `FS`, `VEC` or `ENV`
and no `LOG` show what's missing.

### 5.2 Database backstop

A Prisma client extension records a low-detail `db.write` audit row for any write to the
sensitive tables (`users`, `api_keys`, `workspace_users`, `access_policies`, `teams`,
`team_members`, `system_settings`, `scheduled_jobs`, `workspace_chats` deletes and hides,
`memories`). It records only when no catalogue event was written in the same request
for that table. It catches code paths the route test can't see, such as jobs and helpers.
Each `db.write` row found in testing is a missing catalogue event and gets fixed.

### 5.3 Outbound data inventory

A wrapper around the HTTP clients used for vendors (the provider classes in
`server/utils/AiProviders`, `EmbeddingEngines`, `vectorDbProviders`, `TextToSpeech`,
`SpeechToText`, `ImageGenerators`, web search, push, telemetry) tags each call with its
vendor and feeds `vendor.data_sent`. A test lists every provider class and fails if one
isn't wrapped. In HIPAA mode, the wrapper refuses a vendor not in the BAA register,
which enforces the main plan's rule at the point of sending.

### 5.4 PHI-in-logs checks

- **Writer allow-list (3.4):** every catalogue action has a test that writes a sample
  event containing a planted PHI string. The test asserts the string doesn't reach the
  row, the forward payload or the console.
- **Static check:** a lint step flags `console.log` calls on request bodies, `prompt`,
  `message`, `content` and memory variables in server and collector code.

### 5.5 Review and alerting

- **An Audit page,** replacing Event Logs. It filters by actor, team, workspace, action,
  outcome, channel and date, with a link to the target and a per-user activity timeline.
  It's available to admins and the `auditor` role. Leads see their team's events if open
  decision 31 of the main plan allows it. Viewing the page writes `audit.viewed`.
- **Alerts,** by webhook, email or Slack, using `external_communication_connectors` where
  one fits:
  - 5 failed sign-ins for one user in 15 minutes, or a lockout;
  - any `audit.chain_broken`, `audit.write_failed` or forward backlog older than 1 hour;
  - a `chat.viewed_other_user` or `chat.exported` outside working hours, or above a daily
    count per viewer;
  - `vendor.changed`, `settings.changed` on security settings, `hipaa_mode.conflict`, a
    BAA expiring within 30 days;
  - an MCP server or skill installed;
  - a burst of `access.denied` for one actor.
- **A weekly activity review report** (R2): sign-ins, failures, privileged actions, data
  exports, views of other users' chats, vendor sends, and alerts. It's generated as a
  file the admin downloads and signs off, and the sign-off is recorded as
  `audit.review_completed`.

## 6. Compliance verification

### 6.1 Control matrix

`docs/compliance/control-matrix.md`, kept in the repo and generated in part. One row per
control:

| Column | Meaning |
|---|---|
| Control ID | `C-NN` |
| Requirement | R1–R14 above |
| Control | what the software does |
| Implemented by | file and PR (this plan or the main plan) |
| Setting | env variable or setting that must be on, and its required value in HIPAA mode |
| Evidence | what proves it: an audit query, a config check, a test |
| Automated check | the check ID in 6.2 |
| Status | `planned`, `built`, `verified` |

Initial rows (Status is `planned` for all):

| Control | Requirement | Implemented by | Automated check |
|---|---|---|---|
| C-01 Unique identity for every actor | R5, R6 | Main plan: Google sign-in, scoped keys, mobile devices as their own user, agent websocket session check | K-01, K-02 |
| C-02 Audit events per catalogue, failing closed for `must_record` | R1 | This plan, PR A | K-03, K-04 |
| C-03 Audit trail tamper evidence and forwarding | R4, R10 | This plan, PR B | K-05, K-06 |
| C-04 Six-year audit retention | R10 | This plan, PR B | K-07 |
| C-05 Activity review page, alerts and weekly report | R2, R3, R14 | This plan, PR C | K-08 |
| C-06 Login monitoring, rate limiting and lockout | R3 | Main plan: compliance item 3 | K-09 |
| C-07 Idle timeout and session revocation | R7 | Main plan: compliance item 2 | K-10 |
| C-08 Stored credential encryption | R8 | Main plan: compliance item 1; platform fixes 4 and 5 | K-11 |
| C-09 TLS in front of the app | R8 | Deployment; boot check of `x-forwarded-proto` and a setting | K-12 |
| C-10 Access by role, team and policy; logged access to others' data | R9 | Main plan: access policies, teams; this plan: `chat.viewed_other_user` | K-13 |
| C-11 Vendors only with a BAA; record of data sent per vendor | R11 | Main plan: HIPAA mode and BAA register; this plan: outbound inventory | K-14 |
| C-12 Deletion reaching every store, with reports | R9, R13 | Main plan: compliance item 7; audit issue 2 | K-15 |
| C-13 No PHI in logs | R1, R9 | This plan: 3.4, 5.4 | K-16 |
| C-14 Backup and restore documented, audit gap handling | R12 | This plan: 3.3; docs | K-17 |
| C-15 Guardrails and acceptable use | R9, R14 | Main plan: guardrails | K-18 |
| C-16 Automation runs as a person with human approval | R5, R9 | Main plan: scheduled jobs in multi-user mode | K-19 |
| C-17 Known findings closed or accepted | all | Findings register, state-machine audit, review | K-20 |

### 6.2 Automated checks

Two runners share one list of checks, `server/utils/compliance/checks/`:

- **CI** (a new `test:compliance` script in `server/package.json`): runs against a test
  database and the code.
- **Live** (`node server/scripts/compliance-check.js` and the Compliance status page):
  runs against a running instance's settings and database, read-only, and writes
  `compliance.checked` with the results.

| Check | What it verifies | CI | Live |
|---|---|---|---|
| K-01 | Multi-user mode on; no user without a unique identity; no API key without an owner after the cut-off | ✓ | ✓ |
| K-02 | Every channel resolves an actor: the route and websocket registry test, plus mobile devices with users | ✓ | |
| K-03 | Route coverage test (5.1) and database backstop finds nothing in the test suite (5.2) | ✓ | |
| K-04 | A failed audit write blocks each `must_record` action | ✓ | |
| K-05 | Chain verifies end to end; editing a row breaks it | ✓ | ✓ |
| K-06 | Forwarding configured and backlog under 1 hour | | ✓ |
| K-07 | `audit_retention_days` ≥ 2190; no delete route registered | ✓ | ✓ |
| K-08 | Alerts configured; last weekly review signed off within 8 days | | ✓ |
| K-09 | Lockout and rate limits on every sign-in, recovery and token route | ✓ | ✓ |
| K-10 | `SESSION_IDLE_TIMEOUT` set; cookie flags; revocation works | ✓ | ✓ |
| K-11 | Encrypted columns unreadable without the key; `STORAGE_ENCRYPTION_KEY` not in `.env` | ✓ | ✓ |
| K-12 | Requests arrive over HTTPS (forwarded proto) and `Secure` cookies are set | | ✓ |
| K-13 | Policy, team and minimum-necessary tests from the main plan pass; managers limited in HIPAA mode | ✓ | ✓ |
| K-14 | Every provider class wrapped; every configured vendor in the BAA register and unexpired | ✓ | ✓ |
| K-15 | `dataDeletion.forUser` leaves nothing in any store (the main plan's test) | ✓ | |
| K-16 | Planted PHI never reaches audit rows, forwards or logs; the lint step passes | ✓ | |
| K-17 | Last backup age (from the operator's backup hook, if configured) | | ✓ |
| K-18 | A guardrail profile applies to every workspace in HIPAA mode | | ✓ |
| K-19 | No multi-user job auto-approves; every job has an owner | ✓ | ✓ |
| K-20 | No open High finding in `09-findings-register.md` or the review without an accepted-risk note | ✓ | |

K-20 reads the findings register. A High finding is either fixed, with commit and test,
or marked `accepted` with a reason, approver and date. That keeps the register honest.

### 6.3 Evidence pack

`GET /compliance/evidence`, for admins and auditors, produces a signed zip:

- the control matrix with current status;
- the last live check results;
- configuration with secrets removed;
- the vendor BAA register;
- audit chain verification;
- the last weekly reviews and their sign-offs;
- user and role listings;
- retention and deletion reports.

Downloading it writes `compliance.evidence_exported`.

### 6.4 Outside the software

The control matrix lists these as `external`, with an owner and a link to where the
evidence lives:

- risk analysis and risk management (§164.308(a)(1)(ii)(A)-(B));
- written policies, workforce training and sanctions;
- BAAs with every vendor that receives ePHI, including the hosting provider;
- hosting, disk encryption and network controls, and TLS termination;
- backup schedule and tested restores;
- incident response and breach notification;
- physical safeguards;
- periodic review of this matrix, proposed quarterly.

## 7. Delivery

Proposed as three PRs on the fork's `master`, not stacked, after the main plan's access
policy PR (open decision 1):

**PR A: audit events and coverage**

1. `audit_events` migration and copy of `event_logs`; `server/utils/audit` writer,
   allow-lists, outbox and request-context middleware; tests.
2. Move every existing `logEvent` call to catalogue actions. Fix F-55 (actor, invite
   hash) and F-51 (preferences).
3. Add the missing events for existing features (sections 4.1–4.7, Source `A`), area by
   area: auth, accounts, keys and devices, workspaces and chats, documents, agents and
   MCP, settings and vendors, embed.
4. Route coverage test, database backstop and outbound inventory wrapper.
5. Log scrubber and the PHI checks; fix F-41.
6. Repo map updates: a `LOG` row in each domain file's side-effect ledger for each
   new event; regenerate the indexes.

**PR B: integrity, retention and forwarding**

1. Hash chain, verify endpoint and daily verification job.
2. Remove the delete route; retention job with checkpoints; six-year default.
3. Export with signing; forwarding with outbox retries.

**PR C: review and compliance verification**

1. Audit page, alerts and weekly review report with sign-off.
2. Compliance checks (both runners), the Compliance status page section, and the
   evidence pack.
3. `docs/compliance/control-matrix.md`, and the admin guide for reviews and evidence.

**Order with the main plan.** Features from the main plan's PRs (AP, GS, SJ, GR, CH)
record their catalogue events through `audit.record` as they're built. Whichever of PR A
or a feature PR lands second adapts the calls. The main plan's compliance items 5, 6 and
9 point here for their logging.

That's three PRs; delivery topology is your call.

## 8. Tests

- **Writer:**
  - rejects unknown actions; strips unknown metadata keys;
  - writes in the caller's transaction (a rollback leaves no row);
  - `must_record` failure blocks the action;
  - the outbox survives a crash between write and flush (simulated).
- **Every catalogue action:** one test that triggers it through its real route or job and
  asserts the row's actor, target, outcome and channel.
- **Denials:** each guard in the main plan writes `access.denied` with the right reason.
- **Coverage:** the route coverage test, the backstop and the outbound inventory test
  (5.1–5.3).
- **Integrity:** chain building under two concurrent writers; verify detects an edited,
  deleted and inserted row; the retention checkpoint keeps the chain valid.
- **Retention and export:** rows older than the setting are removed in batches; export
  pages and signs; no delete route exists.
- **PHI:** planted values never reach rows, forwards or logs (5.4).
- **Compliance checks:** each K-check passes on a compliant fixture and fails on a fixture
  with the matching gap.
- **Plant one bug per area:** skip an audit call, log a body, remove a provider wrapper.
  Confirm a test fails each time.

## 9. Acceptance criteria

1. Every state-changing route, websocket action and background job either records its
   catalogue events or is on the exemption list with a reason, and CI enforces it.
2. Every audit row names an actor type and id, channel, outcome, and target where one
   exists. API keys, devices, jobs and embed sessions name the user they act for, when
   there is one.
3. Viewing or exporting another user's chats always leaves a row, and the view fails if
   the row can't be written.
4. No audit row, forwarded record or application log contains chat, document or memory
   text, or a secret.
5. Changing, deleting or inserting an audit row is detected by verification, and the
   forward store holds an independent copy.
6. Audit rows are kept at least six years in HIPAA mode, and nobody can delete them
   through the app.
7. Every vendor that receives data is listed, with counts per period. In HIPAA mode, a
   vendor without a current BAA can't receive anything.
8. The compliance check runs in CI and on a live instance. The evidence pack shows every
   control's status, with no High finding left without a fix or an accepted-risk note.
9. With HIPAA mode off and no new settings, the app behaves as before, except that audit
   rows are richer, the event log can't be cleared, and logs are scrubbed.

## 10. Risks

- **Volume.** `chat.sent`, `agent.tool_called` and `vendor.data_sent` grow fast. The
  per-hour grouping for vendor sends and the rate-limited denials keep it bounded.
  Measure on a busy fixture, and keep the `occurred_at` and `action` indexes.
- **Failing closed.** `must_record` blocks actions when the audit write fails, which is
  the point, but a full disk stops admin work. The status page and alerts flag disk and
  outbox trouble first.
- **SQLite writer contention.** Hash chaining serializes audit writes. Keep the
  transaction short; on Postgres use an advisory lock.
- **Over-logging PHI.** The allow-list is the defense; review new metadata keys in code
  review, and run the PHI test on every catalogue action.
- **Clock and proxy trust.** IPs depend on the trusted proxy setting; set it explicitly
  rather than trusting `X-Forwarded-For` from anywhere.
- **"Compliant" is not a software state.** The evidence pack shows the software's
  controls. Section 6.4 must be done by people, and the status page says so.

## 11. Open decisions

1. Three PRs as proposed, or fold PR A into the main plan's compliance PR?
2. A new `audit_events` table (proposed), or extend `event_logs` in place?
3. Which actions are `must_record`: the list in section 4 (proposed), or all events?
4. Retention: six years (proposed), or longer, for example to match a state rule?
5. Forwarding target to support first: generic JSONL webhook (proposed), syslog, or a
   specific cloud logging service?
6. Should leads see their team's audit events (proposed: only with the main plan's
   decision 31), or only admins and auditors?
7. `vendor.data_sent` grouping: per vendor, workspace and hour (proposed), or per
   request?
8. Weekly review sign-off: required in HIPAA mode (proposed), or optional?
9. Should a failed live compliance check block chats in HIPAA mode, like configuration
   conflicts do (proposed only for K-06, K-11, K-14 and K-19), or only warn?
