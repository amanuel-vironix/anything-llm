/* eslint-env jest */
/**
 * Google sign-in end to end, against a fake OpenID provider that signs real
 * ID tokens and a real SQLite database:
 *   /auth/oidc/start → (provider) → /auth/oidc/callback → /sso/simple token
 *   swap → session JWT.
 * Covers every refusal in the plan, provisioning, concurrency, the 12h
 * session and password sign-in with the admin fallback.
 */
process.env.JWT_SECRET = "oidc-test-jwt-secret";
process.env.SIG_KEY = "oidc-test-sig-key";
process.env.SIG_SALT = "oidc-test-sig-salt";
delete process.env.SIMPLE_SSO_ENABLED;
delete process.env.OIDC_SESSION_EXPIRY;

const { createTestPrisma } = require("../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../utils/prisma", () => mockDb.prisma);
jest.mock("../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn().mockResolvedValue() },
}));

const JWT = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { captureRoutes } = require("../helpers/routeHarness");
const { startFakeOidcProvider } = require("../helpers/fakeOidcProvider");
const { oidcEndpoints } = require("../../endpoints/auth/oidc");
const { systemEndpoints } = require("../../endpoints/system");
const { saveOidcSettings } = require("../../utils/auth/oidcSettings");
const { resetOidcClientCache, STATE_COOKIE } = require("../../utils/auth/oidc");

const prisma = mockDb.prisma;
const oidcRoutes = captureRoutes(oidcEndpoints);
const systemRoutes = captureRoutes(systemEndpoints);
const APP_URL = "https://llm.vironix.test";
const REDIRECT_URI = `${APP_URL}/api/auth/oidc/callback`;

let provider;

async function configure(overrides = {}) {
  const result = await saveOidcSettings({
    enabled: true,
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret: "test-client-secret",
    redirectUri: REDIRECT_URI,
    allowedDomains: "vironix.ai",
    provisioning: "auto",
    defaultRole: "default",
    passwordLoginDisabled: false,
    ...overrides,
  });
  expect(result).toEqual({ success: true, errors: {} });
}

/** Runs /auth/oidc/start and returns what the browser would carry. */
async function start(query = {}) {
  const res = await oidcRoutes.call("GET", "/auth/oidc/start", { query });
  return { res, cookie: res.cookies[STATE_COOKIE]?.value };
}

/**
 * Full browser round trip up to the callback response.
 * @param {Object} claims - ID token overrides for the provider
 * @param {{query?: Object, cookie?: string|null, state?: string, startQuery?: Object, headers?: Object}} tamper
 */
async function signIn(claims = {}, tamper = {}) {
  const { res: startRes, cookie } = await start(tamper.startQuery);
  const { code, state } = provider.authorize(startRes.redirectedTo, claims);
  const query = { code, state: tamper.state ?? state, ...tamper.query };
  const headers = {
    ...(tamper.headers || {}),
    cookie: tamper.cookie === null ? "" : `${STATE_COOKIE}=${tamper.cookie ?? cookie}`,
  };
  return oidcRoutes.call("GET", "/auth/oidc/callback", { query, headers });
}

function loginTokenFrom(res) {
  const url = new URL(res.redirectedTo);
  return url.pathname === "/sso/simple" ? url.searchParams.get("token") : null;
}

function refusalFrom(res) {
  return new URL(res.redirectedTo).searchParams.get("sso_error");
}

async function swap(token) {
  return systemRoutes.call("GET", "/request-token/sso/simple", {
    query: { token },
  });
}

async function lastEvent(event) {
  return prisma.event_logs.findFirst({
    where: { event },
    orderBy: { id: "desc" },
  });
}

beforeAll(async () => {
  provider = await startFakeOidcProvider();
});

beforeEach(async () => {
  resetOidcClientCache();
  for (const table of [
    "event_logs",
    "temporary_auth_tokens",
    "user_identities",
    "invites",
    "users",
    "system_settings",
  ])
    await prisma[table].deleteMany({});
  await prisma.system_settings.create({
    data: { label: "multi_user_mode", value: "true" },
  });
  await configure();
});

afterAll(async () => {
  await provider.close();
  await mockDb.cleanup();
});

describe("start", () => {
  it("redirects to the provider with state, nonce and an S256 PKCE challenge, and sets a short-lived HttpOnly cookie", async () => {
    const { res } = await start();

    const url = new URL(res.redirectedTo);
    expect(url.origin + url.pathname).toBe(`${provider.issuer}/o/oauth2/v2/auth`);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(res.cookies[STATE_COOKIE].options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 600_000,
    });
  });

  it("sends the browser back to the login page when Google sign-in is off", async () => {
    await configure({ enabled: false });

    const { res } = await start();

    expect(res.redirectedTo).toBe(`${APP_URL}/login?sso_error=disabled`);
  });
});

