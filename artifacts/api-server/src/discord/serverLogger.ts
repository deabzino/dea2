import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import { prisma } from "../lib/prisma";
import { describeVoiceChanges, VoiceLogBatcher } from "./voiceLogBatcher";
import { deletedByLabel, sanitizeLogText } from "./logFormatting";

export type LogCategory =
  | "messages"
  | "members"
  | "voice"
  | "channels"
  | "roles"
  | "server"
  | "commands"
  | "automod";

type LogSettings = {
  channelId: string | null;
  enabled: Record<LogCategory, boolean>;
  ignoredChannels: string[];
  ignoredRoles: string[];
  ignoredUsers: string[];
};

type QueueItem = { guildId: string; embed: EmbedBuilder; file?: { attachment: Buffer; name: string } };

const DEFAULT_CHANNEL_ID = "1183841843100795030";
const COLORS = { delete: 0xed4245, create: 0x57f287, update: 0xfee75c, info: 0x5865f2, command: 0x9b59b6 };
const CATEGORIES: LogCategory[] = ["messages", "members", "voice", "channels", "roles", "server", "commands", "automod"];
const queue: QueueItem[] = [];
const pendingVoiceWrites = new Set<Promise<void>>();
let draining = false;
const settingsCache = new Map<string, LogSettings>();
type MessageSnapshot = {
  id: string;
  guildId: string;
  channelId: string;
  authorId: string;
  authorTag: string;
  content: string;
  attachments: string;
  imageUrl: string | null;
  authorBot: boolean;
};
const snapshots = new Map<string, MessageSnapshot>();
type InviteSnapshot = Map<string, { uses: number; inviter: string }>;
const inviteSnapshots = new Map<string, InviteSnapshot>();
const inviteFetchQueues = new Map<string, Promise<void>>();

const defaultSettings = (): LogSettings => ({
  channelId: null,
  enabled: Object.fromEntries(CATEGORIES.map((category) => [category, true])) as Record<LogCategory, boolean>,
  ignoredChannels: [],
  ignoredRoles: [],
  ignoredUsers: [],
});

