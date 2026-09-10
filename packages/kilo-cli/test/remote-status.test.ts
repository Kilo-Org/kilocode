import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { Effect } from "effect"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { createRemoteSessionPlugin, resolveQueueOwner } from "../src/remote-session"
import type { Layout } from "../src/paths"
import {
  createRemoteStatus,
  forgetSession,
  invalidatesQueue,
  queueFrames,
  queueReplayFrames,
  statusFrames,
} from "../src/remote-status"
import { fixture } from "./fixture"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

const startedEvent = (sessionID: string) => ({
  type: "session.execution.started",
  data: { sessionID },
})

/**
 * Inbox stub: `pending` is the authoritative pending list the host would
 * return, `gate` optionally holds a read open so a race can be driven
 * deterministically. Every entry mirrors the real projection shape (id, type).
 */
function inboxStub(options: {
  pending: () => Array<{ id: string; type: string }>
  gate?: (call: number) => Promise<void> | undefined
}) {
  let calls = 0
  const stub = {
    session: {
      inbox: {
        list: async () => {
          const call = ++calls
          const snapshot = options.pending()
          await options.gate?.(call)
          return snapshot
        },
      },
    },
  }
  return {
    client: stub as unknown as Parameters<typeof queueFrames>[1],
    calls: () => calls,
  }
}

const alive = () => true

test("statusFrames maps execution, retry, and rename events without invented fields", () => {
  // Busy.
  const busy = statusFrames(startedEvent("ses_a"))
  expect(busy).toHaveLength(1)
  expect(busy[0]).toEqual({
    type: "event",
    sessionId: "ses_a",
    event: "session.status",
    data: { sessionID: "ses_a", status: { type: "busy" } },
  })

  // Retry: attempt/next from the schedule, message from the real error.
  const retry = statusFrames({
    type: "session.retry.scheduled",
    data: { sessionID: "ses_a", attempt: 2, at: 5_000, error: { type: "api", message: "rate limited" } },
  })
  expect(retry[0]?.data).toEqual({
    sessionID: "ses_a",
    status: { type: "retry", attempt: 2, message: "rate limited", next: 5_000 },
  })

  // Rename: the title flows into the v1 session.updated info.
  const renamed = statusFrames({
    type: "session.renamed",
    data: { sessionID: "ses_a", title: "Renamed" },
  })
  expect(renamed[0]?.data).toEqual({ info: { id: "ses_a", title: "Renamed" } })

  // Interrupted is idle for the consumer, exactly like a clean finish.
  const interrupted = statusFrames({
    type: "session.execution.interrupted",
    data: { sessionID: "ses_a", reason: "user" },
  })
  expect(interrupted.map((frame) => frame.event)).toEqual(["session.status", "session.idle"])

  // The queue lane is not a pure mapping: inbox events only invalidate.
  expect(
    statusFrames({
      type: "session.inbox.enqueued",
      data: { sessionID: "ses_a", inboxID: "msg_q1", item: { type: "user" } },
    }),
  ).toHaveLength(0)
})

test("failed execution emits idle, session.idle, and the structured error without invented fields", () => {
  const frames = statusFrames({
    type: "session.execution.failed",
    data: { sessionID: "ses_f", error: { type: "run_error", message: "model transport failed" } },
  })
  expect(frames).toHaveLength(3)
  expect(frames[0]?.data).toEqual({ sessionID: "ses_f", status: { type: "idle" } })
  expect(frames[1]?.data).toEqual({ sessionID: "ses_f" })
  expect(frames[2]?.data).toEqual({
    sessionID: "ses_f",
    error: { name: "run_error", data: { message: "model transport failed" } },
  })
})

test("only user inbox transitions invalidate the advertised queue", () => {
  expect(
    invalidatesQueue({
      type: "session.inbox.enqueued",
      data: { sessionID: "ses_a", inboxID: "msg_q1", item: { type: "user" } },
    }),
  ).toBe(true)
  expect(
    invalidatesQueue({
      type: "session.inbox.enqueued",
      data: { sessionID: "ses_a", inboxID: "msg_s1", item: { type: "synthetic" } },
    }),
  ).toBe(false)
  // Delivery and cancellation carry no item type, so they always re-read; the
  // unchanged-snapshot check keeps synthetic consumption silent.
  expect(invalidatesQueue({ type: "session.inbox.delivered", data: { sessionID: "ses_a", inboxID: "msg_s1" } })).toBe(
    true,
  )
  expect(invalidatesQueue({ type: "session.inbox.cancelled", data: { sessionID: "ses_a", inboxID: "msg_s1" } })).toBe(
    true,
  )
  expect(invalidatesQueue({ type: "session.execution.started", data: { sessionID: "ses_a" } })).toBe(false)
})

