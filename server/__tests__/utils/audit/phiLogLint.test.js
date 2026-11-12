/* eslint-env jest */
/**
 * Static PHI-in-logs check (PLAN-audit-logging-and-compliance.md section 5.4,
 * check K-16): no log call in server or collector code prints a request body,
 * a prompt, a chat message, document or page content, or memory text.
 *
 * Only the expressions passed to a log call are checked: string literal text
 * is ignored ("system prompt" in a message is fine; `${prompt}` is not).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const SCAN = ["server", "collector"];
const SKIP_DIRS = new Set([
  "node_modules",
  "__tests__",
  "storage",
  "public",
  "hotdir",
  "outputs",
  "swagger",
]);

// Identifiers that hold user content, as a variable or as a property
// (`c.content` was the F-41 leak).
const SENSITIVE = new RegExp(
  [
    /(^|[^.\w])(request\.body|req\.body|reqBody\(|prompt|userPrompt|rawText|pageContent|chatHistory|history|messages?|content|textContent|memory|memories|candidates?|finalMemories|completion|responseText|textResponse)\b/
      .source,
    /\.(body|prompt|content|pageContent|text|textResponse|reasoning|response)\b/
      .source,
  ].join("|")
);

// Log helpers that forward their own `message` parameter; the call sites that
// use them are what's checked. "file:line" of the forwarding line.
const LOG_HELPERS = new Set([
  "server/utils/agents/aibitat/utils/dedupe.js",
  "server/utils/vectorDbProviders/base.js",
  "collector/utils/extensions/Confluence/ConfluenceLoader/index.js",
]);

// Accepted findings, each with the reason. Keep this list short.
const ACCEPTED = {
  // MCP transport messages are protocol frames between the server and a
  // local MCP process, not user content. File owned by the access-policy
  // branch; revisit when it merges.
  "server/utils/MCP/hypervisor/index.js": "MCP transport protocol message",
  // The aibitat CLI plugin prints the conversation to a developer's terminal
  // when an agent runs from the command line; it is not loaded by the server's
  // agent sessions. Owned by the access-policy branch; revisit when it merges.
  "server/utils/agents/aibitat/plugins/cli.js":
    "terminal-only developer plugin, not used by the server",
};

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

/**
 * Removes string literal text, keeping `${...}` expressions of template
 * literals, and comments.
 */
function stripLiterals(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2);
      i = i === -1 ? src.length : i + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else if (c === "`") {
      i++;
      out += "`";
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") i += 2;
        else if (src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          i += 2;
          out += " ";
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth > 0) out += src[i];
            i++;
          }
          out += " ";
        } else i++;
      }
      i++;
      out += "`";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The text of each log call's arguments, with its line number. */
function logCalls(src) {
  const calls = [];
  const re =
    /(?:console\.(?:log|info|warn|error|debug)|(?:^|[^\w.])(?:this\.)?#?log)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    while (j < src.length && depth > 0) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") depth--;
      j++;
    }
    calls.push({
      args: src.slice(start, j - 1),
      line: src.slice(0, start).split("\n").length,
    });
  }
  return calls;
}

// `e.message`, `error.message` are error text; `x.length` is a count.
function withoutSafeUses(args) {
  return args
    .replace(/\b\w+\.message\b/g, "")
    .replace(/\b[\w.]+\.length\b/g, "");
}

function findings() {
  const out = [];
  for (const top of SCAN) {
    for (const file of walk(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file);
      if (LOG_HELPERS.has(rel) || ACCEPTED[rel]) continue;
      const stripped = stripLiterals(fs.readFileSync(file, "utf8"));
      for (const { args, line } of logCalls(stripped)) {
        const cleaned = withoutSafeUses(args);
        if (SENSITIVE.test(cleaned))
          out.push(`${rel}:~${line}: ${args.trim()}`);
      }
    }
  }
  return out;
}

describe("no PHI in log calls", () => {
  it("finds no log call that prints user content", () => {
    expect(findings()).toEqual([]);
  });

  it("catches a planted log of a request body and of a prompt", () => {
    const planted = stripLiterals(
      [
        'console.log("body", request.body);',
        "log(`asked ${prompt}`);",
        'console.error("prompt failed", e.message);',
        'log(`  [${c.confidence}] "${c.content}"`);',
        "log(`${candidates.length} candidates`);",
      ].join("\n")
    );
    const hits = logCalls(planted).filter(({ args }) =>
      SENSITIVE.test(withoutSafeUses(args))
    );
    expect(hits.map((h) => h.line)).toEqual([1, 2, 4]);
  });
});
