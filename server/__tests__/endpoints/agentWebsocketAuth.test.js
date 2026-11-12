/* eslint-env jest */
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";

const { EventEmitter } = require("events");

const mockSettings = { multiUser: true };
jest.mock("../../models/systemSettings", () => ({
  SystemSettings: {
    isMultiUserMode: jest.fn(async () => mockSettings.multiUser),
  },
}));
const mockUsers = new Map();
jest.mock("../../models/user", () => ({
  User: { get: jest.fn(async ({ id }) => mockUsers.get(Number(id)) ?? null) },
}));
jest.mock("../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn().mockResolvedValue() },
}));
jest.mock("../../models/workspaceAgentInvocation", () => ({
  WorkspaceAgentInvocation: { close: jest.fn() },
}));
const mockConstructed = [];
jest.mock("../../utils/agents", () => ({
  AgentHandler: class {
    constructor(opts) {
      mockConstructed.push(opts);
      this.invocation = null; // stop the route right after init
    }
    async init() {
      return this;
    }
  },
}));

const { makeJWT } = require("../../utils/http");
const { agentWebsocket } = require("../../endpoints/agentWebsocket");
const {
  tokenFromWebsocketRequest,
  authenticateSessionToken,
} = require("../../utils/middleware/validatedRequest");

async function connect(protocolHeader) {
  let route;
  agentWebsocket({ ws: (_path, handler) => (route = handler) });
  const socket = new EventEmitter();
  socket.send = jest.fn();
  socket.close = jest.fn();
  await route(socket, {
    params: { uuid: "inv-1" },
    headers: protocolHeader ? { "sec-websocket-protocol": protocolHeader } : {},
  });
  return socket;
}

beforeEach(() => {
  mockConstructed.length = 0;
  mockUsers.clear();
  mockSettings.multiUser = true;
  mockUsers.set(7, { id: 7, username: "pat", role: "default", suspended: 0 });
  mockUsers.set(8, { id: 8, username: "sus", role: "default", suspended: 1 });
});

describe("tokenFromWebsocketRequest", () => {
  it.each([
    ["anythingllm.auth, abc.def", "abc.def"],
    ["anythingllm.auth,abc", "abc"],
    ["other, anythingllm.auth, tok", "tok"],
    ["anythingllm.auth", null],
    ["something-else", null],
    [undefined, null],
  ])("%p -> %p", (header, expected) => {
    expect(
      tokenFromWebsocketRequest({
        headers: header ? { "sec-websocket-protocol": header } : {},
      })
    ).toBe(expected);
  });
});

describe("agent websocket route", () => {
  it("refuses a connection with no session token in multi-user mode, before building a handler", async () => {
    const socket = await connect(null);
    expect(mockConstructed).toHaveLength(0);
    expect(socket.close).toHaveBeenCalled();
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: "wssFailure" });
  });

  it("refuses a suspended user's token", async () => {
    await connect(`anythingllm.auth, ${makeJWT({ id: 8 })}`);
    expect(mockConstructed).toHaveLength(0);
  });

  it("refuses a forged token", async () => {
    await connect("anythingllm.auth, not-a-jwt");
    expect(mockConstructed).toHaveLength(0);
  });

  it("passes the authenticated caller to the handler", async () => {
    await connect(`anythingllm.auth, ${makeJWT({ id: 7 })}`);
    expect(mockConstructed).toEqual([
      { uuid: "inv-1", caller: { multiUserMode: true, userId: 7 } },
    ]);
  });

  it("in single-user mode without a password, connects as before", async () => {
    mockSettings.multiUser = false;
    const saved = process.env.AUTH_TOKEN;
    delete process.env.AUTH_TOKEN;
    await connect(null);
    process.env.AUTH_TOKEN = saved;
    expect(mockConstructed).toEqual([
      { uuid: "inv-1", caller: { multiUserMode: false, userId: null } },
    ]);
  });

  it("in single-user mode with a password, needs the single-user token", async () => {
    mockSettings.multiUser = false;
    process.env.AUTH_TOKEN = "pw";
    const result = await authenticateSessionToken(null);
    delete process.env.AUTH_TOKEN;
    expect(result.ok).toBe(false);
  });
});