function truncate(value: unknown, max: number): string {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function idText(value: string | null | undefined): string {
  if (!value) return "channel";
  const channel = globalClient?.channels.cache.get(value) as { name?: string; type?: number } | undefined;
  return `${channel?.type === ChannelType.GuildVoice ? "🔊 " : "#"}${channel?.name ?? "channel"}${idMarker("Channel", value)}`;
}

function userText(id: string, name?: string | null): string {
  const username = globalClient?.users.cache.get(id)?.username ?? name?.split("#")[0] ?? "member";
  const displayName = globalClient?.guilds.cache.find((guild) => guild.members.cache.has(id))?.members.cache.get(id)?.displayName;
  return `@${displayName ?? username}${displayName && displayName !== username ? ` (${username})` : ""}${idMarker("User", id)}`;
}

function idMarker(kind: string, id: string): string { return `\u2063{${kind}:${id}}\u2063`; }

function imageUrlFromMessage(message: Message): string | null {
  return [...message.attachments.values()].find((attachment) =>
    attachment.contentType?.startsWith("image/") ||
    /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(attachment.name ?? attachment.url),
  )?.url ?? null;
}

function snapshotMessage(message: Message): MessageSnapshot | null {
  if (!message.guild) return null;
  return {
    id: message.id,
    guildId: message.guild.id,
    channelId: message.channelId,
    authorId: message.author?.id ?? "member",
    authorTag: message.author?.tag ?? "member",
    authorBot: message.author?.bot ?? false,
    content: message.content || "No text content",
    attachments: [...message.attachments.values()]
      .map((attachment) => attachment.name ?? "Attachment")
      .join("\n") || "No attachments",
    imageUrl: imageUrlFromMessage(message),
  };
}

function rememberMessage(message: Message): void {
  const snapshot = snapshotMessage(message);
  if (snapshot) snapshots.set(message.id, snapshot);
}

async function getSettings(guildId: string): Promise<LogSettings> {
  const cached = settingsCache.get(guildId);
  if (cached) return cached;
  const row = await prisma.$queryRaw<Array<{ channelId: string | null; enabled: string; ignoredChannels: string; ignoredRoles: string; ignoredUsers: string }>>`
    SELECT "channelId", "enabled", "ignoredChannels", "ignoredRoles", "ignoredUsers"
    FROM "ServerLogConfig" WHERE "guildId" = ${guildId} LIMIT 1
  `;
  const base = defaultSettings();
  if (row[0]) {
    try {
      base.channelId = row[0].channelId;
      base.enabled = { ...base.enabled, ...(JSON.parse(row[0].enabled) as Partial<Record<LogCategory, boolean>>) };
      base.ignoredChannels = JSON.parse(row[0].ignoredChannels) as string[];
      base.ignoredRoles = JSON.parse(row[0].ignoredRoles) as string[];
      base.ignoredUsers = JSON.parse(row[0].ignoredUsers) as string[];
    } catch (error) {
      console.error("Failed to parse server log settings", error);
    }
  }
  settingsCache.set(guildId, base);
  return base;
}

async function saveSettings(guildId: string, settings: LogSettings): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ServerLogConfig" ("guildId", "channelId", "enabled", "ignoredChannels", "ignoredRoles", "ignoredUsers")
    VALUES (${guildId}, ${settings.channelId}, ${JSON.stringify(settings.enabled)}, ${JSON.stringify(settings.ignoredChannels)}, ${JSON.stringify(settings.ignoredRoles)}, ${JSON.stringify(settings.ignoredUsers)})
    ON CONFLICT("guildId") DO UPDATE SET "channelId" = excluded."channelId", "enabled" = excluded."enabled",
      "ignoredChannels" = excluded."ignoredChannels", "ignoredRoles" = excluded."ignoredRoles", "ignoredUsers" = excluded."ignoredUsers"
  `;
  settingsCache.set(guildId, settings);
}

export async function configureLogs(guildId: string, update: Partial<LogSettings>): Promise<LogSettings> {
  const settings = await getSettings(guildId);
  const next = { ...settings, ...update, enabled: { ...settings.enabled, ...(update.enabled ?? {}) } };
  await saveSettings(guildId, next);
  return next;
}

export async function getLogSettings(guildId: string): Promise<LogSettings> {
  return getSettings(guildId);
}

export async function toggleLogCategory(guildId: string, category: LogCategory): Promise<LogSettings> {
  const settings = await getSettings(guildId);
  return configureLogs(guildId, { enabled: { ...settings.enabled, [category]: !settings.enabled[category] } });
}

export async function ignoreLogTarget(guildId: string, kind: "channel" | "role" | "user", id: string): Promise<LogSettings> {
  const settings = await getSettings(guildId);
  const key = kind === "channel" ? "ignoredChannels" : kind === "role" ? "ignoredRoles" : "ignoredUsers";
  const values = settings[key].includes(id) ? settings[key].filter((value) => value !== id) : [...settings[key], id];
  return configureLogs(guildId, { [key]: values });
}

async function auditActor(guild: Guild, type: AuditLogEvent, targetId?: string): Promise<string> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const entry = logs.entries.find((item) => Date.now() - item.createdTimestamp < 8_000 && (!targetId || (item.target as { id?: string } | null)?.id === targetId));
  return entry?.executor ? userText(entry.executor.id, entry.executor.tag) : "Actor not recorded";
  } catch {
    return "Actor not recorded";
  }
}

async function messageDeleteActor(guild: Guild, authorId: string, channelId: string): Promise<string> {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 });
    const entry = logs.entries.find((item) => {
      const extra = item.extra as { channel?: { id?: string } } | null;
      return Date.now() - item.createdTimestamp < 15_000 &&
        (item.target as { id?: string } | null)?.id === authorId &&
        (!extra?.channel?.id || extra.channel.id === channelId);
    });
    if (entry?.executor) return userText(entry.executor.id, entry.executor.tag);

    // Purges are recorded as one bulk-delete audit entry, while Discord may
    // still deliver individual MessageDelete gateway events for each message.
    const bulkLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageBulkDelete, limit: 10 });
    const bulkEntry = bulkLogs.entries.find((item) => {
      const extra = item.extra as { channel?: { id?: string } } | null;
      return Date.now() - item.createdTimestamp < 15_000 && extra?.channel?.id === channelId;
    });
    if (bulkEntry?.executor) return userText(bulkEntry.executor.id, bulkEntry.executor.tag);
  } catch {
    // The bot may not have View Audit Log permission, or Discord may not have
    // made the entry available yet.
  }
  return "";
}

function embed(guild: Guild, title: string, color: number, details: Array<[string, string]>, target?: string, imageUrl?: string | null, avatarUrl?: string | null): EmbedBuilder {
  const ids = new Map<string, string>();
  const clean = (value: string) => sanitizeLogText(value
    .replace(/<@!?([0-9]{17,20})>/g, (_all, id: string) => `${userText(id, globalClient?.users.cache.get(id)?.username)}`)
    .replace(/<#([0-9]{17,20})>/g, (_all, id: string) => idText(id))
    .replace(/<@&([0-9]{17,20})>/g, (_all, id: string) => `${guild.roles.cache.get(id)?.name ?? "role"}${idMarker("Role", id)}`), guild.id, ids);
  if (target) ids.set(`Target ID ${target}`, "");
  const fields = details.map(([name, value]) => ({ name: truncate(clean(name), 256), value: truncate(clean(value) || "No additional details", 1024), inline: true }));
  const footerIds = [...ids.keys()].join(" • ");
  const result = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(fields)
    .setFooter({ text: truncate(footerIds || "dea server log", 2048) })
    .setTimestamp();
  if (imageUrl) result.setImage(imageUrl);
  if (avatarUrl) result.setThumbnail(avatarUrl);
  return result;
}

function ignored(settings: LogSettings, category: LogCategory, message?: Message): boolean {
  if (!settings.enabled[category]) return true;
  if (!message) return false;
  const logChannelId = settings.channelId ?? process.env.LOG_CHANNEL_ID ?? DEFAULT_CHANNEL_ID;
  if (message.channelId === logChannelId) return true;
  if (message.author.bot && process.env.LOG_BOT_MESSAGES !== "true") return true;
  return settings.ignoredChannels.includes(message.channelId) ||
    settings.ignoredUsers.includes(message.author.id) ||
    (message.member?.roles.cache.some((role) => settings.ignoredRoles.includes(role.id)) ?? false);
}

export async function enqueue(guild: Guild, category: LogCategory, item: EmbedBuilder, file?: QueueItem["file"], message?: Message): Promise<void> {
  await getSettings(guild.id).then(async (settings) => {
    if (ignored(settings, category, message)) return;
    queue.push({ guildId: guild.id, embed: item, file });
    await drain();
  }).catch((error) => console.error("Failed to queue server log", error));
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, 10);
      const grouped = new Map<string, QueueItem[]>();
      for (const item of batch) grouped.set(item.guildId, [...(grouped.get(item.guildId) ?? []), item]);
      for (const [guildId, items] of grouped) {
        const channelId = (await getSettings(guildId)).channelId ?? process.env.LOG_CHANNEL_ID ?? DEFAULT_CHANNEL_ID;
        const channel = (await globalClient?.channels.fetch(channelId).catch(() => null)) as TextBasedChannel | null;
        if (!channel || !("send" in channel)) continue;
        try {
          await channel.send({ embeds: items.map((item) => item.embed), files: items.filter((item) => item.file).map((item) => item.file!) });
        } catch (error) {
          console.error("Failed to send server log", error);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    draining = false;
  }
}

let globalClient: Client | null = null;
let flushPendingVoiceLogs: () => void = () => {};
const botVoiceChanges = new Map<string, number>();
export function markVoiceChangeByBot(guildId: string, userId: string): void {
  const now = Date.now();
  for (const [key, at] of botVoiceChanges) if (now - at > 10_000) botVoiceChanges.delete(key);
  if (botVoiceChanges.size >= 1_000) botVoiceChanges.delete(botVoiceChanges.keys().next().value!);
  botVoiceChanges.set(`${guildId}:${userId}`, now);
}
export function logCommand(guild: Guild, userId: string, command: string, options: string, channelId: string, prefix = false): void {
  enqueue(guild, "commands", embed(guild, `${prefix ? "Prefix" : "Slash"} command used`, COLORS.command, [
    ["Who", `<@${userId}> (${userId})`], ["Command", `\`${command}\``], ["Options", truncate(options || "none", 1024)], ["Channel", idText(channelId)],
  ]));
}

