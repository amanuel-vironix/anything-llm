/* eslint-env jest */
process.env.NODE_ENV = "test";
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.STORAGE_DIR =
  process.env.STORAGE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "allm-teams-"));

const { createTestPrisma } = require("../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../utils/prisma", () => mockDb.prisma);

// Session auth stands in for the real JWT check: the `x-test-user` header names the
// signed-in user, read fresh from the database like validatedRequest does.
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: async (request, response, next) => {
    const id = Number(request.header("x-test-user"));
    response.locals.multiUserMode = true;
    const user = id
      ? await mockDb.prisma.users.findUnique({ where: { id } })
      : null;
    if (!user) return response.sendStatus(401).end();
    response.locals.user = user;
    next();
  },
}));
jest.mock("../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn() },
}));

const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const { teamEndpoints } = require("../../endpoints/teams");
const { accessPolicyEndpoints } = require("../../endpoints/accessPolicies");
const { Team } = require("../../models/team");
const { Workspace } = require("../../models/workspace");
const { SlashCommandPresets } = require("../../models/slashCommandsPresets");
const { SystemPromptVariables } = require("../../models/systemPromptVariables");
const { getPolicyForUser } = require("../../utils/accessPolicy");
const {
  agentToolAccessForUser,
} = require("../../utils/accessPolicy/agentTools");

const prisma = mockDb.prisma;
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(bodyParser.json());
  teamEndpoints(app);
  accessPolicyEndpoints(app);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mockDb.cleanup();
});

let seq = 0;
const makeUser = (data = {}) =>
  prisma.users.create({
    data: { username: `tuser${++seq}`, password: "x", role: "default", ...data },
  });
const makeTeam = async (data = {}) =>
  (await Team.create({ name: `team-${++seq}`, ...data })).team;

async function call(user, method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": String(user?.id ?? ""),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json };
}

async function eventCount(event) {
  return prisma.event_logs.count({ where: { event } });
}

/** A team with one lead; returns { team, lead }. */
async function teamWithLead() {
  const team = await makeTeam();
  const lead = await makeUser();
  await Team.addMember(team.id, lead.id, { role: "lead" });
  return { team, lead };
}

