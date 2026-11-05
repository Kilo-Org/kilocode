import { expect, test } from "bun:test"
import { KiloRemote, KiloSessionSync } from "@kilocode/kilo-plugin"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Session } from "@opencode/core/session"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { KiloSessionSyncRpc } from "@opencode/schema/kilocode/session-sync"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { Remote } from "../src/remote"
import { SessionSync } from "../src/session-sync"

// Real WebSockets and the production heartbeat use the platform clock; wait on observed
// socket/event conditions rather than guessing a delay or advancing only one side's clock.
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Remote fixture condition did not arrive")
    await Bun.sleep(10)
  }
}

test("remote status is idempotent and live native events are gated by watches, not control", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-remote-runtime-"))
  const events: { type: string; body: { syncPosition: number; data: unknown } }[] = []
  const sockets = new Set<Bun.ServerWebSocket<{ presence: boolean }>>()
  let presence: Bun.ServerWebSocket<{ presence: boolean }> | undefined
  const peer = Bun.serve<{ presence: boolean }>({
    port: 0,
    fetch(request, server) {
      if (request.headers.get("authorization") !== "Bearer fixture-ticket") return new Response(null, { status: 401 })
      return server.upgrade(request, { data: { presence: new URL(request.url).pathname === "/v1/presence" } })
        ? undefined
        : new Response(null, { status: 400 })
    },
    websocket: {
      open(socket) {
        sockets.add(socket)
        if (socket.data.presence) presence = socket
        socket.send(
          JSON.stringify({
            v: 1,
            channel: "control",
            seq: 0,
            from: "server",
            at: Date.now(),
            type: "hello",
            body: {
              reauthAt: new Date(Date.now() + 60_000).toISOString(),
              expiresAt: new Date(Date.now() + 120_000).toISOString(),
              reconnectAfterMs: 1000,
            },
          }),
        )
      },
      message(_socket, message) {
        const frame = JSON.parse(String(message))
        if (frame.channel === "events") events.push(frame)
      },
      close(socket) {
        sockets.delete(socket)
      },
    },
  })
  let synced: KiloSessionSync.LiveContext["sessions"] = []
  const status = KiloSessionSyncRpc.Status.make({ directory: root, enabled: true, pending: 0, sessions: 1 })
  const sync = KiloSessionSync.Service.of({
    live: () =>
      Effect.succeed({
        destination: peer.url.origin,
        identity: "fixture",
        organizationID: null,
        tenant: { type: "user", id: "fixture-user" },
        userID: "fixture-user",
        sessions: synced,
      }),
    liveTicket: () =>
      Effect.succeed({ ticket: "fixture-ticket", expiresAt: new Date(Date.now() + 120_000).toISOString() }),
    livePosition: () => Effect.succeed({ sourceID: "fixture-source", position: 17 }),
    organization: () => Effect.void,
    status: () => Effect.succeed(status),
    enable: () => Effect.succeed(status),
    disable: () => Effect.succeed(status),
    flush: () => Effect.succeed(status),
  })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          AppNodeBuilder.build(LayerNode.group([Remote.node, Session.node, Bus.node]), [
            Global.node.replace(
              Global.layerWith(
                Object.fromEntries(
                  ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [
                    key,
                    path.join(root, key),
                  ]),
                ),
              ),
            ),
            Database.node.replace(Database.configured({ path: path.join(root, "native.sqlite") })),
            SessionSync.node.replace(
              makeGlobalNode({
                service: KiloSessionSync.Service,
                layer: Layer.succeed(KiloSessionSync.Service, sync),
                deps: [],
              }),
            ),
            Remote.node.replace(Remote.configured({ launchDirectory: root, enabled: false })),
          ]),
        )
        const remote = Context.get(context, KiloRemote.Service)
        const sessions = Context.get(context, Session.Service)
        const session = yield* sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(root) }) })
        synced = [{ sessionID: session.id, directory: root, sourceID: "fixture-source", position: 17 }]
        yield* Effect.promise(() => until(() => presence !== undefined))
        expect((yield* remote.status()).enabled).toBe(false)
        yield* remote.enable()
        yield* Effect.promise(() => until(() => [...sockets].some((socket) => !socket.data.presence)))
        const count = sockets.size
        yield* remote.enable()
        expect(sockets.size).toBe(count)
        const watch = (watching: boolean) =>
          presence!.send(
            JSON.stringify({
              v: 1,
              channel: "control",
              seq: 0,
              from: "server",
              at: Date.now(),
              type: "watch",
              body: { tenant: { type: "user", id: "fixture-user" }, sessionID: session.id, watching },
            }),
          )
        // No watcher: even a real durable rename must not enter the live relay.
        yield* sessions.rename({ sessionID: session.id, title: "Unwatched" })
        expect(events).toHaveLength(0)
        yield* remote.disable()
        yield* Effect.promise(() => until(() => sockets.size === 1))
        watch(true)
        yield* Effect.promise(() => until(() => sockets.size === 2))
        yield* sessions.rename({ sessionID: session.id, title: "Watched, control disabled" })
        yield* Effect.promise(() => until(() => events.some((event) => event.type === "session.renamed")))
        expect(events.find((event) => event.type === "session.renamed")!.body.syncPosition).toBe(17)
        expect((yield* remote.status()).enabled).toBe(false)
        watch(false)
        yield* Effect.promise(() => until(() => sockets.size === 1))
        const published = events.length
        yield* sessions.rename({ sessionID: session.id, title: "Unwatched again" })
        expect(events).toHaveLength(published)
        yield* remote.disable()
        expect((yield* remote.status()).connected).toBe(true)
      }).pipe(Effect.scoped),
    )
  } finally {
    peer.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
