export const REMOTE_CONTROL_FILENAME = "shiftwatch_agent_control.json";
export const PING_RESPONSE_PREFIX = "shiftwatch_agent_ping_response_";
export const TARGET_CONTROL_PREFIX = "shiftwatch_agent_target_control_";
export const TARGET_ACK_PREFIX = "shiftwatch_agent_target_ack_";
export const TARGETED_CONTROL_CAPABILITY = "targeted_control_v1";

const BROADCAST_COMMANDS = new Set(["pause", "resume", "ping"]);
const TARGET_COMMANDS = new Set(["pause", "resume"]);

export function sanitizeAgentId(value) {
  const safe = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/gu, "_");
  if (!safe) throw new Error("Agent-ID mangler");
  return safe;
}

function requiredText(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${fieldName} mangler`);
  return text;
}

function normalizedDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} er ugyldig`);
  return date;
}

function commandEnvelope(command, options, allowedCommands) {
  const normalizedCommand = String(command ?? "").trim().toLowerCase();
  if (!allowedCommands.has(normalizedCommand)) {
    throw new Error(`Ukjent agentkommando: ${command}`);
  }
  const now = normalizedDate(options.now ?? new Date(), "Tidspunkt");
  const ttlSeconds = Number(options.ttlSeconds ?? 60);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 3600) {
    throw new Error("Kommandoens levetid må være mellom 1 og 3600 sekunder");
  }
  return {
    schema_version: 1,
    command_id: requiredText(options.commandId, "command_id"),
    command: normalizedCommand,
    published_at_utc: now.toISOString(),
    expires_at_utc: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    issuer_agent_id: requiredText(options.issuerAgentId, "issuer_agent_id"),
    issuer_label: String(options.issuerLabel ?? "").trim() || "ShiftWatch Frontend",
  };
}

export function buildRemoteControlPayload(command, options = {}) {
  return commandEnvelope(command, options, BROADCAST_COMMANDS);
}

export function buildTargetControlPayload(command, options = {}) {
  return {
    ...commandEnvelope(command, options, TARGET_COMMANDS),
    target_agent_id: requiredText(options.targetAgentId, "target_agent_id"),
  };
}

export function pingResponsePrefix(requesterAgentId) {
  return `${PING_RESPONSE_PREFIX}${sanitizeAgentId(requesterAgentId)}_`;
}

export function targetControlFilename(targetAgentId) {
  return `${TARGET_CONTROL_PREFIX}${sanitizeAgentId(targetAgentId)}.json`;
}

export function targetAckFilename(requesterAgentId, targetAgentId) {
  return `${TARGET_ACK_PREFIX}${sanitizeAgentId(requesterAgentId)}_${sanitizeAgentId(targetAgentId)}.json`;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeAgentState(value) {
  const state = String(value ?? "").trim().toLowerCase();
  return state === "active" || state === "paused" ? state : "unknown";
}

export function parsePingResponse(payload, { requesterAgentId, pingId } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Ping-svaret er ikke et JSON-objekt");
  }
  if (payload.schema_version !== 1) {
    throw new Error(`Ukjent ping-svarversjon: ${payload.schema_version}`);
  }
  const responsePingId = requiredText(payload.ping_id, "ping_id");
  const responseRequester = requiredText(payload.requester_agent_id, "requester_agent_id");
  const agentId = requiredText(payload.responder_agent_id, "responder_agent_id");
  const label = requiredText(payload.responder_label, "responder_label");
  const respondedAtUtc = requiredText(payload.responded_at_utc, "responded_at_utc");
  normalizedDate(respondedAtUtc, "responded_at_utc");
  if (pingId && responsePingId !== pingId) return null;
  if (requesterAgentId && responseRequester !== requesterAgentId) return null;
  const capabilities = normalizeCapabilities(payload.capabilities);
  return {
    pingId: responsePingId,
    requesterAgentId: responseRequester,
    agentId,
    label,
    respondedAtUtc,
    agentState: normalizeAgentState(payload.agent_state),
    capabilities,
    supportsTargetedControl: capabilities.includes(TARGETED_CONTROL_CAPABILITY),
  };
}

export function parseTargetAck(
  payload,
  { requesterAgentId, targetAgentId, commandId } = {},
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Agentbekreftelsen er ikke et JSON-objekt");
  }
  if (payload.schema_version !== 1) {
    throw new Error(`Ukjent agentbekreftelsesversjon: ${payload.schema_version}`);
  }
  const ack = {
    commandId: requiredText(payload.command_id, "command_id"),
    requesterAgentId: requiredText(payload.requester_agent_id, "requester_agent_id"),
    agentId: requiredText(payload.responder_agent_id, "responder_agent_id"),
    label: String(payload.responder_label ?? "").trim() || "Ukjent agent",
    command: requiredText(payload.command, "command").toLowerCase(),
    appliedAtUtc: requiredText(payload.applied_at_utc, "applied_at_utc"),
    agentState: normalizeAgentState(payload.agent_state),
  };
  normalizedDate(ack.appliedAtUtc, "applied_at_utc");
  if (commandId && ack.commandId !== commandId) return null;
  if (requesterAgentId && ack.requesterAgentId !== requesterAgentId) return null;
  if (targetAgentId && ack.agentId !== targetAgentId) return null;
  return ack;
}