describe("team lead permissions (AC 33)", () => {
  it("a lead adds and removes default-role users on their team, and each action is logged", async () => {
    const { team, lead } = await teamWithLead();
    const newcomer = await makeUser();
    const added = await call(lead, "POST", `/teams/${team.id}/members`, {
      userId: newcomer.id,
    });
    expect(added.status).toBe(200);
    expect(await eventCount("team_member_added")).toBeGreaterThan(0);

    const removed = await call(
      lead,
      "DELETE",
      `/teams/${team.id}/members/${newcomer.id}`
    );
    expect(removed.status).toBe(200);
    expect(await Team.membershipFor(newcomer.id)).toBeNull();
    expect(await eventCount("team_member_removed")).toBeGreaterThan(0);
  });

  it("a lead can't add a manager or admin to their team", async () => {
    const { team, lead } = await teamWithLead();
    const manager = await makeUser({ role: "manager" });
    const res = await call(lead, "POST", `/teams/${team.id}/members`, {
      userId: manager.id,
    });
    expect(res.status).toBe(403);
    expect(await Team.membershipFor(manager.id)).toBeNull();
  });

  it("a lead can't manage another team", async () => {
    const { lead } = await teamWithLead();
    const { team: other } = await teamWithLead();
    const outsider = await makeUser();
    expect(
      (await call(lead, "GET", `/teams/${other.id}/members`)).status
    ).toBe(403);
    expect(
      (
        await call(lead, "POST", `/teams/${other.id}/members`, {
          userId: outsider.id,
        })
      ).status
    ).toBe(403);
    expect(
      (await call(lead, "POST", `/teams/${other.id}/workspaces/new`, { name: "x" }))
        .status
    ).toBe(403);
  });

  it("a plain member can't use lead routes", async () => {
    const { team } = await teamWithLead();
    const member = await makeUser();
    await Team.addMember(team.id, member.id);
    expect(
      (await call(member, "GET", `/teams/${team.id}/members`)).status
    ).toBe(403);
  });

  it("a lead can't touch admin routes: policies, teams, workspace moves, user policy", async () => {
    const { team, lead } = await teamWithLead();
    expect((await call(lead, "GET", "/admin/teams")).status).toBe(401);
    expect(
      (await call(lead, "POST", `/admin/teams/${team.id}`, { name: "renamed" }))
        .status
    ).toBe(401);
    expect(
      (await call(lead, "POST", "/admin/access-policies/new", { name: "p" }))
        .status
    ).toBe(401);
    expect(
      (
        await call(lead, "POST", `/admin/users/${lead.id}/policy`, {
          policyId: null,
        })
      ).status
    ).toBe(401);
  });

  it("the last lead can't leave or be demoted while members remain; an admin can", async () => {
    const { team, lead } = await teamWithLead();
    const member = await makeUser();
    await Team.addMember(team.id, member.id);
    expect(
      (await call(lead, "DELETE", `/teams/${team.id}/members/${lead.id}`)).status
    ).toBe(403);
    expect(
      (
        await call(lead, "POST", `/teams/${team.id}/members/${lead.id}/role`, {
          role: "member",
        })
      ).status
    ).toBe(400);
    const admin = await makeUser({ role: "admin" });
    expect(
      (await call(admin, "DELETE", `/teams/${team.id}/members/${lead.id}`)).status
    ).toBe(200);
  });

  it("a lead can't remove themselves, even when another lead remains", async () => {
    const { team, lead } = await teamWithLead();
    const other = await makeUser();
    await Team.addMember(team.id, other.id, { role: "lead" });
    const res = await call(lead, "DELETE", `/teams/${team.id}/members/${lead.id}`);
    expect(res.status).toBe(403);
    expect((await Team.membershipFor(lead.id))?.team_id).toBe(team.id);
  });

  it("a lead can't remove, demote or promote a manager an admin put on the team", async () => {
    const { team, lead } = await teamWithLead();
    const manager = await makeUser({ role: "manager" });
    await Team.addMember(team.id, manager.id, { role: "lead" });
    expect(
      (await call(lead, "DELETE", `/teams/${team.id}/members/${manager.id}`)).status
    ).toBe(403);
    expect(
      (
        await call(lead, "POST", `/teams/${team.id}/members/${manager.id}/role`, {
          role: "member",
        })
      ).status
    ).toBe(403);
    expect((await Team.membershipFor(manager.id)).role).toBe("lead");
    const admin = await makeUser({ role: "admin" });
    expect(
      (await call(admin, "DELETE", `/teams/${team.id}/members/${manager.id}`)).status
    ).toBe(200);
  });

  it("a removed member's shared presets return to them and leave the team", async () => {
    const { team, lead } = await teamWithLead();
    const member = await makeUser();
    await Team.addMember(team.id, member.id);
    const shared = (
      await SlashCommandPresets.create(
        member.id,
        { command: "/leaver", prompt: "p", description: "d" },
        { teamId: team.id }
      )
    );
    expect(shared).toBeTruthy();
    const res = await call(lead, "DELETE", `/teams/${team.id}/members/${member.id}`);
    expect(res.status).toBe(200);
    const rows = await prisma.slash_command_presets.findMany({
      where: { uid: member.id, command: "/leaver" },
    });
    expect(rows.map((r) => r.team_id)).toEqual([0]);
    const leadSees = await SlashCommandPresets.getUserPresets(lead.id);
    expect(leadSees.map((p) => p.command)).not.toContain("/leaver");
  });

  it("a lead makes another member a lead, logged as team_lead_changed", async () => {
    const { team, lead } = await teamWithLead();
    const member = await makeUser();
    await Team.addMember(team.id, member.id);
    const res = await call(
      lead,
      "POST",
      `/teams/${team.id}/members/${member.id}/role`,
      { role: "lead" }
    );
    expect(res.status).toBe(200);
    expect((await Team.membershipFor(member.id)).role).toBe("lead");
    expect(await eventCount("team_lead_changed")).toBeGreaterThan(0);
  });

  it("a lead creates a team workspace that members can open and outsiders can't", async () => {
    const { team, lead } = await teamWithLead();
    const member = await makeUser();
    await Team.addMember(team.id, member.id);
    const outsider = await makeUser();
    const res = await call(lead, "POST", `/teams/${team.id}/workspaces/new`, {
      name: "Team space",
    });
    expect(res.status).toBe(200);
    const slug = res.body.workspace.slug;
    expect(res.body.workspace.team_id).toBe(team.id);
    expect(await Workspace.getWithUser(member, { slug })).not.toBeNull();
    expect(await Workspace.getWithUser(outsider, { slug })).toBeNull();
    expect(
      (await Workspace.whereWithUser(member)).map((w) => w.slug)
    ).toContain(slug);
    expect(await eventCount("team_workspace_created")).toBeGreaterThan(0);
  });

  it("a lead edits only safe settings on their team's workspace", async () => {
    const { team, lead } = await teamWithLead();
    const { workspace } = await Workspace.new(`ws-${++seq}`);
    await Workspace.setTeam(workspace.id, team.id);
    const res = await call(
      lead,
      "POST",
      `/teams/${team.id}/workspaces/${workspace.slug}/update`,
      { openAiTemp: 0.2, chatProvider: "anthropic", chatModel: "x" }
    );
    expect(res.status).toBe(200);
    const after = await prisma.workspaces.findUnique({
      where: { id: workspace.id },
    });
    expect(after.openAiTemp).toBe(0.2);
    expect(after.chatProvider).toBeNull();

    const { workspace: notTeam } = await Workspace.new(`ws-${++seq}`);
    expect(
      (
        await call(
          lead,
          "POST",
          `/teams/${team.id}/workspaces/${notTeam.slug}/update`,
          { openAiTemp: 0.9 }
        )
      ).status
    ).toBe(404);
  });

  it("moving a workspace between teams is admin only", async () => {
    const { team, lead } = await teamWithLead();
    const { workspace } = await Workspace.new(`ws-${++seq}`);
    expect(
      (
        await call(lead, "POST", `/admin/workspaces/${workspace.slug}/team`, {
          teamId: team.id,
        })
      ).status
    ).toBe(401);
    const admin = await makeUser({ role: "admin" });
    const res = await call(
      admin,
      "POST",
      `/admin/workspaces/${workspace.slug}/team`,
      { teamId: team.id }
    );
    expect(res.status).toBe(200);
    expect(res.body.workspace.team_id).toBe(team.id);
  });
});

