/* eslint-env jest */
/**
 * Audit events for the external channels: embed widget and its management,
 * browser extension, Telegram, Community Hub, data connectors, chat export and
 * Outlook sign-in. Runs the real handlers on a real SQLite database; only the
 * collector, Telegram, hub and Outlook libraries are mocked.
 */
const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const mockUser = { id: 1, username: "admin", role: "admin" };
jest.mock("../../../utils/middleware/validatedRequest", () => ({
  validatedRequest: (_req, res, next) => {
    res.locals.user = mockUser;
    res.locals.multiUserMode = false;
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
  isSingleUserMode: (_req, _res, next) => next(),
}));
jest.mock("../../../utils/middleware/validBrowserExtensionApiKey", () => ({
  validBrowserExtensionApiKey: (_req, res, next) => {
    res.locals.apiKey = { id: 7 };
    res.locals.user = mockUser;
    res.locals.multiUserMode = false;
    next();
  },
}));
jest.mock("../../../utils/middleware/isSupportedRepoProviders", () => ({
  isSupportedRepoProvider: (_req, _res, next) => next(),
}));
jest.mock("../../../utils/middleware/communityHubDownloadsEnabled", () => ({
  communityHubDownloadsEnabled: (_req, _res, next) => next(),
  communityHubItem: (_req, res, next) => {
    res.locals.bundleItem = { id: "hub-1", itemType: "slash-command" };
    res.locals.bundleUrl = "https://hub.example.com/x.zip";
    next();
  },
}));
const mockCollector = {
  processRawText: jest.fn(),
  forwardExtensionRequest: jest.fn(),
};
jest.mock("../../../utils/collectorApi", () => ({
  CollectorApi: jest.fn(() => mockCollector),
}));
jest.mock("../../../models/documents", () => ({
  Document: { addDocuments: jest.fn(async () => ({ failedToEmbed: [] })) },
}));
jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn(async () => {}) },
}));
jest.mock("../../../utils/telegramBot", () => ({
  TelegramBotService: Object.assign(
    jest.fn(() => ({
      isRunning: false,
      stop: jest.fn(),
      start: jest.fn(),
      approvePendingUser: jest.fn(),
      denyPendingUser: jest.fn(),
      revokeExistingUser: jest.fn(),
    })),
    { verifyToken: jest.fn(async () => ({ valid: true, username: "my_bot" })) }
  ),
}));
jest.mock("../../../utils/telegramBot/utils", () => ({
  encryptToken: (t) => `enc:${t}`,
}));
jest.mock("../../../models/communityHub", () => ({
  CommunityHub: {
    applyItem: jest.fn(async () => ({ error: null })),
    importBundleItem: jest.fn(async () => ({ error: null })),
    createStaticItem: jest.fn(async () => ({ success: true, itemId: "new-1" })),
  },
}));
jest.mock("../../../utils/chats/exportChatToFile", () => ({
  validExportTypes: ["json", "csv"],
  sendChatHistoryFile: jest.fn((res) => res.status(200).json({ file: true })),
}));
const mockOutlook = {
  AUTH_TYPES: { common: "common", organization: "organization" },
  OutlookBridge: {
    getConfig: jest.fn(async () => ({})),
    updateConfig: jest.fn(async () => {}),
  },
  reset: jest.fn(),
  getAuthUrl: jest.fn(async () => ({ success: true, url: "https://login/x" })),
  exchangeCodeForToken: jest.fn(async () => ({ success: true })),
};
jest.mock(
  "../../../utils/agents/aibitat/plugins/outlook/lib",
  () => mockOutlook
);
jest.mock("../../../utils/AiProviders/embeddedLemonade/endpoints", () => ({
  embeddedLemonadeEndpoints: () => {},
}));

