/* eslint-env jest */
/**
 * Audit events for workspaces, threads, chat, documents and parsed files in
 * the UI API. Real SQLite for the audit table; models, the collector, the
 * vector database and the LLM stream are mocked.
 */
const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

jest.mock("../../../utils/middleware/validatedRequest", () => ({
  validatedRequest: (_req, res, next) => {
    res.locals.user = { id: 1, role: "admin", username: "root" };
    res.locals.multiUserMode = true;
    res.flushHeaders = () => {}; // the harness response has no SSE support
    next();
  },
}));
jest.mock("../../../utils/middleware/multiUserProtected", () => ({
  ROLES: {
    all: "<all>",
    admin: "admin",
    manager: "manager",
    default: "default",
  },
  flexUserRoleValid: () => (_req, _res, next) => next(),
}));
jest.mock("../../../utils/middleware/validWorkspace", () => ({
  validWorkspaceSlug: (_req, res, next) => {
    res.locals.workspace = {
      id: 5,
      slug: "clinic",
      name: "Clinic",
      chatProvider: "openai",
      chatModel: "gpt-4o",
      chatMode: "chat",
    };
    next();
  },
  validWorkspaceAndThreadSlug: (_req, res, next) => {
    res.locals.workspace = { id: 5, slug: "clinic", name: "Clinic" };
    res.locals.thread = { id: 8, slug: "t-8", name: "Thread" };
    next();
  },
}));
jest.mock("../../../utils/middleware/workspaceDeletionProtection", () => ({
  workspaceDeletionProtection: (_req, _res, next) => next(),
}));
jest.mock("../../../utils/files/multer", () => ({
  handleFileUpload: (req, _res, next) => {
    req.file = { originalname: "lab.pdf", filename: "lab-1.pdf" };
    next();
  },
}));
jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn(async () => {}) },
}));

const mockWorkspace = {
  new: jest.fn(),
  get: jest.fn(),
  getWithUser: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(async () => true),
  trackChange: jest.fn(async () => {}),
  validateFields: jest.fn((data) => {
    const { openAiPrompt, name } = data;
    return {
      ...(openAiPrompt ? { openAiPrompt } : {}),
      ...(name ? { name } : {}),
    };
  }),
};
jest.mock("../../../models/workspace", () => ({ Workspace: mockWorkspace }));

const mockDocument = {
  get: jest.fn(),
  update: jest.fn(async () => {}),
  delete: jest.fn(async () => true),
  removeDocuments: jest.fn(async () => true),
  addDocuments: jest.fn(async () => ({ failedToEmbed: [], errors: [] })),
};
jest.mock("../../../models/documents", () => ({ Document: mockDocument }));
jest.mock("../../../models/vectors", () => ({
  DocumentVectors: { deleteForWorkspace: jest.fn(async () => true) },
}));

const mockChats = {
  delete: jest.fn(async () => true),
  markThreadHistoryInvalidV2: jest.fn(async () => true),
  get: jest.fn(),
  where: jest.fn(async () => []),
  bulkCreate: jest.fn(async () => true),
  updateFeedbackScore: jest.fn(async () => true),
  _update: jest.fn(async () => true),
};
jest.mock("../../../models/workspaceChats", () => ({
  WorkspaceChats: mockChats,
}));

const mockThread = {
  new: jest.fn(),
  get: jest.fn(),
  where: jest.fn(async () => []),
  update: jest.fn(),
  delete: jest.fn(async () => true),
  autoRenameThread: jest.fn(async () => {}),
};
jest.mock("../../../models/workspaceThread", () => ({
  WorkspaceThread: mockThread,
}));
jest.mock("../../../models/user", () => ({
  User: { canSendChat: jest.fn(async () => true) },
}));

const mockParsed = { delete: jest.fn(), moveToDocumentsAndEmbed: jest.fn() };
jest.mock("../../../models/workspaceParsedFiles", () => ({
  WorkspaceParsedFiles: mockParsed,
}));

const mockStream = jest.fn(async () => {});
jest.mock("../../../utils/chats/stream", () => ({
  streamChatWithWorkspace: (...args) => mockStream(...args),
}));
jest.mock("../../../utils/helpers/chat/responses", () => ({
  writeResponseChunk: jest.fn(),
  convertToChatHistory: jest.fn(() => []),
}));

const mockCollector = {
  online: jest.fn(async () => true),
  processLink: jest.fn(async () => ({ success: true })),
  log: jest.fn(),
};
jest.mock("../../../utils/collectorApi", () => ({
  CollectorApi: jest.fn(() => mockCollector),
}));
jest.mock("../../../utils/files/purgeDocument", () => ({
  purgeDocument: jest.fn(async () => {}),
}));
jest.mock("../../../utils/helpers", () => ({
  getVectorDbClass: () => ({ "delete-namespace": jest.fn(async () => {}) }),
  getLLMProvider: jest.fn(),
  stripThinkingFromText: (t) => t,
}));
jest.mock("../../../endpoints/utils", () => ({ getModelTag: () => "tag" }));