describe("callback: new and returning users", () => {
  it("creates a default user with a linked identity on first sign-in and lands on /sso/simple", async () => {
    const res = await signIn();

    const token = loginTokenFrom(res);
    expect(token).toMatch(/^allm-oidc-/);
    expect(res.redirectedTo.startsWith(`${APP_URL}/sso/simple?token=`)).toBe(true);
    const user = await prisma.users.findFirst({
      where: { username: "jane@vironix.ai" },
    });
    expect(user).toMatchObject({ role: "default", suspended: 0 });
    const identity = await prisma.user_identities.findFirst({
      where: { user_id: user.id },
    });
    expect(identity).toMatchObject({
      provider: provider.issuer,
      subject: "google-sub-1",
      email: "jane@vironix.ai",
    });
    expect(await lastEvent("login_event")).toBeTruthy();
  });

  it("gives the new account an unusable password", async () => {
    await signIn();

    const user = await prisma.users.findFirst();
    expect(bcrypt.compareSync("", user.password)).toBe(false);
    expect(bcrypt.compareSync("jane@vironix.ai", user.password)).toBe(false);
  });

  it("uses the configured default role for new accounts", async () => {
    await configure({ defaultRole: "manager" });

    await signIn();

    expect((await prisma.users.findFirst()).role).toBe("manager");
  });

  it("signs a returning user into the same account after their Google email changes", async () => {
    await signIn();

    const res = await signIn({ email: "jane.doe@vironix.ai" });

    expect(loginTokenFrom(res)).toBeTruthy();
    expect(await prisma.users.count()).toBe(1);
    expect((await prisma.user_identities.findFirst()).email).toBe(
      "jane.doe@vironix.ai"
    );
  });

  it("does not let a different Google account with a reused email take over the account", async () => {
    await signIn();
    const original = await prisma.users.findFirst();

    await signIn({ sub: "google-sub-2" });

    const identities = await prisma.user_identities.findMany();
    expect(identities).toHaveLength(2);
    const second = identities.find((i) => i.subject === "google-sub-2");
    expect(second.user_id).not.toBe(original.id);
  });

  it("does not link a Google account to an existing password user with the same username", async () => {
    const password = await prisma.users.create({
      data: { username: "jane@vironix.ai", password: "x", role: "admin" },
    });

    await signIn();

    const identity = await prisma.user_identities.findFirst();
    expect(identity.user_id).not.toBe(password.id);
    const linked = await prisma.users.findUnique({
      where: { id: identity.user_id },
    });
    expect(linked).toMatchObject({ username: "jane.2@vironix.ai", role: "default" });
  });

  it("creates one account when two callbacks for the same new Google account arrive at once", async () => {
    const first = await start();
    const second = await start();
    const a = provider.authorize(first.res.redirectedTo);
    const b = provider.authorize(second.res.redirectedTo);

    const results = await Promise.all([
      oidcRoutes.call("GET", "/auth/oidc/callback", {
        query: { code: a.code, state: a.state },
        headers: { cookie: `${STATE_COOKIE}=${first.cookie}` },
      }),
      oidcRoutes.call("GET", "/auth/oidc/callback", {
        query: { code: b.code, state: b.state },
        headers: { cookie: `${STATE_COOKIE}=${second.cookie}` },
      }),
    ]);

    expect(await prisma.users.count()).toBe(1);
    expect(await prisma.user_identities.count()).toBe(1);
    // A user has one live login token at a time (SMF-32), so the later of
    // two simultaneous sign-ins may replace the earlier's token; at least
    // one browser always gets in, and neither creates a second account.
    expect(results.some((r) => loginTokenFrom(r))).toBe(true);
  });

  it("refuses a suspended user and logs it", async () => {
    await signIn();
    await prisma.users.updateMany({ data: { suspended: 1 } });
    await prisma.temporary_auth_tokens.deleteMany({});

    const res = await signIn();

    expect(refusalFrom(res)).toBe("suspended");
    expect(await prisma.temporary_auth_tokens.count()).toBe(0);
    expect(JSON.parse((await lastEvent("failed_login_oidc")).metadata).reason).toBe(
      "suspended"
    );
  });

  it("takes the post-login address from settings, not from the Host header", async () => {
    const res = await signIn({}, { headers: { host: "evil.example" } });

    expect(new URL(res.redirectedTo).origin).toBe(APP_URL);
  });
});