const { captureRoutes } = require("../../helpers/routeHarness");
const {
  embedManagementEndpoints,
} = require("../../../endpoints/embedManagement");
const { embeddedEndpoints } = require("../../../endpoints/embed");
const {
  browserExtensionEndpoints,
} = require("../../../endpoints/browserExtension");
const { telegramEndpoints } = require("../../../endpoints/telegram");
const { communityHubEndpoints } = require("../../../endpoints/communityHub");
const { extensionEndpoints } = require("../../../endpoints/extensions");
const { utilEndpoints } = require("../../../endpoints/utils");
const {
  outlookAgentEndpoints,
} = require("../../../endpoints/utils/outlookAgentUtils");
const { hashValue } = require("../../../utils/audit/sanitize");
const { audit } = require("../../../utils/audit");

const prisma = mockDb.prisma;
const PHI = "Patient Jane Roe has diabetes";
const SESSION = "5b3f1f0e-7c0e-4e0b-9a0e-3b1d2c4f5a6b";

jest.mock("../../../utils/chats/embed", () => ({
  streamChatWithForEmbed: jest.fn(async () => {}),
}));

const rows = (where = {}) =>
  prisma.audit_events.findMany({ where, orderBy: { id: "asc" } });
const meta = (row) => JSON.parse(row.metadata || "{}");

let embed;
beforeEach(async () => {
  jest.clearAllMocks();
  audit._resetForTests();
  await prisma.audit_events.deleteMany({});
  await prisma.embed_chats.deleteMany({});
  await prisma.embed_configs.deleteMany({});
  await prisma.browser_extension_api_keys.deleteMany({});
  await prisma.workspaces.deleteMany({});
  await prisma.users.deleteMany({});
  await prisma.users.create({
    data: { id: 1, username: "admin", password: "x", role: "admin" },
  });
  const workspace = await prisma.workspaces.create({
    data: { name: "Clinic", slug: "clinic" },
  });
  embed = await prisma.embed_configs.create({
    data: {
      uuid: "embed-uuid-1",
      enabled: true,
      chat_mode: "query",
      allowlist_domains: JSON.stringify(["https://good.example.com"]),
      workspace_id: workspace.id,
    },
  });
});
afterAll(() => mockDb.cleanup());

