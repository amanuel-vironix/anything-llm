/**
 * Audit work at process start: insert rows left in the outbox by a previous
 * run, record `system.boot`, and record `system.shutdown` on a stop signal.
 */
const { audit } = require("./index");

let booted = false;

async function auditBoot() {
  if (booted) return;
  booted = true;
  const ctx = audit.systemContext("boot");
  try {
    await audit.flushOutbox();
  } catch (e) {
    console.error(`[audit] outbox flush at boot failed: ${e.message}`);
  }
  try {
    const { failed } = require("./vendors").instrument();
    for (const f of failed)
      console.error(`[audit] vendor inventory: ${f.provider}: ${f.error}`);
  } catch (e) {
    console.error(`[audit] vendor inventory failed: ${e.message}`);
  }
  try {
    const { SystemSettings } = require("../../models/systemSettings");
    await audit.record(
      {
        action: "system.boot",
        metadata: {
          version: require("../../package.json").version,
          multiUserMode: await SystemSettings.isMultiUserMode(),
          nodeEnv: process.env.NODE_ENV || null,
        },
      },
      { ctx }
    );
  } catch (e) {
    console.error(`[audit] system.boot not recorded: ${e.message}`);
  }

  // Best effort: another handler may exit first. If no other handler is
  // listening, re-raise the signal so the default exit still happens.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.prependOnceListener(signal, () => {
      const othersHandleIt = process.listenerCount(signal) > 0;
      require("./vendors")
        .flush()
        .catch(() => {})
        .then(() =>
          audit.record(
            { action: "system.shutdown", metadata: { signal } },
            { ctx }
          )
        )
        .catch(() => {})
        .finally(() => {
          if (!othersHandleIt) process.kill(process.pid, signal);
        });
    });
  }
}

module.exports = { auditBoot };
