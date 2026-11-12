# AnythingLLM: notes for Claude

AnythingLLM has three Node services: `server/` (Express API, Prisma on SQLite, agents,
background jobs), `collector/` (document parsing and fetching, port 8888) and `frontend/`
(React). `embed/` and `browser-extension/` are git submodules and may be empty in a
checkout.

## Read before changing behavior

A map of the whole repo lives in `docs/repo-map/`. It was written from the code at commit
`e82a80da` and covers every user path, state change and side effect. Use it to find what
a change touches before reading code, and check its claims against the code before
relying on them.

- `docs/repo-map/README.md`: index, the "where do I look for…" table, and how to keep
  the map current. Start here.
- `docs/repo-map/00-system-model.md`: processes, trust boundaries, actors, the five flows
  (configure, ingest, ask, act, background), state layers, and the invariants the code
  relies on, with where each breaks.
- Domain files, one per area. Each lists entry points, user paths (`P-<DOMAIN>-NN`),
  what each path reads and writes, failure modes, and a side-effect ledger:
  - `01-auth-and-users.md`: setup, single- and multi-user modes, login, sessions, SSO,
    invites, roles, recovery, API, extension and mobile keys.
  - `02-workspaces-and-chat.md`: workspaces, threads, the chat pipeline, history, model
    routers.
  - `03-documents-and-ingestion.md`: collector, uploads, connectors, embedding, vectors,
    sync, cleanup.
  - `04-agents-tools-and-automation.md`: agent sessions, skills, tool approvals, MCP,
    flows, plugins, memories, scheduled jobs.
  - `05-external-channels.md`: developer API, OpenAI-compatible API, embed widget,
    Telegram, mobile, browser extension.
  - `06-admin-system-and-runtime.md`: boot, settings, `updateENV`, event logs, telemetry,
    caches, background jobs.
  - `07-frontend-routes-and-flows.md`: routes, page actions traced to endpoints, client
    state, and places where the UI gate differs from server enforcement (§4.1).
- `docs/repo-map/08-state-stores.md`: every table, storage folder, env variable, setting
  label, cache and browser key, with the data lifecycle matrix.
- `docs/repo-map/09-findings-register.md`: known bugs and security gaps (`F-01`…`F-57`)
  by theme and severity, with evidence. The "checked" column says whether a finding was
  confirmed in code (`yes`) or only from the map (`map`).
- `docs/repo-map/12-state-machines.md`: the explicit and implicit state machines
  (`SM-…`), their invariants and transition tables, the state × event × side-effect
  table, reachable invalid states (`SMF-01`…`SMF-40`) and the issues they group into. It
  arrives with branch `claude/state-machine-audit-23070d`; until that merges, read it with
  `git show refs/heads/claude/state-machine-audit-23070d:docs/repo-map/12-state-machines.md`.
- Generated indexes: `10-path-index.md` (every path ID) and `11-side-effects-by-class.md`
  (every side effect grouped by class: DB, FS, VEC, NET, PROC, WS, PUSH, ENV, CACHE, LOG,
  TEL, TIME).

`REVIEW-features-and-hipaa-risks.md` (repo root) lists every feature with its data,
security and HIPAA risk, the top risks ranked, and which findings are still open. Read it
before touching auth, sessions, API keys, agents, MCP, the collector, deletion, logging or
any feature that sends data to an outside vendor.

## Keeping the map current

- When a change alters a user path, state transition or side effect, update the matching
  domain file and, for state changes, `12-state-machines.md`. Follow
  `docs/repo-map/CONVENTIONS.md` for IDs, section layout and side-effect classes.
- When a change fixes a finding, mark it fixed in `09-findings-register.md` (and the SMF
  entry, if any) with the commit and the regression test, and update the review's entry.
- After editing the map, regenerate the indexes and check that links resolve:

```bash
python3 -I docs/repo-map/tools/build_indexes.py docs/repo-map
```

## Things the map found that are easy to get wrong

- Deleting a chat, thread or user only hides chats (`include=false`); the rows stay.
- Role and suspension are read from the database on every request, but sessions can't be
  revoked.
- Developer API keys have no owner or scope; every `/v1` route runs with admin power.
- `updateENV` applies settings key by key and stops at the first error, after earlier
  keys and their reset hooks have run.
- A document's database rows, vectors, JSON file and vector cache are written separately;
  keep them in step and re-check after deletes.
- Many bugs in the audit were check-then-write races. Use conditional writes
  (`updateMany`/`deleteMany` and act on the count) or transactions for claims, limits and
  single-use tokens, and test two concurrent calls.
