import fs from "node:fs";
import path from "node:path";
import { EmbedBuilder, type Message } from "discord.js";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

const sep = "[\\s._\\-*~/\\\\]*";
const N = "[nñ]";
const I = "[i1!|le3]";
const G = "[g9q6]";
const A = "[a4@]";
const E = "[e3]";
const O = "[o0]";
const R = "[r]";
const GG = `(?:${G}+${sep}${G}+|${G}{2,})`;

const NWORD_REGEX = new RegExp(
  "(?<=^|[^a-zA-Z0-9])(?:" +
    // Standard double-g (nigga, nigger, n199a, n i g g a, nigg, niggs, etc.)
    `${N}+${sep}${I}+${sep}${GG}${sep}(?:${E}+${sep}${R}+s?|${A}+(?:${sep}[szh4]+)*|[u]+${sep}[rh]+s?|${A}+${sep}[z]+|${E}+${sep}[z]+|${I}+${sep}t+s?|s(?=[^a-zA-Z0-9]|$)|(?=[^a-zA-Z0-9]|$))` +
    "|" +
    // Single-g (niga, nigar, negar, etc.)
    `${N}+${sep}${I}+${sep}${G}+${sep}(?:${A}+(?:${sep}[szh4]+)*|${E}+${sep}${R}+s?|${A}+${sep}${R}+s?)` +
    "|" +
    // Negro variations (negro, negros, negroes, negroid, negrito, negrita, negress, negr0)
    `${N}+${sep}${E}+${sep}${G}+${sep}${R}+${sep}(?:${O}+(?:${sep}e?s)?|${O}+${sep}i+d+|i+${sep}t+${sep}[oa]+|e+${sep}s+${sep}s+)` +
    "|" +
    // Nga variations (nga, ngas, ngah, ngaz, ng4, ngga, n g a, etc.)
    `${N}+${sep}${G}+${sep}${A}+(?:${sep}[szh4]+)*` +
    "|" +
    // Nignog, nig nog, nig-nog
    `${N}+${sep}${I}+${sep}${G}+${sep}${N}+${sep}${O}+${sep}${G}+` +
    "|" +
    // Niglet, niglets
    `${N}+${sep}${I}+${sep}${G}+${sep}l+${sep}${E}+${sep}t+s?` +
    ")(?=[^a-zA-Z0-9]|$)",
  "gi",
);

export interface GuildCounterData {
  enabled?: boolean;
  counts: Record<string, number>;
}

export interface NWordStoreData {
  guilds: Record<string, GuildCounterData>;
  processedMessageIds: string[];
}

function getStorageFilePath(): string {
  return process.env["NWORD_DATA_FILE"]
    ? path.resolve(process.env["NWORD_DATA_FILE"])
    : "";
}

let fileStore: NWordStoreData = { guilds: {}, processedMessageIds: [] };

function loadStoreFromFile(): NWordStoreData {
  const filePath = getStorageFilePath();
  if (!filePath) {
    return { guilds: {}, processedMessageIds: [] };
  }
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<NWordStoreData>;
      return {
        guilds: parsed.guilds ?? {},
        processedMessageIds: Array.isArray(parsed.processedMessageIds)
          ? parsed.processedMessageIds
          : [],
      };
    }
  } catch (error) {
    logger.error({ err: error, filePath }, "Failed to read N-word counts file");
  }
  return { guilds: {}, processedMessageIds: [] };
}

fileStore = loadStoreFromFile();

export async function syncFromDatabase(): Promise<void> {
  try {
    const records = await prisma.nWordCount.findMany();
    let changed = false;
    for (const record of records) {
      if (!fileStore.guilds[record.guildId]) {
        fileStore.guilds[record.guildId] = { counts: {} };
      }
      const existing = fileStore.guilds[record.guildId].counts[record.userId] ?? 0;
      if (record.count > existing) {
        fileStore.guilds[record.guildId].counts[record.userId] = record.count;
        changed = true;
      }
    }
    if (changed) {
      logger.info("Loaded existing Supabase counts into the legacy migration cache");
    }
  } catch {
    // Database may be uninitialized or unavailable; ignore
  }
}

