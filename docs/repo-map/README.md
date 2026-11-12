# AnythingLLM repo map

A reference map of every user path, state change and side effect in this repository,
written from the code at commit `e82a80da` (2026-11-10). It's meant to be read before
changing behavior, reviewing a PR, or answering "what happens when…".

Everything here comes from reading code. Nothing was run. Claims that weren't confirmed
from the code are marked **(unverified)** and listed in each file's last section.

## Start here

1. [00-system-model.md](00-system-model.md): the whole system on one page. It covers
   processes, trust boundaries, actors, resource lifecycles, the five flows, state layers,
   and the invariants the code relies on (with where each breaks).
2. [09-findings-register.md](09-findings-register.md): 57 bugs, security gaps and
   inconsistencies found while mapping, by theme and severity, each linked to its evidence.
3. Then the domain file for the area you're touching.

## Files

| File | Covers | Paths | Side effects |
|---|---|---|---|
| [CONVENTIONS.md](CONVENTIONS.md) | the section layout, ID scheme and side-effect classes every file uses | — | — |
| [00-system-model.md](00-system-model.md) | abstract model of the whole system | — | — |
| [01-auth-and-users.md](01-auth-and-users.md) | setup, modes, login, sessions, SSO, invites, users, roles, recovery, API, extension and mobile keys | 30 | 46 |
| [02-workspaces-and-chat.md](02-workspaces-and-chat.md) | workspaces, threads, the 13-stage chat pipeline, history, export, model routers | 30 | 47 |
| [03-documents-and-ingestion.md](03-documents-and-ingestion.md) | collector, uploads, links, connectors, storage, embedding, vectors, sync, cleanup | 26 | 34 |
| [04-agents-tools-and-automation.md](04-agents-tools-and-automation.md) | agent sessions, every skill, approvals, MCP, flows, plugins, Community Hub, memories, scheduled jobs, push | 35 | 47 |
| [05-external-channels.md](05-external-channels.md) | developer API, OpenAI-compatible API, embed widget, Telegram, mobile, browser extension | 43 | 57 |
| [06-admin-system-and-runtime.md](06-admin-system-and-runtime.md) | boot, every setting and its side effects, `updateENV`, event logs, telemetry, caches, jobs | 34 | 54 |
| [07-frontend-routes-and-flows.md](07-frontend-routes-and-flows.md) | every route, page actions traced to endpoints, client state, UI-versus-server guard mismatches | 43 | 23 |
| [08-state-stores.md](08-state-stores.md) | every table, storage folder, env variable, setting label, cache and browser key; the data lifecycle matrix | catalogue | — |
| [09-findings-register.md](09-findings-register.md) | consolidated findings | — | — |
| [10-path-index.md](10-path-index.md) | generated: every path ID with a link | 241 | — |
| [11-side-effects-by-class.md](11-side-effects-by-class.md) | generated: every ledger row grouped by class (DB, NET, FS…) | — | 308 |

## IDs

| Prefix | Meaning | Example |
|---|---|---|
| `P-<DOMAIN>-NN` | a user path | `P-CHAT-10` (send a chat) |
| `E-<DOMAIN>-NN` | an entry point row (route, event, job) | `E-AUTH-05` |
| `SE-<DOMAIN>-NN` | a side-effect ledger row | `SE-DOC-02` |
| `F-NN` | a finding in the register; `F-1`… in file 07 are that file's own UI mismatch list | `F-32` |

Domains are `AUTH`, `CHAT`, `DOC`, `AGENT`, `EXT`, `ADMIN`, `UI` and `STATE`. The
side-effect classes are defined in [CONVENTIONS.md](CONVENTIONS.md).

## Finding things

| Question | Go to |
|---|---|
| What does this endpoint do and change? | the domain file's entry-point table (section 3), then its path |
| What calls this endpoint from the UI? | [07](07-frontend-routes-and-flows.md) |
| Who writes or deletes this table or folder? | [08](08-state-stores.md), then search [11](11-side-effects-by-class.md) for its name |
| Which settings are destructive? | [06](06-admin-system-and-runtime.md) section 2 |
| Where does data leave the server? | the `NET` section of [11](11-side-effects-by-class.md) |
| What does deleting X actually remove? | [08](08-state-stores.md) data lifecycle matrix and [03](03-documents-and-ingestion.md) section 4 |
| Can role R do action A? | [01](01-auth-and-users.md) role matrix, [02](02-workspaces-and-chat.md) section 4, [07](07-frontend-routes-and-flows.md) section 4.1 |
| Does a channel skip a check the UI applies? | [05](05-external-channels.md) section 2 |

## Keeping it current

- When behavior changes, update the path, entry-point row and ledger rows in the domain
  file, following [CONVENTIONS.md](CONVENTIONS.md). Bump the commit noted at the top of
  the file.
- Regenerate the two generated indexes from the repo root:

  ```bash
  python3 -I docs/repo-map/tools/build_indexes.py docs/repo-map
  ```

- When a finding is fixed, mark it in [09](09-findings-register.md) with the PR, rather
  than deleting the row.

## Known limits

- The `embed/` and `browser-extension/` folders are git submodules and aren't checked out
  in this worktree. The embed widget was read from its built bundle in
  `frontend/public/embed/`; the extension's client code wasn't read.
- Some citations are relative to `server/` or `frontend/src/` rather than the repo root,
  where the surrounding text makes the base clear.
- Vector database providers other than LanceDB, and the internals of some connectors and
  search providers, were read only where they write data or call out.
- The Gmail and Google Calendar integrations use a user-deployed Apps Script bridge, not
  OAuth. Outlook uses OAuth.

## Related documents

- `PLAN-per-account-model-access.md` (repo root): plan for per-account access, Google
  sign-in, guardrails and HIPAA hardening.
- `REVIEW-features-and-hipaa-risks.md` (repo root): feature inventory with data,
  security and HIPAA risks.
