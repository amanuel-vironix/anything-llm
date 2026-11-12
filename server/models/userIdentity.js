const prisma = require("../utils/prisma");

/**
 * Accounts at outside identity providers linked to users (Google sign-in).
 * Rows are created by `utils/auth/oidc.js` only, in the same transaction as
 * the user they belong to, and are removed with the user (cascade).
 */
const UserIdentity = {
  tablename: "user_identities",

  /**
   * @param {string} provider
   * @param {string} subject - the ID token's `sub`
   * @returns {Promise<import("@prisma/client").user_identities | null>}
   */
  find: async function (provider, subject) {
    try {
      return await prisma.user_identities.findUnique({
        where: {
          provider_subject: {
            provider: String(provider),
            subject: String(subject),
          },
        },
      });
    } catch (error) {
      console.error("FAILED TO FIND USER IDENTITY.", error.message);
      return null;
    }
  },

  /**
   * Records a successful sign-in: the time and the email the provider sent,
   * which may have changed since the identity was linked.
   */
  recordLogin: async function (id, email = null) {
    try {
      await prisma.user_identities.update({
        where: { id: Number(id) },
        data: { lastLoginAt: new Date(), email: email ? String(email) : null },
      });
    } catch (error) {
      console.error("FAILED TO RECORD IDENTITY LOGIN.", error.message);
    }
  },

  /**
   * Linked identities for the given users, for the admin Users page.
   * @param {number[]} userIds
   * @returns {Promise<Object<number, {provider: string, email: string|null, lastLoginAt: Date|null}[]>>}
   */
  forUsers: async function (userIds = []) {
    try {
      const rows = await prisma.user_identities.findMany({
        where: { user_id: { in: userIds.map(Number) } },
        select: {
          user_id: true,
          provider: true,
          email: true,
          lastLoginAt: true,
        },
      });
      const byUser = {};
      for (const { user_id, ...identity } of rows)
        (byUser[user_id] ||= []).push(identity);
      return byUser;
    } catch (error) {
      console.error("FAILED TO LIST USER IDENTITIES.", error.message);
      return {};
    }
  },
};

module.exports = { UserIdentity };
