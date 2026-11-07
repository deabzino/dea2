export function sanitizeLogText(raw: string, guildId: string, ids: Map<string, string>): string {
  return raw
    .replace(/\u2063\{(User|Channel|Role):([0-9]{5,})\}\u2063/g, (_all, kind: string, id: string) => { ids.set(`${kind} ID ${id}`, ""); return ""; })
    .replace(/\b[0-9]{17,20}\b/g, (id) => { if (id !== guildId) ids.set(`ID ${id}`, ""); return ""; })
    .replace(/\b(?:Unavailable|undefined|null)\b/gi, "Not recorded")
    .replace(/\b(true|false)\b/gi, (value) => value.toLowerCase() === "true" ? "Enabled" : "Disabled")
    .replace(/\s{2,}/g, " ").trim();
}

export function deletedByLabel(matchingActor: string, authorIsBot: boolean): string {
  if (matchingActor) return matchingActor;
  return authorIsBot
    ? "Probably removed by a bot or the author"
    : "Probably the author (Discord doesn't record when someone deletes their own message)";
}
