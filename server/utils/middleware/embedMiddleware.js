const { v4: uuidv4, validate } = require("uuid");
const { VALID_CHAT_MODE } = require("../chats/stream");
const { EmbedChats } = require("../../models/embedChats");
const { EmbedConfig } = require("../../models/embedConfig");
const { reqBody } = require("../http");
const { audit } = require("../audit");

/**
 * Records that the embed widget refused a request. Never throws: a refusal
 * must still be sent if the audit write fails.
 * @param {Object} request
 * @param {Object} response
 * @param {string} check - which rule refused it
 */
async function recordRejected(request, response, check) {
  try {
    await audit.record(
      {
        action: "embed.rejected",
        outcome: "denied",
        reason: check,
        targetType: "embed",
        targetId: response.locals.embedConfig?.id,
        metadata: {
          embedUuid: response.locals.embedConfig?.uuid,
          origin: request.headers?.origin,
          check,
        },
      },
      { response }
    );
  } catch (e) {
    console.error("[audit] embed.rejected not recorded:", e.message);
  }
}

// Finds or Aborts request for a /:embedId/ url. This should always
// be the first middleware and the :embedID should be in the URL.
async function validEmbedConfig(request, response, next) {
  const { embedId } = request.params;

  const embed = await EmbedConfig.getWithWorkspace({ uuid: String(embedId) });
  if (!embed) {
    response.sendStatus(404).end();
    return;
  }

  response.locals.embedConfig = embed;
  next();
}

function setConnectionMeta(request, response, next) {
  response.locals.connection = {
    host: request.headers?.origin,
    ip: request?.ip,
  };
  next();
}

async function validEmbedConfigId(request, response, next) {
  const { embedId } = request.params;

  const embed = await EmbedConfig.get({ id: Number(embedId) });
  if (!embed) {
    response.sendStatus(404).end();
    return;
  }

  response.locals.embedConfig = embed;
  next();
}

// Shared access checks for any request that touches an embed's chat data.
// Responds and returns false if the request should not proceed.
async function passesEmbedAccessControl(request, response) {
  const embed = response.locals.embedConfig;
  if (!embed) {
    response.sendStatus(404).end();
    return false;
  }

  // Block if disabled by admin.
  if (!embed.enabled) {
    await recordRejected(request, response, "disabled");
    response.status(503).json({
      id: uuidv4(),
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error:
        "This chat has been disabled by the administrator - try again later.",
    });
    return false;
  }

  // Check if requester hostname is in the valid allowlist of domains.
  const host = request.headers.origin ?? "";
  const allowedHosts = EmbedConfig.parseAllowedHosts(embed);

  // Optional hardening for when an embed with no allowlist is created.
  // This would mean the embed will accept requests from ANY origin (parseAllowedHosts returns
  // null). When EMBED_REQUIRE_ALLOWLIST is enabled, treat "no allowlist" as
  // deny-all instead of allow-all, so an embed cannot be queried cross-origin
  // until its owner explicitly sets the allowed domains.
  if (allowedHosts === null && "EMBED_REQUIRE_ALLOWLIST" in process.env) {
    await recordRejected(request, response, "allowlist_required");
    response.status(401).json({
      id: uuidv4(),
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: "Invalid request.",
    });
    return false;
  }

  if (allowedHosts !== null && !allowedHosts.includes(host)) {
    await recordRejected(request, response, "origin_not_allowed");
    response.status(401).json({
      id: uuidv4(),
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: "Invalid request.",
    });
    return false;
  }

  return true;
}

// Access control for the embed history routes (read/invalidate) where the
// sessionId is a URL param and there is no message body.
async function canAccessHistory(request, response, next) {
  if (!(await passesEmbedAccessControl(request, response))) return;

  const { sessionId } = request.params;
  if (typeof sessionId !== "string" || !validate(sessionId)) {
    await recordRejected(request, response, "invalid_session");
    response.status(404).json({ error: "Invalid session ID." });
    return;
  }

  next();
}

async function canRespond(request, response, next) {
  try {
    if (!(await passesEmbedAccessControl(request, response))) return;
    const embed = response.locals.embedConfig;

    const { sessionId, message } = reqBody(request);
    if (typeof sessionId !== "string" || !validate(String(sessionId))) {
      await recordRejected(request, response, "invalid_session");
      response.status(404).json({
        id: uuidv4(),
        type: "abort",
        textResponse: null,
        sources: [],
        close: true,
        error: "Invalid session ID.",
      });
      return;
    }

    if (!message?.length || !VALID_CHAT_MODE.includes(embed.chat_mode)) {
      response.status(400).json({
        id: uuidv4(),
        type: "abort",
        textResponse: null,
        sources: [],
        close: true,
        error: !message?.length
          ? "Message is empty."
          : `${embed.chat_mode} is not a valid mode.`,
      });
      return;
    }

    if (
      !isNaN(embed.max_chats_per_day) &&
      Number(embed.max_chats_per_day) > 0
    ) {
      const dailyChatCount = await EmbedChats.count({
        embed_id: embed.id,
        createdAt: {
          gte: new Date(new Date() - 24 * 60 * 60 * 1000),
        },
      });

      if (dailyChatCount >= Number(embed.max_chats_per_day)) {
        await recordRejected(request, response, "daily_quota");
        response.status(429).json({
          id: uuidv4(),
          type: "abort",
          textResponse: null,
          sources: [],
          close: true,
          error: "Rate limit exceeded",
          errorMsg:
            "The quota for this chat has been reached. Try again later or contact the site owner.",
        });
        return;
      }
    }

    if (
      !isNaN(embed.max_chats_per_session) &&
      Number(embed.max_chats_per_session) > 0
    ) {
      const dailySessionCount = await EmbedChats.count({
        embed_id: embed.id,
        session_id: sessionId,
        createdAt: {
          gte: new Date(new Date() - 24 * 60 * 60 * 1000),
        },
      });

      if (dailySessionCount >= Number(embed.max_chats_per_session)) {
        await recordRejected(request, response, "session_quota");
        response.status(429).json({
          id: uuidv4(),
          type: "abort",
          textResponse: null,
          sources: [],
          close: true,
          error:
            "Your quota for this chat has been reached. Try again later or contact the site owner.",
        });
        return;
      }
    }

    next();
  } catch {
    response.status(500).json({
      id: uuidv4(),
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: "Invalid request.",
    });
    return;
  }
}

module.exports = {
  setConnectionMeta,
  validEmbedConfig,
  validEmbedConfigId,
  canRespond,
  canAccessHistory,
};
