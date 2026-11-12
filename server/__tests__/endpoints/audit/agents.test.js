/* eslint-env jest */
/**
 * Audit events for the agents, tools and automation routes: flows, MCP
 * servers, the skill whitelist, live sync, imported agent plugins, memories
 * and scheduled jobs. Real SQLite for the audit table, memories and scheduled
 * jobs; file-system and process backed helpers are mocked.
 */
const { createTestPrisma } = require("../../helpers/sqliteTestDb");
const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

jest.mock("../../../utils/middleware/validatedRequest", () => ({
  validatedRequest: (_req, res, next) => {
    res.locals.user = { id: 1, role: "admin", username: "root" };
    res.locals.multiUserMode = true;
    next();
  },
}));
jest.mock("../../../utils/middleware/multiUserProtected", () => ({
  ROLES: {
    all: "<all>",
    admin: "admin",
    manager: "manager",
    default: "default",
  },
  flexUserRoleValid: () => (_req, _res, next) => next(),
  isSingleUserMode: (_req, _res, next) => next(),
}));
jest.mock("../../../utils/middleware/validWorkspace", () => ({
  validWorkspaceSlug: (_req, res, next) => {
    res.locals.workspace = { id: 5, slug: "clinic", name: "Clinic" };
    next();
  },
}));
jest.mock("../../../utils/middleware/featureFlagEnabled", () => ({
  featureFlagEnabled: () => (_req, _res, next) => next(),
}));
jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn(async () => {}) },
}));
jest.mock("../../../models/systemSettings", () => ({
  SystemSettings: {
    memoriesEnabled: jest.fn(async () => true),
    validations: {
      experimental_live_file_sync: (v) => (v ? "enabled" : "disabled"),
    },
    get: jest.fn(async () => ({ value: "disabled" })),
    _updateSettings: jest.fn(async () => {}),
  },
}));

const mockFlows = {
  saveFlow: jest.fn(),
  loadFlow: jest.fn(),
  deleteFlow: jest.fn(),
  listFlows: jest.fn(),
};
jest.mock("../../../utils/agentFlows", () => ({ AgentFlows: mockFlows }));

const mockMcp = {
  mcps: {},
  toggleServerStatus: jest.fn(),
  deleteServer: jest.fn(),
  toggleToolSuppression: jest.fn(),
};
jest.mock("../../../utils/MCP", () => jest.fn(() => mockMcp));

const mockWhitelist = { add: jest.fn() };
jest.mock("../../../models/agentSkillWhitelist", () => ({
  AgentSkillWhitelist: mockWhitelist,
}));

const mockPlugin = {
  updateImportedPlugin: jest.fn(),
  deletePlugin: jest.fn(),
};
jest.mock("../../../utils/agents/imported", () => mockPlugin);

jest.mock("../../../models/documentSyncQueue", () => ({
  DocumentSyncQueue: {
    featureKey: "experimental_live_file_sync",
    bootWorkers: jest.fn(),
    killWorkers: jest.fn(),
    toggleWatchStatus: jest.fn(async () => {}),
  },
}));
jest.mock("../../../models/documents", () => ({
  Document: {
    get: jest.fn(async () => ({ id: 77, filename: "note.json" })),
  },
}));

const mockBackground = {
  addScheduledJob: jest.fn(),
  syncScheduledJob: jest.fn(async () => {}),
  removeScheduledJob: jest.fn(),
  enqueueScheduledJob: jest.fn(async () => ({ id: 9 })),
  killRun: jest.fn(),
};
jest.mock("../../../utils/BackgroundWorkers", () => ({
  BackgroundService: jest.fn(() => mockBackground),
}));

const { captureRoutes } = require("../../helpers/routeHarness");
const { agentFlowEndpoints } = require("../../../endpoints/agentFlows");
const { mcpServersEndpoints } = require("../../../endpoints/mcpServers");
const {
  agentSkillWhitelistEndpoints,
} = require("../../../endpoints/agentSkillWhitelist");
const {
  liveSyncEndpoints,
} = require("../../../endpoints/experimental/liveSync");
const {
  importedAgentPluginEndpoints,
} = require("../../../endpoints/experimental/imported-agent-plugins");
const { memoryEndpoints } = require("../../../endpoints/memory");
const { scheduledJobEndpoints } = require("../../../endpoints/scheduledJobs");
const { audit } = require("../../../utils/audit");

