import { parseIsoDate } from "./calendar-core.js";

export const SIMPLE_LOG_PREFIX = "shiftwatch_simple_event_";
export const SIMPLE_LOG_TTL_MS = 48 * 3600_000;
const ID = /^[a-f0-9]{64}$/u;
const FILE = /^shiftwatch_simple_event_([a-f0-9]{64})\.json$/u;
const stamp = (value) => typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/u.test(value) && Number.isFinite(Date.parse(value));
const text = (value, limit = 240) => typeof value === "string" ? value.replace(/[\r\n\t]+/gu, " ").slice(0, limit) : "";

export function simpleLogFileId(name) { return FILE.exec(name ?? "")?.[1] ?? null; }

function parseShift(raw) {
  if (!raw || !parseIsoDate(raw.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(raw.start) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(raw.end) || !text(raw.type) || !text(raw.location)) {
    throw new Error("Ugyldige vaktdetaljer i enkel logg");
  }
  return { date: raw.date, start: raw.start, end: raw.end, type: text(raw.type), location: text(raw.location) };
}

function outcome(raw, allowed) {
  if (raw == null) return null;
  if (!allowed.includes(raw.status) || !stamp(raw.at_utc)) throw new Error("Ugyldig vaktresultat");
  return { status: raw.status, at_utc: raw.at_utc, reason: text(raw.reason),
    ...(raw.shift ? { shift: parseShift(raw.shift) } : {}) };
}

export function parseSimpleEvent(raw) {
  if (!raw || raw.schema_version !== 1 || !ID.test(raw.event_id) ||
      !stamp(raw.first_seen_at_utc) || !stamp(raw.expires_at_utc) || !stamp(raw.settle_after_utc) ||
      !Array.isArray(raw.reports) || !raw.reports.length || raw.reports.length > 100) {
    throw new Error("Ukjent eller ugyldig enkel vaktlogg");
  }
  const start = Date.parse(raw.first_seen_at_utc);
  if (Date.parse(raw.expires_at_utc) <= start || Date.parse(raw.settle_after_utc) < start ||
      Date.parse(raw.settle_after_utc) > start + 10 * 60_000) throw new Error("Ugyldig logglevetid");
  const reports = raw.reports.map((report) => {
    if (!text(report?.agent_id) || !stamp(report.at_utc) || typeof report.mail?.matches !== "boolean") {
      throw new Error("Ugyldig agentrapport");
    }
    const claim = outcome(report.claim, ["pending", "claimed", "failed", "skipped"]);
    const advertisement = outcome(report.advertisement, ["pending", "advertised", "failed"]);
    if (advertisement && (!report.upgrade_enabled || !advertisement.shift)) throw new Error("Annonsering mangler gammel vakt");
    return { agent_id: text(report.agent_id), at_utc: report.at_utc,
      mail: { matches: report.mail.matches, reason: text(report.mail.reason) },
      upgrade_enabled: report.upgrade_enabled === true, claim, advertisement };
  });
  return { schema_version: 1, event_id: raw.event_id, first_seen_at_utc: raw.first_seen_at_utc,
    expires_at_utc: new Date(Math.min(Date.parse(raw.expires_at_utc), start + SIMPLE_LOG_TTL_MS)).toISOString(),
    settle_after_utc: raw.settle_after_utc, shift: parseShift(raw.shift), reports };
}

export function shiftLogDescription(shift) {
  const [year, month, day] = shift.date.split("-");
  return `${shift.type} ${day}.${month}.${year} ${shift.start}–${shift.end} · ${shift.location}`;
}

// Preserve positive confirmation even if a later loser report or stale read arrives.
// Unknown/pending is never promoted to success by the frontend.
export function mergeSimpleEvents(events, now = Date.now()) {
  const groups = new Map();
  for (const event of events) {
    if (Date.parse(event.expires_at_utc) <= now || Date.parse(event.first_seen_at_utc) > now + 300_000) continue;
    const old = groups.get(event.event_id);
    if (!old) groups.set(event.event_id, { ...event, reports: [...event.reports] });
    else {
      old.reports.push(...event.reports);
      if (Date.parse(event.first_seen_at_utc) < Date.parse(old.first_seen_at_utc)) old.first_seen_at_utc = event.first_seen_at_utc;
      if (Date.parse(event.expires_at_utc) < Date.parse(old.expires_at_utc)) old.expires_at_utc = event.expires_at_utc;
      if (Date.parse(event.settle_after_utc) > Date.parse(old.settle_after_utc)) old.settle_after_utc = event.settle_after_utc;
    }
  }
  for (const event of groups.values()) {
    event.reports = [...new Map(event.reports.map((report) => [JSON.stringify(report), report])).values()];
  }
  return [...groups.values()].sort((a, b) => Date.parse(b.first_seen_at_utc) - Date.parse(a.first_seen_at_utc));
}

export function simpleEventLines(event, now = Date.now()) {
  const terminal = (report) => report.claim && report.claim.status !== "pending" ? 1 : 0;
  const reports = [...event.reports].sort((a, b) => Date.parse(b.at_utc) - Date.parse(a.at_utc) || terminal(b) - terminal(a));
  const match = reports.find((r) => r.mail.matches);
  const reason = match?.mail.reason || reports[0]?.mail.reason;
  const lines = [{ kind: match ? "match" : "nonmatch", at: event.first_seen_at_utc,
    text: `Vakt-mail mottatt — ${match ? "MATCHER KRITERIENE" : "MATCHER IKKE KRITERIENE"}` +
      (!match && reason ? `: ${reason}` : "") }];
  const claims = reports.map((r) => r.claim).filter(Boolean);
  const claimed = claims.find((r) => r.status === "claimed");
  if (claimed) lines.push({ kind: "success", at: claimed.at_utc, text: "Vakten ble overtatt." });
  else if (match) {
    const latest = new Map();
    for (const report of reports) if (!latest.has(report.agent_id)) latest.set(report.agent_id, report);
    const current = [...latest.values()].filter((r) => r.mail.matches);
    const pending = current.some((r) => !r.claim || r.claim.status === "pending");
    const failed = claims.find((r) => r.status === "failed");
    const skipped = claims.find((r) => r.status === "skipped");
    if (now < Date.parse(event.settle_after_utc) || pending) {
      lines.push({ kind: "pending", at: event.first_seen_at_utc, text: "Avventer endelig resultat fra agentene …" });
    } else if (failed) lines.push({ kind: "failure", at: failed.at_utc, text: "Vakten ble ikke overtatt." + (failed.reason ? ` ${failed.reason}` : "") });
    else if (skipped) lines.push({ kind: "skipped", at: skipped.at_utc, text: "Vakten ble ikke forsøkt overtatt." + (skipped.reason ? ` ${skipped.reason}` : "") });
  }
  // A loser must never trigger or display an advertisement without global claim confirmation.
  if (claimed) {
    const ads = reports.filter((r) => r.upgrade_enabled).map((r) => r.advertisement).filter(Boolean);
    const ad = ads.find((a) => a.status === "advertised") ?? ads.find((a) => a.status === "failed") ?? ads[0];
    if (ad) lines.push({ kind: ad.status === "advertised" ? "success" : ad.status === "failed" ? "failure" : "pending",
      at: ad.at_utc, text: ad.status === "advertised"
        ? `Tidligere vakt er markert ledig: ${shiftLogDescription(ad.shift)}.`
        : ad.status === "failed" ? `Kunne ikke annonsere tidligere vakt: ${shiftLogDescription(ad.shift)}. Må håndteres manuelt.`
          : `Avventer annonsering av tidligere vakt: ${shiftLogDescription(ad.shift)} …` });
  }
  return lines;
}
