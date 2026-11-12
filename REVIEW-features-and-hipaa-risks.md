# AnythingLLM feature review: data, security and HIPAA risks

Status: review of the code on `master` as of 2026-11-10 (commit `e82a80da`). Read-only:
nothing was changed or tested at runtime.

Revised 2026-11-10 against the repo map (`docs/repo-map/`, which traces 241 user paths)
and the state-machine audit (`docs/repo-map/12-state-machines.md` on branch
`claude/state-machine-audit-23070d`). The first version missed several identity holes and
understated how deletes, settings changes and the audit log behave. Findings are cited as
`F-NN` (findings register, `docs/repo-map/09-findings-register.md`) and `SMF-NN`
(state-machine register). "Fixed on the audit branch" means fixed there with a regression
test but not yet merged into `master`. Findings whose "checked" column in the register says
`map` come from the repo map's code reading and weren't re-read for this revision; the
others were confirmed in the code.

**Fixed on the access-policies branch** (`claude/access-policies-teams-b1be97`, not yet
merged; evidence in `docs/repo-map/09-findings-register.md` and the plan's "As built"
section): F-01 (keys have an owner, workspace scope and expiry; ownerless keys refused in
multi-user mode; non-admin owners can't reach admin routes), F-04 (agent websocket checks
the session user), F-05 (a mobile device chats as the user it was paired for), F-06 (body
`userId` ignored for owned keys), F-50 and SMF-12 (deleting a router unbinds it and workspaces fall
back), F-23 (router rules scoped to their router). Partly fixed: F-16 (admin-owner keys
only; still ignores `DISABLE_VIEW_CHAT_HISTORY`), F-21 (OpenAI-compatible chats run as and
are saved under the key's owner, within their workspaces), F-26 (only admin-owned keys
manage MCP servers; still allowed in HIPAA mode). Risks 3 and 4 below are reduced
accordingly; F-02 and F-07 in risk 4 are still open. Agent skills and MCP servers can now
be restricted by policy, team and role.

This is an engineering review, not legal advice. Whether a deployment is HIPAA compliant
depends on where and how it runs (hosting, disk encryption, network, business associate
agreements, policies and training), not only on the code. Use this to decide which
features to turn off, which need a BAA with a vendor, and which need code changes.

## How to read this

- **Severity** is for a deployment that handles protected health information (PHI):
  **High** = PHI can leave your control or be read by the wrong person with default
  settings; **Medium** = a real gap that needs configuration or a compensating control;
  **Low** = hygiene.
- **HIPAA reference** points to the Security Rule technical safeguards (45 CFR §164.312)
  or the Privacy Rule "minimum necessary" standard (§164.502(b)) where one applies.
- **BAA** means the outside vendor receives PHI and you need a business associate
  agreement with it, or the feature must be off.
- **Plan** marks gaps the plan in `PLAN-per-account-model-access.md` already addresses.
- Paths are under `server/` unless they start with `collector/` or `frontend/`.

## The top risks

Ranked by severity, then by how easily each can be reached. Items 4, 7, 10 and 11 are new
in this revision; 3, 5, 6, 8 and 12 were widened.

