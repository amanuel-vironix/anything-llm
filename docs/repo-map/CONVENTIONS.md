# Repo map conventions

Every domain file in `docs/repo-map/` follows this shape, so the files can be read and
cross-referenced the same way. Verified against commit `e82a80da`.

## File sections, in this order

1. **Title and scope.** One paragraph: what the domain covers and what it leaves to other
   files. A "Sources" line listing the main directories and files read.
2. **Mental model.** The domain described abstractly before any detail: the actors, the
   resources they act on, the lifecycle of each resource, and the invariants the code
   relies on (for example "a thread always belongs to exactly one workspace"). Name the
   underlying pattern where there is one (pipeline, state machine, registry, pub/sub,
   cache-aside). A Mermaid diagram is welcome when it says more than prose.
3. **Entry points.** A table of every way into the domain:
   `| ID | Channel | Method + path / event / job | Middleware chain | Handler (path:line) | Who can call |`.
   Channels: `ui`, `api` (developer API `/v1`), `openai` (`/v1/openai`), `embed`,
   `telegram`, `mobile`, `extension`, `ws` (websocket), `job` (background or scheduled),
   `boot`, `collector`.
4. **User paths.** One subsection per path, ID `P-<DOMAIN>-NN`, with:
   - **Actor and preconditions** (role, mode: single-user or multi-user, settings needed)
   - **Steps**: UI route or caller → endpoint → middleware → main functions, with
     `path:line` for each hop
   - **Reads**: stores read
   - **State changes**: each write as `store.field: before → after` (or "row created",
     "row deleted", "file written")
   - **Side effects**: tagged with the classes below
   - **Failure and edge paths**: what happens on bad input, missing permissions, provider
     errors, partial failure; whether anything is left half-done
   - **Notes**: anything surprising, risky or inconsistent
5. **State machines.** Each entity with a status or lifecycle (for example a scheduled job
   run, a document sync queue entry, a user's suspension): states, transitions, what
   triggers each, and what code performs it.
6. **Side-effect ledger.** One table of every side effect found in the domain:
   `| ID | Trigger (path ID or entry ID) | Class | Target | Where (path:line) | Reversible? | Notes |`.
   IDs are `SE-<DOMAIN>-NN`.
7. **Cross-domain links.** Where this domain hands off to another file (use the other
   file's path IDs where known).
8. **Open questions and unverified points.** Anything not confirmed from code.

## Side-effect classes

| Class | Meaning |
|---|---|
| `DB` | Prisma write to a table (name the table) |
| `FS` | File or directory written, moved or deleted (name the path under `storage/` or elsewhere) |
| `VEC` | Vector database write or delete |
| `NET:<target>` | Outbound network call (name the vendor or host, e.g. `NET:llm-provider`, `NET:posthog`, `NET:collector`) |
| `PROC` | Child process spawned or worker thread started |
| `WS` | Message pushed over a websocket or server-sent event stream |
| `PUSH` | Web push, Telegram message, email or other notification to a person |
| `ENV` | `process.env` changed and/or `.env` rewritten |
| `CACHE` | In-memory cache filled or invalidated |
| `LOG` | `event_logs` row, or other audit record |
| `TEL` | Telemetry event |
| `TIME` | Scheduling: a cron, timer or queue entry created or removed |

## Rules

- Cite `path:line` (paths relative to the repo root, e.g. `server/endpoints/chat.js:54`)
  for every claim about behavior. Don't describe behavior you haven't read.
- Mark anything inferred rather than read as **(unverified)** and list it in section 8.
- Note mode differences (single-user vs multi-user) and role differences explicitly.
- Prefer tables and short bullets over prose. Don't paste code blocks longer than a few
  lines.
- Domain prefixes: `AUTH`, `CHAT`, `DOC`, `AGENT`, `EXT`, `ADMIN`, `UI`, `STATE`.