test("advertises the exact authoritative FIFO past sixty-four items", async () => {
  const ids = Array.from({ length: 65 }, (_, index) => `msg_q${index}`)
  const stub = inboxStub({
    pending: () => [
      ...ids.map((id) => ({ id, type: "user" })),
      { id: "msg_compaction", type: "compaction" },
      { id: "msg_synthetic", type: "synthetic" },
    ],
  })
  const state = createRemoteStatus()
  const frames = await queueFrames(state, stub.client, "ses_big", alive)
  expect(frames).toHaveLength(1)
  // Exact ids, exact enqueue order, no truncation at any bound.
  expect(frames[0]?.data).toEqual({ sessionID: "ses_big", queued: ids })
  expect(state.advertised.get("ses_big")).toEqual(ids)

  // An unchanged re-read stays quiet; a replay always reconciles.
  expect(await queueFrames(state, stub.client, "ses_big", alive)).toHaveLength(0)
  const replay = await queueReplayFrames(state, stub.client, "ses_big", alive)
  expect(replay[0]?.data).toEqual({ sessionID: "ses_big", queued: ids })
})

test("a fresh or forgotten session advertises the full authoritative queue, never a partial one", async () => {
  const pending = [
    { id: "msg_first", type: "user" },
    { id: "msg_second", type: "user" },
    { id: "msg_third", type: "user" },
  ]
  const stub = inboxStub({ pending: () => pending })

  // Fresh adapter: a delivery is the first thing it ever sees for this session,
  // so the frame must still carry every pending id rather than the delta.
  const fresh = createRemoteStatus()
  const delivered = await queueFrames(fresh, stub.client, "ses_fresh", alive)
  expect(delivered[0]?.data).toEqual({
    sessionID: "ses_fresh",
    queued: ["msg_first", "msg_second", "msg_third"],
  })

  // Lifecycle drop (unsubscribe) clears both maps together; the next
  // invalidation re-reads the source of truth instead of rebuilding from empty.
  forgetSession(fresh, "ses_fresh")
  expect(fresh.advertised.has("ses_fresh")).toBe(false)
  expect(fresh.applied.has("ses_fresh")).toBe(false)
  pending.push({ id: "msg_fourth", type: "user" })
  const recovered = await queueFrames(fresh, stub.client, "ses_fresh", alive)
  expect(recovered[0]?.data).toEqual({
    sessionID: "ses_fresh",
    queued: ["msg_first", "msg_second", "msg_third", "msg_fourth"],
  })
})

test("a delivery during an in-flight read never resurrects the delivered id", async () => {
  const released = Promise.withResolvers<void>()
  let pending = [
    { id: "msg_held_a", type: "user" },
    { id: "msg_held_b", type: "user" },
  ]
  const stub = inboxStub({
    pending: () => pending,
    // Call one is the subscribe replay: it snapshots [a, b] and then waits.
    gate: (call) => (call === 1 ? released.promise : undefined),
  })
  const state = createRemoteStatus()
  const held = queueReplayFrames(state, stub.client, "ses_race", alive)
  await Bun.sleep(5)

  // The delivery lands while the replay read is still held: its own read sees
  // the post-delivery truth and applies first.
  pending = [{ id: "msg_held_b", type: "user" }]
  const afterDelivery = await queueFrames(state, stub.client, "ses_race", alive)
  expect(afterDelivery[0]?.data).toEqual({ sessionID: "ses_race", queued: ["msg_held_b"] })

  released.resolve()
  // The overtaken replay snapshot is dropped: no frame, and the advertised
  // queue keeps the newer truth, so msg_held_a is never re-advertised.
  expect(await held).toHaveLength(0)
  expect(state.advertised.get("ses_race")).toEqual(["msg_held_b"])
  expect(stub.calls()).toBe(2)
})