| # | Risk | Severity | Fix |
|---|---|---|---|
| 1 | PHI is sent to outside vendors in many features (LLMs, embedders, vector databases, web search, speech, image generation, Telegram, browser push), often without a BAA | High | Use only local or BAA-covered providers; turn off the rest (sections 4–7, 9, 11) |
| 2 | Nothing the app stores is encrypted by the app itself: the SQLite database, document text, vector data, provider API keys and SQL connection strings are all plain files | High | Encrypted disk or volume; a secrets manager for `.env`; encrypt stored credentials (section 1) |
| 3 | Developer API keys are unscoped admin keys with no owner or expiry. Any key can create admins and more keys (F-01), register an MCP server that runs a command on the host (`endpoints/api/mcpServers/index.js:48`, F-26), and save a thread chat under any user it names (`endpoints/api/workspaceThread/index.js:448`, F-06) | High | Scoped API keys and a cut-off for keys with no owner (Plan) |
| 4 | Identity holes outside sign-in: the agent websocket checks no session, so the invocation UUID is the only credential (`endpoints/agentWebsocket.js:28-37`, F-04); a paired mobile device acts as the admin who paired it (F-05); anyone who can reach an instance with no password can switch it to multi-user mode and become admin (F-07); the browser-extension key list returns each owner's password hash (`models/browserExtensionApiKey.js:124,157`, F-02) | High | Session check on the websocket, per-device users, multi-user from first boot, strip user rows from key listings (Plan) |
| 5 | Sessions last 30 days, are kept in browser `localStorage`, never time out from inactivity, and survive a password change or reset (F-03); there's no MFA and no login rate limit | High | Google sign-in with short sessions (Plan), idle timeout, revocation, MFA through Google, rate limiting |
| 6 | Agent features can run code or send data anywhere: MCP servers started as local commands, imported agent plugins, agent flow HTTP calls, Community Hub downloads, email sending. Approval is opt-in per tool, so MCP tools, flows, SQL and web tools never ask (F-25), and scheduled jobs approve every tool automatically (`jobs/run-scheduled-job.js:77-83`, F-24) | High | Turn off unless needed; restrict by role (Plan); approval for every side effect (Plan) |
| 7 | The collector's block on internal addresses can be switched off from a browser request: `/ext/*` routes forward the body unchanged, and the collector applies its `runtimeSettings` process-wide (`collector/middleware/verifyIntegrity.js:9,26`, F-32). The guard itself checks only literal IPv4 addresses (F-33) | High | Strip `runtimeSettings` from forwarded bodies; resolve and re-check hosts and redirects (section 7) |
| 8 | Deleting doesn't delete. Deleting a chat, thread or user only hides the chats (`models/user.js:311-319`, F-37). A document's database rows, vectors and files can drift apart (audit issue 2; two cases fixed on the audit branch, five open), and connector tokens are copied into vector rows (F-35). Nothing is removed on a schedule | High | Retention job and a deletion module that reaches every store and checks afterwards (Plan) |
| 9 | Admins and managers can read every user's chats, and there's no record of who viewed what. Managers can also export and hard-delete every chat (F-15), and `/v1/admin/workspace-chats` returns all chats to any API key (F-16) | Medium | Access logging for chat views and exports; limit to a compliance role (section 3) |
| 10 | The audit trail can't be relied on: admins can delete the whole event log (F-54), the delete reports success even when it failed (SMF-28), failed log writes are silently dropped (`models/eventLogs.js:4-23`), and user delete reports success on failure (SMF-31) | Medium | Separate, failing write path; tamper-evident chain; forwarding (Plan) |
| 11 | Settings changes are partial and can destroy data: `updateENV` stops at the first invalid key after earlier keys and their reset hooks have run (SMF-10, F-45); changing the embedder or vector database wipes every embedding without warning (F-47); a crash while `.env` is rewritten can leave auth secrets missing (SMF-29) | Medium | Validate every key first, write `.env` atomically, confirm destructive resets (Plan) |
| 12 | The memory feature extracts facts about users from their chats and keeps them after the chats are deleted. A failed extraction still marks the chats processed (SMF-22, F-41), and memory contents are written to the worker log | Medium | Turn off, or include memories in deletion and retention (section 10) |
| 13 | The chat embed widget is public and unauthenticated; its domain allowlist checks only the `Origin` header, which any non-browser client can set (F-22) | Medium | Don't embed PHI workspaces; limits per IP (section 12) |
| 14 | Usage telemetry is on by default and goes to Mintplex Labs through PostHog; the onboarding survey sends the entered email to `onboarding.anythingllm.com` (F-57) | Low | Set `DISABLE_TELEMETRY=true`; skip the survey (section 1) |

## 1. Platform-wide controls

| Area | What the code does | Risk | Severity | HIPAA reference |
|---|---|---|---|---|
| Storage | Main database is SQLite at `storage/anythingllm.db` (`prisma/schema.prisma:15`); documents are saved as JSON text under `storage/documents`; LanceDB (the default vector database) is local files | No encryption by the app. `EncryptionManager` (AES-256-CBC) is used only for collector payloads and Telegram, not for stored chats or documents | High | §164.312(a)(2)(iv) encryption at rest (addressable) |
| Secrets | Provider API keys and settings live in `.env` and are written back by `utils/helpers/updateENV.js`; SQL agent connection strings are stored in `system_settings` (`models/systemSettings.js:49`) | Plain text on disk and in the database; anyone with file or database access gets every vendor key and database password. `EncryptionManager` also writes its own key and salt into the same `.env` (`utils/EncryptionManager/index.js:28`) | High | §164.312(a)(1) access control |
| Transport | The server speaks plain HTTP; TLS is expected from a reverse proxy | PHI in transit is unprotected unless TLS is set up in front | High (config) | §164.312(e)(1) transmission security |
| CORS | `app.use(cors({ origin: true }))` (`index.js:67`) accepts requests from any website | Auth uses a bearer header, not cookies, which limits the impact, but any site can call the API with a stolen token | Medium | §164.312(a)(1) |
| Sessions | `makeJWT` issues 30-day tokens (`utils/http/index.js:25`); the frontend stores them in `localStorage` (`frontend/src/AuthContext.jsx:32`) | Any XSS bug exposes the token; no idle timeout; one `JWT_SECRET` signs everything; no logout endpoint, and a password change or reset leaves every session valid (F-03). Role and suspension are re-read on each request (`utils/middleware/validatedRequest.js:74-111`), so those changes do take effect at once. The frontend treats any failed request during its auth check as signed out (SMF-30) | High | §164.312(a)(2)(iii) automatic logoff; §164.312(d) authentication |
| Passwords | Minimum 8 characters, complexity configurable (`models/user.js:341`); no MFA | Single factor only | Medium | §164.312(d) |
| Login abuse | Failed logins are logged in `event_logs`, but no rate limit or lockout exists (no `express-rate-limit` or similar) | Password guessing is unthrottled | Medium | §164.308(a)(5)(ii)(C) log-in monitoring |
| Single-user mode | One shared password, or none, and no user identity | Can't tie actions to a person; unsuitable for PHI. With no password, anyone who can reach the instance can switch it to multi-user mode and make themselves admin (`POST /system/enable-multi-user` only needs `validatedRequest`, which passes when `AUTH_TOKEN` is unset; F-07). If that switch fails partway, the rollback deletes every user and, by cascade, migrated threads, memories and keys (F-43, SMF-09) | High | §164.312(a)(2)(i) unique user identification |
| Audit log | `event_logs` records sign-ins, failed sign-ins, API actions, chat exports and some admin changes | No record of who read a chat, document or workspace; web chats are stored but chat views aren't logged; the log can be edited by anyone with database access, and admins can delete the whole log from the UI (`DELETE /system/event-logs`, `endpoints/system.js:1171`). That delete ignores its result and logs "cleared" even when it failed (SMF-28). `logEvent` swallows write errors (`models/eventLogs.js:4-23`). `user_updated` is logged against the target, not the actor, and `invite_created` stores the invite code in plain text (F-55) | Medium | §164.312(b) audit controls |
| Retention | No job deletes old chats, documents, vectors, memories or logs. Six tables are never pruned: `scheduled_job_runs`, `workspace_agent_invocations`, `invites`, `event_logs`, `password_reset_tokens` and expired `temporary_auth_tokens` (F-40) | Data is kept forever by default | Medium | Minimum necessary; your retention policy |
| Settings changes | `updateENV` (`utils/helpers/updateENV.js:1519-1575`), `dumpENV`, `SystemSettings._updateSettings` | A request is applied key by key and stops at the first error, after earlier keys and their reset hooks have run (SMF-10, F-45). Changing the embedder or vector database wipes every embedding (F-47). `.env` is rewritten in place, so a crash mid-write can drop auth secrets (SMF-29), and `dumpENV` drops hand-added variables and cuts values at a quote or `#` (F-46). `POST /system/custom-models` writes submitted keys into the environment before the user saves (F-48) | Medium | §164.312(c)(1) integrity |
| Telemetry | On unless `DISABLE_TELEMETRY=true`; sends anonymous event names to PostHog with a random install id (`utils/telemetry/index.js`, `models/telemetry.js`) | The code comment says content isn't sent, but it is an outbound flow to a third party | Low | Turn off for PHI deployments |
| Backups | No backup feature in the app | Backups made outside the app hold the same unencrypted data | Medium (config) | §164.308(a)(7) contingency plan |

