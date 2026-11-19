// Continue-in-Cloud acknowledged sync (syncForContinuation) against a local fake
// ingest. The real KiloSessions module runs; only the relay HTTP calls are faked
// through globalThis.fetch, so the exported sync path is exercised end to end.
//
// kilo-sessions reads KILO_DISABLE_SESSION_INGEST at module load, so set it
// before the first import.
process.env["KILO_DISABLE_SESSION_INGEST"] = "0"
delete process.env["KILO_DISABLE_SHARE"]

import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Layer } from "effect"
import { Auth } from "../../../src/auth"
import { Bus } from "../../../src/bus"
import type { Config } from "../../../src/config/config"
import { AppRuntime } from "../../../src/effect/app-runtime"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import { provide } from "../../../src/kilocode/instance"
import { MessageID, PartID } from "../../../src/session/schema"
import { Session } from "../../../src/session/session"
import { TestConfig } from "../../fixture/config"
import { tmpdir } from "../../fixture/fixture"

const { KiloSessions } = await import("../../../src/kilo-sessions/kilo-sessions")

const token = "continuation-sync-token"

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

function reset() {
  clearInFlightCache("kilo-sessions:token")
  clearInFlightCache("kilo-sessions:client")
  clearInFlightCache(`kilo-sessions:token-valid:${token}`)
}

interface Relay {
  ingest: { data: { type: string }[] }[]
  sessionPosts: number
  /** Hold the bootstrap POST until `releaseBootstrap` is called. */
  gateBootstrap: boolean
  /** Hold the ingest POST until `releaseIngest` is called. */
  gateIngest: boolean
  bootstrapStarted: boolean
  ingestStarted: boolean
  releaseBootstrap?: () => void
  releaseIngest?: () => void
  sessionStatus: number
  ingestStatus: number
  userStatus: number
}

let relay: Relay

const realFetch = globalThis.fetch

async function waitFor(check: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const ENV_KEYS = ["KILO_API_KEY", "KILO_SESSION_INGEST_URL", "KILO_API_URL", "KILO_DISABLE_SESSION_INGEST"] as const
const envSnap = new Map<string, string | undefined>()

beforeEach(() => {
  relay = {
    ingest: [],
    sessionPosts: 0,
    gateBootstrap: false,
    gateIngest: false,
    bootstrapStarted: false,
    ingestStarted: false,
    sessionStatus: 200,
    ingestStatus: 200,
    userStatus: 200,
  }
  for (const key of ENV_KEYS) if (!envSnap.has(key)) envSnap.set(key, process.env[key])
  process.env["KILO_API_KEY"] = token
  process.env["KILO_SESSION_INGEST_URL"] = "http://127.0.0.1:9"
  process.env["KILO_API_URL"] = "http://127.0.0.1:9"
  process.env["KILO_DISABLE_SESSION_INGEST"] = "0"
  reset()

  globalThis.fetch = mock(async (input, init) => {
    const url = String(input)
    if (url.endsWith("/api/user")) return new Response(null, { status: relay.userStatus })
    if (url.endsWith("/api/session")) {
      relay.sessionPosts += 1
      if (relay.gateBootstrap) {
        relay.bootstrapStarted = true
        await new Promise<void>((resolve) => (relay.releaseBootstrap = resolve))
      }
      if (relay.sessionStatus !== 200) return new Response(null, { status: relay.sessionStatus })
      const body = JSON.parse(String(init?.body ?? "{}")) as { sessionId?: string }
      const sessionId = body.sessionId ?? "unknown"
      return Response.json({ id: `share-${sessionId}`, ingestPath: `/ingest/${sessionId}` })
    }
    if (url.includes("/ingest/")) {
      if (relay.gateIngest) {
        relay.ingestStarted = true
        await new Promise<void>((resolve) => (relay.releaseIngest = resolve))
      }
      if (relay.ingestStatus !== 200) return new Response(null, { status: relay.ingestStatus })
      relay.ingest.push(JSON.parse(String(init?.body ?? "{}")))
      return new Response("{}", { status: 200 })
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  }) as unknown as typeof fetch
})

afterEach(() => {
  // Restore only the fetch this file replaced; mock.restore() would also wipe
  // stubs other files in the same batch installed.
  globalThis.fetch = realFetch
  for (const [key, value] of envSnap) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  envSnap.clear()
  reset()
})

/** Build a runtime for the layer and initialize KiloSessions, as production does. */
async function boot() {
  const { ManagedRuntime } = await import("effect")
  const runtime = ManagedRuntime.make(layer())
  await runtime.runPromise(KiloSessions.Service.use((svc) => svc.init()))
  return runtime
}

/** Create a real session through AppRuntime under the active instance context. */
const newSession = () => AppRuntime.runPromise(Session.Service.use((svc) => svc.create({}))).then((chat) => chat.id)

// Three real assistant messages with parts, so fullSync enqueues a complete
// transcript without a provider model lookup (there are no user messages).
async function seedTranscript(directory: string, sessionID: string) {
  for (let index = 0; index < 3; index++) {
    const id = MessageID.ascending()
    await AppRuntime.runPromise(
      Session.Service.use((svc) =>
        svc.updateMessage({
          id,
          sessionID: sessionID as never,
          parentID: MessageID.ascending(),
          role: "assistant",
          agent: "code",
          mode: "code",
          modelID: "test-model",
          providerID: "test",
          path: { cwd: directory, root: directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() + index },
        } as never),
      ),
    )
    await AppRuntime.runPromise(
      Session.Service.use((svc) =>
        svc.updatePart({
          id: PartID.ascending(),
          sessionID: sessionID as never,
          messageID: id,
          type: "text",
          text: `message ${index}`,
          time: { start: Date.now(), end: Date.now() },
        } as never),
      ),
    )
  }
}

test(
  "acknowledges the complete transcript before returning ok",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        await boot()
        const id = await newSession()
        await seedTranscript(tmp.path, id)

        const result = await KiloSessions.syncForContinuation([id], { timeoutMs: 5000 })
        expect(result).toEqual({ ok: true })
        expect(relay.ingest.length).toBe(1)
        expect(relay.ingest[0]!.data.filter((item) => item.type === "message")).toHaveLength(3)
      },
    })
  },
  20000,
)

