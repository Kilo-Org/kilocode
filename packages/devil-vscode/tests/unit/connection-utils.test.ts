import { describe, it, expect } from "bun:test"
import { resolveEventSessionId } from "../../src/services/cli-backend/connection-utils"
import type { Event } from "@kilocode/sdk/v2/client"

const noLookup = (_: string) => undefined

/** Helper to create a partial Event for testing — only the fields accessed by resolveEventSessionId matter. */
function event(partial: Record<string, unknown>): Event {
  return partial as unknown as Event
}

describe("resolveEventSessionId", () => {
  it("returns session id from session.created", () => {
    const e = event({
      type: "session.created",
      properties: {
        info: { id: "s1", title: "", directory: "", time: { created: 0, updated: 0 } },
      },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s1")
  })

  it("returns session id from session.updated", () => {
    const e = event({
      type: "session.updated",
      properties: {
        info: { id: "s2", title: "", directory: "", time: { created: 0, updated: 0 } },
      },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s2")
  })

  it("returns sessionID from session.status", () => {
    const e = event({
      type: "session.status",
      properties: { sessionID: "s3", status: { type: "idle" } },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s3")
  })

  it("returns sessionID from todo.updated", () => {
    const e = event({
      type: "todo.updated",
      properties: { sessionID: "s4", todos: [] },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s4")
  })

  it("returns sessionID from message.updated and calls onMessageUpdated", () => {
    const e = event({
      type: "message.updated",
      properties: {
        info: { id: "m1", sessionID: "s5", role: "assistant", time: { created: 0 } },
      },
    })
    const recorded: [string, string][] = []
    const result = resolveEventSessionId(e, noLookup, (mid, sid) => recorded.push([mid, sid]))
    expect(result).toBe("s5")
    expect(recorded).toEqual([["m1", "s5"]])
  })

  it("message.updated does not require onMessageUpdated callback", () => {
    const e = event({
      type: "message.updated",
      properties: {
        info: { id: "m1", sessionID: "s5", role: "assistant", time: { created: 0 } },
      },
    })
    expect(() => resolveEventSessionId(e, noLookup)).not.toThrow()
  })

  it("returns sessionID directly from message.part.updated when part has sessionID", () => {
    const e = event({
      type: "message.part.updated",
      properties: {
        part: { type: "text", id: "p1", text: "", sessionID: "s6", messageID: "m1" },
      },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s6")
  })

  it("falls back to lookup when message.part.updated has no sessionID but has messageID", () => {
    const e = event({
      type: "message.part.updated",
      properties: {
        part: { type: "text", id: "p1", text: "", messageID: "m2" },
      },
    })
    const lookup = (id: string) => (id === "m2" ? "s7" : undefined)
    expect(resolveEventSessionId(e, lookup)).toBe("s7")
  })

  it("returns undefined for message.part.updated with no sessionID and messageID not in map", () => {
    const e = event({
      type: "message.part.updated",
      properties: {
        part: { type: "text", id: "p1", text: "", messageID: "unknown" },
      },
    })
    expect(resolveEventSessionId(e, noLookup)).toBeUndefined()
  })

  it("returns undefined for message.part.updated with no messageID and no sessionID", () => {
    const e = event({
      type: "message.part.updated",
      properties: {
        part: { type: "text", id: "p1", text: "" },
      },
    })
    expect(resolveEventSessionId(e, noLookup)).toBeUndefined()
  })

  it("returns sessionID from permission.asked", () => {
    const e = event({
      type: "permission.asked",
      properties: {
        id: "p1",
        sessionID: "s8",
        permission: "read_file",
        patterns: [],
        metadata: {},
        always: [],
      },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s8")
  })

  it("returns sessionID from question.asked", () => {
    const e = event({
      type: "question.asked",
      properties: { id: "q1", sessionID: "s9", questions: [] },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s9")
  })

  it("returns sessionID from question.replied", () => {
    const e = event({
      type: "question.replied",
      properties: { sessionID: "s10", requestID: "r1", answers: [] },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s10")
  })

  it("returns sessionID from question.rejected", () => {
    const e = event({
      type: "question.rejected",
      properties: { sessionID: "s11", requestID: "r2" },
    })
    expect(resolveEventSessionId(e, noLookup)).toBe("s11")
  })

  it("returns undefined for unknown event types (global events)", () => {
    const e = event({ type: "server.connected", properties: {} })
    expect(resolveEventSessionId(e, noLookup)).toBeUndefined()
  })

  it("returns undefined for another unknown event type", () => {
    const e = event({ type: "server.heartbeat", properties: {} })
    expect(resolveEventSessionId(e, noLookup)).toBeUndefined()
  })
})
