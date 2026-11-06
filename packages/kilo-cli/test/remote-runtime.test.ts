import { expect, test } from "bun:test"
import { KiloRemote, KiloSessionSync } from "@kilocode/kilo-plugin"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Form } from "@opencode/core/form"
import { Instance } from "@opencode/core/instance/service"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionEvent } from "@opencode/schema/session-event"
import { KiloSessionSyncRpc } from "@opencode/schema/kilocode/session-sync"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
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

test("remote hosts use the explicit workspace and restore ownership before any new local activity", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-remote-runtime-")))
  const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-remote-outside-")))
  await symlink(outside, path.join(root, "escape"), "dir")
  await symlink(root, path.join(outside, "launch-alias"), "dir")
  const child = path.join(root, "child")
  await mkdir(child)
  const events: {
    type: string
    body: { syncPosition: number; data: unknown; running?: boolean; runID?: string | null; pending?: unknown }
  }[] = []
  const sockets = new Set<Bun.ServerWebSocket<{ presence: boolean; path: string }>>()
  let presence: Bun.ServerWebSocket<{ presence: boolean; path: string }> | undefined
  let advertisement: { sessions: string[] } | undefined
  const advertisements = new Map<string, { sessions: string[] }>()
  let instanceID: string | undefined
  const replies = new Map<string, { status: string; error?: { code: string } }>()
  const seenSessions = new Set<string>()
  let observed: readonly string[] = []
  let workspace: string | undefined
  let queuedSession: string | undefined
  let queuedDelivered = false
  let queuedRenames = 0
  let queuedAcknowledgements = 0
  let reauthDelivered = false
  let reauthAcknowledgements = 0
  let identity = "fixture"
  let userID = "fixture-user"
  let offline = false
  let grantFailure: string | undefined
  let liveReads = 0
  let stateFailure = false
  let stateReads = 0
  let presenceOpens = 0
  let heartbeats = 0
  const acknowledgements = new Set<string>()
  const peer = Bun.serve<{ presence: boolean; path: string }>({
    port: 0,
    fetch(request, server) {
      if (request.headers.get("authorization") !== "Bearer fixture-ticket") return new Response(null, { status: 401 })
      const pathname = new URL(request.url).pathname
      return server.upgrade(request, { data: { presence: pathname === "/v1/presence", path: pathname } })
        ? undefined
        : new Response(null, { status: 400 })
    },
    websocket: {
      open(socket) {
        sockets.add(socket)
        if (socket.data.presence) {
          presence = socket
          presenceOpens++
        }
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
        const queuedCommand = !queuedDelivered
          ? "queued-before-resume"
          : identity === "fixture-refreshed" && !reauthDelivered
            ? "queued-after-reauth"
            : undefined
        if (!socket.data.presence && queuedCommand && socket.data.path === `/v1/sessions/${queuedSession}/live`) {
          if (queuedCommand === "queued-before-resume") queuedDelivered = true
          else reauthDelivered = true
          // The mailbox can replay a delivery when its acknowledgement was lost.
          for (let index = 0; index < 2; index++)
            socket.send(
              JSON.stringify({
                v: 1,
                channel: "commands",
                seq: index + 1,
                from: "fixture-user",
                at: Date.now(),
                type: "session.renamed",
                body: {
                  commandID: queuedCommand,
                  payload: {
                    title:
                      queuedCommand === "queued-before-resume"
                        ? "Queued after resume"
                        : "Queued after reauthentication",
                  },
                  liveOnly: false,
                  expiresAt: new Date(Date.now() + 60_000).toISOString(),
                },
              }),
            )
        }
      },
      message(_socket, message) {
        const frame = JSON.parse(String(message))
        if (frame.channel === "events") events.push(frame)
        if (frame.type === "heartbeat") {
          advertisement = frame.advertisement
          advertisements.set(frame.advertisement.projectName, frame.advertisement)
          instanceID = frame.instanceID
          for (const sessionID of frame.advertisement.sessions) seenSessions.add(sessionID)
          heartbeats++
        }
        if (frame.type === "ack") acknowledgements.add(frame.commandID)
        if (frame.type === "ack" && frame.commandID === "queued-before-resume") queuedAcknowledgements++
        if (frame.type === "ack" && frame.commandID === "queued-after-reauth") reauthAcknowledgements++
        if (frame.type === "reply") replies.set(frame.commandID, frame.body)
      },
      close(socket) {
        sockets.delete(socket)
      },
    },
  })
  let synced: KiloSessionSync.LiveContext["sessions"][number][] = []
  const status = KiloSessionSyncRpc.Status.make({ directory: root, enabled: true, pending: 0, sessions: 1 })
  const sync = KiloSessionSync.Service.of({
    live: (launchDirectory, sessionIDs) =>
      Effect.suspend(() => {
        liveReads++
        workspace = launchDirectory
        observed = sessionIDs ?? []
        if (grantFailure) return Effect.fail({ code: grantFailure, message: "Fixture access denied" })
        if (offline) return Effect.succeed(undefined)
        return Effect.succeed<KiloSessionSync.LiveContext>({
          destination: peer.url.origin,
          identity,
          organizationID: null,
          tenant: { type: "user", id: userID },
          userID,
          sessions: synced,
        })
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
  // Exercise transport/state orchestration without booting unrelated model catalogs,
  // filesystem watchers and workspace tools. The real-host E2E covers those services.
  const pending = Layer.mergeAll(
    Layer.succeed(Permission.Service, {
      forSession: () =>
        Effect.suspend(() => {
          stateReads++
          return stateFailure ? Effect.die(new Error("fixture state failure")) : Effect.succeed([])
        }),
    } as unknown as Permission.Interface),
    Layer.succeed(Form.Service, { list: () => Effect.succeed([]) } as unknown as Form.Interface),
  )
  const instances: Instance.Interface = {
    provide:
      () =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provide(pending)) as Effect.Effect<A, E, Exclude<R, Instance.Services>>,
  }
  const replacements: LayerNode.Replacements = [
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
    Instance.node.replace(Layer.succeed(Instance.Service, instances)),
    SessionSync.node.replace(
      makeGlobalNode({
        service: KiloSessionSync.Service,
        layer: Layer.succeed(KiloSessionSync.Service, sync),
        deps: [],
      }),
    ),
    Remote.node.replace(Remote.configured({ enabled: false })),
  ]
  try {
    // Create durable history in an earlier host lifetime, with no Remote service.
    const { session, escaped, linked } = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(AppNodeBuilder.build(LayerNode.group([Session.node]), replacements))
        const sessions = Context.get(context, Session.Service)
        return {
          session: yield* sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(root) }) }),
          escaped: yield* sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(outside) }) }),
          linked: yield* sessions.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(path.join(root, "escape")) }),
          }),
        }
      }).pipe(Effect.scoped),
    )
    synced = [{ sessionID: session.id, directory: root, sourceID: "fixture-source", position: 17 }]
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          AppNodeBuilder.build(LayerNode.group([Remote.node, Session.node, Bus.node]), replacements),
        )
        const hosts = Context.get(context, KiloRemote.Service)
        const sessions = Context.get(context, Session.Service)
        const remote = yield* hosts.forDirectory(root)
        expect(yield* hosts.forDirectory(root)).toBe(remote)
        expect(yield* hosts.forDirectory(path.join(outside, "launch-alias"))).toBe(remote)
        expect((yield* remote.attach(escaped.id).pipe(Effect.flip)).code).toBe("directory_escape")
        expect((yield* remote.attach(linked.id).pipe(Effect.flip)).code).toBe("directory_escape")
        const bus = Context.get(context, Bus.Service)
        yield* bus.subscribe().pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (
                event.type === SessionEvent.Renamed.type &&
                Schema.decodeUnknownSync(SessionEvent.Renamed.data)(event.data).sessionID === session.id
              )
                queuedRenames++
            }),
          ),
          Effect.forkScoped,
        )
        yield* Effect.promise(() => until(() => advertisement !== undefined))
        expect(workspace).toBe(root)
        expect(process.cwd()).not.toBe(root)
        expect(advertisement?.sessions).toEqual([])
        expect((yield* remote.status()).enabled).toBe(false)
        yield* remote.attach(session.id)
        yield* Effect.promise(() => until(() => !!advertisement?.sessions.includes(session.id)))
        queuedSession = session.id
        yield* remote.enable()
        yield* Effect.promise(() => until(() => queuedAcknowledgements === 2))
        expect((yield* sessions.get(session.id)).title).toBe("Queued after resume")
        expect(queuedRenames).toBe(1)
        expect(observed).toContain(session.id)
        // A new credential for the same verified owner must refresh transport
        // without dropping the restored session accepted by this attach call.
        identity = "fixture-refreshed"
        yield* remote.attach(session.id)
        yield* Effect.promise(() => until(() => reauthAcknowledgements === 2))
        expect((yield* sessions.get(session.id)).title).toBe("Queued after reauthentication")
        expect(queuedRenames).toBe(2)
        expect(observed).toContain(session.id)
        for (const [commandID, directory] of [
          ["root", root],
          ["outside", outside],
          ["symlink", path.join(root, "escape")],
        ] as const) {
          presence!.send(
            JSON.stringify({
              v: 1,
              channel: "commands",
              seq: 0,
              from: "fixture-user",
              at: Date.now(),
              type: "list_directories",
              body: { instanceID, commandID, payload: { directory } },
            }),
          )
          yield* Effect.promise(() => until(() => replies.has(commandID)))
        }
        expect(replies.get("root")?.status).toBe("succeeded")
        expect(replies.get("outside")?.error?.code).toBe("directory_escape")
        expect(replies.get("symlink")?.error?.code).toBe("directory_escape")
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
        // A later native creation must traverse the same serial bus subscription before
        // appearing in discovery, then its heartbeat crosses the real presence socket.
        const barrier = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: barrier.id, directory: root, sourceID: "fixture-source", position: 18 })
        yield* Effect.promise(() =>
          until(() => observed.includes(barrier.id) && !!advertisement?.sessions.includes(barrier.id)),
        )
        expect(events).toHaveLength(0)
        yield* remote.disable()
        yield* Effect.promise(() => until(() => sockets.size === 1))
        watch(true)
        yield* Effect.promise(() => until(() => sockets.size === 2))
        yield* Effect.promise(() => until(() => events.some((event) => event.type === "remote.state")))
        expect(events.find((event) => event.type === "remote.state")!.body).toMatchObject({
          runID: null,
          running: false,
          pending: { permissions: [], questions: [] },
          syncPosition: 17,
        })
        const stateCount = events.filter((event) => event.type === "remote.state").length
        watch(true)
        yield* Effect.promise(() =>
          until(() => events.filter((event) => event.type === "remote.state").length > stateCount),
        )
        // A failing snapshot is skipped; it must not tear down the process-wide presence socket.
        stateFailure = true
        const opens = presenceOpens
        const reads = stateReads
        watch(true)
        yield* Effect.promise(() => until(() => stateReads > reads))
        const failureBarrier = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: failureBarrier.id, directory: root, sourceID: "fixture-source", position: 18 })
        yield* Effect.promise(() => until(() => !!advertisement?.sessions.includes(failureBarrier.id)))
        expect(presenceOpens).toBe(opens)
        expect(sockets.size).toBe(2)
        stateFailure = false
        yield* sessions.rename({ sessionID: session.id, title: "Watched, control disabled" })
        yield* Effect.promise(() => until(() => events.some((event) => event.type === "session.renamed")))
        expect(events.find((event) => event.type === "session.renamed")!.body.syncPosition).toBe(17)
        expect((yield* remote.status()).enabled).toBe(false)
        watch(false)
        yield* Effect.promise(() => until(() => sockets.size === 1))
        const published = events.length
        yield* sessions.rename({ sessionID: session.id, title: "Unwatched again" })
        const secondBarrier = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: secondBarrier.id, directory: root, sourceID: "fixture-source", position: 19 })
        yield* Effect.promise(() =>
          until(() => observed.includes(secondBarrier.id) && !!advertisement?.sessions.includes(secondBarrier.id)),
        )
        expect(events).toHaveLength(published)
        yield* remote.disable()
        expect((yield* remote.status()).connected).toBe(true)
        yield* remote.enable()
        yield* Effect.promise(() => until(() => sockets.size === 5))
        const relay = [...sockets].find((socket) => socket.data.path === `/v1/sessions/${session.id}/live`)!
        relay.send(
          JSON.stringify({
            v: 1,
            channel: "commands",
            seq: 0,
            from: "fixture-user",
            at: Date.now(),
            type: "detach",
            body: {
              commandID: "detach-runtime",
              payload: {},
              liveOnly: false,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
        )
        yield* Effect.promise(() => until(() => acknowledgements.has("detach-runtime") && sockets.size === 4))
        yield* sessions.rename({ sessionID: session.id, title: "Still detached" })
        const detachBarrier = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: detachBarrier.id, directory: root, sourceID: "fixture-source", position: 20 })
        yield* Effect.promise(() => until(() => !!advertisement?.sessions.includes(detachBarrier.id)))
        expect(advertisement?.sessions).not.toContain(session.id)
        // A transient sync miss stops transport but keeps ownership and the detach fence.
        offline = true
        yield* Effect.promise(() => until(() => sockets.size === 0))
        const offlineCreated = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: offlineCreated.id, directory: root, sourceID: "fixture-source", position: 21 })
        yield* Effect.promise(() => until(() => observed.includes(offlineCreated.id)))
        const offlineDeleted = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: offlineDeleted.id, directory: root, sourceID: "fixture-source", position: 22 })
        yield* Effect.promise(() => until(() => observed.includes(offlineDeleted.id)))
        yield* sessions.remove(offlineDeleted.id)
        const beats = heartbeats
        offline = false
        yield* Effect.promise(() =>
          until(
            () =>
              heartbeats > beats &&
              !!advertisement?.sessions.includes(detachBarrier.id) &&
              !!advertisement?.sessions.includes(offlineCreated.id),
          ),
        )
        expect(observed).toContain(detachBarrier.id)
        expect(seenSessions.has(offlineDeleted.id)).toBe(false)
        // A terminal access denial discards its candidate instead of resurrecting it
        // when synchronization later becomes readable.
        grantFailure = "organization_access_denied"
        const denied = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: denied.id, directory: root, sourceID: "fixture-source", position: 23 })
        yield* Effect.promise(() => until(() => observed.includes(denied.id)))
        grantFailure = undefined
        const readsBeforeRecovery = liveReads
        yield* Effect.promise(() => until(() => liveReads > readsBeforeRecovery && !observed.includes(denied.id)))
        expect(seenSessions.has(denied.id)).toBe(false)
        yield* sessions.rename({ sessionID: session.id, title: "Detached after reconnect" })
        const reconnectBarrier = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: reconnectBarrier.id, directory: root, sourceID: "fixture-source", position: 21 })
        yield* Effect.promise(() => until(() => !!advertisement?.sessions.includes(reconnectBarrier.id)))
        expect(advertisement?.sessions).not.toContain(session.id)
        for (let index = 0; index < 100; index++) {
          const added = yield* sessions.create({ location: session.location })
          synced.push({ sessionID: added.id, directory: root, sourceID: "fixture-source", position: 20 + index })
        }
        yield* remote.enable()
        yield* Effect.promise(() => until(() => advertisement?.sessions.length === 100 && sockets.size === 101))
        expect(advertisement?.sessions).not.toContain(session.id)
        offline = true
        const previousOwnerCandidate = yield* sessions.create({ location: session.location })
        synced.push({ sessionID: previousOwnerCandidate.id, directory: root, sourceID: "fixture-source", position: 24 })
        yield* Effect.promise(() => until(() => observed.includes(previousOwnerCandidate.id)))
        identity = "different-account"
        userID = "different-user"
        offline = false
        yield* Effect.promise(() =>
          until(() => advertisement?.sessions.length === 0 && sockets.size === 1 && observed.length === 0),
        )
        expect(observed).toHaveLength(0)
        expect(seenSessions.has(previousOwnerCandidate.id)).toBe(false)
        const continued = yield* sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(child) }),
        })
        synced.push({ sessionID: continued.id, directory: child, sourceID: "fixture-source", position: 200 })
        yield* remote.attach(continued.id)
        const childHost = yield* hosts.forDirectory(child)
        expect((yield* childHost.attach(continued.id).pipe(Effect.flip)).code).toBe("session_owned")
        expect((yield* remote.status()).enabled).toBe(true)
        expect((yield* childHost.status()).enabled).toBe(false)
        const childOnly = yield* sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(child) }),
        })
        synced.push({ sessionID: childOnly.id, directory: child, sourceID: "fixture-source", position: 201 })
        yield* Effect.promise(() =>
          until(() => !!advertisements.get(path.basename(child))?.sessions.includes(childOnly.id)),
        )
        expect(advertisements.get(path.basename(root))?.sessions).not.toContain(childOnly.id)
        expect((yield* remote.attach(childOnly.id).pipe(Effect.flip)).code).toBe("session_owned")
        expect([...sockets].some((socket) => socket.data.path === `/v1/sessions/${childOnly.id}/live`)).toBe(false)
        yield* Effect.promise(() =>
          until(() => [...sockets].some((socket) => socket.data.path === `/v1/sessions/${continued.id}/live`)),
        )
        const continuedRelay = [...sockets].find((socket) => socket.data.path === `/v1/sessions/${continued.id}/live`)!
        continuedRelay.send(
          JSON.stringify({
            v: 1,
            channel: "commands",
            seq: 0,
            from: "fixture-user",
            at: Date.now(),
            type: "detach",
            body: {
              commandID: "detach-overlap",
              payload: {},
              liveOnly: false,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
        )
        yield* Effect.promise(() =>
          until(
            () =>
              acknowledgements.has("detach-overlap") &&
              ![...sockets].some((socket) => socket.data.path === `/v1/sessions/${continued.id}/live`),
          ),
        )
        yield* sessions.rename({ sessionID: continued.id, title: "Detached in every overlapping host" })
        yield* childHost.attach(continued.id)
        expect([...sockets].some((socket) => socket.data.path === `/v1/sessions/${continued.id}/live`)).toBe(false)
        // An event-only CLI caller still gets a host rooted in authoritative session
        // metadata, not the daemon cwd; bootstrap must not enable remote commands.
        synced.push({ sessionID: escaped.id, directory: outside, sourceID: "fixture-source", position: 201 })
        yield* sessions.rename({ sessionID: escaped.id, title: "Continued by a non-TUI client" })
        yield* Effect.promise(() => until(() => seenSessions.has(escaped.id)))
        expect((yield* (yield* hosts.forDirectory(outside)).status()).enabled).toBe(false)
      }).pipe(Effect.scoped),
    )
  } finally {
    peer.stop(true)
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
}, 60_000)