## 2. Accounts and access

| Feature | Where | Data | Risk | Severity |
|---|---|---|---|---|
| Multi-user mode, roles (admin, manager, default) | `utils/middleware/multiUserProtected.js` | users, roles | Only three roles; admins and managers see every workspace (`models/workspace.js:294`) | Medium (Plan) |
| Admin count | `utils/helpers/admin/index.js:22-38`, `endpoints/admin.js:88-160` | | Fixed on the Google sign-in branch (`169b68a0`): every demote, suspend or delete that would remove the last active admin is refused, checked in the same transaction as the write (F-09, SMF-13) | Low (fixed) |
| Workspace membership | `workspace_users` | | All-or-nothing; no read-only access. A failed member replace could leave a workspace with no members (SMF-08, fixed on the audit branch) | Low (Plan) |
| Invites | `endpoints/invite.js`, `models/invite.js:44-75` | invite codes | Anyone holding the link can join until it's used. Invites never expire. The claim is atomic since `169b68a0` (conditional update in the same transaction as the user insert), so one invite makes at most one account and a deactivated invite can't be claimed (SMF-14, fixed) | Low |
| Account recovery codes | `utils/PasswordRecovery` | hashed codes | Fine as a fallback; not MFA. Codes aren't used up when they unlock a reset, recovery doesn't check suspension, and codes can multiply (SMF-31). A rejected new password no longer touches recovery state, and the reset token is consumed atomically (F-10, SMF-15, fixed in `169b68a0`). Not rate limited (F-08) | Medium |
| Simple SSO temporary tokens | `models/temporaryAuthToken.js`, `GET /request-token/sso/simple` | single-use 10-minute tokens | Whoever holds an API key can sign in as any user. Two uses of one token at once could crash the server (SMF-01, fixed on the audit branch); issuing now replaces the user's tokens in one transaction (SMF-32, fixed in `169b68a0`); suspension is checked only when the token is used. The `/sso/simple` page now follows `redirectTo` only to same-origin paths (F-11, fixed in `169b68a0`). Google sign-in reuses this page with `allm-oidc-` tokens, accepted only while Google sign-in is on | Medium (Plan) |
| Suspension, daily message limit | `models/user.js:379` | | Suspension works immediately; the limit doesn't apply to admins, is a check-then-write that parallel sends can exceed (SMF-27), and is handed back when a workspace delete hard-deletes chats (F-42). `suspended: "0"` suspends the user (F-12) | Low |
| Developer API keys | `models/apiKeys.js`, `utils/middleware/validApiKey.js` | | Full admin access, no owner, scope or expiry; API chats are logged with no user. Any key can create admins and keys, register MCP servers that run host commands (F-26), and save thread chats under any `userId` it names, with no membership, suspension or limit check (F-06). Keys made in single-user mode keep this after multi-user is turned on | High (Plan) |
| Browser extension keys | `endpoints/browserExtension.js`, `browser_extension_api_keys` | | Per user, but no expiry. The key list returns each owner's full user row, including the bcrypt password hash (`models/browserExtensionApiKey.js:124,157`, F-02) | High |
| Mobile app devices | `endpoints/mobile/index.js`, `desktop_mobile_devices` | device tokens | Devices that are lost stay connected until revoked. A device takes the user id of the admin who paired it, so every device acts as an admin in multi-user mode (`endpoints/mobile/index.js:130`, F-05); an approved device with no user sees every workspace (SMF-09). Device tokens never expire | High |
| Agent websocket | `endpoints/agentWebsocket.js:28-37` | agent session | No auth middleware; the invocation UUID in the URL is the only credential (F-04). Each UUID is now single-use (SMF-06, fixed on the audit branch), but unused invocations stay valid indefinitely (SMF-35) | High |

