/* eslint-env jest */
/**
 * Audit events for server/endpoints/system.js: onboarding, account recovery,
 * password changes, document removal, profile picture, logo, default prompt,
 * event log and chat views, chat export and deletion, own-profile update.
 * Runs the real handlers on a real SQLite database; only file, upload,
 * export and env helpers are mocked.
 */
const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const mockState = { user: { id: 1, username: "admin", role: "admin" } };
jest.mock("../../../utils/middleware/validatedRequest", () => ({
  validatedRequest: (_req, res, next) => {
    res.locals.user = mockState.user;
    res.locals.multiUserMode = !!mockState.multi;
    next();
  },
}));
jest.mock("../../../utils/middleware/multiUserProtected", () => ({
  ROLES: {
    admin: "admin",
    manager: "manager",
    default: "default",
    all: "<all>",
  },
  flexUserRoleValid: () => (_req, _res, next) => next(),
  isMultiUserSetup: (_req, _res, next) => next(),
  isSingleUserMode: (_req, _res, next) => next(),
}));
jest.mock("../../../utils/middleware/simpleSSOEnabled", () => ({
  simpleSSOEnabled: (_req, _res, next) => next(),
  simpleSSOLoginDisabled: (_req, _res, next) => next(),
}));
jest.mock("../../../utils/files/multer", () => ({
  handlePfpUpload: (req, _res, next) => {
    req.randomFileName = "pfp-new.png";
    next();
  },
  handleAssetUpload: (req, _res, next) => {
    req.file = { originalname: "logo.png" };
    next();
  },
}));
jest.mock("../../../utils/files/logo", () => ({
  getDefaultFilename: jest.fn(() => "anything-llm.png"),
  determineLogoFilepath: jest.fn(),
  fetchLogo: jest.fn(),
  validFilename: jest.fn(() => true),
  renameLogoFile: jest.fn(async () => "logo-new.png"),
  removeCustomLogo: jest.fn(async () => {}),
  LOGO_FILENAME: "anything-llm.png",
  isDefaultFilename: jest.fn(() => true),
}));
jest.mock("../../../utils/files/purgeDocument", () => ({
  purgeDocument: jest.fn(async () => {}),
  purgeFolder: jest.fn(async () => {}),
}));
jest.mock("../../../utils/helpers/updateENV", () => ({
  updateENV: jest.fn(async () => ({ newValues: {}, error: null })),
  dumpENV: jest.fn(),
}));
jest.mock("../../../utils/helpers/chat/convertTo", () => ({
  exportChatsAsType: jest.fn(async () => ({
    contentType: "application/jsonl",
    data: '{"prompt":"x"}',
  })),
}));
jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn(async () => {}) },
}));

const { captureRoutes } = require("../../helpers/routeHarness");
const { systemEndpoints } = require("../../../endpoints/system");
const { generateRecoveryCodes } = require("../../../utils/PasswordRecovery");
const { PasswordResetToken } = require("../../../models/passwordRecovery");
const { audit } = require("../../../utils/audit");
const { purgeDocument } = require("../../../utils/files/purgeDocument");
const { exportChatsAsType } = require("../../../utils/helpers/chat/convertTo");

const prisma = mockDb.prisma;
const routes = captureRoutes(systemEndpoints);
const PHI = "Patient Jane Roe has diabetes";
const SECRET_PASSWORD = "Planted-Pa55word-Zeta!";

const rows = (where = {}) =>
  prisma.audit_events.findMany({ where, orderBy: { id: "asc" } });
const meta = (row) => JSON.parse(row.metadata || "{}");
const only = async (action) => {
  const found = await rows({ action });
  expect(found).toHaveLength(1);
  return found[0];
};

// User.update also records user.updated itself (legacy wrapper, system actor
// here because the harness has no request context); the route's own row is the
// one with the session user as actor.
const routeUserUpdates = () =>
  rows({ action: "user.updated", actor_type: "user" });

