import { describe, expect, it } from "bun:test"
import { createDuplicateEventFilter, resolveEventSessionId } from "../../src/services/cli-backend/connection-utils"
import type { SSEPayload as Payload } from "../../src/services/cli-backend/sdk-sse-adapter"

const noLookup = (_: string) => undefined

const message = {
  id: "m1",
  sessionID: "s5",
  role: "user",
  time: { created: 0 },
  agent: "build",
  model: { providerID: "kilo", modelID: "test" },
} as const

const part = {
  id: "p1",
  sessionID: "s6",
  messageID: "m1",
  type: "text",
  text: "",
} as const

function sync(event: Extract<Payload, { type: "sync" }>): Payload {
  return event
}

describe("resolveEventSessionId", () => {
  it("returns the session ID from session.created.1", () => {
    const event = sync({
      type: "sync",
      name: "session.created.1",
      id: "e1",
      seq: 0,
      aggregateID: "sessionID",
      data: {
        sessionID: "s1",
        info: {
          id: "s1",
          slug: "session",
          projectID: "project",
          directory: "/workspace",
          title: "Session",
          version: "1",
          time: { created: 0, updated: 0 },
        },
      },
    })

    expect(resolveEventSessionId(event, noLookup)).toBe("s1")
  })

  it("returns the session ID from session.updated.1", () => {
    const event = sync({
      type: "sync",
      name: "session.updated.1",
      id: "e2",
      seq: 1,
      aggregateID: "sessionID",
      data: { sessionID: "s2", info: { title: "Updated" } },
    })

    expect(resolveEventSessionId(event, noLookup)).toBe("s2")
  })

  it("records message.updated.1 mappings", () => {
    const event = sync({
      type: "sync",
      name: "message.updated.1",
      id: "e3",
      seq: 2,
      aggregateID: "sessionID",
      data: { sessionID: "s5", info: message },
    })
    const recorded: Array<[string, string]> = []

    expect(resolveEventSessionId(event, noLookup, (mid, sid) => recorded.push([mid, sid]))).toBe("s5")
    expect(recorded).toEqual([["m1", "s5"]])
  })

  it("does not require a message mapping callback", () => {
    const event = sync({
      type: "sync",
      name: "message.updated.1",
      id: "e4",
      seq: 3,
      aggregateID: "sessionID",
      data: { sessionID: "s5", info: message },
    })

    expect(() => resolveEventSessionId(event, noLookup)).not.toThrow()
  })

  it("returns the envelope session ID from message.part.updated.1", () => {
    const event = sync({
      type: "sync",
      name: "message.part.updated.1",
      id: "e5",
      seq: 4,
      aggregateID: "sessionID",
      data: { sessionID: "s6", part, time: 0 },
    })

    expect(resolveEventSessionId(event, noLookup)).toBe("s6")
  })

  it("routes transient session events", () => {
    const event = {
      id: "e6",
      type: "session.status",
      properties: { sessionID: "s3", status: { type: "idle" } },
    } satisfies Payload

    expect(resolveEventSessionId(event, noLookup)).toBe("s3")
  })

  it("routes transient message deltas", () => {
    const event = {
      id: "e7",
      type: "message.part.delta",
      properties: { sessionID: "s4", messageID: "m2", partID: "p2", field: "text", delta: "x" },
    } satisfies Payload

    expect(resolveEventSessionId(event, noLookup)).toBe("s4")
  })

  it("routes session.network events", () => {
    const event = {
      id: "e8",
      type: "session.network.restored",
      properties: { sessionID: "s7" },
    } satisfies Payload

    expect(resolveEventSessionId(event, noLookup)).toBe("s7")
  })

  it("routes permission, question, and suggestion events", () => {
    const permission = {
      id: "e9",
      type: "permission.replied",
      properties: { sessionID: "s8", requestID: "p1", reply: "once" },
    } satisfies Payload
    const question = {
      id: "e10",
      type: "question.rejected",
      properties: { sessionID: "s9", requestID: "q1" },
    } satisfies Payload
    const suggestion = {
      id: "e11",
      type: "suggestion.dismissed",
      properties: { sessionID: "s10", requestID: "sg1" },
    } satisfies Payload

    expect(resolveEventSessionId(permission, noLookup)).toBe("s8")
    expect(resolveEventSessionId(question, noLookup)).toBe("s9")
    expect(resolveEventSessionId(suggestion, noLookup)).toBe("s10")
  })

  it("routes sandbox status events", () => {
    const event = {
      id: "e12",
      type: "sandbox.status.changed",
      properties: { sessionID: "s11", directory: "/repo", enabled: true, available: true, version: 1 },
    } satisfies Payload

    expect(resolveEventSessionId(event, noLookup)).toBe("s11")
  })

  it("returns undefined for global events", () => {
    const event = { id: "e12", type: "server.connected", properties: {} } satisfies Payload

    expect(resolveEventSessionId(event, noLookup)).toBeUndefined()
  })
})

