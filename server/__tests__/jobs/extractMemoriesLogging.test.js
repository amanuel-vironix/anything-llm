/* eslint-env jest */
/**
 * F-41: the memory extraction job must not write memory candidates, final
 * memories, reasoning or raw model output to the worker log. It records one
 * memory.extracted audit event (counts only) per processed group.
 */
const PHI_CANDIDATE = "PLANTED-PHI-candidate-patient-has-diabetes";
const PHI_FINAL = "PLANTED-PHI-final-memory-takes-insulin";
const PHI_REASON = "PLANTED-PHI-reasoning-text";
const PHI_RAW = "PLANTED-PHI-raw-model-output";

const mockLog = jest.fn();
const mockConclude = jest.fn();
jest.mock("../../jobs/helpers/index.js", () => ({
  log: (...a) => mockLog(...a),
  conclude: () => mockConclude(),
}));
jest.mock("../../models/systemSettings.js", () => ({
  SystemSettings: { autoMemoriesEnabled: jest.fn(async () => true) },
}));
const mockApply = jest.fn(async () => ({
  workspaceCount: 1,
  globalCount: 0,
  updatedCount: 1,
}));
jest.mock("../../models/memory.js", () => ({
  Memory: {
    GLOBAL_LIMIT: 5,
    WORKSPACE_LIMIT: 20,
    forUserWorkspace: jest.fn(async () => []),
    globalForUser: jest.fn(async () => []),
    applyExtractedMemories: (...a) => mockApply(...a),
  },
}));
const chat = (id) => ({
  id,
  user_id: 3,
  workspaceId: 5,
  createdAt: new Date(Date.now() - 24 * 3600 * 1000),
});
jest.mock("../../models/workspaceChats.js", () => ({
  WorkspaceChats: {
    where: jest.fn(async () => [1, 2, 3, 4, 5].map(chat)),
    markMemoryProcessed: jest.fn(async () => {}),
  },
}));
jest.mock("../../models/workspace.js", () => ({
  Workspace: { get: jest.fn(async () => ({ id: 5, name: "Clinic" })) },
}));
jest.mock("../../jobs/helpers/memory-extraction-utils.js", () => ({
  groupByUserWorkspace: (chats) => new Map([["3:5", chats]]),
  loadLatestChats: jest.fn(async () => [{ prompt: "p" }]),
  resolveLLM: () => ({ provider: "openai", model: "m" }),
  buildObserverUserMessage: () => "obs",
  runObserver: jest.fn(async () => ({
    candidates: [
      { confidence: "high", content: PHI_CANDIDATE, reasoning: PHI_REASON },
    ],
    rawText: PHI_RAW,
  })),
  buildReflectorUserMessage: () => "ref",
  runReflector: jest.fn(async () => ({
    memories: [
      {
        scope: "workspace",
        action: "update",
        updateId: 4,
        content: PHI_FINAL,
        reasoning: PHI_REASON,
      },
    ],
    rawText: PHI_RAW,
  })),
}));
const mockRecord = jest.fn(async () => {});
const mockRunAs = jest.fn(async (who, fn) => fn());
jest.mock("../../utils/audit", () => ({
  audit: {
    record: (...a) => mockRecord(...a),
    runAs: (...a) => mockRunAs(...a),
  },
}));

describe("extract-memories job logging", () => {
  it("never writes memory text, reasoning or raw model output to any log", async () => {
    const spies = ["log", "info", "warn", "error"].map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );
    const send = jest.fn();
    const hadSend = process.send;
    process.send = send;

    require("../../jobs/extract-memories.js");
    await new Promise((resolve) => {
      const check = () =>
        mockConclude.mock.calls.length ? resolve() : setImmediate(check);
      check();
    });

    process.send = hadSend;
    const everything = JSON.stringify([
      mockLog.mock.calls,
      send.mock.calls,
      ...spies.map((s) => s.mock.calls),
    ]);
    spies.forEach((s) => s.mockRestore());

    expect(mockLog.mock.calls.length).toBeGreaterThan(3);
    for (const secret of [PHI_CANDIDATE, PHI_FINAL, PHI_REASON, PHI_RAW])
      expect(everything).not.toContain(secret);
    // Counts, scope and action are still logged.
    expect(everything).toContain("workspace/update#4");
    expect(everything).toContain("1 candidate(s)");
  });

  it("records memory.extracted as the job, on behalf of the user, with counts only", () => {
    expect(mockRunAs).toHaveBeenCalledWith(
      {
        actorType: "job",
        actorId: "extract-memories",
        onBehalfOf: 3,
        channel: "job",
      },
      expect.any(Function)
    );
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const event = mockRecord.mock.calls[0][0];
    expect(event).toMatchObject({
      action: "memory.extracted",
      workspaceId: 5,
      metadata: { created: 1, updated: 1, candidates: 1, workspaceId: 5 },
    });
    expect(JSON.stringify(event)).not.toContain("PLANTED-PHI");
  });
});
