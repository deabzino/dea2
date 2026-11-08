export type VoiceLogChange = { title: string; text: string; color: number };
type Batch = { changes: VoiceLogChange[]; timer: NodeJS.Timeout };

export class VoiceLogBatcher {
  private readonly batches = new Map<string, Batch>();
  private readonly emit: (key: string, changes: VoiceLogChange[]) => void | Promise<void>;
  private readonly delayMs: number;
  private readonly maxKeys: number;
  constructor(
    emit: (key: string, changes: VoiceLogChange[]) => void | Promise<void>,
    delayMs = 3_000,
    maxKeys = 500,
  ) {
    this.emit = emit;
    this.delayMs = delayMs;
    this.maxKeys = maxKeys;
  }

  add(key: string, change: VoiceLogChange): void {
    let batch = this.batches.get(key);
    if (!batch && this.batches.size >= this.maxKeys) {
      const oldest = this.batches.keys().next().value as string | undefined;
      if (oldest) this.flush(oldest);
    }
    batch = this.batches.get(key);
    if (batch) clearTimeout(batch.timer);
    const changes = batch?.changes ?? [];
    changes.push(change);
    const timer = setTimeout(() => this.flush(key), this.delayMs);
    timer.unref?.();
    this.batches.set(key, { changes, timer });
  }

  flush(key: string): void {
    const batch = this.batches.get(key);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.batches.delete(key);
    void this.emit(key, batch.changes);
  }

  flushAll(): void {
    for (const key of [...this.batches.keys()]) this.flush(key);
  }

  get size(): number { return this.batches.size; }
}

export function describeVoiceChanges(oldState: any, newState: any): VoiceLogChange[] {
  const changes: VoiceLogChange[] = [];
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  const oldId = oldState.channelId;
  const newId = newState.channelId;
  const label = (channel: any, id?: string | null) => id && /^[0-9]{17,20}$/.test(id) ? `<#${id}>` : channel?.name ?? "voice channel";
  const add = (title: string, text: string, color: number) => changes.push({ title, text, color });
  if (!oldId && newId) add("Joined voice channel", `Joined 🔊 ${label(newChannel, newId)}`, 0x57f287);
  else if (oldId && !newId) add("Left voice channel", `Left: 🔊 ${label(oldChannel, oldId)}`, 0xed4245);
  else if (oldId && newId && oldId !== newId) add("Switched voice channel", `From: ${label(oldChannel, oldId)} → To: ${label(newChannel, newId)}`, 0x5865f2);
  if (oldState.serverMute !== newState.serverMute) add(newState.serverMute ? "Server muted" : "Server unmuted", newState.serverMute ? "Was server-muted" : "Was server-unmuted", 0xf2c879);
  if (oldState.serverDeaf !== newState.serverDeaf) add(newState.serverDeaf ? "Server deafened" : "Server undeafened", newState.serverDeaf ? "Was server-deafened" : "Was server-undeafened", 0xf2c879);
  if (oldState.selfMute !== newState.selfMute) add(newState.selfMute ? "Muted themselves" : "Unmuted themselves", newState.selfMute ? "Muted themselves" : "Unmuted themselves", 0xf2c879);
  if (oldState.selfDeaf !== newState.selfDeaf) add(newState.selfDeaf ? "Deafened themselves" : "Undeafened themselves", newState.selfDeaf ? "Deafened themselves" : "Undeafened themselves", 0xf2c879);
  if (oldState.streaming !== newState.streaming) add(newState.streaming ? "Started streaming" : "Stopped streaming", newState.streaming ? "Started streaming" : "Stopped streaming", 0x5865f2);
  if (oldState.selfVideo !== newState.selfVideo) add(newState.selfVideo ? "Turned camera on" : "Turned camera off", newState.selfVideo ? "Turned camera on" : "Turned camera off", 0x5865f2);
  return changes;
}
