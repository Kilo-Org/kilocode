// Continue-in-Cloud preparation (Continuation.run) against real services bound
// to a temporary instance, a local fake relay, and a real Git stub. The exported
// run path is exercised: session selection, idle checks, mode/model capture,
// acknowledged sync, the durable body, and ordered progress. Ingest is enabled
// in `beforeEach`; the module must not mutate process-level flags at import.

import { afterEach, beforeEach, expect, mock, setSystemTime, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { ContinuationIntentTable } from "@opencode-ai/core/kilocode/continuation/sql"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Auth } from "../../../src/auth"
import { Bus } from "../../../src/bus"
import { GlobalBus } from "../../../src/bus/global"
import type { Config } from "../../../src/config/config"
import { AppRuntime } from "../../../src/effect/app-runtime"
import { Git } from "../../../src/git"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import { provide } from "../../../src/kilocode/instance"
import { Continuation } from "../../../src/kilocode/session-hosting/continuation"
import { HostedFailure } from "../../../src/kilocode/session-hosting/types"
import { Question } from "../../../src/question"
import { MessageID, PartID } from "../../../src/session/schema"
import { Session } from "../../../src/session/session"
import { SessionStatus } from "../../../src/session/status"
import { TestConfig } from "../../fixture/config"
import { tmpdir } from "../../fixture/fixture"

const { KiloSessions } = await import("../../../src/kilo-sessions/kilo-sessions")

const token = "continuation-run-token"
const ORG = "11111111-1111-4111-8111-111111111111"
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const LOOPBACK = "http://127.0.0.1:1"

const providerConfig = {
  provider: {
    tiny: { name: "Tiny", models: { small: { name: "Small", limit: { context: 1000, output: 100 } } } },
    kilo: { name: "Kilo", models: { "kilo-model": { name: "Kilo Model", limit: { context: 1000, output: 100 } } } },
  },
} as unknown as Partial<Config.Interface>

function layer(overrides: Partial<Config.Interface> = {}) {
  return Layer.merge(
    KiloSessions.layer.pipe(
      Layer.provideMerge(Bus.layer),
      Layer.provide(TestConfig.layer({ ...providerConfig, ...overrides })),
      Layer.provide(AppNodeBuilder.build(Session.node)),
    ),
    AppNodeBuilder.build(Auth.node),
  )
}

function reset() {
  clearInFlightCache("kilo-sessions:token")
  clearInFlightCache("kilo-sessions:client")
  clearInFlightCache(`kilo-sessions:token-valid:${token}`)
  clearInFlightCache("kilo-sessions:org")
}

interface Relay {
  ingest: { data: { type: string }[] }[]
  defaults: number
  defaultModel: string
  sessionStatus: number
  ingestStatus: number
  gateIngest: boolean
  gateSession?: string
  ingestStarted: boolean
  releaseIngest?: () => void
  unexpected: string[]
}

let relay: Relay

const realFetch = globalThis.fetch