test(
  "waits for a delayed bootstrap before settling",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        await boot()
        // Gate the share bootstrap BEFORE the session exists: a watcher-triggered
        // bootstrap on creation is therefore also held, so the sync cannot skip
        // its own bootstrap because a share was already saved.
        relay.gateBootstrap = true
        const id = await newSession()
        await seedTranscript(tmp.path, id)

        const task = KiloSessions.syncForContinuation([id], { timeoutMs: 5000 })
        await waitFor(() => relay.bootstrapStarted)
        // The acknowledged sync is waiting on the share, so nothing was flushed.
        expect(relay.ingest.length).toBe(0)
        expect(relay.sessionPosts).toBe(1)

        relay.releaseBootstrap?.()
        expect(await task).toEqual({ ok: true })
        // One share bootstrap, then the complete transcript in one batch.
        expect(relay.sessionPosts).toBe(1)
        expect(relay.ingest.length).toBe(1)
        expect(relay.ingest[0]!.data.filter((item) => item.type === "message")).toHaveLength(3)
      },
    })
  },
  20000,
)

test(
  "waits for a slow full sync transcript before settling",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        await boot()
        const id = await newSession()
        await seedTranscript(tmp.path, id)

        relay.gateIngest = true
        const task = KiloSessions.syncForContinuation([id], { timeoutMs: 5000 })
        await waitFor(() => relay.ingestStarted)
        expect(relay.ingest.length).toBe(0)
        relay.releaseIngest?.()
        expect(await task).toEqual({ ok: true })
        expect(relay.ingest.length).toBe(1)
      },
    })
  },
  20000,
)

test(
  "fails when the initial transcript sync rejects (no partial success)",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        await boot()
        // A share is created for an id with no session, so fullSync fails.
        const result = await KiloSessions.syncForContinuation(["ses_missing_transcript"], { timeoutMs: 5000 })
        expect(result).toEqual({ ok: false, reason: "failed" })
        expect(relay.ingest.length).toBe(0)
      },
    })
  },
  20000,
)

test(
  "fails on the deadline when the transcript never settles",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        await boot()
        const id = await newSession()
        await seedTranscript(tmp.path, id)

        relay.gateIngest = true
        const result = await KiloSessions.syncForContinuation([id], { timeoutMs: 3000 })
        expect(result).toEqual({ ok: false, reason: "failed" })
        // The gated flush started, so the failure is the deadline, not a missing attempt.
        expect(relay.ingestStarted).toBe(true)
        // Release the held POST so it cannot leak into a later test's settle.
        relay.gateIngest = false
        relay.releaseIngest?.()
      },
    })
  },
  20000,
)

test(
  "fails when the session is not shared and the bootstrap is transient",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        relay.sessionStatus = 500
        await boot()
        const result = await KiloSessions.syncForContinuation(["ses_unshared"], { timeoutMs: 2000 })
        expect(result).toEqual({ ok: false, reason: "no_share" })
      },
    })
  },
  20000,
)

test(
  "reports signed_out when the credential is rejected",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        // The credential is rejected before any client is cached.
        relay.userStatus = 401
        await boot()
        const result = await KiloSessions.syncForContinuation(["ses_signed_out"], { timeoutMs: 2000 })
        expect(result).toEqual({ ok: false, reason: "signed_out" })
      },
    })
  },
  20000,
)

test(
  "fails when the ingest acknowledgement is a permanent 4xx",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        await boot()
        const id = await newSession()
        await seedTranscript(tmp.path, id)

        relay.ingestStatus = 404
        const result = await KiloSessions.syncForContinuation([id], { timeoutMs: 2000 })
        expect(result).toEqual({ ok: false, reason: "failed" })
      },
    })
  },
  20000,
)

test(
  "keeps the transcript when a user message's model is retired",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await provide({
      directory: tmp.path,
      fn: async () => {
        await boot()
        const id = await newSession()
        await seedTranscript(tmp.path, id)
        // A historical user message whose provider/model no longer resolve.
        await AppRuntime.runPromise(
          Session.Service.use((svc) =>
            svc.updateMessage({
              id: MessageID.ascending(),
              sessionID: id as never,
              role: "user",
              agent: "build",
              model: { providerID: "retired", modelID: "gone" },
              time: { created: Date.now() },
            } as never),
          ),
        )

        const result = await KiloSessions.syncForContinuation([id], { timeoutMs: 5000 })
        expect(result).toEqual({ ok: true })
        const body = relay.ingest[0]!
        // Every message still reaches ingest; only the display model is dropped.
        expect(body.data.filter((item) => item.type === "message")).toHaveLength(4)
        const model = body.data.find((item) => item.type === "model") as unknown as { data: unknown[] }
        expect(model.data).toEqual([])
      },
    })
  },
  20000,
)
