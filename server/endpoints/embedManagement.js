const { EmbedChats } = require("../models/embedChats");
const { EmbedConfig } = require("../models/embedConfig");
const { audit } = require("../utils/audit");
const { reqBody, userFromSession, toBoundedInt } = require("../utils/http");
const { validEmbedConfigId } = require("../utils/middleware/embedMiddleware");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  chatHistoryViewable,
} = require("../utils/middleware/chatHistoryViewable");

// validEmbedConfigId puts the embed in response.locals, which the audit
// context would read as an embed-widget visitor. These routes are admin
// actions, so name the admin as the actor.
const adminActor = (response) => ({
  type: "user",
  id: response.locals?.user?.id ?? null,
});

function embedManagementEndpoints(app) {
  if (!app) return;

  app.get(
    "/embeds",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_, response) => {
      try {
        const embeds = await EmbedConfig.whereWithWorkspace({}, null, {
          createdAt: "desc",
        });
        response.status(200).json({ embeds });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embeds/new",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const data = reqBody(request);
        const { embed, message: error } = await EmbedConfig.new(data, user?.id);
        if (embed) {
          if (
            !(await audit.recordOrFail(
              {
                action: "embed.created",
                actor: adminActor(response),
                targetType: "embed",
                targetId: embed.id,
                workspaceId: embed.workspace_id,
                metadata: { embedUuid: embed.uuid },
              },
              response
            ))
          )
            return;
        }
        response.status(200).json({ embed, error });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embed/update/:embedId",
    [validatedRequest, flexUserRoleValid([ROLES.admin]), validEmbedConfigId],
    async (request, response) => {
      try {
        const { embedId } = request.params;
        const updates = reqBody(request);
        const { success, error } = await EmbedConfig.update(embedId, updates);
        if (
          !(await audit.recordOrFail(
            {
              action: "embed.updated",
              actor: adminActor(response),
              outcome: success === false ? "failed" : "success",
              reason: success === false ? "update_failed" : undefined,
              targetType: "embed",
              targetId: embedId,
              metadata: {
                embedUuid: response.locals.embedConfig?.uuid,
                changedFields: Object.keys(updates || {}).filter((key) =>
                  EmbedConfig.writable.includes(key)
                ),
              },
            },
            response
          ))
        )
          return;
        response.status(200).json({ success, error });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/embed/:embedId",
    [validatedRequest, flexUserRoleValid([ROLES.admin]), validEmbedConfigId],
    async (request, response) => {
      try {
        const { embedId } = request.params;
        await EmbedConfig.delete({ id: Number(embedId) });
        if (
          !(await audit.recordOrFail(
            {
              action: "embed.deleted",
              actor: adminActor(response),
              targetType: "embed",
              targetId: embedId,
              metadata: { embedUuid: response.locals.embedConfig?.uuid },
            },
            response
          ))
        )
          return;
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embed/chats",
    [chatHistoryViewable, validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request);
        const offset = toBoundedInt(body.offset, 0, { min: 0 });
        const limit = toBoundedInt(body.limit, 20, { min: 1 });
        const embedChats = await EmbedChats.whereWithEmbedAndWorkspace(
          {},
          limit,
          { id: "desc" },
          offset * limit
        );
        const totalChats = await EmbedChats.count();
        const hasPages = totalChats > (offset + 1) * limit;
        // Embed chats belong to widget visitors; the admin reading them is
        // recorded before any of it is returned.
        if (
          !(await audit.recordOrFail(
            {
              action: "chat.viewed_other_user",
              actor: adminActor(response),
              targetType: "embed_chats",
              metadata: { count: embedChats.length },
            },
            response
          ))
        )
          return;
        response.status(200).json({ chats: embedChats, hasPages, totalChats });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/embed/chats/:chatId",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { chatId } = request.params;
        const chat = await EmbedChats.get({ id: Number(chatId) });
        const embed = chat
          ? await EmbedConfig.get({ id: Number(chat.embed_id) })
          : null;
        const deleted = await EmbedChats.delete({ id: Number(chatId) });
        if (
          !(await audit.recordOrFail(
            {
              action: "embed.chats_deleted",
              actor: adminActor(response),
              outcome: deleted ? "success" : "failed",
              reason: deleted ? undefined : "delete_failed",
              targetType: "embed_chat",
              targetId: chatId,
              metadata: { embedUuid: embed?.uuid, count: chat ? 1 : 0 },
            },
            response
          ))
        )
          return;
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { embedManagementEndpoints };
