import { describe, expect, it } from "bun:test"
import { RequestGate } from "../../src/agent-manager/pr/request-gate"

describe("RequestGate", () => {
  it("shares an in-flight request for the same key", async () => {
    const gate = new RequestGate()
    let count = 0
    const run = async () => {
      count++
    }

    await Promise.all([gate.run("pr:one", run), gate.run("pr:one", run)])

    expect(count).toBe(1)
  })

  it("allows a new request after the previous one settles", async () => {
    const gate = new RequestGate()
    let count = 0

    await gate.run("pr:one", async () => {
      count++
    })
    await gate.run("pr:one", async () => {
      count++
    })

    expect(count).toBe(2)
  })

  it("keeps separate PRs independent", async () => {
    const gate = new RequestGate()
    const done = new Set<string>()

    await Promise.all([
      gate.run("pr:one", async () => done.add("one")),
      gate.run("pr:two", async () => done.add("two")),
    ])

    expect(done).toEqual(new Set(["one", "two"]))
  })
})