## 3. Workspaces, chats and chat history

| Feature | Where | Data | Risk | Severity |
|---|---|---|---|---|
| Workspace chat and threads | `utils/chats/stream.js`, `endpoints/workspaceThreads.js` | prompts and replies in `workspace_chats`, unencrypted | All PHI typed into chats is stored forever. Deleting a chat, thread or user only hides the chats (`include=false`, `user_id=null`; `models/user.js:311-319`, F-37), so "deleted" PHI stays in the database. A chat cleared while its reply was streaming came back visible (SMF-03, fixed on the audit branch); a finishing stream can still re-create a chat for a deleted workspace or thread (SMF-33). After a user is deleted, their event logs, API keys, invites, profile picture and whitelist row remain (F-38) | High |
| Chat modes (`automatic`, `chat`, `query`) | `stream.js:111` | | `query` mode limits answers to documents; the other modes let the model answer from general knowledge | Low |
| System prompts, prompt history, system prompt variables, slash command presets, suggested messages | `prompt_history`, `system_prompt_variables`, `slash_command_presets` | text set by admins or users | User variables can inject personal details into every prompt. System prompt variables are global: the stored `userId` is ignored, so one user's variables reach everyone's prompts, and the API helper expands every user's slash presets (F-18) | Medium |
| Admin chat log viewer and export | `endpoints/system.js` (`exported_chats` event) | every user's chats | Admins can read and export all chats; exports leave the system as files. Managers can also list, export and hard-delete every chat, all at once with id `-1`, with no event log (F-15). `/v1/admin/workspace-chats` returns every user's chats to any API key and ignores `DISABLE_VIEW_CHAT_HISTORY` (F-16). An API `reset: true` without a `sessionId` hides default-thread history for every user of the workspace (F-17) | Medium (§164.502(b) minimum necessary) |
| Chat feedback | `workspace_chats` | | None beyond chat storage | Low |
| Model router | `models/modelRouter.js`, `utils/router` | | `llm` rules send the prompt to a second classifier model, which is another vendor flow. Deleting a router that workspaces still use breaks their chats (F-50, SMF-12), and rule edits aren't checked to belong to the router in the URL (F-23) | Medium (BAA) |

## 4. LLM providers (chat and agents)

Every prompt, the retrieved document text and the chat history go to the chosen provider.

| Group | Providers in `utils/AiProviders/` | Risk | Severity |
|---|---|---|---|
| Run on your own servers | `ollama`, `lmStudio`, `localAi`, `koboldCPP`, `textGenWebUI`, `lemonade`, `embeddedLemonade`, `foundry` (local), `omlx`, `genericOpenAi` and `liteLLM` when pointed at your own server | PHI stays with you if the server is yours and reached over a private network | Low |
| Cloud providers whose enterprise plans can include a BAA | `azureOpenAi`, `bedrock`, `vertex`, `openAi`, `anthropic`, `gemini` | Only covered if your account is on the plan with a signed BAA and the right data settings (for example zero data retention) | High until a BAA is signed |
| Other cloud providers and aggregators | `openRouter`, `togetherAi`, `groq`, `fireworksAi`, `mistral`, `cohere`, `deepseek`, `perplexity`, `xai`, `cerebras`, `sambanova`, `novita`, `ppio`, `nvidiaNim` (hosted), `moonshotAi`, `zai`, `minimax`, `giteeai`, `cometapi`, `apipie`, `llmman`, `privatemode` | Check each vendor's BAA and data-retention terms; aggregators also pass data on to further providers | High unless confirmed |

Workspaces can each pick a different provider (`workspaces.chatProvider`), so one
misconfigured workspace can send PHI to an uncovered vendor. Per-account model
allow-lists in the Plan close this.

## 5. Embeddings and rerankers

Every chunk of every uploaded document goes to the embedding engine, and queries do too.

| Group | `utils/EmbeddingEngines/` | Severity |
|---|---|---|
| Local | `native` (the default), `ollama`, `lmstudio`, `localAi`, `lemonade` | Low |
| Cloud | `openAi`, `azureOpenAi`, `gemini`, `cohere`, `mistral`, `voyageAi`, `openRouter`, `liteLLM`/`genericOpenAi` when remote | High unless a BAA is in place |

