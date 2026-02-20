import { describe, it, expect } from "bun:test"
import { resolveEventSessionId } from "../../src/services/cli-backend/connection-utils"
import type { SSEEvent } from "../../src/services/cli-backend/types"

const noLookup = (_: string) => undefined

describe("resolveEventSessionId", () => {
  it("returns session id from session.created", () => {
    const event: SSEEvent = {
      type: "session.created",
      properties: {
        info: { id: "s1", title: "", directory: "", time: { created: 0, updated: 0 } },
      },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s1")
  })

  it("returns session id from session.updated", () => {
    const event: SSEEvent = {
      type: "session.updated",
      properties: {
        info: { id: "s2", title: "", directory: "", time: { created: 0, updated: 0 } },
      },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s2")
  })

  it("returns sessionID from session.status", () => {
    const event: SSEEvent = {
      type: "session.status",
      properties: { sessionID: "s3", status: { type: "idle" } },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s3")
  })

  it("returns sessionID from todo.updated", () => {
    const event: SSEEvent = {
      type: "todo.updated",
      properties: { sessionID: "s4", items: [] },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s4")
  })

  it("returns sessionID from message.updated and calls onMessageUpdated", () => {
    const event: SSEEvent = {
      type: "message.updated",
      properties: {
        info: { id: "m1", sessionID: "s5", role: "assistant", time: { created: 0 } },
      },
    }
    const recorded: [string, string][] = []
    const result = resolveEventSessionId(event, noLookup, (mid, sid) => recorded.push([mid, sid]))
    expect(result).toBe("s5")
    expect(recorded).toEqual([["m1", "s5"]])
  })

  it("message.updated does not require onMessageUpdated callback", () => {
    const event: SSEEvent = {
      type: "message.updated",
      properties: {
        info: { id: "m1", sessionID: "s5", role: "assistant", time: { created: 0 } },
      },
    }
    expect(() => resolveEventSessionId(event, noLookup)).not.toThrow()
  })

  it("returns sessionID directly from message.part.updated when part has sessionID", () => {
    const event: SSEEvent = {
      type: "message.part.updated",
      properties: {
        part: { type: "text", id: "p1", text: "", sessionID: "s6", messageID: "m1" },
      },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s6")
  })

  it("falls back to lookup when message.part.updated has no sessionID but has messageID", () => {
    const event: SSEEvent = {
      type: "message.part.updated",
      properties: {
        part: { type: "text", id: "p1", text: "", messageID: "m2" },
      },
    }
    const lookup = (id: string) => (id === "m2" ? "s7" : undefined)
    expect(resolveEventSessionId(event, lookup)).toBe("s7")
  })

  it("returns undefined for message.part.updated with no sessionID and messageID not in map", () => {
    const event: SSEEvent = {
      type: "message.part.updated",
      properties: {
        part: { type: "text", id: "p1", text: "", messageID: "unknown" },
      },
    }
    expect(resolveEventSessionId(event, noLookup)).toBeUndefined()
  })

  it("returns undefined for message.part.updated with no messageID and no sessionID", () => {
    const event: SSEEvent = {
      type: "message.part.updated",
      properties: {
        part: { type: "text", id: "p1", text: "" },
      },
    }
    expect(resolveEventSessionId(event, noLookup)).toBeUndefined()
  })

  it("returns sessionID from permission.asked", () => {
    const event: SSEEvent = {
      type: "permission.asked",
      properties: {
        id: "p1",
        sessionID: "s8",
        permission: "read_file",
        patterns: [],
        metadata: {},
        always: [],
      },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s8")
  })

  it("returns sessionID from question.asked", () => {
    const event: SSEEvent = {
      type: "question.asked",
      properties: { id: "q1", sessionID: "s9", questions: [] },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s9")
  })

  it("returns sessionID from question.replied", () => {
    const event: SSEEvent = {
      type: "question.replied",
      properties: { sessionID: "s10", requestID: "r1", answers: [] },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s10")
  })

  it("returns sessionID from question.rejected", () => {
    const event: SSEEvent = {
      type: "question.rejected",
      properties: { sessionID: "s11", requestID: "r2" },
    }
    expect(resolveEventSessionId(event, noLookup)).toBe("s11")
  })

  it("returns undefined for server.connected (global event)", () => {
    const event: SSEEvent = { type: "server.connected", properties: {} }
    expect(resolveEventSessionId(event, noLookup)).toBeUndefined()
  })

  it("returns undefined for server.heartbeat (global event)", () => {
    const event: SSEEvent = { type: "server.heartbeat", properties: {} }
    expect(resolveEventSessionId(event, noLookup)).toBeUndefined()
  })
})