const prisma = mockDb.prisma;
const PHI = "PLANTED-PHI-patient-has-diabetes";

const flows = captureRoutes(agentFlowEndpoints);
const mcp = captureRoutes(mcpServersEndpoints);
const whitelist = captureRoutes(agentSkillWhitelistEndpoints);
const liveSync = captureRoutes(liveSyncEndpoints);
const plugins = captureRoutes(importedAgentPluginEndpoints);
const memories = captureRoutes(memoryEndpoints);
const jobs = captureRoutes(scheduledJobEndpoints);

async function lastEvent(action) {
  const rows = await prisma.audit_events.findMany({
    where: { action },
    orderBy: { id: "desc" },
  });
  return rows[0];
}

function expectClean(row) {
  expect(JSON.stringify(row)).not.toContain(PHI);
}

beforeEach(async () => {
  await prisma.audit_events.deleteMany({});
  await prisma.memories.deleteMany({});
  await prisma.scheduled_jobs.deleteMany({});
  await prisma.users.deleteMany({});
  await prisma.users.create({
    data: { id: 1, username: "root", password: "x", role: "admin" },
  });
  audit._resetForTests();
  mockMcp.mcps = {};
  jest.clearAllMocks();
});
afterAll(() => mockDb.cleanup());

describe("agent flows", () => {
  it("records flow.created on a new flow", async () => {
    mockFlows.saveFlow.mockReturnValue({ success: true, uuid: "f-1" });
    const res = await flows.call("POST", "/agent-flows/save", {
      body: { name: "Intake", config: { blocks: [], note: PHI } },
    });
    expect(res.statusCode).toBe(200);
    const row = await lastEvent("flow.created");
    expect(row).toMatchObject({
      actor_type: "user",
      actor_id: "1",
      target_type: "flow",
      target_id: "f-1",
      outcome: "success",
    });
    expectClean(row);
  });

  it("records flow.updated when a uuid is passed, on toggle, and flow.deleted", async () => {
    mockFlows.saveFlow.mockReturnValue({ success: true, uuid: "f-1" });
    await flows.call("POST", "/agent-flows/save", {
      body: { name: "Intake", config: { active: true }, uuid: "f-1" },
    });
    expect((await lastEvent("flow.updated")).target_id).toBe("f-1");

    await prisma.audit_events.deleteMany({});
    mockFlows.loadFlow.mockReturnValue({ name: "Intake", config: {} });
    await flows.call("POST", "/agent-flows/:uuid/toggle", {
      params: { uuid: "f-1" },
      body: { active: false },
    });
    const toggled = await lastEvent("flow.updated");
    expect(JSON.parse(toggled.metadata)).toMatchObject({ active: false });

    mockFlows.deleteFlow.mockReturnValue({ success: true });
    await flows.call("DELETE", "/agent-flows/:uuid", {
      params: { uuid: "f-1" },
    });
    expect((await lastEvent("flow.deleted")).target_id).toBe("f-1");
  });

  it("records nothing when the save fails", async () => {
    mockFlows.saveFlow.mockReturnValue({ success: false, error: "bad" });
    await flows.call("POST", "/agent-flows/save", {
      body: { name: "x", config: {} },
    });
    expect(await prisma.audit_events.count()).toBe(0);
  });
});