export async function syncToDatabase(): Promise<void> {
  if (!process.env["NWORD_DATA_FILE"]) {
    return;
  }

  try {
    const migration = await prisma.$queryRaw<Array<{ migrationKey: string }>>`
      SELECT "migrationKey" FROM "AppMigration" WHERE "migrationKey" = 'legacy-nword-json-v1' LIMIT 1
    `;
    if (migration.length > 0) {
      return;
    }

    const existingRecords = await prisma.nWordCount.findMany({
      select: { guildId: true, userId: true, count: true },
    });
    const existingCounts = new Map(
      existingRecords.map((record) => [`${record.guildId}:${record.userId}`, record.count]),
    );
    const countWrites = Object.entries(fileStore.guilds).flatMap(([guildId, guild]) =>
      Object.entries(guild.counts).map(([userId, count]) => {
        const persistedCount = Math.max(count, existingCounts.get(`${guildId}:${userId}`) ?? 0);
        return prisma.nWordCount.upsert({
          where: { guildId_userId: { guildId, userId } },
          create: { guildId, userId, count: persistedCount },
          update: { count: persistedCount },
        });
      }),
    );
    for (let index = 0; index < countWrites.length; index += 50) {
      await Promise.all(countWrites.slice(index, index + 50));
    }

    for (const [guildId, guild] of Object.entries(fileStore.guilds)) {
      if (guild.enabled !== undefined) {
        await prisma.guildConfig.upsert({
          where: { guildId },
          create: { guildId, nwordEnabled: guild.enabled },
          update: { nwordEnabled: guild.enabled },
        });
      }
    }
    if (fileStore.processedMessageIds.length > 0) {
      await prisma.processedMessage.createMany({
        data: fileStore.processedMessageIds.map((messageId) => ({
          messageId,
          guildId: "legacy",
        })),
        skipDuplicates: true,
      });
    }
    await prisma.$executeRaw`
      INSERT INTO "AppMigration" ("migrationKey")
      VALUES ('legacy-nword-json-v1')
      ON CONFLICT("migrationKey") DO NOTHING
    `;
    logger.info(
      { countRecords: countWrites.length },
      "Synchronized JSON N-word data into the database",
    );
  } catch (error) {
    logger.error({ err: error }, "Failed to synchronize JSON N-word data into the database");
    throw error;
  }
}

const processedMessageIds = new Set<string>();
const MAX_PROCESSED_CACHE = 5000;

function markMessageProcessed(messageId: string): void {
  processedMessageIds.add(messageId);
  if (!fileStore.processedMessageIds.includes(messageId)) {
    fileStore.processedMessageIds.push(messageId);
  }
  if (fileStore.processedMessageIds.length > 2000) {
    fileStore.processedMessageIds = fileStore.processedMessageIds.slice(-2000);
  }
  if (processedMessageIds.size > MAX_PROCESSED_CACHE) {
    const firstKey = processedMessageIds.keys().next().value;
    if (firstKey) {
      processedMessageIds.delete(firstKey);
    }
  }
}

function cleanText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function countNWordOccurrences(text: string): number {
  if (!text) return 0;
  const cleaned = cleanText(text);
  const matches = cleaned.match(NWORD_REGEX);
  return matches ? matches.length : 0;
}

const COUNTER_REACTIONS: readonly ((userId: string, count: number) => string)[] = [
  (userId, count) =>
    `<@${userId}> Caught in 4K. Your N-word count is now **${count}**.`,
  (userId, count) =>
    `<@${userId}> You've been spotted. Total N-word count: **${count}**.`,
  (userId, count) =>
    `Did you really just say that, <@${userId}>? Your N-word count is now **${count}**.`,
  (userId, count) =>
    `<@${userId}> Watch your language. Your N-word count is now **${count}**.`,
  (userId, count) =>
    `<@${userId}> Added to your record. Total N-word count: **${count}**.`,
  (userId, count) =>
    `<@${userId}> Caught red-handed. Your N-word count is now **${count}**.`,
  (userId, count) =>
    `<@${userId}> That was recorded. Total N-word count: **${count}**.`,
  (userId, count) =>
    `<@${userId}> The counter has spoken. You're now at **${count}**.`,
  (userId, count) =>
    `<@${userId}> Logged. Your N-word count is now **${count}**.`,
  (userId, count) =>
    `<@${userId}> Another one on your record. Total count: **${count}**.`,
  (userId, count) =>
    `<@${userId}> You thought you could slip that in? Current count: **${count}**.`,
  (userId, count) =>
    `<@${userId}> Detected. Your N-word count has increased to **${count}**.`,
];

