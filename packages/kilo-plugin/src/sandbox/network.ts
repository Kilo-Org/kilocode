import { Effect } from "effect"
import { assertNetwork, assertSandbox } from "@kilocode/sandbox"
import { builtin, host, opaque } from "./network-tools"

const known = new Set<string>(builtin)
const indirect = new Set<string>(opaque.map((item) => item.id))
const external = new Set<string>(host.map((item) => item.id))

export function isBuiltin(id: string) {
  return known.has(id)
}

export function tool<A, E, R>(value: { id: string; mcp?: boolean }, effect: Effect.Effect<A, E, R>) {
  if (value.mcp) return assertNetwork("MCP delegated authority", "executeMcp").pipe(Effect.andThen(effect))
  if (!known.has(value.id)) {
    return assertNetwork(`custom tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
  }
  if (external.has(value.id)) return assertSandbox(`tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
  if (!indirect.has(value.id)) return effect
  return assertNetwork(`tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
}
