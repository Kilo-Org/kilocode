export * as SdkPlugins from "./sdk.js"

import type { Plugin } from "@opencode/plugin/effect/plugin"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import type { Generation } from "../plugin.js"

export const Updated = Bus.ephemeral({ type: "sdk.plugin.updated", schema: {} })

/**
 * Holds the plugins an embedder (the `@opencode/sdk` host) contributes,
 * so the application loader can add them on every Location boot through its
 * ordinary generation path. Registration publishes an unlocated update so every booted Location
 * reloads its plugin generation from the shared store.
 *
 * Each host-global layer owns one private store. Location graphs reuse that
 * layer through Effect's memoization, so separate hosts remain isolated while
 * every Location in one host sees the same registrations.
 */
export interface Interface {
  readonly register: (plugin: Plugin, options?: { readonly phase?: "post" }) => Effect.Effect<void> // kilocode_change(agent) seam - optional phase
  readonly all: (phase?: "post") => readonly Generation[] // kilocode_change(agent) seam - no phase: before the internal post plugins
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SdkPlugins") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const plugins = new Map<string, Generation>()
    const phases = new Map<string, "post" | undefined>() // kilocode_change(agent) seam - phase per plugin ID
    let revision = 0
    return Service.of({
      register: (plugin, options /* kilocode_change(agent) seam - optional phase */) =>
        Effect.sync(() => {
          plugins.set(plugin.id, { ...plugin, revision: String(++revision), source: { type: "sdk" } })
          phases.set(plugin.id, options?.phase) // kilocode_change(agent) seam - remember the phase
        }).pipe(Effect.andThen(bus.publish(Updated, {})), Effect.asVoid),
      all: (phase) => [...plugins.values()].filter((plugin) => phases.get(plugin.id) === phase), // kilocode_change(agent) seam - one phase
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Bus.node] })
