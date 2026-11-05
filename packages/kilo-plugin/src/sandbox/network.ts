import { Effect } from "effect"
import { assertNetwork, assertSandbox } from "@kilocode/sandbox"
import { builtin, host, opaque } from "./network-tools"

const known = new Set<string>(builtin)
const indirect = new Set<string>(opaque.map((item) => item.id))
const external = new Set<string>(host.map((item) => item.id))

export function isBuiltin(id: string) {
  return known.has(id)
}

/**
 * An MCP tool: delegated authority that needs unrestricted network. MCP tools carry their server's namespace. The only
 * namespaced built-in tools are in the `opencode` namespace, so an MCP tool whose name matches a built-in name is
 * still MCP. The declared tool name is unprefixed; the registry id adds the namespace.
 */
export function isMcp(name: string, namespace: string | undefined) {
  return namespace !== undefined && !(namespace === "opencode" && known.has(name))
}

export function tool<A, E, R>(value: { id: string; name?: string; mcp?: boolean }, effect: Effect.Effect<A, E, R>) {
  if (value.mcp) return assertNetwork("MCP delegated authority", "executeMcp").pipe(Effect.andThen(effect))
  // The declared name classifies the tool; the id names it in the error and may carry a namespace prefix.
  const name = value.name ?? value.id
  if (!known.has(name)) {
    return assertNetwork(`custom tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
  }
  if (external.has(name)) return assertSandbox(`tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
  if (!indirect.has(name)) return effect
  return assertNetwork(`tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
}
