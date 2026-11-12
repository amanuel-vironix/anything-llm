/* eslint-env jest */
/**
 * Route coverage (PLAN-audit-logging-and-compliance.md section 5.1, check
 * K-03): every state-changing route records its catalogue actions or is
 * exempt with a reason. A new route with neither fails here.
 */
const fs = require("fs");
const path = require("path");
const { listRoutes, REGISTRARS } = require("../../helpers/routeInventory");
const {
  allDeclarations,
  pendingOwner,
} = require("../../../utils/audit/routes");
const { entryFor } = require("../../../utils/audit/catalogue");
const { LEGACY_EVENT_MAP } = require("../../../utils/audit/legacy");

const SERVER = path.resolve(__dirname, "../../..");
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE", "WS", "ALL"]);

jest.setTimeout(60_000);
let routes;
let declarations;
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  routes = listRoutes();
  declarations = allDeclarations();
});
afterAll(() => jest.restoreAllMocks());

const keyOf = (r) => `${r.method} ${r.path}`;
const sourceOf = (r) => r.handlers.map((h) => h.toString()).join("\n");
const fileText = (rel) => fs.readFileSync(path.join(SERVER, rel), "utf8");
const literal = (name) =>
  new RegExp(`["'\`]${name.replace(/\./g, "\\.")}["'\`]`);

function problemsFor(route, entry) {
  const problems = [];
  const key = keyOf(route);
  if (!entry) return [`${key} (${route.source}) is not declared`];

  // One of actions | legacy | exempt; `pending` comes with its planned actions.
  const kinds = ["actions", "legacy", "exempt", "pending"].filter(
    (k) => k in entry
  );
  const valid =
    kinds.length === 1
      ? kinds[0] !== "pending"
      : kinds.length === 2 &&
        kinds.includes("pending") &&
        kinds.includes("actions");
  if (!valid) problems.push(`${key}: invalid declaration kinds ${kinds}`);

  const haystack = [sourceOf(route), ...(entry.in || []).map(fileText)].join(
    "\n"
  );

  if (entry.exempt !== undefined) {
    if (typeof entry.exempt !== "string" || entry.exempt.length < 15)
      problems.push(`${key}: exemption needs a reason`);
  }
  if (entry.pending !== undefined) {
    if (pendingOwner(key, route.source) !== entry.pending)
      problems.push(
        `${key}: pending "${entry.pending}" is only allowed in files that branch is editing`
      );
    for (const action of entry.actions || [])
      if (!entryFor(action)) problems.push(`${key}: unknown action ${action}`);
  }
  if (entry.actions && entry.pending === undefined) {
    if (entry.actions.length === 0) problems.push(`${key}: no actions`);
    for (const action of entry.actions) {
      if (!entryFor(action)) problems.push(`${key}: unknown action ${action}`);
      else if (!literal(action).test(haystack))
        problems.push(
          `${key}: "${action}" is not recorded in the handler or its \`in\` files`
        );
    }
  }
  if (entry.legacy) {
    for (const event of entry.legacy) {
      if (!LEGACY_EVENT_MAP[event])
        problems.push(`${key}: legacy event ${event} has no mapping`);
      else if (!literal(event).test(haystack))
        problems.push(
          `${key}: legacy event "${event}" is not logged by the handler`
        );
    }
  }
  return problems;
}

describe("audit route coverage", () => {
  it("knows every registrar server/index.js mounts", () => {
    const index = fileText("index.js");
    const mounted = [...index.matchAll(/^(\w+)\((?:app, )?apiRouter\);/gm)].map(
      (m) => m[1]
    );
    const known = REGISTRARS.map(([, name]) => name);
    expect(mounted.filter((name) => !known.includes(name))).toEqual([]);
  });

  it("declares every state-changing route with recorded actions or a reason", () => {
    const problems = [];
    for (const route of routes) {
      if (!STATE_CHANGING.has(route.method) && !declarations[keyOf(route)])
        continue;
      problems.push(...problemsFor(route, declarations[keyOf(route)]));
    }
    expect(problems).toEqual([]);
  });

  it("has no declaration for a route that no longer exists", () => {
    const registered = new Set(routes.map(keyOf));
    expect(Object.keys(declarations).filter((k) => !registered.has(k))).toEqual(
      []
    );
  });

  it("reports how many routes still wait on another branch", () => {
    const pending = Object.values(declarations).filter((e) => e.pending);
    // Informational: the number drops to zero once AP and GS merge and the
    // pending routes are instrumented. Fails only if it grows past today's.
    expect(pending.length).toBeLessThanOrEqual(45);
  });
});
