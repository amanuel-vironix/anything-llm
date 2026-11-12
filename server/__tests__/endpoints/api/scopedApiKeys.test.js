/* eslint-env jest */
process.env.NODE_ENV = "test";
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.STORAGE_DIR =
  process.env.STORAGE_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "allm-apikey-"));

const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const mockMultiUser = { value: true };
jest.mock("../../../models/systemSettings", () => {
  const actual = jest.requireActual("../../../models/systemSettings");
  return {
    ...actual,
    SystemSettings: {
      ...actual.SystemSettings,
      isMultiUserMode: jest.fn(async () => mockMultiUser.value),
    },
  };
});
jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn() },
}));
jest.mock("../../../utils/chats/apiChatHandler", () => ({
  ApiChatHandler: {
    chatSync: jest.fn(async () => ({ type: "textResponse", close: true })),
    streamChat: jest.fn(async () => {}),
  },
}));

const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const { ApiKey } = require("../../../models/apiKeys");
const { ApiChatHandler } = require("../../../utils/chats/apiChatHandler");
const {
  API_ROUTE_ROLES,
} = require("../../../utils/middleware/validApiKey");
const { captureRoutes } = require("../../helpers/routeHarness");

const prisma = mockDb.prisma;
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(bodyParser.json());
  const router = express.Router();
  // developerEndpoints also mounts swagger on `app`; register the groups directly.
  require("../../../endpoints/api/auth").apiAuthEndpoints(router);
  require("../../../endpoints/api/admin").apiAdminEndpoints(router);
  require("../../../endpoints/api/workspace").apiWorkspaceEndpoints(router);
  require("../../../endpoints/api/workspaceThread").apiWorkspaceThreadEndpoints(
    router
  );
  require("../../../endpoints/api/openai").apiOpenAICompatibleEndpoints(router);
  app.use("/api", router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mockDb.cleanup();
});

beforeEach(() => {
  mockMultiUser.value = true;
  ApiChatHandler.chatSync.mockClear();
});

let seq = 0;
const makeUser = (data = {}) =>
  prisma.users.create({
    data: { username: `apiuser${++seq}`, password: "x", role: "default", ...data },
  });
const makeWorkspace = () =>
  prisma.workspaces.create({
    data: { name: `ws${++seq}`, slug: `ws-${++seq}` },
  });
const addMember = (user, workspace) =>
  prisma.workspace_users.create({
    data: { user_id: user.id, workspace_id: workspace.id },
  });
const makeKey = (data = {}) =>
  prisma.api_keys.create({
    data: { secret: `secret-${++seq}`, ...data },
  });

async function call(method, route, key, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key.secret}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json };
}

describe("validApiKey", () => {
  it("refuses an expired key", async () => {
    const owner = await makeUser({ role: "admin" });
    const key = await makeKey({
      user_id: owner.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await call("GET", "/v1/auth", key);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/expired/);
  });

  it("refuses a key whose owner is suspended", async () => {
    const owner = await makeUser({ role: "admin", suspended: 1 });
    const key = await makeKey({ user_id: owner.id });
    const res = await call("GET", "/v1/auth", key);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/);
  });

  it("refuses a legacy key in multi-user mode and logs it", async () => {
    const key = await makeKey();
    const res = await call("GET", "/v1/auth", key);
    expect(res.status).toBe(403);
    const logged = await prisma.event_logs.findFirst({
      where: { event: "legacy_api_key_refused" },
      orderBy: { id: "desc" },
    });
    expect(JSON.parse(logged.metadata).apiKeyId).toBe(key.id);
  });

  it("accepts a legacy key in single-user mode", async () => {
    mockMultiUser.value = false;
    const key = await makeKey();
    expect((await call("GET", "/v1/auth", key)).status).toBe(200);
  });

  it("refuses a default-role owner on an admin route and allows an admin owner", async () => {
    const member = await makeUser();
    const admin = await makeUser({ role: "admin" });
    const memberKey = await makeKey({ user_id: member.id });
    const adminKey = await makeKey({ user_id: admin.id });
    const denied = await call("GET", "/v1/admin/users", memberKey);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/not allowed/);
    expect((await call("GET", "/v1/admin/users", adminKey)).status).toBe(200);
  });

  it("refuses a manager owner on an admin-only route but allows workspace creation", async () => {
    const manager = await makeUser({ role: "manager" });
    const key = await makeKey({ user_id: manager.id });
    expect((await call("GET", "/v1/admin/users", key)).status).toBe(403);
    const created = await call("POST", "/v1/workspace/new", key, {
      name: "Manager made",
    });
    expect(created.status).toBe(200);
  });
});

