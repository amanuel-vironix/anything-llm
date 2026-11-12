/* eslint-env jest */
// Plan section 4.6 and main-plan compliance item 9: settings.changed records
// what updateENV actually applied, with secrets masked, and the key that
// stopped a partial update (SMF-10).
const { createTestPrisma } = require("../../helpers/sqliteTestDb");

const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const { updateENV } = require("../../../utils/helpers/updateENV");
const context = require("../../../utils/audit/context");

const prisma = mockDb.prisma;
const saved = { ...process.env };

beforeEach(async () => {
  await prisma.audit_events.deleteMany({});
  process.env.LLM_PROVIDER = "ollama";
  process.env.OPEN_AI_KEY = "sk-oldkeyoldkeyoldkey0000";
  delete process.env.STORAGE_DIR;
});
afterAll(async () => {
  process.env = saved;
  await mockDb.cleanup();
});

function adminRun(fn) {
  const ctx = context.newContext({
    channel: "ui",
    locals: { user: { id: 1 }, multiUserMode: true },
  });
  return context.storage.run(ctx, fn);
}

it("records one row per applied key, masks secrets, and names the key that failed", async () => {
  const result = await adminRun(() =>
    updateENV({
      LLMProvider: "openai",
      OpenAiKey: "sk-newkeynewkeynewkey9876",
      VectorDB: "not-a-real-vector-db",
    })
  );
  expect(result.error).toBeTruthy();

  const rows = await prisma.audit_events.findMany({ orderBy: { id: "asc" } });
  const summary = rows.map((r) => [r.action, r.outcome, r.target_id]);
  expect(summary).toEqual([
    ["settings.changed", "success", "LLMProvider"],
    ["vendor.changed", "success", "LLMProvider"],
    ["settings.changed", "success", "OpenAiKey"],
    ["settings.changed", "failed", "VectorDB"],
  ]);

  expect(JSON.parse(rows[0].metadata)).toMatchObject({
    from: "ollama",
    to: "openai",
  });
  expect(JSON.parse(rows[1].metadata)).toMatchObject({
    kind: "llm",
    from: "ollama",
    to: "openai",
  });
  const keyRow = JSON.stringify(rows[2]);
  expect(keyRow).not.toContain("sk-newkeynewkey");
  expect(keyRow).not.toContain("sk-oldkeyoldkey");
  expect(JSON.parse(rows[2].metadata)).toMatchObject({
    from: "****0000",
    to: "****9876",
  });
  expect(JSON.parse(rows[3].metadata)).toMatchObject({
    failedKey: "VectorDB",
    applied: ["LLMProvider", "OpenAiKey"],
  });
  for (const row of rows) expect(row.actor_id).toBe("1");
});

it("records nothing for a key set to its current value", async () => {
  await adminRun(() => updateENV({ LLMProvider: "ollama" }));
  expect(await prisma.audit_events.count()).toBe(0);
});
