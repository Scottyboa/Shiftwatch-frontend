import { SIMPLE_LOG_PREFIX, simpleLogFileId, parseSimpleEvent, mergeSimpleEvents } from "./simple-log-core.js";

export class FrontendSimpleLog {
  constructor(store, { now = () => Date.now() } = {}) { this.store = store; this.now = now; this.cache = new Map(); }
  clear() { this.cache.clear(); }
  async load() {
    const items = (await this.store.listMetadata({ prefix: SIMPLE_LOG_PREFIX }))
      .filter((item) => simpleLogFileId(item.name));
    let unreadable = 0, cleanupFailed = 0;
    const events = [];
    const ids = new Set(items.map((item) => item.id));
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    // Deliberately low concurrency to share Graph capacity with running agents.
    let cursor = 0, fatalError = null;
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
      while (cursor < items.length && !fatalError) {
        const item = items[cursor++];
        let event;
        try {
          if (Number(item.size) > 1024 * 1024) throw new Error("For stor loggfil");
          const cached = this.cache.get(item.id);
          event = cached && item.eTag && cached.eTag === item.eTag ? cached.event
            : parseSimpleEvent(await this.store.downloadJsonItem(item.id));
          if (event.event_id !== simpleLogFileId(item.name)) throw new Error("Logg-ID stemmer ikke med filnavnet");
          this.cache.set(item.id, { event, eTag: item.eTag });
        } catch (error) {
          // Authorization/rate-limit failures are not a reason to continue a flood of calls.
          if (error.name === "InteractiveAuthenticationRequired" || [401, 403, 429, 503].includes(error.status)) {
            fatalError = error;
            continue;
          }
          unreadable += 1;
          const cached = this.cache.get(item.id);
          if (cached) events.push(cached.event);
          continue;
        }
        if (Date.parse(event.expires_at_utc) <= this.now()) {
          try {
            if (item.eTag) await this.store.deleteJsonItem(item.id, item.eTag);
            else cleanupFailed += 1;
            this.cache.delete(item.id);
          } catch (_error) { cleanupFailed += 1; }
        } else events.push(event);
      }
    }));
    if (fatalError) throw fatalError;
    return { events: mergeSimpleEvents(events, this.now()), unreadable, cleanupFailed };
  }
}
