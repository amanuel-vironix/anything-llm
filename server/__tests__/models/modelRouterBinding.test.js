/* eslint-env jest */
process.env.NODE_ENV = "test";

const { createTestPrisma } = require("../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../utils/prisma", () => mockDb.prisma);

const { ModelRouter } = require("../../models/modelRouter");
const { ModelRouterRule } = require("../../models/modelRouterRule");

const prisma = mockDb.prisma;
const ROUTER = "anythingllm-router";
const ORIGINAL_ENV = process.env;
afterEach(() => {
  process.env = ORIGINAL_ENV;
});
afterAll(() => mockDb.cleanup());

let seq = 0;
const makeRouter = () =>
  prisma.model_routers.create({
    data: { name: `r${++seq}`, fallback_provider: "openai", fallback_model: "gpt-4o" },
  });
const makeRule = (routerId) =>
  prisma.model_router_rules.create({
    data: {
      router_id: routerId,
      priority: 1,
      title: `rule_${++seq}`,
      route_provider: "openai",
      route_model: "gpt-4o",
    },
  });
const makeWorkspace = (data) =>
  prisma.workspaces.create({ data: { name: "w", slug: `w${++seq}`, ...data } });

describe("ModelRouter.delete unbinds and falls back (decision 21)", () => {
  it("clears bound workspaces' router provider and binding, and policies' router", async () => {
    const r = await makeRouter();
    const other = await makeRouter();
    const chat = await makeWorkspace({ chatProvider: ROUTER, chatModel: null, router_id: r.id });
    const agent = await makeWorkspace({
      chatProvider: "openai",
      chatModel: "gpt-4o",
      agentProvider: ROUTER,
      router_id: r.id,
    });
    const untouched = await makeWorkspace({ chatProvider: ROUTER, router_id: other.id });
    const policy = await prisma.access_policies.create({
      data: { name: `p${seq}`, router_id: r.id },
    });

    const result = await ModelRouter.delete(r.id);
    expect(result.success).toBe(true);
    expect(result.unbound).toMatchObject({ policies: 1, systemRouter: false });

    const get = (id) => prisma.workspaces.findUnique({ where: { id } });
    expect(await get(chat.id)).toMatchObject({ chatProvider: null, router_id: null });
    expect(await get(agent.id)).toMatchObject({
      chatProvider: "openai",
      chatModel: "gpt-4o",
      agentProvider: null,
      router_id: null,
    });
    expect(await get(untouched.id)).toMatchObject({ chatProvider: ROUTER, router_id: other.id });
    expect(
      (await prisma.access_policies.findUnique({ where: { id: policy.id } })).router_id
    ).toBeNull();
    expect(await prisma.model_routers.findUnique({ where: { id: r.id } })).toBeNull();
  });

  it("falls back workspaces relying on MODEL_ROUTER_ID when that router is deleted", async () => {
    const r = await makeRouter();
    process.env = { ...ORIGINAL_ENV, MODEL_ROUTER_ID: String(r.id), LLM_PROVIDER: "openai" };
    const relying = await makeWorkspace({ chatProvider: ROUTER, router_id: null });
    const result = await ModelRouter.delete(r.id);
    expect(result.unbound.systemRouter).toBe(true);
    expect(
      (await prisma.workspaces.findUnique({ where: { id: relying.id } })).chatProvider
    ).toBeNull();
  });

  it("refuses when the system provider is this router, changing nothing", async () => {
    const r = await makeRouter();
    process.env = { ...ORIGINAL_ENV, MODEL_ROUTER_ID: String(r.id), LLM_PROVIDER: ROUTER };
    const ws = await makeWorkspace({ chatProvider: ROUTER, router_id: r.id });
    const result = await ModelRouter.delete(r.id);
    expect(result.success).toBe(false);
    expect(await prisma.model_routers.findUnique({ where: { id: r.id } })).not.toBeNull();
    expect((await prisma.workspaces.findUnique({ where: { id: ws.id } })).router_id).toBe(r.id);
  });
});

describe("rule operations are scoped to their router (SMF-12)", () => {
  it("updating a rule under the wrong router id is not found and changes nothing", async () => {
    const [a, b] = [await makeRouter(), await makeRouter()];
    const rule = await makeRule(a.id);
    const result = await ModelRouterRule.update(rule.id, { route_model: "evil" }, b.id);
    expect(result.notFound).toBe(true);
    expect(
      (await prisma.model_router_rules.findUnique({ where: { id: rule.id } })).route_model
    ).toBe("gpt-4o");
    expect((await ModelRouterRule.update(rule.id, { route_model: "ok" }, a.id)).rule.route_model).toBe(
      "ok"
    );
  });

  it("deleting a rule under the wrong router id deletes nothing", async () => {
    const [a, b] = [await makeRouter(), await makeRouter()];
    const rule = await makeRule(a.id);
    expect(await ModelRouterRule.delete(rule.id, b.id)).toBe(false);
    expect(await prisma.model_router_rules.findUnique({ where: { id: rule.id } })).not.toBeNull();
    expect(await ModelRouterRule.delete(rule.id, a.id)).toBe(true);
  });

  it("reordering with one foreign rule changes nothing", async () => {
    const [a, b] = [await makeRouter(), await makeRouter()];
    const mine = await makeRule(a.id);
    const theirs = await makeRule(b.id);
    const result = await ModelRouterRule.reorderRules(
      [
        { id: mine.id, priority: 5 },
        { id: theirs.id, priority: 9 },
      ],
      a.id
    );
    expect(result.notFound).toBe(true);
    expect((await prisma.model_router_rules.findUnique({ where: { id: mine.id } })).priority).toBe(1);
    expect((await prisma.model_router_rules.findUnique({ where: { id: theirs.id } })).priority).toBe(1);
  });
});
