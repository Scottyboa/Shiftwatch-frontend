import test from "node:test";
import assert from "node:assert/strict";

import { FrontendAgentControl } from "../src/agent-control.js";
import {
  REMOTE_CONTROL_FILENAME,
  TARGETED_CONTROL_CAPABILITY,
  buildRemoteControlPayload,
  parsePingResponse,
  pingResponsePrefix,
  targetAckFilename,
  targetControlFilename,
} from "../src/agent-control-core.js";

const fixedNow = new Date("2026-08-22T12:00:00.000Z");

test("builds the exact broadcast payload understood by current ShiftWatch agents", () => {
  const payload = buildRemoteControlPayload("pause", {
    issuerAgentId: "frontend-test",
    issuerLabel: "ShiftWatch Frontend",
    commandId: "command-1",
    now: fixedNow,
    ttlSeconds: 60,
  });

  assert.deepEqual(Object.keys(payload), [
    "schema_version",
    "command_id",
    "command",
    "published_at_utc",
    "expires_at_utc",
    "issuer_agent_id",
    "issuer_label",
  ]);
  assert.equal(payload.command, "pause");
  assert.equal(payload.published_at_utc, "2026-08-22T12:00:00.000Z");
  assert.equal(payload.expires_at_utc, "2026-08-22T12:01:00.000Z");
});

test("accepts legacy ping responses and safely detects targeted-control capability", () => {
  const legacy = parsePingResponse(
    {
      schema_version: 1,
      ping_id: "ping-1",
      requester_agent_id: "frontend-test",
      responder_agent_id: "agent-old",
      responder_label: "WORK-PC/old",
      responded_at_utc: "2026-08-22T12:00:03Z",
    },
    { requesterAgentId: "frontend-test", pingId: "ping-1" },
  );
  assert.equal(legacy.agentState, "unknown");
  assert.equal(legacy.supportsTargetedControl, false);

  const upgraded = parsePingResponse(
    {
      schema_version: 1,
      ping_id: "ping-1",
      requester_agent_id: "frontend-test",
      responder_agent_id: "agent-new",
      responder_label: "HOME-PC/new",
      responded_at_utc: "2026-08-22T12:00:04Z",
      agent_state: "active",
      capabilities: [TARGETED_CONTROL_CAPABILITY],
    },
    { requesterAgentId: "frontend-test", pingId: "ping-1" },
  );
  assert.equal(upgraded.agentState, "active");
  assert.equal(upgraded.supportsTargetedControl, true);
  assert.equal(
    parsePingResponse(
      {
        schema_version: 1,
        ping_id: "different-ping",
        requester_agent_id: "frontend-test",
        responder_agent_id: "agent-new",
        responder_label: "HOME-PC/new",
        responded_at_utc: "2026-08-22T12:00:04Z",
      },
      { requesterAgentId: "frontend-test", pingId: "ping-1" },
    ),
    null,
  );
});

test("publishes ping, collects matching response files and ignores old pings", async () => {
  const uploads = [];
  const store = {
    async uploadJson(payload, fileName) {
      uploads.push({ payload, fileName });
      return { id: "control-item" };
    },
    async listMetadata({ prefix }) {
      assert.equal(prefix, pingResponsePrefix("frontend-test"));
      return [
        { id: "old-item", name: `${prefix}old.json`, eTag: "old" },
        { id: "new-item", name: `${prefix}new.json`, eTag: "new" },
      ];
    },
    async downloadJsonItem(itemId) {
      return {
        schema_version: 1,
        ping_id: itemId === "old-item" ? "older-ping" : "ping-1",
        requester_agent_id: "frontend-test",
        responder_agent_id: itemId === "old-item" ? "agent-old" : "agent-new",
        responder_label: itemId === "old-item" ? "OLD-PC/old" : "WORK-PC/new",
        responded_at_utc: "2026-08-22T12:00:03Z",
      };
    },
  };
  const controller = new FrontendAgentControl({
    store,
    agentId: "frontend-test",
    uuid: () => "ping-1",
    now: () => fixedNow,
  });

  const observed = [];
  const result = await controller.ping({
    durationMs: 0,
    onResponse: (response) => observed.push(response.agentId),
  });
  assert.equal(uploads[0].fileName, REMOTE_CONTROL_FILENAME);
  assert.equal(uploads[0].payload.command, "ping");
  assert.deepEqual(observed, ["agent-new"]);
  assert.equal(result.responses.length, 1);
});

test("uses a target-specific file and accepts only its matching acknowledgement", async () => {
  const uploads = [];
  const store = {
    async uploadJson(payload, fileName) {
      uploads.push({ payload, fileName });
      return { id: "target-control" };
    },
    async getMetadataFor(fileName) {
      assert.equal(fileName, targetAckFilename("frontend-test", "agent-2"));
      return { id: "ack-item", eTag: "ack-1" };
    },
    async downloadJsonItem() {
      return {
        schema_version: 1,
        command_id: "target-1",
        requester_agent_id: "frontend-test",
        responder_agent_id: "agent-2",
        responder_label: "HOME-PC/agent-2",
        command: "pause",
        applied_at_utc: "2026-08-22T12:00:02Z",
        agent_state: "paused",
      };
    },
  };
  const controller = new FrontendAgentControl({
    store,
    agentId: "frontend-test",
    uuid: () => "target-1",
    now: () => fixedNow,
  });

  const result = await controller.sendTargetCommand("agent-2", "pause", { timeoutMs: 0 });
  assert.equal(uploads[0].fileName, targetControlFilename("agent-2"));
  assert.equal(uploads[0].payload.target_agent_id, "agent-2");
  assert.equal(result.ack.agentState, "paused");
});
