import {
  OWNED_SHIFTS_CAPABILITY, OWNED_SHIFTS_FILENAME,
  buildOwnedShiftsRequest, ownedShiftsRequestFilename, ownedShiftsResponseFilename,
  parseOwnedShiftsResponse, parseOwnedShiftsSnapshot,
} from "./owned-shifts-core.js";

export class FrontendOwnedShifts {
  constructor({ store, requesterId, discoverAgents, now = () => new Date(),
    uuid = () => globalThis.crypto.randomUUID(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    clock = () => Date.now(),
  }) {
    Object.assign(this, { store, requesterId, discoverAgents, now, uuid, sleep, clock });
    this.inFlight = null;
  }

  refresh(options = {}) {
    // Repeated clicks/calendar fetches cannot dispatch duplicate scans.
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run(options).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async run({ onSnapshot, onStatus, timeoutMs = 90_000, pollMs = 2_000 } = {}) {
    onStatus?.("cache");
    // A damaged cache must not stop a new scan from repairing it.
    try {
      const meta = await this.store.getMetadataFor(OWNED_SHIFTS_FILENAME);
      if (meta?.id) onSnapshot?.(parseOwnedShiftsSnapshot(
        await this.store.downloadJsonItem(meta.id), { now: this.now() }), false);
    } catch (_error) {
      onStatus?.("cache-error");
    }
    onStatus?.("discovering");
    const { responses } = await this.discoverAgents();
    const target = responses.find((agent) => agent.agentId !== this.requesterId &&
      agent.capabilities?.includes(OWNED_SHIFTS_CAPABILITY));
    if (!target) {
      const status = responses.length ? "upgrade-required" : "no-agent";
      onStatus?.(status);
      return { status };
    }
    const request = buildOwnedShiftsRequest({ requesterId: this.requesterId,
      targetAgentId: target.agentId, requestId: this.uuid(), now: this.now() });
    await this.store.uploadJson(request, ownedShiftsRequestFilename(target.agentId));
    onStatus?.("fetching", target.label);
    const deadline = this.clock() + timeoutMs;
    const responseName = ownedShiftsResponseFilename(this.requesterId, target.agentId);
    let seenETag = null;
    while (true) {
      const meta = await this.store.getMetadataFor(responseName);
      if (meta?.id && (!meta.eTag || meta.eTag !== seenETag)) {
        // Network failures propagate; invalid/old replies are ignored until timeout.
        const payload = await this.store.downloadJsonItem(meta.id);
        let response = null;
        try { response = parseOwnedShiftsResponse(payload, request, { now: this.now() }); }
        catch (_error) { /* Never display an incomplete result. */ }
        seenETag = meta.eTag;
        if (response?.status === "error") {
          onStatus?.("agent-error", target.label);
          return { status: "agent-error" };
        }
        if (response?.status === "ok") {
          onSnapshot?.(response.snapshot, true);
          onStatus?.("success", target.label);
          return { status: "success", snapshot: response.snapshot };
        }
      }
      const remaining = deadline - this.clock();
      if (remaining <= 0) {
        onStatus?.("timeout", target.label);
        return { status: "timeout" };
      }
      await this.sleep(Math.min(pollMs, remaining));
    }
  }
}
