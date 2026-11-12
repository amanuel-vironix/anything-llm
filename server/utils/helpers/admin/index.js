const { User } = require("../../../models/user");
const { ROLES } = require("../../middleware/multiUserProtected");

// When a user is updating or creating a user in multi-user, we need to check if they
// are allowed to do this and that the new or existing user will be at or below their permission level.
// the user executing this function should be an admin or manager.
function validRoleSelection(currentUser = {}, newUserParams = {}) {
  if (!newUserParams.hasOwnProperty("role"))
    return { valid: true, error: null }; // not updating role, so skip.
  if (currentUser.role === ROLES.admin) return { valid: true, error: null };
  if (currentUser.role === ROLES.manager) {
    const validRoles = [ROLES.manager, ROLES.default];
    if (!validRoles.includes(newUserParams.role))
      return { valid: false, error: "Invalid role selection for user." };
    return { valid: true, error: null };
  }
  return { valid: false, error: "Invalid condition for caller." };
}

// Early, friendly check that demoting or suspending an active admin leaves at
// least one other active admin. It is a read before the write, so it is not the
// guarantee: User.update repeats the check inside the write's transaction
// (SMF-13). This only gives the common case a clear message.
async function canModifyAdmin(userToModify, updates) {
  if (!userToModify) return { valid: false, error: "User not found." };
  const castUpdates = {};
  if (updates.hasOwnProperty("role")) castUpdates.role = updates.role;
  if (updates.hasOwnProperty("suspended"))
    castUpdates.suspended = User.castColumnValue(
      "suspended",
      updates.suspended
    );
  if (!User.removesActiveAdmin(userToModify, castUpdates))
    return { valid: true, error: null };

  const otherActiveAdmins = await User.count({
    role: ROLES.admin,
    suspended: 0,
    id: { not: Number(userToModify.id) },
  });
  if (otherActiveAdmins <= 0)
    return {
      valid: false,
      error: "No system admins will remain if you do this. Update failed.",
    };
  return { valid: true, error: null };
}

function validCanModify(currentUser, existingUser) {
  if (currentUser.role === ROLES.admin) return { valid: true, error: null };
  if (currentUser.role === ROLES.manager) {
    const validRoles = [ROLES.manager, ROLES.default];
    if (!validRoles.includes(existingUser.role))
      return { valid: false, error: "Cannot perform that action on user." };
    return { valid: true, error: null };
  }

  return { valid: false, error: "Invalid condition for caller." };
}

module.exports = {
  validCanModify,
  validRoleSelection,
  canModifyAdmin,
};
