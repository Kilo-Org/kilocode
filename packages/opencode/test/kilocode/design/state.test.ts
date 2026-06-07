import { describe, expect, test } from "bun:test"
import { initialState, reduce, type Action, type State } from "../../../src/kilocode/design/state"

function run(state: State, actions: Action[]): State {
  return actions.reduce((acc, action) => reduce(acc, action).state, state)
}

const turn = (text: string, turnId?: string): Action => ({
  type: "voice",
  event: { type: "turn", text, ...(turnId ? { turnId } : {}) },
})

describe("design reducer — turn handling", () => {
  test("dispatches immediately when idle and nothing active", () => {
    const result = reduce(initialState(), turn("make it blue"))
    expect(result.effects).toEqual([{ type: "dispatch", turn: result.state.active! }])
    expect(result.state.active?.text).toBe("make it blue")
    expect(result.state.active?.queued).toBe(false)
    expect(result.state.turns).toBe(1)
  })

  test("queues follow-ups while a turn is active", () => {
    const after = run(initialState(), [turn("first"), turn("second"), turn("third")])
    expect(after.active?.text).toBe("first")
    expect(after.queue.map((t) => t.text)).toEqual(["second", "third"])
    expect(after.queue.every((t) => t.queued)).toBe(true)
    expect(after.turns).toBe(3)
  })

  test("drains the queue in order on agent-close", () => {
    let state = run(initialState(), [turn("first"), turn("second"), turn("third")])
    state = reduce(state, { type: "agent-open" }).state

    const close = reduce(state, { type: "agent-close", reason: "completed" })
    expect(close.state.active?.text).toBe("second")
    expect(close.effects).toEqual([{ type: "dispatch", turn: close.state.active! }])
    expect(close.state.queue.map((t) => t.text)).toEqual(["third"])

    const close2 = reduce(close.state, { type: "agent-close", reason: "completed" })
    expect(close2.state.active?.text).toBe("third")

    const idle = reduce(close2.state, { type: "agent-close", reason: "completed" })
    expect(idle.state.active).toBeUndefined()
    expect(idle.state.agent).toBe("idle")
    expect(idle.effects).toEqual([])
  })

  test("uses provided turnId, else mints a padded sequential id", () => {
    const a = reduce(initialState(), turn("x")).state
    expect(a.active?.id).toBe("turn_001")
    const b = reduce(initialState(), turn("x", "custom")).state
    expect(b.active?.id).toBe("custom")
  })
})

describe("design reducer — Escape barge-in", () => {
  test("cancels active, clears queue, resets voice, stays listening", () => {
    let state = run(initialState({ voice: "listening" }), [turn("first"), turn("second"), turn("third")])
    state = reduce(state, { type: "agent-open" }).state

    const escaped = reduce(state, { type: "escape" })
    expect(escaped.effects).toEqual([{ type: "cancel" }, { type: "reset-voice" }])
    expect(escaped.state.active).toBeUndefined()
    expect(escaped.state.queue).toEqual([])
    expect(escaped.state.agent).toBe("idle")
    expect(escaped.state.voice).toBe("listening")
  })

  test("after Escape the next turn dispatches immediately again", () => {
    let state = run(initialState(), [turn("first"), turn("second")])
    state = reduce(state, { type: "escape" }).state
    const next = reduce(state, turn("fresh"))
    expect(next.effects).toEqual([{ type: "dispatch", turn: next.state.active! }])
    expect(next.state.active?.text).toBe("fresh")
  })
})

describe("design reducer — errors and latency", () => {
  test("error action surfaces a message without effects", () => {
    const result = reduce(initialState(), { type: "error", message: "Model not found: x/y" })
    expect(result.effects).toEqual([])
    expect(result.state.error).toBe("Model not found: x/y")
  })

  test("agent-close records the real turn latency", () => {
    let state = reduce(initialState(), turn("first")).state
    state = reduce(state, { type: "agent-open" }).state
    state = reduce(state, { type: "agent-close", reason: "completed", latencyMs: 1234 }).state
    expect(state.lastLatencyMs).toBe(1234)
  })
})

describe("design reducer — voice surface state", () => {
  test("tracks partial, level, and voice state without effects", () => {
    let state = initialState()
    state = reduce(state, { type: "voice", event: { type: "state", value: "processing" } }).state
    state = reduce(state, { type: "voice", event: { type: "partial", text: "make the" } }).state
    state = reduce(state, { type: "voice", event: { type: "level", peak: 0.4 } }).state
    expect(state.voice).toBe("processing")
    expect(state.partial).toBe("make the")
    expect(state.level).toBe(0.4)
  })

  test("clears partial when a turn finalizes", () => {
    let state = reduce(initialState(), { type: "voice", event: { type: "partial", text: "make the cards" } }).state
    state = reduce(state, turn("make the cards three columns")).state
    expect(state.partial).toBe("")
    expect(state.transcript.at(-1)?.text).toBe("make the cards three columns")
  })
})
