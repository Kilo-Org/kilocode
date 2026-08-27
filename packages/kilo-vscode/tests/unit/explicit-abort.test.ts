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
    expect(new ExplicitAbortState().event(close("interrupted"))).toBe(true)
  })

  it("suppresses an abort without requiring an earlier busy event", () => {
    const state = new ExplicitAbortState()
    const id = state.begin("session", "/repo")

    expect(state.event(close("interrupted"), "/repo")).toBe(false)
    expect(state.finish("session", "/repo", id, true)).toEqual([])
    expect(state.event(close("interrupted"), "/repo")).toBe(true)
  })

  it("suppresses a close that arrives after abort success only once", () => {
    const state = new ExplicitAbortState()
    const id = state.begin("session", "/repo")
    state.finish("session", "/repo", id, true)

    expect(state.event(close("interrupted"), "/repo")).toBe(false)
    expect(state.event(close("interrupted"), "/repo")).toBe(true)
  })

  it("replays an interrupted close when the abort fails", () => {
    const state = new ExplicitAbortState()
    const id = state.begin("session", "/repo")
    const event = close("interrupted")
    state.event(event, "/repo")

    expect(state.finish("session", "/repo", id, false)).toEqual([{ event, directory: "/repo" }])
  })

  it("never suppresses a completed close", () => {
    const state = new ExplicitAbortState()
    state.begin("session", "/repo")

    expect(state.event(close("completed"), "/repo")).toBe(true)
  })

  it("waits for concurrent abort attempts before replaying", () => {
    const state = new ExplicitAbortState()
    const first = state.begin("session", "/repo")
    const second = state.begin("session", "/repo")
    state.event(close("interrupted"), "/repo")

    expect(state.finish("session", "/repo", first, false)).toEqual([])
    expect(state.finish("session", "/repo", second, true)).toEqual([])
  })

  it("clears a pending abort when a new turn opens", () => {
    const state = new ExplicitAbortState()
    const id = state.begin("session", "/repo")
    state.event(open(), "/repo")

    expect(state.event(close("interrupted"), "/repo")).toBe(true)
    expect(state.finish("session", "/repo", id, true)).toEqual([])
  })

  it("isolates identical session ids by directory", () => {
    const state = new ExplicitAbortState()
    const id = state.begin("session", "/repo/a")
    state.finish("session", "/repo/a", id, true)

    expect(state.event(close("interrupted"), "/repo/b")).toBe(true)
    expect(state.event(close("interrupted"), "/repo/a")).toBe(false)
  })

  it("clears suppression when an idle session becomes busy again", () => {
    const state = new ExplicitAbortState()
    const id = state.begin("session", "/repo")
    state.finish("session", "/repo", id, true)
    state.event(status("idle"), "/repo")
    state.event(status("busy"), "/repo")

    expect(state.event(close("interrupted"), "/repo")).toBe(true)
  })
})
