// kilocode_change - new file
// Locally started CLI sessions (kilo run, TUI) must appear in the mobile app's
// live list the same way app-spawned (create_session) sessions do: the relay's
// per-connection registry is fed only by heartbeat attached ids, so a locally
// created session must be announced on the remote connection when its first
// turn opens (KiloSessions.attachRemoteSession) and detached when the session
// is disposed. These tests drive the real watcher registration (the KiloSessions
// layer state installed by init) through GlobalBus session events plus the real
// enableRemote/AttachedState path, with only the relay socket faked.

// kilo-sessions reads KILO_DISABLE_SESSION_INGEST and KILO_REMOTE at module
// load. Set them before the first import: keep ingest enabled so the layer
// state installs its watchers, and keep bootstrap auto-enable off so every
// test enables remote explicitly.
process.env["KILO_DISABLE_SESSION_INGEST"] = "0"
delete process.env["KILO_REMOTE"]

import { afterEach, beforeEach, describe, expect, mock, spyOn } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Fiber, Layer } from "effect"
import { Auth } from "../../../src/auth"
import { Bus } from "../../../src/bus"
import { GlobalBus } from "../../../src/bus/global"
import type { Config } from "../../../src/config/config"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import { provide } from "../../../src/kilocode/instance"
import { RemoteSender } from "../../../src/kilo-sessions/remote-sender"
import { RemoteWS } from "../../../src/kilo-sessions/remote-ws"
import { Session } from "../../../src/session/session"
import { SessionID } from "../../../src/session/schema"
import { TestConfig } from "../../fixture/config"
import { TestInstance, tmpdir } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const { KiloSessions } = await import("../../../src/kilo-sessions/kilo-sessions")

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

// Mirrors the KiloSessions layer wiring used by test/kilocode/kilo-sessions.test.ts:
// real Bus/Session/Config graph, TestConfig so `init` does not read real config.
function layer(overrides: Partial<Config.Interface> = {}) {
  return Layer.merge(
    KiloSessions.layer.pipe(
      Layer.provideMerge(Bus.layer),
      Layer.provide(TestConfig.layer(overrides)),
      Layer.provide(AppNodeBuilder.build(Session.node)),
    ),
    AppNodeBuilder.build(Auth.node),
  )
}

function reset(...tokens: string[]) {
  clearInFlightCache("kilo-sessions:token")
  clearInFlightCache("kilo-sessions:client")
  for (const token of tokens) clearInFlightCache(`kilo-sessions:token-valid:${token}`)
}

const token = "local-announce-token"

