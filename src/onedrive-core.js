import { normalizeCalendarCriteria } from "./calendar-core.js";

export const SHARED_CALENDAR_SCHEMA_VERSION = 1;

export function calendarFromSharedPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OneDrive-filen er ikke et gyldig JSON-objekt");
  }
  if (payload.schema_version !== SHARED_CALENDAR_SCHEMA_VERSION) {
    throw new Error(
      `Ukjent OneDrive-versjon: ${String(payload.schema_version ?? "mangler")}`,
    );
  }
  if (!payload.calendar_criteria || typeof payload.calendar_criteria !== "object") {
    throw new Error("OneDrive-filen mangler calendar_criteria");
  }
  return normalizeCalendarCriteria(payload.calendar_criteria);
}

export function buildSharedCalendarPayload(
  calendar,
  {
    now = new Date(),
    sourceAgent = "ShiftWatch Frontend",
  } = {},
) {
  return {
    schema_version: SHARED_CALENDAR_SCHEMA_VERSION,
    published_at_utc: now.toISOString(),
    source_agent: sourceAgent,
    calendar_criteria: normalizeCalendarCriteria(calendar),
  };
}

export function baseRedirectUri(locationLike = globalThis.location) {
  const origin = String(locationLike?.origin ?? "").replace(/\/$/u, "");
  let path = String(locationLike?.pathname ?? "/");
  if (!path.endsWith("/")) path = path.replace(/[^/]*$/u, "");
  if (!path.startsWith("/")) path = `/${path}`;
  return `${origin}${path}`;
}