describe("callback: refusals", () => {
  const now = () => Math.floor(Date.now() / 1000);

  // `detail` is the verification error, so each ID token case proves the
  // check it names failed, not some other one.
  it.each([
    ["a wrong audience", { aud: "someone-else" }, "token_invalid", /aud mismatch/],
    ["a wrong issuer", { iss: "https://accounts.example.com" }, "token_invalid", /unexpected iss/],
    ["an expired token", { iat: now() - 7200, exp: now() - 3600 }, "token_invalid", /JWT expired/],
    ["a wrong nonce", { nonce: "not-the-nonce" }, "token_invalid", /nonce mismatch/],
    ["a signature from a key not in the JWKS", { sign: "foreign" }, "token_invalid", /signature/],
    ["email_verified false", { email_verified: false }, "email_unverified", undefined],
    ['email_verified "true" as a string', { email_verified: "true" }, "email_unverified", undefined],
    ["an email outside vironix.ai", { email: "jane@gmail.com", hd: undefined }, "domain_not_allowed", undefined],
    ["a look-alike email domain", { email: "jane@evil-vironix.ai" }, "domain_not_allowed", undefined],
    ["a subdomain email", { email: "jane@mail.vironix.ai" }, "domain_not_allowed", undefined],
    ["a wrong hd", { hd: "other.com" }, "hd_not_allowed", undefined],
    ["no hd (a consumer account using a vironix.ai address)", { hd: undefined }, "hd_not_allowed", undefined],
  ])("refuses %s", async (_name, claims, reason, detail) => {
    const res = await signIn(claims);

    expect(refusalFrom(res)).toBe(reason);
    expect(await prisma.users.count()).toBe(0);
    expect(await prisma.temporary_auth_tokens.count()).toBe(0);
    const metadata = JSON.parse((await lastEvent("failed_login_oidc")).metadata);
    expect(metadata.reason).toBe(reason);
    if (detail) expect(metadata.detail).toMatch(detail);
  });

  it.each([
    ["a missing state cookie", { cookie: null }],
    ["a forged state cookie", { cookie: JWT.sign({ s: "x" }, "wrong-secret") }],
    ["a state that does not match the cookie", { state: "different-state" }],
  ])("refuses %s before talking to the provider", async (_name, tamper) => {
    const before = provider.requests.token;

    const res = await signIn({}, tamper);

    expect(refusalFrom(res)).toBe("state_invalid");
    expect(provider.requests.token).toBe(before);
  });

  it("refuses when the provider reports an error", async () => {
    const res = await signIn({}, { query: { error: "access_denied", code: undefined } });

    expect(refusalFrom(res)).toBe("provider_error");
  });

  it("refuses a replayed callback once the code has been used", async () => {
    const { res: startRes, cookie } = await start();
    const { code, state } = provider.authorize(startRes.redirectedTo);
    const call = () =>
      oidcRoutes.call("GET", "/auth/oidc/callback", {
        query: { code, state },
        headers: { cookie: `${STATE_COOKIE}=${cookie}` },
      });
    await call();

    const replay = await call();

    expect(refusalFrom(replay)).toBe("token_invalid");
  });

  it("refuses everyone while Google sign-in is off", async () => {
    const { res: startRes, cookie } = await start();
    const { code, state } = provider.authorize(startRes.redirectedTo);
    await configure({ enabled: false });

    const res = await oidcRoutes.call("GET", "/auth/oidc/callback", {
      query: { code, state },
      headers: { cookie: `${STATE_COOKIE}=${cookie}` },
    });

    expect(refusalFrom(res)).toBe("disabled");
  });
});

describe("invite-only provisioning", () => {
  beforeEach(async () => {
    await configure({ provisioning: "invite_only" });
  });

  it("refuses an unknown Google account without an invite", async () => {
    const res = await signIn();

    expect(refusalFrom(res)).toBe("not_invited");
    expect(await prisma.users.count()).toBe(0);
  });

  it("creates the account from an invite and uses the invite up", async () => {
    await prisma.invites.create({ data: { code: "INV-1", createdBy: 0 } });

    const res = await signIn({}, { startQuery: { invite: "INV-1" } });

    expect(loginTokenFrom(res)).toBeTruthy();
    const user = await prisma.users.findFirst();
    expect(await prisma.invites.findFirst()).toMatchObject({
      status: "claimed",
      claimedBy: user.id,
    });
    expect(await prisma.user_identities.count({ where: { user_id: user.id } })).toBe(1);
  });

  it("does not let a second Google account reuse a claimed invite", async () => {
    await prisma.invites.create({ data: { code: "INV-1", createdBy: 0 } });
    await signIn({}, { startQuery: { invite: "INV-1" } });

    const res = await signIn(
      { sub: "google-sub-2", email: "bob@vironix.ai" },
      { startQuery: { invite: "INV-1" } }
    );

    expect(refusalFrom(res)).toBe("not_invited");
    expect(await prisma.users.count()).toBe(1);
  });

  it("still signs in a Google account that is already linked", async () => {
    await configure({ provisioning: "auto" });
    await signIn();
    await configure({ provisioning: "invite_only" });

    expect(loginTokenFrom(await signIn())).toBeTruthy();
  });
});

