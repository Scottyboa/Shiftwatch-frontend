import {
  WEEKDAYS,
  addDates,
  addPeriod,
  calendarStateForDate,
  clearDateOverrides,
  datesInRange,
  normalizeCalendarCriteria,
  removeDateValue,
  removePeriod,
  todayIso,
  toIsoDate,
} from "./calendar-core.js";
import { ONEDRIVE_CONFIG } from "./onedrive-config.js";
import {
  buildSharedCalendarPayload,
  calendarFromSharedPayload,
} from "./onedrive-core.js";
import {
  InteractiveAuthenticationRequired,
  MicrosoftSession,
  OneDriveCalendarStore,
} from "./onedrive-sync.js";
import { FrontendAgentControl } from "./agent-control.js";

const PENDING_ACTION_KEY = "shiftwatch.onedrive.pending-action";
const EDITOR_SNAPSHOT_KEY = "shiftwatch.onedrive.editor-snapshot";
const FRONTEND_AGENT_ID_KEY = "shiftwatch.agent-control.frontend-id";

const state = {
  calendar: null,
  year: new Date().getFullYear(),
  selectionStart: null,
  selectionEnd: null,
  dirty: false,
  remote: null,
  cloudBusy: false,
  cloudAction: null,
  agentCommandBusy: false,
  pingBusy: false,
  latestPingId: null,
  agentResponses: new Map(),
  pendingTargets: new Set(),
};