Rerankers (`utils/EmbeddingRerankers`) see the same chunks; check which ones are local.

## 6. Vector databases

Vector databases store the text of each chunk next to its vector, so they hold PHI.

| Group | `utils/vectorDbProviders/` | Severity |
|---|---|---|
| Local files | `lance` (the default) | Medium (unencrypted on disk) |
| Self-hosted servers | `chroma`, `milvus`, `pgvector`, `qdrant`, `weaviate` when run by you | Medium (secure and encrypt the server) |
| Cloud services | `pinecone`, `astra`, `chromacloud`, `zilliz`, and cloud-hosted `qdrant`/`weaviate`/`milvus` | High unless a BAA is in place |

Deleting a document has to remove its vectors too, and today that isn't guaranteed for
any vector database. The document's database rows, vectors, JSON file and vector cache are
written separately with no transaction across them (audit issue 2):

- Fixed on the audit branch: a sync could re-create vectors for a document removed while
  it ran (SMF-02), and the same document could be attached twice so that removing it left
  a copy (SMF-04).
- Open: a half-failed workspace delete leaves vectors that a new workspace with the same
  slug inherits (SMF-11); two embedding workers can run for one workspace (SMF-16); a
  failed insert in the embedding worker leaves vectors with no document row (SMF-17,
  F-53); a failed sync leaves a document stale (SMF-18); concurrent adds of the same
  document both pass the existence check (SMF-39).
- Detaching a document leaves its JSON and vector cache on disk until a system purge, and
  the vector cache survives a workspace delete (F-39).
- Connector tokens, stored encrypted in `chunkSource`, are copied into the document JSON,
  `workspace_documents.metadata`, every vector row and the vector cache (F-35), so a
  vector store also holds credentials.

## 7. Document ingestion (the `collector` service)

| Feature | Where | Data | Risk | Severity |
|---|---|---|---|---|
| File upload: PDF, Word, Excel, PowerPoint/Office, EPUB, text, email archives (MBOX), images (OCR), audio | `collector/processSingleFile/convert/` | Full text stored in `storage/documents` as JSON, unencrypted | Uploaded PHI is copied into several places (original, JSON text, vectors, cache); documents are shared across workspaces at the system level | Medium |
| Audio transcription | `collector/processSingleFile/convert/asAudio.js`, `utils/SpeechToText` | audio | Cloud transcription (for example OpenAI) sends recordings to the vendor; the local Whisper option doesn't | High if cloud |
| Web links and website crawling | `collector/processLink`, `collector/utils/extensions/WebsiteDepth` | fetched pages | Blocks internal IP addresses unless `COLLECTOR_ALLOW_ANY_IP` is set (`collector/utils/url/index.js:22`); keep it unset. But the block can be turned off from a browser: `/ext/*` routes (`server/endpoints/extensions/index.js`) forward the request body to the collector unchanged (`server/utils/collectorApi/index.js:265`), and the collector applies `options.runtimeSettings` from it to a process-wide setting (`collector/middleware/verifyIntegrity.js:9,26`, F-32). The block also checks only literal IPv4 hostnames by first octet, allows `127.0.0.1` and `0.0.0.0`, and doesn't re-check after DNS or redirects (F-33) | High |
| Server-to-collector channel | `server/utils/collectorApi`, `collector/middleware` | provider keys, document text | Every request carries the OpenAI and Whisper keys in plain text, and signatures have no nonce, so a captured request can be replayed (F-34) | Medium |
| Connectors: Confluence, DrupalWiki, Obsidian, Paperless-ngx, GitHub/GitLab repos, YouTube transcripts | `collector/utils/extensions/` | access tokens; pulled content | Tokens are entered per import; pulled content can contain PHI; YouTube and public sources are outbound requests | Medium |
| Raw text import | `collector/processRawText` | | Same storage as uploads | Low |
| Files attached in chat | `endpoints/workspacesParsedFiles.js`, `workspace_parsed_files` | parsed text per user | Stored per user and thread; included in prompts to the LLM. The record is deleted when embedding fails, and orphan cleanup can race an upload (SMF-38) | Medium |
| Upload limits | `server/utils/files`, collector body parser | | No upload size limit; the collector accepts bodies up to 3 GB, and files stay in the hot directory if the collector is down or rejects them (F-36) | Low |
| Live document sync (experimental) | `endpoints/experimental/liveSync.js`, `jobs/sync-watched-documents.js` | | Re-fetches sources on a schedule, so remote changes flow in without review. Turning it on or off restarted every background job, breaking embedding and Telegram workers (F-44, SMF-07, fixed on the audit branch) | Low |
| Orphan document cleanup | `jobs/cleanup-orphan-documents.js` | | Helpful; not a retention policy | — |

## 8. Agents and skills

