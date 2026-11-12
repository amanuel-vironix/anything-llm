process.env.NODE_ENV = "test";

const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const {
  parseToolRule,
  validateToolRule,
  filterAgentFunctions,
  isMcpToolAllowed,
  resolveToolRuleForUser,
  ROLE_POLICY_SETTING,
} = require("../../../utils/accessPolicy/agentTools");

afterAll(() => mockDb.cleanup());

const FUNCTIONS = [
  "web-browsing",
  "memory",
  "sql-agent#sql-list-databases",
  "sql-agent#sql-query",
  "@@flow_abc",
  "@@hub-plugin",
  "@@mcp_github",
  "@@mcp_jira",
];

describe("filterAgentFunctions", () => {
  it("returns every function when there is no rule", () => {
    expect(filterAgentFunctions(FUNCTIONS, null)).toEqual(FUNCTIONS);
  });

  it("drops denied functions with a null allow list", () => {
    const rule = parseToolRule({ allow: null, deny: ["web-browsing", "@@mcp_github"] });
    expect(filterAgentFunctions(FUNCTIONS, rule)).toEqual(
      FUNCTIONS.filter((f) => !["web-browsing", "@@mcp_github"].includes(f))
    );
  });

  it("keeps only allowed functions when an allow list is set", () => {
    const rule = parseToolRule({ allow: ["memory", "@@flow_abc"], deny: [] });
    expect(filterAgentFunctions(FUNCTIONS, rule)).toEqual(["memory", "@@flow_abc"]);
  });

  it("deny wins over allow", () => {
    const rule = parseToolRule({ allow: ["memory", "web-browsing"], deny: ["memory"] });
    expect(filterAgentFunctions(FUNCTIONS, rule)).toEqual(["web-browsing"]);
  });

  it("a parent entry covers every child; a child entry covers one", () => {
    expect(
      filterAgentFunctions(FUNCTIONS, parseToolRule({ allow: ["sql-agent"], deny: [] }))
    ).toEqual(["sql-agent#sql-list-databases", "sql-agent#sql-query"]);
    expect(
      filterAgentFunctions(
        FUNCTIONS,
        parseToolRule({ allow: null, deny: ["sql-agent#sql-query"] })
      )
    ).not.toContain("sql-agent#sql-query");
  });

  it("keeps an MCP server when the allow list names one of its tools", () => {
    const rule = parseToolRule({ allow: ["github:create_issue"], deny: [] });
    expect(filterAgentFunctions(FUNCTIONS, rule)).toEqual(["@@mcp_github"]);
  });

  it("a tool-level deny keeps the server so its other tools stay usable", () => {
    const rule = parseToolRule({ allow: null, deny: ["github:delete_repo"] });
    expect(filterAgentFunctions(FUNCTIONS, rule)).toContain("@@mcp_github");
  });

  it("* in allow keeps everything; * in deny drops everything", () => {
    expect(filterAgentFunctions(FUNCTIONS, parseToolRule({ allow: ["*"], deny: [] }))).toEqual(
      FUNCTIONS
    );
    expect(filterAgentFunctions(FUNCTIONS, parseToolRule({ allow: null, deny: ["*"] }))).toEqual(
      []
    );
  });
});

describe("isMcpToolAllowed", () => {
  it.each([
    ["no rule", null, "github", "create_issue", true],
    ["server denied", { allow: null, deny: ["@@mcp_github"] }, "github", "create_issue", false],
    ["tool denied", { allow: null, deny: ["github:delete_repo"] }, "github", "delete_repo", false],
    ["sibling of a denied tool", { allow: null, deny: ["github:delete_repo"] }, "github", "create_issue", true],
    ["tool allowed by name", { allow: ["github:create_issue"], deny: [] }, "github", "create_issue", true],
    ["other tool not in allow", { allow: ["github:create_issue"], deny: [] }, "github", "delete_repo", false],
    ["server allowed whole", { allow: ["@@mcp_github"], deny: [] }, "github", "delete_repo", true],
  ])("%s", (_name, rule, server, tool, expected) => {
    expect(isMcpToolAllowed(rule && parseToolRule(rule), server, tool)).toBe(expected);
  });

  it("checks anythingllm.allowedRoles when there is a user", () => {
    expect(isMcpToolAllowed(null, "github", "x", { role: "default" }, ["admin"])).toBe(false);
    expect(isMcpToolAllowed(null, "github", "x", { role: "admin" }, ["admin"])).toBe(true);
    expect(isMcpToolAllowed(null, "github", "x", null, ["admin"])).toBe(true);
  });
});

