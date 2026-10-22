import { describe, test, expect } from "bun:test"
import type {
  CompactionCaptured,
  ExportEvent,
  ExportEnvelope,
  LlmRequestCompleted,
  LlmRequestStarted,
  SessionDegraded,
} from "@/kilocode/session-export/events"
import type { BatchEnvelope } from "@/kilocode/session-export/envelope"

describe("event types", () => {
  test("envelope shape is well-formed", () => {
    const env: ExportEnvelope = {
      id: "01HABC",
      schemaVersion: 1,
      type: "llm_request_started",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: Date.now(),
      agentVersion: "v0",
    }
    expect(env.schemaVersion).toBe(1)
  })

  test("LlmRequestStarted extends envelope", () => {
    const ev: LlmRequestStarted = {
      id: "01HABC",
      schemaVersion: 1,
      type: "llm_request_started",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: 0,
      agentVersion: "v0",
      requestId: "r1",
      userMessageId: "u1",
      agent: "claude",
      modeId: "build",
      model: { providerId: "kilo", modelId: "free-1", isFree: true },
      input: {
        system: ["You are..."],
        messages: [],
        tools: {},
        permissions: [],
        params: {},
      },
      time: { created: 0 },
    }
    expect(ev.type).toBe("llm_request_started")
  })

  test("SessionDegraded has a fixed reason", () => {
    const ev: SessionDegraded = {
      id: "01HABC",
      schemaVersion: 1,
      type: "session_degraded",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: 0,
      agentVersion: "v0",
      reason: "ring_buffer_overflow",
    }
    expect(ev.reason).toBe("ring_buffer_overflow")
  })

  test("ExportEvent is a discriminated union", () => {
    function widen(e: ExportEvent): string {
      switch (e.type) {
        case "llm_request_started":
          return e.userMessageId
        case "llm_request_completed":
          return String(e.durationMs)
        case "workspace_baseline_started":
          return String(e.requestedAt)
        case "workspace_baseline_completed":
          return e.consistency
        case "workspace_delta_captured":
          return e.trigger
        case "tool_executed":
          return e.toolName
        case "terminal_outcome":
          return String(e.exitCode)
        case "permission_decided":
          return e.decision
        case "compaction_captured":
          return e.output.assistantMessageId
        case "feedback_captured":
          return e.rating
        case "scrub_report":
          return String(e.client_scrubbed)
        case "session_degraded":
          return e.reason
      }
    }
    expect(typeof widen).toBe("function")
  })

  test("BatchEnvelope events expose uploaded envelope fields", () => {
    const batch: BatchEnvelope = {
      schemaVersion: 1,
      agentVersion: "v0",
      surface: "test",
      batchId: "b1",
      events: [
        {
          id: "01HABC",
          type: "llm_request_started",
          sessionId: "s1",
          rootSessionId: "s1",
          seq: 1,
          ts: 100,
          requestId: "r1",
        },
      ],
      chunks: [],
    }

    expect(batch.events[0].sessionId).toBe("s1")
    expect(batch.events[0].requestId).toBe("r1")
  })

  test("captured model payloads expose existing source types", () => {
    function completed(ev: LlmRequestCompleted) {
      return ev.output.toolCalls?.[0]?.type
    }
    function compacted(ev: CompactionCaptured) {
      return [ev.input.inputMessagesSnapshot[0]?.role, ev.input.selectedContext[0]?.info.sessionID]
    }

    expect(typeof completed).toBe("function")
    expect(typeof compacted).toBe("function")
  })
})