describe("route role table", () => {
  it("names only routes that exist", () => {
    const registered = new Set();
    const capture = (register) =>
      captureRoutes(register).routes.forEach((_, k) => registered.add(k));
    developerEndpointsGroups().forEach(capture);
    const unknown = Object.keys(API_ROUTE_ROLES).filter(
      (k) => !registered.has(k)
    );
    expect(unknown).toEqual([]);
  });
});

function developerEndpointsGroups() {
  const dir = "../../../endpoints/api";
  return [
    require(`${dir}/auth`).apiAuthEndpoints,
    require(`${dir}/admin`).apiAdminEndpoints,
    require(`${dir}/system`).apiSystemEndpoints,
    require(`${dir}/workspace`).apiWorkspaceEndpoints,
    require(`${dir}/document`).apiDocumentEndpoints,
    require(`${dir}/workspaceThread`).apiWorkspaceThreadEndpoints,
    require(`${dir}/userManagement`).apiUserManagementEndpoints,
    require(`${dir}/openai`).apiOpenAICompatibleEndpoints,
    require(`${dir}/embed`).apiEmbedEndpoints,
    require(`${dir}/mcpServers`).apiMCPServerEndpoints,
  ];
}

describe("workspace scope", () => {
  it("lists only the owner's workspaces for a default-role owner", async () => {
    const owner = await makeUser();
    const [mine, theirs] = [await makeWorkspace(), await makeWorkspace()];
    await addMember(owner, mine);
    const key = await makeKey({ user_id: owner.id });
    const res = await call("GET", "/v1/workspaces", key);
    expect(res.status).toBe(200);
    const slugs = res.body.workspaces.map((w) => w.slug);
    expect(slugs).toContain(mine.slug);
    expect(slugs).not.toContain(theirs.slug);
  });

  it("narrows an admin owner's key to its workspace_ids", async () => {
    const admin = await makeUser({ role: "admin" });
    const [a, b] = [await makeWorkspace(), await makeWorkspace()];
    const key = await makeKey({
      user_id: admin.id,
      workspace_ids: JSON.stringify([a.id]),
    });
    const res = await call("GET", "/v1/workspaces", key);
    const slugs = res.body.workspaces.map((w) => w.slug);
    expect(slugs).toEqual([a.slug]);
    expect(slugs).not.toContain(b.slug);
    const models = await call("GET", "/v1/openai/models", key);
    expect(models.body.data.map((m) => m.id)).toEqual([a.slug]);
  });

  it("refuses chat in a workspace the owner is not a member of", async () => {
    const owner = await makeUser();
    const other = await makeWorkspace();
    const key = await makeKey({ user_id: owner.id });
    const res = await call("POST", `/v1/workspace/${other.slug}/chat`, key, {
      message: "hi",
      mode: "chat",
    });
    expect(res.status).toBe(400);
    expect(ApiChatHandler.chatSync).not.toHaveBeenCalled();
  });

  it("refuses a workspace outside the key's workspace_ids even for its member", async () => {
    const owner = await makeUser();
    const [a, b] = [await makeWorkspace(), await makeWorkspace()];
    await addMember(owner, a);
    await addMember(owner, b);
    const key = await makeKey({
      user_id: owner.id,
      workspace_ids: JSON.stringify([a.id]),
    });
    const res = await call("GET", `/v1/workspace/${b.slug}`, key);
    expect(res.body.workspace).toEqual([]);
    const chat = await call("POST", `/v1/workspace/${b.slug}/chat`, key, {
      message: "hi",
      mode: "chat",
    });
    expect(chat.status).toBe(400);
    expect(ApiChatHandler.chatSync).not.toHaveBeenCalled();
  });
});

