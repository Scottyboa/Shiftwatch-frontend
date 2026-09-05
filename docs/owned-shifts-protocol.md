# Owned shifts v1 — frontend 2.2.0 / next agent update

Status: frontend implemented; desktop agent implementation is the next step.
All files are separate children of the existing OneDrive App Folder. Existing
calendar, broadcast, targeted pause/resume and ping schemas remain unchanged.

## Discovery

Use the existing `ping` broadcast in `shiftwatch_agent_control.json`.
The upgraded agent adds `owned_shifts_v1` to `capabilities` in its existing
ping reply, alongside `targeted_control_v1`. Both active and paused agents may
respond and fetch shifts. Reading shifts must not resume a paused agent.

Frontend waits up to 20 seconds, stopping once a capable responder is found.
Only replies with the current ping ID and requester ID are considered. Choose
one capable responder. A scan request is never broadcast to all agents, nor
sent to a legacy v110 agent. A browser's automatic discovery is serialized
after its current manual broadcast operation. Other browsers/agents can still
overwrite the legacy shared ping file; in that case retry manually.

## Request

Filename: `shiftwatch_owned_shifts_request_<safe_target_agent_id>.json`.
Sanitization matches the existing agent protocol: trim and replace every
character outside `[A-Za-z0-9._-]` with `_`. Payload IDs always remain exact.

```json
{
  "schema_version": 1,
  "request_id": "unique-uuid",
  "command": "fetch_owned_shifts",
  "published_at_utc": "2026-09-05T20:00:00.000Z",
  "expires_at_utc": "2026-09-05T20:02:00.000Z",
  "issuer_agent_id": "frontend-instance-id",
  "issuer_label": "ShiftWatch Frontend",
  "target_agent_id": "agent-instance-id"
}
```

Agent requirements:

1. Poll only its own request file in a background task. Enforce schema,
   command, exact target, timestamps/expiry and request ID deduplication.
2. Use an independent browser/session owned by that worker. Do not navigate
   the claim browser away from LedigeVakter.aspx or share Playwright objects
   across threads. Use the agent's existing authorized login configuration.
3. Read `KommendeVakter.aspx`, table `#tblUpcomingWatch`. Submitted reference
   HTML uses `paging:false`; read all rows, including below the scroll area.
   Date is `td.table-date[data-sort]` (`YYYY.MM.DD`), time is `.table-time`,
   type is `.table-watch-type`, workplace cell ID ends in `tdWorkPlaceUpcomming`.
   Verify authentication and correct page/table, and that rows have loaded.
   Never read available shifts, trade requests, awaiting-approval rows, or
   execute Give away/Bytte buttons. Handle a valid empty state explicitly;
   a missing/unrecognized table or unparsed row is an error, not zero shifts.
4. Read every supplied upcoming row, with no one-year cutoff. Preserve exact
   source calendar dates; no timezone conversion. Store start-date rows for
   overnight shifts; do not manufacture a second day. Preserve multiple shifts
   on a date. Return only date, times, type and workplace (no raw HTML,
   hidden ASP.NET fields, session cookies, physician names or comments).
5. After a successful full scan, save the snapshot below to
   `shiftwatch_owned_shifts.json`. On failure, preserve the previous snapshot.
   Publish the correlated response as well. Serialize/coalesce local scans;
   use conditional updates/rechecks to prevent older concurrent results from
   replacing newer saved snapshots. Respond with each request's own IDs.
6. Use conditional eTag deletion of the consumed request so a later request
   is not accidentally deleted. Expiry prevents execution after a long delay.
   Response filenames are overwritten on later requests, not accumulated.

## Snapshot (saved file and successful response)

```json
{
  "schema_version": 1,
  "request_id": "unique-uuid",
  "requester_agent_id": "frontend-instance-id",
  "responder_agent_id": "agent-instance-id",
  "responder_label": "WORK-PC/agent-instance-id",
  "fetched_at_utc": "2026-09-05T20:00:04.000Z",
  "source_page": "KommendeVakter.aspx",
  "complete": true,
  "row_count": 1,
  "shifts": [
    {"date": "2026-12-23", "start": "16:00", "end": "22:00", "type": "Kveld 2", "location": "Moss"}
  ]
}
```

`complete` means every row returned by that page was read successfully; it
does not assert infinite server-side date coverage. `row_count` must equal
the number of normalized shifts. Dates must be real `YYYY-MM-DD` dates, times
`HH:MM` (00:00–23:59), type/workplace nonempty. Convert site midnight `24:00`
to `00:00` if encountered. For no shifts, send `row_count: 0, shifts: []` only
after verifying the site's legitimate empty state. Client rejects the whole
snapshot for a malformed row, unsupported schema, wrong page or incomplete
flag. Defensive client size limit is 10,000 rows.

## Response

Filename:
`shiftwatch_owned_shifts_response_<safe_requester_id>_<safe_target_id>.json`.

```json
{
  "schema_version": 1,
  "request_id": "unique-uuid",
  "requester_agent_id": "frontend-instance-id",
  "responder_agent_id": "agent-instance-id",
  "completed_at_utc": "2026-09-05T20:00:04.000Z",
  "status": "ok",
  "snapshot": {"...": "complete snapshot object specified above"}
}
```

For failure use `status: "error"` and omit `snapshot`. Log sanitized diagnostic
details locally in the agent; the frontend displays a generic failure message.

Frontend polls the response filename every 2 seconds for up to 90 seconds
after request upload. Only matching request/requester/responder IDs are
accepted, including the nested snapshot IDs. Completion/fetch timestamps must
not predate request publication. All timestamps must include a timezone and
must not exceed the browser clock by more than five minutes. Keep PC clocks
synchronized. Old/invalid replies are ignored; network failures stop the
current refresh and preserve the displayed snapshot. Requests expire after
120 seconds, so a late agent may still finish after the frontend has timed out;
its saved snapshot can be loaded on the next refresh.

## Validation and limitations

`node --test` covers protocol validation, multiple agents, paused responders,
multiple years, overnight/multiple shifts, stale/wrong replies, timeouts,
network/agent failure, empty results, safe text rendering, calendar criteria
isolation and the automatic fetch-to-overlay DOM flow. Graph and the future
agent are simulated; no live authenticated legevakt/agent end-to-end run has
been performed for this frontend-only release.
