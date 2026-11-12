/**
 * Google (OIDC) sign-in settings.
 *
 * Stored in `system_settings` (labels `oidc_*`), edited on the Security
 * settings page, and saved all at once: every field is validated against the
 * resulting configuration first, then all rows are written in one
 * transaction. They are deliberately not routed through `updateENV`, which
 * applies a request key by key and can leave a half-applied configuration
 * (SMF-10, SMF-29); with password sign-in turned off, a half-saved sign-in
 * configuration would lock everyone but admins out.
 *
 * Environment variables with the names below override the stored values, for
 * deployments that inject configuration. An overridden field is shown
 * read-only in the UI.
 */
const prisma = require("../prisma");

const GOOGLE_ISSUER = "https://accounts.google.com";
const SECRET_MASK = "**********";
const PROVISIONING_MODES = ["auto", "invite_only"];
// Accounts created on first sign-in never get admin; an admin promotes them.
const PROVISIONING_ROLES = ["default", "manager"];

/**
 * @typedef {Object} OidcSettings
 * @property {boolean} enabled
 * @property {string} issuer
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} redirectUri
 * @property {string[]} allowedDomains
 * @property {"auto"|"invite_only"} provisioning
 * @property {"default"|"manager"} defaultRole
 * @property {boolean} passwordLoginDisabled - password sign-in works for admins only
 */

const FIELDS = {
  enabled: { label: "oidc_enabled", env: "OIDC_ENABLED", type: "boolean" },
  issuer: { label: "oidc_issuer", env: "OIDC_ISSUER", type: "string" },
  clientId: { label: "oidc_client_id", env: "OIDC_CLIENT_ID", type: "string" },
  clientSecret: {
    label: "oidc_client_secret",
    env: "OIDC_CLIENT_SECRET",
    type: "secret",
  },
  redirectUri: {
    label: "oidc_redirect_uri",
    env: "OIDC_REDIRECT_URI",
    type: "string",
  },
  allowedDomains: {
    label: "oidc_allowed_domains",
    env: "OIDC_ALLOWED_DOMAINS",
    type: "list",
  },
  provisioning: {
    label: "oidc_provisioning",
    env: "OIDC_PROVISIONING",
    type: "string",
  },
  defaultRole: {
    label: "oidc_default_role",
    env: "OIDC_DEFAULT_ROLE",
    type: "string",
  },
  passwordLoginDisabled: {
    label: "oidc_password_login_disabled",
    env: "OIDC_ONLY",
    type: "boolean",
  },
};

/** @type {OidcSettings} */
const DEFAULTS = {
  enabled: false,
  issuer: GOOGLE_ISSUER,
  clientId: "",
  clientSecret: "",
  redirectUri: "",
  allowedDomains: [],
  provisioning: "auto",
  defaultRole: "default",
  passwordLoginDisabled: false,
};

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase()
  );
}

function parseList(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(",");
  return items
    .map((item) =>
      String(item ?? "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
}

/** Converts a raw value (stored string, env string or request body) to the field's type. */
function normalize(key, value) {
  const { type } = FIELDS[key];
  if (type === "boolean") return parseBoolean(value);
  if (type === "list") return parseList(value);
  return String(value ?? "").trim();
}

let cachedEncryptionManager = null;
/**
 * One EncryptionManager per process. Its constructor derives the key with
 * scrypt (tens of milliseconds of blocked event loop), too slow to repeat on
 * every request.
 */
function encryptionManager() {
  if (!cachedEncryptionManager) {
    const { EncryptionManager } = require("../EncryptionManager");
    cachedEncryptionManager = new EncryptionManager();
  }
  return cachedEncryptionManager;
}

// Stands in for a stored secret when the caller does not need its value, so
// validation still sees that one is set.
const UNREAD_SECRET = "(stored)";

/** The fields whose value comes from the environment rather than the database. */
function envOverrides() {
  return Object.keys(FIELDS).filter((key) => FIELDS[key].env in process.env);
}

/**
 * Reads the stored settings, without environment overrides. The secret is
 * decrypted only when `decryptSecret` is set.
 * @param {{decryptSecret?: boolean}} options
 * @returns {Promise<OidcSettings>}
 */
async function readStored({ decryptSecret = true } = {}) {
  const rows = await prisma.system_settings.findMany({
    where: { label: { in: Object.values(FIELDS).map((f) => f.label) } },
  });
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  const stored = { ...DEFAULTS };
  for (const [key, field] of Object.entries(FIELDS)) {
    const value = byLabel[field.label];
    if (value === undefined || value === null) continue;
    if (field.type === "secret") {
      if (!value) stored[key] = "";
      else if (!decryptSecret) stored[key] = UNREAD_SECRET;
      else stored[key] = encryptionManager().decrypt(value) || "";
      continue;
    }
    stored[key] = normalize(key, value);
  }
  return stored;
}

/** Applies environment overrides on top of `settings`. */
function withEnv(settings) {
  const effective = { ...settings };
  for (const key of envOverrides())
    effective[key] = normalize(key, process.env[FIELDS[key].env]);
  return effective;
}

let lastLoggedConfigErrors = "";

/**
 * The settings in force: stored values with environment overrides applied,
 * then validated. Configuration that comes only from environment variables
 * (or was stored before an override was removed) never went through a save,
 * so it is checked here too. An invalid configuration is treated as turned
 * off: Google sign-in disabled and password sign-in on for everyone. The
 * problems are logged once and returned in `configErrors`.
 *
 * @param {{decryptSecret?: boolean}} options - leave the secret encrypted
 *   when the caller only needs the flags (public and per-request checks)
 * @returns {Promise<OidcSettings & {configErrors: Object<string, string>}>}
 */
async function getOidcSettings({ decryptSecret = true } = {}) {
  const { SystemSettings } = require("../../models/systemSettings");
  const effective = withEnv(await readStored({ decryptSecret }));
  const configErrors = validateOidcSettings(effective, {
    multiUserMode: await SystemSettings.isMultiUserMode(),
  });
  if (Object.keys(configErrors).length === 0)
    return { ...effective, configErrors };

  const summary = JSON.stringify(configErrors);
  if (effective.enabled && summary !== lastLoggedConfigErrors) {
    lastLoggedConfigErrors = summary;
    console.error(
      "GOOGLE SIGN-IN IS TURNED OFF: its configuration is invalid.",
      summary
    );
  }
  return {
    ...effective,
    enabled: false,
    passwordLoginDisabled: false,
    configErrors,
  };
}

const DOMAIN_PATTERN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function isLocalHost(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** https, or http only on this machine (local development and tests). */
function validUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && isLocalHost(url)) return url;
  } catch {}
  return null;
}