async function waitFor(check: () => boolean, timeout = 8000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const ENV_KEYS = [
  "KILO_API_KEY",
  "KILO_API_URL",
  "KILO_SESSION_INGEST_URL",
  "KILO_ORG_ID",
  "KILO_DISABLE_SESSION_INGEST",
] as const
const envSnap = new Map<string, string | undefined>()

beforeEach(() => {
  relay = {
    ingest: [],
    defaults: 0,
    defaultModel: "tiny/small",
    sessionStatus: 200,
    ingestStatus: 200,
    gateIngest: false,
    ingestStarted: false,
    unexpected: [],
  }
  for (const key of ENV_KEYS) if (!envSnap.has(key)) envSnap.set(key, process.env[key])
  process.env["KILO_API_KEY"] = token
  process.env["KILO_API_URL"] = LOOPBACK
  process.env["KILO_SESSION_INGEST_URL"] = LOOPBACK
  process.env["KILO_ORG_ID"] = ORG
  process.env["KILO_DISABLE_SESSION_INGEST"] = "0"
  reset()

  globalThis.fetch = mock(async (input, init) => {
    const url = String(input)
    if (url.endsWith("/api/profile")) return Response.json({ user: { id: "oauth/account-1" } })
    if (url.endsWith("/api/user")) return new Response(null, { status: 200 })
    if (url.includes("ai-gateway.kilo.ai") && url.includes("/models")) {
      // The Kilo catalog, so a `kilo` model reference resolves offline.
      return Response.json({
        kilo: {
          id: "kilo",
          name: "Kilo",
          models: {
            "kilo-model": {
              id: "kilo-model",
              name: "Kilo Model",
              limit: { context: 1000, output: 100 },
              cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
              options: {},
            },
          },
        },
      })
    }
    if (url.includes("/defaults")) {
      relay.defaults += 1
      return Response.json({ defaultModel: relay.defaultModel })
    }
    if (url.endsWith("/api/session")) {
      if (relay.sessionStatus !== 200) return new Response(null, { status: relay.sessionStatus })
      const body = JSON.parse(String(init?.body ?? "{}")) as { sessionId?: string }
      const sessionId = body.sessionId ?? "unknown"
      return Response.json({ id: `share-${sessionId}`, ingestPath: `/ingest/${sessionId}` })
    }
    if (url.includes("/ingest/")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      const sessionId = url.split("/ingest/")[1]?.split("?")[0]
      if (relay.gateIngest && sessionId === relay.gateSession) {
        relay.ingestStarted = true
        await new Promise<void>((resolve) => (relay.releaseIngest = resolve))
      }
      if (relay.ingestStatus !== 200) return new Response(null, { status: relay.ingestStatus })
      relay.ingest.push(body as { data: { type: string }[] })
      return new Response("{}", { status: 200 })
    }
    relay.unexpected.push(url)
    return Response.json({})
  }) as unknown as typeof fetch
})

afterEach(() => {
  setSystemTime()
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

// Keep every KiloSessions runtime alive for the file: disposing one disposes the
// shared memo map that also backs AppRuntime, which would break fullSync.
const runtimes: unknown[] = []

async function boot() {
  const { ManagedRuntime } = await import("effect")
  const runtime = ManagedRuntime.make(layer())
  runtimes.push(runtime)
  await runtime.runPromise(KiloSessions.Service.use((svc) => svc.init()))
  return runtime
}

/** A Git stub reporting one clean pushed branch on a GitHub remote. */
const git = Git.Service.of({
  run: (args: string[]) => {
    const joined = args.join(" ")
    const text = joined.includes("symbolic-ref")
      ? "main\n"
      : joined.includes("status")
        ? ""
        : joined.includes("for-each-ref")
          ? "origin\trefs/heads/main\n"
          : joined.includes("get-url")
            ? "https://github.com/acme/widget.git\n"
            : joined.includes("ls-remote")
              ? `${SHA}\trefs/heads/main\n`
              : ""
    return Effect.succeed({ exitCode: 0, text: () => text })
  },
} as never)

interface Capture {
  bodies: unknown[]
  fail?: "transport" | "rejected"
}

function provider(capture: Capture) {
  return {
    continueWorkspace: (body: unknown) => {
      capture.bodies.push(body)
      if (capture.fail === "transport")
        return Effect.fail(new HostedFailure({ code: "unavailable", message: "unavailable", retryable: true }))
      if (capture.fail === "rejected")
        return Effect.fail(new HostedFailure({ code: "rejected", message: "rejected", retryable: false }))
      return Effect.succeed({
        workspace: { id: "ws-1" },
        sessions: [],
        active: { sessionID: "ses-active" },
        replayed: false,
      })
    },
  } as never
}

function attempt(input: {
  directory: string
  sessionIDs: string[]
  activeSessionID: string
  operationKey: string
  provider: unknown
  git?: unknown
  timeoutMs?: number
}) {
  return AppRuntime.runPromise(
    Continuation.run({
      provider: input.provider as never,
      operationKey: input.operationKey,
      directory: input.directory,
      sessionIDs: input.sessionIDs,
      activeSessionID: input.activeSessionID,
      timeoutMs: input.timeoutMs ?? 8000,
      env: {
        KILO_API_KEY: token,
        KILO_API_URL: LOOPBACK,
        KILO_WEB_APP_URL: LOOPBACK,
        CLOUD_AGENT_NEXT_BASE_URL: LOOPBACK,
        KILO_ORG_ID: ORG,
      },
    }).pipe(
      Effect.provideService(Git.Service, (input.git ?? git) as never),
      Effect.match({
        onFailure: (error) => ({ ok: false as const, error: error as { code?: string } }),
        onSuccess: (value) => ({ ok: true as const, value }),
      }),
    ),
  )
}

type Attempt = Awaited<ReturnType<typeof attempt>>

const newSession = (options: { agent?: string; parentID?: string } = {}) =>
  AppRuntime.runPromise(
    Session.Service.use((svc) =>
      svc.create({
        agent: options.agent ?? "code",
        ...(options.parentID ? { parentID: options.parentID as never } : {}),
      } as never),
    ),
  )

const addAssistant = async (sessionID: string, directory: string) => {
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
        modelID: "small",
        providerID: "tiny",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
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
        text: "hello",
        time: { start: Date.now(), end: Date.now() },
      } as never),
    ),
  )
}

