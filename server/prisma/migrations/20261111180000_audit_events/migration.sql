-- CreateTable
CREATE TABLE "audit_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "reason" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "on_behalf_of" INTEGER,
    "team_id" INTEGER,
    "workspace_id" INTEGER,
    "target_type" TEXT,
    "target_id" TEXT,
    "channel" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "metadata" TEXT,
    "prev_hash" TEXT,
    "hash" TEXT
);

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- CreateIndex
CREATE INDEX "audit_events_actor_type_actor_id_idx" ON "audit_events"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "audit_events_on_behalf_of_idx" ON "audit_events"("on_behalf_of");

-- CreateIndex
CREATE INDEX "audit_events_workspace_id_idx" ON "audit_events"("workspace_id");

-- Copy the legacy event log so the audit trail starts complete. The actor of a
-- legacy row can't be told apart (user_updated stored the target, F-55), so a
-- row with a userId is marked actor_type 'user' and the id kept as recorded.
-- invite_created stored the invite code in plain text (F-55): its metadata is
-- not copied.
INSERT INTO "audit_events" ("occurred_at", "action", "outcome", "actor_type", "actor_id", "on_behalf_of", "channel", "metadata")
SELECT
    "occurredAt",
    'legacy.' || "event",
    'success',
    CASE WHEN "userId" IS NULL THEN 'unknown' ELSE 'user' END,
    CAST("userId" AS TEXT),
    "userId",
    'unknown',
    CASE WHEN "event" = 'invite_created' THEN NULL ELSE "metadata" END
FROM "event_logs"
ORDER BY "id";