/**
 * Validates a complete configuration.
 * @param {OidcSettings} settings - the configuration in force after the save
 * @param {{multiUserMode: boolean}} context
 * @returns {Object<string, string>} field → error; empty when valid
 */
function validateOidcSettings(settings, { multiUserMode }) {
  const errors = {};
  if (!validUrl(settings.issuer))
    errors.issuer = "Issuer must be an https URL.";
  if (
    !validUrl(settings.redirectUri) &&
    (settings.enabled || settings.redirectUri)
  )
    errors.redirectUri = "Redirect URI must be an https URL.";
  if (!PROVISIONING_MODES.includes(settings.provisioning))
    errors.provisioning = `Provisioning must be one of: ${PROVISIONING_MODES.join(", ")}.`;
  if (!PROVISIONING_ROLES.includes(settings.defaultRole))
    errors.defaultRole = `Default role must be one of: ${PROVISIONING_ROLES.join(", ")}.`;
  const badDomain = settings.allowedDomains.find(
    (d) => !DOMAIN_PATTERN.test(d)
  );
  if (badDomain) errors.allowedDomains = `"${badDomain}" is not a domain name.`;

  if (settings.enabled) {
    if (!multiUserMode)
      errors.enabled =
        "Google sign-in needs multi-user mode. Turn it on first.";
    if (!settings.clientId) errors.clientId = "Client ID is required.";
    if (!settings.clientSecret)
      errors.clientSecret = "Client secret is required.";
    if (!settings.redirectUri) errors.redirectUri = "Redirect URI is required.";
    if (settings.allowedDomains.length === 0)
      errors.allowedDomains =
        "At least one allowed domain is required, for example vironix.ai.";
  }
  if (settings.passwordLoginDisabled && !settings.enabled)
    errors.passwordLoginDisabled =
      "Password sign-in can only be turned off while Google sign-in is on.";
  return errors;
}

/**
 * Validates and saves a settings update. Nothing is written unless the whole
 * resulting configuration (including environment overrides) is valid; then
 * every field is written in one transaction.
 *
 * Fields left out of `input` keep their stored value. An empty or masked
 * `clientSecret` keeps the stored secret.
 *
 * @param {Partial<Record<keyof OidcSettings, any>>} input
 * @returns {Promise<{success: boolean, errors: Object<string, string>}>}
 */
async function saveOidcSettings(input = {}) {
  const { SystemSettings } = require("../../models/systemSettings");
  const stored = await readStored();
  const next = { ...stored };
  for (const key of Object.keys(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    if (key === "clientSecret") {
      const secret = String(input.clientSecret ?? "").trim();
      if (!secret || secret === SECRET_MASK) continue;
    }
    next[key] = normalize(key, input[key]);
  }

  const errors = validateOidcSettings(withEnv(next), {
    multiUserMode: await SystemSettings.isMultiUserMode(),
  });
  if (Object.keys(errors).length > 0) return { success: false, errors };

  const writes = Object.entries(FIELDS).map(([key, field]) => {
    let value = next[key];
    if (field.type === "list") value = value.join(",");
    else if (field.type === "boolean") value = value ? "true" : "false";
    else if (field.type === "secret")
      value = value ? encryptionManager().encrypt(value) : "";
    return prisma.system_settings.upsert({
      where: { label: field.label },
      update: { value: String(value) },
      create: { label: field.label, value: String(value) },
    });
  });
  await prisma.$transaction(writes);

  require("./oidc").resetOidcClientCache();
  return { success: true, errors: {} };
}

/**
 * The settings as shown to an admin: the secret is masked, and the fields set
 * by environment variables are listed.
 * @returns {Promise<Object>}
 */
async function oidcSettingsForDisplay() {
  // What the admin configured, not the forced-off view, so the form shows
  // their values; `configErrors` says why it is not in force.
  const configured = withEnv(await readStored({ decryptSecret: false }));
  const { configErrors } = await getOidcSettings({ decryptSecret: false });
  return {
    ...configured,
    clientSecret: configured.clientSecret ? SECRET_MASK : "",
    envOverrides: envOverrides(),
    configErrors,
  };
}

/**
 * Whether password sign-in is turned off for non-admins. Only true while
 * Google sign-in is enabled with a valid configuration, so a stale flag or a
 * broken configuration cannot lock users out.
 * @returns {Promise<boolean>}
 */
async function passwordLoginRestricted() {
  const { enabled, passwordLoginDisabled } = await getOidcSettings({
    decryptSecret: false,
  });
  return enabled && passwordLoginDisabled;
}

module.exports = {
  GOOGLE_ISSUER,
  SECRET_MASK,
  FIELDS,
  getOidcSettings,
  saveOidcSettings,
  validateOidcSettings,
  oidcSettingsForDisplay,
  passwordLoginRestricted,
};
