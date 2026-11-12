/* eslint-env jest */
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = require("fs").mkdtempSync(
  require("path").join(require("os").tmpdir(), "allm-storage-")
);

const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);
// The LLM classifier sends the prompt to the router's fallback model; record calls.
jest.mock("../../../utils/agents/aibitat/plugins/router-classifier", () => ({
  classifyWithLLM: jest.fn(async (rules) => rules[0]),
}));
const {
  classifyWithLLM,
} = require("../../../utils/agents/aibitat/plugins/router-classifier");

const { resolveProviderConnector } = require("../../../utils/helpers");
const { ModelRouterService } = require("../../../utils/router");

const prisma = mockDb.prisma;
const ORIGINAL_ENV = process.env;

// generic-openai builds a connector without network access, and takes any model name.
const PROVIDER = "generic-openai";
const workspace = (overrides = {}) => ({
  id: 1,
  name: "ws",
  slug: "ws",
  chatProvider: PROVIDER,
  chatModel: "forbidden-model",
  openAiTemp: 0.5,
  ...overrides,
});

let seq = 0;
async function userWithPolicy(policyData) {
  const policy = await prisma.access_policies.create({
    data: { name: `p${++seq}`, ...policyData },
  });
  const user = await prisma.users.create({
    data: { username: `u${seq}`, password: "x", policy_id: policy.id },
  });
  return { user, policy };
}
const allow = (...models) =>
  JSON.stringify(models.map((model) => ({ provider: PROVIDER, model })));

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

describe("resolveProviderConnector with access policies", () => {
  it("leaves a user without a policy on the workspace model", async () => {
    const user = await prisma.users.create({
      data: { username: `free${++seq}`, password: "x" },
    });
    const { connector } = await resolveProviderConnector({
      workspace: workspace(),
      user,
    });
    expect(connector.model).toBe("forbidden-model");
  });

  it("leaves a request with no user on the workspace model", async () => {
    const { connector } = await resolveProviderConnector({
      workspace: workspace(),
    });
    expect(connector.model).toBe("forbidden-model");
  });

  it("keeps an allowed workspace model", async () => {
    const { user } = await userWithPolicy({
      allowed_models: allow("forbidden-model"),
    });
    const { connector } = await resolveProviderConnector({
      workspace: workspace(),
      user,
    });
    expect(connector.model).toBe("forbidden-model");
  });

  it("substitutes the policy default for a model the policy doesn't allow", async () => {
    const { user } = await userWithPolicy({
      allowed_models: allow("allowed-model"),
      default_provider: PROVIDER,
      default_model: "allowed-model",
    });
    const { connector } = await resolveProviderConnector({
      workspace: workspace(),
      user: { id: user.id }, // agent and API paths pass only the id
    });
    expect(connector.model).toBe("allowed-model");
    expect(connector.temperature).toBe(0.5);
  });

  it("refuses with a readable error when there is no allowed default", async () => {
    const { user } = await userWithPolicy({ allowed_models: allow("allowed-model") });
    await expect(
      resolveProviderConnector({ workspace: workspace(), user })
    ).rejects.toMatchObject({
      name: "AccessPolicyError",
      message: expect.stringMatching(/not allowed to use generic-openai \/ forbidden-model/),
    });
  });

  it("applies the team policy when the user has none of their own", async () => {
    const policy = await prisma.access_policies.create({
      data: {
        name: `team-p${++seq}`,
        allowed_models: allow("allowed-model"),
        default_provider: PROVIDER,
        default_model: "allowed-model",
      },
    });
    const team = await prisma.teams.create({
      data: { name: `t${seq}`, policy_id: policy.id },
    });
    const user = await prisma.users.create({
      data: { username: `tm${seq}`, password: "x" },
    });
    await prisma.team_members.create({ data: { team_id: team.id, user_id: user.id } });
    const { connector } = await resolveProviderConnector({ workspace: workspace(), user });
    expect(connector.model).toBe("allowed-model");
  });
});

