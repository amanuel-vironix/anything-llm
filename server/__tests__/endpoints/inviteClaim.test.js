/* eslint-env jest */
/**
 * SMF-14: one invite creates at most one account, and a disabled invite is
 * never claimed. Runs the real POST /invite/:code handler on a real SQLite
 * database, because the guarantee is the conditional write's row count.
 */
const { createTestPrisma } = require("../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../utils/prisma", () => mockDb.prisma);

const { inviteEndpoints } = require("../../endpoints/invite");
const { captureRoutes } = require("../helpers/routeHarness");

const prisma = mockDb.prisma;
const routes = captureRoutes(inviteEndpoints);
const PASSWORD = "a-long-enough-password";

function accept(code, username) {
  return routes.call("POST", "/invite/:code", {
    params: { code },
    body: { username, password: PASSWORD },
  });
}

async function makeInvite(status = "pending", workspaceIds = []) {
  return prisma.invites.create({
    data: {
      code: `code-${Math.random().toString(36).slice(2)}`,
      status,
      createdBy: 0,
      workspaceIds: JSON.stringify(workspaceIds),
    },
  });
}

beforeEach(async () => {
  await prisma.workspace_users.deleteMany({});
  await prisma.workspaces.deleteMany({});
  await prisma.invites.deleteMany({});
  await prisma.event_logs.deleteMany({});
  await prisma.users.deleteMany({});
});

afterAll(async () => {
  await mockDb.cleanup();
});

describe("POST /invite/:code", () => {
  it("creates the user, marks the invite claimed and adds the invite's workspaces", async () => {
    const workspace = await prisma.workspaces.create({
      data: { name: "w", slug: "w" },
    });
    const invite = await makeInvite("pending", [workspace.id]);

    const res = await accept(invite.code, "first");

    expect(res.body).toEqual({ success: true, error: null });
    const user = await prisma.users.findFirst({ where: { username: "first" } });
    const claimed = await prisma.invites.findUnique({ where: { id: invite.id } });
    expect(claimed).toMatchObject({ status: "claimed", claimedBy: user.id });
    expect(
      await prisma.workspace_users.count({
        where: { user_id: user.id, workspace_id: workspace.id },
      })
    ).toBe(1);
  });

  it("creates exactly one account when two people claim one invite at once", async () => {
    const invite = await makeInvite();

    const results = await Promise.all([
      accept(invite.code, "alice"),
      accept(invite.code, "bob"),
    ]);

    expect(results.filter((r) => r.body?.success)).toHaveLength(1);
    expect(await prisma.users.count()).toBe(1);
  });

  it("refuses a second claim after the first and creates no user", async () => {
    const invite = await makeInvite();
    await accept(invite.code, "alice");

    const res = await accept(invite.code, "bob");

    expect(res.body.success).toBe(false);
    expect(await prisma.users.count({ where: { username: "bob" } })).toBe(0);
  });

  it("refuses a disabled invite", async () => {
    const invite = await makeInvite("disabled");

    const res = await accept(invite.code, "alice");

    expect(res.body.success).toBe(false);
    expect(await prisma.users.count()).toBe(0);
  });

  it("leaves the invite pending when the username is taken", async () => {
    await prisma.users.create({ data: { username: "taken", password: "x" } });
    const invite = await makeInvite();

    const res = await accept(invite.code, "taken");

    expect(res.body.success).toBe(false);
    expect(
      (await prisma.invites.findUnique({ where: { id: invite.id } })).status
    ).toBe("pending");
  });
});