test("an enqueue during an in-flight read is not shrunk back by the stale snapshot", async () => {
  const released = Promise.withResolvers<void>()
  let pending = [{ id: "msg_race_a", type: "user" }]
  const stub = inboxStub({
    pending: () => pending,
    gate: (call) => (call === 1 ? released.promise : undefined),
  })
  const state = createRemoteStatus()
  const held = queueReplayFrames(state, stub.client, "ses_grow", alive)
  await Bun.sleep(5)

  pending = [
    { id: "msg_race_a", type: "user" },
    { id: "msg_race_b", type: "user" },
  ]
  const afterEnqueue = await queueFrames(state, stub.client, "ses_grow", alive)
  expect(afterEnqueue[0]?.data).toEqual({ sessionID: "ses_grow", queued: ["msg_race_a", "msg_race_b"] })

  released.resolve()
  expect(await held).toHaveLength(0)
  expect(state.advertised.get("ses_grow")).toEqual(["msg_race_a", "msg_race_b"])
})

test("an epoch or transport change during the read cancels the advertisement", async () => {
  const released = Promise.withResolvers<void>()
  let active = true
  const stub = inboxStub({
    pending: () => [{ id: "msg_stale", type: "user" }],
    gate: (call) => (call === 1 ? released.promise : undefined),
  })
  const state = createRemoteStatus()
  const held = queueReplayFrames(state, stub.client, "ses_gone", () => active)
  await Bun.sleep(5)
  // Unsubscribe / resubscribe / reconnect: the guard the caller passes goes
  // false while the read is in flight.
  active = false
  released.resolve()
  expect(await held).toHaveLength(0)
  expect(state.advertised.has("ses_gone")).toBe(false)
  expect(state.applied.has("ses_gone")).toBe(false)
})

test("root-id cancellation discovers an owner past a page of siblings", async () => {
  // 40 same-location children of the subscribed root, served in pages of 15, so
  // the walk must follow the cursor; the pending item sits on the 37th, past any
  // breadth cap a bounded walk would have applied.
  const children = Array.from({ length: 40 }, (_, index) => ({
    id: `ses_child_${index}`,
    location: { directory: "/cwd" },
  }))
  const moved = { id: "ses_moved", location: { directory: "/elsewhere" } }
  const owner = "ses_child_36"
  const pending: Record<string, Array<{ id: string; type: string }>> = {
    [owner]: [{ id: "msg_deep", type: "user" }],
    // A moved child holds the same id: it must never be redirected to.
    [moved.id]: [{ id: "msg_moved_only", type: "user" }],
    ses_root: [{ id: "msg_root_pending", type: "user" }],
  }
  const listCalls: string[] = []
  const client = {
    session: {
      inbox: { list: async (input: { sessionID: string }) => pending[input.sessionID] ?? [] },
      list: async (input: { parentID?: string; cursor?: string }) => {
        listCalls.push(`${input.parentID}:${input.cursor ?? "0"}`)
        if (input.parentID !== "ses_root") return { data: [], cursor: { next: null } }
        const offset = input.cursor === undefined ? 0 : Number(input.cursor)
        const all = [...children, moved]
        const page = all.slice(offset, offset + 15)
        const next = offset + 15 < all.length ? String(offset + 15) : null
        return { data: page, cursor: { next } }
      },
    },
  } as unknown as Parameters<typeof resolveQueueOwner>[1]
  const ctx = { location: { directory: "/cwd" } } as unknown as Parameters<typeof resolveQueueOwner>[0]

  // The root's own pending id resolves without any descendant listing.
  expect(await Effect.runPromise(resolveQueueOwner(ctx, client, "ses_root", "msg_root_pending"))).toBe("ses_root")
  expect(listCalls).toHaveLength(0)

  // The deep sibling is discovered by exact id.
  expect(await Effect.runPromise(resolveQueueOwner(ctx, client, "ses_root", "msg_deep"))).toBe(owner)
  expect(listCalls.filter((call) => call.startsWith("ses_root:"))).toEqual(["ses_root:0", "ses_root:15", "ses_root:30"])

  // A moved child is out of this location's reach, and an unknown id is refused.
  expect(await Effect.runPromise(resolveQueueOwner(ctx, client, "ses_root", "msg_moved_only"))).toBeUndefined()
  expect(await Effect.runPromise(resolveQueueOwner(ctx, client, "ses_root", "msg_absent"))).toBeUndefined()
})

