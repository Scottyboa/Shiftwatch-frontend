import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  addDates,
  addPeriod,
  calendarStateForDate,
  normalizeCalendarCriteria,
} from "../src/calendar-core.js";
import {
  baseRedirectUri,
  buildSharedCalendarPayload,
  calendarFromSharedPayload,
} from "../src/onedrive-core.js";
import { OneDriveCalendarStore } from "../src/onedrive-sync.js";

const criteria = {
  allowed_date_ranges: [
    {
      start: "2026-09-01",
      end: "2026-09-30",
      weekdays: ["monday", "tuesday", "saturday"],
    },
  ],
  date_start: "2026-09-01",
  date_end: "2026-09-30",
  blocked_weekdays: ["wednesday", "thursday", "friday", "sunday"],
  extra_include_dates: ["2026-09-17"],
  exclude_dates: ["2026-09-08"],
};

test("calendar colors and edits preserve ShiftWatch precedence", () => {
  let calendar = normalizeCalendarCriteria(criteria);
  assert.equal(calendarStateForDate("2026-09-08", calendar, "2026-08-01"), "excluded");
  assert.equal(calendarStateForDate("2026-09-17", calendar, "2026-08-01"), "extra");
  assert.equal(calendarStateForDate("2026-09-12", calendar, "2026-08-01"), "included");

  calendar = addPeriod(calendar, "2026-10-01", "2026-10-10", ["thursday"]);
  calendar = addDates(calendar, "exclude_dates", ["2026-10-08"]);
  assert.equal(calendar.allowed_date_ranges.length, 2);
  assert.ok(calendar.exclude_dates.includes("2026-10-08"));
});

test("builds and reads the exact OneDrive schema expected by the agents", () => {
  const payload = buildSharedCalendarPayload(criteria, {
    now: new Date("2026-08-13T18:30:00.000Z"),
    sourceAgent: "ShiftWatch Frontend",
  });

  assert.deepEqual(Object.keys(payload), [
    "schema_version",
    "published_at_utc",
    "source_agent",
    "calendar_criteria",
  ]);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.source_agent, "ShiftWatch Frontend");
  assert.deepEqual(calendarFromSharedPayload(payload), normalizeCalendarCriteria(criteria));
});

test("rejects malformed or unknown OneDrive calendar payloads", () => {
  assert.throws(() => calendarFromSharedPayload({ schema_version: 2 }), /Ukjent OneDrive-versjon/u);
  assert.throws(
    () => calendarFromSharedPayload({ schema_version: 1 }),
    /mangler calendar_criteria/u,
  );
});

test("derives the GitHub Pages directory as the SPA redirect URI", () => {
  assert.equal(
    baseRedirectUri({
      origin: "https://scottyboa.github.io",
      pathname: "/Shiftwatch-frontend/index.html",
    }),
    "https://scottyboa.github.io/Shiftwatch-frontend/",
  );
});

test("binds the native fetch implementation for Safari/WebKit", async () => {
  const originalFetch = globalThis.fetch;
  let observedReceiver = null;
  globalThis.fetch = function safariStyleFetch() {
    observedReceiver = this;
    return Promise.resolve(new Response("{}", { status: 200 }));
  };

  try {
    const store = new OneDriveCalendarStore({
      session: { getAccessToken: async () => "token" },
      fileName: "calendar.json",
    });
    await store.request("https://graph.microsoft.com/v1.0/me");
    assert.equal(observedReceiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OneDrive store downloads metadata/content and uploads through App Folder", async () => {
  const calls = [];
  const remotePayload = buildSharedCalendarPayload(criteria, {
    now: new Date("2026-08-13T18:30:00.000Z"),
  });
  const replies = [
    new Response(JSON.stringify({ id: "app-root" }), { status: 200 }),
    new Response(
      JSON.stringify({
        id: "calendar-item",
        name: "shiftwatch_calendar_config.json",
        eTag: "etag-1",
        lastModifiedDateTime: "2026-08-13T18:30:01Z",
      }),
      { status: 200 },
    ),
    new Response(JSON.stringify(remotePayload), { status: 200 }),
    new Response(
      JSON.stringify({
        id: "calendar-item",
        eTag: "etag-2",
        lastModifiedDateTime: "2026-08-13T18:31:00Z",
      }),
      { status: 200 },
    ),
  ];
  const session = { getAccessToken: async () => "test-token" };
  const store = new OneDriveCalendarStore({
    session,
    fileName: "shiftwatch_calendar_config.json",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return replies.shift();
    },
  });

  const downloaded = await store.download();
  assert.equal(downloaded.metadata.eTag, "etag-1");
  assert.deepEqual(calendarFromSharedPayload(downloaded.payload), normalizeCalendarCriteria(criteria));

  const uploaded = await store.upload(remotePayload);
  assert.equal(uploaded.eTag, "etag-2");
  assert.equal(calls[0].url.endsWith("/me/drive/special/approot"), true);
  assert.match(calls[1].url, /shiftwatch_calendar_config\.json/u);
  assert.match(calls[2].url, /calendar-item\/content/u);
  assert.equal(calls[3].options.method, "PUT");
  assert.equal(calls[3].options.headers.get("Authorization"), "Bearer test-token");
});

test("OneDrive store lists and filters agent protocol files across Graph pages", async () => {
  const calls = [];
  const replies = [
    new Response(JSON.stringify({ id: "app-root" }), { status: 200 }),
    new Response(
      JSON.stringify({
        value: [
          { id: "calendar", name: "shiftwatch_calendar_config.json" },
          { id: "response-1", name: "shiftwatch_agent_ping_response_frontend_agent-a.json" },
        ],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page",
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        value: [
          { id: "response-2", name: "shiftwatch_agent_ping_response_frontend_agent-b.json" },
        ],
      }),
      { status: 200 },
    ),
  ];
  const store = new OneDriveCalendarStore({
    session: { getAccessToken: async () => "token" },
    fileName: "calendar.json",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return replies.shift();
    },
  });

  const items = await store.listMetadata({
    prefix: "shiftwatch_agent_ping_response_frontend_",
  });
  assert.deepEqual(items.map((item) => item.id), ["response-1", "response-2"]);
  assert.match(calls[1].url, /\/children\?\$top=200/u);
  assert.equal(calls[2].url, "https://graph.microsoft.com/v1.0/next-page");
});

test("vendored Microsoft authentication library exposes MSAL without a CDN", async () => {
  const source = await readFile(new URL("../vendor/msal-browser.min.js", import.meta.url), "utf8");
  const context = {
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  context.document = { cookie: "" };
  vm.runInNewContext(source, context);

  assert.equal(typeof context.msal.PublicClientApplication, "function");
});
