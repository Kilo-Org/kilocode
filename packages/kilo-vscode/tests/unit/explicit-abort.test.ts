import { describe, expect, it } from "bun:test"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import { ExplicitAbortState } from "../../src/services/cli-backend/explicit-abort"

const open = (sessionID = "session") =>
  ({ id: "event-open", type: "session.turn.open", properties: { sessionID } }) as SSEPayload

const status = (type: "idle" | "busy", sessionID = "session") =>
  ({ type: "session.status", properties: { sessionID, status: { type } } }) as SSEPayload

const close = (reason: "completed" | "interrupted", sessionID = "session") =>
  ({ id: `event-${reason}`, type: "session.turn.close", properties: { sessionID, reason } }) as SSEPayload

describe("explicit abort state", () => {
  it("does not suppress an unexpected interruption", () => {
    const state = new ExplicitAbortState()

    expect(state.event(close("interrupted"))).toBe(true)
  })

  it("drops an interrupted close after an explicit abort succeeds", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo")
    const id = state.begin("session", "/repo")

    expect(state.event(close("interrupted"), "/repo")).toBe(false)
    expect(state.finish("session", "/repo", id, true)).toEqual([])
  })

  it("drops an interrupted close that arrives after abort success", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo")
    const id = state.begin("session", "/repo")
    state.finish("session", "/repo", id, true)

    expect(state.event(close("interrupted"), "/repo")).toBe(false)
  })

  it("replays an interrupted close when the abort fails", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo")
    const id = state.begin("session", "/repo")
    const event = close("interrupted")
    state.event(event, "/repo")

    expect(state.finish("session", "/repo", id, false)).toEqual([{ event, directory: "/repo" }])
  })

  it("never suppresses a completed close", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo")
    state.begin("session", "/repo")

    expect(state.event(close("completed"))).toBe(true)
  })

  it("waits for concurrent abort attempts before replaying", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo")
    const first = state.begin("session", "/repo")
    const second = state.begin("session", "/repo")
    state.event(close("interrupted"), "/repo")

    expect(state.finish("session", "/repo", first, false)).toEqual([])
    expect(state.finish("session", "/repo", second, true)).toEqual([])
  })

  it("allows a later real interruption in the same session", () => {
    const state = new ExplicitAbortState()
    state.event(open(), "/repo")
    state.event(status("busy"), "/repo")
    const id = state.begin("session", "/repo")
    state.finish("session", "/repo", id, true)
    expect(state.event(close("interrupted"), "/repo")).toBe(false)
    state.event(status("idle"), "/repo")
    state.event(open(), "/repo")
    state.event(status("busy"), "/repo")

    expect(state.event(close("interrupted"), "/repo")).toBe(true)
  })

  it("clears a pending abort when a new turn opens", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo")
    const id = state.begin("session", "/repo")
    state.event(open(), "/repo")

    expect(state.event(close("interrupted"), "/repo")).toBe(true)
    expect(state.finish("session", "/repo", id, true)).toEqual([])
  })

  it("isolates identical session ids by directory", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo/a")
    const id = state.begin("session", "/repo/a")
    state.finish("session", "/repo/a", id, true)

    expect(state.event(close("interrupted"), "/repo/b")).toBe(true)
    expect(state.event(close("interrupted"), "/repo/a")).toBe(false)
  })

  it("does not mark an already idle session", () => {
    const state = new ExplicitAbortState()
    state.event(status("idle"), "/repo")

    expect(state.begin("session", "/repo")).toBeUndefined()
    expect(state.event(close("interrupted"), "/repo")).toBe(true)
  })

  it("clears suppression on a later busy status without turn-open", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo")
    const id = state.begin("session", "/repo")
    state.finish("session", "/repo", id, true)
    state.event(status("idle"), "/repo")
    state.event(status("busy"), "/repo")

    expect(state.event(close("interrupted"), "/repo")).toBe(true)
  })

  it("does not carry a pending abort into a new busy turn", () => {
    const state = new ExplicitAbortState()
    state.event(status("busy"), "/repo")
    const id = state.begin("session", "/repo")
    state.event(status("idle"), "/repo")
    state.event(status("busy"), "/repo")
    state.finish("session", "/repo", id, true)

    expect(state.event(close("interrupted"), "/repo")).toBe(true)
  })
})
