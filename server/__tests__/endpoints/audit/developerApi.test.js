/* eslint-env jest */
/**
 * Audit events for the developer API under /v1. The actor is the API key.
 * Real SQLite for the audit table, workspaces and embeds; the API
 * key check, vector database, chat handlers, collector and MCP layer are mocked.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

jest.mock("../../../utils/middleware/validApiKey", () => ({
  validApiKey: (_req, res, next) => {
    res.locals.apiKey = { id: 42 };
    res.locals.multiUserMode = false;
    // What the audit middleware does for /api/v1 paths.
    const context = require("../../../utils/audit/context");
    res.locals.audit = context.newContext({
      channel: "api",
      locals: res.locals,
    });
    next();
  },
}));
jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn(async () => {}) },
}));
jest.mock("../../../utils/helpers", () => ({
  ...jest.requireActual("../../../utils/helpers"),
  getVectorDbClass: () => ({
    "delete-namespace": jest.fn(async () => {}),
    totalVectors: jest.fn(async () => 0),
  }),
  getEmbeddingEngineSelection: jest.fn(),
  resolveProviderConnector: jest.fn(),
}));
jest.mock("../../../utils/helpers/chat/convertTo", () => ({
  validExportTypes: ["jsonl", "json", "csv"],
  exportChatsAsType: jest.fn(async () => ({
    contentType: "application/json",
    data: "[]",
  })),
}));
jest.mock("../../../utils/files/purgeDocument", () => ({
  purgeDocument: jest.fn(async () => {}),
  purgeFolder: jest.fn(async () => {}),
}));
const mockMcp = {
  saveServer: jest.fn(async () => ({ success: true })),
  toggleServerStatus: jest.fn(async () => ({ success: true, error: null })),
  toggleToolSuppression: jest.fn(async () => ({ success: true })),
  deleteServer: jest.fn(async () => ({ success: true, error: null })),
  mcps: {},
};
jest.mock("../../../utils/MCP", () => jest.fn(() => mockMcp));

const { captureRoutes } = require("../../helpers/routeHarness");
const { audit } = require("../../../utils/audit");
const { apiEmbedEndpoints } = require("../../../endpoints/api/embed");
const { apiSystemEndpoints } = require("../../../endpoints/api/system");
const { apiMCPServerEndpoints } = require("../../../endpoints/api/mcpServers");

const prisma = mockDb.prisma;
const PHI = "PLANTED-PHI-patient-has-diabetes";
const embeds = captureRoutes(apiEmbedEndpoints);
const system = captureRoutes(apiSystemEndpoints);
const mcp = captureRoutes(apiMCPServerEndpoints);

async function rows(action) {
  return prisma.audit_events.findMany({ where: { action } });
}

function expectApiKeyActor(row) {
  expect(row.actor_type).toBe("api_key");
  expect(row.actor_id).toBe("42");
  expect(row.outcome).toBe("success");
}

function expectNoPhi() {
  return prisma.audit_events.findMany().then((all) => {
    expect(JSON.stringify(all)).not.toContain(PHI);
  });
}

beforeEach(async () => {
  audit._resetForTests();
  await prisma.audit_events.deleteMany({});
  await prisma.workspace_threads.deleteMany({});
  await prisma.embed_configs.deleteMany({});
  await prisma.workspaces.deleteMany({});
  jest.clearAllMocks();
});
afterAll(() => mockDb.cleanup());

function makeWorkspace(slug) {
  return prisma.workspaces.create({ data: { name: slug, slug } });
}

describe("developer API embeds", () => {
  it("records embed created, updated and deleted", async () => {
    const workspace = await makeWorkspace("e");
    const made = await embeds.call("POST", "/v1/embed/new", {
      body: { workspace_slug: workspace.slug },
    });
    const embed = made.body.embed;
    const [c] = await rows("embed.created");
    expectApiKeyActor(c);
    expect(c.target_id).toBe(String(embed.id));

    await embeds.call("POST", "/v1/embed/:embedUuid", {
      params: { embedUuid: embed.uuid },
      body: { enabled: true },
    });
    const [u] = await rows("embed.updated");
    expectApiKeyActor(u);
    expect(u.metadata).toContain("enabled");

    await embeds.call("DELETE", "/v1/embed/:embedUuid", {
      params: { embedUuid: embed.uuid },
    });
    const [d] = await rows("embed.deleted");
    expectApiKeyActor(d);
  });

  it("fails the request when a must-record embed event cannot be written", async () => {
    const workspace = await makeWorkspace("e2");
    // A file where the outbox directory should be makes the append fail too.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-dev-api-"));
    fs.writeFileSync(path.join(dir, "audit-outbox"), "not a dir");
    process.env.STORAGE_DIR = dir;
    const create = jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("db down"));
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await embeds.call("POST", "/v1/embed/new", {
        body: { workspace_slug: workspace.slug },
      });
      expect(res.statusCode).toBe(500);
    } finally {
      create.mockRestore();
      log.mockRestore();
      delete process.env.STORAGE_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("developer API system", () => {
  it("records chat.exported before sending the export", async () => {
    const res = await system.call("GET", "/v1/system/export-chats", {
      query: { type: "json" },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await rows("chat.exported");
    expectApiKeyActor(row);
    expect(JSON.parse(row.metadata).format).toBe("json");
  });

  it("records document.deleted for remove-documents", async () => {
    await system.call("DELETE", "/v1/system/remove-documents", {
      body: { names: ["custom-documents/a.json", "custom-documents/b.json"] },
    });
    const [row] = await rows("document.deleted");
    expectApiKeyActor(row);
    expect(JSON.parse(row.metadata).count).toBe(2);
  });
});

describe("developer API MCP servers", () => {
  it("records server added, updated, started, stopped, tool toggled and removed", async () => {
    await mcp.call("POST", "/v1/mcp-servers/new", {
      body: { name: "ehr", config: { command: "node", env: { TOKEN: PHI } } },
    });
    expectApiKeyActor((await rows("mcp.server_added"))[0]);

    await mcp.call("POST", "/v1/mcp-servers/:name/update", {
      params: { name: "ehr" },
      body: { config: { command: "node" } },
    });
    expectApiKeyActor((await rows("mcp.server_updated"))[0]);

    mockMcp.mcps = { ehr: {} };
    await mcp.call("POST", "/v1/mcp-servers/:name/toggle", {
      params: { name: "ehr" },
    });
    expectApiKeyActor((await rows("mcp.server_started"))[0]);
    mockMcp.mcps = {};
    await mcp.call("POST", "/v1/mcp-servers/:name/toggle", {
      params: { name: "ehr" },
    });
    expectApiKeyActor((await rows("mcp.server_stopped"))[0]);

    await mcp.call("POST", "/v1/mcp-servers/:name/toggle-tool", {
      params: { name: "ehr" },
      body: { toolName: "lookup", enabled: false },
    });
    const [tool] = await rows("mcp.tool_toggled");
    expectApiKeyActor(tool);
    expect(JSON.parse(tool.metadata)).toMatchObject({
      server: "ehr",
      tool: "lookup",
      enabled: false,
    });

    await mcp.call("DELETE", "/v1/mcp-servers/:name", {
      params: { name: "ehr" },
    });
    expectApiKeyActor((await rows("mcp.server_removed"))[0]);
    await expectNoPhi();
  });

  it("records nothing when the layer reports failure", async () => {
    mockMcp.saveServer.mockResolvedValueOnce({ success: false });
    await mcp.call("POST", "/v1/mcp-servers/new", {
      body: { name: "bad", config: {} },
    });
    expect(await rows("mcp.server_added")).toHaveLength(0);
  });
});

describe("developer API documents", () => {
  const mockCollector = {
    online: jest.fn(async () => true),
    processRawText: jest.fn(async () => ({
      success: true,
      documents: [{ id: "doc-1", location: "custom-documents/note-1.json" }],
    })),
    log: jest.fn(),
  };

  it("records document.uploaded for raw text without the text", async () => {
    jest.resetModules();
    jest.doMock("../../../utils/collectorApi", () => ({
      CollectorApi: jest.fn(() => mockCollector),
    }));
    const { apiDocumentEndpoints } = require("../../../endpoints/api/document");
    const docs = captureRoutes(apiDocumentEndpoints);
    const res = await docs.call("POST", "/v1/document/raw-text", {
      body: { textContent: PHI, metadata: { title: "Note" } },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await rows("document.uploaded");
    expectApiKeyActor(row);
    expect(JSON.parse(row.metadata)).toMatchObject({
      count: 1,
      via: "raw_text",
    });
    await expectNoPhi();
  });

  it("records document.deleted for remove-folder", async () => {
    const { apiDocumentEndpoints } = require("../../../endpoints/api/document");
    const docs = captureRoutes(apiDocumentEndpoints);
    await docs.call("DELETE", "/v1/document/remove-folder", {
      body: { name: "intake" },
    });
    const [row] = await rows("document.deleted");
    expectApiKeyActor(row);
    expect(row.target_id).toBe("intake");
  });
});