const { captureRoutes } = require("../../helpers/routeHarness");
const { workspaceEndpoints } = require("../../../endpoints/workspaces");
const {
  workspaceThreadEndpoints,
} = require("../../../endpoints/workspaceThreads");
const { chatEndpoints } = require("../../../endpoints/chat");
const { audit } = require("../../../utils/audit");

const prisma = mockDb.prisma;
const PHI = "PLANTED-PHI-patient-has-diabetes";

const ws = captureRoutes(workspaceEndpoints);
const threads = captureRoutes(workspaceThreadEndpoints);
const chat = captureRoutes(chatEndpoints);

async function lastEvent(action) {
  const rows = await prisma.audit_events.findMany({
    where: { action },
    orderBy: { id: "desc" },
  });
  return rows[0];
}
const meta = (row) => JSON.parse(row.metadata || "{}");
const expectClean = (row) => expect(JSON.stringify(row)).not.toContain(PHI);

beforeEach(async () => {
  await prisma.audit_events.deleteMany({});
  audit._resetForTests();
  jest.clearAllMocks();
});
afterAll(() => mockDb.cleanup());

describe("workspaces", () => {
  const workspace = { id: 5, slug: "clinic", name: "Clinic" };

  it("records workspace.created", async () => {
    mockWorkspace.new.mockResolvedValue({ workspace, message: null });
    const res = await ws.call("POST", "/workspace/new", {
      body: { name: "Clinic" },
    });
    expect(res.statusCode).toBe(200);
    const row = await lastEvent("workspace.created");
    expect(row).toMatchObject({
      actor_type: "user",
      actor_id: "1",
      target_type: "workspace",
      target_id: "5",
      outcome: "success",
    });
    expect(meta(row)).toMatchObject({
      workspaceName: "Clinic",
      slug: "clinic",
    });
  });

  it("records workspace.updated with field names only", async () => {
    mockWorkspace.getWithUser.mockResolvedValue(workspace);
    mockWorkspace.update.mockResolvedValue({ workspace, message: null });
    await ws.call("POST", "/workspace/:slug/update", {
      params: { slug: "clinic" },
      body: { openAiPrompt: PHI, name: "Clinic 2" },
    });
    const row = await lastEvent("workspace.updated");
    expect(row).toMatchObject({ target_type: "workspace", target_id: "5" });
    expect(meta(row).changedFields.sort()).toEqual(["name", "openAiPrompt"]);
    expectClean(row);
  });

  it("records workspace.deleted and workspace.vectors_reset", async () => {
    mockWorkspace.getWithUser.mockResolvedValue(workspace);
    const del = await ws.call("DELETE", "/workspace/:slug", {
      params: { slug: "clinic" },
    });
    expect(del.statusCode).toBe(200);
    expect(await lastEvent("workspace.deleted")).toMatchObject({
      actor_id: "1",
      target_type: "workspace",
      target_id: "5",
      outcome: "success",
    });

    const reset = await ws.call("DELETE", "/workspace/:slug/reset-vector-db", {
      params: { slug: "clinic" },
    });
    expect(reset.statusCode).toBe(200);
    expect(await lastEvent("workspace.vectors_reset")).toMatchObject({
      target_id: "5",
      outcome: "success",
    });
  });

  it("answers 500 and does not claim success when a must-record row cannot be written", async () => {
    mockWorkspace.getWithUser.mockResolvedValue(workspace);
    const spy = jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("disk full"));
    const outbox = require("../../../utils/audit/outbox");
    const append = jest.spyOn(outbox, "append").mockImplementation(() => {
      throw new Error("no outbox");
    });
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await ws.call("DELETE", "/workspace/:slug", {
      params: { slug: "clinic" },
    });
    expect(res.statusCode).toBe(500);
    spy.mockRestore();
    append.mockRestore();
    err.mockRestore();
  });

  it("records chat.hidden for delete-chats and delete-edited-chats", async () => {
    await ws.call("DELETE", "/workspace/:slug/delete-chats", {
      params: { slug: "clinic" },
      body: { chatIds: [1, 2, 3] },
    });
    const row = await lastEvent("chat.hidden");
    expect(row).toMatchObject({
      actor_id: "1",
      workspace_id: 5,
      outcome: "success",
    });
    expect(meta(row)).toMatchObject({ count: 3, workspaceSlug: "clinic" });

    await prisma.audit_events.deleteMany({});
    await ws.call("DELETE", "/workspace/:slug/delete-edited-chats", {
      params: { slug: "clinic" },
      body: { startingId: 4 },
    });
    expect(await lastEvent("chat.hidden")).toMatchObject({ workspace_id: 5 });
  });

  it("records chat.feedback and chat.hidden for a single chat", async () => {
    mockChats.get.mockResolvedValue({ id: 9, workspaceId: 5 });
    await ws.call("POST", "/workspace/:slug/chat-feedback/:chatId", {
      params: { slug: "clinic", chatId: "9" },
      body: { feedback: true },
    });
    const row = await lastEvent("chat.feedback");
    expect(row).toMatchObject({ target_type: "chat", target_id: "9" });

    await ws.call("PUT", "/workspace/workspace-chats/:id", {
      params: { id: "9" },
    });
    expect(await lastEvent("chat.hidden")).toMatchObject({
      target_type: "chat",
      target_id: "9",
      workspace_id: 5,
    });
  });

  it("records chat.edited with the side edited and never the new text", async () => {
    mockChats.get.mockResolvedValue({ id: 9, workspaceId: 5 });
    mockChats._update.mockClear();
    await ws.call("POST", "/workspace/:slug/update-chat", {
      params: { slug: "clinic" },
      body: { chatId: 9, newText: "PLANTED-PHI chest pain", role: "user" },
    });
    const row = await lastEvent("chat.edited");
    expect(row).toMatchObject({
      target_type: "chat",
      target_id: "9",
      workspace_id: 5,
    });
    expect(meta(row)).toEqual({ role: "user", workspaceSlug: "clinic" });
    expect(JSON.stringify(row)).not.toContain("PLANTED-PHI");
    expect(mockChats._update).toHaveBeenCalledTimes(1);
  });

  it("does not edit the chat when chat.edited cannot be recorded", async () => {
    mockChats.get.mockResolvedValue({ id: 9, workspaceId: 5 });
    mockChats._update.mockClear();
    const create = jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("disk I/O error"));
    const append = jest
      .spyOn(require("../../../utils/audit/outbox"), "append")
      .mockImplementation(() => {
        throw new Error("disk full");
      });
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await ws.call("POST", "/workspace/:slug/update-chat", {
      params: { slug: "clinic" },
      body: { chatId: 9, newText: "x", role: "user" },
    });
    expect(res.statusCode).toBe(500);
    expect(mockChats._update).not.toHaveBeenCalled();
    create.mockRestore();
    append.mockRestore();
    err.mockRestore();
  });

  it("records document.pinned, thread.forked and document.uploaded for a link (host only)", async () => {
    mockDocument.get.mockResolvedValue({ id: 3, filename: "intake.json" });
    await ws.call("POST", "/workspace/:slug/update-pin", {
      params: { slug: "clinic" },
      body: { docPath: "custom-documents/intake.json", pinStatus: true },
    });
    const pin = await lastEvent("document.pinned");
    expect(pin).toMatchObject({ target_type: "document", target_id: "3" });
    expect(meta(pin)).toMatchObject({ pinned: true, workspaceSlug: "clinic" });

    mockThread.new.mockResolvedValue({
      thread: { id: 11, slug: "t-11", name: "x" },
    });
    mockThread.update.mockResolvedValue({ thread: {}, message: null });
    mockChats.where.mockResolvedValue([
      { prompt: PHI, response: JSON.stringify({ text: PHI }) },
    ]);
    const fork = await ws.call("POST", "/workspace/:slug/thread/fork", {
      params: { slug: "clinic" },
      body: { chatId: 9 },
    });
    expect(fork.statusCode).toBe(200);
    const forked = await lastEvent("thread.forked");
    expect(forked).toMatchObject({ target_type: "thread", target_id: "11" });
    expectClean(forked);

    await ws.call("POST", "/workspace/:slug/upload-link", {
      params: { slug: "clinic" },
      body: { link: `https://example.org/records/${PHI}?token=abc` },
    });
    const up = await lastEvent("document.uploaded");
    expect(meta(up)).toMatchObject({ docName: "example.org", via: "link" });
    expectClean(up);
  });

  it("records document.deleted for remove-and-unembed", async () => {
    mockWorkspace.getWithUser.mockResolvedValue(workspace);
    const res = await ws.call("DELETE", "/workspace/:slug/remove-and-unembed", {
      params: { slug: "clinic" },
      body: { documentLocation: "custom-documents/a.json" },
    });
    expect(res.statusCode).toBe(200);
    const row = await lastEvent("document.deleted");
    expect(row).toMatchObject({ workspace_id: 5, outcome: "success" });
    expect(meta(row).docPaths).toEqual(["custom-documents/a.json"]);
  });
});

