/* eslint-env jest */
// Plan section 5.3 and check K-14: every provider that can send user data is
// in the inventory and has its data-carrying methods wrapped.
const fs = require("fs");
const path = require("path");
const { createTestPrisma } = require("../../helpers/sqliteTestDb");

const mockDb = createTestPrisma();
jest.mock("../../../utils/prisma", () => mockDb.prisma);

const vendors = require("../../../utils/audit/vendors");
const context = require("../../../utils/audit/context");

const UTILS = path.resolve(__dirname, "../../../utils");
jest.setTimeout(120_000);

afterAll(() => mockDb.cleanup());

describe("outbound vendor inventory", () => {
  it.each(Object.keys(vendors.FOLDERS))(
    "lists every provider folder under utils/%s",
    (folder) => {
      const onDisk = fs
        .readdirSync(path.join(UTILS, folder), { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            fs.existsSync(path.join(UTILS, folder, d.name, "index.js"))
        )
        .map((d) => d.name)
        .sort();
      expect(onDisk).toEqual(Object.keys(vendors.PROVIDERS[folder]).sort());
    }
  );

  it("wraps at least one data-carrying method of every listed provider", () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const { wrapped, failed } = vendors.instrument();
    expect(failed).toEqual([]);
    const unwrapped = vendors
      .inventory()
      .filter((v) => !wrapped.some((w) => w.startsWith(`${v.vendor}.`)))
      .map((v) => v.vendor);
    expect(unwrapped).toEqual([]);
  });

  it("counts a call per vendor and channel and writes vendor.data_sent with no content", async () => {
    vendors.instrument();
    const {
      OpenAiEmbedder,
    } = require("../../../utils/EmbeddingEngines/openAi");
    const embedder = Object.create(OpenAiEmbedder.prototype);
    // Stop at the network boundary: the wrapped method runs, the SDK doesn't.
    embedder.openai = {
      embeddings: {
        create: async () => ({ data: [{ embedding: [0.1] }] }),
      },
    };
    embedder.model = "text-embedding-3-small";
    embedder.maxConcurrentChunks = 500;
    embedder.embeddingMaxChunkLength = 1000;
    embedder.log = () => {};

    const ctx = context.newContext({ channel: "api" });
    await context.storage.run(ctx, () =>
      embedder.embedTextInput("PLANTED-PHI chest pain").catch(() => null)
    );
    await vendors.flush();

    const row = await mockDb.prisma.audit_events.findFirst({
      where: { action: "vendor.data_sent" },
    });
    expect(row).toMatchObject({ target_id: "embedder:openAi", channel: "api" });
    expect(JSON.parse(row.metadata)).toMatchObject({
      vendor: "embedder:openAi",
      kind: "embedder",
      count: 1,
    });
    expect(JSON.stringify(row)).not.toContain("PLANTED-PHI");
  });
});
