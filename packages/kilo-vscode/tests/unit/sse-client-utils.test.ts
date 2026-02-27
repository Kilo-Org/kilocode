import { describe, it, expect } from "bun:test"
import { unwrapSSEPayload, isEventFromForeignProject } from "../../src/services/cli-backend/sse-utils"
import type { SSEEvent } from "../../src/services/cli-backend/types"

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

describe("isEventFromForeignProject", () => {
  const session = (projectID: string) =>
    ({
      id: "s1",
      projectID,
      title: "test",
      directory: "/workspace",
      time: { created: 0, updated: 0 },
    }) as const

  it("drops session.created from a different project", () => {
    const event: SSEEvent = { type: "session.created", properties: { info: session("project-B") } }
    expect(isEventFromForeignProject(event, "project-A")).toBe(true)
  })

  it("drops session.updated from a different project", () => {
    const event: SSEEvent = { type: "session.updated", properties: { info: session("project-B") } }
    expect(isEventFromForeignProject(event, "project-A")).toBe(true)
  })

  it("accepts session.created from the same project", () => {
    const event: SSEEvent = { type: "session.created", properties: { info: session("project-A") } }
    expect(isEventFromForeignProject(event, "project-A")).toBe(false)
  })

  it("accepts session.updated from the same project", () => {
    const event: SSEEvent = { type: "session.updated", properties: { info: session("project-A") } }
    expect(isEventFromForeignProject(event, "project-A")).toBe(false)
  })

  it("accepts all events when expectedProjectID is undefined (not yet resolved)", () => {
    const event: SSEEvent = { type: "session.created", properties: { info: session("project-B") } }
    expect(isEventFromForeignProject(event, undefined)).toBe(false)
  })

  it("does not filter non-session events regardless of project", () => {
    const heartbeat: SSEEvent = { type: "server.heartbeat", properties: {} as Record<string, never> }
    const connected: SSEEvent = { type: "server.connected", properties: {} as Record<string, never> }
    expect(isEventFromForeignProject(heartbeat, "project-A")).toBe(false)
    expect(isEventFromForeignProject(connected, "project-A")).toBe(false)
  })

  it("does not filter message events (they have no projectID)", () => {
    const event: SSEEvent = {
      type: "message.part.delta",
      properties: { sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "hello" },
    }
    expect(isEventFromForeignProject(event, "project-A")).toBe(false)
  })
})