// No audit row may carry the planted text, whatever the action.
async function expectNoSecrets() {
  const all = JSON.stringify(await rows());
  for (const secret of [PHI, SECRET_PASSWORD]) {
    expect(all).not.toContain(secret);
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  audit._resetForTests();
  mockState.user = { id: 1, username: "admin", role: "admin" };
  mockState.multi = false;
  await prisma.audit_events.deleteMany({});
  await prisma.workspace_chats.deleteMany({});
  await prisma.password_reset_tokens.deleteMany({});
  await prisma.recovery_codes.deleteMany({});
  await prisma.system_settings.deleteMany({});
  await prisma.workspaces.deleteMany({});
  await prisma.users.deleteMany({});
  await prisma.users.create({
    data: { id: 1, username: "admin", password: "x", role: "admin" },
  });
});
afterAll(() => mockDb.cleanup());

// settings.changed for these routes is recorded by SystemSettings, not the
// route, so the actor comes from the request context (absent in this harness).
describe("settings (recorded by SystemSettings)", () => {
  it("records settings.changed for onboarding from the model", async () => {
    const res = await routes.call("POST", "/onboarding");
    expect(res.statusCode).toBe(200);
    const row = await only("settings.changed");
    expect(row).toMatchObject({
      outcome: "success",
      target_id: "onboarding_complete",
    });
    expect(meta(row)).toMatchObject({
      key: "onboarding_complete",
      source: "system_settings",
    });
  });

  it("records the default system prompt change from the model without the text", async () => {
    const res = await routes.call("POST", "/system/default-system-prompt", {
      body: { defaultSystemPrompt: PHI },
    });
    expect(res.statusCode).toBe(200);
    const row = await only("settings.changed");
    expect(row.outcome).toBe("success");
    expect(meta(row)).toMatchObject({
      key: "default_system_prompt",
      source: "system_settings",
    });
  });

  // Free-text labels are named, never stored (SystemSettings._recordChanges).
  it("keeps the default system prompt text out of the audit row", async () => {
    await routes.call("POST", "/system/default-system-prompt", {
      body: { defaultSystemPrompt: PHI },
    });
    await expectNoSecrets();
  });

  it("records settings.changed for logo upload and reset from the model", async () => {
    await routes.call("POST", "/system/upload-logo");
    await routes.call("GET", "/system/remove-logo");
    const found = await rows({ action: "settings.changed" });
    expect(found.map((r) => meta(r).key)).toEqual([
      "logo_filename",
      "logo_filename",
    ]);
    expect(found.every((r) => meta(r).source === "system_settings")).toBe(true);
  });
});

