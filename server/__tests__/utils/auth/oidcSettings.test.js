/* eslint-env jest */
/**
 * Google sign-in settings: validated as a whole, saved all at once, env
 * overrides, secret handling. A half-valid save must change nothing, because
 * a half-applied sign-in configuration can lock users out.
 */
process.env.SIG_KEY = "oidc-settings-test-key";
process.env.SIG_SALT = "oidc-settings-test-salt";

const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const {
  saveOidcSettings,
  getOidcSettings,
  oidcSettingsForDisplay,
  passwordLoginRestricted,
  SECRET_MASK,
  FIELDS,
} = require("../../../utils/auth/oidcSettings");

const prisma = mockDb.prisma;
const VALID = {
  enabled: true,
  issuer: "https://accounts.google.com",
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://llm.vironix.ai/api/auth/oidc/callback",
  allowedDomains: "vironix.ai",
  provisioning: "auto",
  defaultRole: "default",
  passwordLoginDisabled: false,
};

async function storedRows() {
  const rows = await prisma.system_settings.findMany({
    where: { label: { startsWith: "oidc_" } },
    orderBy: { label: "asc" },
  });
  return rows.map(({ label, value }) => ({ label, value }));
}

async function setMultiUser(on) {
  await prisma.system_settings.upsert({
    where: { label: "multi_user_mode" },
    update: { value: String(on) },
    create: { label: "multi_user_mode", value: String(on) },
  });
}

beforeEach(async () => {
  for (const field of Object.values(FIELDS)) delete process.env[field.env];
  await prisma.system_settings.deleteMany({});
  await setMultiUser(true);
});

afterAll(async () => {
  await mockDb.cleanup();
});

describe("saveOidcSettings", () => {
  it("saves a valid configuration and reads it back", async () => {
    expect(await saveOidcSettings(VALID)).toEqual({ success: true, errors: {} });

    expect(await getOidcSettings()).toEqual({
      ...VALID,
      allowedDomains: ["vironix.ai"],
    });
  });

  it("changes nothing when one field of an otherwise valid update is invalid", async () => {
    await saveOidcSettings(VALID);
    const before = await storedRows();

    const result = await saveOidcSettings({
      ...VALID,
      clientId: "a-new-client-id",
      allowedDomains: "vironix.ai",
      redirectUri: "not a url",
    });

    expect(result.success).toBe(false);
    expect(Object.keys(result.errors)).toEqual(["redirectUri"]);
    expect(await storedRows()).toEqual(before);
  });

  it("refuses to enable Google sign-in in single-user mode", async () => {
    await setMultiUser(false);

    const result = await saveOidcSettings(VALID);

    expect(result.errors.enabled).toMatch(/multi-user/);
    expect(await storedRows()).toEqual([]);
  });

  it.each([
    ["no client ID", { clientId: "" }, "clientId"],
    ["no allowed domain", { allowedDomains: "" }, "allowedDomains"],
    ["a malformed domain", { allowedDomains: "vironix.ai, not a domain" }, "allowedDomains"],
    ["an http issuer", { issuer: "http://accounts.google.com" }, "issuer"],
    ["an admin default role", { defaultRole: "admin" }, "defaultRole"],
    ["an unknown provisioning mode", { provisioning: "everyone" }, "provisioning"],
    ["password sign-in off without Google sign-in", { enabled: false, passwordLoginDisabled: true }, "passwordLoginDisabled"],
  ])("refuses %s", async (_name, change, field) => {
    const result = await saveOidcSettings({ ...VALID, ...change });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveProperty(field);
  });

  it("refuses an enabled configuration without a client secret", async () => {
    const result = await saveOidcSettings({ ...VALID, clientSecret: "" });

    expect(result.errors).toHaveProperty("clientSecret");
  });

  it("stores the client secret encrypted, never in plain text", async () => {
    await saveOidcSettings(VALID);

    const row = await prisma.system_settings.findFirst({
      where: { label: "oidc_client_secret" },
    });
    expect(row.value).not.toContain(VALID.clientSecret);
    expect((await getOidcSettings()).clientSecret).toBe(VALID.clientSecret);
  });

  it.each([
    ["the mask", SECRET_MASK],
    ["an empty value", ""],
  ])("keeps the stored secret when the update sends %s", async (_name, secret) => {
    await saveOidcSettings(VALID);

    await saveOidcSettings({ ...VALID, clientSecret: secret });

    expect((await getOidcSettings()).clientSecret).toBe(VALID.clientSecret);
  });
});

describe("environment overrides", () => {
  it("override stored values and are listed for the UI", async () => {
    await saveOidcSettings(VALID);
    process.env.OIDC_ALLOWED_DOMAINS = "Vironix.ai, example.org";
    process.env.OIDC_ONLY = "true";

    const settings = await getOidcSettings();
    const display = await oidcSettingsForDisplay();

    expect(settings.allowedDomains).toEqual(["vironix.ai", "example.org"]);
    expect(settings.passwordLoginDisabled).toBe(true);
    expect(display.envOverrides).toEqual(["allowedDomains", "passwordLoginDisabled"]);
    expect(display.clientSecret).toBe(SECRET_MASK);
  });

  it("count when validating a save", async () => {
    process.env.OIDC_REDIRECT_URI = "javascript:alert(1)";

    const result = await saveOidcSettings(VALID);

    expect(result.errors).toHaveProperty("redirectUri");
  });
});

describe("passwordLoginRestricted", () => {
  it("is true only while Google sign-in is on and password sign-in is off", async () => {
    await saveOidcSettings({ ...VALID, passwordLoginDisabled: true });
    expect(await passwordLoginRestricted()).toBe(true);

    process.env.OIDC_ENABLED = "false";
    expect(await passwordLoginRestricted()).toBe(false);
  });
});
