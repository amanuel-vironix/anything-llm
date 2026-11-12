/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createTestPrisma } = require("../../helpers/sqliteTestDb");

const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const { audit, AuditError } = require("../../../utils/audit");
const { CATALOGUE } = require("../../../utils/audit/catalogue");
const context = require("../../../utils/audit/context");
const outbox = require("../../../utils/audit/outbox");

const prisma = mockDb.prisma;
const PLANTED_PHI = "PLANTED-PHI-patient-has-diabetes";
const PLANTED_KEY = "sk-plantedsecretkey1234567890";

let outboxDir;
beforeEach(async () => {
  await prisma.audit_events.deleteMany({});
  audit._resetForTests();
  outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-outbox-"));
  process.env.STORAGE_DIR = outboxDir;
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(outboxDir, { recursive: true, force: true });
  delete process.env.STORAGE_DIR;
});
afterAll(() => mockDb.cleanup());

function requestCtx({ path: p = "/api/workspace/new", user = { id: 7 } } = {}) {
  const ctx = context.newContext({
    channel: context.channelForPath(p),
    ip: "10.0.0.9",
    userAgent: "jest",
    locals: { user, multiUserMode: true },
  });
  return ctx;
}

describe("audit.record", () => {
  it("throws for an action that is not in the catalogue", async () => {
    await expect(audit.record({ action: "user.teleported" })).rejects.toThrow(
      AuditError
    );
    expect(await prisma.audit_events.count()).toBe(0);
  });

  it("writes actor, channel, request id, IP and target from the request context", async () => {
    const ctx = requestCtx();
    await audit.record(
      {
        action: "workspace.deleted",
        targetType: "workspace",
        targetId: 3,
        workspaceId: 3,
        metadata: { slug: "ws" },
      },
      { ctx }
    );
    const row = await prisma.audit_events.findFirst();
    expect(row).toMatchObject({
      action: "workspace.deleted",
      outcome: "success",
      actor_type: "user",
      actor_id: "7",
      on_behalf_of: 7,
      channel: "ui",
      ip: "10.0.0.9",
      user_agent: "jest",
      request_id: ctx.requestId,
      target_type: "workspace",
      target_id: "3",
      workspace_id: 3,
    });
    expect(JSON.parse(row.metadata)).toEqual({ slug: "ws" });
  });

  it("reads the context from AsyncLocalStorage when none is passed", async () => {
    const ctx = requestCtx({ path: "/api/v1/workspace/new", user: null });
    await context.storage.run(ctx, () =>
      audit.record({ action: "workspace.created" })
    );
    const row = await prisma.audit_events.findFirst();
    expect(row.channel).toBe("api");
    expect(row.actor_type).toBe("api_key");
  });

  it("drops metadata keys the action does not allow and counts them", async () => {
    await audit.record({
      action: "chat.sent",
      metadata: { model: "gpt", prompt: PLANTED_PHI, response: PLANTED_PHI },
    });
    const row = await prisma.audit_events.findFirst();
    expect(row.metadata).not.toContain(PLANTED_PHI);
    expect(JSON.parse(row.metadata)).toEqual({ model: "gpt" });
    expect(audit.stats().droppedKeys).toBe(2);
  });

  // Section 5.4: every catalogue action, a planted PHI value in a key it does
  // not allow and a planted secret in every key it does allow.
  it.each(Object.keys(CATALOGUE))(
    "%s keeps planted PHI and secrets out of the row",
    async (action) => {
      const metadata = { content: PLANTED_PHI, text: PLANTED_PHI };
      for (const key of CATALOGUE[action].metadata)
        metadata[key] = `value ${PLANTED_KEY}`;
      const log = jest.spyOn(console, "log").mockImplementation(() => {});
      await audit.record({ action, metadata }, { ctx: requestCtx() });
      const row = await prisma.audit_events.findFirst({ where: { action } });
      expect(JSON.stringify(row)).not.toContain(PLANTED_PHI);
      expect(JSON.stringify(row)).not.toContain(PLANTED_KEY);
      expect(JSON.stringify(log.mock.calls)).not.toContain(PLANTED_PHI);
    }
  );

  it("writes inside the caller's transaction, so a rollback leaves no row", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.record({ action: "user.deleted" }, { tx });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");
    expect(await prisma.audit_events.count()).toBe(0);
  });

  it("queues the row in the outbox when the database rejects it", async () => {
    jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValueOnce(new Error("SQLITE_BUSY"));
    const result = await audit.record({ action: "user.deleted" });
    expect(result).toEqual({ queued: true });
    expect(outbox.backlog(path.join(outboxDir, "audit-outbox"))).toBe(1);
    expect(await prisma.audit_events.count()).toBe(0);

    await audit.flushOutbox(path.join(outboxDir, "audit-outbox"));
    expect(await prisma.audit_events.count()).toBe(1);
    expect(outbox.backlog(path.join(outboxDir, "audit-outbox"))).toBe(0);
  });

  it("throws for a must_record action when the database and the outbox both fail", async () => {
    jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("disk I/O error"));
    // A file where the outbox directory should be makes the append fail.
    fs.writeFileSync(path.join(outboxDir, "audit-outbox"), "not a dir");
    jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(audit.record({ action: "user.deleted" })).rejects.toThrow(
      AuditError
    );
    expect(audit.stats().writeFailed).toBe(1);
  });

  it("returns null and counts the failure for an action that is not must_record", async () => {
    jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("disk I/O error"));
    fs.writeFileSync(path.join(outboxDir, "audit-outbox"), "not a dir");
    jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(audit.record({ action: "chat.sent" })).resolves.toBeNull();
    expect(audit.stats().writeFailed).toBe(1);
  });

  it("recordOrFail answers 500 when a must_record row cannot be written", async () => {
    jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("disk I/O error"));
    fs.writeFileSync(path.join(outboxDir, "audit-outbox"), "not a dir");
    jest.spyOn(console, "error").mockImplementation(() => {});
    const response = {
      locals: {},
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    const ok = await audit.recordOrFail(
      { action: "chat.viewed_other_user" },
      response
    );
    expect(ok).toBe(false);
    expect(response.statusCode).toBe(500);
  });

  it("rate-limits repeated denials from one actor", async () => {
    const ctx = requestCtx();
    for (let i = 0; i < 25; i++)
      await audit.record(
        { action: "access.denied", outcome: "denied", reason: "policy_model" },
        { ctx }
      );
    expect(await prisma.audit_events.count()).toBe(20);
    expect(audit.stats().denialsSuppressed).toBe(5);
  });
});

