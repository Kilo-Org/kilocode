import { describe, expect, test } from "bun:test"
import { parseMessage } from "@/kilocode/session-export/worker/validate"

describe("session export worker validation", () => {
  test("rejects init messages without a database path", () => {
    expect(parseMessage({ kind: "init", dbPath: 42 })).toBeUndefined()
  })

  test("accepts init messages with custom endpoint opt-in", () => {
    expect(parseMessage({ kind: "init", dbPath: ":memory:", allowCustomEndpoint: true })).toEqual({
      kind: "init",
      dbPath: ":memory:",
      allowCustomEndpoint: true,
    })
  })

  test("rejects event messages without a valid envelope", () => {
    expect(parseMessage({ kind: "event", approxBytes: 10, envelope: { type: "nope" } })).toBeUndefined()
  })

  test("accepts valid event message envelopes", () => {
    const msg = parseMessage({
      kind: "event",
      approxBytes: 10,
      envelope: {
        id: "e1",
        schemaVersion: 1,
        type: "llm_request_started",
        sessionId: "s1",
        rootSessionId: "s1",
        seq: 0,
        ts: 1,
        agentVersion: "v0",
      },
    })
    expect(msg?.kind).toBe("event")
  })
})
