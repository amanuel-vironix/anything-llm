/* eslint-env jest */
/**
 * SMF-13 / F-09: suspend, delete and demote must leave at least one active
 * admin, including when two of them run at once. Runs on a real SQLite
 * database because the guarantee depends on the transaction, not on the
 * count read before it.
 */
const { createTestPrisma } = require("../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../utils/prisma", () => mockDb.prisma);

const { User } = require("../../models/user");
const { canModifyAdmin } = require("../../utils/helpers/admin");

const prisma = mockDb.prisma;

async function makeUser(username, role = "admin", suspended = 0) {
  return prisma.users.create({
    data: { username, password: "x", role, suspended },
  });
}

async function activeAdminCount() {
  return prisma.users.count({ where: { role: "admin", suspended: 0 } });
}

beforeEach(async () => {
  await prisma.event_logs.deleteMany({});
  await prisma.users.deleteMany({});
});

afterAll(async () => {
  await mockDb.cleanup();
});

describe("User.update last-admin guard", () => {
  it("refuses suspending the only active admin and leaves them active", async () => {
    const admin = await makeUser("solo");

    const result = await User.update(admin.id, { suspended: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toBe(User.lastAdminError);
    expect((await prisma.users.findUnique({ where: { id: admin.id } })).suspended).toBe(0);
  });

  it("refuses demoting the only active admin even when a suspended admin exists", async () => {
    const admin = await makeUser("active");
    await makeUser("benched", "admin", 1);

    const result = await User.update(admin.id, { role: "default" });

    expect(result.success).toBe(false);
    expect((await prisma.users.findUnique({ where: { id: admin.id } })).role).toBe("admin");
  });

  it("allows demoting one of two active admins", async () => {
    const a = await makeUser("a");
    await makeUser("b");

    const result = await User.update(a.id, { role: "manager" });

    expect(result).toEqual({ success: true, error: null });
    expect(await activeAdminCount()).toBe(1);
  });

  it("does not guard updates that keep the admin active", async () => {
    const admin = await makeUser("solo");

    const result = await User.update(admin.id, { bio: "still here" });

    expect(result.success).toBe(true);
  });

  it("leaves exactly one active admin when the last two demote each other at once", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");

    const results = await Promise.all([
      User.update(a.id, { role: "default" }),
      User.update(b.id, { role: "default" }),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await activeAdminCount()).toBe(1);
  });

  it("leaves exactly one active admin when the last two suspend each other at once", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");

    const results = await Promise.all([
      User.update(a.id, { suspended: 1 }),
      User.update(b.id, { suspended: 1 }),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await activeAdminCount()).toBe(1);
  });
});

describe("User.delete last-admin guard", () => {
  it("refuses deleting the only active admin and keeps the row", async () => {
    const admin = await makeUser("solo");

    const result = await User.deleteWithReason({ id: admin.id });

    expect(result).toEqual({ success: false, error: User.lastAdminError });
    expect(await prisma.users.count({ where: { id: admin.id } })).toBe(1);
  });

  it("allows deleting a default user when no active admin exists", async () => {
    await makeUser("benched", "admin", 1);
    const user = await makeUser("plain", "default");

    expect(await User.delete({ id: user.id })).toBe(true);
    expect(await prisma.users.count({ where: { id: user.id } })).toBe(0);
  });

  it("keeps one active admin when the last two are deleted at once", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");

    await Promise.all([
      User.delete({ id: a.id }),
      User.delete({ id: b.id }),
    ]);

    expect(await activeAdminCount()).toBe(1);
  });

  it("deletes every user for the multi-user rollback when told to", async () => {
    await makeUser("solo");

    expect(await User.delete({}, { allowNoActiveAdmin: true })).toBe(true);
    expect(await prisma.users.count()).toBe(0);
  });
});

describe("canModifyAdmin", () => {
  it.each([
    ["demote", { role: "default" }],
    ["suspend", { suspended: 1 }],
  ])("refuses to %s the only active admin", async (_name, updates) => {
    const admin = await makeUser("solo");
    await makeUser("benched", "admin", 1);

    const result = await canModifyAdmin(admin, updates);

    expect(result.valid).toBe(false);
  });

  it("allows suspending an admin when another active admin exists", async () => {
    const a = await makeUser("a");
    await makeUser("b");

    expect((await canModifyAdmin(a, { suspended: 1 })).valid).toBe(true);
  });
});
