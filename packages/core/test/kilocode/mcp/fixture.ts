import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

// The test applies its localCommand hook by appending this flag. Reaching the handshake without it
// means the hook was not applied, so fail loudly instead of serving a server that hides the bug.
if (!process.argv.includes("--host-hook")) {
  console.error("missing --host-hook: the localCommand hook was not applied")
  process.exit(2)
}

const server = new Server({ name: "host-hooks", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler("tools/list", () =>
  Promise.resolve({ tools: [{ name: "echo", inputSchema: { type: "object" as const } }] }),
)

await server.connect(new StdioServerTransport())