describe("embed management", () => {
  const routes = captureRoutes(embedManagementEndpoints);

  it("records embed.created with the admin as actor", async () => {
    const workspace = await prisma.workspaces.findFirst();
    const res = await routes.call("POST", "/embeds/new", {
      body: { workspace_id: workspace.id, chat_mode: "query" },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await rows({ action: "embed.created" });
    expect(row).toMatchObject({
      actor_type: "user",
      actor_id: "1",
      target_type: "embed",
      target_id: String(res.body.embed.id),
      outcome: "success",
    });
    expect(meta(row).embedUuid).toBe(res.body.embed.uuid);
  });

  it("records embed.updated as the admin, not as an embed visitor", async () => {
    const res = await routes.call("POST", "/embed/update/:embedId", {
      params: { embedId: String(embed.id) },
      body: { enabled: false, allowlist_domains: "https://other.example.com" },
    });
    expect(res.body.success).toBe(true);
    const [row] = await rows({ action: "embed.updated" });
    expect(row).toMatchObject({
      actor_type: "user",
      actor_id: "1",
      target_id: String(embed.id),
      outcome: "success",
    });
    expect(meta(row).changedFields).toEqual(
      expect.arrayContaining(["enabled", "allowlist_domains"])
    );
    expect(row.metadata).not.toContain("other.example.com");
  });

  it("records embed.deleted", async () => {
    await routes.call("DELETE", "/embed/:embedId", {
      params: { embedId: String(embed.id) },
    });
    const [row] = await rows({ action: "embed.deleted" });
    expect(row).toMatchObject({
      actor_type: "user",
      target_id: String(embed.id),
    });
    expect(meta(row).embedUuid).toBe("embed-uuid-1");
  });

  it("records chat.viewed_other_user before returning embed chats, with no chat text", async () => {
    await prisma.embed_chats.create({
      data: {
        prompt: PHI,
        response: JSON.stringify({ text: PHI }),
        session_id: SESSION,
        embed_id: embed.id,
      },
    });
    const res = await routes.call("POST", "/embed/chats", {
      body: { offset: 0, limit: 20 },
    });
    expect(res.body.chats).toHaveLength(1);
    const [row] = await rows({ action: "chat.viewed_other_user" });
    expect(row).toMatchObject({ actor_type: "user", actor_id: "1" });
    expect(meta(row).count).toBe(1);
    expect(JSON.stringify(row)).not.toContain("Jane Roe");
  });

  it("blocks the embed chat view when the audit row cannot be written", async () => {
    const spy = jest
      .spyOn(prisma.audit_events, "create")
      .mockRejectedValue(new Error("db down"));
    const outbox = require("../../../utils/audit/outbox");
    const outboxSpy = jest.spyOn(outbox, "append").mockImplementation(() => {
      throw new Error("disk full");
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await routes.call("POST", "/embed/chats", { body: {} });
    expect(res.statusCode).toBe(500);
    expect(res.body.chats).toBeUndefined();
    spy.mockRestore();
    outboxSpy.mockRestore();
    console.error.mockRestore();
  });

  it("records embed.chats_deleted for an admin deleting one chat", async () => {
    const chat = await prisma.embed_chats.create({
      data: {
        prompt: PHI,
        response: "{}",
        session_id: SESSION,
        embed_id: embed.id,
      },
    });
    await routes.call("DELETE", "/embed/chats/:chatId", {
      params: { chatId: String(chat.id) },
    });
    expect(await prisma.embed_chats.count()).toBe(0);
    const [row] = await rows({ action: "embed.chats_deleted" });
    expect(row).toMatchObject({
      actor_type: "user",
      target_type: "embed_chat",
      target_id: String(chat.id),
    });
    expect(meta(row)).toMatchObject({ embedUuid: "embed-uuid-1", count: 1 });
  });
});

describe("embed widget", () => {
  const routes = captureRoutes(embeddedEndpoints);
  // The shared harness response has no streaming methods, so run the chain
  // against a response that does.
  const stream = async (headers, message = PHI) => {
    const lower = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    const request = {
      params: { embedId: "embed-uuid-1" },
      headers: lower,
      body: { sessionId: SESSION, message },
      ip: "127.0.0.1",
    };
    const res = {
      statusCode: 200,
      locals: {},
      writableEnded: false,
      destroyed: false,
      status: (code) => {
        res.statusCode = code;
        return res;
      },
      json: () => res,
      setHeader: () => res,
      flushHeaders: () => {},
      write: () => true,
      end: () => {
        res.writableEnded = true;
        return res;
      },
    };
    for (const handler of routes.routes.get(
      "POST /embed/:embedId/stream-chat"
    )) {
      let nextCalled = false;
      await handler(request, res, () => {
        nextCalled = true;
      });
      if (!nextCalled) break;
    }
    return res;
  };

  it("records embed.chat with a session hash, origin and message length but not the message", async () => {
    const res = await stream({ origin: "https://good.example.com" });
    expect(res.statusCode).not.toBe(401);
    const [row] = await rows({ action: "embed.chat" });
    expect(row).toMatchObject({
      actor_type: "embed_session",
      actor_id: "embed-uuid-1",
      target_type: "embed",
      target_id: String(embed.id),
    });
    expect(meta(row)).toEqual({
      embedUuid: "embed-uuid-1",
      sessionHash: hashValue(SESSION),
      origin: "https://good.example.com",
      messageLength: PHI.length,
    });
    expect(JSON.stringify(row)).not.toContain("Jane Roe");
    expect(JSON.stringify(row)).not.toContain(SESSION);
  });

  it("records embed.rejected for an origin outside the allowlist", async () => {
    const res = await stream({ origin: "https://evil.example.com" });
    expect(res.statusCode).toBe(401);
    expect(await rows({ action: "embed.chat" })).toHaveLength(0);
    const [row] = await rows({ action: "embed.rejected" });
    expect(row).toMatchObject({
      outcome: "denied",
      reason: "origin_not_allowed",
    });
    expect(meta(row)).toMatchObject({
      embedUuid: "embed-uuid-1",
      origin: "https://evil.example.com",
      check: "origin_not_allowed",
    });
  });

  it("records embed.rejected when the embed is disabled", async () => {
    await prisma.embed_configs.update({
      where: { id: embed.id },
      data: { enabled: false },
    });
    const res = await stream({ origin: "https://good.example.com" });
    expect(res.statusCode).toBe(503);
    const [row] = await rows({ action: "embed.rejected" });
    expect(row.reason).toBe("disabled");
  });

  it("records embed.chats_deleted when a visitor clears their session", async () => {
    const res = await routes.call("DELETE", "/embed/:embedId/:sessionId", {
      params: { embedId: "embed-uuid-1", sessionId: SESSION },
      headers: { origin: "https://good.example.com" },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await rows({ action: "embed.chats_deleted" });
    expect(row).toMatchObject({
      actor_type: "embed_session",
      target_id: String(embed.id),
    });
    expect(JSON.stringify(row)).not.toContain(SESSION);
  });
});

describe("browser extension", () => {
  const routes = captureRoutes(browserExtensionEndpoints);

  it("records extension_key.created without the key", async () => {
    const res = await routes.call("POST", "/browser-extension/api-keys/new");
    expect(res.body.apiKey).toMatch(/^brx-/);
    const [row] = await rows({ action: "extension_key.created" });
    expect(row).toMatchObject({
      actor_type: "user",
      target_type: "extension_key",
    });
    expect(JSON.stringify(row)).not.toContain(res.body.apiKey);
  });

  it("records extension_key.deleted for a revoked key", async () => {
    const key = await prisma.browser_extension_api_keys.create({
      data: { key: "brx-secret-abc" },
    });
    await routes.call("DELETE", "/browser-extension/api-keys/:id", {
      params: { id: String(key.id) },
    });
    const [row] = await rows({ action: "extension_key.deleted" });
    expect(row.target_id).toBe(String(key.id));
    expect(JSON.stringify(row)).not.toContain("brx-secret-abc");
  });

  it("records document.uploaded and document.embedded for embed-content, not the text", async () => {
    const workspace = await prisma.workspaces.findFirst();
    mockCollector.processRawText.mockResolvedValue({
      success: true,
      documents: [{ location: "custom-documents/page-1.json" }],
    });
    const res = await routes.call("POST", "/browser-extension/embed-content", {
      body: { workspaceId: workspace.id, textContent: PHI, metadata: {} },
    });
    expect(res.body.success).toBe(true);
    const uploaded = (await rows({ action: "document.uploaded" }))[0];
    expect(meta(uploaded)).toMatchObject({ via: "browser_extension" });
    expect(uploaded.workspace_id).toBe(workspace.id);
    expect(await rows({ action: "document.embedded" })).toHaveLength(1);
    expect(JSON.stringify(await rows())).not.toContain("Jane Roe");
  });

  it("records document.uploaded for upload-content", async () => {
    mockCollector.processRawText.mockResolvedValue({
      success: true,
      documents: [{ location: "custom-documents/page-2.json" }],
    });
    await routes.call("POST", "/browser-extension/upload-content", {
      body: { textContent: PHI, metadata: {} },
    });
    expect(await rows({ action: "document.uploaded" })).toHaveLength(1);
  });

  it("records extension_key.deleted when the extension disconnects itself", async () => {
    const key = await prisma.browser_extension_api_keys.create({
      data: { key: "brx-other" },
    });
    // The mocked middleware names key 7; make that row exist.
    await prisma.browser_extension_api_keys.create({
      data: { id: 7, key: "brx-seven" },
    });
    await routes.call("DELETE", "/browser-extension/disconnect");
    const [row] = await rows({ action: "extension_key.deleted" });
    expect(row.target_id).toBe("7");
    expect(key.id).not.toBe(7);
  });
});

describe("telegram", () => {
  const routes = captureRoutes(telegramEndpoints);

  it("records telegram.bot_connected with the bot name, not the token", async () => {
    await routes.call("POST", "/telegram/connect", {
      body: {
        bot_token: "123456:SECRET-BOT-TOKEN",
        default_workspace: "clinic",
      },
    });
    const [row] = await rows({ action: "telegram.bot_connected" });
    expect(row).toMatchObject({ actor_type: "user", outcome: "success" });
    expect(meta(row)).toEqual({ botUsername: "my_bot" });
    expect(JSON.stringify(row)).not.toContain("SECRET-BOT-TOKEN");
  });

  it.each([
    ["approve-user", "telegram.user_approved"],
    ["deny-user", "telegram.user_denied"],
    ["revoke-user", "telegram.user_revoked"],
  ])("records %s as %s", async (path, action) => {
    await routes.call("POST", `/telegram/${path}`, { body: { chatId: "555" } });
    const [row] = await rows({ action });
    expect(row).toMatchObject({
      target_type: "telegram_chat",
      target_id: "555",
    });
  });

  it("records telegram.bot_disconnected", async () => {
    await routes.call("POST", "/telegram/disconnect");
    expect(await rows({ action: "telegram.bot_disconnected" })).toHaveLength(1);
  });

  it("records settings.changed for update-config", async () => {
    const {
      ExternalCommunicationConnector,
    } = require("../../../models/externalCommunicationConnector");
    jest
      .spyOn(ExternalCommunicationConnector, "updateConfig")
      .mockResolvedValue({ error: null });
    await routes.call("POST", "/telegram/update-config", {
      body: { voice_response_mode: "mirror" },
    });
    const [row] = await rows({ action: "settings.changed" });
    expect(meta(row)).toMatchObject({
      key: "telegram.voice_response_mode",
      to: "mirror",
    });
  });
});

describe("community hub", () => {
  const routes = captureRoutes(communityHubEndpoints);

  it("records skill.installed for apply and import", async () => {
    await routes.call("POST", "/community-hub/apply", { body: {} });
    await routes.call("POST", "/community-hub/import", { body: {} });
    const installed = await rows({ action: "skill.installed" });
    expect(installed).toHaveLength(2);
    expect(meta(installed[0])).toEqual({
      kind: "slash-command",
      hubId: "hub-1",
    });
  });

  it("records community_hub.published", async () => {
    const { SystemSettings } = require("../../../models/systemSettings");
    jest
      .spyOn(SystemSettings, "hubSettings")
      .mockResolvedValue({ connectionKey: "hub-key-123" });
    await routes.call("POST", "/community-hub/:communityHubItemType/create", {
      params: { communityHubItemType: "agent-flow" },
      body: { name: PHI },
    });
    const [row] = await rows({ action: "community_hub.published" });
    expect(meta(row).itemType).toBe("agent-flow");
    expect(JSON.stringify(row)).not.toContain("Jane Roe");
  });

  it("records community_hub.connected without the connection key", async () => {
    const { SystemSettings } = require("../../../models/systemSettings");
    jest.spyOn(SystemSettings, "updateSettings").mockResolvedValue({});
    await routes.call("POST", "/community-hub/settings", {
      body: { hub_api_key: "hub-secret-key" },
    });
    expect(await rows({ action: "community_hub.connected" })).toHaveLength(1);
    expect(JSON.stringify(await rows())).not.toContain("hub-secret-key");
  });
});

describe("data connectors", () => {
  const routes = captureRoutes(extensionEndpoints);

  it("records document.uploaded via the connector and connector.token_saved without the token", async () => {
    mockCollector.forwardExtensionRequest.mockResolvedValue({
      success: true,
      data: {},
    });
    await routes.call("POST", "/ext/:repo_platform/repo", {
      params: { repo_platform: "github" },
      body: {
        repo: "https://github.com/a/b",
        accessToken: "ghp_SECRETTOKEN12345",
      },
    });
    const [uploaded] = await rows({ action: "document.uploaded" });
    expect(meta(uploaded)).toEqual({ via: "github_repo" });
    const [token] = await rows({ action: "connector.token_saved" });
    expect(meta(token)).toEqual({ connector: "github_repo" });
    expect(JSON.stringify(await rows())).not.toContain("SECRETTOKEN");
  });

  it("records a failed outcome when the collector fails, and no token row when none was sent", async () => {
    mockCollector.forwardExtensionRequest.mockResolvedValue({
      success: false,
      reason: "boom",
    });
    await routes.call("POST", "/ext/website-depth", {
      body: { url: "https://example.com" },
    });
    const [row] = await rows({ action: "document.uploaded" });
    expect(row).toMatchObject({
      outcome: "failed",
      reason: "collector_failed",
    });
    expect(await rows({ action: "connector.token_saved" })).toHaveLength(0);
  });
});

describe("chat export", () => {
  const routes = captureRoutes(utilEndpoints);

  it("records chat.exported before sending the file, with counts only", async () => {
    const workspace = await prisma.workspaces.findFirst();
    await prisma.workspace_chats.create({
      data: {
        workspaceId: workspace.id,
        user_id: 1,
        prompt: PHI,
        response: JSON.stringify({ text: PHI }),
        include: true,
      },
    });
    const res = await routes.call("POST", "/export-chat/:type", {
      params: { type: "json" },
      body: { workspaceSlug: "clinic" },
    });
    expect(res.body).toEqual({ file: true });
    const [row] = await rows({ action: "chat.exported" });
    expect(row).toMatchObject({
      actor_type: "user",
      target_type: "workspace",
      target_id: String(workspace.id),
      workspace_id: workspace.id,
    });
    expect(meta(row)).toMatchObject({ format: "json", count: 1 });
    expect(JSON.stringify(row)).not.toContain("Jane Roe");
  });
});

describe("outlook", () => {
  const routes = captureRoutes(outlookAgentEndpoints);

  it("records oauth.connected on a successful callback and oauth.disconnected on revoke", async () => {
    const res = await routes.call(
      "GET",
      "/agent-skills/outlook/auth-callback",
      {
        query: { code: "AUTH-CODE-123" },
        headers: { host: "localhost:3001" },
      }
    );
    expect(res.redirectedTo).toContain("outlook_auth=success");
    const [connected] = await rows({ action: "oauth.connected" });
    expect(connected).toMatchObject({
      outcome: "success",
      target_id: "outlook",
    });
    expect(meta(connected)).toEqual({ provider: "outlook" });

    const { SystemSettings } = require("../../../models/systemSettings");
    jest.spyOn(SystemSettings, "delete").mockResolvedValue(true);
    await routes.call("POST", "/admin/agent-skills/outlook/revoke");
    expect(await rows({ action: "oauth.disconnected" })).toHaveLength(1);
    expect(JSON.stringify(await rows())).not.toContain("AUTH-CODE-123");
  });

  it("records a failed oauth.connected when the token exchange fails", async () => {
    mockOutlook.exchangeCodeForToken.mockResolvedValueOnce({
      success: false,
      error: "bad code",
    });
    await routes.call("GET", "/agent-skills/outlook/auth-callback", {
      query: { code: "x" },
      headers: { host: "localhost:3001" },
    });
    const [row] = await rows({ action: "oauth.connected" });
    expect(row).toMatchObject({
      outcome: "failed",
      reason: "token_exchange_failed",
    });
  });

  it("records oauth.connected when authorization starts, without the client secret", async () => {
    const res = await routes.call(
      "POST",
      "/admin/agent-skills/outlook/auth-url",
      {
        body: { clientId: "cid", clientSecret: "CLIENT-SECRET-XYZ" },
        headers: { host: "localhost:3001" },
      }
    );
    expect(res.body.success).toBe(true);
    const [row] = await rows({ action: "oauth.connected" });
    expect(row.reason).toBe("authorization_started");
    expect(JSON.stringify(row)).not.toContain("CLIENT-SECRET-XYZ");
  });
});