| Feature | Where | Risk | Severity |
|---|---|---|---|
| `@agent` chats (web, API, Telegram) | `utils/agents/index.js`, `utils/agents/ephemeral.js` | Every skill below is available to every user once an admin enables it | Medium (Plan) |
| Web browsing (search) | `plugins/web-browsing.js` | Search queries, which can include PHI, go to the configured search provider. With no provider configured, it falls back to You.com's keyless tier, then DuckDuckGo (F-31), so PHI can reach a search engine nobody chose | High unless off or covered |
| Web scraping, file creation from URLs, flow API calls | `plugins/web-scraping.js`, `plugins/create-files/`, flow `apiCall` blocks | Outbound requests to model-chosen URLs from the server (F-29); a way to send data out | Medium |
| SQL agent | `plugins/sql-agent/` | Connects to your databases with stored plain-text credentials and can read whatever that account can; query results go to the LLM | High |
| Filesystem (read, write, move, edit, search) | `plugins/filesystem/` | Limited to allowed directories (`lib.js:46`), but can read and write server files inside them | Medium |
| Create files (Word, PDF, Excel, PowerPoint, text) | `plugins/create-files/` | Generated files can hold PHI and are cleaned up by `jobs/cleanup-generated-files.js`. They're authorized per workspace, not per chat owner, so other members of the workspace can fetch them (`endpoints/agentFileServer.js:173`), and the `/img` edit command reads any file in the shared generated-images folder by name (F-19) | Medium |
| Gmail, Google Calendar, Outlook | `plugins/gmail`, `plugins/google-calendar`, `plugins/outlook`, `endpoints/utils/outlookAgentUtils.js` | OAuth tokens stored on the server; the agent can send email, which sends PHI out; needs a BAA with Google or Microsoft for that mailbox. Reading mail and calendars never asks for approval (F-25). The Outlook OAuth flow sends no `state` and builds its redirect URI from `X-Forwarded-*` headers (F-30) | High |
| Image generation | `plugins/generate-image.js`, `utils/ImageGenerators` | Prompts go to the image vendor | Medium (BAA) |
| Charts, summarize, chat and file history, request user input | `plugins/rechart.js`, `summarize.js`, `chat-history.js`, `file-history.js`, `request-user-input.js` | Use the same LLM; no new outbound flow | Low |
| Tool approval prompts and the whitelist | `plugins/websocket.js:254`, `endpoints/agentSkillWhitelist.js:67` | Approval is opt-in per tool: MCP tools, flows, SQL, web, memory store, image generation and mail and calendar reads never ask (F-25). Any user can turn off approval for themselves, and there's no endpoint to undo it (F-28). API and Telegram agents read the single-user list even in multi-user mode (F-28). Two adds at once can lose one (SMF-23) | High (Plan) |
| `@agent` websocket | `endpoints/agentWebsocket.js:28-37` | No session check; anyone with the invocation UUID drives the agent as the invoking user (F-04). See section 2 | High (Plan) |
| Create scheduled job (skill) | `plugins/create-scheduled-job/` | Single-user mode only; the jobs it creates approve every tool automatically (section 11) | Medium |
| CLI plugin | `plugins/cli.js` | Development only, not a shell | — |

## 9. Extending agents: MCP, flows, plugins, Community Hub

| Feature | Where | Risk | Severity |
|---|---|---|---|
| MCP servers | `utils/MCP`, `endpoints/mcpServers.js`, `endpoints/api/mcpServers/index.js` | Local MCP servers are commands the server starts on the host; remote ones receive chat data and, if enabled, user id, username and role headers (`utils/MCP/identity.js:30`); available to every user. Any developer API key can add a local server, which runs a host command (`POST /v1/mcp-servers/new`, F-26); the child process gets the shell environment (`utils/MCP/hypervisor/index.js:376-388`). A server whose process dies still shows as running (SMF-21) | High |
| Agent flows | `utils/agentFlows`, `endpoints/agentFlows.js` | No-code flows can make HTTP calls to any address with chat data | High |
| Imported agent plugins (experimental) | `endpoints/experimental/imported-agent-plugins.js`, `utils/agents/imported.js` | Runs third-party JavaScript inside the server process with full access; Community Hub skills are loaded with `require()` (`utils/agents/imported.js:13-24`, F-27) | High |
| Community Hub | `endpoints/communityHub.js` | Downloads skills, flows and prompts from an outside catalog; supply-chain risk | High |

## 10. Memories

| Feature | Where | Risk | Severity |
|---|---|---|---|
| Memory extraction and storage | `jobs/extract-memories.js`, `utils/memories`, `memories` table, `endpoints/memory.js`, `plugins/memory.js` | A background job sends chats to the LLM to pull out facts about the user, then stores them and adds them to later prompts. That creates new derived PHI that outlives the chat and must be part of any access, retention and deletion process. A failed run still marks its chats processed, so they're never retried, per-user caps can be exceeded (SMF-22, F-41), and memory contents are written to the worker log (F-41), which puts PHI in log files | Medium |

## 11. Scheduled jobs and notifications