describe("parsed files", () => {
  it("records parsed_file.deleted, and denied when nothing was removed", async () => {
    mockParsed.delete.mockResolvedValue(true);
    await ws.call("DELETE", "/workspace/:slug/delete-parsed-files", {
      params: { slug: "clinic" },
      body: { fileIds: [4, 5] },
    });
    const row = await lastEvent("parsed_file.deleted");
    expect(row).toMatchObject({ workspace_id: 5, outcome: "success" });
    expect(meta(row)).toMatchObject({ fileIds: [4, 5], count: 2 });

    mockParsed.delete.mockResolvedValue(false);
    const res = await ws.call(
      "DELETE",
      "/workspace/:slug/delete-parsed-files",
      {
        params: { slug: "clinic" },
        body: { fileIds: [6] },
      }
    );
    expect(res.statusCode).toBe(403);
    expect(await lastEvent("parsed_file.deleted")).toMatchObject({
      outcome: "denied",
    });
  });

  it("records parsed_file.embedded", async () => {
    mockParsed.moveToDocumentsAndEmbed.mockResolvedValue({
      success: true,
      document: { filename: "x.json" },
    });
    await ws.call("POST", "/workspace/:slug/embed-parsed-file/:fileId", {
      params: { slug: "clinic", fileId: "4" },
    });
    expect(await lastEvent("parsed_file.embedded")).toMatchObject({
      target_type: "parsed_file",
      target_id: "4",
      workspace_id: 5,
    });
  });
});

