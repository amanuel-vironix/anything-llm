/* eslint-env jest */
/**
 * SMF-32: issuing a temporary auth token replaces the user's earlier tokens
 * in one transaction, so two concurrent issues leave one live token.
 */
const { createTestPrisma } = require("../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../utils/prisma", () => mockDb.prisma);

const { TemporaryAuthToken } = require("../../models/temporaryAuthToken");

const prisma = mockDb.prisma;
let user;

beforeEach(async () => {
  await prisma.users.deleteMany({});
  user = await prisma.users.create({ data: { username: "u", password: "x" } });
});

afterAll(async () => {
  await mockDb.cleanup();
});

describe("TemporaryAuthToken.issue", () => {
  it("replaces the user's earlier token", async () => {
    const first = await TemporaryAuthToken.issue(user.id);
    const second = await TemporaryAuthToken.issue(user.id);

    const rows = await prisma.temporary_auth_tokens.findMany({
      where: { userId: user.id },
    });
    expect(rows.map((r) => r.token)).toEqual([second.token]);
    expect(first.token).not.toEqual(second.token);
  });

  it("leaves one live token when ten are issued at once", async () => {
    // Ten at once so the old delete-then-create interleaves reliably.
    await Promise.all(
      Array.from({ length: 10 }, () => TemporaryAuthToken.issue(user.id))
    );

    expect(
      await prisma.temporary_auth_tokens.count({ where: { userId: user.id } })
    ).toBe(1);
  });

  it.each([
    ["Simple SSO", undefined, /^allm-tat-/],
    ["Google sign-in", { prefix: "allm-oidc-" }, /^allm-oidc-/],
  ])("marks a %s token with its prefix", async (_name, options, pattern) => {
    const { token } = await TemporaryAuthToken.issue(user.id, options);

    expect(token).toMatch(pattern);
  });
});