test("streams status, idle, and rename frames through a real host", async () => {
  await using input = await fixture()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  let socket: { send(data: string): void } | undefined
  let remoteClient: ReturnType<typeof createClient> | undefined
  const statusModelServer = createStatusModelServer()

  const relay = createRelay(frames, opened)
  const location = { directory: process.cwd() }
  const layout = statusLayout(input, "status")
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: statusConfig(statusModelServer.url.origin),
            plugins: [
              createRemoteSessionPlugin({
                relayURL: `http://127.0.0.1:${relay.port}`,
                bearerToken: "fixture-bearer",
                client: () => {
                  if (!remoteClient) throw new Error("remote client unavailable before activation")
                  return remoteClient
                },
                allowHttpLoopback: true,
              }),
            ],
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          remoteClient = client
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Relay status",
              location,
              agent: "build",
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          // Address this location's adapter explicitly: its heartbeat is what
          // identifies which socket owns the session.
          socket = yield* Effect.promise(() => awaitValue(() => Promise.resolve(relay.socketFor(session.id))))
          socket.send(JSON.stringify({ type: "subscribe", sessionId: session.id }))

          // A public prompt drives the full consumer-shaped lifecycle:
          // queue.changed (enqueued) → status busy → delivered → queue.changed
          // (empty) → status idle + session.idle.
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "status probe" }))
          const busyFrame = yield* Effect.promise(() =>
            awaitValue(
              () => Promise.resolve(statusFrame(frames, session.id, "busy")),
              () => JSON.stringify(frames.slice(-6)),
            ),
          )
          expect(busyFrame).toBeDefined()
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          // An immediately delivered prompt is never "queued": the advertised
          // snapshot is a read of the pending projection, so it reports empty
          // rather than an optimistic id the host no longer has pending.
          const drained = yield* Effect.promise(() =>
            awaitValue(
              () => Promise.resolve(queueFramesFor(frames, session.id).at(-1)),
              () => JSON.stringify(frames.slice(-6)),
            ),
          )
          expect(drained).toEqual([])
          const idleFrame = yield* Effect.promise(() =>
            awaitValue(() => Promise.resolve(statusFrame(frames, session.id, "idle"))),
          )
          expect(idleFrame).toBeDefined()
          const idleEvent = yield* Effect.promise(() =>
            awaitValue(
              () => {
                const candidates = eventFrames(frames, "session.idle").filter(
                  (frame) => (frame as Record<string, unknown>).sessionId === session.id,
                )
                return Promise.resolve(candidates.at(-1))
              },
              () => JSON.stringify(eventFrames(frames, "session.idle").concat(frames.slice(-4))),
            ),
          )
          expect(idleEvent).toBeDefined()

          // Rename through the public API: the v1 session.updated info frame
          // carries the real title.
          yield* Effect.promise(() => client.session.rename({ sessionID: session.id, title: "Status renamed" }))
          const updatedFrame = yield* Effect.promise(() =>
            awaitValue(() => {
              const candidates = eventFrames(frames, "session.updated").filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).info) &&
                  (((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<string, unknown>)
                    .title === "Status renamed",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(updatedFrame).toBeDefined()

          // Ownership: an unsubscribed session's execution emits nothing.
          const foreign = yield* Effect.promise(() => client.session.create({ title: "Foreign status", location }))
          yield* Effect.promise(() => client.session.prompt({ sessionID: foreign.id, text: "unsubscribed run" }))
          yield* Effect.promise(() => Bun.sleep(300))
          const foreignStatus = eventFrames(frames, "session.status").filter(
            (frame) => (frame as Record<string, unknown>).sessionId === foreign.id,
          )
          expect(foreignStatus).toHaveLength(0)
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await statusModelServer.stop(true)
  }
}, 30_000)