describe("chats run as the key's owner", () => {
  it("passes the owner to the chat handler", async () => {
    const owner = await makeUser();
    const ws = await makeWorkspace();
    await addMember(owner, ws);
    const key = await makeKey({ user_id: owner.id });
    const res = await call("POST", `/v1/workspace/${ws.slug}/chat`, key, {
      message: "hi",
      mode: "chat",
    });
    expect(res.status).toBe(200);
    expect(ApiChatHandler.chatSync.mock.calls[0][0].user.id).toBe(owner.id);
  });

  it("ignores a body userId when creating a thread or chatting in one", async () => {
    const owner = await makeUser();
    const victim = await makeUser();
    const ws = await makeWorkspace();
    await addMember(owner, ws);
    const key = await makeKey({ user_id: owner.id });
    const created = await call(
      "POST",
      `/v1/workspace/${ws.slug}/thread/new`,
      key,
      { userId: victim.id, name: "t" }
    );
    expect(created.body.thread.user_id).toBe(owner.id);

    await call(
      "POST",
      `/v1/workspace/${ws.slug}/thread/${created.body.thread.slug}/chat`,
      key,
      { message: "hi", mode: "chat", userId: victim.id }
    );
    expect(ApiChatHandler.chatSync.mock.calls[0][0].user.id).toBe(owner.id);
  });

  it("keeps a default-role owner out of another user's thread", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const ws = await makeWorkspace();
    await addMember(owner, ws);
    const thread = await prisma.workspace_threads.create({
      data: {
        name: "theirs",
        slug: `thread-${++seq}`,
        workspace_id: ws.id,
        user_id: other.id,
      },
    });
    const key = await makeKey({ user_id: owner.id });
    const res = await call(
      "GET",
      `/v1/workspace/${ws.slug}/thread/${thread.slug}/chats`,
      key
    );
    expect(res.status).toBe(404);
  });
});

describe("ApiChatHandler daily limit", () => {
  const { chatSync } = jest.requireActual(
    "../../../utils/chats/apiChatHandler"
  ).ApiChatHandler;

  it("aborts when the owner has used their daily messages", async () => {
    const owner = await makeUser({ dailyMessageLimit: 0 });
    const ws = await makeWorkspace();
    const result = await chatSync({
      workspace: ws,
      message: "hi",
      mode: "chat",
      user: owner,
    });
    expect(result.type).toBe("abort");
    expect(result.error).toMatch(/24 hour chat quota of 0/);
  });
});

describe("ApiKey scope validation", () => {
  it("rejects a missing owner, unknown workspaces and a past expiry", async () => {
    expect((await ApiKey.create(null, "k", { userId: 999999 })).error).toMatch(
      /owner does not exist/
    );
    expect(
      (await ApiKey.create(null, "k", { workspaceIds: [999999] })).error
    ).toMatch(/do not exist/);
    expect(
      (await ApiKey.create(null, "k", { expiresAt: "2001-01-01" })).error
    ).toMatch(/future/);
  });

  it("assigns an owner to a legacy key so it works in multi-user mode", async () => {
    const admin = await makeUser({ role: "admin" });
    const key = await makeKey();
    expect((await call("GET", "/v1/auth", key)).status).toBe(403);
    const { error } = await ApiKey.updateScope(key.id, { userId: admin.id });
    expect(error).toBeNull();
    expect((await call("GET", "/v1/auth", key)).status).toBe(200);
  });
});