const rowCount = (operationKey: string) =>
  AppRuntime.runPromise(
    Database.Service.use((db) =>
      db.db
        .select()
        .from(ContinuationIntentTable)
        .where(eq(ContinuationIntentTable.operation_key, operationKey))
        .all()
        .pipe(Effect.map((rows) => rows.length)),
    ),
  )

const failCode = (value: Attempt) => (value.ok ? undefined : value.error.code)

async function withInstance<T>(directory: string, fn: () => Promise<T>): Promise<T> {
  return provide({ directory, fn })
}

test("rejects a selected session that is not in the requested worktree", async () => {
  await using outer = await tmpdir({ git: true })
  await using inner = await tmpdir({ git: true })
  await withInstance(outer.path, async () => {
    await boot()
    const session = await withInstance(inner.path, () => newSession())
    const out = await attempt({
      directory: outer.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey: crypto.randomUUID(),
      provider: provider({ bodies: [] }),
    })
    expect(failCode(out)).toBe("session_not_in_worktree")
  })
}, 30000)

test("rejects a child session", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const parent = await newSession()
    const child = await newSession({ parentID: parent.id })
    const out = await attempt({
      directory: only.path,
      sessionIDs: [child.id],
      activeSessionID: child.id,
      operationKey: crypto.randomUUID(),
      provider: provider({ bodies: [] }),
    })
    expect(failCode(out)).toBe("session_not_in_worktree")
  })
}, 30000)

test("rejects a busy session in the requested worktree, not the launching instance", async () => {
  await using outer = await tmpdir({ git: true })
  await using inner = await tmpdir({ git: true })
  await withInstance(outer.path, async () => {
    await boot()
    const session = await withInstance(inner.path, () => newSession())
    // The session is busy in the requested instance only.
    await withInstance(inner.path, () =>
      AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.set(session.id as never, { type: "busy" }))),
    )
    const out = await attempt({
      directory: inner.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey: crypto.randomUUID(),
      provider: provider({ bodies: [] }),
    })
    expect(failCode(out)).toBe("session_busy")
  })
}, 30000)

test("rejects a session with a pending question in the requested worktree", async () => {
  await using outer = await tmpdir({ git: true })
  await using inner = await tmpdir({ git: true })
  await withInstance(outer.path, async () => {
    await boot()
    const session = await withInstance(inner.path, () => newSession())
    // Ask a question in the requested instance and leave it pending.
    const pending = withInstance(inner.path, () =>
      AppRuntime.runPromise(
        Question.Service.use((svc) =>
          svc.ask({
            sessionID: session.id as never,
            questions: [{ question: "Which?", header: "Pick", options: [{ label: "A", description: "a" }] }],
          }),
        ),
      ),
    )
    pending.catch(() => undefined)
    await withInstance(inner.path, async () => {
      await new Promise<void>((resolve, reject) => {
        const start = Date.now()
        const timer = setInterval(async () => {
          const list = await AppRuntime.runPromise(Question.Service.use((svc) => svc.list()))
          if (list.length > 0) {
            clearInterval(timer)
            resolve()
          } else if (Date.now() - start > 5000) {
            clearInterval(timer)
            reject(new Error("question never became pending"))
          }
        }, 10)
      })
    })
    const out = await attempt({
      directory: inner.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey: crypto.randomUUID(),
      provider: provider({ bodies: [] }),
    })
    expect(failCode(out)).toBe("session_busy")
    await withInstance(inner.path, async () => {
      const list = await AppRuntime.runPromise(Question.Service.use((svc) => svc.list()))
      for (const request of list) {
        await AppRuntime.runPromise(Question.Service.use((svc) => svc.reject(request.id)))
      }
    })
  })
}, 30000)

