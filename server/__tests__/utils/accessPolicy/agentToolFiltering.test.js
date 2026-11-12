/* eslint-env jest */
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = require("fs").mkdtempSync(
  require("path").join(require("os").tmpdir(), "allm-storage-")
);

const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

// MCP servers are separate processes; fake the layer at that boundary. `github` has two
// tools; `jira` is restricted to admins with anythingllm.allowedRoles.
const mockMcp = {
  servers: {
    github: { tools: ["create_issue", "delete_repo"], allowedRoles: null },
    jira: { tools: ["search"], allowedRoles: ["admin"] },
  },
};
jest.mock("../../../utils/MCP", () => {
  return class FakeMCPLayer {
    async activeMCPServers() {
      return Object.keys(mockMcp.servers).map((name) => `@@mcp_${name}`);
    }
    getAllowedRoles(name) {
      return mockMcp.servers[name]?.allowedRoles ?? null;
    }
    async convertServerToolsToPlugins(name, _aibitat, { toolFilter = null } = {}) {
      const server = mockMcp.servers[name];
      if (!server) return null;
      const tools = server.tools.filter(
        (tool) => !toolFilter || toolFilter(name, tool, server.allowedRoles)
      );
      if (!tools.length) return null;
      return tools.map((tool) => ({
        name: `${name}-${tool}`,
        plugin: () => ({
          name: `${name}-${tool}`,
          setup: (aibitat) =>
            aibitat.function({ name: `${name}-${tool}`, handler: async () => "ok" }),
        }),
      }));
    }
  };
});

const { WORKSPACE_AGENT } = require("../../../utils/agents/defaults");
const { EphemeralAgentHandler } = require("../../../utils/agents/ephemeral");
const { ROLE_POLICY_SETTING } = require("../../../utils/accessPolicy/agentTools");

const prisma = mockDb.prisma;
const PROVIDER = "generic-openai";
const ORIGINAL_ENV = process.env;
beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    GENERIC_OPEN_AI_BASE_PATH: "http://localhost:8080/v1",
    LLM_PROVIDER: PROVIDER,
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});
afterAll(() => mockDb.cleanup());

let seq = 0;
const makeUser = (role, data = {}) =>
  prisma.users.create({ data: { username: `u${++seq}`, password: "x", role, ...data } });
const setRoleDefaults = (value) =>
  prisma.system_settings.upsert({
    where: { label: ROLE_POLICY_SETTING },
    update: { value: value === null ? null : JSON.stringify(value) },
    create: { label: ROLE_POLICY_SETTING, value: value === null ? null : JSON.stringify(value) },
  });
let workspace;
beforeAll(async () => {
  workspace = await prisma.workspaces.create({
    data: { name: "w", slug: "w", agentProvider: PROVIDER, agentModel: "m" },
  });
});
beforeEach(() => setRoleDefaults(null));

const webFunctions = async (user) =>
  (await WORKSPACE_AGENT.getDefinition(null, workspace, user, "")).functions;

async function apiAgent(user) {
  const handler = await new EphemeralAgentHandler({
    uuid: `eph-${++seq}`,
    workspace,
    prompt: "hi",
    userId: user?.id ?? null,
  }).init();
  await handler.createAIbitat({ handler: null });
  return {
    functions: handler.aibitat.agents.get("@agent").functions,
    registered: [...handler.aibitat.functions.keys()],
  };
}

describe("acceptance 8: no rules means today's tools", () => {
  it("a default user with no role default and no policy gets every server (minus role-gated)", async () => {
    const user = await makeUser("default");
    expect(await webFunctions(user)).toEqual(
      expect.arrayContaining(["@@mcp_github"])
    );
  });

  it("no user gets every server, including role-gated ones", async () => {
    expect(await webFunctions(null)).toEqual(
      expect.arrayContaining(["@@mcp_github", "@@mcp_jira"])
    );
  });
});

describe("acceptance 7: role default denies @@mcp_github for default users", () => {
  beforeEach(() => setRoleDefaults({ default: { allow: null, deny: ["@@mcp_github"] } }));

  it("the web agent doesn't offer it", async () => {
    const user = await makeUser("default");
    expect(await webFunctions(user)).not.toContain("@@mcp_github");
  });

  it("the API agent doesn't offer it or register any of its tools", async () => {
    const user = await makeUser("default");
    const { functions, registered } = await apiAgent(user);
    expect(functions).not.toContain("@@mcp_github");
    expect(registered.filter((name) => name.startsWith("github-"))).toEqual([]);
  });

  it("web and API agents offer the same filtered skills and servers", async () => {
    const user = await makeUser("default");
    const web = await webFunctions(user);
    const { functions } = await apiAgent(user);
    // the API list leaves out clarifying-question tools on purpose; none are enabled here
    expect([...functions].sort()).toEqual([...web].sort());
  });

  it("a user whose own policy allows it does get it", async () => {
    const policy = await prisma.access_policies.create({
      data: { name: `p${++seq}`, agent_tools: JSON.stringify({ allow: null, deny: [] }) },
    });
    const user = await makeUser("default", { policy_id: policy.id });
    expect(await webFunctions(user)).toContain("@@mcp_github");
    const { registered } = await apiAgent(user);
    expect(registered).toEqual(expect.arrayContaining(["github-create_issue", "github-delete_repo"]));
  });

  it("admins without a policy keep it", async () => {
    const admin = await makeUser("admin");
    expect(await webFunctions(admin)).toContain("@@mcp_github");
  });
});

describe("per-tool MCP rules and allowedRoles", () => {
  it("drops a denied tool after the server is split into tools", async () => {
    const policy = await prisma.access_policies.create({
      data: {
        name: `p${++seq}`,
        agent_tools: JSON.stringify({ allow: null, deny: ["github:delete_repo"] }),
      },
    });
    const user = await makeUser("default", { policy_id: policy.id });
    const { registered } = await apiAgent(user);
    expect(registered).toContain("github-create_issue");
    expect(registered).not.toContain("github-delete_repo");
  });

  it("anythingllm.allowedRoles keeps a server from other roles", async () => {
    const user = await makeUser("default");
    expect(await webFunctions(user)).not.toContain("@@mcp_jira");
    const { registered } = await apiAgent(user);
    expect(registered).not.toContain("jira-search");
    const admin = await makeUser("admin");
    expect(await webFunctions(admin)).toContain("@@mcp_jira");
  });
});

describe("acceptance 32: a skill shared with one team only", () => {
  it("is offered to that team's members and not to another team's", async () => {
    await setRoleDefaults({ default: { allow: null, deny: ["@@mcp_github"] } });
    const shared = await prisma.access_policies.create({
      data: {
        name: `team-a-${++seq}`,
        agent_tools: JSON.stringify({ allow: null, deny: [] }),
      },
    });
    const teamA = await prisma.teams.create({ data: { name: `A${seq}`, policy_id: shared.id } });
    const teamB = await prisma.teams.create({ data: { name: `B${seq}` } });
    const [a, b] = [await makeUser("default"), await makeUser("default")];
    await prisma.team_members.create({ data: { team_id: teamA.id, user_id: a.id } });
    await prisma.team_members.create({ data: { team_id: teamB.id, user_id: b.id } });

    expect(await webFunctions(a)).toContain("@@mcp_github");
    expect((await apiAgent(a)).registered).toContain("github-create_issue");
    expect(await webFunctions(b)).not.toContain("@@mcp_github");
    expect((await apiAgent(b)).registered).not.toContain("github-create_issue");
  });
});