describe("token swap and session", () => {
  it("swaps the login token once for a session that expires after 12 hours", async () => {
    const token = loginTokenFrom(await signIn());

    const res = await swap(token);

    expect(res.body.valid).toBe(true);
    const session = JWT.verify(res.body.token, process.env.JWT_SECRET);
    expect(session.exp - session.iat).toBe(12 * 3600);
    expect((await swap(token)).body.valid).toBe(false);
  });

  it("uses OIDC_SESSION_EXPIRY when set", async () => {
    process.env.OIDC_SESSION_EXPIRY = "30m";
    try {
      const res = await swap(loginTokenFrom(await signIn()));
      const session = JWT.verify(res.body.token, process.env.JWT_SECRET);
      expect(session.exp - session.iat).toBe(30 * 60);
    } finally {
      delete process.env.OIDC_SESSION_EXPIRY;
    }
  });

  it("refuses a Google login token once Google sign-in is turned off", async () => {
    const token = loginTokenFrom(await signIn());
    await configure({ enabled: false });

    const res = await swap(token);

    expect(res.statusCode).toBe(403);
  });

  it("does not open the swap to Simple SSO tokens when only Google sign-in is on", async () => {
    const user = await prisma.users.create({
      data: { username: "api-minted", password: "x" },
    });
    const { TemporaryAuthToken } = require("../../models/temporaryAuthToken");
    const { token } = await TemporaryAuthToken.issue(user.id);

    const res = await swap(token);

    expect(res.statusCode).toBe(403);
  });
});

describe("password sign-in while Google sign-in is on", () => {
  const PASSWORD = "correct-horse-battery";

  async function passwordUser(username, role) {
    return prisma.users.create({
      data: {
        username,
        role,
        password: bcrypt.hashSync(PASSWORD, 4),
        seen_recovery_codes: true,
      },
    });
  }

  function passwordLogin(username, password = PASSWORD) {
    return systemRoutes.call("POST", "/request-token", {
      body: { username, password },
    });
  }

  it("works for everyone while password sign-in is still on", async () => {
    await passwordUser("worker", "default");

    expect((await passwordLogin("worker")).body.valid).toBe(true);
  });

  it("refuses non-admins once password sign-in is off", async () => {
    await configure({ passwordLoginDisabled: true });
    await passwordUser("worker", "default");
    await passwordUser("lead", "manager");

    expect((await passwordLogin("worker")).body.message).toMatch(/^\[006\]/);
    expect((await passwordLogin("lead")).body.valid).toBe(false);
  });

  it("keeps working for admins once password sign-in is off", async () => {
    await configure({ passwordLoginDisabled: true });
    await passwordUser("root", "admin");

    const res = await passwordLogin("root");

    expect(res.body.valid).toBe(true);
    expect(JWT.verify(res.body.token, process.env.JWT_SECRET).id).toBeTruthy();
  });

  it("does not reveal the restriction to someone with the wrong password", async () => {
    await configure({ passwordLoginDisabled: true });
    await passwordUser("worker", "default");

    expect((await passwordLogin("worker", "wrong")).body.message).toMatch(/^\[001\]/);
  });

  it("lets admins recover their account with recovery codes", async () => {
    await configure({ passwordLoginDisabled: true });
    const admin = await passwordUser("root", "admin");
    const codes = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
    for (const code of codes)
      await prisma.recovery_codes.create({
        data: { user_id: admin.id, code_hash: bcrypt.hashSync(code, 4) },
      });

    const res = await systemRoutes.call("POST", "/system/recover-account", {
      body: { username: "root", recoveryCodes: codes.slice(0, 2) },
    });

    expect(res.body.success).toBe(true);
    expect(res.body.resetToken).toBeTruthy();
  });

  it("refuses password invites once password sign-in is off", async () => {
    const { inviteEndpoints } = require("../../endpoints/invite");
    const inviteRoutes = captureRoutes(inviteEndpoints);
    await configure({ passwordLoginDisabled: true });
    await prisma.invites.create({ data: { code: "INV-2", createdBy: 0 } });

    const res = await inviteRoutes.call("POST", "/invite/:code", {
      params: { code: "INV-2" },
      body: { username: "new-user", password: PASSWORD },
    });

    expect(res.statusCode).toBe(403);
    expect(await prisma.users.count({ where: { username: "new-user" } })).toBe(0);
  });
});