export function logCommandError(guild: Guild, userId: string, command: string, error: unknown): void {
  enqueue(guild, "commands", embed(guild, "Command error", COLORS.delete, [["Who", `<@${userId}> (${userId})`], ["Command", command], ["Error", error instanceof Error ? error.message : String(error)] ]));
}

function readProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  return Reflect.get(value, key);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value)) return value.map(displayValue).join(", ") || "none";
  if (typeof value === "object") {
    return JSON.stringify(value, (_, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ) ?? String(value);
  }
  return String(value);
}

function genericTarget(item: unknown): string {
  const name = readProperty(item, "name") ?? readProperty(item, "code");
  const id = readProperty(item, "id");
  if (name && id && readProperty(item, "permissions") !== undefined) return `${String(name)}${idMarker("Role", String(id))}`;
  if (name && id && readProperty(item, "type") !== undefined && readProperty(item, "guild") !== undefined) return `${String(name)}${idMarker("Channel", String(id))}`;
  if (name && id && globalClient?.users.cache.has(String(id))) return userText(String(id), String(name));
  if (name && id) return `${String(name)} (${String(id)})`;
  if (name) return String(name);
  return id ? String(id) : "Event target not identified";
}

function changedProperties(
  previous: unknown,
  current: unknown,
  properties: readonly string[],
): string[] {
  return properties.flatMap((property) => {
    const readValue = (item: unknown) => {
      if (property !== "permissionOverwrites") return readProperty(item, property);
      const cache = readProperty(readProperty(item, property), "cache");
      if (!cache || typeof cache !== "object" || !("values" in cache)) return cache;
      const values = Reflect.get(cache, "values");
      if (typeof values !== "function") return cache;
      return [...(values.call(cache) as Iterable<unknown>)].map((overwrite) => ({
        id: readProperty(overwrite, "id"),
        allow: String(readProperty(readProperty(overwrite, "allow"), "bitfield")),
        deny: String(readProperty(readProperty(overwrite, "deny"), "bitfield")),
      }));
    };
    const before = readValue(previous);
    const after = readValue(current);
    if (displayValue(before) === displayValue(after)) return [];
    return [`${property}: ${displayValue(before)} → ${displayValue(after)}`];
  });
}