test("rejects a session whose message changed during the sync", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const session = await newSession()
    await addAssistant(session.id, only.path)

    relay.gateIngest = true
    relay.gateSession = session.id
    const capture: Capture = { bodies: [] }
    const task = attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey: crypto.randomUUID(),
      provider: provider(capture),
    })
    await waitFor(() => relay.ingestStarted)
    await addAssistant(session.id, only.path)
    // Release once, then stop gating so the message's own flush is not held.
    relay.gateIngest = false
    relay.releaseIngest?.()
    const out = await task
    expect(failCode(out)).toBe("session_changed")
    expect(capture.bodies.length).toBe(0)
  })
}, 30000)

test("rejects an invalid prepared body without writing a row", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const session = await newSession({ agent: "m".repeat(51) })
    const capture: Capture = { bodies: [] }
    const operationKey = crypto.randomUUID()
    const out = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey,
      provider: provider(capture),
    })
    expect(failCode(out)).toBe("invalid_request")
    expect(capture.bodies.length).toBe(0)
    expect(await rowCount(operationKey)).toBe(0)
  })
}, 30000)

test("resolves the default model once per organization", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const one = await newSession()
    const two = await newSession()
    const capture: Capture = { bodies: [] }
    const out = await attempt({
      directory: only.path,
      sessionIDs: [one.id, two.id],
      activeSessionID: one.id,
      operationKey: crypto.randomUUID(),
      provider: provider(capture),
    })
    expect(out.ok).toBe(true)
    expect(relay.defaults).toBe(1)
    const body = capture.bodies[0] as { sessions: { agent: { model: string } }[] }
    expect(body.sessions.map((session) => session.agent.model)).toEqual(["tiny/small", "tiny/small"])
  })
}, 30000)

test("publishes checking, syncing, and creating in order for the operation", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const session = await newSession()
    const operationKey = crypto.randomUUID()
    const stages: string[] = []
    const listener = (event: { payload?: { type?: string; properties?: { operationKey?: string; stage?: string } } }) => {
      const payload = event.payload
      if (payload?.type !== "session.host.continuation") return
      if (payload.properties?.operationKey !== operationKey) return
      stages.push(payload.properties.stage ?? "")
    }
    GlobalBus.on("event", listener)
    try {
      const out = await attempt({
        directory: only.path,
        sessionIDs: [session.id],
        activeSessionID: session.id,
        operationKey,
        provider: provider({ bodies: [] }),
      })
      expect(out.ok).toBe(true)
    } finally {
      GlobalBus.off("event", listener)
    }
    expect(stages).toEqual(["checking", "syncing", "creating"])
  })
}, 30000)

test("does not dispatch when the acknowledged sync fails", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const session = await newSession()
    relay.ingestStatus = 404
    const capture: Capture = { bodies: [] }
    const operationKey = crypto.randomUUID()
    const out = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey,
      provider: provider(capture),
    })
    expect(failCode(out)).toBe("sync_failed")
    expect(capture.bodies.length).toBe(0)
    expect(await rowCount(operationKey)).toBe(0)
  })
}, 30000)

