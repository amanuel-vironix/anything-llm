/* eslint-env jest */
const fs = require("fs");
const path = require("path");
const { createTestPrisma } = require("../../helpers/sqliteTestDb");

const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const { EventLogs } = require("../../../models/eventLogs");
const { audit } = require("../../../utils/audit");
const { LEGACY_EVENT_MAP } = require("../../../utils/audit/legacy");
const { entryFor } = require("../../../utils/audit/catalogue");
const context = require("../../../utils/audit/context");
const backstop = require("../../../utils/audit/backstop");
const { hashValue } = require("../../../utils/audit/sanitize");

const prisma = mockDb.prisma;

beforeEach(async () => {
  await prisma.audit_events.deleteMany({});
  await prisma.event_logs.deleteMany({});
  audit._resetForTests();
});
afterAll(() => mockDb.cleanup());

function adminCtx() {
  return context.newContext({
    channel: "ui",
    locals: { user: { id: 1, username: "admin" }, multiUserMode: true },
  });
}

describe("EventLogs.logEvent wrapper", () => {
  it.each(Object.keys(LEGACY_EVENT_MAP))(
    "maps legacy %s to catalogue actions",
    (event) => {
      const events = [].concat(
        LEGACY_EVENT_MAP[event]({ changes: { role: "default => admin" } }, 5)
      );
      for (const e of events) expect(entryFor(e.action)).not.toBeNull();
    }
  );

  // F-55: user_updated passed the target as userId.
  it("records the acting admin as actor and the edited user as target for user_updated", async () => {
    await context.storage.run(adminCtx(), () =>
      EventLogs.logEvent(
        "user_updated",
        {
          username: "bob",
          changes: { role: "default => admin", suspended: "0 => 1" },
        },
        42
      )
    );
    const rows = await prisma.audit_events.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((r) => r.action)).toEqual([
      "user.updated",
      "user.role_changed",
      "user.suspended",
    ]);
    for (const row of rows)
      expect(row).toMatchObject({
        actor_type: "user",
        actor_id: "1",
        target_type: "user",
        target_id: "42",
      });
    expect(JSON.parse(rows[1].metadata)).toMatchObject({
      from: "default",
      to: "admin",
    });
  });

  // F-55: invite_created stored the code in plain text.
  it("stores a hash of the invite code, never the code", async () => {
    await context.storage.run(adminCtx(), () =>
      EventLogs.logEvent(
        "invite_created",
        { inviteCode: "SECRETCODE123", createdBy: "admin" },
        1
      )
    );
    const row = await prisma.audit_events.findFirst();
    expect(row.action).toBe("invite.created");
    expect(row.metadata).not.toContain("SECRETCODE123");
    expect(JSON.parse(row.metadata).codeHash).toBe(hashValue("SECRETCODE123"));
  });

  it("never stores the workspace system prompt", async () => {
    await EventLogs.logEvent("workspace_prompt_changed", {
      workspaceName: "w",
      prevSystemPrompt: "old prompt about patient",
      newSystemPrompt: "new prompt about patient",
    });
    const row = await prisma.audit_events.findFirst();
    expect(row.metadata).not.toContain("patient");
  });

  it("records the logged-in user as actor of a login", async () => {
    await EventLogs.logEvent(
      "login_event",
      { ip: "1.1.1.1", username: "amy" },
      3
    );
    const row = await prisma.audit_events.findFirst();
    expect(row).toMatchObject({
      action: "auth.login_succeeded",
      actor_type: "user",
      actor_id: "3",
    });
  });

  it("keeps only the email domain of a failed Google sign-in", async () => {
    await EventLogs.logEvent("failed_login_oidc", {
      ip: "1.1.1.1",
      reason: "domain_not_allowed",
      email: "pat.smith@example.com",
      detail: "id_token for pat.smith@example.com rejected",
    });
    const row = await prisma.audit_events.findFirst();
    expect(row).toMatchObject({
      action: "auth.login_failed",
      outcome: "failed",
      reason: "domain_not_allowed",
    });
    expect(JSON.parse(row.metadata)).toEqual({
      method: "oidc",
      emailDomain: "example.com",
    });
    expect(JSON.stringify(row)).not.toContain("pat.smith");
  });

  it("records a refused ownerless API key as access.denied by that key", async () => {
    await EventLogs.logEvent("legacy_api_key_refused", {
      apiKeyId: 9,
      path: "/v1/workspaces",
    });
    const row = await prisma.audit_events.findFirst();
    expect(row).toMatchObject({
      action: "access.denied",
      outcome: "denied",
      reason: "key_scope",
      actor_type: "api_key",
      actor_id: "9",
    });
  });

  it("records an API key scope change with no secret", async () => {
    await EventLogs.logEvent(
      "api_key_updated",
      { apiKeyId: 4, userId: 2, workspaceIds: [1, 3], secret: "sk-abc123" },
      1
    );
    const row = await prisma.audit_events.findFirst();
    expect(row).toMatchObject({ action: "api_key.updated", target_id: "4" });
    expect(JSON.parse(row.metadata)).toEqual({
      keyId: 4,
      ownerId: 2,
      workspaceIds: [1, 3],
    });
  });

  it("reports, rather than throws, a failed must_record write from a legacy caller", async () => {
    jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("disk I/O error"));
    jest
      .spyOn(require("../../../utils/audit/outbox"), "append")
      .mockImplementation(() => {
        throw new Error("disk full");
      });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await EventLogs.logEvent(
      "user_deleted",
      { userName: "x" },
      1
    );
    expect(result.eventLog).toBeNull();
    expect(result.message).toMatch(/could not be written/);
    jest.restoreAllMocks();
  });
});

