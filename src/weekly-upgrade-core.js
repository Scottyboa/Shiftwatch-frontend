import { parseIsoDate, toIsoDate, calendarStateForDate } from "./calendar-core.js";

export const WEEKLY_UPGRADE_FILE = "shiftwatch_weekly_upgrade_config.json";
export const WEEKLY_UPGRADE_POLICY = Object.freeze({
  priority_order: [["saturday"], ["thursday"], ["monday", "tuesday", "wednesday"]],
  replacement_limit: 1,
  require_calendar_match: true,
  claim_before_advertise: true,
});

export function shiftDate(iso, days) {
  const date = parseIsoDate(iso);
  if (!date) throw new Error("Ugyldig kalenderdato");
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function weekStart(iso) {
  const date = parseIsoDate(iso);
  if (!date) throw new Error("Ugyldig kalenderdato");
  return shiftDate(iso, -((date.getDay() + 6) % 7));
}

export function weeksInSelection(start, end = start) {
  if (!start) return [];
  let first = weekStart(start), last = weekStart(end ?? start);
  if (first > last) [first, last] = [last, first];
  const weeks = [];
  for (let day = first; day <= last; day = shiftDate(day, 7)) {
    if (weeks.length >= 530) throw new Error("Velg høyst ti år om gangen");
    weeks.push(day);
  }
  return weeks;
}

export function weekLabel(start) {
  start = weekStart(start);
  const thursday = shiftDate(start, 3);
  const year = Number(thursday.slice(0, 4));
  const first = weekStart(`${year}-01-04`);
  const number = Math.round((Date.parse(start + "T00:00:00Z") - Date.parse(first + "T00:00:00Z")) / 604800000) + 1;
  return `Uke ${number}, ${year}`;
}

export function normalizeWeeks(value) {
  if (!Array.isArray(value) || value.length > 530) throw new Error("Ugyldig liste over prioriterte uker");
  for (const day of value) {
    if (typeof day !== "string" || weekStart(day) !== day) throw new Error("Ukevalg må være mandagsdatoer (ÅÅÅÅ-MM-DD)");
  }
  return [...new Set(value)].sort();
}

export function parseWeeklyUpgrade(payload) {
  if (!payload || payload.schema_version !== 1 ||
      !Number.isFinite(Date.parse(payload.published_at_utc)) ||
      typeof payload.source_agent !== "string" || !payload.source_agent.trim()) {
    throw new Error("Ukjent eller ugyldig format for ukeprioritering. Eksisterende innstillinger blir ikke overskrevet.");
  }
  for (const [key, value] of Object.entries(WEEKLY_UPGRADE_POLICY)) {
    if (JSON.stringify(payload[key]) !== JSON.stringify(value)) {
      throw new Error("Ukeprioriteringen bruker andre regler enn denne frontend-versjonen støtter. Oppdater frontend før redigering.");
    }
  }
  return { ...payload, enabled_week_starts: normalizeWeeks(payload.enabled_week_starts) };
}

export function buildWeeklyUpgrade(weeks, { now = new Date(), source = "ShiftWatch Frontend" } = {}) {
  return parseWeeklyUpgrade({ schema_version: 1, published_at_utc: now.toISOString(),
    source_agent: source, ...structuredClone(WEEKLY_UPGRADE_POLICY), enabled_week_starts: normalizeWeeks(weeks) });
}

export function desiredUpgradeDays(start, calendar, today) {
  return [shiftDate(start, 3), shiftDate(start, 5)].filter((day) =>
    ["included", "extra"].includes(calendarStateForDate(day, calendar, today)));
}
