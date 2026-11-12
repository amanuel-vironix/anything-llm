/**
 * Durable outbox for audit rows the database didn't accept
 * (PLAN-audit-logging-and-compliance.md section 3.2).
 *
 * `append` writes one JSON line per row to `storage/audit-outbox/<pid>.jsonl`
 * and fsyncs it before returning, so a row survives a crash. `flush` claims
 * each file by renaming it, inserts its rows in one transaction, and deletes it.
 * A crash after the insert commits and before the delete would insert those
 * rows again on the next flush: delivery is at least once, never lost.
 */
const fs = require("fs");
const path = require("path");

function outboxDir() {
  return process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR, "audit-outbox")
    : path.resolve(__dirname, "../../storage/audit-outbox");
}

/**
 * @param {Object} row - an `audit_events` row, without `id`
 * @param {string} [dir]
 */
function append(row, dir = outboxDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${process.pid}.jsonl`);
  const fd = fs.openSync(file, "a", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(row)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {string} [dir]
 * @returns {number|null} rows waiting, or null if the outbox can't be read
 */
function backlog(dir = outboxDir()) {
  try {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl") && !name.includes(".flushing")) continue;
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      count += text.split("\n").filter(Boolean).length;
    }
    return count;
  } catch {
    return null;
  }
}

function parseRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.occurred_at) row.occurred_at = new Date(row.occurred_at);
      rows.push(row);
    } catch {
      // A torn last line from a crash mid-write: skip it.
    }
  }
  return rows;
}

let flushing = null;

/**
 * Inserts every queued row. Safe to call concurrently; calls share one run.
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} [dir]
 * @returns {Promise<number>} rows inserted
 */
function flush(prisma, dir = outboxDir()) {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!fs.existsSync(dir)) return 0;
    let inserted = 0;
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      let claimed = file;
      if (name.endsWith(".jsonl")) {
        claimed = `${file}.flushing-${Date.now()}`;
        try {
          fs.renameSync(file, claimed);
        } catch {
          continue;
        }
      } else if (!name.includes(".flushing")) continue;

      const rows = parseRows(fs.readFileSync(claimed, "utf8"));
      try {
        if (rows.length > 0)
          await prisma.$transaction(
            rows.map((data) => prisma.audit_events.create({ data }))
          );
        fs.rmSync(claimed, { force: true });
        inserted += rows.length;
      } catch {
        // Database still unavailable: leave the claimed file for the next run.
      }
    }
    return inserted;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

module.exports = { append, flush, backlog, outboxDir };
