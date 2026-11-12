/* eslint-env jest */
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = require("fs").mkdtempSync(
  require("path").join(require("os").tmpdir(), "allm-storage-")
);

const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const { AgentHandler } = require("../../../utils/agents");
const { EphemeralAgentHandler } = require("../../../utils/agents/ephemeral");

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
async function setup({ policy = null, invocationAge = 0 } = {}) {
  seq++;
  const policyRow = policy
    ? await prisma.access_policies.create({ data: { name: `p${seq}`, ...policy } })
    : null;
  const user = await prisma.users.create({
    data: {
      username: `u${seq}`,
      password: "x",
      role: "admin", // admins see every workspace, so access isn't what's tested
      policy_id: policyRow?.id ?? null,
    },
  });
  const workspace = await prisma.workspaces.create({
    data: {
      name: `w${seq}`,
      slug: `w${seq}`,
      agentProvider: PROVIDER,
      agentModel: "forbidden-model",
    },
  });
  const invocation = await prisma.workspace_agent_invocations.create({
    data: {
      uuid: `inv-${seq}`,
      prompt: "@agent hi",
      user_id: user.id,
      workspace_id: workspace.id,
      createdAt: new Date(Date.now() - invocationAge),
    },
  });
  return { user, workspace, invocation };
}
const allow = (...models) =>
  JSON.stringify(models.map((model) => ({ provider: PROVIDER, model })));

describe("web agent (AgentHandler.init)", () => {
  it("uses the workspace agent model when there is no policy", async () => {
    const { invocation } = await setup();
    const handler = await new AgentHandler({ uuid: invocation.uuid }).init();
    expect(handler.model).toBe("forbidden-model");
  });

  it("substitutes the policy default for a disallowed agent model", async () => {
    const { invocation } = await setup({
      policy: {
        allowed_models: allow("allowed-model"),
        default_provider: PROVIDER,
        default_model: "allowed-model",
      },
    });
    const handler = await new AgentHandler({ uuid: invocation.uuid }).init();
    expect([handler.provider, handler.model]).toEqual([PROVIDER, "allowed-model"]);
  });

  it("refuses a disallowed agent model with no default", async () => {
    const { invocation } = await setup({ policy: { allowed_models: allow("allowed-model") } });
    await expect(new AgentHandler({ uuid: invocation.uuid }).init()).rejects.toThrow(
      /not allowed to use/
    );
  });

  it("refuses when the policy turns agents off", async () => {
    const { invocation } = await setup({
      policy: { allowed_models: allow("*"), allow_agents: false },
    });
    await expect(new AgentHandler({ uuid: invocation.uuid }).init()).rejects.toThrow(
      /Agents are disabled/
    );
  });
});

describe("agent websocket caller check (F-04)", () => {
  it("refuses another user's session in multi-user mode, before the invocation is touched", async () => {
    const { invocation } = await setup();
    const other = await prisma.users.create({ data: { username: `o${++seq}`, password: "x" } });
    await expect(
      new AgentHandler({
        uuid: invocation.uuid,
        caller: { multiUserMode: true, userId: other.id },
      }).init()
    ).rejects.toThrow(/not allowed to use this agent invocation/);
    const after = await prisma.workspace_agent_invocations.findUnique({
      where: { uuid: invocation.uuid },
    });
    expect(after.closed).toBe(false);
  });

  it("refuses a caller with no user in multi-user mode", async () => {
    const { invocation } = await setup();
    await expect(
      new AgentHandler({
        uuid: invocation.uuid,
        caller: { multiUserMode: true, userId: null },
      }).init()
    ).rejects.toThrow(/not allowed/);
  });

  it("accepts the invoking user's own session", async () => {
    const { invocation, user } = await setup();
    const handler = await new AgentHandler({
      uuid: invocation.uuid,
      caller: { multiUserMode: true, userId: user.id },
    }).init();
    expect(handler.invocation.uuid).toBe(invocation.uuid);
  });

  it("refuses an invocation older than 10 minutes (decision 25)", async () => {
    const { invocation, user } = await setup({ invocationAge: 11 * 60 * 1000 });
    await expect(
      new AgentHandler({
        uuid: invocation.uuid,
        caller: { multiUserMode: true, userId: user.id },
      }).init()
    ).rejects.toThrow(/expired/);
  });
});

describe("API agent (EphemeralAgentHandler.init)", () => {
  it("applies the calling user's policy", async () => {
    const { user, workspace } = await setup({
      policy: {
        allowed_models: allow("allowed-model"),
        default_provider: PROVIDER,
        default_model: "allowed-model",
      },
    });
    const handler = await new EphemeralAgentHandler({
      uuid: "eph-1",
      workspace,
      prompt: "hi",
      userId: user.id,
    }).init();
    expect(handler.model).toBe("allowed-model");
  });

  it("refuses when the policy turns agents off", async () => {
    const { user, workspace } = await setup({
      policy: { allowed_models: allow("*"), allow_agents: false },
    });
    await expect(
      new EphemeralAgentHandler({ uuid: "eph-2", workspace, prompt: "hi", userId: user.id }).init()
    ).rejects.toThrow(/Agents are disabled/);
  });

  it("keeps today's model with no user", async () => {
    const { workspace } = await setup();
    const handler = await new EphemeralAgentHandler({
      uuid: "eph-3",
      workspace,
      prompt: "hi",
    }).init();
    expect(handler.model).toBe("forbidden-model");
  });
});
