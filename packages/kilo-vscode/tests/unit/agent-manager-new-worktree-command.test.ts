import { describe, expect, it } from "bun:test"
import { parseWorktreeCommand, type WorktreeCommandEntry } from "../../webview-ui/agent-manager/new-worktree-command"

const commands: WorktreeCommandEntry[] = [
  { name: "models", hints: ["model"] },
  { name: "goal", source: "command", hints: ["<objective | pause | resume | clear>"] },
  { name: "ship", source: "command", hints: ["deploy"] },
  { name: "grill", source: "skill", hints: [] },
  { name: "foo:skill", source: "skill", hints: [] },
  { name: "notes", source: "mcp", hints: [] },
]

describe("parseWorktreeCommand", () => {
  it("parses an exact server command with its arguments", () => {
    expect(parseWorktreeCommand("/goal ship the release", commands)).toEqual({
      command: "goal",
      arguments: "ship the release",
    })
  })

  it("parses a bare command with no arguments", () => {
    expect(parseWorktreeCommand("/goal", commands)).toEqual({ command: "goal", arguments: "" })
  })

  it("matches a server command by hint or alias", () => {
    expect(parseWorktreeCommand("/deploy now", commands)).toEqual({ command: "ship", arguments: "now" })
  })

  it("parses skills and MCP prompts", () => {
    expect(parseWorktreeCommand("/grill this", commands)).toEqual({ command: "grill", arguments: "this" })
    expect(parseWorktreeCommand("/foo:skill x", commands)).toEqual({ command: "foo:skill", arguments: "x" })
    expect(parseWorktreeCommand("/notes", commands)).toEqual({ command: "notes", arguments: "" })
  })

  it("ignores client actions so their text stays a plain prompt", () => {
    expect(parseWorktreeCommand("/models", commands)).toBeUndefined()
    expect(parseWorktreeCommand("/model", commands)).toBeUndefined()
  })

  it("ignores plain text, unknown commands, and empty input", () => {
    expect(parseWorktreeCommand("fix the login bug", commands)).toBeUndefined()
    expect(parseWorktreeCommand("/unknown", commands)).toBeUndefined()
    expect(parseWorktreeCommand("", commands)).toBeUndefined()
  })

  it("does not treat a mid-prompt slash as a command", () => {
    expect(parseWorktreeCommand("please run /goal later", commands)).toBeUndefined()
  })
})
