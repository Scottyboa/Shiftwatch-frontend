import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { JSDOM } from "jsdom";

const calendarCriteria = {
  allowed_date_ranges: [
    {
      start: "2026-08-11",
      end: "2026-12-20",
      weekdays: ["monday", "tuesday", "wednesday", "thursday", "saturday"],
    },
  ],
  date_start: "2026-08-11",
  date_end: "2026-12-20",
  blocked_weekdays: ["friday", "sunday"],
  extra_include_dates: ["2026-09-18"],
  exclude_dates: ["2026-08-22", "2026-09-12", "2026-10-10"],
};

test("the production page fetches, edits and publishes on the responsive OneDrive UI", async () => {
  const root = new URL("../", import.meta.url);
  const html = await readFile(new URL("index.html", root), "utf8");
  const css = await readFile(new URL("styles.css", root), "utf8");
  const dom = new JSDOM(html, {
    url: "https://scottyboa.github.io/Shiftwatch-frontend/",
    pretendToBeVisual: true,
  });

  const account = { homeAccountId: "test-account" };
  class FakePublicClientApplication {
    async initialize() {}
    async handleRedirectPromise() {
      return null;
    }
    getActiveAccount() {
      return account;
    }
    getAllAccounts() {
      return [account];
    }
    setActiveAccount() {}
    async acquireTokenSilent() {
      return { accessToken: "test-token" };
    }
    async loginRedirect() {
      throw new Error("login should not be needed in this test");
    }
    async logoutRedirect() {}
  }

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperties(globalThis, {
    location: { configurable: true, value: dom.window.location },
    navigator: { configurable: true, value: dom.window.navigator },
  });
  globalThis.msal = { PublicClientApplication: FakePublicClientApplication };
  dom.window.confirm = () => true;

  const remotePayload = {
    schema_version: 1,
    published_at_utc: "2026-08-13T18:30:00.000Z",
    source_agent: "ShiftWatch Frontend",
    calendar_criteria: calendarCriteria,
  };
  const calls = [];
  const replies = [
    new Response(JSON.stringify({ id: "app-root" }), { status: 200 }),
    new Response(
      JSON.stringify({
        id: "calendar-item",
        eTag: "etag-1",
        lastModifiedDateTime: "2026-08-13T18:30:01Z",
      }),
      { status: 200 },
    ),
    new Response(JSON.stringify(remotePayload), { status: 200 }),
    new Response(
      JSON.stringify({
        id: "calendar-item",
        eTag: "etag-1",
        lastModifiedDateTime: "2026-08-13T18:30:01Z",
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        id: "calendar-item",
        eTag: "etag-2",
        lastModifiedDateTime: "2026-08-13T18:31:00Z",
      }),
      { status: 200 },
    ),
  ];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return replies.shift();
  };

  await import(`../src/app.js?dom-test=${Date.now()}`);
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(document.querySelector("#config-input"), null);
  assert.equal(document.querySelector("#copy-section"), null);
  assert.equal(document.querySelector("#editor-section").classList.contains("is-disabled"), true);
  assert.equal(document.querySelector("#connection-status").textContent, "Tilkoblet Microsoft");
  assert.equal(document.querySelector("#pause-all-agents").disabled, false);
  assert.equal(document.querySelector("#resume-all-agents").disabled, false);
  assert.equal(document.querySelector("#ping-agents").disabled, false);
  assert.ok(document.querySelector("#agent-status-dialog"));

  document.querySelector("#fetch-onedrive").click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(document.querySelectorAll(".month-card").length, 12);
  assert.equal(document.querySelectorAll(".period-row").length, 1);
  assert.equal(document.querySelector("#editor-section").classList.contains("is-disabled"), false);
  assert.equal(document.querySelector("#publish-onedrive").disabled, false);
  assert.match(document.querySelector("#sync-details").textContent, /ShiftWatch Frontend/u);

  document.querySelector('[data-date="2026-11-02"]').click();
  document.querySelector('[data-date="2026-11-03"]').click();
  document.querySelector("#add-exclusion").click();
  assert.equal(document.querySelector('[data-date="2026-11-02"]').classList.contains("state-excluded"), true);
  assert.equal(document.querySelector("#exclude-count").textContent, "5");
  assert.match(document.querySelector("#sync-details").textContent, /upubliserte/u);

  document.querySelector("#publish-onedrive").click();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const uploadCall = calls.find((call) => call.options.method === "PUT");
  assert.ok(uploadCall);
  const uploaded = JSON.parse(uploadCall.options.body);
  assert.equal(uploaded.schema_version, 1);
  assert.equal(uploaded.source_agent, "ShiftWatch Frontend");
  assert.ok(uploaded.calendar_criteria.exclude_dates.includes("2026-11-02"));
  assert.match(document.querySelector("#sync-details").textContent, /synkronisert/u);

  assert.match(css, /@media \(max-width: 640px\)/u);
  assert.match(css, /\.calendar-grid\s*\{\s*grid-template-columns: 1fr;/u);
  assert.match(css, /\.calendar-day\s*\{\s*min-height: 42px;/u);

  dom.window.close();
});