test("replays and cancels a queue item this adapter never admitted", async () => {
  await using input = await fixture()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  let socket: { send(data: string): void } | undefined
  let remoteClient: ReturnType<typeof createClient> | undefined
  const statusModelServer = createStatusModelServer()

  const relay = createRelay(frames, opened)
  const location = { directory: process.cwd() }
  const layout = statusLayout(input, "cancel")
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: statusConfig(statusModelServer.url.origin),
            plugins: [
              createRemoteSessionPlugin({
                relayURL: `http://127.0.0.1:${relay.port}`,
                bearerToken: "fixture-bearer",
                client: () => {
                  if (!remoteClient) throw new Error("remote client unavailable before activation")
                  return remoteClient
                },
                allowHttpLoopback: true,
              }),
            ],
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          remoteClient = client
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Relay cancel",
              location,
              agent: "build",
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          socket = yield* Effect.promise(() => awaitValue(() => Promise.resolve(relay.socketFor(session.id))))

          // Another client admits pending input before this adapter subscribes:
          // admit-only, so the item stays durably pending and no execution runs.
          const admitted = yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "queued elsewhere", resume: false }),
          )
          const listed = yield* Effect.promise(() => client.session.inbox.list({ sessionID: session.id }))
          expect(listed.map((item) => item.id)).toEqual([admitted.id])

          // Subscribe replay reconciles the exact pending id, with no live
          // enqueue event of its own to rebuild from.
          socket.send(JSON.stringify({ type: "subscribe", sessionId: session.id }))
          const replayed = yield* Effect.promise(() =>
            awaitValue(
              () => Promise.resolve(queueFramesFor(frames, session.id).find((queued) => queued.includes(admitted.id))),
              () => JSON.stringify(frames.slice(-6)),
            ),
          )
          expect(replayed).toEqual([admitted.id])

          // Live lane, same authoritative read: a second admit-only item is
          // advertised as the exact FIFO of both pending ids, in enqueue order.
          const second = yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "queued second", resume: false }),
          )
          const both = yield* Effect.promise(() =>
            awaitValue(
              () => Promise.resolve(queueFramesFor(frames, session.id).find((queued) => queued.length === 2)),
              () => JSON.stringify(queueFramesFor(frames, session.id)),
            ),
          )
          expect(both).toEqual([admitted.id, second.id])
          socket.send(
            JSON.stringify({
              type: "command",
              id: "cancel-second",
              command: "drop_queued_message",
              sessionId: session.id,
              data: { messageID: second.id },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitValue(() => Promise.resolve(response(frames, "cancel-second")))),
          ).toEqual({ type: "response", id: "cancel-second", result: {} })

          // Cancelling it succeeds even though this adapter never admitted it:
          // ownership is resolved from the real pending inbox.
          socket.send(
            JSON.stringify({
              type: "command",
              id: "cancel-foreign-admit",
              command: "drop_queued_message",
              sessionId: session.id,
              data: { messageID: admitted.id },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitValue(() => Promise.resolve(response(frames, "cancel-foreign-admit")))),
          ).toEqual({ type: "response", id: "cancel-foreign-admit", result: {} })
          expect(yield* Effect.promise(() => client.session.inbox.list({ sessionID: session.id }))).toEqual([])
          // The cancellation is advertised as an empty authoritative queue.
          yield* Effect.promise(() =>
            awaitValue(() =>
              Promise.resolve(queueFramesFor(frames, session.id).at(-1)?.length === 0 ? true : undefined),
            ),
          )

          // Re-cancelling a no-longer-pending id is refused.
          socket.send(
            JSON.stringify({
              type: "command",
              id: "cancel-again",
              command: "drop_queued_message",
              sessionId: session.id,
              data: { messageID: admitted.id },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitValue(() => Promise.resolve(response(frames, "cancel-again")))),
          ).toEqual({ type: "response", id: "cancel-again", error: "message not queued" })

          // A foreign-location session is refused even for a genuinely pending
          // id: the command session must belong to this adapter's location.
          const foreign = yield* Effect.promise(() =>
            client.session.create({
              title: "Foreign cancel",
              location: { directory: input.directory },
              agent: "build",
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          // The fixture temp directory is a real, different location: the guard
          // must be refusing on location, not on a fallback that collapsed to
          // this adapter's own directory.
          expect(foreign.location.directory).not.toBe(location.directory)
          const foreignAdmitted = yield* Effect.promise(() =>
            client.session.prompt({ sessionID: foreign.id, text: "queued elsewhere", resume: false }),
          )
          socket.send(
            JSON.stringify({
              type: "command",
              id: "cancel-foreign-location",
              command: "drop_queued_message",
              sessionId: foreign.id,
              data: { messageID: foreignAdmitted.id },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitValue(() => Promise.resolve(response(frames, "cancel-foreign-location")))),
          ).toEqual({ type: "response", id: "cancel-foreign-location", error: "message not queued" })
          // Refused, not executed: the item is still pending on the host.
          expect(
            (yield* Effect.promise(() => client.session.inbox.list({ sessionID: foreign.id }))).map((item) => item.id),
          ).toEqual([foreignAdmitted.id])
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await statusModelServer.stop(true)
  }
}, 30_000)

test("an unsubscribe during a held live queue read publishes nothing", async () => {
  await using input = await fixture()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  let socket: { send(data: string): void } | undefined
  let remoteClient: ReturnType<typeof createClient> | undefined
  let wrapped: ReturnType<typeof createClient> | undefined
  let hold: PromiseWithResolvers<void> | undefined
  let held = 0
  const statusModelServer = createStatusModelServer()

  const relay = createRelay(frames, opened)
  const location = { directory: process.cwd() }
  const layout = statusLayout(input, "hold")
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: statusConfig(statusModelServer.url.origin),
            plugins: [
              createRemoteSessionPlugin({
                relayURL: `http://127.0.0.1:${relay.port}`,
                bearerToken: "fixture-bearer",
                client: () => {
                  if (!remoteClient) throw new Error("remote client unavailable before activation")
                  const real = remoteClient
                  if (!wrapped) {
                    wrapped = {
                      ...real,
                      session: {
                        ...real.session,
                        inbox: {
                          ...real.session.inbox,
                          // The barrier holds the adapter's authoritative read
                          // open so the subscription can end mid-read.
                          list: async (listInput: Parameters<typeof real.session.inbox.list>[0]) => {
                            const barrier = hold
                            if (barrier) {
                              held += 1
                              await barrier.promise
                            }
                            return real.session.inbox.list(listInput)
                          },
                        },
                      },
                    } as unknown as ReturnType<typeof createClient>
                  }
                  return wrapped
                },
                allowHttpLoopback: true,
              }),
            ],
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          remoteClient = client
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Relay hold",
              location,
              agent: "build",
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          socket = yield* Effect.promise(() => awaitValue(() => Promise.resolve(relay.socketFor(session.id))))
          socket.send(JSON.stringify({ type: "subscribe", sessionId: session.id }))

          const first = yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "queued first", resume: false }),
          )
          const advertised = yield* Effect.promise(() =>
            awaitValue(
              () => Promise.resolve(queueFramesFor(frames, session.id).find((queued) => queued.length === 1)),
              () => JSON.stringify(frames.slice(-6)),
            ),
          )
          expect(advertised).toEqual([first.id])

          // Hold every read, then admit a second item so the live invalidation
          // blocks inside the adapter with the subscription still current.
          hold = Promise.withResolvers<void>()
          const second = yield* Effect.promise(() =>
            client.session.prompt({ sessionID: session.id, text: "queued second", resume: false }),
          )
          yield* Effect.promise(() => awaitValue(() => Promise.resolve(held >= 1 ? true : undefined)))

          // Unsubscribe and resubscribe while that read is still in flight: the
          // subscription epoch moves, and the resubscribe issues its own read
          // (also held). Membership alone cannot tell the two apart — only the
          // captured epoch can.
          const mark = frames.length
          socket.send(JSON.stringify({ type: "unsubscribe", sessionId: session.id }))
          socket.send(JSON.stringify({ type: "subscribe", sessionId: session.id }))
          yield* Effect.promise(() => awaitValue(() => Promise.resolve(held >= 2 ? true : undefined)))
          hold.resolve()
          hold = undefined
          yield* Effect.promise(() => Bun.sleep(250))

          // Exactly one reconciliation for the new subscription: the read that
          // belonged to the superseded one is discarded rather than published.
          const after = frames
            .slice(mark)
            .filter(
              (frame) =>
                isRecord(frame) &&
                frame.type === "event" &&
                frame.event === "session.queue.changed" &&
                isRecord(frame.data) &&
                frame.data.sessionID === session.id,
            )
          expect(after).toHaveLength(1)
          expect(
            (isRecord(after[0]) ? ((after[0].data as Record<string, unknown>).queued as string[]) : []).slice(),
          ).toEqual([first.id, second.id])
          // Suppression is a publish decision, not a mutation: both items are
          // still pending on the host, in enqueue order.
          expect(
            (yield* Effect.promise(() => client.session.inbox.list({ sessionID: session.id }))).map((item) => item.id),
          ).toEqual([first.id, second.id])
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await statusModelServer.stop(true)
  }
}, 30_000)