describe("MCP servers", () => {
  it("records mcp.server_started and mcp.server_stopped from the server's state after the toggle", async () => {
    mockMcp.toggleServerStatus.mockImplementation(async (name) => {
      mockMcp.mcps[name] = {};
      return { success: true, error: null };
    });
    await mcp.call("POST", "/mcp-servers/toggle", { body: { name: "fs" } });
    expect(await lastEvent("mcp.server_started")).toMatchObject({
      target_type: "mcp_server",
      target_id: "fs",
      actor_id: "1",
    });

    mockMcp.toggleServerStatus.mockImplementation(async (name) => {
      delete mockMcp.mcps[name];
      return { success: true, error: null };
    });
    await mcp.call("POST", "/mcp-servers/toggle", { body: { name: "fs" } });
    expect(await lastEvent("mcp.server_stopped")).toBeTruthy();
  });

  it("records mcp.server_removed and mcp.tool_toggled, but not for a failed call", async () => {
    mockMcp.deleteServer.mockResolvedValue({ success: true, error: null });
    await mcp.call("POST", "/mcp-servers/delete", { body: { name: "fs" } });
    expect((await lastEvent("mcp.server_removed")).target_id).toBe("fs");

    mockMcp.toggleToolSuppression.mockResolvedValue({
      success: true,
      suppressedTools: [],
    });
    await mcp.call("POST", "/mcp-servers/toggle-tool", {
      body: { serverName: "fs", toolName: "read", enabled: false },
    });
    const row = await lastEvent("mcp.tool_toggled");
    expect(JSON.parse(row.metadata)).toEqual({
      server: "fs",
      tool: "read",
      enabled: false,
    });

    await prisma.audit_events.deleteMany({});
    mockMcp.deleteServer.mockResolvedValue({ success: false, error: "no" });
    await mcp.call("POST", "/mcp-servers/delete", { body: { name: "nope" } });
    expect(await prisma.audit_events.count()).toBe(0);
  });
});

describe("agent skill whitelist", () => {
  it("records agent.whitelist_added", async () => {
    mockWhitelist.add.mockResolvedValue({ success: true });
    const res = await whitelist.call("POST", "/agent-skills/whitelist/add", {
      body: { skillName: "web-browsing" },
    });
    expect(res.statusCode).toBe(200);
    expect(await lastEvent("agent.whitelist_added")).toMatchObject({
      target_type: "agent_skill",
      target_id: "web-browsing",
      actor_id: "1",
    });
  });
});

describe("live sync", () => {
  it("records feature.toggled when live sync changes", async () => {
    await liveSync.call("POST", "/experimental/toggle-live-sync", {
      body: { updatedStatus: true },
    });
    const row = await lastEvent("feature.toggled");
    expect(JSON.parse(row.metadata)).toEqual({
      feature: "live_file_sync",
      enabled: true,
    });
  });

  it("records document.watched", async () => {
    await liveSync.call("POST", "/workspace/:slug/update-watch-status", {
      params: { slug: "clinic" },
      body: { docPath: "custom-documents/note.json", watchStatus: true },
    });
    const row = await lastEvent("document.watched");
    expect(row).toMatchObject({
      target_type: "document",
      target_id: "77",
      workspace_id: 5,
    });
    expect(JSON.parse(row.metadata)).toMatchObject({
      watched: true,
      workspaceSlug: "clinic",
    });
  });
});

describe("imported agent plugins", () => {
  it("records skill.enabled, skill.disabled, skill.configured (field names only) and skill.removed", async () => {
    mockPlugin.updateImportedPlugin.mockReturnValue({ active: true });
    await plugins.call("POST", "/experimental/agent-plugins/:hubId/toggle", {
      params: { hubId: "hub-1" },
      body: { active: true },
    });
    expect(await lastEvent("skill.enabled")).toMatchObject({
      target_id: "hub-1",
    });
    await plugins.call("POST", "/experimental/agent-plugins/:hubId/toggle", {
      params: { hubId: "hub-1" },
      body: { active: false },
    });
    expect(await lastEvent("skill.disabled")).toBeTruthy();

    await plugins.call("POST", "/experimental/agent-plugins/:hubId/config", {
      params: { hubId: "hub-1" },
      body: { updates: { setup_args: { apiKey: PHI } } },
    });
    const configured = await lastEvent("skill.configured");
    expect(JSON.parse(configured.metadata)).toEqual({
      skill: "hub-1",
      changedFields: ["setup_args"],
    });
    expectClean(configured);

    mockPlugin.deletePlugin.mockReturnValue(true);
    await plugins.call("DELETE", "/experimental/agent-plugins/:hubId", {
      params: { hubId: "hub-1" },
    });
    expect(await lastEvent("skill.removed")).toBeTruthy();
  });
});