| Feature | Where | Risk | Severity |
|---|---|---|---|
| Scheduled jobs | `endpoints/scheduledJobs.js`, `jobs/run-scheduled-job.js` | Single-user mode only (routes use `isSingleUserMode`; timers stop once multi-user is on). Agents run with no person watching, and every tool, including ones that normally ask, is approved automatically (`jobs/run-scheduled-job.js:77-83`, F-24). The first version of this review said such tools couldn't be approved; that was wrong. A run whose worker was killed was recorded as a success (SMF-05, fixed on the audit branch); a run can still hang before its timeout (SMF-24) | High |
| Web push notifications | `utils/PushNotifications`, `jobs/helpers/scheduled-job-helper.js:93` | The first 100 characters of a job's result are sent through the browser's push service (run by Google, Mozilla or Apple) | High if job output can contain PHI |

## 12. Channels and integrations

| Feature | Where | Risk | Severity |
|---|---|---|---|
| Chat embed widget | `endpoints/embed`, `endpoints/embedManagement.js`, `utils/middleware/embedMiddleware.js`, `embed_configs` | Public and unauthenticated; anyone on an allowed site can query that workspace; can allow model, temperature and prompt overrides; chats stored by session id. The domain allowlist compares only the `Origin` header, which a non-browser client can set to anything, and the per-session cap uses a session id the client makes up (F-22); caps are check-then-write (SMF-27) | High for PHI workspaces |
| Developer API and Swagger docs | `endpoints/api/` | See API keys above; the OpenAI-compatible endpoints make any key a full gateway. They list every workspace as a model, a caller `system` message replaces the workspace prompt, and chats are saved with no user (F-21) | High (Plan) |
| Telegram bot | `endpoints/telegram.js`, `utils/telegramBot`, `jobs/handle-telegram-chat.js` | Messages pass through Telegram's servers, and Telegram doesn't sign BAAs. The bot identifies a chat, not a person: every approved chat shares one history with no user, and can create workspaces and change a workspace's model for everyone (F-20). Starting and stopping the bot can race (SMF-20) | High |
| Browser extension | `endpoints/browserExtension.js` | Sends page content from the user's browser into workspaces | Medium |
| Mobile app | `endpoints/mobile/` | Chat data on phones; device tokens don't expire; every device acts as the admin who paired it (F-05, section 2) | High |
| External communication connectors | `external_communication_connectors` table | Outbound messages to outside services | Medium |

## 13. Voice and images

| Feature | Where | Risk | Severity |
|---|---|---|---|
| Text to speech | `utils/TextToSpeech` (`elevenLabs`, `openAi`, `openAiGeneric`, `kokoro`) and the browser's built-in voice | Replies, which may contain PHI, go to ElevenLabs or OpenAI; Kokoro and the browser voice stay local | High if cloud |
| Speech to text | `utils/SpeechToText`, browser speech recognition | Cloud transcription sends audio out; some browsers' built-in recognition also sends audio to the browser vendor | High if cloud |
| Image generation | `utils/ImageGenerators` | Prompts go to the vendor | Medium |

## 14. Admin and system

| Feature | Where | Risk | Severity |
|---|---|---|---|
| Settings pages for LLM, embedder, vector database, speech and so on | `endpoints/system.js`, `endpoints/admin.js` | One admin change can move every workspace's data to a different vendor, and the change isn't clearly logged. A save can be applied in part, and an embedder or vector database change wipes every embedding without warning (section 1, "Settings changes"). `POST /admin/system-preferences` always returns success, logs nothing, and never reads its `protectedFields` list (F-51) | Medium |
| Event log viewer | `endpoints/admin.js` | Audit log is in the same database that admins control; it can be cleared in one call, and the clear reports success even when it failed (section 1, "Audit log") | Medium |
| Privacy and data page | `frontend/src/pages/GeneralSettings/PrivacyAndData` | Shows which providers get data; useful for an inventory | — |
| Branding, themes, custom footer | `endpoints/themePalettes.js` | None | — |
| Experimental features toggle | `endpoints/experimental/` | Turns on live sync and imported plugins | Medium |

## What the plan already covers

| Risk | Plan section |
|---|---|
| Unscoped admin API keys, keys that mint keys, keys made in single-user mode (F-01) | Scoped API keys, with the legacy key cut-off |
| API thread chat under any `userId` (F-06), all chats to any key (F-16), OpenAI-compatible chats with no user (F-21) | Scoped API keys: pass the owner, ignore body `userId`, workspace scoping |
| Agent websocket with no session check (F-04), unused invocations valid forever (SMF-35) | Enforcement points (websocket user check); Compliance hardening item 2 (invocation expiry) |
| Mobile devices acting as the pairing admin (F-05) | Enforcement points (mobile) |
| Open instance switched to multi-user by anyone, destructive rollback (F-07, F-43, SMF-09) | Compliance hardening item 8 (multi-user from first boot); Delivery prerequisites (audit issue 3) |
| Last admin removable (F-09, SMF-13), double-claimed invites (SMF-14), recovery state (F-10, SMF-15) | Google sign-in (atomic invite claim, last-admin guard); Delivery prerequisites (audit issue 9) |
| Workspaces that can pick any provider; router deleted while in use (F-50, SMF-12) | Per-account model allow-lists; router binding |
| Agent skills and MCP servers available to everyone | Agent skill and MCP restrictions |
| Long sessions, no MFA, password-only sign-in, no revocation (F-03) | Google sign-in, with short OIDC sessions (MFA through Google); Compliance hardening item 2 |
| PHI typed into chats with no screening | Guardrails: input checks and redaction |
| Self-approval of side-effecting tools (F-28), whitelist lost update (SMF-23) | Guardrails: agent and tool guardrails |
| Scheduled jobs approving every tool (F-24), single-user only | Scheduled jobs in multi-user mode (jobs run as their owner, only pre-approved tools run unattended); Compliance hardening item 8 |
| No retention or record of blocks; never-pruned tables (F-40) | Guardrails: audit, alerts and retention |
| Deletes that only hide chats (F-37), stores out of step (audit issue 2), leftovers after user delete (F-38, F-39) | Compliance hardening item 7 (deletion that reaches and re-checks every store) |
| Event log delete and silent failures (F-54, SMF-28, SMF-31) | Compliance hardening item 6; guardrail event write path |
| Partial and destructive settings saves, `.env` crash (F-45, F-47, SMF-10, SMF-29) | Compliance hardening item 9; Delivery prerequisites (audit issue 4) |