describe("team policy resolution (AC 31)", () => {
  it("a member gets the team's policy on the next request; their own policy wins", async () => {
    const admin = await makeUser({ role: "admin" });
    const teamPolicy = (
      await call(admin, "POST", "/admin/access-policies/new", {
        name: `team-p-${++seq}`,
        allowed_models: [{ provider: "openai", model: "gpt-4o-mini" }],
      })
    ).body.policy;
    const ownPolicy = (
      await call(admin, "POST", "/admin/access-policies/new", {
        name: `own-p-${++seq}`,
        allowed_models: null,
      })
    ).body.policy;
    const team = await makeTeam({ policy_id: teamPolicy.id });
    const [plain, special] = [await makeUser(), await makeUser()];
    expect(await getPolicyForUser(plain)).toBeNull();

    await Team.addMember(team.id, plain.id);
    await Team.addMember(team.id, special.id);
    expect((await getPolicyForUser(plain)).id).toBe(teamPolicy.id);

    const assigned = await call(admin, "POST", `/admin/users/${special.id}/policy`, {
      policyId: ownPolicy.id,
    });
    expect(assigned.status).toBe(200);
    expect((await getPolicyForUser(special)).id).toBe(ownPolicy.id);
    expect(await eventCount("policy_assigned")).toBeGreaterThan(0);
  });
});

