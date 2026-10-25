import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl?.startsWith("postgresql://") && !databaseUrl?.startsWith("postgres://")) {
  throw new Error("DATABASE_URL must be a Supabase PostgreSQL connection string.");
}

export const prisma = new PrismaClient();

export async function initDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GuildConfig" (
      "guildId" TEXT NOT NULL PRIMARY KEY,
      "nwordEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "NWordCount" (
      "id" SERIAL PRIMARY KEY,
      "guildId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "count" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "NWordCount_guildId_userId_key" UNIQUE ("guildId", "userId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "NWordCount_guildId_count_idx" ON "NWordCount"("guildId", "count" DESC);
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProcessedMessage" (
      "messageId" TEXT NOT NULL PRIMARY KEY,
      "guildId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProcessedMessage_guildId_idx" ON "ProcessedMessage"("guildId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ServerLogConfig" (
      "guildId" TEXT NOT NULL PRIMARY KEY,
      "channelId" TEXT,
      "enabled" TEXT NOT NULL DEFAULT '{"messages":true,"members":true,"voice":true,"channels":true,"roles":true,"server":true,"commands":true,"automod":true}',
      "ignoredChannels" TEXT NOT NULL DEFAULT '[]',
      "ignoredRoles" TEXT NOT NULL DEFAULT '[]',
      "ignoredUsers" TEXT NOT NULL DEFAULT '[]',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BotGuildState" (
      "guildId" TEXT NOT NULL PRIMARY KEY,
      "lobbyCode" TEXT,
      "deadMemberIds" TEXT NOT NULL DEFAULT '[]',
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppMigration" (
      "migrationKey" TEXT NOT NULL PRIMARY KEY,
      "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  logger.info("Supabase PostgreSQL tables initialized");
}