async function withInviteFetch<T>(guild: Guild, operation: () => Promise<T>): Promise<T> {
  const previous = inviteFetchQueues.get(guild.id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  inviteFetchQueues.set(guild.id, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (inviteFetchQueues.get(guild.id) === queued) {
      inviteFetchQueues.delete(guild.id);
    }
  }
}

async function loadInviteSnapshot(guild: Guild): Promise<InviteSnapshot> {
  const invites = await guild.invites.fetch();
  return new Map(
    [...invites.values()].map((invite) => [
      invite.code,
      {
        uses: invite.uses ?? 0,
        inviter: invite.inviter ? userText(invite.inviter.id, invite.inviter.tag) : "creator not identified",
      },
    ]),
  );
}

async function identifyJoinInvite(guild: Guild): Promise<string> {
  return withInviteFetch(guild, async () => {
    const previous = inviteSnapshots.get(guild.id);
    const current = await loadInviteSnapshot(guild);
    inviteSnapshots.set(guild.id, current);
    if (!previous) return "Not identified (invite tracking is initializing)";

    const increased = [...current.entries()].filter(
      ([code, invite]) => invite.uses > (previous.get(code)?.uses ?? 0),
    );
    if (increased.length === 1) {
      const [code, invite] = increased[0]!;
      return `${code} (created by ${invite.inviter}; ${invite.uses} uses)`;
    }
    if (increased.length > 1) return "Not identified (multiple invites were used)";
    return "Not identified (no invite usage increase detected)";
  });
}

function messageContent(message: Message): string {
  return message.content || "No text content";
}

function attachmentDetails(message: Message): string {
  return [...message.attachments.values()].map((attachment) => attachment.name ?? "Attachment").join("\n") || "No attachments";
}

export function registerServerLogger(client: Client): void {
  globalClient = client;
  client.once(Events.ClientReady, (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      void withInviteFetch(guild, async () => {
        inviteSnapshots.set(guild.id, await loadInviteSnapshot(guild));
      }).catch((error) => {
        console.warn(`Could not initialize invite tracking for guild ${guild.id}`, error);
      });
    }
  });
  const safe = (event: string, handler: (...args: any[]) => Promise<void> | void) => {
    client.on(event as never, (...args: any[]) => {
      void Promise.resolve(handler(...args)).catch((error) => console.error(`Server log handler failed for ${event}`, error));
    });
  };

  safe(Events.MessageDelete, async (message: Message) => {
    const full = message.partial ? await message.fetch().catch(() => null) : message;
    const snapshot = (full && snapshotMessage(full)) ?? snapshots.get(message.id);
    const guild = full?.guild ?? (snapshot ? globalClient?.guilds.cache.get(snapshot.guildId) : undefined);
    if (guild && snapshot) {
      const logChannelId = (await getSettings(guild.id)).channelId ?? process.env.LOG_CHANNEL_ID ?? DEFAULT_CHANNEL_ID;
      if (snapshot.channelId === logChannelId) { snapshots.delete(message.id); return; }
      const actor = await messageDeleteActor(guild, snapshot.authorId, snapshot.channelId);
      const deletedBy = deletedByLabel(actor, snapshot.authorBot);
      const authorAvatar = guild.members.cache.get(snapshot.authorId)?.displayAvatarURL({ extension: "png", size: 128 });
      enqueue(guild, "messages", embed(guild, "Message deleted", COLORS.delete, [
        ["Deleted by", deletedBy], ["Author", userText(snapshot.authorId, snapshot.authorTag)],
        ["Channel", idText(snapshot.channelId)], ["Content", snapshot.content], ["Attachments", snapshot.attachments],
      ], undefined, snapshot.imageUrl, authorAvatar));
      snapshots.delete(message.id);
    }
  });
  safe(Events.MessageUpdate, async (oldMessage: Message, newMessage: Message) => {
    if (!newMessage.guild) return;
    const before = oldMessage.partial ? snapshots.get(oldMessage.id)?.content : messageContent(oldMessage);
    const fetched = newMessage.partial ? await newMessage.fetch().catch(() => newMessage) : newMessage;
    enqueue(newMessage.guild, "messages", embed(newMessage.guild, "Message updated", COLORS.update, [
      ["Who", fetched.author ? userText(fetched.author.id, fetched.author.tag) : "Member not identified"],
      ["Channel", idText(fetched.channelId)], ["Before", before ?? "No previous snapshot available"],
      ["After", messageContent(fetched)], ["Attachments", attachmentDetails(fetched)],
    ], undefined, imageUrlFromMessage(fetched)), undefined, fetched);
    rememberMessage(fetched);
  });
  safe(Events.MessageBulkDelete, async (messages: any) => {
    const first = messages.first?.() as Message | undefined;
    if (first?.guild) enqueue(first.guild, "messages", embed(first.guild, "Messages bulk deleted", COLORS.delete, [["Who", await auditActor(first.guild, AuditLogEvent.MessageBulkDelete)], ["Channel", idText(first.channelId)], ["Count", String(messages.size)] ]));
  });
  safe(Events.MessageReactionAdd, async (reaction: any, user: any) => {
    const message = reaction.message as Message;
    if (message.guild) enqueue(message.guild, "messages", embed(message.guild, "Reaction added", COLORS.create, [["Who", userText(user.id, user.tag)], ["Emoji", reaction.emoji.toString()], ["Message", message.id], ["Channel", idText(message.channelId)]]), undefined, message);
  });
  safe(Events.MessageReactionRemove, async (reaction: any, user: any) => {
    const message = reaction.message as Message;
    if (message.guild) enqueue(message.guild, "messages", embed(message.guild, "Reaction removed", COLORS.delete, [["Who", userText(user.id, user.tag)], ["Emoji", reaction.emoji.toString()], ["Message", message.id], ["Channel", idText(message.channelId)]]), undefined, message);
  });
  safe(Events.MessageReactionRemoveAll, async (message: Message) => { if (message.guild) enqueue(message.guild, "messages", embed(message.guild, "All reactions removed", COLORS.delete, [["Who", await auditActor(message.guild, AuditLogEvent.MessagePin)], ["Message", message.id], ["Channel", idText(message.channelId)]])); });
  safe(Events.MessageReactionRemoveEmoji, async (reaction: any) => { const message = reaction.message as Message; if (message.guild) enqueue(message.guild, "messages", embed(message.guild, "Reaction emoji removed", COLORS.delete, [["Who", "Discord did not include the actor in this event"], ["Emoji", reaction.emoji.toString()], ["Message", message.id]])); });
  safe(Events.ChannelPinsUpdate, async (channel: any) => { if (channel.guild) enqueue(channel.guild, "messages", embed(channel.guild, "Channel pins updated", COLORS.update, [["Who", await auditActor(channel.guild, AuditLogEvent.MessagePin)], ["Channel", idText(channel.id)]])); });
  safe(Events.MessageCreate, async (message: Message) => {
    if (message.guild) rememberMessage(message);
  });

  safe(Events.GuildMemberAdd, async (member: GuildMember) => {
    let invite = "Invite not identified (Manage Server permission may be needed)";
    try {
      invite = await identifyJoinInvite(member.guild);
    } catch (error) {
      console.warn("Could not identify the invite used by a joining member", error);
    }
    enqueue(member.guild, "members", embed(member.guild, "Member joined", COLORS.create, [
      ["Who", userText(member.id, member.user.tag)],
      ["Account age", `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`],
      ["Invite", invite],
    ]));
  });
  safe(Events.GuildMemberRemove, async (member: GuildMember) => enqueue(member.guild, "members", embed(member.guild, "Member left", COLORS.delete, [["Who", userText(member.id, member.user.tag)], ["Actor", await auditActor(member.guild, AuditLogEvent.MemberKick, member.id)]])));
  safe(Events.GuildBanAdd, async (ban: any) => enqueue(ban.guild, "members", embed(ban.guild, "Member banned", COLORS.delete, [["Who", userText(ban.user.id, ban.user.tag)], ["Actor", await auditActor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id)], ["Reason", ban.reason ?? "No reason provided"]])));
  safe(Events.GuildBanRemove, async (ban: any) => enqueue(ban.guild, "members", embed(ban.guild, "Member unbanned", COLORS.create, [["Who", userText(ban.user.id, ban.user.tag)], ["Actor", await auditActor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id)], ["Reason", ban.reason ?? "No reason provided"]])));
  safe(Events.GuildMemberUpdate, async (oldMember: GuildMember, member: GuildMember) => {
    const changes: Array<[string, string]> = [];
    if (oldMember.nickname !== member.nickname) changes.push(["Nickname", `${oldMember.nickname ?? "none"} → ${member.nickname ?? "none"}`]);
    const added = member.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id)).map((role) => role.name);
    const removed = oldMember.roles.cache.filter((role) => !member.roles.cache.has(role.id)).map((role) => role.name);
    if (added.length) changes.push(["Roles added", added.join(", ")]);
    if (removed.length) changes.push(["Roles removed", removed.join(", ")]);
    if (oldMember.communicationDisabledUntilTimestamp !== member.communicationDisabledUntilTimestamp) changes.push(["Timeout", member.communicationDisabledUntilTimestamp ? `until <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:F>` : "removed"]);
    if (changes.length) enqueue(member.guild, "members", embed(member.guild, "Member updated", COLORS.update, [["Who", await auditActor(member.guild, AuditLogEvent.MemberUpdate, member.id)], ["Member", userText(member.id, member.user.tag)], ...changes]));
  });
  safe(Events.UserUpdate, async (oldUser: any, user: any) => { for (const guild of globalClient?.guilds.cache.values() ?? []) { if (oldUser.username !== user.username || oldUser.globalName !== user.globalName || oldUser.avatar !== user.avatar) enqueue(guild, "members", embed(guild, "User profile updated", COLORS.update, [["User", userText(user.id, user.tag)], ["Username", `${oldUser.username} → ${user.username}`], ["Global name", `${oldUser.globalName ?? "none"} → ${user.globalName ?? "none"}`], ["Avatar", oldUser.avatar !== user.avatar ? "changed" : "unchanged"]])); } });
  const voiceMembers = new Map<string, { guild: Guild; member: GuildMember }>();
  const voiceBatcher = new VoiceLogBatcher((key, changes) => {
    const context = voiceMembers.get(key);
    if (!context || !changes.length) return;
    const botDidIt = context.member.id === globalClient?.user?.id || botVoiceChanges.has(key);
    botVoiceChanges.delete(key);
    const write = enqueue(context.guild, "voice", embed(context.guild, changes[0]!.title, changes[changes.length - 1]!.color, [
      ["Member", userText(context.member.id, context.member.displayName)],
      ["Changed by", botDidIt ? "dea" : "Member"],
      ["Changes", changes.map((change) => change.text).join(", then ")],
    ], undefined, undefined, context.member.displayAvatarURL({ extension: "png", size: 128 })));
    pendingVoiceWrites.add(write);
    void write.finally(() => pendingVoiceWrites.delete(write));
    voiceMembers.delete(key);
  });
  flushPendingVoiceLogs = () => voiceBatcher.flushAll();
  safe(Events.VoiceStateUpdate, async (oldState: any, newState: any) => {
    const member = newState.member ?? oldState.member;
    if (!member || (member.user.bot && member.id !== globalClient?.user?.id && process.env.LOG_BOT_MESSAGES !== "true")) return;
    const changes = describeVoiceChanges(oldState, newState);
    if (!changes.length) return;
    const key = `${member.guild.id}:${member.id}`;
    voiceMembers.set(key, { guild: member.guild, member });
    const botChangeKey = `${member.guild.id}:${member.id}`;
    const botDidChange = Date.now() - (botVoiceChanges.get(botChangeKey) ?? 0) < 10_000;
    for (const change of changes) voiceBatcher.add(key, botDidChange && change.title.startsWith("Server ")
      ? { ...change, text: `${change.text} by dea` }
      : change);
  });
  process.once("SIGINT", flushPendingVoiceLogs);
  process.once("SIGTERM", flushPendingVoiceLogs);

  safe(Events.InviteCreate, async (invite: any) => {
    const guild = invite.guild as Guild | null;
    if (!guild) return;
    inviteSnapshots.get(guild.id)?.set(invite.code, {
      uses: invite.uses ?? 0,
      inviter: invite.inviter ? userText(invite.inviter.id, invite.inviter.tag) : "creator not identified",
    });
    enqueue(guild, "server", embed(guild, "Invite created", COLORS.create, [
      ["Actor", invite.inviter ? userText(invite.inviter.id, invite.inviter.tag) : "Invite creator not identified"],
      ["Code", invite.code],
      ["Channel", idText(invite.channelId)],
      ["Uses", `${invite.uses ?? 0}${invite.maxUses ? ` / ${invite.maxUses}` : " / unlimited"}`],
      ["Expires", invite.maxAge ? `${invite.maxAge} seconds` : "Never"],
    ]));
  });
  safe(Events.ThreadMembersUpdate, async (_members: any, added: any, removed: any, thread: any) => {
    const guild = thread?.guild as Guild | undefined;
    if (!guild) return;
    const formatMembers = (collection: any) =>
      [...(collection?.values?.() ?? [])]
      .map((member: any) => userText(member.id, member.user?.username ?? member.username))
        .join(", ") || "none";
    enqueue(guild, "channels", embed(guild, "Thread members updated", COLORS.update, [
      ["Thread", genericTarget(thread)],
      ["Added", formatMembers(added)],
      ["Removed", formatMembers(removed)],
    ]));
  });
  const logScheduledEventUser = (title: string, color: number) =>
    async (event: any, user: any) => {
      const guild = event?.guild as Guild | undefined;
      if (!guild) return;
      enqueue(guild, "server", embed(guild, title, color, [
        ["Event", genericTarget(event)],
        ["User", user ? userText(user.id, user.tag ?? user.username) : "Member not identified"],
      ]));
    };
  safe(Events.GuildScheduledEventUserAdd, logScheduledEventUser("Scheduled event user joined", COLORS.create));
  safe(Events.GuildScheduledEventUserRemove, logScheduledEventUser("Scheduled event user left", COLORS.delete));

  type GenericLog = {
    event: string;
    category: LogCategory;
    title: string;
    color: number;
    auditType?: AuditLogEvent;
    update?: boolean;
  };
  const generic: GenericLog[] = [
    { event: Events.ChannelCreate, category: "channels", title: "Channel created", color: COLORS.create, auditType: AuditLogEvent.ChannelCreate },
    { event: Events.ChannelDelete, category: "channels", title: "Channel deleted", color: COLORS.delete, auditType: AuditLogEvent.ChannelDelete },
    { event: Events.ChannelUpdate, category: "channels", title: "Channel updated", color: COLORS.update, auditType: AuditLogEvent.ChannelUpdate, update: true },
    { event: Events.ThreadCreate, category: "channels", title: "Thread created", color: COLORS.create, auditType: AuditLogEvent.ThreadCreate },
    { event: Events.ThreadDelete, category: "channels", title: "Thread deleted", color: COLORS.delete, auditType: AuditLogEvent.ThreadDelete },
    { event: Events.ThreadUpdate, category: "channels", title: "Thread updated", color: COLORS.update, auditType: AuditLogEvent.ThreadUpdate, update: true },
    { event: Events.GuildRoleCreate, category: "roles", title: "Role created", color: COLORS.create, auditType: AuditLogEvent.RoleCreate },
    { event: Events.GuildRoleDelete, category: "roles", title: "Role deleted", color: COLORS.delete, auditType: AuditLogEvent.RoleDelete },
    { event: Events.GuildRoleUpdate, category: "roles", title: "Role updated", color: COLORS.update, auditType: AuditLogEvent.RoleUpdate, update: true },
    { event: Events.GuildUpdate, category: "server", title: "Server updated", color: COLORS.update, auditType: AuditLogEvent.GuildUpdate, update: true },
    { event: Events.GuildEmojiCreate, category: "server", title: "Emoji created", color: COLORS.create, auditType: AuditLogEvent.EmojiCreate },
    { event: Events.GuildEmojiDelete, category: "server", title: "Emoji deleted", color: COLORS.delete, auditType: AuditLogEvent.EmojiDelete },
    { event: Events.GuildEmojiUpdate, category: "server", title: "Emoji updated", color: COLORS.update, auditType: AuditLogEvent.EmojiUpdate, update: true },
    { event: Events.GuildCreate, category: "server", title: "Bot added to server", color: COLORS.create, auditType: AuditLogEvent.BotAdd },
    { event: Events.GuildDelete, category: "server", title: "Bot removed from server", color: COLORS.delete },
    { event: Events.GuildStickerCreate, category: "server", title: "Sticker created", color: COLORS.create, auditType: AuditLogEvent.StickerCreate },
    { event: Events.GuildStickerDelete, category: "server", title: "Sticker deleted", color: COLORS.delete, auditType: AuditLogEvent.StickerDelete },
    { event: Events.GuildStickerUpdate, category: "server", title: "Sticker updated", color: COLORS.update, auditType: AuditLogEvent.StickerUpdate, update: true },
    { event: Events.InviteDelete, category: "server", title: "Invite deleted", color: COLORS.delete, auditType: AuditLogEvent.InviteDelete },
    { event: Events.WebhooksUpdate, category: "server", title: "Webhooks updated", color: COLORS.update },
    { event: Events.GuildIntegrationsUpdate, category: "server", title: "Integrations updated", color: COLORS.update },
    { event: Events.StageInstanceCreate, category: "voice", title: "Stage instance created", color: COLORS.create, auditType: AuditLogEvent.StageInstanceCreate },
    { event: Events.StageInstanceUpdate, category: "voice", title: "Stage instance updated", color: COLORS.update, auditType: AuditLogEvent.StageInstanceUpdate, update: true },
    { event: Events.StageInstanceDelete, category: "voice", title: "Stage instance deleted", color: COLORS.delete, auditType: AuditLogEvent.StageInstanceDelete },
    { event: Events.GuildScheduledEventCreate, category: "server", title: "Scheduled event created", color: COLORS.create, auditType: AuditLogEvent.GuildScheduledEventCreate },
    { event: Events.GuildScheduledEventDelete, category: "server", title: "Scheduled event deleted", color: COLORS.delete, auditType: AuditLogEvent.GuildScheduledEventDelete },
    { event: Events.GuildScheduledEventUpdate, category: "server", title: "Scheduled event updated", color: COLORS.update, auditType: AuditLogEvent.GuildScheduledEventUpdate, update: true },
    { event: Events.AutoModerationRuleCreate, category: "automod", title: "Automod rule created", color: COLORS.create, auditType: AuditLogEvent.AutoModerationRuleCreate },
    { event: Events.AutoModerationRuleUpdate, category: "automod", title: "Automod rule updated", color: COLORS.update, auditType: AuditLogEvent.AutoModerationRuleUpdate, update: true },
    { event: Events.AutoModerationRuleDelete, category: "automod", title: "Automod rule deleted", color: COLORS.delete, auditType: AuditLogEvent.AutoModerationRuleDelete },
    { event: Events.AutoModerationActionExecution, category: "automod", title: "Automod action executed", color: COLORS.delete },
  ];
  const trackedProperties: Record<LogCategory, string[]> = {
    messages: [],
    members: [],
    voice: [],
    channels: ["name", "topic", "type", "parentId", "bitrate", "userLimit", "rateLimitPerUser", "nsfw", "position", "archived", "locked", "invitable", "permissionOverwrites"],
    roles: ["name", "color", "hoist", "mentionable", "position", "permissions"],
    server: ["name", "description", "verificationLevel", "explicitContentFilter", "defaultMessageNotifications", "preferredLocale"],
    commands: [],
    automod: ["name", "enabled", "eventType", "triggerType"],
  };

  for (const config of generic) {
    safe(config.event, async (...args: any[]) => {
      const previous = args[0];
      const item = config.update ? args[1] : args[0];
      const guild = readProperty(item, "guild") as Guild | undefined
        ?? (readProperty(item, "guildId")
          ? globalClient?.guilds.cache.get(String(readProperty(item, "guildId")))
          : undefined)
        ?? (readProperty(item, "commands") ? item as Guild : undefined);
      if (!guild) return;

      const id = config.auditType === AuditLogEvent.BotAdd
        ? globalClient?.user?.id
        : config.auditType === AuditLogEvent.InviteDelete
          ? readProperty(item, "code") ?? readProperty(item, "id")
          : readProperty(item, "id");
      const actor = config.auditType
        ? await auditActor(guild, config.auditType, id ? String(id) : undefined)
        : "Actor not recorded";
      const details = config.update
        ? changedProperties(previous, item, trackedProperties[config.category])
        : [];
      const values: Array<[string, string]> = [
        ["Actor", actor],
        ["Target", genericTarget(item)],
      ];
      if (details.length > 0) {
        values.push(["Changes", details.join("\n")]);
      } else if (config.update) {
        values.push(["Changes", "No tracked properties changed"]);
      } else {
        const type = readProperty(item, "type");
        if (type !== undefined) values.push(["Type", displayValue(type)]);
      }
      enqueue(guild, config.category, embed(guild, config.title, config.color, values));
    });
  }
}

export async function flushVoiceLogs(): Promise<void> {
  flushPendingVoiceLogs();
  while (pendingVoiceWrites.size) await Promise.all([...pendingVoiceWrites]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!draining && queue.length) await drain();
  while (draining || queue.length) await new Promise((resolve) => setTimeout(resolve, 25));
}
