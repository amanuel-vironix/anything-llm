/* eslint-env jest */
/**
 * SMF-15 / F-10: a rejected new password must leave recovery state alone, and
 * one reset token must change the password at most once.
 */
const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const bcrypt = require("bcryptjs");
const { resetPassword } = require("../../../utils/PasswordRecovery");

const prisma = mockDb.prisma;

async function seedUserWithToken({ expiresInMs = 60_000 } = {}) {
  const user = await prisma.users.create({
    data: {
      username: "admin",
      password: bcrypt.hashSync("old-password", 4),
      role: "admin",
      seen_recovery_codes: true,
    },
  });
  // createMany is not available for SQLite in this Prisma version.
  for (const n of [1, 2, 3, 4])
    await prisma.recovery_codes.create({
      data: { user_id: user.id, code_hash: `h${n}` },
    });
  const token = await prisma.password_reset_tokens.create({
    data: {
      user_id: user.id,
      token: "reset-token",
      expiresAt: new Date(Date.now() + expiresInMs),
    },
  });
  return { user, token };
}

async function state(userId) {
  return {
    user: await prisma.users.findUnique({ where: { id: userId } }),
    tokens: await prisma.password_reset_tokens.count({ where: { user_id: userId } }),
    codes: await prisma.recovery_codes.count({ where: { user_id: userId } }),
  };
}

beforeEach(async () => {
  await prisma.event_logs.deleteMany({});
  await prisma.users.deleteMany({});
});

afterAll(async () => {
  await mockDb.cleanup();
});

describe("resetPassword", () => {
  it("changes the password and clears codes and tokens when the new password is accepted", async () => {
    const { user } = await seedUserWithToken();

    const result = await resetPassword("reset-token", "new-password-1", "new-password-1");

    expect(result.success).toBe(true);
    const after = await state(user.id);
    expect(bcrypt.compareSync("new-password-1", after.user.password)).toBe(true);
    expect(after.user.seen_recovery_codes).toBe(false);
    expect(after.tokens).toBe(0);
    expect(after.codes).toBe(0);
  });

  it("leaves seen_recovery_codes, the codes and the token alone when the new password is rejected", async () => {
    const { user } = await seedUserWithToken();

    const result = await resetPassword("reset-token", "short", "short");

    expect(result.success).toBe(false);
    const after = await state(user.id);
    expect(after.user.seen_recovery_codes).toBe(true);
    expect(bcrypt.compareSync("old-password", after.user.password)).toBe(true);
    expect(after.tokens).toBe(1);
    expect(after.codes).toBe(4);
  });

  it("refuses an expired token and changes nothing", async () => {
    const { user } = await seedUserWithToken({ expiresInMs: -1000 });

    const result = await resetPassword("reset-token", "new-password-1", "new-password-1");

    expect(result.success).toBe(false);
    expect((await state(user.id)).user.seen_recovery_codes).toBe(true);
  });

  it("lets only one of two concurrent resets with the same token succeed", async () => {
    await seedUserWithToken();

    const results = await Promise.all([
      resetPassword("reset-token", "first-password", "first-password"),
      resetPassword("reset-token", "second-password", "second-password"),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
  });
});
