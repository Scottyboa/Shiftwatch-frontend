import test from "node:test";
import assert from "node:assert/strict";
import { FrontendOwnedShifts } from "../src/owned-shifts.js";
import {
  OWNED_SHIFTS_CAPABILITY, OWNED_SHIFTS_FILENAME,
  buildOwnedShiftsRequest, ownedShiftsRequestFilename, ownedShiftsResponseFilename,
  parseOwnedShiftsSnapshot, parseOwnedShiftsResponse, shiftsByDate, shiftDescription,
} from "../src/owned-shifts-core.js";

const now = new Date("2026-09-05T20:00:00Z");
const options = { requesterId: "frontend-1", targetAgentId: "pc-1", requestId: "req-1", now };
const snapshot = {
  schema_version: 1, request_id: "req-1", requester_agent_id: "frontend-1",
  responder_agent_id: "pc-1", responder_label: "WORK-PC",
  fetched_at_utc: now.toISOString(), source_page: "KommendeVakter.aspx", complete: true,
  row_count: 3,
  shifts: [
    { date: "2028-12-30", start: "22:00", end: "08:00", type: "Natt 1", location: "Moss" },
    { date: "2026-12-23", start: "08:00", end: "16:00", type: "Bil D", location: "Moss" },
    { date: "2026-12-23", start: "16:00", end: "22:00", type: "Kveld 2", location: "Moss" },
  ],
};
const response = { schema_version: 1, request_id: "req-1", requester_agent_id: "frontend-1",
  responder_agent_id: "pc-1", completed_at_utc: now.toISOString(), status: "ok", snapshot };

test("dedicated, expiring request does not use pause/resume command files", () => {
  const request = buildOwnedShiftsRequest(options);
  assert.equal(request.command, "fetch_owned_shifts");
  assert.equal(request.expires_at_utc, "2026-09-05T20:02:00.000Z");
  assert.equal(ownedShiftsRequestFilename("PC/a"), "shiftwatch_owned_shifts_request_PC_a.json");
  assert.equal(ownedShiftsResponseFilename("web", "PC/a"), "shiftwatch_owned_shifts_response_web_PC_a.json");
});

test("all years, multiple shifts per date and overnight shifts are retained", () => {
  const parsed = parseOwnedShiftsSnapshot(snapshot, { now });
  const dates = shiftsByDate(parsed);
  assert.equal(dates.get("2026-12-23").length, 2);
  assert.equal(dates.get("2028-12-30").length, 1);
  assert.equal(dates.has("2028-12-31"), false); // mark the listed start date only
  assert.match(shiftDescription(dates.get("2028-12-30")[0]), /til neste dag/);
  assert.equal(parsed.shifts[0].date, "2026-12-23");
});

test("incomplete, wrong page, malformed and future-dated snapshots are rejected as a whole", () => {
  for (const change of [
    { complete: false }, { row_count: 2 }, { source_page: "LedigeVakter.aspx" },
    { fetched_at_utc: "2028-01-01T00:00:00Z" }, { fetched_at_utc: "" },
    { schema_version: 2 }, { shifts: null },
  ]) assert.throws(() => parseOwnedShiftsSnapshot({ ...snapshot, ...change }, { now }));
  for (const change of [{ date: "2026-02-30" }, { start: "25:00" }, { end: "08:75" }, { type: "" }]) {
    const bad = structuredClone(snapshot);
    Object.assign(bad.shifts[1], change);
    assert.throws(() => parseOwnedShiftsSnapshot(bad, { now }));
  }
  assert.equal(parseOwnedShiftsSnapshot({ ...snapshot, row_count: 0, shifts: [] }, { now }).shifts.length, 0);
});

test("responses must match request, requester, target and a fresh complete snapshot", () => {
  const request = buildOwnedShiftsRequest(options);
  assert.equal(parseOwnedShiftsResponse(response, request, { now }).status, "ok");
  for (const field of ["request_id", "requester_agent_id", "responder_agent_id"]) {
    assert.equal(parseOwnedShiftsResponse({ ...response, [field]: "other" }, request, { now }), null);
    assert.equal(parseOwnedShiftsResponse({ ...response, snapshot: { ...snapshot, [field]: "other" } }, request, { now }), null);
  }
  assert.equal(parseOwnedShiftsResponse({ ...response,
    snapshot: { ...snapshot, fetched_at_utc: "2026-09-04T20:00:00Z" } }, request, { now }), null);
});

