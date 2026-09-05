import { sanitizeAgentId } from "./agent-control-core.js";

export const OWNED_SHIFTS_CAPABILITY = "owned_shifts_v1";
export const OWNED_SHIFTS_FILENAME = "shiftwatch_owned_shifts.json";
export const OWNED_SHIFTS_SOURCE = "KommendeVakter.aspx";

export function ownedShiftsRequestFilename(agentId) {
  return `shiftwatch_owned_shifts_request_${sanitizeAgentId(agentId)}.json`;
}

export function ownedShiftsResponseFilename(requesterId, agentId) {
  return `shiftwatch_owned_shifts_response_${sanitizeAgentId(requesterId)}_${sanitizeAgentId(agentId)}.json`;
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new Error(`Ugyldig ${field} i vaktoversikten`);
  }
  return value.trim();
}

function timestamp(value, now) {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new Error("Vaktoversikten mangler gyldig tidspunkt med tidssone");
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > now.getTime() + 300_000) {
    throw new Error("Vaktoversikten har ugyldig tidspunkt");
  }
  return new Date(ms).toISOString();
}

function dateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("Ugyldig vaktdato");
  }
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Ugyldig vaktdato");
  }
  return value;
}

function timeOnly(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new Error("Ugyldig vakttid");
  }
  return value;
}

export function buildOwnedShiftsRequest({ requesterId, targetAgentId, requestId, now = new Date() }) {
  return {
    schema_version: 1,
    request_id: requiredText(requestId, "request_id"),
    command: "fetch_owned_shifts",
    published_at_utc: now.toISOString(),
    expires_at_utc: new Date(now.getTime() + 120_000).toISOString(),
    issuer_agent_id: requiredText(requesterId, "issuer_agent_id"),
    issuer_label: "ShiftWatch Frontend",
    target_agent_id: requiredText(targetAgentId, "target_agent_id"),
  };
}

// Reject the whole snapshot if a row is malformed. A partial result must never
// silently erase shifts from the last successfully fetched overview.
export function parseOwnedShiftsSnapshot(payload, { now = new Date() } = {}) {
  if (!payload || payload.schema_version !== 1 || payload.complete !== true ||
      payload.source_page !== OWNED_SHIFTS_SOURCE || !Array.isArray(payload.shifts) ||
      payload.shifts.length > 10000 || payload.row_count !== payload.shifts.length) {
    throw new Error("Vaktoversikten er ugyldig eller ufullstendig. Siste gyldige oversikt beholdes.");
  }
  const shifts = payload.shifts.map((row) => ({
    date: dateOnly(row?.date),
    start: timeOnly(row?.start),
    end: timeOnly(row?.end),
    type: requiredText(row?.type, "vakttype"),
    location: requiredText(row?.location, "arbeidssted"),
  })).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return {
    schema_version: 1,
    request_id: requiredText(payload.request_id, "request_id"),
    requester_agent_id: requiredText(payload.requester_agent_id, "requester_agent_id"),
    responder_agent_id: requiredText(payload.responder_agent_id, "responder_agent_id"),
    responder_label: requiredText(payload.responder_label, "responder_label"),
    fetched_at_utc: timestamp(payload.fetched_at_utc, now),
    source_page: OWNED_SHIFTS_SOURCE,
    complete: true,
    row_count: shifts.length,
    shifts,
  };
}

export function parseOwnedShiftsResponse(payload, request, { now = new Date() } = {}) {
  if (!payload || payload.schema_version !== 1 ||
      payload.request_id !== request.request_id ||
      payload.requester_agent_id !== request.issuer_agent_id ||
      payload.responder_agent_id !== request.target_agent_id) return null;
  const completed = timestamp(payload.completed_at_utc, now);
  if (Date.parse(completed) < Date.parse(request.published_at_utc)) return null;
  if (payload.status === "error") return { status: "error" };
  if (payload.status !== "ok") return null;
  const snapshot = parseOwnedShiftsSnapshot(payload.snapshot, { now });
  if (snapshot.request_id !== request.request_id ||
      snapshot.requester_agent_id !== request.issuer_agent_id ||
      snapshot.responder_agent_id !== request.target_agent_id ||
      Date.parse(snapshot.fetched_at_utc) < Date.parse(request.published_at_utc)) return null;
  return { status: "ok", snapshot };
}

export function shiftsByDate(snapshot) {
  const result = new Map();
  for (const shift of snapshot?.shifts ?? []) {
    if (!result.has(shift.date)) result.set(shift.date, []);
    result.get(shift.date).push(shift);
  }
  return result;
}

export function shiftDescription(shift) {
  const overnight = shift.end <= shift.start ? " (til neste dag)" : "";
  return `${shift.start}–${shift.end}${overnight} · ${shift.type} · ${shift.location}`;
}
