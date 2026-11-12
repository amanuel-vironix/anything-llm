/**
 * What may go in an audit row or an application log line
 * (PLAN-audit-logging-and-compliance.md section 3.4).
 *
 * - `sanitizeMetadata` keeps only the catalogue's allowed keys for an action,
 *   bounds every value, and scrubs secrets out of strings.
 * - `scrubSecrets` redacts the value classes that must never be logged:
 *   bearer tokens, JWTs, provider API keys, private keys and
 *   `key=value` pairs whose key names a secret.
 * - `maskSecret` keeps the last 4 characters of a secret setting value.
 */
const crypto = require("crypto");

const MAX_STRING = 200;
const MAX_ARRAY = 50;
const MAX_DEPTH = 3;

// Setting and field names whose value is a secret.
const SECRET_NAME =
  /(pass(word)?|secret|token|api[_-]?key|apikey|private[_-]?key|credential|auth[_-]?code|recovery|session|cookie|signature|^key$|_key$|Key$)/i;

// Values that look like secrets wherever they appear.
const SECRET_PATTERNS = [
  // Authorization headers and bearer tokens
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  // JWTs
  [
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
    "[REDACTED_JWT]",
  ],
  // Provider keys: OpenAI/Anthropic (sk-...), Google (AIza...), GitHub, Slack, AWS
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_KEY]"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_KEY]"],
  [
    /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    "[REDACTED_KEY]",
  ],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[REDACTED_KEY]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_KEY]"],
  // Credentials in a URL: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
  // PEM private keys
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  ],
  // key=value or "key": "value" where the key names a secret
  [
    /(["']?)([A-Za-z_-]*(?:password|passwd|secret|token|api[_-]?key|apikey|authorization)[A-Za-z_-]*)\1(\s*[:=]\s*)(["']?)[^\s"',;&}]{3,}\4/gi,
    "$1$2$1$3$4[REDACTED]$4",
  ],
];

/**
 * @param {string} text
 * @returns {string}
 */
function scrubSecrets(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS)
    out = out.replace(pattern, replacement);
  return out;
}

/**
 * @param {string} name - a setting or field name
 * @returns {boolean}
 */
function isSecretName(name = "") {
  return SECRET_NAME.test(String(name));
}

/**
 * Masks a secret to its last 4 characters ("****abcd"); short values are
 * fully masked.
 * @param {any} value
 * @returns {string|null}
 */
function maskSecret(value) {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value);
  if (str.length <= 8) return "****";
  return `****${str.slice(-4)}`;
}

/**
 * sha256 of a value, hex, for metadata that must identify a secret without
 * storing it (an invite code, an OIDC subject).
 * @param {string} value
 * @returns {string}
 */
function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function boundValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number")
    return Number.isFinite(value) || typeof value === "boolean" ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const scrubbed = scrubSecrets(value);
    return scrubbed.length > MAX_STRING
      ? `${scrubbed.slice(0, MAX_STRING)}…`
      : scrubbed;
  }
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value))
    return value.slice(0, MAX_ARRAY).map((v) => boundValue(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, MAX_ARRAY)) {
      // A nested key that names a secret is masked, whatever the action.
      out[k] = isSecretName(k) ? maskSecret(v) : boundValue(v, depth + 1);
    }
    return out;
  }
  return null;
}

/**
 * Keeps only allowed keys, bounds values and scrubs secrets.
 * @param {Object} metadata
 * @param {string[]} allowed
 * @returns {{metadata: Object, dropped: string[]}}
 */
function sanitizeMetadata(metadata = {}, allowed = []) {
  const kept = {};
  const dropped = [];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return { metadata: kept, dropped };
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowed.includes(key)) {
      dropped.push(key);
      continue;
    }
    if (value === undefined) continue;
    kept[key] = boundValue(value);
  }
  return { metadata: kept, dropped };
}

module.exports = {
  sanitizeMetadata,
  scrubSecrets,
  maskSecret,
  hashValue,
  isSecretName,
  MAX_STRING,
};
