import { describe, expect, test } from "bun:test"
import { DEFAULT_TOOL_DISPLAY, toolDefaultOpen } from "../webview-ui/src/v2/tool-default-open"

describe("toolDefaultOpen", () => {
  test("opens Code Mode and closes terminal, edit and MCP blocks by default", () => {
    expect(toolDefaultOpen("shell")).toBe(false)
    expect(toolDefaultOpen("edit")).toBe(false)
    expect(toolDefaultOpen("write")).toBe(false)
    expect(toolDefaultOpen("patch")).toBe(false)
    expect(toolDefaultOpen("mcp__server__tool")).toBe(false)
    expect(toolDefaultOpen("execute")).toBe(true)
  })

  test("maps each tool to its own layout", () => {
    const settings = {
      terminalCommandDisplay: "expanded" as const,
      codeEditDisplay: "expanded" as const,
      mcpToolDisplay: "expanded" as const,
      codeModeDisplay: "collapsed" as const,
    }
    expect(toolDefaultOpen("shell", settings)).toBe(true)
    expect(toolDefaultOpen("edit", settings)).toBe(true)
    expect(toolDefaultOpen("write", settings)).toBe(true)
    expect(toolDefaultOpen("patch", settings)).toBe(true)
    expect(toolDefaultOpen("mcp__server__tool", settings)).toBe(true)
    expect(toolDefaultOpen("execute", settings)).toBe(false)
    // Code Mode has its own layout, independent of the MCP one.
    expect(toolDefaultOpen("execute", { ...settings, mcpToolDisplay: "collapsed", codeModeDisplay: "expanded" })).toBe(
      true,
    )
  })

  test("leaves a builtin tool without a block to its renderer", () => {
    const open = { ...DEFAULT_TOOL_DISPLAY, mcpToolDisplay: "expanded" as const }
    expect(toolDefaultOpen("read", open)).toBeUndefined()
    expect(toolDefaultOpen("grep", open)).toBeUndefined()
    expect(toolDefaultOpen("skill", open)).toBeUndefined()
  })
})
