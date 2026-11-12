const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const { MobileDevice } = require("../../models/mobileDevice");
const { handleMobileCommand } = require("./utils");
const { validDeviceToken, validRegistrationToken } = require("./middleware");
const { reqBody } = require("../../utils/http");
const { User } = require("../../models/user");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");

function mobileEndpoints(app) {
  if (!app) return;

  /**
   * Gets all the devices from the database.
   * @param {import("express").Request} request
   * @param {import("express").Response} response
   */
  app.get(
    "/mobile/devices",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const devices = await MobileDevice.where({}, null, null, {
          user: { select: { id: true, username: true } },
        });
        return response.status(200).json({ devices });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  /**
   * Updates the device status via an updates object.
   * @param {import("express").Request} request
   * @param {import("express").Response} response
   */
  app.post(
    "/mobile/update/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request);
        const updates = await MobileDevice.update(
          Number(request.params.id),
          body
        );
        if (updates.error)
          return response.status(400).json({ error: updates.error });
        return response.status(200).json({ updates });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  /**
   * Deletes a device from the database.
   * @param {import("express").Request} request
   * @param {import("express").Response} response
   */
  app.delete(
    "/mobile/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const device = await MobileDevice.get({
          id: Number(request.params.id),
        });
        if (!device)
          return response.status(404).json({ error: "Device not found" });
        await MobileDevice.delete(device.id);
        return response.status(200).json({ message: "Device deleted" });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  /**
   * Issues a pairing link. The device runs as the user it is paired for (F-05): an
   * admin pairs their own device, or another user's with `?userId=`. The device still
   * needs an admin's approval before it can be used.
   */
  app.get(
    "/mobile/connect-info",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        let pairFor = response.locals?.user ?? null;
        if (pairFor && request.query?.userId) {
          const target = await User.get({ id: Number(request.query.userId) });
          if (!target || target.suspended)
            return response
              .status(400)
              .json({ error: "That user can't be paired with a device." });
          pairFor = target;
        }
        return response.status(200).json({
          connectionUrl: MobileDevice.connectionURL(pairFor),
          pairedFor: pairFor
            ? { id: pairFor.id, username: pairFor.username }
            : null,
        });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  /**
   * Checks if the device auth token is valid
   * against approved devices.
   */
  app.get("/mobile/auth", [validDeviceToken], async (_, response) => {
    try {
      return response
        .status(200)
        .json({ success: true, message: "Device authenticated" });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  /**
   * Registers a new device (is open so that the mobile app can register itself)
   * Will create a new device in the database but requires approval by the user
   * before it can be used.
   * @param {import("express").Request} request
   * @param {import("express").Response} response
   */
  app.post(
    "/mobile/register",
    [validRegistrationToken],
    async (request, response) => {
      try {
        const body = reqBody(request);
        const result = await MobileDevice.create({
          deviceOs: body.deviceOs,
          deviceName: body.deviceName,
          userId: response.locals?.user?.id,
        });

        if (result.error)
          return response.status(400).json({ error: result.error });
        return response.status(200).json({
          token: result.device.token,
          platform: MobileDevice.platform,
        });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/mobile/send/:command",
    [validDeviceToken],
    async (request, response) => {
      try {
        return await handleMobileCommand(request, response);
      } catch (e) {
        console.error(e);
        if (response.headersSent) return response.end();
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { mobileEndpoints };
