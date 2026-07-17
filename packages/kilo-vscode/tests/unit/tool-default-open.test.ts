import { describe, expect, it } from "bun:test"
import type { Part, ToolPart } from "@kilocode/sdk/v2"
import { toolDefaultOpen } from "../../webview-ui/src/components/chat/tool-default-open"

function tool(name: string) {
  return { type: "tool", tool: name } as ToolPart
}

describe("toolDefaultOpen", () => {
  it.each(["bash", "background_process"])("uses the terminal preference for %s", (name) => {
    expect(toolDefaultOpen(tool(name), false, true)).toBe(false)
    expect(toolDefaultOpen(tool(name), true, false)).toBe(true)
  })

  it.each(["edit", "write", "apply_patch"])("uses the code edit preference for %s", (name) => {
    expect(toolDefaultOpen(tool(name), true, false)).toBe(false)
    expect(toolDefaultOpen(tool(name), false, true)).toBe(true)
  })

  it("leaves unrelated parts unchanged", () => {
    expect(toolDefaultOpen(tool("read"), true, true)).toBeUndefined()
    expect(toolDefaultOpen({ type: "text" } as Part, true, true)).toBeUndefined()
  })
})