describe("outbox", () => {
  it("inserts rows left by a crashed process exactly once", async () => {
    const dir = path.join(outboxDir, "audit-outbox");
    const { row } = audit.buildRow({ action: "user.created" });
    outbox.append(row, dir);
    // A torn final line, as a crash mid-write would leave.
    fs.appendFileSync(path.join(dir, `${process.pid}.jsonl`), '{"action":"us');

    await audit.flushOutbox(dir);
    await audit.flushOutbox(dir);
    const rows = await prisma.audit_events.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].occurred_at).toEqual(row.occurred_at);
  });
});

describe("context", () => {
  it.each([
    ["/api/v1/openai/chat/completions", "openai"],
    ["/api/v1/workspace/x/chat", "api"],
    ["/api/embed/abc/stream-chat", "embed"],
    ["/api/mobile/send", "mobile"],
    ["/api/browser-extension/check", "extension"],
    ["/api/agent-invocation/123", "ws"],
    ["/api/workspace/x/chat", "ui"],
  ])("channel for %s is %s", (p, channel) => {
    expect(context.channelForPath(p)).toBe(channel);
  });

  it("names the mobile device as actor and its user as on_behalf_of", () => {
    const ctx = context.newContext({
      channel: "mobile",
      locals: { user: { id: 4 }, device: { id: 9 } },
    });
    expect(context.resolveActor(ctx)).toEqual({
      actorType: "mobile_device",
      actorId: "9",
      onBehalfOf: 4,
    });
  });

  it("middleware sets a request id header and response.locals.audit", () => {
    const headers = {};
    const response = {
      locals: {},
      setHeader: (k, v) => (headers[k] = v),
      on: () => {},
    };
    let seen;
    context.auditContext(
      {
        originalUrl: "/api/v1/auth",
        headers: { "user-agent": "ua" },
        ip: "1.2.3.4",
      },
      response,
      () => (seen = context.currentContext())
    );
    expect(seen).toBe(response.locals.audit);
    expect(headers["X-Request-Id"]).toBe(seen.requestId);
    expect(seen).toMatchObject({
      channel: "api",
      ip: "1.2.3.4",
      userAgent: "ua",
    });
  });
});