function statusConfig(modelOrigin: string) {
  return JSON.stringify({
    model: "fixture/chat",
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `${modelOrigin}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
}

function statusLayout(input: { home: string; directory: string }, prefix: string): Layout {
  return {
    channel: "interactive",
    paths: {
      home: path.join(input.home),
      data: path.join(input.directory, `${prefix}-data`),
      config: path.join(input.directory, `${prefix}-config`),
      cache: path.join(input.directory, `${prefix}-cache`),
      state: path.join(input.directory, `${prefix}-state`),
      tmp: path.join(input.directory, `${prefix}-tmp`),
      bin: path.join(input.directory, `${prefix}-cache`, "bin"),
      log: path.join(input.directory, `${prefix}-data`, "log"),
      repos: path.join(input.directory, `${prefix}-data`, "repos"),
    },
    roots: [],
    database: path.join(input.directory, `${prefix}-data`, "kilo2.db"),
    config: path.join(input.directory, `${prefix}-config`, "kilo.jsonc"),
    tuiConfig: path.join(input.directory, `${prefix}-config`, "tui.json"),
    telemetryConfig: path.join(input.directory, `${prefix}-config`, "telemetry.json"),
    password: path.join(input.directory, `${prefix}-state`, "server.password"),
    pty: path.join(input.directory, `${prefix}-tmp`, "pty"),
  }
}

interface RelayHarness {
  readonly port: number
  stop(force: boolean): Promise<void>
  /**
   * The adapter socket that owns a session, identified by the heartbeat it
   * publishes for its own location. A host with sessions in two locations runs
   * two adapters on one relay, so commands must be addressed deliberately.
   */
  socketFor(sessionID: string): { send(data: string): void } | undefined
}

function createRelay(frames: unknown[], opened: PromiseWithResolvers<void>): RelayHarness {
  const connections: Array<{ socket: { send(data: string): void }; frames: unknown[] }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, upgrade) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/user/cli") return new Response(null, { status: 404 })
      if (upgrade.upgrade(request)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open() {
        opened.resolve()
      },
      message(ws, message) {
        const parsed = JSON.parse(String(message))
        frames.push(parsed)
        const existing = connections.find((entry) => entry.socket === ws)
        if (existing) existing.frames.push(parsed)
        else connections.push({ socket: ws, frames: [parsed] })
      },
    },
  })
  return {
    port: server.port ?? 0,
    stop: (force: boolean) => server.stop(force),
    socketFor: (sessionID: string) =>
      connections.find((entry) =>
        entry.frames.some(
          (frame) =>
            isRecord(frame) &&
            frame.type === "heartbeat" &&
            Array.isArray(frame.sessions) &&
            frame.sessions.some((session) => isRecord(session) && session.id === sessionID),
        ),
      )?.socket,
  }
}

function eventFrames(frames: unknown[], event: string) {
  return frames.filter((frame) => isRecord(frame) && frame.type === "event" && frame.event === event)
}

/** Every advertised queue list for a session, in arrival order. */
function queueFramesFor(frames: unknown[], sessionID: string): string[][] {
  return eventFrames(frames, "session.queue.changed")
    .filter((frame) => isRecord(frame) && isRecord(frame.data) && frame.data.sessionID === sessionID)
    .map((frame) => ((frame as Record<string, unknown>).data as Record<string, unknown>).queued as string[])
}

function statusFrame(frames: unknown[], sessionID: string, type: string) {
  return eventFrames(frames, "session.status")
    .filter(
      (frame) =>
        isRecord(frame) &&
        isRecord(frame.data) &&
        frame.data.sessionID === sessionID &&
        isRecord(frame.data.status) &&
        frame.data.status.type === type,
    )
    .at(-1)
}

function response(frames: unknown[], id: string) {
  return frames.find((frame) => isRecord(frame) && frame.type === "response" && frame.id === id)
}

async function awaitValue<T>(produce: () => Promise<T | undefined>, dump?: () => string): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await produce()
    if (value !== undefined) return value as T
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for relay frame; ${dump?.() ?? ""}`)
}

function createStatusModelServer() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = (await request.json()) as { messages: Array<{ role: string; content?: unknown }> }
      const delta =
        body.messages.at(-1)?.role === "tool" || JSON.stringify(body.messages).includes("title generator")
          ? { role: "assistant", content: "Status complete" }
          : { role: "assistant", content: "Status working" }
      return new Response(
        [
          { choices: [{ index: 0, delta, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ]
          .map(
            (frame) =>
              `data: ${JSON.stringify({ id: "status-model", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
}
