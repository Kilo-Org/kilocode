import { describe, expect, test } from "bun:test"
import { meter, render } from "../../../src/kilocode/design/surface/view"
import { initialState, reduce, type State } from "../../../src/kilocode/design/state"

function withTurns(...texts: string[]): State {
  return texts.reduce(
    (acc: State, text) => reduce(acc, { type: "voice", event: { type: "turn", text } }).state,
    initialState({ voice: "listening" }),
  )
}

describe("meter", () => {
  test("renders proportional fill", () => {
    expect(meter(0, 4)).toBe("[....]")
    expect(meter(1, 4)).toBe("[####]")
    expect(meter(0.5, 4)).toBe("[##..]")
  })
})

describe("view render", () => {
  test("shows the listening prompt when there is nothing yet", () => {
    const lines = render({ state: initialState({ voice: "listening" }), input: "voice" })
    expect(lines[0]).toContain("voice: listening")
    expect(lines.join("\n")).toContain("I'm listening")
  })

  test("foregrounds the rolling transcript of recent turns", () => {
    const lines = render({ state: withTurns("make it blue", "bigger title"), input: "voice" })
    const text = lines.join("\n")
    expect(text).toContain("make it blue")
    expect(text).toContain("bigger title")
  })

  test("shows the typed draft in fake mode", () => {
    const lines = render({ state: initialState({ voice: "listening" }), input: "fake", draft: "make the cards" })
    expect(lines.join("\n")).toContain("make the cards")
  })

  test("status line reflects queue depth and turn count", () => {
    let state = withTurns("first", "second", "third")
    state = reduce(state, { type: "agent-open" }).state
    const text = render({ state, input: "voice" }).join("\n")
    expect(text).toContain("turns: 3")
    expect(text).toContain("queued: 2")
    expect(text).toContain("agent: working")
  })

  test("hint differs between voice and fake input", () => {
    expect(render({ state: initialState(), input: "voice" }).at(-1)).toContain("keep talking")
    expect(render({ state: initialState(), input: "fake" }).at(-1)).toContain("Enter")
  })
})
