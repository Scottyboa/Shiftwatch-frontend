# Weekly upgrade and simple log v1

Frontend implementation: 2.3.0. Agent implementation: **not included in this release**.
No code in this frontend claims, advertises, or navigates to legevakt.no. The
existing calendar (six shared fields), ping, targeted control and owned-shifts
protocols remain unchanged. Store all new files in the existing OneDrive App Folder.

## Weekly settings

Filename: `shiftwatch_weekly_upgrade_config.json`.
No file means disabled for every week. Unknown/malformed data means unavailable,
not an empty replacement. A read failure must not trigger a write or enable anything.

```json
{
  "schema_version": 1,
  "published_at_utc": "2026-09-09T14:00:00.000Z",
  "source_agent": "ShiftWatch Frontend",
  "enabled_week_starts": ["2026-09-14", "2026-12-28"],
  "priority_order": [["saturday"], ["thursday"], ["monday", "tuesday", "wednesday"]],
  "replacement_limit": 1,
  "require_calendar_match": true,
  "claim_before_advertise": true
}
```

Week keys are exact Monday dates, not week numbers. A week is Monday–Sunday
using the shift's start date in Europe/Oslo, including overnight shifts. ISO
week 53, 2026 is `2026-12-28`, including 1–3 January 2027. A date selection
activates all intersecting weeks. The list is deduplicated and sorted; maximum
530 weeks. Empty array is explicitly disabled for all weeks. The fixed policy
values above must match; this frontend refuses to edit unsupported policy rules.

**Publishing is separate from the normal calendar.** `Publiser kalender` only
writes the existing calendar file. `Publiser ukevalg` only writes this policy.
This avoids representing a partially successful two-file write as full success.
`Hent siste kalender` reads both, and warns before discarding either draft.
Authentication redirect preserves both drafts and loaded version metadata in
the existing tab's sessionStorage; published OneDrive files remain authoritative.

Frontend checks current metadata then uses an upload session with If-Match for
an existing file, and conflictBehavior=fail for a new file. Conflict or unknown
upload outcome must not automatically retry with unconditional overwrite.
The upload URL is pre-authorized and is never sent the Graph bearer token.
See [Microsoft upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0).

### Required agent behavior for the next update

1. Apply ALL existing calendar/time/type/location criteria first. An excluded
   Saturday or Thursday is never claimed because a week is enabled. Frontend
   only knows shared date criteria; its warning is not a full claim eligibility test.
2. Disabled weeks retain existing behavior. Friday/Sunday keep ordinary criteria
   behavior and are not upgrade candidates or automatic advertisement targets.
3. In an enabled week, Saturday outranks Thursday, which outranks the equal
   Mon/Tue/Wed tier. No existing shift means normal claiming. Equal/lower-ranked
   incoming shifts must not be claimed as upgrades. Do not chain an advertised
   old shift back into the selection as if it were a new upgrade opportunity.
4. Claim a qualifying higher-ranked shift first, regardless of whether the old
   shift currently has a Give away button. Missing button/advertisement failure
   must not prevent the new claim or roll it back.
