const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const { EncryptionManager } = require("../EncryptionManager");
const { decodeJWT } = require("../http");
const { UserMetaCache } = require("../userLocale");
const EncryptionMgr = new EncryptionManager();

async function validatedRequest(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;
  if (multiUserMode)
    return await validateMultiUserRequest(request, response, next);

  // When in development passthrough auth token for ease of development.
  // Or if the user simply did not set an Auth token or JWT Secret
  if (
    process.env.NODE_ENV === "development" ||
    !process.env.AUTH_TOKEN ||
    !process.env.JWT_SECRET
  ) {
    UserMetaCache.setFromRequest(request);
    next();
    return;
  }

  if (!process.env.AUTH_TOKEN) {
    response.status(401).json({
      error: "You need to set an AUTH_TOKEN environment variable.",
    });
    return;
  }

  const auth = request.header("Authorization");
  const token = auth ? auth.split(" ")[1] : null;

  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const bcrypt = require("bcryptjs");
  const { p } = decodeJWT(token);

  if (p === null || !/\w{32}:\w{32}/.test(p)) {
    response.status(401).json({
      error: "Token expired or failed validation.",
    });
    return;
  }

  // Since the blame of this comment we have been encrypting the `p` property of JWTs with the persistent
  // encryptionManager PEM's. This prevents us from storing the `p` unencrypted in the JWT itself, which could
  // be unsafe. As a consequence, existing JWTs with invalid `p` values that do not match the regex
  // in ln:44 will be marked invalid so they can be logged out and forced to log back in and obtain an encrypted token.
  // This kind of methodology only applies to single-user password mode.
  if (
    !bcrypt.compareSync(
      EncryptionMgr.decrypt(p),
      bcrypt.hashSync(process.env.AUTH_TOKEN, 10)
    )
  ) {
    response.status(401).json({
      error: "Invalid auth credentials.",
    });
    return;
  }

  UserMetaCache.setFromRequest(request);
  next();
}

async function validateMultiUserRequest(request, response, next) {
  const auth = request.header("Authorization");
  const token = auth ? auth.split(" ")[1] : null;

  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const valid = decodeJWT(token);
  if (!valid || !valid.id) {
    response.status(401).json({
      error: "Invalid auth token.",
    });
    return;
  }

  const user = await User.get({ id: valid.id });
  if (!user) {
    response.status(401).json({
      error: "Invalid auth for user.",
    });
    return;
  }

  if (user.suspended) {
    response.status(401).json({
      error: "User is suspended from system",
    });
    return;
  }

  response.locals.user = user;
  UserMetaCache.setFromRequest(request, user.id);
  next();
}

/**
 * Check a session token outside Express (the agent websocket). Same rules as
 * `validatedRequest`: in multi-user mode the token must name an existing, active user;
 * in single-user mode with a password set it must be the single-user token.
 * @param {string|null} token
 * @returns {Promise<{ok: boolean, multiUserMode: boolean, user: object|null, error: string|null}>}
 */
async function authenticateSessionToken(token = null) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  const fail = (error) => ({ ok: false, multiUserMode, user: null, error });

  if (multiUserMode) {
    if (!token) return fail("No auth token found.");
    const valid = decodeJWT(token);
    if (!valid || !valid.id) return fail("Invalid auth token.");
    const user = await User.get({ id: valid.id });
    if (!user) return fail("Invalid auth for user.");
    if (user.suspended) return fail("User is suspended from system");
    return { ok: true, multiUserMode, user, error: null };
  }

  if (
    process.env.NODE_ENV === "development" ||
    !process.env.AUTH_TOKEN ||
    !process.env.JWT_SECRET
  )
    return { ok: true, multiUserMode, user: null, error: null };

  if (!token) return fail("No auth token found.");
  const { p } = decodeJWT(token);
  if (p === null || !/\w{32}:\w{32}/.test(p))
    return fail("Token expired or failed validation.");
  const bcrypt = require("bcryptjs");
  if (
    !bcrypt.compareSync(
      EncryptionMgr.decrypt(p),
      bcrypt.hashSync(process.env.AUTH_TOKEN, 10)
    )
  )
    return fail("Invalid auth credentials.");
  return { ok: true, multiUserMode, user: null, error: null };
}

/** WebSocket sub-protocol that marks the next offered protocol as the session token. */
const WS_AUTH_PROTOCOL = "anythingllm.auth";

/**
 * Read the session token a browser offered in `Sec-WebSocket-Protocol` as
 * `[WS_AUTH_PROTOCOL, <token>]` (browsers can't set an Authorization header on a socket).
 * @param {import("http").IncomingMessage} request
 * @returns {string|null}
 */
function tokenFromWebsocketRequest(request) {
  const header = request?.headers?.["sec-websocket-protocol"];
  if (!header) return null;
  const offered = String(header)
    .split(",")
    .map((value) => value.trim());
  const index = offered.indexOf(WS_AUTH_PROTOCOL);
  if (index === -1 || !offered[index + 1]) return null;
  return offered[index + 1];
}

module.exports = {
  validatedRequest,
  authenticateSessionToken,
  tokenFromWebsocketRequest,
  WS_AUTH_PROTOCOL,
};
