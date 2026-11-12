const { v4: uuidv4 } = require("uuid");
const { reqBody, multiUserMode } = require("../../utils/http");
const { Telemetry } = require("../../models/telemetry");
const { streamChatWithForEmbed } = require("../../utils/chats/embed");
const { EmbedChats } = require("../../models/embedChats");
const { audit } = require("../../utils/audit");
const { hashValue } = require("../../utils/audit/sanitize");
const {
  validEmbedConfig,
  canRespond,
  canAccessHistory,
  setConnectionMeta,
} = require("../../utils/middleware/embedMiddleware");
const {
  convertToChatHistory,
  writeResponseChunk,
} = require("../../utils/helpers/chat/responses");

function embeddedEndpoints(app) {
  if (!app) return;

  app.post(
    "/embed/:embedId/stream-chat",
    [validEmbedConfig, setConnectionMeta, canRespond],
    async (request, response) => {
      try {
        const embed = response.locals.embedConfig;
        const {
          sessionId,
          message,
          // optional keys for override of defaults if enabled.
          prompt = null,
          model = null,
          temperature = null,
          username = null,
        } = reqBody(request);

        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();

        // The visitor's session id and message are never stored in the audit
        // row: only a hash of the session and the message length.
        await audit.record(
          {
            action: "embed.chat",
            targetType: "embed",
            targetId: embed.id,
            workspaceId: embed.workspace_id,
            metadata: {
              embedUuid: embed.uuid,
              sessionHash: hashValue(sessionId),
              origin: request.headers?.origin,
              messageLength: typeof message === "string" ? message.length : 0,
            },
          },
          { response }
        );

        await streamChatWithForEmbed(response, embed, message, sessionId, {
          promptOverride: prompt,
          modelOverride: model,
          temperatureOverride: temperature,
          username,
        });
        await Telemetry.sendTelemetry("embed_sent_chat", {
          multiUserMode: multiUserMode(response),
          LLMSelection: process.env.LLM_PROVIDER || "openai",
          Embedder: process.env.EMBEDDING_ENGINE || "inherit",
          VectorDbSelection: process.env.VECTOR_DB || "lancedb",
        });
        response.end();
      } catch (e) {
        console.error(e);
        writeResponseChunk(response, {
          id: uuidv4(),
          type: "abort",
          sources: [],
          textResponse: null,
          close: true,
          error: e.message,
        });
        response.end();
      }
    }
  );

  app.get(
    "/embed/:embedId/:sessionId",
    [validEmbedConfig, canAccessHistory],
    async (request, response) => {
      try {
        const { sessionId } = request.params;
        const embed = response.locals.embedConfig;
        const history = await EmbedChats.forEmbedByUser(
          embed.id,
          sessionId,
          null,
          null,
          true
        );

        response.status(200).json({ history: convertToChatHistory(history) });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/embed/:embedId/:sessionId",
    [validEmbedConfig, canAccessHistory],
    async (request, response) => {
      try {
        const { sessionId } = request.params;
        const embed = response.locals.embedConfig;

        await EmbedChats.markHistoryInvalid(embed.id, sessionId);
        if (
          !(await audit.recordOrFail(
            {
              action: "embed.chats_deleted",
              targetType: "embed",
              targetId: embed.id,
              workspaceId: embed.workspace_id,
              metadata: { embedUuid: embed.uuid },
            },
            response
          ))
        )
          return;
        response.status(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { embeddedEndpoints };