test("reuses the stored body on retry and rebuilds it only after the intent is swept", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const session = await newSession()
    const day0 = Date.now()
    const operationKey = crypto.randomUUID()
    const sweepDay31 = crypto.randomUUID()
    const sweepDay70 = crypto.randomUUID()
    const day = (n: number) => new Date(day0 + n * 24 * 60 * 60 * 1000)

    // Day 0: dispatch fails on the transport. The intent remains.
    const first: Capture = { bodies: [], fail: "transport" }
    const one = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey,
      provider: provider(first),
    })
    expect(one.ok).toBe(false)
    expect(first.bodies.length).toBe(1)
    const body1 = first.bodies[0]
    expect(await rowCount(operationKey)).toBe(1)
    expect(relay.defaults).toBe(1)

    // Day 29: the default model changed. The retry replays the exact stored body,
    // resolves no defaults, and its touch extends retention to about day 59.
    relay.defaultModel = "tiny/other"
    setSystemTime(day(29))
    const second: Capture = { bodies: [], fail: "transport" }
    const two = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey,
      provider: provider(second),
    })
    expect(two.ok).toBe(false)
    expect(second.bodies[0]).toEqual(body1)
    expect(relay.defaults).toBe(1)
    expect(await rowCount(operationKey)).toBe(1)

    // Day 31: a separate operation triggers the sweep. The day-29 touch kept the
    // original row alive past this point, so the sweep must leave it in place.
    setSystemTime(day(31))
    const sweep: Capture = { bodies: [] }
    const swept = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey: sweepDay31,
      provider: provider(sweep),
    })
    expect(swept.ok).toBe(true)
    expect(await rowCount(operationKey)).toBe(1)
    const defaultsAfterSweep = relay.defaults
    // The sweep operation is a fresh prepare, so it resolves defaults once.
    expect(defaultsAfterSweep).toBe(2)

    // The same-key retry still replays the exact stored body and fetches no
    // defaults since the sweep, because the row survived it.
    const third: Capture = { bodies: [] }
    const three = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey,
      provider: provider(third),
    })
    expect(three.ok).toBe(true)
    expect(third.bodies[0]).toEqual(body1)
    expect(relay.defaults).toBe(defaultsAfterSweep)

    // Day 70: the extended retention has now expired, so another operation's
    // sweep removes the original row.
    setSystemTime(day(70))
    const later: Capture = { bodies: [] }
    const dropped = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey: sweepDay70,
      provider: provider(later),
    })
    expect(dropped.ok).toBe(true)
    expect(await rowCount(operationKey)).toBe(0)

    // With the row gone, the same-key retry rebuilds from the current defaults.
    const rebuilt: Capture = { bodies: [] }
    const retried = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey,
      provider: provider(rebuilt),
    })
    expect(retried.ok).toBe(true)
    const fresh = rebuilt.bodies[0] as { sessions: { agent: { model: string } }[] }
    expect(fresh.sessions[0]!.agent.model).toBe("tiny/other")
    // day0, the day31 sweep prepare, the day70 sweep prepare, and the rebuild.
    expect(relay.defaults).toBe(4)
  })
}, 40000)

test("rejects a hidden empty-string mode without writing a row", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const session = await newSession({ agent: "" })
    const capture: Capture = { bodies: [] }
    const operationKey = crypto.randomUUID()
    const out = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey,
      provider: provider(capture),
    })
    expect(failCode(out)).toBe("invalid_request")
    expect(capture.bodies.length).toBe(0)
    expect(await rowCount(operationKey)).toBe(0)
  })
}, 30000)

/** A user message drives the captured agent mode/model; `variant` may be empty. */
const addUser = (sessionID: string, model: { providerID: string; modelID: string; variant?: string }) =>
  AppRuntime.runPromise(
    Session.Service.use((svc) =>
      svc.updateMessage({
        id: MessageID.ascending(),
        sessionID: sessionID as never,
        role: "user",
        agent: "build",
        model: { providerID: model.providerID, modelID: model.modelID, ...(model.variant === undefined ? {} : { variant: model.variant }) },
        time: { created: Date.now() },
      } as never),
    ),
  )

test("captures the Kilo model variant, including an explicit empty one", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    // The Kilo catalog cannot be fetched offline; the tolerant model lookup must
    // let the transcript sync succeed and keep the variant on the prepared body.
    const empty = await newSession()
    await addUser(empty.id, { providerID: "kilo", modelID: "kilo-model", variant: "" })
    const absent = await newSession()
    await addUser(absent.id, { providerID: "kilo", modelID: "kilo-model" })

    const capture: Capture = { bodies: [] }
    const out = await attempt({
      directory: only.path,
      sessionIDs: [empty.id, absent.id],
      activeSessionID: empty.id,
      operationKey: crypto.randomUUID(),
      provider: provider(capture),
    })
    expect(out.ok).toBe(true)
    const body = capture.bodies[0] as { sessions: { agent: Record<string, unknown> }[] }
    expect(body.sessions[0]!.agent).toEqual({ mode: "build", model: "kilo-model", variant: "" })
    expect(body.sessions[1]!.agent).toEqual({ mode: "build", model: "kilo-model" })
  })
}, 30000)

test("uses the account default when a user message's model is retired", async () => {
  await using only = await tmpdir({ git: true })
  await withInstance(only.path, async () => {
    await boot()
    const session = await newSession()
    await addUser(session.id, { providerID: "retired", modelID: "gone" })

    const capture: Capture = { bodies: [] }
    const out = await attempt({
      directory: only.path,
      sessionIDs: [session.id],
      activeSessionID: session.id,
      operationKey: crypto.randomUUID(),
      provider: provider(capture),
    })
    expect(out.ok).toBe(true)
    const body = capture.bodies[0] as { sessions: { agent: Record<string, unknown> }[] }
    expect(body.sessions[0]!.agent).toEqual({ mode: "build", model: "tiny/small" })
  })
}, 30000)
