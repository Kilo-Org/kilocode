import { describe, expect, it } from "bun:test"
import { createMcpAuth } from "../../webview-ui/src/context/mcp-auth"

describe("createMcpAuth removal state", () => {
  it("tracks removal progress and clears it on completion", () => {
    const mcp = createMcpAuth({ post: () => {}, connected: () => true })

    expect(mcp.accept({ type: "mcpRemovalState", name: "anaconda", removing: true })).toBe(true)
    expect(mcp.removing()).toEqual(["anaconda"])

    expect(mcp.accept({ type: "mcpRemoved", name: "anaconda" })).toBe(true)
    expect(mcp.removing()).toEqual([])
  })

  it("does not duplicate removal state", () => {
    const mcp = createMcpAuth({ post: () => {}, connected: () => true })
    const message = { type: "mcpRemovalState" as const, name: "anaconda", removing: true }

    mcp.accept(message)
    mcp.accept(message)

    expect(mcp.removing()).toEqual(["anaconda"])
  })
})