function harness({ agents, replies = [response], cache = snapshot, metadataError = false } = {}) {
  let requestCount = 0, tick = 0, replyIndex = 0;
  const uploads = [], shown = [], statuses = [];
  const store = {
    async getMetadataFor(name) {
      if (name === OWNED_SHIFTS_FILENAME) return cache ? { id: "cache" } : null;
      if (metadataError) throw new Error("Graph 429");
      assert.equal(name, ownedShiftsResponseFilename("frontend-1", "pc-1"));
      return replies.length ? { id: "reply", eTag: `etag-${replyIndex}` } : null;
    },
    async downloadJsonItem(id) {
      return id === "cache" ? cache : replies[Math.min(replyIndex++, replies.length - 1)];
    },
    async uploadJson(payload, name) { uploads.push({ payload, name }); requestCount++; },
  };
  const service = new FrontendOwnedShifts({ store, requesterId: "frontend-1", now: () => now,
    uuid: () => "req-1", clock: () => tick, sleep: async (ms) => { tick += ms; },
    discoverAgents: async () => ({ responses: agents ?? [
      { agentId: "old", capabilities: [] },
      { agentId: "pc-1", label: "WORK-PC", agentState: "paused", capabilities: [OWNED_SHIFTS_CAPABILITY] },
      { agentId: "pc-2", label: "HOME-PC", capabilities: [OWNED_SHIFTS_CAPABILITY] },
    ] }),
  });
  const refresh = () => service.refresh({ timeoutMs: 4, pollMs: 2,
    onSnapshot: (s, fresh) => shown.push({ s, fresh }), onStatus: (s) => statuses.push(s) });
  return { service, refresh, uploads, shown, statuses, requestCount: () => requestCount };
}

test("cache appears first; exactly one capable (also paused) agent receives a scan", async () => {
  const h = harness();
  const first = h.refresh(), second = h.refresh();
  assert.equal(first, second);
  assert.equal((await first).status, "success");
  assert.equal(h.requestCount(), 1);
  assert.equal(h.uploads[0].name, ownedShiftsRequestFilename("pc-1"));
  assert.deepEqual(h.shown.map((x) => x.fresh), [false, true]);
});

test("old agents/no responders never receive an unsupported request; cache remains visible", async () => {
  for (const [agents, expected] of [[[], "no-agent"], [[{ agentId: "old" }], "upgrade-required"]]) {
    const h = harness({ agents });
    assert.equal((await h.refresh()).status, expected);
    assert.equal(h.requestCount(), 0);
    assert.equal(h.shown.length, 1);
  }
});

test("timeout, malformed response, agent error and network failure preserve saved overview", async () => {
  for (const [replies, expected] of [
    [[], "timeout"], [[{ ...response, request_id: "old" }], "timeout"],
    [[{ ...response, snapshot: { ...snapshot, complete: false } }], "timeout"],
    [[{ ...response, status: "error" }], "agent-error"],
  ]) {
    const h = harness({ replies });
    assert.equal((await h.refresh()).status, expected);
    assert.equal(h.shown.length, 1);
  }
  const h = harness({ metadataError: true });
  await assert.rejects(h.refresh(), /429/);
  assert.equal(h.shown.length, 1);
});

test("invalid cache is repaired; stale responses are skipped; complete empty result clears old shifts", async () => {
  const empty = { ...response, snapshot: { ...snapshot, row_count: 0, shifts: [] } };
  const h = harness({ cache: { ...snapshot, complete: false }, replies: [{ ...response, request_id: "old" }, empty] });
  assert.equal((await h.refresh()).status, "success");
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].s.shifts.length, 0);
  assert.ok(h.statuses.includes("cache-error"));
});
