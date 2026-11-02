// The MCP client reports a server that cannot serve a tool call as `MCP server "name" needs authentication: ...`.
// The chat turns that into a link to the server row in Settings.
const MCP_SERVER = /MCP server "([^"]+)"/

export function mcpServerFromError(message: string): string | undefined {
  const match = MCP_SERVER.exec(message)
  return match?.[1]
}
