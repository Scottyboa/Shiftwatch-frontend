export const SUBJECT_TEXT = "Shiftwatch changes";
export const COMMAND_HEADER = "SHIFTWATCH-CALENDAR-COMMAND-V1";

export const WEEKDAYS = [
  { key: "monday", short: "Man", long: "mandag" },
  { key: "tuesday", short: "Tir", long: "tirsdag" },
  { key: "wednesday", short: "Ons", long: "onsdag" },
  { key: "thursday", short: "Tor", long: "torsdag" },
  { key: "friday", short: "Fre", long: "fredag" },
  { key: "saturday", short: "Lør", long: "lørdag" },
  { key: "sunday", short: "Søn", long: "søndag" },
];

export const SHARED_CALENDAR_KEYS = [
  "allowed_date_ranges",
  "date_start",
  "date_end",
  "blocked_weekdays",
  "extra_include_dates",
  "exclude_dates",
];

const WEEKDAY_SET = new Set(WEEKDAYS.map((day) => day.key));

export function cloneJson(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function parseIsoDate(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function toIsoDate(value) {
  const date = value instanceof Date ? value : parseIsoDate(value);
  if (!date) throw new Error(`Ugyldig dato: ${String(value)}`);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIso(now = new Date()) {
  return toIsoDate(now);
}

function normalizeDate(value, label, { optional = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text && optional) return "";
  if (!parseIsoDate(text)) throw new Error(`${label} har ugyldig dato: ${text || "(tom)"}`);
  return text;
}

function normalizeWeekdays(values, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(values)) throw new Error(`${label} må være en liste`);
  const normalized = [];
  for (const raw of values) {
    const value = String(raw).trim().toLowerCase();
    if (!WEEKDAY_SET.has(value)) throw new Error(`${label} har ukjent ukedag: ${value}`);
    if (!normalized.includes(value)) normalized.push(value);
  }
  if (!allowEmpty && normalized.length === 0) {
    throw new Error(`${label} må inneholde minst én ukedag`);
  }
  return WEEKDAYS.map((day) => day.key).filter((key) => normalized.includes(key));
}

function normalizeDateList(values, label) {
  if (values == null) return [];
  if (!Array.isArray(values)) throw new Error(`${label} må være en liste`);
  return [...new Set(values.map((value) => normalizeDate(value, label)))].sort();
}

function normalizePeriod(period, index) {
  if (!period || typeof period !== "object" || Array.isArray(period)) {
    throw new Error(`Periode ${index + 1} må være et objekt`);
  }
  const start = normalizeDate(period.start, `Periode ${index + 1}: start`);
  const end = normalizeDate(period.end, `Periode ${index + 1}: end`);
  if (start > end) throw new Error(`Periode ${index + 1}: start er etter end`);
  let rawWeekdays = period.weekdays ?? period.allowed_weekdays;
  if (rawWeekdays == null && Array.isArray(period.blocked_weekdays)) {
    const blocked = new Set(
      normalizeWeekdays(period.blocked_weekdays, `Periode ${index + 1}: blocked_weekdays`, {
        allowEmpty: true,
      }),
    );
    rawWeekdays = WEEKDAYS.map((day) => day.key).filter((key) => !blocked.has(key));
  }
  const weekdays = normalizeWeekdays(rawWeekdays ?? [], `Periode ${index + 1}`);
  return { start, end, weekdays };
}

export function normalizeCalendarCriteria(rawCriteria) {
  if (!rawCriteria || typeof rawCriteria !== "object" || Array.isArray(rawCriteria)) {
    throw new Error("criteria må være et YAML-objekt");
  }

  const blockedWeekdays = normalizeWeekdays(
    rawCriteria.blocked_weekdays ?? [],
    "blocked_weekdays",
    { allowEmpty: true },
  );
  let periods = rawCriteria.allowed_date_ranges ?? [];
  if (!Array.isArray(periods)) throw new Error("allowed_date_ranges må være en liste");
  periods = periods.map(normalizePeriod);

  const dateStart = normalizeDate(rawCriteria.date_start, "date_start", { optional: true });
  const dateEnd = normalizeDate(rawCriteria.date_end, "date_end", { optional: true });
  if ((dateStart && !dateEnd) || (!dateStart && dateEnd)) {
    throw new Error("date_start og date_end må enten begge være satt eller begge være tomme");
  }
  if (dateStart && dateStart > dateEnd) throw new Error("date_start er etter date_end");

  if (periods.length === 0 && dateStart && dateEnd) {
    const blocked = new Set(blockedWeekdays);
    periods = [
      {
        start: dateStart,
        end: dateEnd,
        weekdays: WEEKDAYS.map((day) => day.key).filter((key) => !blocked.has(key)),
      },
    ];
  }
  if (periods.length === 0) {
    throw new Error("Configen må inneholde minst én allowed_date_ranges-periode");
  }

  const result = {
    allowed_date_ranges: periods,
    date_start: dateStart,
    date_end: dateEnd,
    blocked_weekdays: blockedWeekdays,
    extra_include_dates: normalizeDateList(
      rawCriteria.extra_include_dates ?? [],
      "extra_include_dates",
    ),
    exclude_dates: normalizeDateList(rawCriteria.exclude_dates ?? [], "exclude_dates"),
  };
  return syncLegacyDateBounds(result);
}

export function extractCalendarFromConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Config-filen må inneholde et YAML-objekt");
  }
  const criteria = config.criteria;
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
    throw new Error("Fant ikke criteria-blokken i config-filen");
  }
  return normalizeCalendarCriteria(criteria);
}