export function formatCounterResponse(userId: string, count: number): string {
  const reactionFn =
    COUNTER_REACTIONS[Math.floor(Math.random() * COUNTER_REACTIONS.length)];
  return reactionFn(userId, count);
}

const guildConfigCache = new Map<string, boolean>();

export async function isNWordCounterEnabled(guildId: string): Promise<boolean> {
  const cached = guildConfigCache.get(guildId);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const config = await prisma.guildConfig.findUnique({
      where: { guildId },
    });
    const enabled = config ? config.nwordEnabled : true;
    guildConfigCache.set(guildId, enabled);
    if (!fileStore.guilds[guildId]) {
      fileStore.guilds[guildId] = { counts: {} };
    }
    fileStore.guilds[guildId].enabled = enabled;
    if (!config) {
      await prisma.guildConfig.create({ data: { guildId, nwordEnabled: true } });
    }
    return enabled;
  } catch (error) {
    logger.warn({ err: error, guildId }, "Failed to fetch guild config, defaulting to enabled");
    return true;
  }
}

export async function setNWordCounterEnabled(
  guildId: string,
  enabled: boolean,
): Promise<boolean> {
  const previousValue = guildConfigCache.get(guildId);
  const previousFileValue = fileStore.guilds[guildId]?.enabled;
  if (!fileStore.guilds[guildId]) {
    fileStore.guilds[guildId] = { counts: {} };
  }
  fileStore.guilds[guildId].enabled = enabled;
  guildConfigCache.set(guildId, enabled);

  try {
    await prisma.guildConfig.upsert({
      where: { guildId },
      create: {
        guildId,
        nwordEnabled: enabled,
      },
      update: {
        nwordEnabled: enabled,
      },
    });
  } catch (error) {
    logger.warn({ err: error, guildId }, "Failed to update guild config in database");
    if (previousValue === undefined) guildConfigCache.delete(guildId);
    else guildConfigCache.set(guildId, previousValue);
    if (fileStore.guilds[guildId]) {
      if (previousFileValue === undefined) delete fileStore.guilds[guildId].enabled;
      else fileStore.guilds[guildId].enabled = previousFileValue;
    }
    return false;
  }
  return true;
}

export async function getUserNWordCount(
  guildId: string,
  userId: string,
): Promise<number> {
  try {
    const record = await prisma.nWordCount.findUnique({
      where: {
        guildId_userId: {
          guildId,
          userId,
        },
      },
    });
    const count = record?.count ?? 0;
    if (record) {
      if (!fileStore.guilds[guildId]) {
        fileStore.guilds[guildId] = { counts: {} };
      }
      fileStore.guilds[guildId].counts[userId] = count;
    }
    return count;
  } catch (error) {
    logger.warn({ err: error, guildId, userId }, "Failed to fetch user N-word count");
    return fileStore.guilds[guildId]?.counts[userId] ?? 0;
  }
}

export async function resetUserNWordCount(guildId: string, userId: string): Promise<boolean> {
  try {
    await prisma.nWordCount.deleteMany({ where: { guildId, userId } });
    if (fileStore.guilds[guildId]) {
      delete fileStore.guilds[guildId].counts[userId];
    }
    return true;
  } catch (error) {
    logger.error({ err: error, guildId, userId }, "Failed to reset user N-word count");
    return false;
  }
}

