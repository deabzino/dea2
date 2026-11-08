import assert from "node:assert/strict";
import test from "node:test";
import { commandLogDetails, formatRoleList, formatUserLabel, optionalActorField, sanitizeLogText, deletedByLabel } from "./logFormatting.ts";
import { describeVoiceChanges, VoiceLogBatcher } from "./voiceLogBatcher.ts";

const GUILD = "1014163878478884997";
const USER = "692768149665349672";

function fixture(channelId, options = {}) {
  return {
    channelId,
    channel: channelId ? { id: channelId, name: channelId === "a" ? "Voice 1" : "Voice 2" } : null,
    serverMute: false, serverDeaf: false, selfMute: false, selfDeaf: false,
    streaming: false, selfVideo: false, ...options,
  };
}

function formatFields(fields) {
  const ids = new Map();
  const output = fields.map(([name, value]) => [sanitizeLogText(name, GUILD, ids), sanitizeLogText(value, GUILD, ids)]);
  return { output, footer: [...ids.keys()].join(" • ") };
}

test("voice transitions have clear titles and no boolean text", () => {
  const cases = [
    [fixture(null), fixture("a"), "Joined voice channel"],
    [fixture("a"), fixture(null), "Left voice channel"],
    [fixture("a"), fixture("b"), "Switched voice channel"],
    [fixture("a"), fixture("a", { serverMute: true }), "Server muted"],
    [fixture("a"), fixture("a", { selfMute: true }), "Muted themselves"],
  ];
  for (const [oldState, newState, expected] of cases) {
    const changes = describeVoiceChanges(oldState, newState);
    assert.equal(changes[0]?.title, expected);
    assert.doesNotMatch(changes.map((change) => change.text).join(" "), /\b(?:true|false)\b/i);
  }
  assert.match(describeVoiceChanges(fixture(null), fixture("a"))[0].text, /🔊 Voice 1/);
  assert.match(describeVoiceChanges(fixture("a"), fixture(null))[0].text, /Left: 🔊 Voice 1/);
  assert.match(describeVoiceChanges(fixture("a"), fixture("b"))[0].text, /From: Voice 1 → To: Voice 2/);
});

test("voice bursts for one member are combined in order and flush at shutdown", async () => {
  const emitted = [];
  const batcher = new VoiceLogBatcher((key, changes) => { emitted.push({ key, changes: changes.map((change) => change.text) }); }, 3_000, 2);
  batcher.add(`${GUILD}:${USER}`, { title: "Joined voice channel", text: "Joined Voice 1", color: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  batcher.add(`${GUILD}:${USER}`, { title: "Server muted", text: "Was server-muted by dea", color: 2 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  batcher.add(`${GUILD}:${USER}`, { title: "Muted themselves", text: "Muted themselves", color: 2 });
  assert.equal(emitted.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 3_100));
  assert.deepEqual(emitted, [{ key: `${GUILD}:${USER}`, changes: ["Joined Voice 1", "Was server-muted by dea", "Muted themselves"] }]);

  batcher.add("shutdown-user", { title: "Left voice channel", text: "Left: Voice 1", color: 3 });
  batcher.flushAll();
  assert.equal(emitted.length, 2);
  assert.equal(batcher.size, 0);

  const capped = new VoiceLogBatcher((key, changes) => { emitted.push({ key, changes: changes.map((change) => change.text) }); }, 60_000, 1);
  capped.add("oldest", { title: "Joined voice channel", text: "Joined Voice 1", color: 1 });
  capped.add("newer", { title: "Left voice channel", text: "Left Voice 1", color: 2 });
  assert.equal(capped.size, 1);
  assert.deepEqual(emitted.at(-1), { key: "oldest", changes: ["Joined Voice 1"] });
  capped.flushAll();
});

test("message deletion wording handles audit matches, users and bots", () => {
  assert.equal(deletedByLabel("@mod (moderator)", false), "@mod (moderator)");
  assert.equal(deletedByLabel("", false), "Probably the author (Discord doesn't record when someone deletes their own message)");
  assert.equal(deletedByLabel("", true), "Probably removed by a bot or the author");
});

test("log formatting omits empty brackets and actor placeholders", () => {
  assert.equal(formatUserLabel("Arian", "keruptedd"), "@Arian (keruptedd)");
  assert.equal(formatUserLabel("Arian", "Arian"), "@Arian");
  assert.equal(formatUserLabel("Arian", null), "@Arian");
  assert.deepEqual(optionalActorField(""), []);
});

test("command details include prefix and channel mention without empty options", () => {
  const details = commandLogDetails(USER, "nwordleaderboard", "", "1014164674679427164", true);
  assert.deepEqual(details, [
    ["Who", `<@${USER}>`],
    ["Command", "`.nwordleaderboard`"],
    ["Channel", "<#1014164674679427164>"],
  ]);
});

test("role lists are consistently sorted, markdown escaped, and capped", () => {
  const names = ["DJ", "Members", "'", "Role_3", "Role_4", "Role_5", "Role_6", "Role_7", "Role_8", "Role_9", "Role_10", "Role_11"];
  assert.equal(formatRoleList(names), "', DJ, Members, Role\\_10, Role\\_11, Role\\_3, Role\\_4, Role\\_5, Role\\_6, Role\\_7 +2 more");
});

test("clean member, channel and other-event fields keep IDs in the footer only", () => {
  const { output, footer } = formatFields([
    ["Member", `@Sabbir (monkey.d.luffy)\u2063{User:${USER}}\u2063`],
    ["Channel", `🔊 Voice 1\u2063{Channel:1014164674679427164}\u2063`],
    ["Changed", "Enabled → Disabled"],
    ["Target", "#welcome 1014164674679427165"],
  ]);
  const values = output.flat().join(" ");
  assert.doesNotMatch(values, /\d{17,20}|Unavailable|undefined|null|Actor unavailable/i);
  assert.match(footer, /User ID 692768149665349672/);
  assert.match(footer, /Channel ID 1014164674679427164/);
  assert.match(footer, /ID 1014164674679427165/);
  assert.doesNotMatch(footer, new RegExp(GUILD));
});

test("marked IDs do not get duplicated in the footer and channel mentions survive sanitizing", () => {
  const ids = new Map();
  const value = sanitizeLogText(`@Arian (keruptedd)\u2063{User:${USER}}\u2063 <#1014164674679427164>`, GUILD, ids);
  assert.equal(value, "@Arian (keruptedd) <#1014164674679427164>");
  assert.deepEqual([...ids.keys()], [`User ID ${USER}`]);
});
