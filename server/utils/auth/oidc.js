/**
 * Google sign-in (OpenID Connect, authorization code flow with PKCE).
 *
 * `/auth/oidc/start` keeps `state`, `nonce` and the PKCE verifier in a
 * short-lived signed cookie and sends the browser to the provider. The
 * provider sends it back to `/auth/oidc/callback`, where `completeSignIn`
 * exchanges the code and verifies the ID token (signature against the
 * provider's published keys, `iss`, `aud`, `exp`, `nonce`; done by
 * openid-client), then applies the domain rules and finds or creates the
 * user. The endpoint then issues a one-time token for the existing
 * `/sso/simple` page, so the session JWT never appears in a URL.
 *
 * Generic OIDC: only the `hd` (Google Workspace domain) claim is
 * Google-specific.
 */
const JWT = require("jsonwebtoken");
const { Issuer, generators, custom } = require("openid-client");
const prisma = require("../prisma");
const { User } = require("../../models/user");
const { UserIdentity } = require("../../models/userIdentity");
const { GOOGLE_ISSUER } = require("./oidcSettings");

const STATE_COOKIE = "allm_oidc";
const STATE_COOKIE_PATH = "/api/auth/oidc";
const STATE_AUDIENCE = "anythingllm-oidc-state";
const STATE_TTL_SECONDS = 10 * 60;
const CLIENT_CACHE_MS = 60 * 60 * 1000;

/** Reasons a sign-in is refused; logged in `failed_login_oidc` and shown on the login page. */
const REFUSALS = {
  disabled: "Google sign-in is not enabled.",
  state_invalid:
    "The sign-in request expired or was not started here. Try again.",
  provider_error: "Google did not complete the sign-in.",
  token_invalid: "The sign-in response from Google could not be verified.",
  email_unverified: "Your Google account's email address is not verified.",
  domain_not_allowed: "This Google account is not in an allowed domain.",
  hd_not_allowed: "Sign in with your organization's Google Workspace account.",
  not_invited:
    "No account exists for this Google account. Ask an admin for an invite.",
  suspended: "This account is suspended.",
  account_error: "The account could not be set up. Contact an admin.",
};

let clientCache = { key: null, client: null, at: 0 };

function resetOidcClientCache() {
  clientCache = { key: null, client: null, at: 0 };
}

/** The `provider` value stored in `user_identities`. */
function providerFor(issuer) {
  return issuer === GOOGLE_ISSUER ? "google" : issuer;
}

/** How long a session started through Google sign-in lasts (`OIDC_SESSION_EXPIRY`, default 12h). */
function oidcSessionExpiry() {
  return process.env.OIDC_SESSION_EXPIRY || "12h";
}

/**
 * Where the browser goes after the callback: the frontend's origin. Taken
 * from configuration (`OIDC_APP_URL`, else the redirect URI's origin), never
 * from request headers, so a forged Host header cannot redirect the login.
 */
function appBaseUrl(settings) {
  const base = process.env.OIDC_APP_URL || new URL(settings.redirectUri).origin;
  return base.replace(/\/+$/, "");
}

/**
 * The discovered provider and a client for it, cached for an hour and
 * dropped whenever the settings are saved.
 * @param {import("./oidcSettings").OidcSettings} settings
 */
async function getClient(settings) {
  const key = JSON.stringify([
    settings.issuer,
    settings.clientId,
    settings.clientSecret,
    settings.redirectUri,
  ]);
  if (clientCache.key === key && Date.now() - clientCache.at < CLIENT_CACHE_MS)
    return clientCache.client;

  const issuer = await Issuer.discover(settings.issuer);
  if (issuer.metadata.issuer !== settings.issuer)
    throw new Error(
      `Discovery returned issuer ${issuer.metadata.issuer}, expected ${settings.issuer}.`
    );
  const client = new issuer.Client({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    redirect_uris: [settings.redirectUri],
    response_types: ["code"],
  });
  client[custom.clock_tolerance] = 5;
  clientCache = { key, client, at: Date.now() };
  return client;
}

/**
 * Builds the provider URL to send the browser to, and the signed cookie that
 * carries the checks for the callback.
 * @param {import("./oidcSettings").OidcSettings} settings
 * @param {{inviteCode?: string|null}} options
 * @returns {Promise<{url: string, cookie: string}>}
 */