## Added to the plan as "Compliance hardening"

The nine gaps below are now planned in the "Compliance hardening" section of
`PLAN-per-account-model-access.md`. They're kept here so the review stays readable on
its own.

1. Encryption at rest of stored credentials (`.env` provider keys, SQL agent connection
   strings, OAuth tokens), and documented disk or volume encryption for `storage/`.
2. Idle session timeout, and moving the session token out of `localStorage` (for example
   an `HttpOnly` cookie).
3. Login rate limiting and lockout.
4. Narrowing CORS to the app's own origin, and tightening it per route for the embed.
5. Logging who viewed or exported which chat, workspace or document, and a separate
   compliance-reader role so admins don't need full chat access.
6. A tamper-evident audit log, or forwarding to a log store admins can't edit.
7. Deletion that covers everything: chats, documents, vectors, parsed files, memories,
   generated files, and caches.
8. An admin-only "HIPAA mode" that, in one setting, turns off or locks the features
   flagged High above unless a BAA flag is set for that vendor: telemetry, Telegram, web
   push content, Community Hub, imported plugins, cloud speech, web search, and
   uncovered providers.
9. Logging admin changes to the LLM, embedder and vector database settings with old and
   new values.

## Added to the plan as "Platform fixes from the repo map"

Found by the repo map and not covered by any other plan section. They're now planned as
platform fixes 1–14 in `PLAN-per-account-model-access.md`, placed in the access policy,
Google sign-in and compliance PRs (fixes 1 and 2 first; open decision 26 asks whether
they ship on their own). Kept here so the review stays readable on its own.

| Finding | Severity | Planned fix |
|---|---|---|
| Browser-extension key list returns each owner's password hash (F-02) | High | Select only id, username and role in `models/browserExtensionApiKey.js` |
| Collector internal-address block switched off from a browser request; literal-IPv4-only check (F-32, F-33) | High | Strip `runtimeSettings` in `forwardExtensionRequest`; resolve DNS and re-check after redirects |
| Any API key can add an MCP server that runs a host command (F-26) | High | Admin-owned keys only (fits "Scoped API keys"); off in HIPAA mode |
| Provider keys sent in plain text to the collector; replayable signatures (F-34) | Medium | Encrypt the payload; add a nonce and timestamp |
| Connector tokens copied into document JSON and every vector row (F-35) | Medium | Keep tokens only in `chunkSource`, encrypted; migrate existing copies |
| Global system prompt variables; every user's slash presets expanded (F-18) | Medium | Scope by `userId` |
| Generated files authorized per workspace, `/img` reads any file by name (F-19) | Medium | Authorize per chat owner; resolve names inside the owner's folder |
| Simple SSO `redirectTo` open redirect (F-11) | Medium | **Fixed in `169b68a0`**: only same-origin paths |
| Outlook OAuth without `state`, redirect URI from forwarded headers (F-30) | Medium | Add `state`; take the redirect URI from configuration |
| Web search falls back to keyless providers (F-31) | Low | No fallback; fail when no provider is set |
| Memory contents in the worker log (F-41) | Medium | Log counts, not contents |
| Event log actor recorded wrongly; invite codes logged in plain text (F-55) | Low | Log the actor; hash the code |
| `dumpENV` drops hand-added variables and truncates values (F-46); custom-model keys written before save (F-48) | Medium | Part of audit issue 4 |
| Managers can hard-delete every chat at once with no event log (F-15) | Medium | Admin only, and log it (fits Compliance hardening item 5) |

## Gaps in this review

- I read code and searched for patterns. I didn't run the app, test endpoints, or read
  every file. Vendor BAA availability isn't verified here; confirm it with each vendor.
- The repo map traced 241 user paths and 308 side effects, and the state-machine audit
  ran 8 of its findings as regression tests on its branch. The rest of the findings here
  come from reading code; those marked `map` in the register weren't re-read.
- The `embed/` and `browser-extension/` folders are empty submodules in this checkout.
  The embed widget was reviewed from its built file; the extension's client code wasn't
  read.
- Not reviewed in depth: the frontend for XSS, dependency vulnerabilities, the Docker
  image and its defaults, and the desktop app (including how it persists `.env`).
