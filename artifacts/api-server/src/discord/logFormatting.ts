export function sanitizeLogText(raw: string, guildId: string, ids: Map<string, string>): string {
  return raw
    .replace(/\u2063\{(User|Channel|Role):([0-9]{5,})\}\u2063/g, (_all, kind: string, id: string) => { ids.set(`${kind} ID ${id}`, ""); return ""; })
    .replace(/(?<![#@&])\b[0-9]{17,20}\b/g, (id) => { if (id !== guildId && ![...ids.keys()].some((key) => key.endsWith(`ID ${id}`))) ids.set(`ID ${id}`, ""); return ""; })
    .replace(/<@([0-9]{17,20})>/g, (_all, id: string) => `<@${id}>`)
    .replace(/<@&([0-9]{17,20})>/g, (_all, id: string) => `<@&${id}>`)
    .replace(/<\#([0-9]{17,20})>/g, (_all, id: string) => `<#${id}>`)
    .replace(/\b(?:Unavailable|undefined|null)\b/gi, "Not recorded")
    .replace(/\b(true|false)\b/gi, (value) => value.toLowerCase() === "true" ? "Enabled" : "Disabled")
    .replace(/\s{2,}/g, " ").trim();
}

export function formatUserLabel(displayName: string, username?: string | null): string {
  return `@${displayName}${username && username !== displayName ? ` (${username})` : ""}`;
}

export function formatRoleList(names: readonly string[], limit = 10): string {
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b));
  const visible = sorted.slice(0, limit).map((name) => name.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, "\\$&"));
  const remainder = sorted.length - visible.length;
  return remainder > 0 ? `${visible.join(", ")} +${remainder} more` : visible.join(", ");
}

export function optionalActorField(actor: string): [string, string][] {
  return actor ? [["Actor", actor]] : [];
}

export function commandLogDetails(userId: string, command: string, options: string, channelId: string, prefix: boolean): [string, string][] {
  return [
    ["Who", `<@${userId}>`],
    ["Command", `\`${prefix ? "." : "/"}${command}\``],
    ...(options.trim() ? [["Options", options.trim()] as [string, string]] : []),
    ["Channel", `<#${channelId}>`],
  ];
}

export type MessageDeleteAuditStatus = "available" | "permission_missing" | "unavailable";

export function userMentionMarker(id: string | null | undefined): string {
  return id && /^[0-9]{17,20}$/.test(id) ? `\u2063{MentionUser:${id}}\u2063` : "";
}

export function deletedByLabel(
  authorId: string | null | undefined,
  authorUsername: string | null | undefined,
  actorId: string | null | undefined,
  actorUsername: string | null | undefined,
  auditStatus: MessageDeleteAuditStatus,
): string {
  const author = userMentionMarker(authorId);
  const authorDetails = author ? `${author} (${authorUsername || "username unavailable"})` : "author not identified";
  const actor = userMentionMarker(actorId);
  if (actor) return `${actor} (${actorUsername || "username unavailable"})`;
  if (auditStatus !== "available") {
    const reason = auditStatus === "permission_missing" ? "View Audit Log permission missing" : "audit log unavailable";
    return `Actor not identified (${reason}); author: ${authorDetails}`;
  }
  return author
    ? `${author} (${authorUsername || "username unavailable"}; probably deleted their own message)`
    : "Actor not identified (author unavailable; probably a self-delete)";
}
