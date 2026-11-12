/* eslint-env jest */
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = require("fs").mkdtempSync(
  require("path").join(require("os").tmpdir(), "allm-storage-")
);

const mockState = { multiUser: true, device: null, users: new Map() };
jest.mock("../../../models/systemSettings", () => ({
  SystemSettings: { isMultiUserMode: jest.fn(async () => mockState.multiUser) },
}));
jest.mock("../../../models/mobileDevice", () => ({
  MobileDevice: {
    get: jest.fn(async () => (mockState.device ? { ...mockState.device } : null)),
    connectionURL: jest.fn((user) => `allm://pair?u=${user?.id ?? "none"}`),
  },
}));
jest.mock("../../../models/user", () => ({
  User: { get: jest.fn(async ({ id }) => mockState.users.get(Number(id)) ?? null) },
}));

const { validDeviceToken } = require("../../../endpoints/mobile/middleware");

async function run() {
  const request = { header: () => "device-token" };
  const response = {
    locals: {},
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const next = jest.fn();
  await validDeviceToken(request, response, next);
  return { response, next };
}

describe("validDeviceToken runs a device as its own user", () => {
  beforeEach(() => {
    mockState.multiUser = true;
  });

  it("refuses an approved device with no user in multi-user mode (SMF-09 M5)", async () => {
    mockState.device = { id: 1, approved: true, user: null };
    const { response, next } = await run();
    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
  });

  it("sets the device's own user as the request user", async () => {
    mockState.device = {
      id: 1,
      approved: true,
      user: { id: 42, role: "default", suspended: 0 },
    };
    const { response, next } = await run();
    expect(next).toHaveBeenCalled();
    expect(response.locals.user.id).toBe(42);
  });

  it("keeps a userless device working in single-user mode", async () => {
    mockState.multiUser = false;
    mockState.device = { id: 1, approved: true, user: null };
    const { next } = await run();
    expect(next).toHaveBeenCalled();
  });
});

describe("pairing records the user being paired (F-05)", () => {
  const { captureRoutes } = require("../../helpers/routeHarness");
  jest.mock("../../../utils/middleware/validatedRequest", () => ({
    validatedRequest: (_req, res, next) => {
      res.locals.user = { id: 1, role: "admin" };
      res.locals.multiUserMode = true;
      next();
    },
  }));
  const { mobileEndpoints } = require("../../../endpoints/mobile");

  it("issues the link for the chosen user, not the admin", async () => {
    mockState.users.set(42, { id: 42, username: "pat", suspended: 0 });
    const routes = captureRoutes(mobileEndpoints);
    const res = await routes.call("GET", "/mobile/connect-info", { query: { userId: "42" } });
    expect(res.body).toMatchObject({
      connectionUrl: "allm://pair?u=42",
      pairedFor: { id: 42, username: "pat" },
    });
  });

  it("refuses a suspended target user", async () => {
    mockState.users.set(43, { id: 43, username: "sus", suspended: 1 });
    const routes = captureRoutes(mobileEndpoints);
    const res = await routes.call("GET", "/mobile/connect-info", { query: { userId: "43" } });
    expect(res.statusCode).toBe(400);
  });
});
