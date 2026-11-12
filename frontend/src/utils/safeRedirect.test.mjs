// Run with `yarn test:utils` (node's built-in test runner; no extra dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeRedirectPath } from "./safeRedirect.js";

const ORIGIN = "https://llm.example.com";
const FALLBACK = "/";

test("keeps a same-origin path with its query and hash", () => {
  assert.equal(
    safeRedirectPath("/workspace/abc?thread=1#end", FALLBACK, ORIGIN),
    "/workspace/abc?thread=1#end"
  );
});

for (const [name, value] of [
  ["an absolute URL to another site", "https://evil.example/phish"],
  ["a protocol-relative URL", "//evil.example/phish"],
  ["a backslash URL", "/\\evil.example/phish"],
  ["a javascript: URL", "javascript:alert(1)"],
  ["a path with an embedded tab", "/\t/evil.example"],
  ["a relative path without a leading slash", "evil.example"],
  ["an empty value", ""],
  ["a missing value", null],
]) {
  test(`falls back for ${name}`, () => {
    assert.equal(safeRedirectPath(value, FALLBACK, ORIGIN), FALLBACK);
  });
}