5. Only after verified success (or reliable reconciliation proving another one
   of this user's agents claimed this new shift) may advertisement begin. A
   NOT_FOUND or a mere pre-existing owned row is not sufficient proof of a new claim.
6. Advertise at most ONE eligible, lower-priority, still-future, not-yet-advertised
   owned shift in that week. Pick the lowest tier first; ties use earliest start
   date/time then stable shift ID. Never advertise the newly claimed shift, a
   same/higher-priority shift, an unrelated week, or a Friday/Sunday under this policy.
   Already advertised rows remain the user's responsibility but require no repeat action.
7. Resolve the site's dynamic shift IDs. Traverse Gi bort → Annonser denne vakta →
   Registrer vakt som ledig. Verify exact old shift identity before each final mutation.
   Refresh `KommendeVakter.aspx` after submission, bypass browser cache, and confirm
   the exact row is Markert ledig. Do not treat HTTP 200 alone as confirmation.
8. Coordinate the advertisement across processes with a shared, conditional,
   short-lived action lease and durable outcome, scoped to the old shift ID as
   well as the upgrade event. This also prevents two different mail events from
   advertising the same old shift. A lease is not by itself an exactly-once
   guarantee against the website: verify state before retrying after a timeout,
   renew/check ownership before submission, and reconcile uncertain results.
9. Never advertise after a failed/unconfirmed claim. On advertisement failure,
   keep the new shift and tell the user to handle the old shift manually. A
   late successful claim from another agent can replace a prior failure result.
10. Keep network logging/sync off the claim-critical path, with bounded retries,
    background outbox, and backoff for Graph throttling. Do not move or share the
    claim worker's Playwright page across threads. All claim-capable agents need
    this update; legacy agents ignore the weekly policy.

The frontend marks enabled weeks with a small amber underline. Existing criterion
fills, today's marker, selection highlighting and dark blue owned-shift outline
remain independent. Missing desired Thursday/Saturday dates produces a warning,
not an automatic calendar change.

## One canonical simple event per actual email

Filename: `shiftwatch_simple_event_<event_id>.json`, where event_id is 64 lower-case
hex characters: SHA-256 of the trimmed Graph internetMessageId in UTF-8. Add
internetMessageId to the agent's Graph select. If missing, agree on a stable
fallback across ALL agents: SHA-256 of `fallback-v1\n` + lower-case sender address
+ `\n` + receivedDateTime normalized to UTC ISO milliseconds + `\n` + trimmed
subject. Persist it once. Two distinct emails about the same shift must not be
merged solely because date/time/type are the same. No email body or raw headers
are stored in the log; only matching sender's shift mail is eligible.

```json
{
  "schema_version": 1,
  "event_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "first_seen_at_utc": "2026-09-09T14:00:00.000Z",
  "expires_at_utc": "2026-09-11T14:00:00.000Z",
  "settle_after_utc": "2026-09-09T14:02:00.000Z",
  "shift": {
    "date": "2026-09-19", "start": "12:00", "end": "20:00",
    "type": "Kv/Mellom1", "location": "Moss"
  },
  "reports": [
    {
      "agent_id": "example-pc",
      "at_utc": "2026-09-09T14:00:10.000Z",
      "mail": { "matches": true, "reason": "" },
      "upgrade_enabled": true,
      "claim": { "status": "claimed", "at_utc": "2026-09-09T14:00:02.000Z", "reason": "" },
      "advertisement": {
        "status": "advertised", "at_utc": "2026-09-09T14:00:10.000Z", "reason": "",
        "shift": {
          "date": "2026-09-14", "start": "16:00", "end": "22:00",
          "type": "Kv/Mellom1", "location": "Moss"
        }
      }
    }
  ]
}
```

- `first_seen_at_utc`: earliest agent processing time for this mail. Never reset
  when a late agent discovers the same email. Agent local persistent state/outbox
  must prevent expired events being recreated after cloud cleanup.
- `expires_at_utc`: first_seen + 48h, never extended by later results. Frontend
  clamps longer expiry values to 48h.
- `settle_after_utc`: first_seen + 120s recommended; permitted range first_seen
  through first_seen + 10 minutes. This is presentation grace, not permission to
  advertise, and not evidence that unknown agents failed.
- `reports`: 1–100 agent reports, keep latest per agent while preserving confirmed
  successes. Append/update using read/merge/conditional write, never blind
  last-writer-wins. On conflict re-read and merge, with bounded retries in the
  background. Creation must fail on an existing canonical filename, then merge.
  Prove CAS/lease behavior against the actual OneDrive API in agent integration
  tests before enabling multi-agent advertisement; unit tests alone do not prove it.
- `mail.matches` required boolean. `reason` is short, plain, single-line text.
  `claim`: omitted or pending/claimed/failed/skipped with at_utc and optional reason.
  `skipped` covers equal/higher owned priority or paused agent without claiming.
- `advertisement`: omitted when not applicable; pending/advertised/failed with
  at_utc and exact OLD `shift`. Requires upgrade_enabled=true and globally
  confirmed new claim. Advertised means listed as available, not handed over.
- All timestamps must carry timezone information. Date fields are literal source
  dates, times HH:MM. Reason/type/location are bounded plain text. Max file 1 MiB.
  Unknown versions and malformed files are reported/skipped, never deleted.
- Frontend ignores diagnostics, HTML and extra fields; renders with textContent.
  Writer must exclude cookies, tokens, personal mail, names and patient data.

### Display and retention

Render one event group: mail match/nonmatch → confirmed claim outcome → optional
old-shift advertisement outcome. Any confirmed success wins over loser failures.
Failure is displayed only after the settlement time and no current pending report
remains. Unresolved work is shown as awaiting a result, not invented failure.
All nonmatches collapse; mixed matches/nonmatches use a match if any agent matches.
Skip/failed reasons are concise. No navigation, HTTP, retry or session diagnostics.

Load when Hent siste kalender is used or Oppdater logg is clicked. No continuous
Graph polling is added. eTag cache avoids re-downloading unchanged files; maximum
three parallel reads. Enumeration includes pagination. Partial read failures show
an incomplete-data warning while retaining still-valid cached events. Repeated
reads cannot downgrade a displayed confirmed success to a loser failure.

Hide at expiry with a timer and on tab visibility changes. At fetch time, delete
only validated expired canonical files with matching filename/event ID, using
their metadata eTag in If-Match. A concurrently updated version is not deleted.
No deletion of calendar, control, owned shifts, malformed files or unknown schemas.
Agents also need periodic cleanup (recommended 30 minutes). With all clients
closed, physical cleanup waits until a client runs again; no server TTL is assumed.
Graph DELETE moves files to the recycle bin, not permanent erasure:
[Microsoft delete semantics](https://learn.microsoft.com/en-us/graph/api/driveitem-delete?view=graph-rest-1.0).

## Rollout and verification

Frontend can be installed first; missing policy means off and missing log means
empty. v111.2 keeps calendar, owned-shifts fetch and agent control working but
does not implement weekly upgrades or write this log. No broader Microsoft scope
is requested. Ship the next agent ZIP separately. Do not exercise real claim or
advertisement actions as a frontend smoke test.

Tests cover weeks spanning New Year, disabled/default policy, exclusion precedence,
unknown formats, concurrent settings conflicts, no bearer token on upload URLs,
winner/loser aggregation, skips/nonmatches, pending results, advertiser outcome,
48h expiry, safe cleanup and existing calendar/control/owned-shifts regressions.