describe("passwords and recovery", () => {
  it("records auth.password_changed for single-user update-password without the password", async () => {
    const res = await routes.call("POST", "/system/update-password", {
      body: { usePassword: true, newPassword: SECRET_PASSWORD },
    });
    expect(res.body.success).toBe(true);
    const row = await only("auth.password_changed");
    expect(row).toMatchObject({ outcome: "success", actor_id: "1" });
    await expectNoSecrets();
  });

  it("records a denied attempt in multi-user mode", async () => {
    mockState.multi = true;
    const res = await routes.call("POST", "/system/update-password", {
      body: { usePassword: true, newPassword: SECRET_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
    const row = await only("auth.password_changed");
    expect(row).toMatchObject({
      outcome: "denied",
      reason: "multi_user_mode",
    });
    await expectNoSecrets();
  });

  it("records auth.recovery_used as denied for wrong codes, without the username or codes", async () => {
    const res = await routes.call("POST", "/system/recover-account", {
      body: {
        username: "admin",
        recoveryCodes: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    const row = await only("auth.recovery_used");
    expect(row).toMatchObject({ outcome: "denied", reason: "invalid_codes" });
    const text = JSON.stringify(row);
    expect(text).not.toContain("11111111-1111");
    expect(text).not.toContain('"admin"');
  });

  it("records auth.recovery_used success naming the user, then the reset", async () => {
    const codes = await generateRecoveryCodes(1);
    const rec = await routes.call("POST", "/system/recover-account", {
      body: { username: "admin", recoveryCodes: codes.slice(0, 2) },
    });
    expect(rec.body.success).toBe(true);
    const used = await only("auth.recovery_used");
    expect(used).toMatchObject({
      outcome: "success",
      actor_type: "user",
      actor_id: "1",
      target_id: "1",
    });
    expect(JSON.stringify(used)).not.toContain(codes[0]);
    expect(JSON.stringify(used)).not.toContain(rec.body.resetToken);

    const reset = await routes.call("POST", "/system/reset-password", {
      body: {
        token: rec.body.resetToken,
        newPassword: SECRET_PASSWORD,
        confirmPassword: SECRET_PASSWORD,
      },
    });
    expect(reset.body.success).toBe(true);
    const row = await only("auth.password_reset");
    expect(row).toMatchObject({
      outcome: "success",
      actor_id: "1",
      target_type: "user",
      target_id: "1",
    });
    expect(JSON.stringify(await rows())).not.toContain(rec.body.resetToken);
    await expectNoSecrets();
  });

  it("records auth.password_reset failed for a bad token and for mismatched passwords", async () => {
    const bad = await routes.call("POST", "/system/reset-password", {
      body: {
        token: "nope",
        newPassword: SECRET_PASSWORD,
        confirmPassword: SECRET_PASSWORD,
      },
    });
    expect(bad.statusCode).toBe(400);
    const { passwordResetToken } = await PasswordResetToken.create(1);
    jest.spyOn(console, "error").mockImplementation(() => {});
    const mismatch = await routes.call("POST", "/system/reset-password", {
      body: {
        token: passwordResetToken.token,
        newPassword: SECRET_PASSWORD,
        confirmPassword: "different",
      },
    });
    console.error.mockRestore();
    expect(mismatch.statusCode).toBe(500);
    const found = await rows({ action: "auth.password_reset" });
    expect(found.map((r) => [r.outcome, r.reason, r.target_id])).toEqual([
      ["failed", "rejected", null],
      ["failed", "invalid_request", "1"],
    ]);
    await expectNoSecrets();
  });

  it("records user.updated with field names only for the own-profile update", async () => {
    mockState.user = { id: 1, username: "admin", role: "admin" };
    const res = await routes.call("POST", "/system/user", {
      body: { username: "admin", password: SECRET_PASSWORD, bio: PHI },
    });
    expect(res.body.success).toBe(true);
    const row = await routeUserUpdates().then((r) => {
      expect(r).toHaveLength(1);
      return r[0];
    });
    expect(row).toMatchObject({
      outcome: "success",
      actor_id: "1",
      target_type: "user",
      target_id: "1",
    });
    expect(meta(row).changedFields.sort()).toEqual(["bio", "password"]);
    const pw = await only("auth.password_changed");
    expect(pw).toMatchObject({ outcome: "success", target_id: "1" });
    expect(JSON.stringify([row, pw])).not.toContain(PHI);
    expect(JSON.stringify(await rows())).not.toContain(SECRET_PASSWORD);
  });

  it("records user.updated for profile picture upload and removal", async () => {
    await routes.call("POST", "/system/upload-pfp");
    await routes.call("DELETE", "/system/remove-pfp");
    const found = await routeUserUpdates();
    expect(found).toHaveLength(2);
    for (const row of found) {
      expect(row).toMatchObject({ outcome: "success", target_id: "1" });
      expect(meta(row)).toEqual({ changedFields: ["pfpFilename"] });
    }
    const user = await prisma.users.findUnique({ where: { id: 1 } });
    expect(user.pfpFilename).not.toBe("pfp-new.png");
  });

  // models/user.js logs `changes` with the bio text through the legacy
  // wrapper; the user_updated mapping keeps values only for access fields.
  it("keeps the bio text out of every user.updated row", async () => {
    await routes.call("POST", "/system/user", {
      body: { username: "admin", bio: PHI },
    });
    await expectNoSecrets();
  });
});

describe("documents", () => {
  it("records document.deleted for one document, many and a folder", async () => {
    await routes.call("DELETE", "/system/remove-document", {
      body: { name: "custom-documents/a.json" },
    });
    await routes.call("DELETE", "/system/remove-documents", {
      body: { names: ["f/a.json", "f/b.json"] },
    });
    await routes.call("DELETE", "/system/remove-folder", {
      body: { name: "f" },
    });
    const found = await rows({ action: "document.deleted" });
    expect(found).toHaveLength(3);
    expect(found.every((r) => r.actor_id === "1")).toBe(true);
    expect(meta(found[0])).toMatchObject({
      docName: "custom-documents/a.json",
      count: 1,
    });
    expect(meta(found[1])).toMatchObject({
      docPaths: ["f/a.json", "f/b.json"],
      count: 2,
    });
    expect(found[2].target_id).toBe("f");
  });

  it("returns 500 when document.deleted cannot be written", async () => {
    const spy = jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("db down"));
    const outbox = require("../../../utils/audit/outbox");
    const outboxSpy = jest.spyOn(outbox, "append").mockImplementation(() => {
      throw new Error("disk full");
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await routes.call("DELETE", "/system/remove-document", {
      body: { name: "custom-documents/a.json" },
    });
    expect(res.statusCode).toBe(500);
    expect(purgeDocument).toHaveBeenCalled();
    spy.mockRestore();
    outboxSpy.mockRestore();
    console.error.mockRestore();
  });
});

describe("chats and the audit trail", () => {
  let workspace;
  beforeEach(async () => {
    workspace = await prisma.workspaces.create({
      data: { name: "Clinic", slug: "clinic" },
    });
    await prisma.workspace_chats.create({
      data: {
        workspaceId: workspace.id,
        prompt: PHI,
        response: JSON.stringify({ text: PHI }),
        user_id: 1,
      },
    });
  });

  it("records chat.viewed_other_user with a count, not the chats", async () => {
    const res = await routes.call("POST", "/system/workspace-chats", {
      body: { offset: 0, limit: 20 },
    });
    expect(res.body.chats).toHaveLength(1);
    const row = await only("chat.viewed_other_user");
    expect(row).toMatchObject({ outcome: "success", actor_id: "1" });
    expect(meta(row).count).toBe(1);
    await expectNoSecrets();
  });

  it("returns no chats when chat.viewed_other_user cannot be written", async () => {
    const spy = jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("db down"));
    const outbox = require("../../../utils/audit/outbox");
    const outboxSpy = jest.spyOn(outbox, "append").mockImplementation(() => {
      throw new Error("disk full");
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await routes.call("POST", "/system/workspace-chats", {
      body: {},
    });
    expect(res.statusCode).toBe(500);
    expect(res.body?.chats).toBeUndefined();
    spy.mockRestore();
    outboxSpy.mockRestore();
    console.error.mockRestore();
  });

  it("records chat.exported before sending, and sends nothing if it fails", async () => {
    const res = await routes.call("GET", "/system/export-chats", {
      query: { type: "jsonl", chatType: "workspace" },
    });
    expect(res.statusCode).toBe(200);
    const row = await only("chat.exported");
    expect(row).toMatchObject({ outcome: "success", actor_id: "1" });
    expect(meta(row).format).toBe("jsonl");

    const spy = jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("db down"));
    const outbox = require("../../../utils/audit/outbox");
    const outboxSpy = jest.spyOn(outbox, "append").mockImplementation(() => {
      throw new Error("disk full");
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    exportChatsAsType.mockClear();
    const blocked = await routes.call("GET", "/system/export-chats", {
      query: {},
    });
    expect(blocked.statusCode).toBe(500);
    expect(blocked.body.success).toBe(false);
    expect(JSON.stringify(blocked.body)).not.toContain("prompt");
    spy.mockRestore();
    outboxSpy.mockRestore();
    console.error.mockRestore();
  });

  it("records chat.deleted for one chat and chat.bulk_deleted for all", async () => {
    const chat = await prisma.workspace_chats.findFirst({});
    await routes.call("DELETE", "/system/workspace-chats/:id", {
      params: { id: String(chat.id) },
    });
    const one = await only("chat.deleted");
    expect(one).toMatchObject({
      outcome: "success",
      actor_id: "1",
      target_id: String(chat.id),
    });
    expect(await prisma.workspace_chats.count()).toBe(0);

    await routes.call("DELETE", "/system/workspace-chats/:id", {
      params: { id: "-1" },
    });
    const bulk = await only("chat.bulk_deleted");
    expect(bulk).toMatchObject({ outcome: "success", actor_id: "1" });
    await expectNoSecrets();
  });

  it("records audit.viewed when the event log is read", async () => {
    const res = await routes.call("POST", "/system/event-logs", {
      body: { offset: 0, limit: 10 },
    });
    expect(res.statusCode).toBe(200);
    const row = await only("audit.viewed");
    expect(row).toMatchObject({ outcome: "success", actor_id: "1" });
    expect(meta(row).filter).toEqual({ offset: 0, limit: 10 });
  });
});