export function applyCalendarToConfig(config, calendar) {
  const output = cloneJson(config);
  if (!output.criteria || typeof output.criteria !== "object" || Array.isArray(output.criteria)) {
    output.criteria = {};
  }
  const normalized = normalizeCalendarCriteria(calendar);
  for (const key of SHARED_CALENDAR_KEYS) {
    output.criteria[key] = cloneJson(normalized[key]);
  }
  return output;
}

export function syncLegacyDateBounds(calendar) {
  const output = cloneJson(calendar);
  const periods = output.allowed_date_ranges ?? [];
  if (periods.length > 0) {
    output.date_start = periods.map((period) => period.start).sort()[0];
    output.date_end = periods.map((period) => period.end).sort().at(-1);

    const weekdaySignatures = periods.map((period) => [...period.weekdays].sort().join(","));
    if (weekdaySignatures.every((signature) => signature === weekdaySignatures[0])) {
      const allowed = new Set(periods[0].weekdays);
      output.blocked_weekdays = WEEKDAYS.map((day) => day.key).filter(
        (key) => !allowed.has(key),
      );
    }
  }
  return output;
}

export function weekdayKey(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) throw new Error(`Ugyldig dato: ${isoDate}`);
  return WEEKDAYS[(date.getDay() + 6) % 7].key;
}

export function periodMatchesDate(period, isoDate) {
  return (
    isoDate >= period.start &&
    isoDate <= period.end &&
    period.weekdays.includes(weekdayKey(isoDate))
  );
}

export function calendarStateForDate(isoDate, calendar, currentDay = todayIso()) {
  if (isoDate < currentDay) return "past";
  if (calendar.exclude_dates.includes(isoDate)) return "excluded";
  if (calendar.extra_include_dates.includes(isoDate)) return "extra";
  if (calendar.allowed_date_ranges.some((period) => periodMatchesDate(period, isoDate))) {
    return "included";
  }
  return "available";
}

export function datesInRange(startIso, endIso) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) throw new Error("Utvalget inneholder ugyldig dato");
  if (start > end) return datesInRange(endIso, startIso);
  const values = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    values.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return values;
}

export function addPeriod(calendar, start, end, weekdays) {
  const next = cloneJson(calendar);
  const period = normalizePeriod({ start, end, weekdays }, next.allowed_date_ranges.length);
  const signature = JSON.stringify(period);
  if (!next.allowed_date_ranges.some((item) => JSON.stringify(item) === signature)) {
    next.allowed_date_ranges.push(period);
  }
  next.allowed_date_ranges.sort((a, b) =>
    `${a.start}|${a.end}`.localeCompare(`${b.start}|${b.end}`),
  );
  return syncLegacyDateBounds(next);
}

export function removePeriod(calendar, index) {
  const next = cloneJson(calendar);
  next.allowed_date_ranges.splice(index, 1);
  if (next.allowed_date_ranges.length === 0) {
    throw new Error("Kalenderen må inneholde minst én periode");
  }
  return syncLegacyDateBounds(next);
}

export function addDates(calendar, field, values) {
  if (!new Set(["extra_include_dates", "exclude_dates"]).has(field)) {
    throw new Error(`Ukjent datofelt: ${field}`);
  }
  const next = cloneJson(calendar);
  next[field] = [...new Set([...next[field], ...values.map((value) => normalizeDate(value, field))])].sort();
  return next;
}

export function clearDateOverrides(calendar, values) {
  const next = cloneJson(calendar);
  const removing = new Set(values);
  next.extra_include_dates = next.extra_include_dates.filter((value) => !removing.has(value));
  next.exclude_dates = next.exclude_dates.filter((value) => !removing.has(value));
  return next;
}

export function removeDateValue(calendar, field, value) {
  const next = cloneJson(calendar);
  next[field] = next[field].filter((item) => item !== value);
  return next;
}

function bytesToBase64Url(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  }
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(value) {
  if (typeof atob === "function") {
    const standard = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createCommandText(
  calendar,
  {
    now = new Date(),
    commandId = globalThis.crypto.randomUUID(),
  } = {},
) {
  const normalized = normalizeCalendarCriteria(calendar);
  const payload = {
    schema_version: 1,
    command: "replace_calendar",
    command_id: commandId,
    created_at_utc: now.toISOString(),
    calendar_criteria: normalized,
  };
  const json = JSON.stringify(payload);
  const encoded = bytesToBase64Url(new TextEncoder().encode(json));
  const wrapped = encoded.match(/.{1,76}/gu)?.join("\n") ?? encoded;
  const digest = await sha256Hex(json);
  return [
    COMMAND_HEADER,
    "PAYLOAD-BEGIN",
    wrapped,
    "PAYLOAD-END",
    `SHA256:${digest}`,
  ].join("\n");
}

export async function decodeCommandText(commandText) {
  const text = String(commandText).trim();
  if (!text.startsWith(`${COMMAND_HEADER}\n`)) throw new Error("Ukjent kommandoformat");
  const match = /PAYLOAD-BEGIN\s+([A-Za-z0-9_\-\s]+?)\s+PAYLOAD-END\s+SHA256:([a-f0-9]{64})/u.exec(text);
  if (!match) throw new Error("Kommandoen mangler payload eller SHA256");
  const encoded = match[1].replace(/\s+/gu, "");
  const json = new TextDecoder().decode(base64UrlToBytes(encoded));
  const actualDigest = await sha256Hex(json);
  if (actualDigest !== match[2]) throw new Error("SHA256 stemmer ikke");
  const payload = JSON.parse(json);
  if (payload.schema_version !== 1 || payload.command !== "replace_calendar") {
    throw new Error("Ugyldig kalenderkommando");
  }
  payload.calendar_criteria = normalizeCalendarCriteria(payload.calendar_criteria);
  return payload;
}
