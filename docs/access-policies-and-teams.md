# Access policies, teams and scoped API keys: admin guide

This guide covers what an administrator can control per account in multi-user mode: which
models a person can use, whether they can use agents and which tools, which workspaces a
developer API key reaches, and how teams share workspaces, presets, variables and tools.
Everything here is off until you configure it: with no policies, no teams and no role
defaults, every user behaves exactly as before.

## Requirements

- **Multi-user mode.** Policies, teams and key owners attach to users, so they apply only
  in multi-user mode. In single-user mode there are no users: chats, agents and API keys
  behave as before, and a key can still be limited to some workspaces and given an expiry.
- **Telegram** runs only in single-user mode, so policies and tool rules never apply to it.

## Access policies

Settings → Access policies (admins only). A policy sets:

| Field | Meaning |
|---|---|
| Allowed models | A list of provider + model pairs. `*` as the model allows every model of that provider. Turn "Restrict models" off (stored as null) for a policy that only controls tools or a router. An empty list allows no model at all. |
| Default provider and model | Used instead of a workspace's model when that model isn't allowed. It must itself be allowed. With no default, the chat is refused with "model not allowed". |
| Router | Sends every chat and agent session of this account through that model router. A routed model the policy doesn't allow is swapped for the default before it is called. |
| Allow agents | Off: `@agent` is refused, and automatic mode answers as a normal chat. |
| Agent tools | The account's tool rule (below). Empty means "use the team's rule, then the role default". |

**Which policy applies:** the user's own policy (assigned on the Users page, admins only),
otherwise their team's policy, otherwise none. The policy is read on every request, so a
change takes effect on the user's next message. Admins without a policy keep every model
and tool.

Deleting a policy unassigns it from its users and teams; they fall back to the next level.

## Agent tool rules

A rule has an **allow** list (or "all tools") and a **deny** list. A tool is offered only
if it is allowed and not denied. Entries:

| Entry | Matches |
|---|---|
| `web-browsing`, `sql-agent`, … | a built-in skill |
| `parent#child` | one sub-skill |
| `@@flow_<uuid>` | an agent flow |
| `@@<hubId>` | an imported plugin |
| `@@mcp_<server>` | every tool of an MCP server |
| `<server>:<tool>` | one MCP tool |
| `*` | everything |

The editor lists installed tools by name, so you don't type these by hand.

**Where a user's rule comes from** (first match wins): their own policy's rule, their
team policy's rule, the **role default** for their role (Access policies → Role defaults:
one rule for `manager`, one for `default`), then no restriction.

**MCP servers** can also carry `"anythingllm": { "allowedRoles": ["admin", "manager"] }`
in their config next to `autoStart`. That is checked in addition to the rules, so the
restriction stays with the server. Servers whose process has died are no longer offered.

Rules filter what the agent is offered and re-check each tool as it is attached. They
don't stop MCP servers from starting: servers still boot once for the whole instance.

## Teams

Settings → Teams. A team is a set of users (each user is on at most one team) with:

- **a policy** that applies to every member who has no policy of their own;
- **workspaces** it owns, which every member can open;
- **shared slash commands and prompt variables**;
- **leads**, who manage the team without being instance managers.

**Admins** create, rename and delete teams, choose a team's policy, store a Google Group
for later group sync (not synced yet), add any user, and give a workspace to a team or
detach it (Teams page, or `POST /admin/workspaces/:slug/team`).

**Team leads** can, for their own team only:

- add active users with the `default` role who are on no team, and remove members;
- make a member a lead, or a lead a member;
- create team workspaces and edit their prompt, temperature, history, similarity, topN,
  chat mode and refusal text (not the provider or model);
- create and edit prompt variables and edit slash commands shared with the team.

Leads can't change anyone's role, policy or suspension, edit the team's policy, see
other teams, or read members' chats. A team with members always keeps at least one lead,
unless an admin removes them. Every lead action is in the event log
(`team_member_added`, `team_member_removed`, `team_lead_changed`,
`team_workspace_created`, `team_workspace_updated`).

**Deleting a team** removes the memberships (members fall back to their own policy or
role default), makes the team's workspaces admin-only (add people back directly if
needed), and returns shared commands and variables to their owners.

Admins and managers still see every workspace; teams don't narrow that.

### Sharing a tool with a team

To give one team a skill nobody else gets: deny it in the `default` role rule, then in
Access policies → "Share a tool with teams" tick that team. This edits the team policy's
rule (starting from the `default` role rule if the team had none, so the team gains only
that tool), and creates a policy for a team that has none (with no model restriction). If
the team's policy is also used by other teams or users, they get the change too; the page
warns you.

Installing skills, flows and MCP servers stays admin-only, as before.

### Shared slash commands and prompt variables

Tick "Share with my team" when creating a slash command: teammates see it next to their
own. If someone has a personal command with the same name, theirs wins. The owner, a team
lead or an admin can edit or delete it. Prompt variables created by a lead belong to the
team and are visible only to its members; variables created by admins without a team are
global, as before.

## Developer API keys

Each key in multi-user mode has an **owner** and runs as that person: their role, policy,
workspaces and daily message limit apply, and chats are saved under them.

- **Owner:** defaults to the admin who creates the key. A default-role owner can chat in
  their workspaces and threads; managers can also manage workspaces and documents; only
  admin-owned keys reach `/v1/admin/*`, `/v1/system/*`, `/v1/users*`, `/v1/embed*` and
  `/v1/mcp-servers*`. Any `/v1` route not explicitly opened to other roles is admin-only.
- **Workspace scope:** optionally limit a key to some workspaces, within what its owner
  can already reach.
- **Expiry:** optional; expired keys are refused.
- **Legacy keys** (created before this change, with no owner) are refused in multi-user
  mode as soon as this version runs. Assign an owner on the API keys page to keep one
  working, or issue a new key. Refusals are logged as `legacy_api_key_refused`.
- A `userId` sent in an API thread request is ignored for owned keys.

## Mobile devices

When pairing a phone in multi-user mode, choose the user it belongs to; the device then
chats as that user with their policy and daily limit. Devices paired before this change
with no user are refused and must be paired again.

## Event log names

`policy_created`, `policy_updated`, `policy_deleted`, `policy_assigned`,
`role_default_updated`, `team_created`, `team_updated`, `team_deleted`,
`team_member_added`, `team_member_removed`, `team_lead_changed`,
`team_workspace_created`, `team_workspace_updated`, `workspace_team_changed`,
`api_key_created`, `api_key_updated`, `legacy_api_key_refused`,
`api_key_expired_refused`, `model_refused_by_policy`, `tool_refused_by_policy`,
`agent_ws_rejected`, `model_router_deleted`.