export async function getNWordLeaderboard(
  guildId: string,
  limit = 10,
): Promise<{ userId: string; count: number }[]> {
  try {
    const records = await prisma.nWordCount.findMany({
      where: {
        guildId,
        count: { gt: 0 },
      },
      orderBy: {
        count: "desc",
      },
      take: limit,
      select: {
        userId: true,
        count: true,
      },
    });
    for (const row of records) {
      if (!fileStore.guilds[guildId]) {
        fileStore.guilds[guildId] = { counts: {} };
      }
      fileStore.guilds[guildId].counts[row.userId] = row.count;
    }
    return records;
  } catch (error) {
    logger.warn({ err: error, guildId }, "Failed to fetch N-word leaderboard");
    const guildCounts = fileStore.guilds[guildId]?.counts ?? {};
    return Object.entries(guildCounts)
      .filter(([, count]) => count > 0)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
}

export function createLeaderboardEmbed(
  guildName: string,
  rows: readonly { userId: string; count: number }[],
  botAvatarUrl?: string | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`N-Word Leaderboard — ${guildName}`)
    .setTimestamp();

  if (botAvatarUrl) {
    embed.setAuthor({ name: "dea", iconURL: botAvatarUrl });
    embed.setFooter({ text: "dea", iconURL: botAvatarUrl });
  } else {
    embed.setAuthor({ name: "dea" });
    embed.setFooter({ text: "dea" });
  }

  if (rows.length === 0) {
    embed.setDescription("No N-word detections have been recorded in this server yet.");
  } else {
    const lines = rows.map((row, index) => {
      return `**${index + 1}.** <@${row.userId}> — **${row.count}** time${row.count === 1 ? "" : "s"}`;
    });
    embed.setDescription(lines.join("\n"));
  }

  return embed;
}

export async function handleNWordMessage(message: Message): Promise<boolean> {
  if (!message.guild || !message.channel) {
    return false;
  }

  if (message.author.bot || message.webhookId || message.system) {
    return false;
  }

  if (message.client.user && message.author.id === message.client.user.id) {
    return false;
  }

  if (processedMessageIds.has(message.id) || fileStore.processedMessageIds.includes(message.id)) {
    return false;
  }

  try {
    const alreadyProcessed = await prisma.processedMessage.findUnique({
      where: { messageId: message.id },
      select: { messageId: true },
    });
    if (alreadyProcessed) {
      markMessageProcessed(message.id);
      return false;
    }
  } catch (error) {
    logger.error({ err: error, guildId: message.guild.id, messageId: message.id }, "Could not check persisted message state");
    return false;
  }

  const occurrences = countNWordOccurrences(message.content);
  if (occurrences <= 0) {
    return false;
  }

  const isEnabled = await isNWordCounterEnabled(message.guild.id);
  if (!isEnabled) {
    return false;
  }

  markMessageProcessed(message.id);

  if (!fileStore.guilds[message.guild.id]) {
    fileStore.guilds[message.guild.id] = { counts: {} };
  }
  const currentCount = fileStore.guilds[message.guild.id].counts[message.author.id] ?? 0;
  const newCount = currentCount + occurrences;
  fileStore.guilds[message.guild.id].counts[message.author.id] = newCount;

  try {
    await prisma.$transaction([
      prisma.processedMessage.create({
        data: {
          messageId: message.id,
          guildId: message.guild.id,
        },
      }),
      prisma.nWordCount.upsert({
        where: {
          guildId_userId: {
            guildId: message.guild.id,
            userId: message.author.id,
          },
        },
        create: {
          guildId: message.guild.id,
          userId: message.author.id,
          count: occurrences,
        },
        update: {
          count: {
            increment: occurrences,
          },
        },
      }),
    ]);
  } catch (error) {
    logger.warn(
      { err: error, guildId: message.guild.id, messageId: message.id },
      "Supabase transaction failed; skipped N-word count update",
    );
    if (currentCount === 0) {
      delete fileStore.guilds[message.guild.id].counts[message.author.id];
    } else {
      fileStore.guilds[message.guild.id].counts[message.author.id] = currentCount;
    }
    processedMessageIds.delete(message.id);
    fileStore.processedMessageIds = fileStore.processedMessageIds.filter((id) => id !== message.id);
    return false;
  }

  const persisted = await prisma.nWordCount.findUnique({
    where: { guildId_userId: { guildId: message.guild.id, userId: message.author.id } },
    select: { count: true },
  }).catch(() => null);
  const actualCount = persisted?.count ?? newCount;
  fileStore.guilds[message.guild.id].counts[message.author.id] = actualCount;

  const replyText = formatCounterResponse(message.author.id, actualCount);
  await message.reply({
    content: replyText,
    allowedMentions: { repliedUser: true },
  });
  return true;
}
