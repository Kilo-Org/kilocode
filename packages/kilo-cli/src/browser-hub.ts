export * as BrowserHub from "./browser-hub"

import { BrowserHub as Port } from "@kilocode/kilo-plugin/browser/hub"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import type { Options } from "./browser/port"

/**
 * The hub connection the browser tools drive. The transport, and the wire parsing it carries, are loaded on the first
 * call that needs the extension backend: a static import would put them in the server's module graph, and a Playwright
 * user pays that load cost at startup for a backend it never selects.
 */
export function make(options: Options = {}): Port.Interface {
  const ports = new Map<string, Promise<Port.Port>>()
  const load = (target: string | null) => {
    const key = target ?? ""
    const existing = ports.get(key)
    if (existing) return existing
    const created = import("./browser/port").then((module) => module.hub(options).port(target))
    ports.set(key, created)
    return created
  }
  return {
    port(target) {
      const connection = () => load(target ?? null)
      return {
        ready: async (timeoutMs) => (await connection()).ready(timeoutMs),
        open: async (input) => (await connection()).open(input),
        close: async (handle) => (await connection()).close(handle),
        list: async () => (await connection()).list(),
        reported: async () => {
          // A transport that was never loaded cannot be connected, and asking must not start one.
          const loaded = ports.get(target ?? "")
          if (loaded === undefined) return undefined
          const port = await loaded.catch(() => undefined)
          return port ? port.reported() : undefined
        },
        call: async (input) => (await connection()).call(input),
        begin: async (input) => (await connection()).begin(input),
        chunk: async (input) => (await connection()).chunk(input),
        end: async (uploadId) => (await connection()).end(uploadId),
        // A notification listener cannot wait for the module, so the subscription lands once it is loaded and is
        // dropped again if the caller has already unsubscribed.
        onRevoked: (listener) => {
          let off: (() => void) | undefined
          let live = true
          void connection().then((port) => {
            const stop = port.onRevoked(listener)
            if (!live) return stop()
            off = stop
          })
          return () => {
            live = false
            off?.()
          }
        },
      }
    },
  }
}

export const node = makeGlobalNode({
  service: Port.Service,
  layer: Layer.effect(Port.Service, Effect.sync(() => make())),
  deps: [],
})