describe("policy router (acceptance 3)", () => {
  async function router(fallbackModel) {
    const created = await prisma.model_routers.create({
      data: {
        name: `r${++seq}`,
        fallback_provider: PROVIDER,
        fallback_model: fallbackModel,
        cooldown_seconds: 0,
      },
    });
    ModelRouterService.invalidateRouter(created.id);
    return created;
  }

  it("sends a non-router workspace through the policy's router", async () => {
    const r = await router("routed-model");
    const { user } = await userWithPolicy({
      allowed_models: allow("routed-model"),
      router_id: r.id,
    });
    const { connector, routingMetadata } = await resolveProviderConnector({
      workspace: workspace(),
      user,
      prompt: "hi",
    });
    expect(routingMetadata.routedTo.routerName).toBe(r.name);
    expect(connector.model).toBe("routed-model");
  });

  it("never builds a connector for a routed model the policy doesn't allow", async () => {
    const r = await router("routed-forbidden");
    const { user } = await userWithPolicy({
      allowed_models: allow("allowed-model"),
      default_provider: PROVIDER,
      default_model: "allowed-model",
      router_id: r.id,
    });
    const { connector, routingMetadata } = await resolveProviderConnector({
      workspace: workspace(),
      user,
      prompt: "hi",
    });
    expect(connector.model).toBe("allowed-model");
    expect(routingMetadata.routedTo.model).toBe("allowed-model");
  });

  it("checks a workspace router's routed model too", async () => {
    const r = await router("routed-forbidden");
    const { user } = await userWithPolicy({ allowed_models: allow("allowed-model") });
    await expect(
      resolveProviderConnector({
        workspace: workspace({ chatProvider: "anythingllm-router", router_id: r.id }),
        user,
        prompt: "hi",
      })
    ).rejects.toMatchObject({ name: "AccessPolicyError" });
  });
});

describe("router LLM rules under a policy", () => {
  async function routerWithLlmRule(fallbackModel) {
    const created = await prisma.model_routers.create({
      data: {
        name: `llm-r${++seq}`,
        fallback_provider: PROVIDER,
        fallback_model: fallbackModel,
        cooldown_seconds: 0,
      },
    });
    await prisma.model_router_rules.create({
      data: {
        router_id: created.id,
        priority: 1,
        type: "llm",
        title: "coding",
        description: "coding questions",
        route_provider: PROVIDER,
        route_model: "allowed-model",
      },
    });
    ModelRouterService.invalidateRouter(created.id);
    return created;
  }
  beforeEach(() => classifyWithLLM.mockClear());

  it("never sends the prompt to a classifier model the policy doesn't allow", async () => {
    const r = await routerWithLlmRule("classifier-forbidden");
    const { user } = await userWithPolicy({
      allowed_models: allow("allowed-model"),
      default_provider: PROVIDER,
      default_model: "allowed-model",
      router_id: r.id,
    });
    const { connector } = await resolveProviderConnector({
      workspace: workspace(),
      user,
      prompt: "private question",
    });
    expect(classifyWithLLM).not.toHaveBeenCalled();
    expect(connector.model).toBe("allowed-model");
  });

  it("runs LLM rules when the policy allows the classifier model", async () => {
    const r = await routerWithLlmRule("classifier-ok");
    const { user } = await userWithPolicy({
      allowed_models: allow("allowed-model", "classifier-ok"),
      router_id: r.id,
    });
    const { routingMetadata } = await resolveProviderConnector({
      workspace: workspace(),
      user,
      prompt: "write code",
    });
    expect(classifyWithLLM).toHaveBeenCalledTimes(1);
    expect(routingMetadata.routedTo.model).toBe("allowed-model");
  });

  it("runs LLM rules as before for a user without a policy", async () => {
    const r = await routerWithLlmRule("classifier-forbidden");
    const user = await prisma.users.create({
      data: { username: `nopol${++seq}`, password: "x" },
    });
    await resolveProviderConnector({
      workspace: workspace({ chatProvider: "anythingllm-router", router_id: r.id }),
      user,
      prompt: "write code",
    });
    expect(classifyWithLLM).toHaveBeenCalledTimes(1);
  });
});
