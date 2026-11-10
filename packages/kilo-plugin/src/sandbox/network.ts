import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import { assertNetwork, assertSandbox } from "@kilocode/sandbox"
import { builtin, host, opaque } from "./network-tools"

const known = new Set<string>(builtin)
const indirect = new Set<string>(opaque.map((item) => item.id))
const external = new Set<string>(host.map((item) => item.id))
// Kilo branding renames the upstream built-in tool namespace to `kilo` when the host loads it; code that runs
// without that transform (upstream checks, this package's tests) still sees `opencode`.
const builtinNamespaces = new Set(["kilo", "opencode"])

export function isBuiltin(id: string) {
  return known.has(id)
}

/**
 * An MCP tool: delegated authority that needs unrestricted network. The MCP registration marks its tools, because a
 * server named `opencode` with a tool named `read` produces the same namespace and declared name as a namespaced
 * built-in. Without the mark, a namespaced tool is MCP unless it is one of the built-ins of a built-in namespace. It
 * takes the registry entry itself, so the mark cannot be dropped between the registry and this check.
 */
export function isMcp(tool: Pick<Tool.Info, "name" | "options">) {
  if (tool.options?.mcp) return true
  const namespace = tool.options?.namespace
  return namespace !== undefined && !(builtinNamespaces.has(namespace) && known.has(tool.name))
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
