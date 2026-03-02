import { describe, expect, it } from "bun:test"
import { filterSlashCommands, parseSlashQuery } from "../../webview-ui/src/components/chat/slash-command-utils"

describe("parseSlashQuery", () => {
  it("matches bare slash", () => {
    expect(parseSlashQuery("/")).toBe("")
  })

  it("matches slash command token", () => {
    expect(parseSlashQuery("/review")).toBe("review")
  })

  it("does not match when command has spaces", () => {
    expect(parseSlashQuery("/review changes")).toBeUndefined()
  })

  it("does not match non-slash text", () => {
    expect(parseSlashQuery("review")).toBeUndefined()
  })
})

describe("filterSlashCommands", () => {
  const commands = [
    { name: "review", description: "Run review", source: "command" as const },
    { name: "local-review", description: "Review local changes", source: "command" as const },
    { name: "agent", description: "Pick agent", source: "skill" as const },
    { name: "review", description: "Duplicate should be removed", source: "command" as const },
  ]

  it("deduplicates by name", () => {
    expect(filterSlashCommands(commands, null).map((x) => x.name)).toEqual(["agent", "local-review", "review"])
  })

  it("filters by name", () => {
    expect(filterSlashCommands(commands, "local").map((x) => x.name)).toEqual(["local-review"])
  })

  it("filters by description", () => {
    expect(filterSlashCommands(commands, "pick").map((x) => x.name)).toEqual(["agent"])
  })
})
