const { PrismaClient } = require("@prisma/client");

// npx prisma introspect
// npx prisma generate
// npx prisma migrate dev --name init -> ensures that db is in sync with schema
// npx prisma migrate reset -> resets the db

const logLevels = ["error", "info", "warn"]; // add "query" to debug query logs
const prisma = new PrismaClient({
  log: logLevels,
});
// Writes to sensitive tables with no audit event get a `db.write` audit row
// (PLAN-audit-logging-and-compliance.md section 5.2).
require("../audit/backstop").install(prisma);

module.exports = prisma;
