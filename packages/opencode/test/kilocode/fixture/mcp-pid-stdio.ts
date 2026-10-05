import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

// Stdio MCP server that reports its pid. With --hang it never answers initialize.
const file = process.env.MCP_PID_FILE
if (!file) throw new Error("MCP_PID_FILE is required")

if (process.argv.includes("--hang")) {
  await Bun.write(file, String(process.pid))
  await new Promise(() => {})
}

const server = new Server({ name: "mcp-pid-stdio", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Written once the client has connected and is listing tools.
  await Bun.write(file, String(process.pid))
  return { tools: [{ name: "ping", description: "ping", inputSchema: { type: "object", properties: {} } }] }
})

await server.connect(new StdioServerTransport())
