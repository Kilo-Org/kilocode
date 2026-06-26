import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { assertNetwork, networkHttpLayer } from "@kilocode/sandbox"
import { opaque } from "./network-tools"

const Builtin = Symbol("kilo.sandbox.builtinTool")
const Remote = Symbol("kilo.sandbox.remoteMcp")
const indirect = new Set<string>(opaque.map((item) => item.id))

export const httpLayer = networkHttpLayer.pipe(Layer.provide(FetchHttpClient.layer))

export function builtin<A extends object>(value: A): A {
  if (!(Builtin in value)) Object.defineProperty(value, Builtin, { value: true })
  return value
}

export function isBuiltin(value: object) {
  return Builtin in value
}

export function remote<A extends object>(value: A): A {
  Object.defineProperty(value, Remote, { value: true })
  return value
}

export function tool<A, E, R>(value: { id: string }, effect: Effect.Effect<A, E, R>) {
  if (!(Builtin in value)) {
    return assertNetwork(`custom tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
  }
  if (!indirect.has(value.id)) return effect
  return assertNetwork(`tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
}

export function mcp<A, E, R>(value: object, effect: Effect.Effect<A, E, R>) {
  if (!(Remote in value)) return effect
  return assertNetwork("remote MCP delegated authority", "executeMcp").pipe(Effect.andThen(effect))
}
