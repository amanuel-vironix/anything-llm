/* eslint-env jest */
// Plan section 4.6, item 9: a system_settings write records settings.changed
// for each label that changed, with secret-named labels masked and long
// values left out.
const { createTestPrisma } = require("../../helpers/sqliteTestDb");

const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const { SystemSettings } = require("../../../models/systemSettings");
const context = require("../../../utils/audit/context");

const prisma = mockDb.prisma;

beforeEach(async () => {
  await prisma.audit_events.deleteMany({});
  await prisma.system_settings.deleteMany({});
});
afterAll(() => mockDb.cleanup());

function adminRun(fn) {
  const ctx = context.newContext({
    channel: "ui",
    locals: { user: { id: 1 }, multiUserMode: true },
  });
  return context.storage.run(ctx, fn);
}

const rows = () =>
  prisma.audit_events.findMany({
    where: { action: "settings.changed" },
    orderBy: { id: "asc" },
  });

it("records each changed label, with flag values and without free text, by the acting admin", async () => {
  await prisma.system_settings.create({
    data: { label: "onboarding_complete", value: "false" },
  });
  await adminRun(() =>
    SystemSettings._updateSettings({
      footer_data: '[{"url":"https://x.test"}]',
      onboarding_complete: true,
      default_system_prompt: "PLANTED-PHI triage chest pain first",
    })
  );
  const found = await rows();
  expect(found.map((r) => r.target_id).sort()).toEqual([
    "default_system_prompt",
    "footer_data",
    "onboarding_complete",
  ]);
  expect(found[0]).toMatchObject({ actor_type: "user", actor_id: "1" });
  const flag = found.find((r) => r.target_id === "onboarding_complete");
  expect(JSON.parse(flag.metadata)).toEqual({
    key: "onboarding_complete",
    from: "false",
    to: "true",
    source: "system_settings",
  });
  const footer = found.find((r) => r.target_id === "footer_data");
  expect(JSON.parse(footer.metadata)).toEqual({
    key: "footer_data",
    from: null,
    source: "system_settings",
  });
  expect(JSON.stringify(found)).not.toContain("PLANTED-PHI");
});

it("records nothing for a label written with its current value", async () => {
  await prisma.system_settings.create({
    data: { label: "onboarding_complete", value: "true" },
  });
  await adminRun(() =>
    SystemSettings._updateSettings({ onboarding_complete: true })
  );
  expect(await rows()).toEqual([]);
});

it("leaves out long values so connection lists never reach a row", async () => {
  const long = JSON.stringify([
    {
      action: "add",
      database_id: "clinic",
      connectionString: "postgres://admin:s3cretpw@db.internal:5432/ehr",
      engine: "postgresql",
      padding: "x".repeat(80),
    },
  ]);
  await adminRun(() =>
    SystemSettings._updateSettings({ agent_sql_connections: long })
  );
  const [row] = await rows();
  expect(row.target_id).toBe("agent_sql_connections");
  expect(row.metadata).not.toContain("s3cretpw");
  expect(row.metadata).not.toContain("db.internal");
});
