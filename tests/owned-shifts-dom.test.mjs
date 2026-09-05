import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("calendar fetch automatically discovers one agent, paints all years and keeps edits separate", async () => {
  const dom = new JSDOM(await readFile(new URL("../index.html", import.meta.url), "utf8"), {
    url: "https://scottyboa.github.io/Shiftwatch-frontend/", pretendToBeVisual: true,
  });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Object.defineProperties(globalThis, {
    location: { configurable: true, value: dom.window.location },
    navigator: { configurable: true, value: dom.window.navigator },
  });
  dom.window.confirm = () => true;
  Object.defineProperty(dom.window, "localStorage", {
    get() { throw new Error("Browser storage unavailable"); },
  });
  // jsdom has no layout engine; scrolling is exercised in the browser check.
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const errors = [];
  dom.window.addEventListener("error", (event) => errors.push(event.error));
  const account = { homeAccountId: "test-account" };
  globalThis.msal = { PublicClientApplication: class {
    async initialize() {} async handleRedirectPromise() { return null; }
    getActiveAccount() { return account; } getAllAccounts() { return [account]; }
    setActiveAccount() {} async acquireTokenSilent() { return { accessToken: "fake" }; }
    async logoutRedirect() {}
  } };
  const calendar = { schema_version: 1, published_at_utc: "2026-09-01T12:00:00Z",
    source_agent: "Test", calendar_criteria: {
      allowed_date_ranges: [{ start: "2026-09-05", end: "2028-12-31", weekdays: ["monday"] }],
      extra_include_dates: [], exclude_dates: ["2026-12-23"],
    } };
  const shifts = [
    { date: "2026-12-23", start: "08:00", end: "16:00", type: "Bil D", location: "Moss" },
    { date: "2026-12-23", start: "16:00", end: "22:00", type: "<img src=x onerror=alert(1)>", location: "Moss" },
    { date: "2028-12-30", start: "22:00", end: "08:00", type: "Natt 1", location: "Moss" },
  ];
  let ping, request, mode = "success";
  const uploads = [];
  const json = (data) => new Response(JSON.stringify(data));
  globalThis.fetch = async (raw, options = {}) => {
    const url = decodeURIComponent(String(raw));
    if (options.method === "PUT") {
      const p = JSON.parse(options.body); uploads.push(p);
      if (p.command === "ping") ping = p;
      else if (p.command === "fetch_owned_shifts") request = p;
      return json({ id: "written", eTag: "etag-2" });
    }
    if (url.endsWith("/approot")) return json({ id: "root" });
    if (url.includes("shiftwatch_calendar")) return json({ id: "calendar", eTag: "etag-1" });
    if (url.endsWith("/calendar/content")) return json(calendar);
    if (url.includes("shiftwatch_owned_shifts.json")) return new Response("", { status: 404 });
    if (url.includes("/children?")) return json({ value: [{ id: "ping", name: `shiftwatch_agent_ping_response_${ping.issuer_agent_id}_pc-1.json`, eTag: ping.command_id }] });
    if (url.endsWith("/ping/content")) return json({ schema_version: 1,
      ping_id: ping.command_id, requester_agent_id: ping.issuer_agent_id,
      responder_agent_id: "pc-1", responder_label: "WORK-PC", responded_at_utc: new Date().toISOString(),
      agent_state: "paused", capabilities: ["owned_shifts_v1", "targeted_control_v1"] });
    if (url.includes("shiftwatch_owned_shifts_response_")) return json({ id: "response", eTag: request.request_id });
    if (url.endsWith("/response/content")) {
      const rows = mode === "empty" ? [] : shifts;
      return json({ schema_version: 1, request_id: request.request_id,
        requester_agent_id: request.issuer_agent_id, responder_agent_id: "pc-1",
        completed_at_utc: new Date().toISOString(), status: mode === "error" ? "error" : "ok",
        snapshot: { schema_version: 1, request_id: request.request_id,
          requester_agent_id: request.issuer_agent_id, responder_agent_id: "pc-1", responder_label: "WORK-PC",
          fetched_at_utc: new Date().toISOString(), complete: true, source_page: "KommendeVakter.aspx",
          row_count: rows.length, shifts: rows },
      });
    }
    throw new Error(`Unexpected Graph route ${url}`);
  };
  const waitFor = async (fn) => {
    for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
    assert.fail("DOM condition timed out");
  };
  try {
    await import(`../src/app.js?owned-dom=${Date.now()}`);
    document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    await waitFor(() => document.querySelector("#connection-status").textContent === "Tilkoblet Microsoft");
    document.querySelector("#fetch-onedrive").click();
    await waitFor(() => document.querySelector("#owned-shifts-status").dataset.status === "success");
    const day = () => document.querySelector('[data-date="2026-12-23"]');
    assert.ok(day().classList.contains("state-excluded"));
    assert.ok(day().classList.contains("has-owned-shift"));
    assert.equal(day().querySelector(".owned-shift-count").textContent, "2");
    assert.equal(uploads.filter((p) => p.command === "fetch_owned_shifts").length, 1);
    assert.ok(!/upubliserte/.test(document.querySelector("#sync-details").textContent));
    day().click();
    assert.ok(day().classList.contains("is-selected"));
    assert.match(document.querySelector("#owned-shifts-selection").textContent, /Bil D/);
    assert.equal(document.querySelector("#owned-shifts-selection img"), null);
    assert.match(day().getAttribute("aria-label"), /registrert/);
    document.querySelector("#next-year").click(); document.querySelector("#next-year").click();
    assert.ok(document.querySelector('[data-date="2028-12-30"]').classList.contains("has-owned-shift"));
    document.querySelector("#previous-year").click(); document.querySelector("#previous-year").click();
    document.querySelector("#clear-selection").click();
    document.querySelector('[data-date="2026-12-24"]').click();
    document.querySelector("#add-exclusion").click();
    mode = "error";
    document.querySelector("#refresh-owned-shifts").click();
    await waitFor(() => document.querySelector("#owned-shifts-status").dataset.status === "agent-error");
    assert.ok(day().classList.contains("has-owned-shift"));
    assert.match(document.querySelector("#sync-details").textContent, /upubliserte/);
    document.querySelector("#publish-onedrive").click();
    await waitFor(() => uploads.some((p) => p.calendar_criteria));
    const published = uploads.find((p) => p.calendar_criteria);
    assert.ok(published.calendar_criteria.exclude_dates.includes("2026-12-24"));
    assert.equal(published.shifts, undefined);
    assert.equal(published.calendar_criteria.shifts, undefined);
    await waitFor(() => !document.querySelector("#refresh-owned-shifts").disabled);
    mode = "empty";
    document.querySelector("#refresh-owned-shifts").click();
    await waitFor(() => document.querySelector("#owned-shifts-status").dataset.status === "success");
    assert.equal(document.querySelectorAll(".has-owned-shift").length, 0);
    assert.match(document.querySelector("#owned-shifts-updated").textContent, /0 kommende/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
