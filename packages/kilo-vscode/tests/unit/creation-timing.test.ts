import { describe, expect, it } from "bun:test"
import { Timing } from "../../src/agent-manager/creation-timing"

function ticking(values: number[]): () => number {
  let index = 0
  return () => values[index++]!
}

describe("creation timing", () => {
  it("records one lap per mark and logs a single structured line", () => {
    const lines: unknown[][] = []
    const timing = Timing.start("create demo", (...args) => lines.push(args), ticking([0, 10, 20, 30]))

    timing.mark("context")
    timing.mark("preflight")
    const span = timing.end()

    expect(span.phases).toEqual({ context: 10, preflight: 10 })
    expect(span.total).toBe(30)
    expect(span.line).toBe("[agent-manager] create demo total=30ms context=10 preflight=10")
    expect(lines).toEqual([["[agent-manager] create demo total=30ms context=10 preflight=10"]])
  })

  it("attributes an explicit start reading to its phase", () => {
    const timing = Timing.start("create demo", undefined, ticking([0, 5, 50, 60]))

    timing.mark("setup")
    timing.mark("boot", 1)
    const span = timing.result()

    expect(span.phases).toEqual({ setup: 5, boot: 49 })
    expect(span.line).toBe("[agent-manager] create demo total=60ms setup=5 boot=49")
  })
})
