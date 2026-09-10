import { WEEKLY_UPGRADE_FILE, buildWeeklyUpgrade, parseWeeklyUpgrade } from "./weekly-upgrade-core.js";

export class FrontendWeeklyUpgrade {
  constructor(store) { this.store = store; }
  async load() {
    const metadata = await this.store.getMetadataFor(WEEKLY_UPGRADE_FILE);
    if (!metadata) return { metadata: null, payload: null, weeks: [] };
    const payload = parseWeeklyUpgrade(await this.store.downloadJsonItem(metadata.id));
    return { metadata, payload, weeks: payload.enabled_week_starts };
  }
  async save(weeks, expectedMetadata) {
    const current = await this.store.getMetadataFor(WEEKLY_UPGRADE_FILE);
    if ((current?.id ?? null) !== (expectedMetadata?.id ?? null) ||
        (current?.eTag ?? null) !== (expectedMetadata?.eTag ?? null)) {
      throw new Error("Ukeprioriteringen er endret fra en annen enhet. Hent siste kalender før du publiserer ukevalget på nytt.");
    }
    const payload = buildWeeklyUpgrade(weeks);
    const metadata = await this.store.uploadJsonGuarded(payload, WEEKLY_UPGRADE_FILE, current);
    return { metadata, payload, weeks: payload.enabled_week_starts };
  }
}