describe("KiloSessions locally started session announce", () => {
  type Beat = { requireSessionId?: string; detachSessionId?: string }
  let beats: Beat[] = []
  // Per-test heartbeat behavior; resolved synchronously by default so the
  // attachedState announce/detach fences pass. Tests override it to inject
  // relay failures.
  let heartbeatImpl: (opts?: Beat) => Promise<void>
  // When set, /api/user responses block on this promise so a test can hold
  // enableRemote in flight (the bootstrap auto-enable race).
  let userGate: Promise<void> | undefined

  const ENV_KEYS = ["KILO_API_KEY", "KILO_SESSION_INGEST_URL", "KILO_DISABLE_SESSION_INGEST"] as const
  const envSnap = new Map<string, string | undefined>()

  function snapEnv() {
    for (const key of ENV_KEYS) {
      if (!envSnap.has(key)) envSnap.set(key, process.env[key])
    }
  }

  function restoreEnv() {
    for (const [key, value] of envSnap) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    envSnap.clear()
  }

  beforeEach(() => {
    beats = []
    heartbeatImpl = async () => {}
    userGate = undefined
    snapEnv()
    process.env["KILO_API_KEY"] = token
    // Point every accidental ingest flush at a closed local port. The
    // synthetic session ids below are never bootstrapped (no session_share
    // row), so ingest drops their items anyway; this keeps even a leaked
    // flush retry off the real relay.
    process.env["KILO_SESSION_INGEST_URL"] = "http://127.0.0.1:9"
    process.env["KILO_DISABLE_SESSION_INGEST"] = "0"
    reset(token)
    KiloSessions.resetInstanceAdvertisementForTests()

    spyOn(RemoteSender, "create").mockImplementation(
      () =>
        ({
          handle() {},
          dispose() {},
        }) as RemoteSender.Sender,
    )
    spyOn(RemoteWS, "connect").mockImplementation(
      () =>
        ({
          connectionId: "test-conn",
          send() {},
          heartbeat: (opts?: Beat) => {
            beats.push(opts ?? {})
            return heartbeatImpl(opts)
          },
          close() {},
          get connected() {
            return true
          },
        }) as RemoteWS.Connection,
    )

    globalThis.fetch = mock(async (input) => {
      const url = String(input)
      if (url.endsWith("/api/user")) {
        if (userGate) await userGate
        return new Response(null, { status: 200 })
      }
      throw new Error(`unexpected fetch in test: ${url}`)
    }) as unknown as typeof fetch
  })

  afterEach(async () => {
    // disableRemote() reads Instance.current (via Bus.publish's argument),
    // which requires an active instance context — provide a throwaway one so
    // cleanup does not throw regardless of which test ran.
    const pub = spyOn(Bus, "publish").mockResolvedValue(undefined as never)
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        KiloSessions.disableRemote()
      },
    })
    pub.mockRestore()
    mock.restore()
    restoreEnv()
    reset(token)
  })

  // enableRemote()'s async body touches Instance.current/directory after its
  // first await, so it needs the instance AsyncLocalStorage context for its
  // whole lifetime. `it.instance` only provides InstanceRef as an Effect
  // service, not the ASL context — wrap enableRemote in the ASL-providing
  // `provide` (as the setInstanceAdvertisement/detach-fence tests do).
  const enable = (directory: string) =>
    Effect.promise(() => provide({ directory, fn: async () => KiloSessions.enableRemote() }))

  let eventId = 0
  function emit(directory: string, type: string, properties: unknown) {
    GlobalBus.emit("event", {
      directory,
      payload: {
        id: `evt-local-announce-${++eventId}`,
        type,
        properties,
      },
    })
  }

  const turnOpen = (directory: string, sessionID: string) =>
    emit(directory, Session.Event.TurnOpen.type, { sessionID })
  const turnClose = (directory: string, sessionID: string) =>
    emit(directory, Session.Event.TurnClose.type, { sessionID, reason: "completed" })
  const sessionDeleted = (directory: string, sessionID: string) =>
    emit(directory, Session.Event.Deleted.type, { sessionID })

  const announced = (sessionID: string) => beats.filter((b) => b.requireSessionId === sessionID).length
  const detached = (sessionID: string) => beats.filter((b) => b.detachSessionId === sessionID).length

  it.instance(
    "first turn announces a locally started session to the remote connection",
    () => {
      const id = SessionID.descending("ses_local_announce_first_turn")
      return Effect.gen(function* () {
        const instance = yield* TestInstance
        const kilo = yield* KiloSessions.Service
        yield* kilo.init()
        yield* enable(instance.directory)
        expect(KiloSessions.remoteStatus()).toEqual({ enabled: true, connected: true })

        turnOpen(instance.directory, id)
        yield* pollWithTimeout(
          Effect.sync(() => (announced(id) >= 1 ? true : undefined)),
          "local session announce heartbeat never fired",
        )
        // The relay's live-list registry is fed from the attach heartbeat
        // (requireSessionId fence), so exactly one such beat means the id is
        // registered on the connection.
        expect(beats.some((b) => b.requireSessionId === id)).toBe(true)
        expect(KiloSessions.hasRemoteSession(id)).toBe(true)
      }).pipe(Effect.provide(layer()))
    },
    15000,
  )

  it.instance(
    "announce is idempotent: repeated turns keep one heartbeat and a turn close stays attached",
    () => {
      const id = SessionID.descending("ses_local_announce_idempotent")
      return Effect.gen(function* () {
        const instance = yield* TestInstance
        const kilo = yield* KiloSessions.Service
        yield* kilo.init()
        yield* enable(instance.directory)

        turnOpen(instance.directory, id)
        yield* pollWithTimeout(
          Effect.sync(() => (announced(id) >= 1 ? true : undefined)),
          "first announce heartbeat never fired",
        )

        // Second and third turns on the same session: the pending id is
        // already attached, so no further announce heartbeats fire.
        turnOpen(instance.directory, id)
        turnOpen(instance.directory, id)
        yield* Effect.sleep(250)
        expect(announced(id)).toBe(1)

        // A completed turn must NOT detach: like app-spawned sessions, an
        // idle local session stays in the live list until it is disposed.
        turnClose(instance.directory, id)
        yield* Effect.sleep(150)
        expect(detached(id)).toBe(0)
        expect(KiloSessions.hasRemoteSession(id)).toBe(true)
      }).pipe(Effect.provide(layer()))
    },
    15000,
  )

  it.instance("no announce and no attach when remote is disabled", () => {
    const id = SessionID.descending("ses_local_announce_disabled")
    return Effect.gen(function* () {
      const instance = yield* TestInstance
      const kilo = yield* KiloSessions.Service
      yield* kilo.init()

      turnOpen(instance.directory, id)
      turnOpen(instance.directory, id)
      yield* Effect.sleep(250)
      expect(beats).toHaveLength(0)
      expect(KiloSessions.hasRemoteSession(id)).toBe(false)
    }).pipe(Effect.provide(layer()))
  })

  it.instance(
    "a first turn that races bootstrap remote enable waits for the in-flight enable and still announces",
    () => {
      const id = SessionID.descending("ses_local_announce_race")
      return Effect.gen(function* () {
        const instance = yield* TestInstance
        const kilo = yield* KiloSessions.Service
        yield* kilo.init()

        let release: () => void = () => {}
        userGate = new Promise<void>((resolve) => {
          release = resolve
        })

        // enableRemote() reaches authValid() and parks there; `remote` is
        // still undefined while `enabling` is in flight. Fork the
        // ASL-wrapped enable so the main fiber can interleave the turn while
        // the enable is parked.
        const enableFiber = yield* enable(instance.directory).pipe(Effect.forkScoped)
        yield* pollWithTimeout(
          Effect.sync(() => (KiloSessions.remoteStatus().enabled ? true : undefined)),
          "enableRemote never entered",
        )
        expect(KiloSessions.remoteStatus()).toEqual({ enabled: true, connected: false })

        turnOpen(instance.directory, id)
        // Give the announce handler time to park on the in-flight enable.
        yield* Effect.sleep(100)
        expect(beats).toHaveLength(0)

        release()
        yield* Fiber.join(enableFiber)
        yield* pollWithTimeout(
          Effect.sync(() => (announced(id) >= 1 ? true : undefined)),
          "announce after in-flight enable never fired",
        )
        expect(KiloSessions.hasRemoteSession(id)).toBe(true)
      }).pipe(Effect.provide(layer()))
    },
    15000,
  )

  it.instance(
    "delete during in-flight enable does not attach the dead session",
    () => {
      const id = SessionID.descending("ses_local_announce_delete_during_enable")
      return Effect.gen(function* () {
        const instance = yield* TestInstance
        const kilo = yield* KiloSessions.Service
        yield* kilo.init()

        let release: () => void = () => {}
        userGate = new Promise<void>((resolve) => {
          release = resolve
        })

        // Park enableRemote() in authValid(); `remote` stays undefined while
        // `enabling` is in flight, so the announce awaits the enable.
        const enableFiber = yield* enable(instance.directory).pipe(Effect.forkScoped)
        yield* pollWithTimeout(
          Effect.sync(() => (KiloSessions.remoteStatus().enabled ? true : undefined)),
          "enableRemote never entered",
        )
        expect(KiloSessions.remoteStatus()).toEqual({ enabled: true, connected: false })

        // First turn parks the announce on the in-flight enable.
        turnOpen(instance.directory, id)
        yield* Effect.sleep(100)
        expect(beats).toHaveLength(0)

        // The session is deleted while the announce awaits enable. detach must
        // cancel the pending announce (not no-op), otherwise the announce
        // attaches the dead session once enable resolves and it leaks forever.
        sessionDeleted(instance.directory, id)
        yield* Effect.sleep(100)
        expect(beats).toHaveLength(0)

        release()
        yield* Fiber.join(enableFiber)
        yield* Effect.sleep(150)
        // The dead session was never announced (no attach beat) and never
        // detached (it was never attached), so it is not in the live list.
        expect(announced(id)).toBe(0)
        expect(detached(id)).toBe(0)
        expect(KiloSessions.hasRemoteSession(id)).toBe(false)
      }).pipe(Effect.provide(layer()))
    },
    15000,
  )

  it.instance(
    "announce heartbeat failure rolls the attach back and the next turn retries",
    () => {
      const id = SessionID.descending("ses_local_announce_retry")
      let attachAttempts = 0
      heartbeatImpl = (opts) => {
        if (opts?.requireSessionId === id && attachAttempts++ === 0) {
          return Promise.reject(new Error("relay unreachable"))
        }
        return Promise.resolve()
      }

      return Effect.gen(function* () {
        const instance = yield* TestInstance
        const kilo = yield* KiloSessions.Service
        yield* kilo.init()
        yield* enable(instance.directory)

        turnOpen(instance.directory, id)
        yield* pollWithTimeout(
          Effect.sync(() => (announced(id) >= 1 ? true : undefined)),
          "failed announce attempt never hit the heartbeat",
        )
        // The failure rolled the pending announcement back, so the session is
        // not falsely reported as attached.
        yield* Effect.sleep(150)
        expect(KiloSessions.hasRemoteSession(id)).toBe(false)

        // The announce failure is retryable: a later turn re-announces and
        // this time the relay accepts the attach.
        turnOpen(instance.directory, id)
        yield* pollWithTimeout(
          Effect.sync(() => (announced(id) >= 2 ? true : undefined)),
          "announce retry never fired",
        )
        expect(KiloSessions.hasRemoteSession(id)).toBe(true)
      }).pipe(Effect.provide(layer()))
    },
    15000,
  )

  it.instance(
    "dispose detaches an announced local session and is a no-op for an unowned id",
    () => {
      const id = SessionID.descending("ses_local_announce_detach")
      const unowned = SessionID.descending("ses_local_announce_detach_unowned")
      return Effect.gen(function* () {
        const instance = yield* TestInstance
        const kilo = yield* KiloSessions.Service
        yield* kilo.init()
        yield* enable(instance.directory)

        turnOpen(instance.directory, id)
        yield* pollWithTimeout(
          Effect.sync(() => (announced(id) >= 1 ? true : undefined)),
          "announce before detach never fired",
        )
        expect(KiloSessions.hasRemoteSession(id)).toBe(true)

        sessionDeleted(instance.directory, id)
        yield* pollWithTimeout(
          Effect.sync(() => (detached(id) >= 1 ? true : undefined)),
          "detach heartbeat never fired",
        )
        expect(KiloSessions.hasRemoteSession(id)).toBe(false)

        // Deleting a session this instance never announced must not fire a
        // detach heartbeat (e.g. an app-spawned session removed after its
        // exit_cli already detached it).
        sessionDeleted(instance.directory, unowned)
        yield* Effect.sleep(150)
        expect(detached(unowned)).toBe(0)
        expect(beats.filter((b) => b.detachSessionId).length).toBe(1)
      }).pipe(Effect.provide(layer()))
    },
    15000,
  )

  it.instance(
    "detach heartbeat failure rolls back so the session stays in the live list",
    () => {
      const id = SessionID.descending("ses_local_announce_detach_rollback")
      heartbeatImpl = (opts) => {
        if (opts?.detachSessionId === id) return Promise.reject(new Error("relay unreachable"))
        return Promise.resolve()
      }

      return Effect.gen(function* () {
        const instance = yield* TestInstance
        const kilo = yield* KiloSessions.Service
        yield* kilo.init()
        yield* enable(instance.directory)

        turnOpen(instance.directory, id)
        yield* pollWithTimeout(
          Effect.sync(() => (announced(id) >= 1 ? true : undefined)),
          "announce before failed detach never fired",
        )
        expect(KiloSessions.hasRemoteSession(id)).toBe(true)

        sessionDeleted(instance.directory, id)
        yield* pollWithTimeout(
          Effect.sync(() => (detached(id) >= 1 ? true : undefined)),
          "failed detach attempt never hit the heartbeat",
        )
        // The detach fence rejected, so AttachedState restored ownership: the
        // relay keeps a coherent (still attached) view instead of a torn one.
        yield* Effect.sleep(150)
        expect(KiloSessions.hasRemoteSession(id)).toBe(true)
        expect(detached(id)).toBe(1)
      }).pipe(Effect.provide(layer()))
    },
    15000,
  )
})
