import { describe, expect, test } from "bun:test"
import { mcpServerFromError } from "../webview-ui/src/v2/mcp-error"

describe("mcpServerFromError", () => {
  test.each([
    ['MCP server "github" needs authentication: OAuth required. Sign in from /mcps.', "github"],
    ['MCP server "github" is not connected: connection refused. Reconnect it from /mcps.', "github"],
    ['MCP server "linear" is disabled.', "linear"],
  ])("reads the server name from %s", (message, server) => {
    expect(mcpServerFromError(message)).toBe(server)
  })

  test("ignores errors from other tools", () => {
    expect(mcpServerFromError("File not found")).toBeUndefined()
  })
})