describe("createDuplicateEventFilter", () => {
  it("drops a compatibility envelope only after its live event", () => {
    const filter = createDuplicateEventFilter()
    const live = {
      id: "e13",
      type: "message.part.updated",
      properties: { sessionID: "s6", part, delta: "x" },
    } satisfies Payload
    expect(filter(live)).toBe(false)
    expect(
      filter(
        sync({
          type: "sync",
          name: "message.part.updated.1",
          id: "e13",
          seq: 5,
          aggregateID: "s6",
          data: { sessionID: "s6", part, time: 0 },
        }),
      ),
    ).toBe(true)
  })

  it("keeps replay-only compatibility envelopes", () => {
    const filter = createDuplicateEventFilter()
    expect(
      filter(
        sync({
          type: "sync",
          name: "session.next.model.switched.1",
          id: "e14",
          seq: 6,
          aggregateID: "s6",
          data: { sessionID: "s6", messageID: "m1", model: { id: "test", providerID: "kilo" } },
        }),
      ),
    ).toBe(false)
  })

  it("keeps session updates because the provider consumes their sync metadata", () => {
    const filter = createDuplicateEventFilter()
    const live = {
      id: "e15",
      type: "session.updated",
      properties: { sessionID: "s6", info: { id: "s6", time: { created: 0, updated: 1 } } },
    } as Payload
    expect(filter(live)).toBe(false)
    expect(
      filter(
        sync({
          type: "sync",
          name: "session.updated.1",
          id: "e15",
          seq: 7,
          aggregateID: "s6",
          data: { sessionID: "s6", info: { id: "s6", time: { created: 0, updated: 1 } } },
        }),
      ),
    ).toBe(false)
  })

  it("continues tracking new live events after the cap is reached", () => {
    const filter = createDuplicateEventFilter()
    for (let index = 0; index < 1024; index++) {
      expect(
        filter({
          id: `live-${index}`,
          type: "message.part.updated",
          properties: { sessionID: "s6", part, delta: "x" },
        }),
      ).toBe(false)
    }

    expect(
      filter({
        id: "live-1024",
        type: "message.part.updated",
        properties: { sessionID: "s6", part, delta: "x" },
      }),
    ).toBe(false)
    expect(
      filter(
        sync({
          type: "sync",
          name: "message.part.updated.1",
          id: "live-1024",
          seq: 9,
          aggregateID: "s6",
          data: { sessionID: "s6", part, time: 0 },
        }),
      ),
    ).toBe(true)
    expect(
      filter(
        sync({
          type: "sync",
          name: "message.part.updated.1",
          id: "live-0",
          seq: 8,
          aggregateID: "s6",
          data: { sessionID: "s6", part, time: 0 },
        }),
      ),
    ).toBe(false)
    expect(
      filter(
        sync({
          type: "sync",
          name: "message.part.updated.1",
          id: "live-1024",
          seq: 9,
          aggregateID: "s6",
          data: { sessionID: "s6", part, time: 0 },
        }),
      ),
    ).toBe(false)
  })

  it("forwards delayed envelopes for evicted IDs", () => {
    const filter = createDuplicateEventFilter()
    for (let index = 0; index < 1024; index++) {
      expect(
        filter({
          id: `pending-${index}`,
          type: "message.part.updated",
          properties: { sessionID: "s6", part, delta: "x" },
        }),
      ).toBe(false)
    }

    expect(
      filter({
        id: "overflow",
        type: "message.part.updated",
        properties: { sessionID: "s6", part, delta: "x" },
      }),
    ).toBe(false)
    expect(
      filter(
        sync({
          type: "sync",
          name: "message.part.updated.1",
          id: "pending-0",
          seq: 8,
          aggregateID: "s6",
          data: { sessionID: "s6", part, time: 0 },
        }),
      ),
    ).toBe(false)
    expect(
      filter(
        sync({
          type: "sync",
          name: "message.part.updated.1",
          id: "pending-1023",
          seq: 9,
          aggregateID: "s6",
          data: { sessionID: "s6", part, time: 0 },
        }),
      ),
    ).toBe(true)
  })

  it("does not carry duplicate IDs between connections", () => {
    const first = createDuplicateEventFilter()
    const second = createDuplicateEventFilter()
    const live = {
      id: "connection-event",
      type: "message.part.updated",
      properties: { sessionID: "s6", part, delta: "x" },
    } satisfies Payload

    expect(first(live)).toBe(false)
    expect(
      second(
        sync({
          type: "sync",
          name: "message.part.updated.1",
          id: "connection-event",
          seq: 11,
          aggregateID: "s6",
          data: { sessionID: "s6", part, time: 0 },
        }),
      ),
    ).toBe(false)
  })
})
