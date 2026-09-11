# Targeted stop protocol v1

Frontend implementation: 2.4.0. Agent implementation: planned for the next
ShiftWatch agent release. Existing broadcast, ping and `targeted_control_v1`
behavior remains unchanged.

## Capability

An agent that supports both targeted stop choices adds this exact value to the
existing ping response `capabilities` array:

```json
"targeted_stop_v1"
```

The frontend must not enable Stop without this capability. Legacy agents remain
visible and retain any pause/resume support they already advertise.

## Commands

The existing target-specific control filename and schema are reused. The two
new exact command values are:

- `stop_agent`: stop mail monitoring and release keep-awake, but leave the
  ShiftWatch Control window open.
- `quit_program`: stop the agent, release keep-awake and close ShiftWatch
  Control. It must never shut down, restart or sign out of Windows.

Example:

```json
{
  "schema_version": 1,
  "command_id": "6ae5f071-4955-4d2d-bc49-57a4f794d17d",
  "command": "stop_agent",
  "published_at_utc": "2026-09-11T08:00:00.000Z",
  "expires_at_utc": "2026-09-11T08:01:00.000Z",
  "issuer_agent_id": "frontend-example",
  "issuer_label": "ShiftWatch Frontend",
  "target_agent_id": "exact-stable-agent-id"
}
```

The agent must validate schema, expiry, issuer, exact target ID and a previously
unseen command ID. A stop command is never broadcast and must not be inferred
from unsupported values.

## Acknowledgement and shutdown order

Use the existing target acknowledgement filename/schema. The acknowledgement
must repeat the exact `command_id`, requester, responder and command. Report
`agent_state: "stopping"` for `stop_agent` and `agent_state: "exiting"` for
`quit_program`.

For both commands, publish the acknowledgement successfully before initiating
shutdown. Then stop workers, close HTTP/browser resources and release the
Windows execution-state request. For `quit_program`, notify the parent GUI only
after acknowledgement so it can close itself cleanly. If acknowledgement cannot
be published, fail closed and keep running; the frontend will report that no
confirmation arrived.

Repeated delivery of the same command ID must not trigger another shutdown
sequence. Pause/resume remain idempotent. The frontend may issue targeted
commands while the manual ping countdown is still collecting other agents.
