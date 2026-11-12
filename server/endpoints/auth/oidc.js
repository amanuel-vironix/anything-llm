const { EventLogs } = require("../../models/eventLogs");
const { SystemSettings } = require("../../models/systemSettings");
const { TemporaryAuthToken } = require("../../models/temporaryAuthToken");
const { Telemetry } = require("../../models/telemetry");
const { reqBody, userFromSession } = require("../../utils/http");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  strictMultiUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const {
  getOidcSettings,
  saveOidcSettings,
  oidcSettingsForDisplay,
} = require("../../utils/auth/oidcSettings");
const {
  STATE_COOKIE,
  REFUSALS,
  startSignIn,
  completeSignIn,
  stateCookieOptions,
  readCookie,
  appBaseUrl,
} = require("../../utils/auth/oidc");

/**
 * Sends the browser back to the login page with a refusal code the page can
 * explain. Falls back to a relative path when the settings have no redirect
 * URI to take the app's address from.
 */
function toLogin(response, settings, reason) {
  let base = "";
  try {
    base = appBaseUrl(settings);
  } catch {}
  response.redirect(`${base}/login?sso_error=${encodeURIComponent(reason)}`);
}

function oidcEndpoints(app) {
  if (!app) return;

  /**
   * Starts Google sign-in. `?invite=<code>` carries an invite through the
   * round trip for invite-only provisioning.
   */
  app.get("/auth/oidc/start", async (request, response) => {
    let settings = {};
    try {
      settings = await getOidcSettings();
      if (!settings.enabled || !(await SystemSettings.isMultiUserMode()))
        return toLogin(response, settings, "disabled");

      const inviteCode =
        typeof request.query?.invite === "string" ? request.query.invite : null;
      const { url, cookie } = await startSignIn(settings, { inviteCode });
      response.cookie(STATE_COOKIE, cookie, stateCookieOptions(settings));
      response.redirect(url);
    } catch (error) {
      console.error("FAILED TO START OIDC SIGN-IN.", error.message);
      toLogin(response, settings, "provider_error");
    }
  });

  /**
   * The provider's redirect back. Verifies the response, finds or creates the
   * user, then hands the browser a one-time token for `/sso/simple`, which
   * swaps it for a session.
   */
  app.get("/auth/oidc/callback", async (request, response) => {
    let settings = {};
    const ip = request.ip || "Unknown IP";
    try {
      settings = await getOidcSettings();
      const stateCookie = readCookie(request.headers?.cookie, STATE_COOKIE);
      response.clearCookie(STATE_COOKIE, {
        ...stateCookieOptions(settings),
        maxAge: undefined,
      });

      const multiUserMode = await SystemSettings.isMultiUserMode();
      const result = multiUserMode
        ? await completeSignIn(settings, {
            query: request.query || {},
            stateCookie,
          })
        : { user: null, reason: "disabled" };

      if (!result.user) {
        await EventLogs.logEvent("failed_login_oidc", {
          ip,
          reason: result.reason,
          email: result.email || null,
          ...(result.detail ? { detail: result.detail } : {}),
        });
        return toLogin(response, settings, result.reason);
      }

      // One live login token per user: a sign-in racing another for the same
      // user can find the database busy, so try once more before giving up.
      let issued = await TemporaryAuthToken.issue(result.user.id, {
        prefix: TemporaryAuthToken.oidcPrefix,
      });
      if (!issued.token) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        issued = await TemporaryAuthToken.issue(result.user.id, {
          prefix: TemporaryAuthToken.oidcPrefix,
        });
      }
      const { token, error } = issued;
      if (!token) throw new Error(error || "Could not issue a sign-in token.");

      if (result.created)
        await EventLogs.logEvent(
          "user_created_oidc",
          { username: result.user.username, role: result.user.role },
          result.user.id
        );
      await EventLogs.logEvent(
        "login_event",
        { ip, username: result.user.username, method: "oidc" },
        result.user.id
      );
      await Telemetry.sendTelemetry(
        "login_event",
        { multiUserMode: true },
        result.user.id
      );
      response.redirect(
        `${appBaseUrl(settings)}/sso/simple?token=${encodeURIComponent(token)}`
      );
    } catch (error) {
      console.error("FAILED TO COMPLETE OIDC SIGN-IN.", error.message);
      await EventLogs.logEvent("failed_login_oidc", {
        ip,
        reason: "account_error",
        detail: error.message,
      });
      toLogin(response, settings, "account_error");
    }
  });

  app.get(
    "/admin/oidc-settings",
    [validatedRequest, strictMultiUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        response
          .status(200)
          .json({ settings: await oidcSettingsForDisplay(), error: null });
      } catch (error) {
        console.error(error);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/admin/oidc-settings",
    [validatedRequest, strictMultiUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const currUser = await userFromSession(request, response);
        const { success, errors } = await saveOidcSettings(
          reqBody(request) || {}
        );
        if (success)
          await EventLogs.logEvent(
            "oidc_settings_updated",
            { updatedBy: currUser?.username },
            currUser?.id
          );
        response.status(200).json({ success, errors });
      } catch (error) {
        console.error(error);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { oidcEndpoints, REFUSALS };