describe("threads", () => {
  it("records thread.created, thread.renamed", async () => {
    mockThread.new.mockResolvedValue({
      thread: { id: 12, slug: "t-12", name: "x" },
      message: null,
    });
    await threads.call("POST", "/workspace/:slug/thread/new", {
      params: { slug: "clinic" },
    });
    expect(await lastEvent("thread.created")).toMatchObject({
      target_type: "thread",
      target_id: "12",
      workspace_id: 5,
    });

    mockThread.update.mockResolvedValue({ thread: { id: 8 }, message: null });
    await threads.call("POST", "/workspace/:slug/thread/:threadSlug/update", {
      params: { slug: "clinic", threadSlug: "t-8" },
      body: { name: PHI },
    });
    const renamed = await lastEvent("thread.renamed");
    expect(renamed).toMatchObject({ target_id: "8" });
    expectClean(renamed);
  });

  it("records thread.deleted with chat.hidden for single and bulk deletes", async () => {
    await threads.call("DELETE", "/workspace/:slug/thread/:threadSlug", {
      params: { slug: "clinic", threadSlug: "t-8" },
    });
    expect(await lastEvent("thread.deleted")).toMatchObject({ target_id: "8" });
    expect(meta(await lastEvent("chat.hidden"))).toMatchObject({ threadId: 8 });

    await prisma.audit_events.deleteMany({});
    mockThread.where.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await threads.call("DELETE", "/workspace/:slug/thread-bulk-delete", {
      params: { slug: "clinic" },
      body: { slugs: ["a", "b"] },
    });
    expect(meta(await lastEvent("thread.deleted"))).toMatchObject({ count: 2 });
    expect(await lastEvent("chat.hidden")).toMatchObject({ workspace_id: 5 });
  });

  it("records chat.hidden for delete-edited-chats in a thread", async () => {
    await threads.call(
      "DELETE",
      "/workspace/:slug/thread/:threadSlug/delete-edited-chats",
      { params: { slug: "clinic", threadSlug: "t-8" }, body: { startingId: 3 } }
    );
    expect(meta(await lastEvent("chat.hidden"))).toMatchObject({ threadId: 8 });
  });
});

describe("chat", () => {
  it("records one chat.sent per message with lengths and no text", async () => {
    const message = `${PHI} please summarise`;
    const res = await chat.call("POST", "/workspace/:slug/stream-chat", {
      params: { slug: "clinic" },
      body: { message, attachments: [{ name: "a.png", contentString: PHI }] },
    });
    expect(res.ended).toBe(true);
    const rows = await prisma.audit_events.findMany({
      where: { action: "chat.sent" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: "1",
      workspace_id: 5,
      target_type: "workspace",
      target_id: "5",
    });
    expect(meta(rows[0])).toMatchObject({
      workspaceSlug: "clinic",
      provider: "openai",
      model: "gpt-4o",
      messageLength: message.length,
      attachments: 1,
    });
    expectClean(rows[0]);
  });

  it("records the thread id for thread chats", async () => {
    await chat.call("POST", "/workspace/:slug/thread/:threadSlug/stream-chat", {
      params: { slug: "clinic", threadSlug: "t-8" },
      body: { message: "hello" },
    });
    expect(meta(await lastEvent("chat.sent"))).toMatchObject({
      threadId: 8,
      messageLength: 5,
    });
  });

  it("records nothing for an empty message", async () => {
    await chat.call("POST", "/workspace/:slug/stream-chat", {
      params: { slug: "clinic" },
      body: { message: "  " },
    });
    expect(await lastEvent("chat.sent")).toBeUndefined();
  });
});
