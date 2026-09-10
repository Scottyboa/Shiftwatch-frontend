import test from "node:test";
import assert from "node:assert/strict";
import { parseSimpleEvent, mergeSimpleEvents, simpleEventLines, SIMPLE_LOG_TTL_MS, SIMPLE_LOG_PREFIX } from "../src/simple-log-core.js";
import { FrontendSimpleLog } from "../src/simple-log.js";

const now = Date.parse("2026-09-09T14:00:00Z");
const iso = (offset) => new Date(now + offset).toISOString();
const shift = { date: "2026-09-19", start: "12:00", end: "20:00", type: "Kv/Mellom1", location: "Moss" };
function report(agent, status = "failed") {
  return { agent_id: agent, at_utc: iso(-90_000), mail: { matches: true },
    claim: { status, at_utc: iso(-90_000) } };
}
function event(reports = [report("a")], fields = {}) {
  return { schema_version: 1, event_id: "a".repeat(64), first_seen_at_utc: iso(-150_000),
    expires_at_utc: iso(SIMPLE_LOG_TTL_MS - 150_000), settle_after_utc: iso(-30_000), shift, reports, ...fields };
}

test("one winner hides all loser failures; success cannot be downgraded by stale snapshots", () => {
  const won = parseSimpleEvent(event([report("a", "claimed"), report("b"), report("c")]));
  const stale = parseSimpleEvent(event([report("a", "pending"), report("b")]));
  const merged = mergeSimpleEvents([won, stale, won, stale], now);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].reports.length, 4);
  const lines = simpleEventLines(merged[0], now);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].text, "Vakten ble overtatt.");
  assert.ok(!lines.some((line) => line.kind === "failure"));
});

test("nonmatches collapse; different message IDs remain distinct even for the same shift", () => {
  const nonmatch = { agent_id: "a", at_utc: iso(-10_000), mail: { matches: false, reason: "Datoen er ekskludert" } };
  const a = parseSimpleEvent(event([nonmatch]));
  const b = parseSimpleEvent(event([nonmatch], { event_id: "b".repeat(64) }));
  assert.equal(mergeSimpleEvents([a, a, b], now).length, 2);
  assert.equal(simpleEventLines(a, now).length, 1);
  assert.match(simpleEventLines(a, now)[0].text, /MATCHER IKKE KRITERIENE: Datoen er ekskludert/u);
});

test("failed claims settle once; pending/unknown is not fabricated into success or failure", () => {
  const failed = parseSimpleEvent(event());
  assert.equal(simpleEventLines(failed, now)[1].kind, "failure");
  assert.equal(simpleEventLines(failed, now - 60_000)[1].kind, "pending");
  const pending = parseSimpleEvent(event([report("a", "pending")]));
  assert.equal(simpleEventLines(pending, now)[1].kind, "pending");
  const updated = mergeSimpleEvents([pending, failed], now)[0];
  assert.equal(simpleEventLines(updated, now)[1].kind, "failure");
  const skipped = parseSimpleEvent(event([{ ...report("a", "skipped"), claim: { status: "skipped", at_utc: iso(-90_000), reason: "Har allerede lørdagsvakt" } }]));
  assert.match(simpleEventLines(skipped, now)[1].text, /ikke forsøkt.*lørdagsvakt/u);
});

test("advertisement is shown only for enabled replacement and confirmed global claim", () => {
  const adReport = { ...report("loser"), upgrade_enabled: true,
    advertisement: { status: "advertised", at_utc: iso(-60_000), shift: { ...shift, date: "2026-09-14" } } };
  assert.equal(simpleEventLines(parseSimpleEvent(event([adReport])), now).length, 2);
  const won = parseSimpleEvent(event([adReport, report("winner", "claimed")]));
  assert.equal(simpleEventLines(won, now).length, 3);
  assert.match(simpleEventLines(won, now)[2].text, /markert ledig/u);
  adReport.advertisement.status = "failed";
  assert.match(simpleEventLines(parseSimpleEvent(event([adReport, report("winner", "claimed")])), now)[2].text, /manuelt/u);
  assert.throws(() => parseSimpleEvent(event([{ ...adReport, upgrade_enabled: false }])));
});

test("48-hour retention is exact, capped, independent of later reports, and never renewed", () => {
  const payload = parseSimpleEvent(event([report("a")], { first_seen_at_utc: iso(-SIMPLE_LOG_TTL_MS),
    expires_at_utc: iso(99 * 3600_000), settle_after_utc: iso(-SIMPLE_LOG_TTL_MS + 120_000) }));
  assert.equal(payload.expires_at_utc, iso(0));
  assert.equal(mergeSimpleEvents([payload], now - 1).length, 1);
  assert.equal(mergeSimpleEvents([payload], now).length, 0);
  assert.throws(() => parseSimpleEvent(event([], {})));
  assert.throws(() => parseSimpleEvent(event([report("a")], { expires_at_utc: iso(-99999999) })));
});

test("only valid, expired, correctly named event files can be deleted with their original eTag", async () => {
  const expired = event([report("a")], { first_seen_at_utc: iso(-SIMPLE_LOG_TTL_MS),
    expires_at_utc: iso(0), settle_after_utc: iso(-SIMPLE_LOG_TTL_MS + 120_000) });
  const deleted = [];
  const files = [
    { id: "old", name: `${SIMPLE_LOG_PREFIX}${"a".repeat(64)}.json`, eTag: "v1" },
    { id: "bad", name: `${SIMPLE_LOG_PREFIX}${"b".repeat(64)}.json`, eTag: "v2" },
    { id: "calendar", name: "shiftwatch_calendar_config.json", eTag: "v3" },
    { id: "unknown", name: "shiftwatch_simple_event_unknown.json", eTag: "v4" },
  ];
  const log = new FrontendSimpleLog({ listMetadata: async () => files,
    downloadJsonItem: async (id) => id === "old" ? expired : { unrelated: true },
    deleteJsonItem: async (id, tag) => deleted.push([id, tag]),
  }, { now: () => now });
  const result = await log.load();
  assert.deepEqual(deleted, [["old", "v1"]]);
  assert.equal(result.events.length, 0);
  assert.equal(result.unreadable, 1);
});

test("etag cache reduces reads and a malformed replacement preserves the previous event", async () => {
  let version = "a", reads = 0, corrupt = false;
  const log = new FrontendSimpleLog({ listMetadata: async () => [{ id: "event", name: `${SIMPLE_LOG_PREFIX}${"a".repeat(64)}.json`, eTag: version }],
    downloadJsonItem: async () => { reads++; return corrupt ? {} : event(); } }, { now: () => now });
  assert.equal((await log.load()).events.length, 1);
  assert.equal((await log.load()).events.length, 1);
  assert.equal(reads, 1);
  version = "b"; corrupt = true;
  const result = await log.load();
  assert.equal(result.events.length, 1);
  assert.equal(result.unreadable, 1);
});