describe("rule parsing", () => {
  it("malformed stored JSON fails closed", () => {
    expect(filterAgentFunctions(FUNCTIONS, parseToolRule("{not json"))).toEqual([]);
  });

  it("validateToolRule rejects bad shapes and accepts null", () => {
    expect(validateToolRule(null)).toEqual({ rule: null });
    expect(validateToolRule({ allow: "memory" }).error).toBeTruthy();
    expect(validateToolRule("[1]").error).toBeTruthy();
    expect(validateToolRule({ deny: ["memory"] }).rule).toEqual({ allow: null, deny: ["memory"] });
  });
});

describe("resolveToolRuleForUser (SQLite)", () => {
  const prisma = mockDb.prisma;
  let user, admin, team;
  const setRoleDefaults = (value) =>
    prisma.system_settings.upsert({
      where: { label: ROLE_POLICY_SETTING },
      update: { value: JSON.stringify(value) },
      create: { label: ROLE_POLICY_SETTING, value: JSON.stringify(value) },
    });

  beforeAll(async () => {
    user = await prisma.users.create({ data: { username: "dee", password: "x", role: "default" } });
    admin = await prisma.users.create({ data: { username: "ada", password: "x", role: "admin" } });
    team = await prisma.teams.create({ data: { name: "ops" } });
  });

  it("no user means no restriction", async () => {
    expect((await resolveToolRuleForUser(null)).rule).toBeNull();
  });

  it("no role default and no policy means no restriction", async () => {
    expect((await resolveToolRuleForUser({ id: user.id })).rule).toBeNull();
  });

  it("uses the role default for the user's role", async () => {
    await setRoleDefaults({ default: { allow: null, deny: ["@@mcp_github"] } });
    const result = await resolveToolRuleForUser({ id: user.id });
    expect(result.source).toBe("role");
    expect(result.rule.deny).toEqual(["@@mcp_github"]);
  });

  it("admins without a policy keep every tool (decision 6)", async () => {
    expect((await resolveToolRuleForUser({ id: admin.id })).rule).toBeNull();
  });

  it("an unreadable role default denies every tool instead of none", async () => {
    await prisma.system_settings.update({
      where: { label: ROLE_POLICY_SETTING },
      data: { value: "{not json" },
    });
    const result = await resolveToolRuleForUser({ id: user.id });
    expect(result.source).toBe("role");
    expect(filterAgentFunctions(FUNCTIONS, result.rule)).toEqual([]);
    await setRoleDefaults({ default: { allow: null, deny: ["@@mcp_github"] } });
  });

  it("a failed read of the role default throws instead of lifting it", async () => {
    const spy = jest
      .spyOn(prisma.system_settings, "findFirst")
      .mockRejectedValueOnce(new Error("db down"));
    await expect(resolveToolRuleForUser({ id: user.id })).rejects.toMatchObject({
      name: "AccessPolicyError",
    });
    spy.mockRestore();
  });

  it("a team policy with a rule beats the role default", async () => {
    const teamPolicy = await prisma.access_policies.create({
      data: { name: "ops-policy", agent_tools: JSON.stringify({ allow: ["@@mcp_github"], deny: [] }) },
    });
    await prisma.teams.update({ where: { id: team.id }, data: { policy_id: teamPolicy.id } });
    await prisma.team_members.create({ data: { team_id: team.id, user_id: user.id } });
    const result = await resolveToolRuleForUser({ id: user.id });
    expect(result.source).toBe("team");
    expect(result.rule.allow).toEqual(["@@mcp_github"]);
  });

  it("a user policy with a null rule falls through to the team rule", async () => {
    const own = await prisma.access_policies.create({ data: { name: "own", agent_tools: null } });
    await prisma.users.update({ where: { id: user.id }, data: { policy_id: own.id } });
    expect((await resolveToolRuleForUser({ id: user.id })).source).toBe("team");
  });

  it("a user policy with a rule beats the team rule", async () => {
    const own = await prisma.access_policies.create({
      data: { name: "own-rule", agent_tools: JSON.stringify({ allow: null, deny: ["memory"] }) },
    });
    await prisma.users.update({ where: { id: user.id }, data: { policy_id: own.id } });
    const result = await resolveToolRuleForUser({ id: user.id });
    expect(result.source).toBe("user");
    expect(result.rule.deny).toEqual(["memory"]);
  });
});
