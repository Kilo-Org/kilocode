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

const server = new Server(
  { name: "mcp-pid-stdio", version: "1.0.0" },
  { capabilities: { tools: { listChanged: true } } },
)
let timer: ReturnType<typeof setInterval> | undefined
let listed = 0

server.setRequestHandler(ListToolsRequestSchema, async () => {
  listed++
  if (listed === 1) {
    await Bun.write(file, String(process.pid))
    // The client only re-lists tools on a change notification once the MCP state holds it
    // as a connected client, so keep announcing a change until that second request arrives.
    timer = setInterval(() => void server.sendToolListChanged(), 20)
  }
  if (listed === 2) {
    clearInterval(timer)
    await Bun.write(`${file}.stored`, "")
  }
  return { tools: [{ name: "ping", description: "ping", inputSchema: { type: "object", properties: {} } }] }
})

await server.connect(new StdioServerTransport())