async function startSignIn(settings, { inviteCode = null } = {}) {
  const client = await getClient(settings);
  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();

  const params = {
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: generators.codeChallenge(codeVerifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  };
  // A hint for Google's account chooser; the domain is enforced on the callback.
  if (settings.issuer === GOOGLE_ISSUER && settings.allowedDomains.length === 1)
    params.hd = settings.allowedDomains[0];

  const cookie = JWT.sign(
    { s: state, n: nonce, v: codeVerifier, i: inviteCode || null },
    process.env.JWT_SECRET,
    { expiresIn: STATE_TTL_SECONDS, audience: STATE_AUDIENCE }
  );
  return { url: client.authorizationUrl(params), cookie };
}

function stateCookieOptions(settings) {
  return {
    httpOnly: true,
    // Lax: the cookie must ride along on the provider's top-level redirect back.
    sameSite: "lax",
    secure: new URL(settings.redirectUri).protocol === "https:",
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_SECONDS * 1000,
  };
}

/** Reads one cookie from a raw Cookie header. */
function readCookie(header = "", name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Applies the account rules to verified ID token claims.
 * @param {Object} claims - verified ID token claims
 * @param {string[]} allowedDomains - lowercase domain names
 * @returns {string|null} a key of REFUSALS, or null when allowed
 */
function checkClaims(claims, allowedDomains) {
  if (claims.email_verified !== true) return "email_unverified";
  const email =
    typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  const at = email.lastIndexOf("@");
  if (at < 1) return "domain_not_allowed";
  const emailDomain = email.slice(at + 1);
  if (!allowedDomains.includes(emailDomain)) return "domain_not_allowed";
  // `hd` is only present for Google Workspace accounts. Requiring it keeps out
  // consumer Google accounts that use a work address as their login.
  const hd = typeof claims.hd === "string" ? claims.hd.toLowerCase() : "";
  if (!allowedDomains.includes(hd)) return "hd_not_allowed";
  return null;
}

/**
 * A username for a new account, from the email. `attempt` > 0 adds a suffix
 * to the local part when the plain one is taken. Long addresses are shortened
 * in the local part, so the suffix survives the 64-character limit and each
 * attempt gives a different name.
 */
function usernameFor(email, attempt = 0) {
  const MAX = 64;
  let candidate = String(email)
    .toLowerCase()
    .replace(/[^a-z0-9._@-]/g, "-");
  if (!/^[a-z]/.test(candidate)) candidate = `u${candidate}`;
  const at = candidate.lastIndexOf("@");
  const local = at >= 0 ? candidate.slice(0, at) : candidate;
  const domain = at >= 0 ? candidate.slice(at) : "";
  const suffix = attempt > 0 ? `.${attempt + 1}` : "";
  const room = MAX - suffix.length - domain.length;
  if (room >= 1) return `${local.slice(0, room)}${suffix}${domain}`;
  return `${(local + domain).slice(0, MAX - suffix.length)}${suffix}`;
}

function isUsernameConflict(error) {
  return (
    error?.code === "P2002" &&
    []
      .concat(error?.meta?.target || [])
      .some((t) => String(t).includes("username"))
  );
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The user linked to an identity, or null. */
async function linkedUser(provider, subject) {
  const identity = await UserIdentity.find(provider, subject);
  if (!identity) return null;
  return { identity, user: await User._get({ id: identity.user_id }) };
}

/**
 * Creates a user and its identity row in one transaction. When two callbacks
 * for the same new account race, the `(provider, subject)` unique index lets
 * only one commit; the other finds the committed identity and signs in as
 * that user, so one Google account makes one user.
 */
async function createUserWithIdentity({ provider, claims, role }) {
  const email = claims.email.toLowerCase();
  let usernameAttempt = 0;
  for (let tries = 0; tries < 6; tries++) {
    const { data, error } = User.prepareCreate(
      { username: usernameFor(email, usernameAttempt), role },
      { unusablePassword: true }
    );
    if (error) throw new Error(error);
    try {
      const user = await prisma.$transaction(async (tx) => {
        const user = await tx.users.create({ data });
        await tx.user_identities.create({
          data: {
            user_id: user.id,
            provider,
            subject: claims.sub,
            email,
            lastLoginAt: new Date(),
          },
        });
        return user;
      });
      return { user, created: true };
    } catch (error) {
      const existing = await linkedUser(provider, claims.sub);
      if (existing?.user) return { user: existing.user, created: false };
      if (isUsernameConflict(error)) usernameAttempt++;
      else await pause(25 * (tries + 1)); // database busy; try again
    }
  }
  throw new Error("Could not create an account for this Google identity.");
}

/**
 * Claims an invite for a new Google account (invite-only provisioning). The
 * claim and the user and identity inserts commit together (see Invite.claim).
 */
async function claimInviteWithIdentity({ provider, claims, inviteCode }) {
  const { Invite } = require("../../models/invite");
  const email = claims.email.toLowerCase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = User.prepareCreate(
      { username: usernameFor(email, attempt), role: "default" },
      { unusablePassword: true }
    );
    if (error) throw new Error(error);
    const { user, error: claimError } = await Invite.claim(
      inviteCode,
      data,
      async (tx, created) => {
        await tx.user_identities.create({
          data: {
            user_id: created.id,
            provider,
            subject: claims.sub,
            email,
            lastLoginAt: new Date(),
          },
        });
      }
    );
    if (user) return { user: await User._get({ id: user.id }), created: true };
    const existing = await linkedUser(provider, claims.sub);
    if (existing?.user) return { user: existing.user, created: false };
    if (!String(claimError).includes("username")) return null;
  }
  return null;
}

/**
 * Finishes a sign-in from the provider's callback.
 * @param {import("./oidcSettings").OidcSettings} settings
 * @param {{query: Object, stateCookie: string|null}} request
 * @returns {Promise<{user: Object|null, created?: boolean, reason?: string, email?: string|null, detail?: string}>}
 *   `reason` (a key of REFUSALS) when refused
 */
async function completeSignIn(settings, { query = {}, stateCookie = null }) {
  if (!settings.enabled) return { user: null, reason: "disabled" };

  let pending;
  try {
    pending = JWT.verify(String(stateCookie || ""), process.env.JWT_SECRET, {
      audience: STATE_AUDIENCE,
    });
  } catch {
    return { user: null, reason: "state_invalid" };
  }
  if (!query.state || query.state !== pending.s)
    return { user: null, reason: "state_invalid" };
  if (query.error)
    return {
      user: null,
      reason: "provider_error",
      detail: String(query.error),
    };

  let claims;
  try {
    const client = await getClient(settings);
    const tokenSet = await client.callback(settings.redirectUri, query, {
      state: pending.s,
      nonce: pending.n,
      code_verifier: pending.v,
    });
    claims = tokenSet.claims();
  } catch (error) {
    return { user: null, reason: "token_invalid", detail: error.message };
  }

  const email =
    typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  const refusal = checkClaims(claims, settings.allowedDomains);
  if (refusal) return { user: null, reason: refusal, email };

  const provider = providerFor(settings.issuer);
  let result;
  try {
    const existing = await linkedUser(provider, claims.sub);
    if (existing?.user) {
      await UserIdentity.recordLogin(existing.identity.id, email);
      result = { user: existing.user, created: false };
    } else if (settings.provisioning === "invite_only") {
      result = pending.i
        ? await claimInviteWithIdentity({
            provider,
            claims,
            inviteCode: pending.i,
          })
        : null;
      if (!result) return { user: null, reason: "not_invited", email };
    } else {
      result = await createUserWithIdentity({
        provider,
        claims,
        role: settings.defaultRole,
      });
    }
  } catch (error) {
    return {
      user: null,
      reason: "account_error",
      email,
      detail: error.message,
    };
  }

  if (result.user.suspended) return { user: null, reason: "suspended", email };
  return { user: result.user, created: result.created, email };
}

module.exports = {
  STATE_COOKIE,
  REFUSALS,
  startSignIn,
  completeSignIn,
  stateCookieOptions,
  readCookie,
  checkClaims,
  usernameFor,
  providerFor,
  appBaseUrl,
  oidcSessionExpiry,
  resetOidcClientCache,
};
