import {
  SUBJECT_TEXT,
  WEEKDAYS,
  addDates,
  addPeriod,
  applyCalendarToConfig,
  calendarStateForDate,
  clearDateOverrides,
  createCommandText,
  datesInRange,
  extractCalendarFromConfig,
  removeDateValue,
  removePeriod,
  todayIso,
  toIsoDate,
} from "./calendar-core.js";

const FALLBACK_CONFIG = `# Lokal fallback dersom config/default-config.yaml ikke kan lastes.
mail:
  provider: graph
graph:
  tenant: consumers
criteria:
  allowed_locations:
    - Moss
  allowed_date_ranges:
    - start: "2026-08-11"
      end: "2026-12-31"
      weekdays:
        - monday
        - tuesday
        - wednesday
        - thursday
        - saturday
  date_start: "2026-08-11"
  date_end: "2026-12-31"
  blocked_weekdays:
    - friday
    - sunday
  extra_include_dates: []
  exclude_dates: []
`;

const state = {
  fullConfig: null,
  calendar: null,
  year: new Date().getFullYear(),
  selectionStart: null,
  selectionEnd: null,
  dirty: false,
};

const elements = {};
const monthFormatter = new Intl.DateTimeFormat("nb-NO", { month: "long" });
const longDateFormatter = new Intl.DateTimeFormat("nb-NO", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {
  for (const id of [
    "config-input",
    "insert-config",
    "paste-config",
    "load-repo-config",
    "config-source",
    "editor-section",
    "calendar-grid",
    "previous-year",
    "next-year",
    "current-year",
    "weekday-options",
    "selection-summary",
    "add-period",
    "add-exact",
    "add-exclusion",
    "clear-overrides",
    "clear-selection",
    "period-list",
    "extra-list",
    "exclude-list",
    "extra-count",
    "exclude-count",
    "copy-section",
    "copy-command",
    "copy-full-config",
    "subject-text",
    "status-message",
    "command-fallback",
    "command-output",
  ]) {
    elements[toCamel(id)] = document.getElementById(id);
  }

  elements.subjectText.textContent = SUBJECT_TEXT;
  buildWeekdayOptions();
  bindEvents();
  loadRepoConfig();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function toCamel(value) {
  return value.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

function bindEvents() {
  elements.insertConfig.addEventListener("click", () => insertConfigFromText("innlimt config"));
  elements.loadRepoConfig.addEventListener("click", loadRepoConfig);
  elements.pasteConfig.addEventListener("click", pasteFromClipboard);
  elements.previousYear.addEventListener("click", () => changeYear(-1));
  elements.nextYear.addEventListener("click", () => changeYear(1));
  elements.clearSelection.addEventListener("click", clearSelection);
  elements.addPeriod.addEventListener("click", includeSelectionAsPeriod);
  elements.addExact.addEventListener("click", includeSelectionExactly);
  elements.addExclusion.addEventListener("click", excludeSelection);
  elements.clearOverrides.addEventListener("click", clearSelectionOverrides);
  elements.copyCommand.addEventListener("click", copyCommand);
  elements.copyFullConfig.addEventListener("click", copyFullConfig);
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function buildWeekdayOptions() {
  const defaultBlocked = new Set(["friday", "sunday"]);
  for (const weekday of WEEKDAYS) {
    const label = document.createElement("label");
    label.className = "weekday-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = weekday.key;
    input.checked = !defaultBlocked.has(weekday.key);
    label.append(input, document.createTextNode(weekday.short));
    elements.weekdayOptions.append(label);
  }
}

async function loadRepoConfig() {
  setStatus("Laster config fra repoet …", "info");
  try {
    const response = await fetch(`config/default-config.yaml?v=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    elements.configInput.value = await response.text();
    insertConfigFromText("config/default-config.yaml");
  } catch (_error) {
    elements.configInput.value = FALLBACK_CONFIG;
    insertConfigFromText("innebygd fallback-config");
    setStatus(
      "Repo-config kunne ikke lastes. En lokal fallback vises; dette er normalt ved direkte file://-åpning.",
      "warning",
    );
  }
}

async function pasteFromClipboard() {
  try {
    elements.configInput.value = await navigator.clipboard.readText();
    insertConfigFromText("utklippstavlen");
  } catch (_error) {
    setStatus("Nettleseren ga ikke tilgang til utklippstavlen. Lim inn manuelt i feltet.", "error");
    elements.configInput.focus();
  }
}

function parseConfigYaml(text) {
  if (!globalThis.jsyaml) throw new Error("YAML-biblioteket kunne ikke lastes");
  const parsed = globalThis.jsyaml.load(text, { schema: globalThis.jsyaml.JSON_SCHEMA });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Configen må være et YAML-objekt");
  }
  return parsed;
}

function insertConfigFromText(source) {
  try {
    const parsed = parseConfigYaml(elements.configInput.value);
    state.fullConfig = parsed;
    state.calendar = extractCalendarFromConfig(parsed);
    state.year = preferredStartYear(state.calendar);
    state.selectionStart = null;
    state.selectionEnd = null;
    state.dirty = false;
    elements.configSource.textContent = `Aktiv kilde: ${source}`;
    elements.editorSection.classList.remove("is-disabled");
    elements.copySection.classList.remove("is-disabled");
    elements.commandFallback.hidden = true;
    renderAll();
    setStatus("Config lest. Kalenderen er klar for redigering.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function preferredStartYear(calendar) {
  const currentYear = new Date().getFullYear();
  const today = todayIso();
  const candidates = calendar.allowed_date_ranges
    .map((period) =>
      period.end >= today && period.start < today ? today : period.start,
    )
    .sort();
  return candidates.length > 0 ? Number(candidates[0].slice(0, 4)) : currentYear;
}

function renderAll() {
  if (!state.calendar) return;
  elements.currentYear.textContent = String(state.year);
  renderCalendar();
  renderSelectionSummary();
  renderPeriodList();
  renderDateLists();
}

function renderCalendar() {
  elements.calendarGrid.replaceChildren();
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    elements.calendarGrid.append(buildMonth(monthIndex));
  }
}

function buildMonth(monthIndex) {
  const month = document.createElement("section");
  month.className = "month-card";
  const heading = document.createElement("h3");
  heading.textContent = monthFormatter.format(new Date(state.year, monthIndex, 1));
  month.append(heading);

  const weekdayRow = document.createElement("div");
  weekdayRow.className = "weekday-row";
  for (const weekday of WEEKDAYS) {
    const label = document.createElement("span");
    label.textContent = weekday.short.slice(0, 2);
    weekdayRow.append(label);
  }
  month.append(weekdayRow);

  const days = document.createElement("div");
  days.className = "month-days";
  const first = new Date(state.year, monthIndex, 1);
  const mondayBasedOffset = (first.getDay() + 6) % 7;
  for (let index = 0; index < mondayBasedOffset; index += 1) {
    const blank = document.createElement("span");
    blank.className = "day-blank";
    days.append(blank);
  }

  const count = new Date(state.year, monthIndex + 1, 0).getDate();
  for (let day = 1; day <= count; day += 1) {
    const date = new Date(state.year, monthIndex, day, 12, 0, 0, 0);
    const iso = toIsoDate(date);
    const calendarState = calendarStateForDate(iso, state.calendar);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `calendar-day state-${calendarState}`;
    button.textContent = String(day);
    button.dataset.date = iso;
    button.title = `${longDateFormatter.format(date)} – ${stateLabel(calendarState)}`;
    button.setAttribute("aria-label", button.title);
    if (iso === todayIso()) button.classList.add("is-today");
    if (isSelected(iso)) button.classList.add("is-selected");
    if (calendarState === "past") {
      button.disabled = true;
    } else {
      button.addEventListener("click", () => selectDate(iso));
    }
    days.append(button);
  }
  month.append(days);
  return month;
}

function stateLabel(value) {
  return {
    included: "inkludert via periode",
    extra: "eksakt inkludert",
    excluded: "ekskludert",
    past: "fortid",
    available: "ikke inkludert",
  }[value];
}

function selectDate(iso) {
  if (!state.selectionStart || state.selectionEnd) {
    state.selectionStart = iso;
    state.selectionEnd = null;
  } else {
    state.selectionEnd = iso;
    if (state.selectionStart > state.selectionEnd) {
      [state.selectionStart, state.selectionEnd] = [state.selectionEnd, state.selectionStart];
    }
  }
  renderCalendar();
  renderSelectionSummary();
}

function isSelected(iso) {
  if (!state.selectionStart) return false;
  if (!state.selectionEnd) return iso === state.selectionStart;
  return iso >= state.selectionStart && iso <= state.selectionEnd;
}

function selectedDates({ requireRange = false } = {}) {
  if (!state.selectionStart) throw new Error("Velg først en dato i kalenderen");
  if (requireRange && !state.selectionEnd) {
    throw new Error("Velg også sluttdatoen for perioden");
  }
  return datesInRange(state.selectionStart, state.selectionEnd ?? state.selectionStart);
}

function renderSelectionSummary() {
  if (!state.selectionStart) {
    elements.selectionSummary.textContent = "Ingen datoer markert";
    return;
  }
  if (!state.selectionEnd) {
    elements.selectionSummary.textContent = `${formatIso(state.selectionStart)} – velg sluttdato`;
    return;
  }
  const count = selectedDates().length;
  elements.selectionSummary.textContent = `${formatIso(state.selectionStart)} – ${formatIso(
    state.selectionEnd,
  )} (${count} dager)`;
}

function selectedWeekdays() {
  return [...elements.weekdayOptions.querySelectorAll("input:checked")].map(
    (input) => input.value,
  );
}

function includeSelectionAsPeriod() {
  try {
    selectedDates({ requireRange: true });
    const weekdays = selectedWeekdays();
    if (weekdays.length === 0) throw new Error("Velg minst én ukedag");
    updateCalendar(
      addPeriod(state.calendar, state.selectionStart, state.selectionEnd, weekdays),
      "Perioden ble lagt til.",
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function includeSelectionExactly() {
  try {
    const values = selectedDates();
    let next = clearDateOverrides(state.calendar, values);
    next = addDates(next, "extra_include_dates", values);
    updateCalendar(next, `${values.length} dato(er) ble inkludert eksakt.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function excludeSelection() {
  try {
    const values = selectedDates();
    let next = clearDateOverrides(state.calendar, values);
    next = addDates(next, "exclude_dates", values);
    updateCalendar(next, `${values.length} dato(er) ble ekskludert.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function clearSelectionOverrides() {
  try {
    const values = selectedDates();
    updateCalendar(
      clearDateOverrides(state.calendar, values),
      "Eksakt inkludering og ekskludering ble fjernet for markeringen.",
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function clearSelection() {
  state.selectionStart = null;
  state.selectionEnd = null;
  renderCalendar();
  renderSelectionSummary();
}

function updateCalendar(calendar, message) {
  state.calendar = calendar;
  state.dirty = true;
  clearSelection();
  renderPeriodList();
  renderDateLists();
  setStatus(message, "success");
}

function renderPeriodList() {
  elements.periodList.replaceChildren();
  state.calendar.allowed_date_ranges.forEach((period, index) => {
    const row = document.createElement("article");
    row.className = "period-row";
    const body = document.createElement("div");
    const dates = document.createElement("strong");
    dates.textContent = `${formatIso(period.start)} – ${formatIso(period.end)}`;
    const weekdays = document.createElement("span");
    weekdays.textContent = period.weekdays
      .map((key) => WEEKDAYS.find((item) => item.key === key)?.short ?? key)
      .join(", ");
    body.append(dates, weekdays);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "Fjern";
    remove.setAttribute("aria-label", `Fjern perioden ${dates.textContent}`);
    remove.addEventListener("click", () => {
      try {
        updateCalendar(removePeriod(state.calendar, index), "Perioden ble fjernet.");
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
    row.append(body, remove);
    elements.periodList.append(row);
  });
}

function renderDateLists() {
  renderDateChipList("extra_include_dates", elements.extraList);
  renderDateChipList("exclude_dates", elements.excludeList);
  elements.extraCount.textContent = String(state.calendar.extra_include_dates.length);
  elements.excludeCount.textContent = String(state.calendar.exclude_dates.length);
}

function renderDateChipList(field, container) {
  container.replaceChildren();
  if (state.calendar[field].length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = "Ingen datoer";
    container.append(empty);
    return;
  }
  for (const value of state.calendar[field]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "date-chip";
    chip.textContent = `${formatIso(value)} ×`;
    chip.title = `Fjern ${value}`;
    chip.addEventListener("click", () => {
      updateCalendar(removeDateValue(state.calendar, field, value), `${value} ble fjernet.`);
    });
    container.append(chip);
  }
}

function changeYear(delta) {
  state.year += delta;
  state.selectionStart = null;
  state.selectionEnd = null;
  renderAll();
  document.querySelector(".calendar-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyCommand() {
  if (!state.calendar) return;
  try {
    const command = await createCommandText(state.calendar);
    const copied = await copyText(command);
    elements.commandOutput.value = command;
    elements.commandFallback.hidden = copied;
    if (!copied) {
      elements.commandOutput.focus();
      elements.commandOutput.select();
    }
    state.dirty = false;
    setStatus(
      copied
        ? `Kalenderkommando kopiert. Bruk tema «${SUBJECT_TEXT}».`
        : "Automatisk kopiering ble blokkert. Kommandoen er markert for manuell kopiering.",
      copied ? "success" : "warning",
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function copyFullConfig() {
  if (!state.calendar || !state.fullConfig) return;
  try {
    const updated = applyCalendarToConfig(state.fullConfig, state.calendar);
    const yaml = globalThis.jsyaml.dump(updated, {
      schema: globalThis.jsyaml.JSON_SCHEMA,
      noRefs: true,
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
    });
    const copied = await copyText(yaml);
    state.fullConfig = updated;
    elements.configInput.value = yaml;
    state.dirty = false;
    setStatus(
      copied
        ? "Oppdatert full config ble kopiert. YAML-kommentarer bevares ikke ved denne eksporten."
        : "Kopiering ble blokkert. Den oppdaterte configen ligger nå i config-feltet.",
      copied ? "success" : "warning",
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
}

function formatIso(value) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

let statusTimer = null;
function setStatus(message, type = "info") {
  window.clearTimeout(statusTimer);
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message status-${type} is-visible`;
  statusTimer = window.setTimeout(() => {
    elements.statusMessage.classList.remove("is-visible");
  }, type === "error" ? 9000 : 5500);
}
