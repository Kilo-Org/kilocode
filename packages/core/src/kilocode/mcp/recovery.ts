export * as KiloMcpRecovery from "./recovery.js"

import { McpEvent } from "@opencode/schema/mcp-event"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { httpFetch } from "@opencode/util/effect/app-node-platform"
import { Clock, Effect, FiberMap, Layer, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Environment } from "../../environment/index.js"
import { Form } from "../../form.js"
import { Integration } from "../../integration.js"
import { Location } from "../../location.js"
import { Mcp } from "../../mcp/index.js"
import { McpPool } from "../../mcp/pool.js"

// Upstream leaves a server that failed, or whose live connection closed, failed until someone reconnects it
// by hand (anomalyco/opencode#52237), so a DNS or VPN outage at startup or after sleep strands it for the life of
// the server. Kilo retries such servers with capped exponential backoff. Remove this once upstream recovers
// failed servers itself (anomalyco/opencode#61762 or a successor).
export const BASE_DELAY_MS = 1_000
export const MAX_DELAY_MS = 60_000
// A connection that drops sooner than this keeps its backoff, so a flapping server is not hammered.
export const STABLE_MS = 30_000

/** The MCP service with failed servers retried in the background. */
export const configured = (options?: Mcp.Options) =>
  makeLocationNode({
    service: Mcp.Service,
    layer: layer(Mcp.layer(options)),
    deps: [
      Location.node,
      Environment.node,
      Bus.node,
      Form.node,
      Integration.node,
      Credential.node,
      httpFetch,
      McpPool.node,
    ],
  })

export const layer = <E, R>(inner: Layer.Layer<Mcp.Service, E, R>) =>
  Layer.effect(
    Mcp.Service,
    Effect.gen(function* () {
      const mcp = yield* Mcp.Service
      yield* recover(mcp)
      return mcp
    }),
  ).pipe(Layer.provide(inner))

// Only `failed` is retried: `needs_auth` waits for a sign-in, `disabled` for the user, and a removed server is gone.
const recover = Effect.fnUntraced(function* (mcp: Mcp.Interface) {
  const bus = yield* Bus.Service
  const retries = yield* FiberMap.make<string>()
  const attempts = new Map<string, number>()
  const connectedAt = new Map<string, number>()

  const status = (name: string) =>
    mcp.servers().pipe(Effect.map((servers) => servers.find((server) => server.name === name)?.status.status))

  // One loop per server. Its own reconnects publish `failed` while it runs, so the loop, not the event, schedules
  // the next attempt. It ends once the server is anything but failed.
  const retry = (name: string) =>
    Effect.gen(function* () {
      while (true) {
        const attempt = attempts.get(name) ?? 0
        attempts.set(name, attempt + 1)
        yield* Effect.sleep(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS))
        if ((yield* status(name)) !== "failed") return
        yield* Effect.logInfo("mcp reconnecting failed server", { server: name, attempt: attempt + 1 })
        yield* mcp.connect(name).pipe(Effect.ignore)
        if ((yield* status(name)) !== "failed") return
      }
    })

  const observe = Effect.fnUntraced(function* (name: string) {
    const current = yield* status(name)
    if (current === "pending") return
    const now = yield* Clock.currentTimeMillis
    if (current === "connected") {
      connectedAt.set(name, now)
      return
    }
    const since = connectedAt.get(name)
    connectedAt.delete(name)
    if (current === "failed") {
      if (since !== undefined && now - since >= STABLE_MS) attempts.delete(name)
      yield* FiberMap.run(retries, name, retry(name), { onlyIfMissing: true })
      return
    }
    attempts.delete(name)
    yield* FiberMap.remove(retries, name)
  })

  yield* bus.subscribe(McpEvent.StatusChanged).pipe(
    Stream.runForEach((event) => observe(event.data.server)),
    Effect.forkScoped({ startImmediately: true }),
  )
  // Servers that settled before the subscription started publish nothing more until they change again.
  yield* Effect.forEach(yield* mcp.servers(), (server) => observe(server.name), { discard: true })
})
