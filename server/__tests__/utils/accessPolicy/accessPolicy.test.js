process.env.NODE_ENV = "test";

const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const {
  isModelAllowed,
  resolveAllowedSelection,
  enforceAllowedSelection,
  enforceAgentsAllowed,
  parseAllowedModels,
  resolvePolicyForUser,
  AccessPolicyError,
} = require("../../../utils/accessPolicy");

const policy = (overrides = {}) => ({
  allowed_models: JSON.stringify([
    { provider: "anthropic", model: "*" },
    { provider: "openai", model: "gpt-4o-mini" },
  ]),
  default_provider: null,
  default_model: null,
  allow_agents: true,
  ...overrides,
});

afterAll(() => mockDb.cleanup());

describe("isModelAllowed", () => {
  it.each([
    ["no policy allows anything", null, "ollama", "llama3", true],
    ["wildcard matches any model", policy(), "anthropic", "claude-x", true],
    ["wildcard matches an unknown model", policy(), "anthropic", null, true],
    ["exact model matches", policy(), "openai", "gpt-4o-mini", true],
    ["other model of an exact provider is refused", policy(), "openai", "gpt-4o", false],
    ["unknown model of an exact provider is refused", policy(), "openai", null, false],
    ["unlisted provider is refused", policy(), "ollama", "llama3", false],
    ["empty list allows nothing", policy({ allowed_models: "[]" }), "openai", "gpt-4o-mini", false],
    ["malformed JSON allows nothing", policy({ allowed_models: "{oops" }), "anthropic", "x", false],
    ["null list means no model restriction", policy({ allowed_models: null }), "ollama", "llama3", true],
    ["missing provider is refused", policy(), null, "gpt-4o-mini", false],
  ])("%s", (_name, p, provider, model, expected) => {
    expect(isModelAllowed(p, { provider, model })).toBe(expected);
  });

  it("drops malformed entries when parsing", () => {
    expect(
      parseAllowedModels([{ provider: "a", model: "b" }, { provider: "a" }, null])
    ).toEqual([{ provider: "a", model: "b" }]);
  });
});

describe("resolveAllowedSelection", () => {
  it("returns an allowed selection unchanged", () => {
    expect(
      resolveAllowedSelection(policy(), { provider: "openai", model: "gpt-4o-mini" })
    ).toEqual({ provider: "openai", model: "gpt-4o-mini", substituted: false });
  });

  it("substitutes the policy default when the selection is not allowed", () => {
    const p = policy({ default_provider: "openai", default_model: "gpt-4o-mini" });
    expect(resolveAllowedSelection(p, { provider: "openai", model: "gpt-4o" })).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      substituted: true,
    });
  });

  it("returns an error when there is no default", () => {
    const result = resolveAllowedSelection(policy(), { provider: "openai", model: "gpt-4o" });
    expect(result.error).toMatch(/not allowed to use openai \/ gpt-4o/);
  });

  it("returns an error when the default itself is not allowed", () => {
    const p = policy({ default_provider: "ollama", default_model: "llama3" });
    expect(resolveAllowedSelection(p, { provider: "openai", model: "gpt-4o" }).error).toBeTruthy();
  });

  it("enforceAllowedSelection throws a model_not_allowed AccessPolicyError", () => {
    expect(() =>
      enforceAllowedSelection(policy(), { provider: "openai", model: "gpt-4o" })
    ).toThrow(AccessPolicyError);
  });

  it("enforceAgentsAllowed throws only when allow_agents is false", () => {
    expect(() => enforceAgentsAllowed(null)).not.toThrow();
    expect(() => enforceAgentsAllowed(policy())).not.toThrow();
    let error;
    try {
      enforceAgentsAllowed(policy({ allow_agents: false }));
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe("agents_disabled");
  });
});

describe("resolvePolicyForUser (SQLite)", () => {
  const prisma = mockDb.prisma;
  let userPolicy, teamPolicy, team, user;

  beforeAll(async () => {
    userPolicy = await prisma.access_policies.create({
      data: { name: "personal", allowed_models: "[]" },
    });
    teamPolicy = await prisma.access_policies.create({
      data: { name: "team", allowed_models: "[]" },
    });
    team = await prisma.teams.create({
      data: { name: "clinical", policy_id: teamPolicy.id },
    });
    user = await prisma.users.create({
      data: { username: "pat", password: "x", role: "default" },
    });
  });

  it("returns no policy for a user with no policy and no team", async () => {
    expect(await resolvePolicyForUser({ id: user.id })).toEqual({
      policy: null,
      source: null,
      teamId: null,
    });
  });

  it("returns no policy when there is no user", async () => {
    expect((await resolvePolicyForUser(null)).policy).toBeNull();
  });

  it("uses the team policy once the user joins, on the next lookup", async () => {
    await prisma.team_members.create({ data: { team_id: team.id, user_id: user.id } });
    const result = await resolvePolicyForUser({ id: user.id });
    expect(result.source).toBe("team");
    expect(result.policy.id).toBe(teamPolicy.id);
  });

  it("prefers the user's own policy over the team policy", async () => {
    await prisma.users.update({ where: { id: user.id }, data: { policy_id: userPolicy.id } });
    const result = await resolvePolicyForUser({ id: user.id });
    expect(result.source).toBe("user");
    expect(result.policy.id).toBe(userPolicy.id);
  });

  it("falls back to no policy after leaving the team and losing their own", async () => {
    await prisma.users.update({ where: { id: user.id }, data: { policy_id: null } });
    await prisma.team_members.deleteMany({ where: { user_id: user.id } });
    expect((await resolvePolicyForUser({ id: user.id })).policy).toBeNull();
  });
});