describe("sharing a skill with one team (AC 32)", () => {
  it("offers a role-default-denied skill to exactly the chosen team", async () => {
    const admin = await makeUser({ role: "admin" });
    await call(admin, "POST", "/admin/agent-tool-role-policy", {
      default: { allow: null, deny: ["web-scraping"] },
    });
    const [shared, other] = [await makeTeam(), await makeTeam()];
    const [inShared, inOther, noTeam] = [
      await makeUser(),
      await makeUser(),
      await makeUser(),
    ];
    await Team.addMember(shared.id, inShared.id);
    await Team.addMember(other.id, inOther.id);

    const res = await call(admin, "POST", "/admin/agent-tool-sharing", {
      tool: "web-scraping",
      teamIds: [shared.id],
    });
    expect(res.status).toBe(200);

    expect((await agentToolAccessForUser(inShared)).isAllowed("web-scraping")).toBe(
      true
    );
    expect((await agentToolAccessForUser(inOther)).isAllowed("web-scraping")).toBe(
      false
    );
    expect((await agentToolAccessForUser(noTeam)).isAllowed("web-scraping")).toBe(
      false
    );
    // The shared team didn't gain anything else the role default withholds.
    const teamRow = await prisma.teams.findUnique({ where: { id: shared.id } });
    const policy = await prisma.access_policies.findUnique({
      where: { id: teamRow.policy_id },
    });
    expect(policy.allowed_models).toBeNull();

    const listing = await call(
      admin,
      "GET",
      "/admin/agent-tool-sharing?tool=web-scraping"
    );
    const byId = Object.fromEntries(
      listing.body.teams.map((t) => [t.teamId, t.shared])
    );
    expect(byId[shared.id]).toBe(true);
    expect(byId[other.id]).toBe(false);

    // Unsharing takes it away again.
    await call(admin, "POST", "/admin/agent-tool-sharing", {
      tool: "web-scraping",
      teamIds: [],
    });
    expect((await agentToolAccessForUser(inShared)).isAllowed("web-scraping")).toBe(
      false
    );
    await call(admin, "POST", "/admin/agent-tool-role-policy", {});
  });

  it("leaves teams without their own rule alone when sharing (no policies created for them)", async () => {
    const admin = await makeUser({ role: "admin" });
    await call(admin, "POST", "/admin/agent-tool-role-policy", {});
    const [shared, bystander] = [await makeTeam(), await makeTeam()];
    const res = await call(admin, "POST", "/admin/agent-tool-sharing", {
      tool: "sql-agent",
      teamIds: [shared.id],
    });
    expect(res.status).toBe(200);
    const bystanderRow = await prisma.teams.findUnique({
      where: { id: bystander.id },
    });
    expect(bystanderRow.policy_id).toBeNull();
  });

  it("rejects an invalid role default rule", async () => {
    const admin = await makeUser({ role: "admin" });
    const res = await call(admin, "POST", "/admin/agent-tool-role-policy", {
      default: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("shared presets and variables", () => {
  it("members see team presets; a personal preset with the same command wins", async () => {
    const { team, lead } = await teamWithLead();
    const member = await makeUser();
    await Team.addMember(team.id, member.id);
    await SlashCommandPresets.create(
      lead.id,
      { command: "/summary", prompt: "team prompt", description: "" },
      { teamId: team.id }
    );
    let presets = await SlashCommandPresets.getUserPresets(member.id);
    expect(presets.find((p) => p.command === "/summary").prompt).toBe(
      "team prompt"
    );
    await SlashCommandPresets.create(member.id, {
      command: "/summary",
      prompt: "mine",
      description: "",
    });
    presets = await SlashCommandPresets.getUserPresets(member.id);
    const summaries = presets.filter((p) => p.command === "/summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].prompt).toBe("mine");

    const outsider = await makeUser();
    expect(
      (await SlashCommandPresets.getUserPresets(outsider.id)).find(
        (p) => p.command === "/summary"
      )
    ).toBeUndefined();
  });

  it("only the owner, a lead of the preset's team or an admin may edit a shared preset", async () => {
    const { team, lead } = await teamWithLead();
    const [owner, peer] = [await makeUser(), await makeUser()];
    await Team.addMember(team.id, owner.id);
    await Team.addMember(team.id, peer.id);
    const preset = await SlashCommandPresets.create(
      owner.id,
      { command: `/p${++seq}`, prompt: "x", description: "" },
      { teamId: team.id }
    );
    expect(await SlashCommandPresets.editableBy(preset.id, owner)).not.toBeNull();
    expect(await SlashCommandPresets.editableBy(preset.id, lead)).not.toBeNull();
    expect(await SlashCommandPresets.editableBy(preset.id, peer)).toBeNull();
  });

  it("team variables are seen by that team only", async () => {
    const { team, lead } = await teamWithLead();
    const outsider = await makeUser();
    await SystemPromptVariables.create({
      key: `team_var_${++seq}`,
      value: "v",
      teamId: team.id,
      userId: lead.id,
    });
    const key = `team_var_${seq}`;
    const leadKeys = (await SystemPromptVariables.getAll(lead.id)).map((v) => v.key);
    const outsiderKeys = (await SystemPromptVariables.getAll(outsider.id)).map(
      (v) => v.key
    );
    expect(leadKeys).toContain(key);
    expect(outsiderKeys).not.toContain(key);
  });
});

describe("no teams (AC 34)", () => {
  it("workspace access, presets and policy are unchanged for users without a team", async () => {
    const user = await makeUser();
    const { workspace } = await Workspace.new(`plain-${++seq}`);
    expect(await Workspace.getWithUser(user, { slug: workspace.slug })).toBeNull();
    await prisma.workspace_users.create({
      data: { user_id: user.id, workspace_id: workspace.id },
    });
    expect(
      await Workspace.getWithUser(user, { slug: workspace.slug })
    ).not.toBeNull();
    expect(await getPolicyForUser(user)).toBeNull();
    await SlashCommandPresets.create(user.id, {
      command: "/mine",
      prompt: "p",
      description: "",
    });
    expect(
      (await SlashCommandPresets.getUserPresets(user.id)).map((p) => p.command)
    ).toEqual(["/mine"]);
  });
});
