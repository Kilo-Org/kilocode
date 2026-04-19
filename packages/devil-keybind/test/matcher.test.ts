import { describe, test, expect } from "bun:test"
import { searchCommands } from "../src/matcher"
import type { Command } from "../src/schemas"

function makeCmd(id: string, overrides: Partial<Command> = {}): Command {
  return {
    id,
    title: id,
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    ...overrides,
  }
}

describe("searchCommands", () => {
  test("empty query returns all non-hidden commands in registration order", () => {
    const commands: Command[] = [
      makeCmd("alpha"),
      makeCmd("beta"),
      makeCmd("gamma"),
      makeCmd("hidden-one", { hidden: true }),
    ]

    const result = searchCommands("", commands)
    expect(result.length).toBe(3)
    expect(result.map((c) => c.id)).toEqual(["alpha", "beta", "gamma"])
  })

  test("empty query with all hidden commands returns empty array", () => {
    const commands: Command[] = [makeCmd("a", { hidden: true }), makeCmd("b", { hidden: true })]
    const result = searchCommands("", commands)
    expect(result).toHaveLength(0)
  })

  test("query matches title and ranks best match first", () => {
    const commands: Command[] = [
      makeCmd("review-cmd", { title: "Review Changes" }),
      makeCmd("plan-cmd", { title: "Plan Phase" }),
      makeCmd("nav-cmd", { title: "Navigate Files" }),
    ]

    const result = searchCommands("pla", commands)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].id).toBe("plan-cmd")
  })

  test("aliases contribute to fuzzy score", () => {
    const commands: Command[] = [
      makeCmd("start-cmd", { title: "Start Agent", aliases: ["go", "begin"] }),
      makeCmd("stop-cmd", { title: "Stop Agent", aliases: ["halt", "pause"] }),
    ]

    const result = searchCommands("go", commands)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].id).toBe("start-cmd")
  })

  test("hideKeywords contribute to score but are not the title", () => {
    const commands: Command[] = [
      makeCmd("reset-cmd", { title: "Tabula Rasa", hideKeywords: ["reset", "wipe", "clear"] }),
      makeCmd("unrelated", { title: "Unrelated Command" }),
    ]

    const result = searchCommands("wipe", commands)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].id).toBe("reset-cmd")
    // The title is still "Tabula Rasa", not "wipe"
    expect(result[0].title).toBe("Tabula Rasa")
  })

  test("hidden commands are excluded from all results", () => {
    const commands: Command[] = [
      makeCmd("visible-cmd", { title: "Xylophone" }),
      makeCmd("hidden-cmd", { title: "Xylophone Hidden", hidden: true }),
    ]

    const result = searchCommands("xyl", commands)
    expect(result.every((c) => !c.hidden)).toBe(true)
    expect(result.some((c) => c.id === "hidden-cmd")).toBe(false)
  })

  test("nonsense query returns empty array (below-threshold filtering)", () => {
    const commands: Command[] = [makeCmd("alpha", { title: "Alpha" }), makeCmd("beta", { title: "Beta" })]

    const result = searchCommands("zzzqqq", commands)
    expect(result).toHaveLength(0)
  })

  test("query with both alias and title match — alias match included", () => {
    const commands: Command[] = [makeCmd("cmd-with-alias", { title: "Open Editor", aliases: ["launch", "edit"] })]

    const byAlias = searchCommands("launch", commands)
    expect(byAlias.length).toBeGreaterThan(0)
    expect(byAlias[0].id).toBe("cmd-with-alias")
  })
})
