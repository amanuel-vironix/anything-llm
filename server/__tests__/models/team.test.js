process.env.NODE_ENV = "test";

const { createTestPrisma } = require("../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../utils/prisma", () => mockDb.prisma);

const { Team } = require("../../models/team");
const { AccessPolicy } = require("../../models/accessPolicy");

const prisma = mockDb.prisma;
afterAll(() => mockDb.cleanup());

let seq = 0;
const makeUser = (role = "default") =>
  prisma.users.create({ data: { username: `u${++seq}`, password: "x", role } });
const makeTeam = async () => (await Team.create({ name: `team-${++seq}` })).team;

describe("Team membership", () => {
  it("refuses a second team for the same user (one team per user)", async () => {
    const [a, b, user] = [await makeTeam(), await makeTeam(), await makeUser()];
    expect((await Team.addMember(a.id, user.id)).error).toBeNull();
    expect((await Team.addMember(b.id, user.id)).error).toMatch(/already belongs/);
  });

  it("two concurrent adds of one user to two teams leave exactly one membership", async () => {
    const [a, b, user] = [await makeTeam(), await makeTeam(), await makeUser()];
    const results = await Promise.all([
      Team.addMember(a.id, user.id),
      Team.addMember(b.id, user.id),
    ]);
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(await prisma.team_members.count({ where: { user_id: user.id } })).toBe(1);
  });

  it("refuses removing the last lead while other members remain", async () => {
    const team = await makeTeam();
    const [lead, member] = [await makeUser(), await makeUser()];
    await Team.addMember(team.id, lead.id, { role: "lead" });
    await Team.addMember(team.id, member.id);
    const result = await Team.removeMember(team.id, lead.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least one lead/);
    expect(await Team.membershipFor(lead.id)).not.toBeNull();
  });

  it("allows removing the last lead when nobody else is on the team", async () => {
    const team = await makeTeam();
    const lead = await makeUser();
    await Team.addMember(team.id, lead.id, { role: "lead" });
    expect((await Team.removeMember(team.id, lead.id)).success).toBe(true);
  });

  it("an admin (force) can remove the last lead", async () => {
    const team = await makeTeam();
    const [lead, member] = [await makeUser(), await makeUser()];
    await Team.addMember(team.id, lead.id, { role: "lead" });
    await Team.addMember(team.id, member.id);
    expect((await Team.removeMember(team.id, lead.id, { force: true })).success).toBe(true);
  });

  it("two concurrent removals of the last two leads leave one lead", async () => {
    const team = await makeTeam();
    const [l1, l2, member] = [await makeUser(), await makeUser(), await makeUser()];
    await Team.addMember(team.id, l1.id, { role: "lead" });
    await Team.addMember(team.id, l2.id, { role: "lead" });
    await Team.addMember(team.id, member.id);
    const results = await Promise.all([
      Team.removeMember(team.id, l1.id),
      Team.removeMember(team.id, l2.id),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(
      await prisma.team_members.count({ where: { team_id: team.id, role: "lead" } })
    ).toBe(1);
  });

  it("two concurrent demotions of the last two leads leave one lead", async () => {
    const team = await makeTeam();
    const [l1, l2] = [await makeUser(), await makeUser()];
    await Team.addMember(team.id, l1.id, { role: "lead" });
    await Team.addMember(team.id, l2.id, { role: "lead" });
    const results = await Promise.all([
      Team.setMemberRole(team.id, l1.id, "member"),
      Team.setMemberRole(team.id, l2.id, "member"),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(
      await prisma.team_members.count({ where: { team_id: team.id, role: "lead" } })
    ).toBe(1);
  });

  it("reports a missing member rather than the lead rule", async () => {
    const team = await makeTeam();
    const stranger = await makeUser();
    expect((await Team.removeMember(team.id, stranger.id)).error).toMatch(/not on this team/);
  });
});

describe("Team.delete", () => {
  it("runs in one transaction: members dropped, workspaces admin-only, shared items returned", async () => {
    const team = await makeTeam();
    const owner = await makeUser();
    await Team.addMember(team.id, owner.id, { role: "lead" });
    const ws = await prisma.workspaces.create({
      data: { name: "w", slug: `w-${++seq}`, team_id: team.id },
    });
    // a shared preset with no personal twin, and one whose owner has a personal twin
    await prisma.slash_command_presets.create({
      data: { command: "/a", prompt: "p", description: "d", uid: owner.id, userId: owner.id, team_id: team.id },
    });
    await prisma.slash_command_presets.create({
      data: { command: "/b", prompt: "p", description: "d", uid: owner.id, userId: owner.id, team_id: team.id },
    });
    await prisma.slash_command_presets.create({
      data: { command: "/b", prompt: "mine", description: "d", uid: owner.id, userId: owner.id, team_id: 0 },
    });
    await prisma.system_prompt_variables.create({
      data: { key: `k${seq}`, value: "v", type: "user", userId: owner.id, team_id: team.id },
    });

    const result = await Team.delete(team.id);
    expect(result).toEqual({
      success: true,
      counts: { members: 1, workspaces: 1, presets: 1, variables: 1 },
    });
    expect(await Team.get({ id: team.id })).toBeNull();
    expect(await Team.membershipFor(owner.id)).toBeNull();
    expect((await prisma.workspaces.findUnique({ where: { id: ws.id } })).team_id).toBeNull();
    const presets = await prisma.slash_command_presets.findMany({ where: { uid: owner.id } });
    expect(presets.map((p) => [p.command, p.team_id, p.prompt]).sort()).toEqual([
      ["/a", 0, "p"],
      ["/b", 0, "mine"],
    ]);
    // Team variables are deleted, never made global (null team_id = everyone).
    expect(
      await prisma.system_prompt_variables.count({ where: { key: `k${seq}` } })
    ).toBe(0);
  });

  it("changes nothing when the team does not exist", async () => {
    const before = await prisma.workspaces.count();
    expect((await Team.delete(999999)).success).toBe(false);
    expect(await prisma.workspaces.count()).toBe(before);
  });
});

describe("AccessPolicy model", () => {
  it("validates allowed models, defaults, router and tool rule", async () => {
    expect((await AccessPolicy.create({ name: "" })).error).toMatch(/Name/);
    expect((await AccessPolicy.create({ name: "a", allowed_models: "{bad" })).error).toMatch(/JSON/);
    expect(
      (await AccessPolicy.create({ name: "a", allowed_models: [{ provider: "openai" }] })).error
    ).toMatch(/provider and a model/);
    expect(
      (
        await AccessPolicy.create({
          name: "a",
          allowed_models: [{ provider: "openai", model: "gpt-4o-mini" }],
          default_provider: "openai",
          default_model: "gpt-4o",
        })
      ).error
    ).toMatch(/default model must be one of the allowed/);
    expect((await AccessPolicy.create({ name: "a", router_id: 4242 })).error).toMatch(/router/);
    expect((await AccessPolicy.create({ name: "a", agent_tools: { allow: "x" } })).error).toBeTruthy();

    const { policy, error } = await AccessPolicy.create({
      name: "engineering",
      allowed_models: [{ provider: "openai", model: "*" }],
      default_provider: "openai",
      default_model: "gpt-4o",
      agent_tools: { deny: ["@@mcp_github"] },
    });
    expect(error).toBeNull();
    expect(JSON.parse(policy.agent_tools)).toEqual({ allow: null, deny: ["@@mcp_github"] });
    expect((await AccessPolicy.create({ name: "engineering" })).error).toMatch(/already exists/);
  });

  it("delete unassigns users and teams in one transaction", async () => {
    const { policy } = await AccessPolicy.create({ name: `p-${++seq}` });
    const user = await makeUser();
    await prisma.users.update({ where: { id: user.id }, data: { policy_id: policy.id } });
    const team = await makeTeam();
    await Team.update(team.id, { policy_id: policy.id });
    expect(await AccessPolicy.delete(policy.id)).toEqual({
      success: true,
      unassigned: { users: 1, teams: 1 },
    });
    expect((await prisma.users.findUnique({ where: { id: user.id } })).policy_id).toBeNull();
    expect((await Team.get({ id: team.id })).policy_id).toBeNull();
  });

  it("Team.update refuses an unknown policy id", async () => {
    const team = await makeTeam();
    expect((await Team.update(team.id, { policy_id: 987654 })).error).toMatch(/does not exist/);
  });
});
