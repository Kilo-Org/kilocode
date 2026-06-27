import { describe, it, expect } from "bun:test"
import { sortByScore } from "../../webview-ui/src/hooks/useSlashCommand"

describe("sortByScore", () => {
  it("prefers exact matches over prefix matches", () => {
    const commands = [
      { name: "commit-all", description: "", hints: [] },
      { name: "commit", description: "", hints: [] },
    ]
    const result = sortByScore(commands, "commit")
    expect(result.map((c) => c.name)).toEqual(["commit", "commit-all"])
  })

  it("prefers prefix matches over substring matches", () => {
    const commands = [
      { name: "compact", description: "", hints: [] },
      { name: "commit", description: "", hints: [] },
      { name: "telecompact", description: "", hints: [] },
      { name: "mycommittool", description: "", hints: [] },
    ]
    const result = sortByScore(commands, "co")
    const names = result.map((c) => c.name)
    expect(names.indexOf("compact")).toBeLessThan(names.indexOf("telecompact"))
    expect(names.indexOf("commit")).toBeLessThan(names.indexOf("mycommittool"))
  })

  it("matches descriptions", () => {
    const commands = [
      { name: "other", description: "", hints: [] },
      { name: "help", description: "Open documentation", hints: [] },
    ]
    const result = sortByScore(commands, "documentation")
    expect(result[0]?.name).toBe("help")
  })

  it("matches hints", () => {
    const commands = [
      { name: "other", description: "", hints: [] },
      { name: "compact", description: "", hints: ["smol"] },
    ]
    const result = sortByScore(commands, "smol")
    expect(result[0]?.name).toBe("compact")
  })

  it("is case insensitive", () => {
    const commands = [{ name: "compact", description: "", hints: [] }]
    const result = sortByScore(commands, "COMPACT")
    expect(result[0]?.name).toBe("compact")
  })
})
