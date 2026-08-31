import {
  REMOTE_CONTROL_FILENAME,
  buildRemoteControlPayload,
  buildTargetControlPayload,
  parsePingResponse,
  parseTargetAck,
  pingResponsePrefix,
  targetAckFilename,
  targetControlFilename,
} from "./agent-control-core.js";

function defaultUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export class FrontendAgentControl {
  constructor({
    store,
    agentId,
    agentLabel = "ShiftWatch Frontend",
    uuid = defaultUuid,
    now = () => new Date(),
    sleep = defaultSleep,
  } = {}) {
    if (!store) throw new Error("OneDrive-lager mangler for agentkontroll");
    this.store = store;
    this.agentId = String(agentId ?? "").trim();
    if (!this.agentId) throw new Error("Frontend agent-ID mangler");
    this.agentLabel = String(agentLabel).trim() || "ShiftWatch Frontend";
    this.uuid = uuid;
    this.now = now;
    this.sleep = sleep;
  }

  createPayload(command) {
    return buildRemoteControlPayload(command, {
      issuerAgentId: this.agentId,
      issuerLabel: this.agentLabel,
      commandId: this.uuid(),
      now: this.now(),
      ttlSeconds: 60,
    });
  }

  async sendBroadcast(command) {
    const payload = this.createPayload(command);
    const metadata = await this.store.uploadJson(payload, REMOTE_CONTROL_FILENAME);
    return { payload, metadata };
  }

  async ping({ durationMs = 20_000, pollMs = 1_500, onResponse, onProgress } = {}) {
    const { payload } = await this.sendBroadcast("ping");
    const deadline = Date.now() + Math.max(0, durationMs);
    const responsePrefix = pingResponsePrefix(this.agentId);
    const seenEtags = new Map();
    const responses = new Map();
    onProgress?.({ pingId: payload.command_id, remainingMs: durationMs, count: 0 });

    while (true) {
      const metadataItems = await this.store.listMetadata({ prefix: responsePrefix });
      for (const metadata of metadataItems) {
        const name = String(metadata?.name ?? "");
        const itemId = String(metadata?.id ?? "").trim();
        const eTag = String(metadata?.eTag ?? "");
        if (!itemId || (eTag && seenEtags.get(name) === eTag)) continue;
        if (eTag) seenEtags.set(name, eTag);
        try {
          const responsePayload = await this.store.downloadJsonItem(itemId);
          const response = parsePingResponse(responsePayload, {
            requesterAgentId: this.agentId,
            pingId: payload.command_id,
          });
          if (!response) continue;
          const isNew = !responses.has(response.agentId);
          responses.set(response.agentId, response);
          if (isNew) onResponse?.(response);
        } catch (_error) {
          // En uferdig eller eldre svarfil skal ikke avbryte resten av pingen.
        }
      }

      const remainingMs = deadline - Date.now();
      onProgress?.({
        pingId: payload.command_id,
        remainingMs: Math.max(0, remainingMs),
        count: responses.size,
      });
      if (remainingMs <= 0) break;
      await this.sleep(Math.min(pollMs, remainingMs));
    }
    return { pingId: payload.command_id, responses: [...responses.values()] };
  }

  async sendTargetCommand(
    targetAgentId,
    command,
    { timeoutMs = 15_000, pollMs = 1_500 } = {},
  ) {
    const payload = buildTargetControlPayload(command, {
      issuerAgentId: this.agentId,
      issuerLabel: this.agentLabel,
      targetAgentId,
      commandId: this.uuid(),
      now: this.now(),
      ttlSeconds: 60,
    });
    await this.store.uploadJson(payload, targetControlFilename(targetAgentId));
    const ackName = targetAckFilename(this.agentId, targetAgentId);
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let seenETag = "";

    while (true) {
      const metadata = await this.store.getMetadataFor(ackName);
      const eTag = String(metadata?.eTag ?? "");
      if (metadata?.id && (!eTag || eTag !== seenETag)) {
        seenETag = eTag;
        try {
          const ackPayload = await this.store.downloadJsonItem(metadata.id);
          const ack = parseTargetAck(ackPayload, {
            requesterAgentId: this.agentId,
            targetAgentId,
            commandId: payload.command_id,
          });
          if (ack) return { payload, ack };
        } catch (_error) {
          // Vent på at mål-agenten erstatter en gammel eller ufullstendig fil.
        }
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return { payload, ack: null };
      await this.sleep(Math.min(pollMs, remainingMs));
    }
  }
}
