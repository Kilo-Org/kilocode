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
 * An MCP tool: delegated authority that needs unrestricted network. The MCP registration marks its tools, because a
 * server named `opencode` with a tool named `read` produces the same namespace and declared name as a namespaced
 * built-in. Without the mark, a namespaced tool is MCP unless it is one of the `opencode`-namespaced built-ins.
 */
export function isMcp(value: { name: string; namespace?: string; mcp?: true }) {
  if (value.mcp) return true
  return value.namespace !== undefined && !(value.namespace === "opencode" && known.has(value.name))
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
