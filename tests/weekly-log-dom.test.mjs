import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { buildWeeklyUpgrade, WEEKLY_UPGRADE_FILE } from "../src/weekly-upgrade-core.js";
import { SIMPLE_LOG_PREFIX } from "../src/simple-log-core.js";

const waitFor = async (check) => {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail("Expected UI state was not reached");
};

test("frontend loads policy/log, edits whole weeks without changing calendar, and saves them separately", async () => {
  const dom = new JSDOM(await readFile(new URL("../index.html", import.meta.url), "utf8"), {
    url: "https://scottyboa.github.io/Shiftwatch-frontend/", pretendToBeVisual: true,
  });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperties(globalThis, {
    location: { configurable: true, value: dom.window.location },
    navigator: { configurable: true, value: dom.window.navigator },
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  let allowDiscard = false;
  dom.window.confirm = () => allowDiscard;
  const errors = [];
  dom.window.addEventListener("error", (event) => errors.push(event.error));
  const account = { homeAccountId: "fake" };
  globalThis.msal = { PublicClientApplication: class {
    async initialize() {} async handleRedirectPromise() { return null; }
    getActiveAccount() { return account; } getAllAccounts() { return [account]; }
    setActiveAccount() {} async acquireTokenSilent() { return { accessToken: "fake" }; }
    async logoutRedirect() {}
  } };
  const calendar = { schema_version: 1, published_at_utc: "2026-09-09T12:00:00Z", source_agent: "Example",
    calendar_criteria: { allowed_date_ranges: [{ start: "2026-01-01", end: "2027-12-31", weekdays: ["monday", "thursday", "saturday"] }],
      exclude_dates: ["2026-09-19"], extra_include_dates: [] } };
  let remotePolicy = buildWeeklyUpgrade(["2026-12-28"]), policyTag = "policy-1", metadataReads = 0, failLog = false;
  const uploads = [], deletions = [];
  const now = Date.now();
  const stamp = (offset) => new Date(now + offset).toISOString();
  const eventId = "a".repeat(64);
  const shift = { date: "2026-09-19", start: "12:00", end: "20:00", type: "<img src=x onerror=alert(1)>", location: "Moss" };
  const log = { schema_version: 1, event_id: eventId, first_seen_at_utc: stamp(-150000),
    expires_at_utc: stamp(48 * 3600000 - 150000), settle_after_utc: stamp(-30000), shift,
    reports: [
      { agent_id: "winner", at_utc: stamp(-80000), mail: { matches: true }, upgrade_enabled: true,
        claim: { status: "claimed", at_utc: stamp(-100000) },
        advertisement: { status: "advertised", at_utc: stamp(-80000), shift: { ...shift, date: "2026-09-14" } } },
      { agent_id: "loser", at_utc: stamp(-85000), mail: { matches: true }, claim: { status: "failed", at_utc: stamp(-85000) } },
    ] };
  globalThis.fetch = async (raw, options = {}) => {
    const url = decodeURIComponent(String(raw));
    if (options.method === "PUT") {
      const payload = JSON.parse(options.body);
      if (payload.command === "ping") throw new Error("Discovery unavailable in this fixture");
      if (url.includes(WEEKLY_UPGRADE_FILE) || url.endsWith("/policy/content")) {
        uploads.push(payload); remotePolicy = payload; policyTag = "policy-2";
        return Response.json({ id: "policy", eTag: policyTag });
      }
      return Response.json({ id: "calendar", eTag: "calendar-2" });
    }
    if (options.method === "DELETE") { deletions.push(url); return new Response(null, { status: 204 }); }
    if (url.endsWith("/approot")) return Response.json({ id: "root" });
    if (url.includes("shiftwatch_calendar_config.json")) { metadataReads++; return Response.json({ id: "calendar", eTag: "calendar-1" }); }
    if (url.endsWith("/calendar/content")) return Response.json(calendar);
    if (url.includes(WEEKLY_UPGRADE_FILE)) return Response.json({ id: "policy", eTag: policyTag });
    if (url.endsWith("/policy/content")) return Response.json(remotePolicy);
    if (url.includes("shiftwatch_owned_shifts.json")) return new Response(null, { status: 404 });
    if (url.includes("/children?")) {
      if (failLog) return new Response(null, { status: 503 });
      return Response.json({ value: [{ id: "event", eTag: "event-1", name: `${SIMPLE_LOG_PREFIX}${eventId}.json` }] });
    }
    if (url.endsWith("/event/content")) return Response.json(log);
    throw new Error(`Unhandled fake request: ${url}`);
  };
  await import(`../src/app.js?weekly-dom=${Date.now()}`);
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await waitFor(() => document.querySelector("#connection-status").textContent.includes("Tilkoblet"));
  document.querySelector("#fetch-onedrive").click();
  await waitFor(() => document.querySelectorAll(".month-card").length === 12 && !document.querySelector("#fetch-onedrive").disabled);
  await waitFor(() => document.querySelectorAll(".simple-log-event li").length === 3);
  assert.equal(document.querySelectorAll(".simple-log-event").length, 1);
  assert.equal(document.querySelectorAll(".simple-log-event img").length, 0);
  assert.match(document.querySelector("#simple-log-list").textContent, /Vakten ble overtatt/u);
  assert.doesNotMatch(document.querySelector("#simple-log-list").textContent, /ble ikke overtatt/u);
  assert.equal(document.querySelector('[data-date="2026-12-31"]').classList.contains("has-weekly-upgrade"), true);
  const before = JSON.stringify(calendar);
  document.querySelector('[data-date="2026-09-19"]').click();
  const toggle = document.querySelector("#weekly-upgrade-toggle");
  assert.equal(toggle.checked, false); assert.equal(toggle.disabled, false);
  toggle.click();
  assert.equal(document.querySelector('[data-date="2026-09-19"]').classList.contains("has-weekly-upgrade"), true);
  assert.equal(document.querySelector('[data-date="2026-09-19"]').classList.contains("state-excluded"), true);
  assert.match(document.querySelector("#weekly-upgrade-status").textContent, /Upubliserte/u);
  const previousReads = metadataReads;
  document.querySelector("#fetch-onedrive").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(metadataReads, previousReads, "cancel discard must preserve unsaved weeks");
  document.querySelector("#publish-weekly-upgrade").click();
  await waitFor(() => document.querySelector("#weekly-upgrade-status").textContent.includes("synkronisert"));
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].enabled_week_starts, ["2026-09-14", "2026-12-28"]);
  assert.equal(JSON.stringify(calendar), before);
  assert.equal(uploads[0].calendar_criteria, undefined);
  document.querySelector("#next-year").click();
  assert.equal(document.querySelector('[data-date="2027-01-03"]').classList.contains("has-weekly-upgrade"), true);
  assert.equal(document.querySelector('[data-date="2027-01-04"]').classList.contains("has-weekly-upgrade"), false);
  // Error state preserves the previous successfully fetched simple log.
  failLog = true;
  document.querySelector("#refresh-simple-log").click();
  await waitFor(() => document.querySelector("#simple-log-status").textContent.includes("Kunne ikke"));
  assert.equal(document.querySelectorAll(".simple-log-event").length, 1);
  assert.equal(deletions.length, 0);
  // Re-fetch an unknown policy: regular calendar stays usable, policy writes lock.
  failLog = false; allowDiscard = true; remotePolicy = { ...remotePolicy, schema_version: 9 };
  document.querySelector("#fetch-onedrive").click();
  await waitFor(() => document.querySelector("#weekly-upgrade-status").textContent.includes("kunne ikke hentes"));
  assert.equal(document.querySelector("#publish-onedrive").disabled, false);
  assert.equal(document.querySelector("#publish-weekly-upgrade").disabled, true);
  assert.deepEqual(errors, []);
  dom.window.close();
});
