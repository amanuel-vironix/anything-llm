const { SystemSettings } = require("../models/systemSettings");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { reqBody } = require("../utils/http");
const { CommunityHub } = require("../models/communityHub");
const {
  communityHubDownloadsEnabled,
  communityHubItem,
} = require("../utils/middleware/communityHubDownloadsEnabled");
const { audit } = require("../utils/audit");
const { Telemetry } = require("../models/telemetry");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");

function communityHubEndpoints(app) {
  if (!app) return;

  app.get(
    "/community-hub/settings",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_, response) => {
      try {
        const { connectionKey } = await SystemSettings.hubSettings();
        response.status(200).json({ success: true, connectionKey });
      } catch (error) {
        console.error(error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/community-hub/settings",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const data = reqBody(request);
        const result = await SystemSettings.updateSettings(data);
        if (result.error) throw new Error(result.error);
        // The connection key itself is never recorded, only that it was saved.
        if (data?.hub_api_key !== undefined) {
          await audit.record(
            { action: "community_hub.connected", targetType: "community_hub" },
            { response }
          );
          if (
            !(await audit.recordOrFail(
              {
                action: "settings.changed",
                targetType: "system_settings",
                metadata: { key: "hub_api_key", source: "community_hub" },
              },
              response
            ))
          )
            return;
        }
        response.status(200).json({ success: true, error: null });
      } catch (error) {
        console.error(error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.get(
    "/community-hub/explore",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_, response) => {
      try {
        const exploreItems = await CommunityHub.fetchExploreItems();
        response.status(200).json({ success: true, result: exploreItems });
      } catch (error) {
        console.error(error);
        response.status(500).json({
          success: false,
          result: null,
          error: error.message,
        });
      }
    }
  );

  app.post(
    "/community-hub/item",
    [validatedRequest, flexUserRoleValid([ROLES.admin]), communityHubItem],
    async (_request, response) => {
      try {
        response.status(200).json({
          success: true,
          item: response.locals.bundleItem,
          error: null,
        });
      } catch (error) {
        console.error(error);
        response.status(500).json({
          success: false,
          item: null,
          error: error.message,
        });
      }
    }
  );

  /**
   * Apply an item to the AnythingLLM instance. Used for simple items like slash commands and system prompts.
   */
  app.post(
    "/community-hub/apply",
    [validatedRequest, flexUserRoleValid([ROLES.admin]), communityHubItem],
    async (request, response) => {
      try {
        const { options = {} } = reqBody(request);
        const item = response.locals.bundleItem;
        const { error: applyError } = await CommunityHub.applyItem(item, {
          ...options,
          currentUser: response.locals?.user,
        });
        if (applyError) throw new Error(applyError);

        await Telemetry.sendTelemetry("community_hub_import", {
          itemType: response.locals.bundleItem.itemType,
          visibility: response.locals.bundleItem.visibility,
        });
        if (
          !(await audit.recordOrFail(
            {
              action: "skill.installed",
              targetType: "community_hub_item",
              targetId: response.locals.bundleItem.id,
              metadata: {
                kind: response.locals.bundleItem.itemType,
                hubId: response.locals.bundleItem.id,
              },
            },
            response
          ))
        )
          return;

        response.status(200).json({ success: true, error: null });
      } catch (error) {
        console.error(error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  /**
   * Import a bundle item to the AnythingLLM instance by downloading the zip file and importing it.
   * or whatever the item type requires. This is not used if the item is a simple text responses like
   * slash commands or system prompts.
   */
  app.post(
    "/community-hub/import",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin]),
      communityHubItem,
      communityHubDownloadsEnabled,
    ],
    async (_, response) => {
      try {
        const { error: importError } = await CommunityHub.importBundleItem({
          url: response.locals.bundleUrl,
          item: response.locals.bundleItem,
        });
        if (importError) throw new Error(importError);

        await Telemetry.sendTelemetry("community_hub_import", {
          itemType: response.locals.bundleItem.itemType,
          visibility: response.locals.bundleItem.visibility,
        });
        if (
          !(await audit.recordOrFail(
            {
              action: "skill.installed",
              targetType: "community_hub_item",
              targetId: response.locals.bundleItem.id,
              metadata: {
                kind: response.locals.bundleItem.itemType,
                hubId: response.locals.bundleItem.id,
              },
            },
            response
          ))
        )
          return;

        response.status(200).json({ success: true, error: null });
      } catch (error) {
        console.error(error);
        response.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );

  app.get(
    "/community-hub/items",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_, response) => {
      try {
        const { connectionKey } = await SystemSettings.hubSettings();
        const items = await CommunityHub.fetchUserItems(connectionKey);
        response.status(200).json({ success: true, ...items });
      } catch (error) {
        console.error(error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/community-hub/:communityHubItemType/create",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { communityHubItemType } = request.params;
        const { connectionKey } = await SystemSettings.hubSettings();
        if (!connectionKey)
          throw new Error("Community Hub connection key not found");

        const data = reqBody(request);
        const { success, error, itemId } = await CommunityHub.createStaticItem(
          communityHubItemType,
          data,
          connectionKey
        );
        if (!success) throw new Error(error);

        await audit.record(
          {
            action: "community_hub.published",
            targetType: "community_hub_item",
            targetId: itemId,
            metadata: {
              itemType: communityHubItemType,
              visibility: data?.visibility,
            },
          },
          { response }
        );
        response
          .status(200)
          .json({ success: true, error: null, item: { id: itemId } });
      } catch (error) {
        console.error(error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );
}

module.exports = { communityHubEndpoints };
