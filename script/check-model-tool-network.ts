#!/usr/bin/env bun
// kilocode_change - new file

// This is a CI-only architecture test, not production network enforcement. Model tools run
// inside the trusted kilo serve process, so macOS Seatbelt can only confine their spawned
// children. In-process tools must use the policy-aware HTTP capability instead of direct fetch,
// sockets, or ad hoc clients. Keep this narrow scan to prevent future tool implementations from
// accidentally bypassing that boundary; trusted provider and model-inference code is intentionally
// outside the scanned directories. Runtime enforcement remains in @kilocode/sandbox.

import path from "node:path"
import { host, opaque } from "../packages/opencode/src/kilocode/sandbox/network-tools"

const root = path.resolve(import.meta.dir, "..")
const source = path.join(root, "packages", "opencode", "src")
const dirs = ["tool", "kilocode/tool", "mcp"]
const checks = [
  { name: "direct fetch", pattern: /\b(?:globalThis\.)?fetch\s*\(/g },
  { name: "raw FetchHttpClient layer", pattern: /\bFetchHttpClient\.layer\b/g },
  { name: "direct Bun socket", pattern: /\bBun\.(?:connect|udpSocket)\s*\(/g },
  {
    name: "raw network module",
    pattern:
      /\bfrom\s+["'](?:(?:node:)?(?:http|https|http2|net|tls|dgram)(?:\/[^"']*)?|(?:undici|axios|got)(?:\/[^"']*)?)["']/g,
  },
  {
    name: "dynamic network module",
    pattern:
      /\b(?:require|import)\s*\(\s*["'](?:(?:node:)?(?:http|https|http2|net|tls|dgram)(?:\/[^"']*)?|(?:undici|axios|got)(?:\/[^"']*)?)["']/g,
  },
  {
    name: "ad hoc network client",
    pattern:
      /\bnew\s+(?:WarpGrepClient|OpenAI|QdrantClient|BedrockRuntimeClient|WebSocket|EventSource|StreamableHTTPClientTransport|SSEClientTransport)\s*\(/g,
  },
]
const allow = new Map([
  ...opaque.flatMap((item) =>
    "client" in item
      ? [[`${item.file}:${item.client.name}`, { ...item.client, file: item.file, id: item.id }] as const]
      : [],
  ),
  [
    "mcp/index.ts:ad hoc network client",
    {
      count: 3,
      file: "mcp/index.ts",
      id: "remote_mcp",
      reason: "MCP SDK transports are classified as remote delegated authority before model execution",
    },
  ] as const,
])
const excluded = new Map([
  ["mcp/oauth-callback.ts", "OAuth callback listener is trusted MCP control-plane setup, not model tool execution"],
])
const hits: Array<{ file: string; name: string; line: number }> = []
const glob = new Bun.Glob("**/*.ts")

for (const dir of dirs) {
  for (const file of glob.scanSync({ cwd: path.join(source, dir), onlyFiles: true })) {
    const rel = path.posix.join(dir, file.replaceAll("\\", "/"))
    if (excluded.has(rel)) continue
    const text = await Bun.file(path.join(source, rel)).text()
    for (const check of checks) {
      for (const match of text.matchAll(check.pattern)) {
        hits.push({
          file: rel,
          name: check.name,
          line: text.slice(0, match.index ?? 0).split("\n").length,
        })
      }
    }
  }
}

const invalid = hits.filter((hit) => !allow.has(`${hit.file}:${hit.name}`))
const clients = [...allow.entries()].flatMap(([key, entry]) => {
  const split = key.lastIndexOf(":")
  const file = key.slice(0, split)
  const name = key.slice(split + 1)
  const count = hits.filter((hit) => hit.file === file && hit.name === name).length
  if (count === entry.count) return []
  return [`  packages/opencode/src/${file}: expected ${entry.count} ${name} site(s), found ${count} (${entry.reason})`]
})
const tools = (
  await Promise.all(
    [...opaque, ...host].map(async (item) => {
      const text = await Bun.file(path.join(source, item.file)).text()
      const id = item.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      if (new RegExp(`Tool\\.define(?:<[\\s\\S]{0,500}?>)?\\(\\s*["']${id}["']`).test(text)) return []
      return [`  packages/opencode/src/${item.file}: opaque classification must match Tool.define("${item.id}")`]
    }),
  )
).flat()
const drift = [...clients, ...tools]

const network = await Bun.file(path.join(source, "kilocode", "sandbox", "network.ts")).text()
const registry = await Bun.file(path.join(source, "tool", "registry.ts")).text()
const session = await Bun.file(path.join(source, "session", "tools.ts")).text()
const mcp = await Bun.file(path.join(source, "mcp", "index.ts")).text()
const structure = [
  ...(!network.includes('import { host, opaque } from "./network-tools"') ||
  !network.includes("opaque.map((item) => item.id)")
    ? ["  kilocode/sandbox/network.ts must derive runtime opaque tool IDs from network-tools.ts"]
    : []),
  ...(!network.includes("host.map((item) => item.id)")
    ? ["  kilocode/sandbox/network.ts must derive host-executed tool IDs from network-tools.ts"]
    : []),
  ...(!registry.includes("Layer.provide(ToolNetwork.httpLayer)")
    ? ["  tool/registry.ts must provide the policy-aware ToolNetwork HTTP layer"]
    : []),
  ...(registry.includes("FetchHttpClient.layer")
    ? ["  tool/registry.ts must not provide a raw FetchHttpClient layer"]
    : []),
  ...(!registry.includes("ToolNetwork.builtin(result)")
    ? ["  tool/registry.ts must distinguish built-in tools from untrusted custom tools"]
    : []),
  ...(!/SandboxPolicy\.executeTool\(\s*ctx\.sessionID,\s*item,/.test(session)
    ? ["  session/tools.ts must route built-in and custom tools through session-aware executeTool"]
    : []),
  ...(!mcp.includes("SandboxNetwork.remote(tool)")
    ? ["  mcp/index.ts must classify remote MCP delegated authority"]
    : []),
  ...(!/SandboxPolicy\.executeMcp\(\s*ctx\.sessionID,\s*item,/.test(session)
    ? ["  session/tools.ts must route MCP delegated authority through session-aware executeMcp"]
    : []),
]

if (invalid.length > 0 || drift.length > 0 || structure.length > 0) {
  if (invalid.length > 0) {
    console.error("Found model-tool network clients that bypass the sandbox capability:")
    for (const hit of invalid) console.error(`  packages/opencode/src/${hit.file}:${hit.line} (${hit.name})`)
    console.error("")
  }
  if (drift.length > 0) {
    console.error("Classified model-tool network exceptions no longer match source:")
    for (const item of drift) console.error(item)
    console.error("")
  }
  if (structure.length > 0) {
    console.error("Model-tool network boundary wiring is incomplete:")
    for (const item of structure) console.error(item)
    console.error("")
  }
  console.error(
    "Use the @kilocode/sandbox network capability or classify an opaque client at the common tool boundary.",
  )
  process.exit(1)
}

console.log(
  `check-model-tool-network: ${hits.length} classified client site(s), policy-aware tool and MCP boundaries verified.`,
)
