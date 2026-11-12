/* eslint-env jest */
const { checkClaims, usernameFor, readCookie } = require("../../../utils/auth/oidc");
const { User } = require("../../../models/user");

const ALLOWED = ["vironix.ai"];
const GOOD = {
  sub: "1",
  email: "jane@vironix.ai",
  email_verified: true,
  hd: "vironix.ai",
};

describe("checkClaims", () => {
  it("allows a verified vironix.ai Workspace account", () => {
    expect(checkClaims(GOOD, ALLOWED)).toBeNull();
  });

  it("compares domains without regard to case", () => {
    expect(
      checkClaims({ ...GOOD, email: "Jane@Vironix.AI", hd: "VIRONIX.ai" }, ALLOWED)
    ).toBeNull();
  });

  it.each([
    ["missing email_verified", { email_verified: undefined }, "email_unverified"],
    ["email_verified false", { email_verified: false }, "email_unverified"],
    ["a missing email", { email: undefined }, "domain_not_allowed"],
    ["an email without a domain", { email: "jane" }, "domain_not_allowed"],
    ["an email domain with a suffix", { email: "jane@vironix.ai.evil.com" }, "domain_not_allowed"],
    ["an email in a look-alike domain", { email: "jane@notvironix.ai" }, "domain_not_allowed"],
    ["two @ signs", { email: "jane@vironix.ai@evil.com" }, "domain_not_allowed"],
    ["a matching hd with an outside email", { email: "jane@gmail.com" }, "domain_not_allowed"],
    ["an outside hd with a vironix.ai email", { hd: "evil.com" }, "hd_not_allowed"],
    ["a non-string hd", { hd: ["vironix.ai"] }, "hd_not_allowed"],
  ])("refuses %s", (_name, change, reason) => {
    expect(checkClaims({ ...GOOD, ...change }, ALLOWED)).toBe(reason);
  });
});

describe("usernameFor", () => {
  it.each([
    ["jane@vironix.ai", 0, "jane@vironix.ai"],
    ["Jane.Doe@Vironix.ai", 0, "jane.doe@vironix.ai"],
    ["jane@vironix.ai", 1, "jane.2@vironix.ai"],
    ["9lives@vironix.ai", 0, "u9lives@vironix.ai"],
    ["j+tag@vironix.ai", 0, "j-tag@vironix.ai"],
  ])("makes %s (attempt %i) into %s", (email, attempt, expected) => {
    expect(usernameFor(email, attempt)).toBe(expected);
  });

  it("always produces a username the User model accepts", () => {
    const long = `${"a".repeat(80)}@vironix.ai`;
    for (const email of [long, "_x@vironix.ai", "ü@vironix.ai"])
      expect(() => User.validations.username(usernameFor(email))).not.toThrow();
  });
});

describe("readCookie", () => {
  it("finds a cookie among others and decodes it", () => {
    expect(readCookie("a=1; allm_oidc=x%2By; b=2", "allm_oidc")).toBe("x+y");
  });

  it("returns null when the cookie is absent", () => {
    expect(readCookie("a=1", "allm_oidc")).toBeNull();
    expect(readCookie(undefined, "allm_oidc")).toBeNull();
  });
});
