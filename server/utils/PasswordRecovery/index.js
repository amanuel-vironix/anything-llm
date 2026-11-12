const bcrypt = require("bcryptjs");
const { v4, validate } = require("uuid");
const { User } = require("../../models/user");
const {
  RecoveryCode,
  PasswordResetToken,
} = require("../../models/passwordRecovery");
const { dummyHashCompare } = require("../helpers/dummyHashCompare");
const prisma = require("../prisma");

async function generateRecoveryCodes(userId) {
  const newRecoveryCodes = [];
  const plainTextCodes = [];
  for (let i = 0; i < 4; i++) {
    const code = v4();
    const hashedCode = bcrypt.hashSync(code, 10);
    newRecoveryCodes.push({
      user_id: userId,
      code_hash: hashedCode,
    });
    plainTextCodes.push(code);
  }

  const { error } = await RecoveryCode.createMany(newRecoveryCodes);
  if (!!error) throw new Error(error);

  const { user: success } = await User._update(userId, {
    seen_recovery_codes: true,
  });
  if (!success) throw new Error("Failed to generate user recovery codes!");

  return plainTextCodes;
}

async function recoverAccount(username = "", recoveryCodes = []) {
  const uniqueRecoveryCodes = [
    ...new Set(
      recoveryCodes
        .map((code) => (typeof code === "string" ? code.trim() : ""))
        .filter((code) => validate(code))
    ),
  ].slice(0, 2);
  if (uniqueRecoveryCodes.length !== 2)
    return { success: false, error: "Invalid recovery codes." };

  // A user without 4 hashes has not logged out and back in since recovery codes were added.
  // Unknown users and users without codes run the same 4 comparisons a wrong first code costs
  // a real user, so the response time does not reveal whether the username exists.
  const user = await User.get({ username: String(username) });
  const allUserHashes = user ? await RecoveryCode.hashesForUser(user.id) : [];
  if (allUserHashes.length < 4) {
    dummyHashCompare(uniqueRecoveryCodes[0], 4);
    return { success: false, error: "Invalid recovery codes." };
  }

  const unmatchedHashes = [...allUserHashes];
  const validCodes = uniqueRecoveryCodes.every((code) => {
    const index = unmatchedHashes.findIndex((hash) =>
      bcrypt.compareSync(code, hash)
    );
    if (index === -1) return false;
    unmatchedHashes.splice(index, 1);
    return true;
  });
  if (!validCodes) return { success: false, error: "Invalid recovery codes." };

  const { passwordResetToken, error } = await PasswordResetToken.create(
    user.id
  );
  if (!!error) return { success: false, error };
  return { success: true, resetToken: passwordResetToken.token };
}

async function resetPassword(token, _newPassword = "", confirmPassword = "") {
  const newPassword = String(_newPassword).trim(); // No spaces in passwords
  if (!newPassword) throw new Error("Invalid password.");
  if (newPassword !== String(confirmPassword))
    throw new Error("Passwords do not match");

  const resetToken = await PasswordResetToken.findUnique({
    token: String(token),
  });
  if (!resetToken || resetToken.expiresAt < new Date()) {
    return { success: false, message: "Invalid reset token" };
  }

  // Check the new password before changing anything, so a rejected password
  // leaves the token, the recovery codes and seen_recovery_codes as they were
  // and the user can try again (SMF-15, F-10).
  const passwordCheck = User.checkPasswordComplexity(newPassword);
  if (!passwordCheck.checkedOK)
    return { success: false, message: passwordCheck.error };
  const passwordHash = bcrypt.hashSync(newPassword, 10);

  // Consume the token with a conditional delete and make every change in the
  // same transaction: two resets with one token cannot both succeed, and a
  // failure part-way leaves nothing half-applied.
  const userId = resetToken.user_id;
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.password_reset_tokens.deleteMany({
        where: { id: resetToken.id, expiresAt: { gte: new Date() } },
      });
      if (count !== 1) throw new Error("Invalid reset token");

      await tx.users.update({
        where: { id: userId },
        // New codes are provided on first new login.
        data: { password: passwordHash, seen_recovery_codes: false },
      });
      await tx.password_reset_tokens.deleteMany({ where: { user_id: userId } });
      await tx.recovery_codes.deleteMany({ where: { user_id: userId } });
    });
  } catch (error) {
    console.error("FAILED TO RESET PASSWORD.", error.message);
    return { success: false, message: "Invalid reset token" };
  }

  // The caller, POST /system/reset-password, records auth.password_reset
  // (success or failed) with the request context, so nothing is logged here.
  return { success: true, message: "Password reset successful" };
}

module.exports = {
  recoverAccount,
  resetPassword,
  generateRecoveryCodes,
};
