import test from "node:test";
import assert from "node:assert/strict";
import { weekStart, weekLabel, weeksInSelection, normalizeWeeks, buildWeeklyUpgrade, parseWeeklyUpgrade,
  desiredUpgradeDays, WEEKLY_UPGRADE_FILE } from "../src/weekly-upgrade-core.js";
import { FrontendWeeklyUpgrade } from "../src/weekly-upgrade.js";
import { OneDriveCalendarStore } from "../src/onedrive-sync.js";

test("ISO weeks cross months and years without merging week 1 from different years", () => {
  assert.equal(weekStart("2027-01-03"), "2026-12-28");
  assert.equal(weekLabel("2026-12-28"), "Uke 53, 2026");
  assert.equal(weekLabel("2027-01-04"), "Uke 1, 2027");
  assert.deepEqual(weeksInSelection("2026-12-31", "2027-01-09"), ["2026-12-28", "2027-01-04"]);
  assert.deepEqual(weeksInSelection("2027-01-09", "2026-12-31"), ["2026-12-28", "2027-01-04"]);
  assert.deepEqual(weeksInSelection(null), []);
  assert.deepEqual(normalizeWeeks(["2026-09-14", "2026-09-14"]), ["2026-09-14"]);
  assert.throws(() => normalizeWeeks(["2026-09-15"]));
});

test("weekly policy defaults off and rejects unsupported safety or priority rules", () => {
  const payload = buildWeeklyUpgrade([]);
  assert.deepEqual(payload.enabled_week_starts, []);
  for (const change of [{ schema_version: 2 }, { claim_before_advertise: false },
    { require_calendar_match: false }, { replacement_limit: 3 }, { priority_order: [["thursday"], ["saturday"]] }]) {
    assert.throws(() => parseWeeklyUpgrade({ ...payload, ...change }));
  }
});

test("weekly markers do not override calendar exclusions, dates or matching fields", () => {
  const calendar = { allowed_date_ranges: [{ start: "2026-09-14", end: "2026-09-20", weekdays: ["thursday", "saturday"] }],
    exclude_dates: ["2026-09-19"], extra_include_dates: [] };
  const before = JSON.stringify(calendar);
  assert.deepEqual(desiredUpgradeDays("2026-09-14", calendar, "2026-09-01"), ["2026-09-17"]);
  calendar.exclude_dates.push("2026-09-17");
  assert.deepEqual(desiredUpgradeDays("2026-09-14", calendar, "2026-09-01"), []);
  calendar.exclude_dates.pop();
  assert.equal(JSON.stringify(calendar), before);
});

test("missing remote policy is off; malformed/changed policy is not overwritten", async () => {
  const service = new FrontendWeeklyUpgrade({ getMetadataFor: async () => null });
  assert.deepEqual(await service.load(), { metadata: null, payload: null, weeks: [] });
  let writes = 0;
  service.store = { getMetadataFor: async () => ({ id: "policy", eTag: "new" }),
    uploadJsonGuarded: async () => { writes++; } };
  await assert.rejects(service.save(["2026-09-14"], { id: "policy", eTag: "old" }), /annen enhet/u);
  await assert.rejects(service.save([], null));
  assert.equal(writes, 0);
});

test("guarded publish uses a direct small-file PUT with eTag or create-only conflict protection", async () => {
  const calls = [];
  const store = new OneDriveCalendarStore({ session: { getAccessToken: async () => "fake" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/approot")) return Response.json({ id: "root" });
      return Response.json({ id: "policy", eTag: "updated" });
    } });
  const payload = buildWeeklyUpgrade(["2026-09-14"], { source: "Øvingsagent" });
  await store.uploadJsonGuarded(payload, WEEKLY_UPGRADE_FILE, { id: "policy", eTag: '"old"' });
  assert.equal(calls[1].options.headers.get("If-Match"), '"old"');
  assert.equal(calls[1].options.headers.get("Authorization"), "Bearer fake");
  assert.equal(calls[1].options.method, "PUT");
  assert.match(calls[1].url, /\/items\/policy\/content$/u);
  assert.deepEqual(JSON.parse(calls[1].options.body), payload);
  calls.length = 0;
  await store.uploadJsonGuarded(payload, WEEKLY_UPGRADE_FILE, null);
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  const createUrl = new URL(calls[0].url);
  assert.match(createUrl.pathname, /\/items\/root:\/shiftwatch_weekly_upgrade_config\.json:\/content$/u);
  assert.equal(createUrl.searchParams.get("@microsoft.graph.conflictBehavior"), "fail");
});

test("conditional publish conflicts and cleanup races are reported without unsafe fallback", async () => {
  const calls = [];
  const store = new OneDriveCalendarStore({ session: { getAccessToken: async () => "fake" },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response("", { status: 412 }); } });
  store.appRootId = "root";
  await assert.rejects(store.uploadJsonGuarded(buildWeeklyUpgrade([]), WEEKLY_UPGRADE_FILE, { id: "policy", eTag: "old" }), /annen enhet/u);
  assert.equal(calls.length, 1);
  await assert.rejects(store.deleteJsonItem("expired", "version"), (error) => error.status === 412);
  assert.equal(calls[1].options.headers.get("If-Match"), "version");
});

test("malformed Graph response is surfaced without retrying through an upload session", async () => {
  const calls = [];
  const store = new OneDriveCalendarStore({ session: { getAccessToken: async () => "fake" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ error: { code: "invalidRequest", message: "The request is malformed or incorrect." } }, { status: 400 });
    } });
  store.appRootId = "root";
  await assert.rejects(
    store.uploadJsonGuarded(buildWeeklyUpgrade(["2026-09-14"]), WEEKLY_UPGRADE_FILE, null),
    (error) => error.status === 400 && /malformed or incorrect/u.test(error.message),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "PUT");
  assert.doesNotMatch(calls[0].url, /createUploadSession/u);
});
