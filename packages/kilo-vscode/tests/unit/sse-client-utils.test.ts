import { describe, it, expect } from "bun:test"
import { unwrapSSEPayload } from "../../src/services/cli-backend/sse-utils"

describe("unwrapSSEPayload", () => {
  it("unwraps global endpoint payload wrapper", () => {
    const raw = {
      directory: "/workspace",
      payload: { type: "session.created", properties: { info: {} } },
    }
    const event = unwrapSSEPayload(raw)
    expect(event?.type).toBe("session.created")
  })

  it("returns direct event when no payload wrapper", () => {
    const raw = { type: "server.connected", properties: {} }
    const event = unwrapSSEPayload(raw)
    expect(event?.type).toBe("server.connected")
  })

  it("returns null when no type field in direct event", () => {
    const raw = { properties: {} }
    expect(unwrapSSEPayload(raw)).toBeNull()
  })

  it("returns null when payload wrapper exists but has no type", () => {
    const raw = { directory: "/workspace", payload: { properties: {} } }
    expect(unwrapSSEPayload(raw)).toBeNull()
  })

  it("returns null for null input", () => {
    expect(unwrapSSEPayload(null)).toBeNull()
  })

  it("returns null for empty object", () => {
    expect(unwrapSSEPayload({})).toBeNull()
  })

  it("returns null for non-object input", () => {
    expect(unwrapSSEPayload("string")).toBeNull()
    expect(unwrapSSEPayload(42)).toBeNull()
  })

  it("uses payload over root when both have type", () => {
    const raw = {
      type: "root-type",
      payload: { type: "payload-type", properties: {} },
    }
    const event = unwrapSSEPayload(raw)
    expect(event?.type).toBe("payload-type")
  })

  it("handles nested event types correctly", () => {
    const raw = {
      payload: {
        type: "message.updated",
        properties: {
          info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 0 } },
        },
      },
    }
    const event = unwrapSSEPayload(raw)
    expect(event?.type).toBe("message.updated")
  })
})
