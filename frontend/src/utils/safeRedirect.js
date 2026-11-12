/**
 * Returns `target` when it is a path on this site, otherwise `fallback`.
 *
 * Used for `redirectTo`-style query values, which an attacker controls: a
 * login link could otherwise send a freshly signed-in user to another site
 * (F-11). Accepted values start with a single "/" and resolve to the current
 * origin; full URLs, protocol-relative ("//evil.example"), backslash tricks
 * ("/\\evil.example") and "javascript:" values are refused.
 *
 * @param {string|null|undefined} target - the requested path
 * @param {string} fallback - where to go instead
 * @param {string} [origin] - the site's origin; defaults to window.location.origin
 * @returns {string} a same-origin path (pathname, search and hash)
 */
export function safeRedirectPath(target, fallback, origin) {
  if (typeof target !== "string" || !target.startsWith("/")) return fallback;
  // Browsers treat "\" as "/" in URLs, so "/\evil.example" is "//evil.example".
  if (target.startsWith("//") || target.includes("\\")) return fallback;
  // Control characters (tabs, newlines) are stripped by URL parsers and can
  // turn an innocent-looking value into a different URL.
  for (const char of target) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return fallback;
  }

  const base = origin ?? window.location.origin;
  try {
    const resolved = new URL(target, base);
    if (resolved.origin !== new URL(base).origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
