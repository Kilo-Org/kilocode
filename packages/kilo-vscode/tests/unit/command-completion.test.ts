import { describe, expect, it } from "bun:test"
import { completesWithoutStatus, goalControl } from "../../src/kilo-provider/command-completion"

describe("goalControl", () => {
  it.each(["", " \n", "pause", " pause ", "clear"])("accepts model-free goal %j", (args) => {
    expect(goalControl("goal", args)).toBe(true)
  })

  it.each([
    ["goal", "resume"],
    ["goal", "Fix failing tests"],
    ["goal", "status"],
    ["goal", "pause after tests"],
    ["review", "pause"],
    ["Goal", ""],
  ])("keeps /%s %s on the normal command path", (command, args) => {
    expect(goalControl(command, args)).toBe(false)
  })
})

describe("completesWithoutStatus", () => {
  it("matches goal and deprecated static review aliases", () => {
    expect(completesWithoutStatus("goal")).toBe(true)
    expect(completesWithoutStatus("goals")).toBe(false)
    expect(completesWithoutStatus("local-review")).toBe(true)
    expect(completesWithoutStatus("local-review-uncommitted")).toBe(true)
    expect(completesWithoutStatus("review")).toBe(false)
    expect(completesWithoutStatus("init")).toBe(false)
  })
})
