const { Prisma } = require("@prisma/client");
const prisma = require("../utils/prisma");
const { EventLogs } = require("./eventLogs");

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} password
 * @property {string} pfpFilename
 * @property {string} role
 * @property {boolean} suspended
 * @property {number|null} dailyMessageLimit
 */

const User = {
  usernameRegex: new RegExp(/^[a-z][a-z0-9._@-]*$/),
  writable: [
    // Used for generic updates so we can validate keys in request body
    "username",
    "password",
    "pfpFilename",
    "role",
    "suspended",
    "dailyMessageLimit",
    "bio",
  ],
  validations: {
    /**
     * Unix-style username regex:
     * - Must start with a lowercase letter
     * - Can contain lowercase letters, digits, underscores, hyphens, @ signs, and periods
     * - 2-64 characters long
     */
    username: (newValue = "") => {
      try {
        const username = String(newValue);
        if (username.length > 64)
          throw new Error("Username cannot be longer than 64 characters");
        if (username.length < 2)
          throw new Error("Username must be at least 2 characters");
        if (!User.usernameRegex.test(username))
          throw new Error(
            "Username must start with a lowercase letter and only contain lowercase letters, numbers, underscores, hyphens, and periods"
          );
        return username;
      } catch (e) {
        throw new Error(e.message);
      }
    },
    role: (role = "default") => {
      const VALID_ROLES = ["default", "admin", "manager"];
      if (!VALID_ROLES.includes(role)) {
        throw new Error(
          `Invalid role. Allowed roles are: ${VALID_ROLES.join(", ")}`
        );
      }
      return String(role);
    },
    dailyMessageLimit: (dailyMessageLimit = null) => {
      if (dailyMessageLimit === null) return null;
      const limit = Number(dailyMessageLimit);
      if (isNaN(limit) || limit < 1) {
        throw new Error(
          "Daily message limit must be null or a number greater than or equal to 1"
        );
      }
      return limit;
    },
    bio: (bio = "") => {
      if (!bio || typeof bio !== "string") return "";
      if (bio.length > 1000)
        throw new Error("Bio cannot be longer than 1,000 characters");
      return String(bio);
    },
  },
  // validations for the above writable fields.
  castColumnValue: function (key, value) {
    switch (key) {
      case "suspended":
        return Number(Boolean(value));
      case "dailyMessageLimit":
        return value === null ? null : Number(value);
      default:
        return String(value);
    }
  },

  filterFields: function (user = {}) {
    const {
      password: _password,
      web_push_subscription_config: _web_push_subscription_config,
      ...rest
    } = user;
    return { ...rest };
  },
  lastAdminError: "No active system admins will remain if you do this.",

  /**
   * Whether applying `updates` to `user` could leave the instance with one
   * fewer active admin: the user is an active admin and the update demotes or
   * suspends them.
   * @param {{role: string, suspended: number}} user
   * @param {{role?: string, suspended?: number}} updates - already validated and cast
   * @returns {boolean}
   */
  removesActiveAdmin: function (user, updates = {}) {
    if (!user || user.role !== "admin" || Number(user.suspended) !== 0)
      return false;
    if (updates.hasOwnProperty("role") && updates.role !== "admin") return true;
    if (updates.hasOwnProperty("suspended") && Number(updates.suspended) !== 0)
      return true;
    return false;
  },

  /**
   * Runs `write` and the check that at least one active admin remains in one
   * transaction, and rolls the write back when none would. The write runs
   * first, so in SQLite it takes the write lock before the count is read and
   * two concurrent demotions cannot both pass on a stale count (SMF-13).
   * @template T
   * @param {(tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>} write
   * @returns {Promise<T>} the write's result; throws `lastAdminError` when refused.
   */
  _withActiveAdminGuard: async function (write) {
    return prisma.$transaction(async (tx) => {
      const result = await write(tx);
      const activeAdmins = await tx.users.count({
        where: { role: "admin", suspended: 0 },
      });
      if (activeAdmins < 1) throw new Error(this.lastAdminError);
      return result;
    });
  },

  _identifyErrorAndFormatMessage: function (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 is the unique constraint violation error code
      if (error.code === "P2002") {
        const target = error.meta?.target;
        return `A user with that ${target?.join(", ")} already exists`;
      }
    }
    return error.message;
  },

  create: async function ({
    username,
    password,
    role = "default",
    dailyMessageLimit = null,
    bio = "",
  }) {
    const { data, error } = this.prepareCreate({
      username,
      password,
      role,
      dailyMessageLimit,
      bio,
    });
    if (error) return { user: null, error };

    try {
      const user = await prisma.users.create({ data });
      return { user: this.filterFields(user), error: null };
    } catch (error) {
      console.error("FAILED TO CREATE USER.", error.message);
      return { user: null, error: this._identifyErrorAndFormatMessage(error) };
    }
  },

  /**
   * Validates new-user fields and hashes the password, without writing.
   * Callers that must create the user inside their own transaction (invite
   * claims, Google sign-in) pass `data` to `tx.users.create`.
   * @param {{username: string, password?: string, role?: string, dailyMessageLimit?: number|null, bio?: string}} params
   * @param {{unusablePassword?: boolean}} options - true for accounts that sign
   *   in only through an identity provider: the hash is of 32 random bytes
   *   nobody knows, and `password` is ignored.
   * @returns {{data: Object|null, error: string|null}}
   */
  prepareCreate: function (
    {
      username,
      password,
      role = "default",
      dailyMessageLimit = null,
      bio = "",
    },
    { unusablePassword = false } = {}
  ) {
    const bcrypt = require("bcryptjs");
    let hashedPassword;
    if (unusablePassword) {
      hashedPassword = bcrypt.hashSync(
        require("crypto").randomBytes(32).toString("hex"),
        10
      );
    } else {
      const passwordCheck = this.checkPasswordComplexity(password);
      if (!passwordCheck.checkedOK)
        return { data: null, error: passwordCheck.error };
      hashedPassword = bcrypt.hashSync(password, 10);
    }

    try {
      return {
        data: {
          // Validate username format (validation function handles all checks)
          username: this.validations.username(username),
          password: hashedPassword,
          role: this.validations.role(role),
          bio: this.validations.bio(bio),
          dailyMessageLimit:
            this.validations.dailyMessageLimit(dailyMessageLimit),
        },
        error: null,
      };
    } catch (error) {
      return { data: null, error: error.message };
    }
  },
  // Log the changes to a user object, but omit sensitive fields
  // that are not meant to be logged.
  loggedChanges: function (updates, prev = {}) {
    const changes = {};
    const sensitiveFields = ["password"];

    Object.keys(updates).forEach((key) => {
      if (!sensitiveFields.includes(key) && updates[key] !== prev[key]) {
        changes[key] = `${prev[key]} => ${updates[key]}`;
      }
    });

    return changes;
  },

  update: async function (userId, updates = {}) {
    try {
      if (!userId) throw new Error("No user id provided for update");
      const currentUser = await prisma.users.findUnique({
        where: { id: parseInt(userId) },
      });
      if (!currentUser) return { success: false, error: "User not found" };

      // We previously had more lenient username validation, but now with more strict validation
      // we dont want to break existing users by changing non-username fields.
      // If they are not explictly changing the username, do not attempt to validate it.
      if (updates.hasOwnProperty("username")) {
        if (updates.username === currentUser.username) delete updates.username;
      }

      // Removes non-writable fields for generic updates
      // and force-casts to the proper type;
      Object.entries(updates).forEach(([key, value]) => {
        if (this.writable.includes(key)) {
          if (this.validations.hasOwnProperty(key)) {
            updates[key] = this.validations[key](
              this.castColumnValue(key, value)
            );
          } else {
            updates[key] = this.castColumnValue(key, value);
          }
          return;
        }
        delete updates[key];
      });

      if (Object.keys(updates).length === 0)
        return { success: false, error: "No valid updates applied." };

      // Handle password specific updates
      if (updates.hasOwnProperty("password")) {
        const passwordCheck = this.checkPasswordComplexity(updates.password);
        if (!passwordCheck.checkedOK) {
          return { success: false, error: passwordCheck.error };
        }
        const bcrypt = require("bcryptjs");
        updates.password = bcrypt.hashSync(updates.password, 10);
      }

      const write = (client) =>
        client.users.update({
          where: { id: parseInt(userId) },
          data: updates,
        });
      const user = this.removesActiveAdmin(currentUser, updates)
        ? await this._withActiveAdminGuard(write)
        : await write(prisma);

      await EventLogs.logEvent(
        "user_updated",
        {
          username: user.username,
          changes: this.loggedChanges(updates, currentUser),
        },
        userId
      );
      return { success: true, error: null };
    } catch (error) {
      console.error("FAILED TO UPDATE USER.", error.message);
      return {
        success: false,
        error: this._identifyErrorAndFormatMessage(error),
      };
    }
  },

  /**
   * Explicit direct update of user object.
   * Only use this method when directly setting a key value
   * that takes no user input for the keys being modified.
   * @param {number} id - The id of the user to update.
   * @param {Object} data - The data to update the user with.
   * @returns {Promise<Object>} The updated user object.
   */
  _update: async function (id = null, data = {}) {
    if (!id) throw new Error("No user id provided for update");

    try {
      const user = await prisma.users.update({
        where: { id },
        data,
      });
      return { user, message: null };
    } catch (error) {
      console.error(error.message);
      return { user: null, message: error.message };
    }
  },

  /**
   * Get all users that match the given clause without filtering the fields.
   * Internal use only - do not use this method for user-input flows
   * @param {Object} clause - The clause to filter the users by.
   * @param {number|null} limit - The maximum number of users to return.
   * @returns {Promise<Array<User>>} The users that match the given clause.
   */
  _where: async function (clause = {}, limit = null) {
    try {
      const users = await prisma.users.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
      });
      return users;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  /**
   * Returns a user object based on the clause provided.
   * @param {Object} clause - The clause to use to find the user.
   * @returns {Promise<import("@prisma/client").users|null>} The user object or null if not found.
   */
  get: async function (clause = {}) {
    try {
      const user = await prisma.users.findFirst({ where: clause });
      return user ? this.filterFields({ ...user }) : null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },
  // Returns user object with all fields
  _get: async function (clause = {}) {
    try {
      const user = await prisma.users.findFirst({ where: clause });
      return user ? { ...user } : null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  count: async function (clause = {}) {
    try {
      const count = await prisma.users.count({ where: clause });
      return count;
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },

  /**
   * Deletes the users that match the given clause. Their workspace chats are
   * kept with no user attached instead of being deleted along with them.
   * Kept chats are excluded from history so they never mix into the context
   * of sessionless API, Telegram or memory extraction, which all match
   * chats with no user. They remain visible in workspace chats and exports.
   *
   * Refuses (returns false, deletes nothing) when the delete would leave no
   * active admin, unless `allowNoActiveAdmin` is set. Only the rollback of a
   * failed switch to multi-user mode, which deletes every user, sets it.
   * @param {Object} clause - The clause to filter the users to delete by.
   * @param {{allowNoActiveAdmin?: boolean}} options
   * @returns {Promise<boolean>} True if the users were deleted.
   */
  delete: async function (clause = {}, { allowNoActiveAdmin = false } = {}) {
    const { success } = await this.deleteWithReason(clause, {
      allowNoActiveAdmin,
    });
    return success;
  },

  /**
   * Same as `delete`, but says why a delete was refused.
   * @param {Object} clause
   * @param {{allowNoActiveAdmin?: boolean}} options
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  deleteWithReason: async function (
    clause = {},
    { allowNoActiveAdmin = false } = {}
  ) {
    try {
      const write = async (tx) => {
        await tx.workspace_chats.updateMany({
          where: { users: clause },
          data: { user_id: null, include: false },
        });
        await tx.users.deleteMany({ where: clause });
      };
      const removesActiveAdmin =
        !allowNoActiveAdmin &&
        (await prisma.users.count({
          where: { AND: [clause, { role: "admin", suspended: 0 }] },
        })) > 0;
      if (removesActiveAdmin) await this._withActiveAdminGuard(write);
      else await prisma.$transaction(write);
      return { success: true, error: null };
    } catch (error) {
      console.error(error.message);
      return { success: false, error: error.message };
    }
  },

  where: async function (clause = {}, limit = null) {
    try {
      const users = await prisma.users.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
      });
      return users.map((usr) => this.filterFields(usr));
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  checkPasswordComplexity: function (passwordInput = "") {
    const passwordComplexity = require("joi-password-complexity");
    // Can be set via ENV variable on boot. No frontend config at this time.
    // Docs: https://www.npmjs.com/package/joi-password-complexity
    const complexityOptions = {
      min: process.env.PASSWORDMINCHAR || 8,
      max: process.env.PASSWORDMAXCHAR || 250,
      lowerCase: process.env.PASSWORDLOWERCASE || 0,
      upperCase: process.env.PASSWORDUPPERCASE || 0,
      numeric: process.env.PASSWORDNUMERIC || 0,
      symbol: process.env.PASSWORDSYMBOL || 0,
      // reqCount should be equal to how many conditions you are testing for (1-4)
      requirementCount: process.env.PASSWORDREQUIREMENTS || 0,
    };

    const complexityCheck = passwordComplexity(
      complexityOptions,
      "password"
    ).validate(passwordInput);
    if (complexityCheck.hasOwnProperty("error")) {
      let myError = "";
      let prepend = "";
      for (let i = 0; i < complexityCheck.error.details.length; i++) {
        myError += prepend + complexityCheck.error.details[i].message;
        prepend = ", ";
      }
      return { checkedOK: false, error: myError };
    }

    return { checkedOK: true, error: "No error." };
  },

  /**
   * Check if a user can send a chat based on their daily message limit.
   * This limit is system wide and not per workspace and only applies to
   * multi-user mode AND non-admin users.
   * @param {User} user The user object record.
   * @returns {Promise<boolean>} True if the user can send a chat, false otherwise.
   */
  canSendChat: async function (user) {
    const { ROLES } = require("../utils/middleware/multiUserProtected");
    if (!user || user.dailyMessageLimit === null || user.role === ROLES.admin)
      return true;

    const { WorkspaceChats } = require("./workspaceChats");
    const currentChatCount = await WorkspaceChats.count({
      user_id: user.id,
      createdAt: {
        gte: new Date(new Date() - 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    return currentChatCount < user.dailyMessageLimit;
  },
};

module.exports = { User };