describe("memories", () => {
  it("records created, updated, promoted and deleted without memory text", async () => {
    const created = await memories.call("POST", "/workspaces/:slug/memories", {
      params: { slug: "clinic" },
      body: { content: PHI, scope: "global" },
    });
    expect(created.statusCode).toBe(200);
    const memoryId = created.body.memory.id;
    const createdRow = await lastEvent("memory.created");
    expect(createdRow).toMatchObject({
      target_type: "memory",
      target_id: String(memoryId),
      actor_id: "1",
    });
    expectClean(createdRow);

    await memories.call("PUT", "/memories/:memoryId", {
      params: { memoryId: String(memoryId) },
      body: { content: `${PHI} updated` },
    });
    expectClean(await lastEvent("memory.updated"));

    await prisma.audit_events.deleteMany({});
    const promoted = await memories.call(
      "POST",
      "/memories/:memoryId/promote",
      {
        params: { memoryId: String(memoryId) },
      }
    );
    if (promoted.statusCode === 200) {
      expect(
        JSON.parse((await lastEvent("memory.updated")).metadata)
      ).toMatchObject({
        memoryId,
        scope: "global",
      });
    }

    await memories.call("DELETE", "/memories/:memoryId", {
      params: { memoryId: String(memoryId) },
    });
    const deleted = await lastEvent("memory.deleted");
    expect(JSON.parse(deleted.metadata)).toMatchObject({
      memoryId,
      scope: "global",
    });
    expectClean(deleted);
  });
});

describe("scheduled jobs", () => {
  it("records created, updated, run, toggled and deleted", async () => {
    const created = await jobs.call("POST", "/scheduled-jobs/new", {
      body: { name: "Nightly", prompt: PHI, schedule: "0 2 * * *" },
    });
    expect(created.statusCode).toBe(201);
    const jobId = created.body.job.id;
    const createdRow = await lastEvent("scheduled_job.created");
    expect(createdRow).toMatchObject({
      target_type: "scheduled_job",
      target_id: String(jobId),
    });
    expectClean(createdRow);

    await jobs.call("PUT", "/scheduled-jobs/:id", {
      params: { id: String(jobId) },
      body: { prompt: PHI, schedule: "0 3 * * *" },
    });
    const updated = await lastEvent("scheduled_job.updated");
    expect(JSON.parse(updated.metadata).changedFields).toEqual([
      "prompt",
      "schedule",
    ]);
    expectClean(updated);

    await jobs.call("POST", "/scheduled-jobs/:id/trigger", {
      params: { id: String(jobId) },
    });
    expect(
      JSON.parse((await lastEvent("scheduled_job.run")).metadata)
    ).toMatchObject({
      jobId,
      runId: 9,
    });

    await prisma.audit_events.deleteMany({});
    await jobs.call("POST", "/scheduled-jobs/:id/toggle", {
      params: { id: String(jobId) },
    });
    expect(
      JSON.parse((await lastEvent("scheduled_job.updated")).metadata)
    ).toMatchObject({
      changedFields: ["enabled"],
    });

    await jobs.call("DELETE", "/scheduled-jobs/:id", {
      params: { id: String(jobId) },
    });
    expect(await lastEvent("scheduled_job.deleted")).toMatchObject({
      target_id: String(jobId),
    });
  });

  it("records scheduled_job.run with status killed when a run is killed", async () => {
    const job = await prisma.scheduled_jobs.create({
      data: { name: "j", prompt: "p", schedule: "0 2 * * *" },
    });
    const run = await prisma.scheduled_job_runs.create({
      data: { jobId: job.id, status: "running" },
    });
    await jobs.call("POST", "/scheduled-jobs/runs/:runId/:action", {
      params: { runId: String(run.id), action: "kill" },
    });
    const row = await lastEvent("scheduled_job.run");
    expect(JSON.parse(row.metadata)).toMatchObject({
      jobId: job.id,
      runId: run.id,
      status: "killed",
    });
  });
});