describe("EventLogs readers", () => {
  it("returns audit rows in the old shape for the Event Logs page", async () => {
    await audit.record(
      { action: "workspace.deleted", targetType: "workspace", targetId: 2 },
      { ctx: adminCtx() }
    );
    const [row] = await EventLogs.whereWithData({}, 10, 0, { id: "desc" });
    expect(row.event).toBe("workspace.deleted");
    expect(row.userId).toBe(1);
    expect(JSON.parse(row.metadata)).toMatchObject({
      outcome: "success",
      actor: "user:1",
      target: "workspace:2",
    });
    expect(await EventLogs.count()).toBe(1);
  });
});

describe("migration", () => {
  it("copies event_logs into audit_events without the invite code", async () => {
    for (const data of [
      { event: "login_event", metadata: '{"username":"a"}', userId: 3 },
      {
        event: "invite_created",
        metadata: '{"inviteCode":"PLAIN"}',
        userId: 1,
      },
      { event: "update_vector_db", metadata: null, userId: null },
    ])
      await prisma.event_logs.create({ data });
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        "../../../prisma/migrations/20261111180000_audit_events/migration.sql"
      ),
      "utf8"
    );
    const insert = sql.slice(sql.indexOf('INSERT INTO "audit_events"'));
    await prisma.$executeRawUnsafe(insert);

    const rows = await prisma.audit_events.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.action, r.actor_type, r.actor_id])).toEqual([
      ["legacy.login_event", "user", "3"],
      ["legacy.invite_created", "user", "1"],
      ["legacy.update_vector_db", "unknown", null],
    ]);
    expect(rows[1].metadata).toBeNull();
  });
});

describe("database backstop", () => {
  beforeAll(() => backstop.install(prisma));

  it("writes db.write for a sensitive write with no catalogue event", async () => {
    const ctx = adminCtx();
    await context.storage.run(ctx, async () => {
      await prisma.users.create({ data: { username: "nolog", password: "x" } });
    });
    await backstop.flush(ctx);
    const row = await prisma.audit_events.findFirst({
      where: { action: "db.write" },
    });
    expect(row).toMatchObject({ target_type: "users", actor_id: "1" });
  });

  it("writes nothing when a catalogue event covered the table", async () => {
    const ctx = adminCtx();
    await context.storage.run(ctx, async () => {
      await prisma.users.create({
        data: { username: "logged", password: "x" },
      });
      await audit.record({ action: "user.created" });
    });
    await backstop.flush(ctx);
    expect(
      await prisma.audit_events.count({ where: { action: "db.write" } })
    ).toBe(0);
  });

  it("ignores new chats but catches hidden ones", async () => {
    const ws = await prisma.workspaces.create({
      data: { name: "w", slug: "w-bs" },
    });
    const ctx = adminCtx();
    await context.storage.run(ctx, async () => {
      const chat = await prisma.workspace_chats.create({
        data: { workspaceId: ws.id, prompt: "p", response: "r" },
      });
      await backstop.flush(ctx);
      expect(
        await prisma.audit_events.count({ where: { action: "db.write" } })
      ).toBe(0);
      await prisma.workspace_chats.update({
        where: { id: chat.id },
        data: { include: false },
      });
    });
    await backstop.flush(ctx);
    expect(
      await prisma.audit_events.findFirst({ where: { action: "db.write" } })
    ).toMatchObject({ target_type: "workspace_chats" });
  });

  it("flushes writes made inside audit.runAs when the job ends", async () => {
    await audit.runAs(
      { actorType: "job", actorId: "extract-memories", channel: "job" },
      () =>
        prisma.system_settings.create({
          data: { label: "bs_test", value: "1" },
        })
    );
    expect(
      await prisma.audit_events.findFirst({ where: { action: "db.write" } })
    ).toMatchObject({
      actor_type: "job",
      channel: "job",
      target_type: "system_settings",
    });
  });
});
