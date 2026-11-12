/**
 * A real SQLite database for tests that depend on database semantics a mock
 * cannot reproduce: transactions, conditional writes and their counts, and
 * unique indexes under concurrent calls.
 *
 * The schema is built once per test run by applying the checked-in
 * migrations (so a broken migration fails here), then copied to a fresh file
 * for each call to `createTestPrisma`.
 *
 * Use it by mocking the shared client before requiring any model:
 *
 *   const { createTestPrisma } = require("../helpers/sqliteTestDb");
 *   const testDb = createTestPrisma();
 *   jest.mock("../../utils/prisma", () => testDb.prisma);
 *
 * `jest.mock` factories may only reference variables prefixed with `mock`,
 * so name the holder `mockDb` (or similar) in the test file.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const SERVER_ROOT = path.resolve(__dirname, "../..");
const PRISMA_DIR = path.join(SERVER_ROOT, "prisma");
const PRISMA_BIN = path.join(SERVER_ROOT, "node_modules/.bin/prisma");

function migrationsHash() {
  const hash = crypto.createHash("sha1");
  hash.update(fs.readFileSync(path.join(PRISMA_DIR, "schema.prisma")));
  const migrationsDir = path.join(PRISMA_DIR, "migrations");
  for (const name of fs.readdirSync(migrationsDir).sort()) {
    const file = path.join(migrationsDir, name, "migration.sql");
    if (fs.existsSync(file)) hash.update(name).update(fs.readFileSync(file));
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * Builds (or reuses) a migrated template database and returns its path.
 * @returns {string}
 */
function templateDatabase() {
  const dir = path.join(os.tmpdir(), `allm-test-db-${migrationsHash()}`);
  const dbFile = path.join(dir, "template.db");
  if (fs.existsSync(dbFile)) return dbFile;

  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "allm-test-db-build-"));
  const buildDb = path.join(buildDir, "template.db");
  const schema = fs
    .readFileSync(path.join(PRISMA_DIR, "schema.prisma"), "utf8")
    .replace(/url\s*=\s*"file:[^"]*"/, `url = "file:${buildDb}"`);
  fs.writeFileSync(path.join(buildDir, "schema.prisma"), schema);
  fs.cpSync(
    path.join(PRISMA_DIR, "migrations"),
    path.join(buildDir, "migrations"),
    { recursive: true }
  );
  execFileSync(
    PRISMA_BIN,
    ["migrate", "deploy", "--schema", path.join(buildDir, "schema.prisma")],
    { cwd: SERVER_ROOT, stdio: "pipe" }
  );

  fs.mkdirSync(dir, { recursive: true });
  // Another worker may have finished first; either copy is identical.
  if (!fs.existsSync(dbFile)) fs.renameSync(buildDb, dbFile);
  fs.rmSync(buildDir, { recursive: true, force: true });
  return dbFile;
}

/**
 * Creates a Prisma client on a fresh copy of the migrated database.
 * @returns {{prisma: import("@prisma/client").PrismaClient, file: string, cleanup: () => Promise<void>}}
 */
function createTestPrisma() {
  const template = templateDatabase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allm-test-db-run-"));
  const file = path.join(dir, "test.db");
  fs.copyFileSync(template, file);

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${file}` } },
    log: ["error"],
  });

  return {
    prisma,
    file,
    cleanup: async () => {
      await prisma.$disconnect();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { createTestPrisma };
