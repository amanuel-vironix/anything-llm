-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "api_keys" ADD COLUMN "lastUsedAt" DATETIME;
ALTER TABLE "api_keys" ADD COLUMN "user_id" INTEGER;
ALTER TABLE "api_keys" ADD COLUMN "workspace_ids" TEXT;

-- AlterTable
ALTER TABLE "system_prompt_variables" ADD COLUMN "team_id" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "policy_id" INTEGER;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "team_id" INTEGER;

-- CreateTable
CREATE TABLE "access_policies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowed_models" TEXT,
    "default_provider" TEXT,
    "default_model" TEXT,
    "router_id" INTEGER,
    "allow_agents" BOOLEAN NOT NULL DEFAULT true,
    "agent_tools" TEXT,
    "created_by" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "teams" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "policy_id" INTEGER,
    "idp_group" TEXT,
    "created_by" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "team_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "added_by" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable (no table rebuild: SQLite allows ADD COLUMN with a constant default)
ALTER TABLE "slash_command_presets" ADD COLUMN "team_id" INTEGER NOT NULL DEFAULT 0;
DROP INDEX "slash_command_presets_uid_command_key";
CREATE INDEX "slash_command_presets_team_id_idx" ON "slash_command_presets"("team_id");
CREATE UNIQUE INDEX "slash_command_presets_uid_team_id_command_key" ON "slash_command_presets"("uid", "team_id", "command");

-- CreateIndex
CREATE UNIQUE INDEX "access_policies_name_key" ON "access_policies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_idp_group_key" ON "teams"("idp_group");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_user_id_key" ON "team_members"("user_id");

-- CreateIndex
CREATE INDEX "team_members_team_id_role_idx" ON "team_members"("team_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_user_id_key" ON "team_members"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

