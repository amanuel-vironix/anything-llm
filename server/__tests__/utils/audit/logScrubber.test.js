/* eslint-env jest */
// Plan section 3.4: application logs never carry secrets, and lines written
// during a request carry its id.
const { formatLogArgs } = require("../../../utils/logger");
const context = require("../../../utils/audit/context");

describe("log scrubber", () => {
  it.each([
    ["Authorization: Bearer abcdefghijklmnop123", "abcdefghijklmnop123"],
    ["key sk-proj-ABCDEF1234567890abcd", "sk-proj-ABCDEF1234567890abcd"],
    ["jwt eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl", "eyJhbGciOi.eyJzdWIiOiIx"],
    ['{"password":"hunter2hunter"}', "hunter2hunter"],
    ["OPEN_AI_KEY=sk-live-abcdefghijklmnop", "sk-live-abcdefghijklmnop"],
    ["db postgres://admin:s3cretpw@db.internal:5432/x", "s3cretpw"],
    [
      "google AIzaSyA1234567890abcdefghijklmnop",
      "AIzaSyA1234567890abcdefghijklmnop",
    ],
  ])("redacts %s", (line, secret) => {
    expect(formatLogArgs([line])).not.toContain(secret);
  });

  it("redacts secrets inside logged objects", () => {
    const out = formatLogArgs([
      "settings",
      { apiKey: "sk-abcdefghijklmnop12345" },
    ]);
    expect(out).not.toContain("sk-abcdefghijklmnop12345");
  });

  it("keeps ordinary text", () => {
    expect(formatLogArgs(["Workspace", "sales", "has", 3, "documents"])).toBe(
      "Workspace sales has 3 documents"
    );
  });

  it("prefixes the request id inside a request", () => {
    const ctx = context.newContext({ requestId: "abcdef1234567890" });
    const out = context.storage.run(ctx, () => formatLogArgs(["hello"]));
    expect(out).toBe("[req:abcdef12] hello");
  });
});
