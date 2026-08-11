import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import yaml from "js-yaml";

import {
  addDates,
  addPeriod,
  applyCalendarToConfig,
  calendarStateForDate,
  createCommandText,
  decodeCommandText,
  extractCalendarFromConfig,
  normalizeCalendarCriteria,
  SUBJECT_TEXT,
} from "../src/calendar-core.js";

const criteria = {
  allowed_locations: ["Moss"],
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

test("uses the exact requested subject text", () => {
  assert.equal(SUBJECT_TEXT, "Shiftwatch changes");
});

test("extracts only shared calendar criteria from a full config", () => {
  const calendar = extractCalendarFromConfig({
    graph: { client_id: "local-only" },
    criteria,
  });

  assert.equal(calendar.allowed_date_ranges.length, 1);
  assert.equal(calendar.allowed_locations, undefined);
  assert.deepEqual(calendar.extra_include_dates, ["2026-09-17"]);
});

test("calendar colors use exclude then extra then period precedence", () => {
  const calendar = normalizeCalendarCriteria(criteria);

  assert.equal(calendarStateForDate("2026-09-08", calendar, "2026-08-01"), "excluded");
  assert.equal(calendarStateForDate("2026-09-17", calendar, "2026-08-01"), "extra");
  assert.equal(calendarStateForDate("2026-09-12", calendar, "2026-08-01"), "included");
  assert.equal(calendarStateForDate("2026-09-09", calendar, "2026-08-01"), "available");
  assert.equal(calendarStateForDate("2026-07-31", calendar, "2026-08-01"), "past");
});

test("edits periods and exact dates without touching local config fields", () => {
  let calendar = normalizeCalendarCriteria(criteria);
  calendar = addPeriod(calendar, "2026-10-01", "2026-10-10", ["thursday"]);
  calendar = addDates(calendar, "exclude_dates", ["2026-10-08"]);
  const output = applyCalendarToConfig(
    { graph: { client_id: "keep-me" }, criteria: { ...criteria } },
    calendar,
  );

  assert.equal(output.graph.client_id, "keep-me");
  assert.equal(output.criteria.allowed_date_ranges.length, 2);
  assert.ok(output.criteria.exclude_dates.includes("2026-10-08"));
});

test("creates a self-validating, wrapped command payload", async () => {
  const command = await createCommandText(criteria, {
    now: new Date("2026-08-11T12:00:00.000Z"),
    commandId: "command-test-1",
  });
  const decoded = await decodeCommandText(command);

  assert.match(command, /^SHIFTWATCH-CALENDAR-COMMAND-V1\nPAYLOAD-BEGIN\n/u);
  assert.equal(decoded.command_id, "command-test-1");
  assert.equal(decoded.created_at_utc, "2026-08-11T12:00:00.000Z");
  assert.deepEqual(decoded.calendar_criteria, normalizeCalendarCriteria(criteria));
});

test("rejects configs without a usable calendar period", () => {
  assert.throws(
    () => normalizeCalendarCriteria({ allowed_date_ranges: [] }),
    /minst én allowed_date_ranges-periode/u,
  );
});

test("the repository default full config loads through the production YAML schema", async () => {
  const source = await readFile(new URL("../config/default-config.yaml", import.meta.url), "utf8");
  const fullConfig = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  const calendar = extractCalendarFromConfig(fullConfig);

  assert.equal(fullConfig.mail.provider, "graph");
  assert.equal(calendar.allowed_date_ranges.length, 2);
  assert.equal(calendar.exclude_dates.length, 3);
});

test("the vendored browser YAML parser loads without a CDN", async () => {
  const source = await readFile(new URL("../vendor/js-yaml.min.js", import.meta.url), "utf8");
  const context = {};
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(source, context);

  assert.equal(typeof context.jsyaml.load, "function");
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.jsyaml.load("criteria:\n  exclude_dates: []\n"))),
    { criteria: { exclude_dates: [] } },
  );
});