let microsoftSession = null;
let oneDriveStore = null;
let agentControl = null;
const elements = {};
const monthFormatter = new Intl.DateTimeFormat("nb-NO", { month: "long" });
const longDateFormatter = new Intl.DateTimeFormat("nb-NO", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const timestampFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "medium",
  timeStyle: "short",
});

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {
  for (const id of [
    "fetch-onedrive",
    "publish-onedrive",
    "disconnect-onedrive",
    "connection-status",
    "sync-details",
    "agent-control-card",
    "pause-all-agents",
    "resume-all-agents",
    "ping-agents",
    "open-agent-status",
    "agent-control-details",
    "agent-status-dialog",
    "agent-status-summary",
    "agent-status-list",
    "close-agent-status",
    "clear-agent-status",
    "ping-agents-again",
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
    "status-message",
  ]) {
    elements[toCamel(id)] = document.getElementById(id);
  }

  buildWeekdayOptions();
  bindEvents();
  updateCloudControls();
  initializeOneDrive();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function toCamel(value) {
  return value.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

function bindEvents() {
  elements.fetchOnedrive.addEventListener("click", () => runCloudAction("fetch"));
  elements.publishOnedrive.addEventListener("click", () => runCloudAction("publish"));
  elements.disconnectOnedrive.addEventListener("click", disconnectOneDrive);
  elements.pauseAllAgents.addEventListener("click", () => runAgentAction("pause"));
  elements.resumeAllAgents.addEventListener("click", () => runAgentAction("resume"));
  elements.pingAgents.addEventListener("click", () => runAgentAction("ping"));
  elements.openAgentStatus.addEventListener("click", openAgentStatus);
  elements.closeAgentStatus.addEventListener("click", closeAgentStatus);
  elements.clearAgentStatus.addEventListener("click", clearAgentStatus);
  elements.pingAgentsAgain.addEventListener("click", () => runAgentAction("ping"));
  elements.agentStatusDialog.addEventListener("click", (event) => {
    if (event.target === elements.agentStatusDialog) closeAgentStatus();
  });
  elements.previousYear.addEventListener("click", () => changeYear(-1));
  elements.nextYear.addEventListener("click", () => changeYear(1));
  elements.clearSelection.addEventListener("click", clearSelection);
  elements.addPeriod.addEventListener("click", includeSelectionAsPeriod);
  elements.addExact.addEventListener("click", includeSelectionExactly);
  elements.addExclusion.addEventListener("click", excludeSelection);
  elements.clearOverrides.addEventListener("click", clearSelectionOverrides);
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function initializeOneDrive() {
  try {
    microsoftSession = new MicrosoftSession(ONEDRIVE_CONFIG);
    oneDriveStore = new OneDriveCalendarStore({
      session: microsoftSession,
      fileName: ONEDRIVE_CONFIG.fileName,
    });
    agentControl = new FrontendAgentControl({
      store: oneDriveStore,
      agentId: getFrontendAgentId(),
      agentLabel: ONEDRIVE_CONFIG.sourceAgent,
    });
    const result = await microsoftSession.initialize();
    updateConnectionStatus();

    const pendingAction = window.sessionStorage.getItem(PENDING_ACTION_KEY);
    if (pendingAction && result.connected) {
      window.sessionStorage.removeItem(PENDING_ACTION_KEY);
      if (pendingAction === "publish") restoreEditorSnapshot();
      await executeCloudAction(pendingAction);
    }
  } catch (error) {
    updateConnectionStatus(false);
    setStatus(friendlyError(error), "error");
  }
}

async function runCloudAction(action) {
  if (state.cloudBusy || !microsoftSession) return;
  if (action === "fetch" && state.dirty) {
    const replace = window.confirm(
      "Du har upubliserte kalenderendringer. Vil du forkaste dem og hente siste OneDrive-versjon?",
    );
    if (!replace) return;
  }
  if (action === "publish" && !state.calendar) {
    setStatus("Hent først siste kalender fra OneDrive.", "warning");
    return;
  }

  if (!microsoftSession.isConnected()) {
    await beginLoginForAction(action);
    return;
  }

  try {
    await executeCloudAction(action);
  } catch (error) {
    if (error instanceof InteractiveAuthenticationRequired) {
      await beginLoginForAction(action);
      return;
    }
    setStatus(friendlyError(error), "error");
  }
}

async function runAgentAction(command) {
  if (!microsoftSession || !agentControl || state.cloudBusy) return;
  if (command === "ping" && state.pingBusy) {
    openAgentStatus();
    return;
  }
  if (command !== "ping" && state.agentCommandBusy) return;

  if (command === "pause") {
    const confirmed = window.confirm(
      "Vil du sende PAUSE til alle andre kjørende ShiftWatch-agenter?",
    );
    if (!confirmed) return;
  }
  if (command === "resume") {
    const confirmed = window.confirm(
      "Vil du sende GJENOPPTA til alle andre kjørende ShiftWatch-agenter?",
    );
    if (!confirmed) return;
  }

  const action = `agent-${command}`;
  if (!microsoftSession.isConnected()) {
    await beginLoginForAction(action);
    return;
  }
  try {
    await executeCloudAction(action);
  } catch (error) {
    if (error instanceof InteractiveAuthenticationRequired) {
      await beginLoginForAction(action);
      return;
    }
    setStatus(friendlyError(error), "error");
  }
}

async function beginLoginForAction(action) {
  try {
    if (action === "publish") persistEditorSnapshot();
    window.sessionStorage.setItem(PENDING_ACTION_KEY, action);
    setStatus("Åpner sikker Microsoft-innlogging …", "info");
    await microsoftSession.beginLogin();
  } catch (error) {
    window.sessionStorage.removeItem(PENDING_ACTION_KEY);
    setStatus(friendlyError(error), "error");
  }
}

async function executeCloudAction(action) {
  if (action === "fetch") return fetchRemoteCalendar();
  if (action === "publish") return publishRemoteCalendar();
  if (action === "agent-pause") return broadcastAgentCommand("pause");
  if (action === "agent-resume") return broadcastAgentCommand("resume");
  if (action === "agent-ping") return pingAgents();
  throw new Error("Ukjent OneDrive-handling");
}

async function fetchRemoteCalendar() {
  setCloudBusy(true, "fetch");
  try {
    const { metadata, payload } = await oneDriveStore.download();
    const calendar = calendarFromSharedPayload(payload);
    state.remote = remoteState(metadata, payload);
    activateCalendar(calendar);
    state.dirty = false;
    clearEditorSnapshot();
    updateRemoteDetails();
    updateConnectionStatus();
    setStatus("Siste kalender ble hentet fra OneDrive og er klar for redigering.", "success");
  } finally {
    setCloudBusy(false);
  }
}

async function publishRemoteCalendar() {
  if (!state.remote) {
    throw new Error("Hent siste OneDrive-kalender før du publiserer");
  }
  setCloudBusy(true, "publish");
  try {
    const currentMetadata = await oneDriveStore.getMetadata();
    const loadedTag = String(state.remote.eTag ?? "");
    const currentTag = String(currentMetadata?.eTag ?? "");
    if (!currentMetadata) {
      throw new Error("OneDrive-filen ble slettet etter at den ble hentet. Hent på nytt.");
    }
    if (loadedTag && currentTag && loadedTag !== currentTag) {
      const overwrite = window.confirm(
        "OneDrive-kalenderen er oppdatert av en annen agent etter at du hentet den. " +
          "Trykk OK for å overskrive med kalenderen på skjermen, eller Avbryt for å hente på nytt.",
      );
      if (!overwrite) {
        setStatus("Publisering avbrutt. Hent siste kalender før du fortsetter.", "warning");
        return;
      }
    }

    const payload = buildSharedCalendarPayload(state.calendar, {
      sourceAgent: ONEDRIVE_CONFIG.sourceAgent,
    });
    const metadata = await oneDriveStore.upload(payload);
    state.remote = remoteState(metadata, payload);
    state.dirty = false;
    clearEditorSnapshot();
    updateRemoteDetails();
    setStatus(
      "Kalenderen er publisert til OneDrive. Kjørende agenter henter endringen automatisk.",
      "success",
    );
  } finally {
    setCloudBusy(false);
  }
}

async function broadcastAgentCommand(command) {
  state.agentCommandBusy = true;
  const isPause = command === "pause";
  elements.agentControlDetails.textContent = isPause
    ? "Sender pausekommando til alle agenter …"
    : "Sender gjenoppta-kommando til alle agenter …";
  updateCloudControls();
  try {
    await agentControl.sendBroadcast(command);
    const text = isPause
      ? "Pausekommando er publisert. Kjørende agenter bruker den normalt innen få sekunder."
      : "Gjenoppta-kommando er publisert. Kjørende agenter bruker den normalt innen få sekunder.";
    elements.agentControlDetails.textContent = text;
    updateConnectionStatus();
    setStatus(text, "success");
  } finally {
    state.agentCommandBusy = false;
    updateCloudControls();
  }
}

async function pingAgents() {
  state.pingBusy = true;
  state.latestPingId = null;
  state.agentResponses.clear();
  state.pendingTargets.clear();
  elements.agentControlDetails.textContent = "Sender ping og venter på agentsvar …";
  renderAgentStatus();
  openAgentStatus();
  updateCloudControls();
  try {
    const result = await agentControl.ping({
      onResponse(response) {
        state.agentResponses.set(response.agentId, response);
        renderAgentStatus();
      },
      onProgress(progress) {
        state.latestPingId = progress.pingId;
        const seconds = Math.ceil(progress.remainingMs / 1000);
        elements.agentControlDetails.textContent =
          `Lytter etter agentsvar: ${progress.count} mottatt` +
          (seconds > 0 ? ` • ${seconds} sekunder igjen` : "");
        renderAgentStatus(progress.remainingMs);
        updateAgentControls();
      },
    });
    const count = result.responses.length;
    const text =
      count === 0
        ? "Pingen er ferdig. Ingen agenter svarte i løpet av 20 sekunder."
        : `Pingen er ferdig. ${count} agent${count === 1 ? "" : "er"} svarte.`;
    elements.agentControlDetails.textContent = text;
    setStatus(text, count > 0 ? "success" : "warning");
  } finally {
    state.pingBusy = false;
    renderAgentStatus(0);
    updateCloudControls();
  }
}

async function sendTargetAgentCommand(agentId, command) {
  const response = state.agentResponses.get(agentId);
  if (!response?.supportsTargetedControl || state.pendingTargets.has(agentId)) return;
  const verb = command === "pause" ? "pause" : "gjenoppta";
  if (!window.confirm(`Vil du ${verb} bare ${response.label}?`)) return;

  state.pendingTargets.add(agentId);
  renderAgentStatus();
  updateCloudControls();
  try {
    const result = await agentControl.sendTargetCommand(agentId, command);
    if (!result.ack) {
      setStatus(
        `${response.label} bekreftet ikke kommandoen innen 15 sekunder.`,
        "warning",
      );
      return;
    }
    state.agentResponses.set(agentId, {
      ...response,
      agentState: result.ack.agentState,
      lastCommandAtUtc: result.ack.appliedAtUtc,
    });
    setStatus(
      `${response.label} bekreftet ${command === "pause" ? "pause" : "gjenopptakelse"}.`,
      "success",
    );
  } catch (error) {
    setStatus(friendlyError(error), "error");
  } finally {
    state.pendingTargets.delete(agentId);
    renderAgentStatus();
    updateCloudControls();
  }
}

function renderAgentStatus(remainingMs = null) {
  if (!elements.agentStatusList) return;
  const responses = [...state.agentResponses.values()].sort((left, right) =>
    left.label.localeCompare(right.label, "nb-NO"),
  );
  if (!state.latestPingId) {
    elements.agentStatusSummary.textContent = "Ingen ping er sendt i denne nettleserøkten.";
  } else if (state.pingBusy) {
    const seconds = Math.ceil(Math.max(0, remainingMs ?? 0) / 1000);
    elements.agentStatusSummary.textContent =
      `${responses.length} svar mottatt` + (seconds > 0 ? ` • ${seconds} sekunder igjen` : "");
  } else {
    elements.agentStatusSummary.textContent =
      responses.length === 0
        ? "Ingen agenter svarte på siste ping."
        : `${responses.length} agent${responses.length === 1 ? "" : "er"} svarte på siste ping.`;
  }

  elements.agentStatusList.replaceChildren();
  if (responses.length === 0) {
    const empty = document.createElement("div");
    empty.className = "agent-empty-state";
    empty.textContent = state.pingBusy ? "Venter på svar …" : "Ingen agentsvar ennå.";
    elements.agentStatusList.append(empty);
    return;
  }

  for (const response of responses) {
    const row = document.createElement("article");
    row.className = "agent-status-row";

    const identity = document.createElement("div");
    identity.className = "agent-identity";
    const name = document.createElement("strong");
    name.textContent = response.label;
    const id = document.createElement("code");
    id.textContent = response.agentId;
    identity.append(name, id);

    const status = document.createElement("div");
    status.className = "agent-response-state";
    const badge = document.createElement("span");
    badge.className = `agent-state-badge is-${response.agentState}`;
    badge.textContent = agentStateLabel(response.agentState);
    const timestamp = document.createElement("span");
    timestamp.textContent = `Svarte ${formatTimestamp(response.respondedAtUtc) || response.respondedAtUtc}`;
    status.append(badge, timestamp);

    const actions = document.createElement("div");
    actions.className = "agent-row-actions";
    const targetBusy = state.pendingTargets.has(response.agentId);
    for (const command of ["pause", "resume"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `button ${command === "pause" ? "button-danger" : "button-primary"} button-small`;
      button.textContent = targetBusy
        ? "Venter …"
        : command === "pause"
          ? "Pause"
          : "Gjenoppta";
      button.disabled =
        !response.supportsTargetedControl || targetBusy || state.cloudBusy || state.pingBusy;
      button.title = response.supportsTargetedControl
        ? `${command === "pause" ? "Pause" : "Gjenoppta"} bare ${response.label}`
        : "Krever den kommende ShiftWatch-agentoppdateringen";
      button.addEventListener("click", () => sendTargetAgentCommand(response.agentId, command));
      actions.append(button);
    }
    if (!response.supportsTargetedControl) {
      const note = document.createElement("small");
      note.className = "agent-capability-note";
      note.textContent = "Individuell styring krever ny agentversjon";
      actions.append(note);
    }
    row.append(identity, status, actions);
    elements.agentStatusList.append(row);
  }
}

function agentStateLabel(value) {
  return { active: "Aktiv", paused: "Pauset", unknown: "Status ukjent" }[value] ?? "Status ukjent";
}

function openAgentStatus() {
  renderAgentStatus();
  if (typeof elements.agentStatusDialog.showModal === "function") {
    if (!elements.agentStatusDialog.open) elements.agentStatusDialog.showModal();
  } else {
    elements.agentStatusDialog.setAttribute("open", "");
  }
}

function closeAgentStatus() {
  if (typeof elements.agentStatusDialog.close === "function") {
    if (elements.agentStatusDialog.open) elements.agentStatusDialog.close();
  } else {
    elements.agentStatusDialog.removeAttribute("open");
  }
}

function clearAgentStatus() {
  state.latestPingId = null;
  state.agentResponses.clear();
  state.pendingTargets.clear();
  renderAgentStatus();
  updateAgentControls();
}

async function disconnectOneDrive() {
  if (
    !microsoftSession ||
    state.cloudBusy ||
    state.agentCommandBusy ||
    state.pingBusy ||
    state.pendingTargets.size > 0
  ) return;
  if (state.dirty) {
    const disconnect = window.confirm(
      "Du har upubliserte endringer. Vil du koble fra og forkaste dem?",
    );
    if (!disconnect) return;
  }
  window.sessionStorage.removeItem(PENDING_ACTION_KEY);
  clearEditorSnapshot();
  state.calendar = null;
  state.remote = null;
  state.dirty = false;
  state.latestPingId = null;
  state.agentResponses.clear();
  state.pendingTargets.clear();
  elements.editorSection.classList.add("is-disabled");
  renderAgentStatus();
  updateCloudControls();
  setStatus("Kobler fra Microsoft …", "info");
  try {
    await microsoftSession.disconnect();
  } catch (error) {
    setStatus(friendlyError(error), "error");
  }
}

function activateCalendar(calendar) {
  state.calendar = normalizeCalendarCriteria(calendar);
  state.year = preferredStartYear(state.calendar);
  state.selectionStart = null;
  state.selectionEnd = null;
  elements.editorSection.classList.remove("is-disabled");
  renderAll();
  updateCloudControls();
}

function remoteState(metadata, payload) {
  return {
    id: String(metadata?.id ?? ""),
    eTag: String(metadata?.eTag ?? ""),
    lastModifiedDateTime: String(metadata?.lastModifiedDateTime ?? ""),
    publishedAtUtc: String(payload?.published_at_utc ?? ""),
    sourceAgent: String(payload?.source_agent ?? "Ukjent kilde"),
  };
}

function updateConnectionStatus(forceConnected) {
  const connected =
    typeof forceConnected === "boolean"
      ? forceConnected
      : Boolean(microsoftSession?.isConnected());
  elements.connectionStatus.textContent = connected ? "Tilkoblet Microsoft" : "Ikke tilkoblet";
  elements.connectionStatus.classList.toggle("is-online", connected);
  elements.connectionStatus.classList.toggle("is-offline", !connected);
  elements.disconnectOnedrive.hidden = !connected;
  if (elements.agentControlDetails && !state.pingBusy && !state.agentCommandBusy) {
    elements.agentControlDetails.textContent = connected
      ? "Klar. Ping viser alle agenter som svarer i løpet av 20 sekunder."
      : "Koble til Microsoft for å styre eller pinge agenter.";
  }
  updateCloudControls();
}

function updateRemoteDetails() {
  if (!state.remote) {
    elements.syncDetails.textContent = "Kalenderen er låst til siste OneDrive-versjon er hentet.";
    return;
  }
  const published = formatTimestamp(state.remote.publishedAtUtc);
  const modified = formatTimestamp(state.remote.lastModifiedDateTime);
  elements.syncDetails.textContent = [
    `Kilde: ${state.remote.sourceAgent}`,
    published ? `publisert ${published}` : "",
    modified ? `OneDrive oppdatert ${modified}` : "",
    state.dirty ? "upubliserte endringer på denne enheten" : "synkronisert",
  ]
    .filter(Boolean)
    .join(" • ");
}

function setCloudBusy(busy, action = null) {
  state.cloudBusy = busy;
  state.cloudAction = busy ? action : null;
  elements.fetchOnedrive.textContent =
    busy && action === "fetch" ? "Henter …" : "Hent siste kalender";
  elements.publishOnedrive.textContent =
    busy && action === "publish" ? "Publiserer …" : "Publiser kalender";
  updateCloudControls();
}

function updateCloudControls() {
  if (!elements.fetchOnedrive) return;
  elements.fetchOnedrive.disabled = state.cloudBusy;
  elements.publishOnedrive.disabled = state.cloudBusy || !state.calendar || !state.remote;
  elements.disconnectOnedrive.disabled =
    state.cloudBusy ||
    state.agentCommandBusy ||
    state.pingBusy ||
    state.pendingTargets.size > 0;
  updateAgentControls();
}

function updateAgentControls() {
  if (!elements.pauseAllAgents) return;
  const unavailable = !agentControl || state.cloudBusy;
  elements.pauseAllAgents.disabled = unavailable || state.agentCommandBusy;
  elements.resumeAllAgents.disabled = unavailable || state.agentCommandBusy;
  elements.pingAgents.disabled = unavailable || state.pingBusy;
  elements.pingAgentsAgain.disabled = unavailable || state.pingBusy;
  elements.openAgentStatus.disabled = !state.latestPingId && state.agentResponses.size === 0;
}

function persistEditorSnapshot() {
  if (!state.calendar) return;
  window.sessionStorage.setItem(
    EDITOR_SNAPSHOT_KEY,
    JSON.stringify({ calendar: state.calendar, remote: state.remote, dirty: state.dirty }),
  );
}

function restoreEditorSnapshot() {
  const raw = window.sessionStorage.getItem(EDITOR_SNAPSHOT_KEY);
  if (!raw) return;
  try {
    const snapshot = JSON.parse(raw);
    state.remote = snapshot.remote ?? null;
    activateCalendar(snapshot.calendar);
    state.dirty = Boolean(snapshot.dirty);
    updateRemoteDetails();
  } catch (_error) {
    clearEditorSnapshot();
  }
}

function clearEditorSnapshot() {
  window.sessionStorage.removeItem(EDITOR_SNAPSHOT_KEY);
}

function getFrontendAgentId() {
  try {
    const existing = window.localStorage.getItem(FRONTEND_AGENT_ID_KEY);
    if (existing) return existing;
    const unique = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const created = `frontend-${unique}`;
    window.localStorage.setItem(FRONTEND_AGENT_ID_KEY, created);
    return created;
  } catch (_error) {
    const unique = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `frontend-${unique}`;
  }
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AADSTS50011") || message.toLowerCase().includes("redirect")) {
    return "Microsoft avviste returadressen. Legg den eksakte GitHub Pages-adressen inn som SPA redirect URI i appregistreringen.";
  }
  if (message.toLowerCase().includes("failed to fetch")) {
    return "Kunne ikke kontakte Microsoft. Kontroller internettforbindelsen og prøv igjen.";
  }
  return message;
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timestampFormatter.format(date);
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

function preferredStartYear(calendar) {
  const currentYear = new Date().getFullYear();
  const today = todayIso();
  const candidates = calendar.allowed_date_ranges
    .map((period) => (period.end >= today && period.start < today ? today : period.start))
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
  updateRemoteDetails();
  updateCloudControls();
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
  }, type === "error" ? 10000 : 6500);
}
