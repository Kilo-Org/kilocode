import { Auth } from "@/auth"
import { provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const SESSION = "ses_00000000000000000000000001"
const CLOUD = "workspace_12345678-1234-1234-1234-123456789abc"
const SOURCE = "kilo-source-bearer-value"
const CONTROL = "kilo-control-token-value"
const ORG = "22222222-2222-4222-8222-222222222222"
const OPERATION = "11111111-1111-4111-8111-111111111111"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"

type Recorded = { method: string; path: string; auth: string | null; org: string | null; body: string }

function sessionInfo(id: string) {
  return Schema.decodeUnknownSync(SessionV1.SessionInfo)({
    id,
    slug: id,
    projectID: "cloud-agent",
    directory: `/cloud-agent/sessions/${id}`,
    title: `Hosted ${id}`,
    version: "cloud-agent",
    time: { created: 100, updated: 200 },
  })
}

function harness() {
  const issuer: Recorded[] = []
  const worker: Recorded[] = []
  let now = 1_000_000
  const state = {
    issue: "ok" as "ok" | "deny" | "unavailable" | "throttled",
    token: CONTROL,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "POST" ? await request.text() : ""
      const recorded: Recorded = {
        method: request.method,
        path: url.pathname,
        auth: request.headers.get("authorization"),
        org: request.headers.get("x-kilocode-organizationid"),
        body,
      }
      if (url.pathname === "/api/cloud-agent-next/token") {
        issuer.push(recorded)
        if (state.issue === "deny") return Response.json({ error: "denied" }, { status: 401 })
        if (state.issue === "unavailable") return Response.json({ error: "disabled" }, { status: 503 })
        if (state.issue === "throttled") return Response.json({ error: "limited" }, { status: 429 })
        return Response.json({ token: state.token, expiresAt: new Date(now + 600_000).toISOString() })
      }
      worker.push(recorded)
      if (url.pathname === "/kilo/session") return Response.json([sessionInfo(SESSION)])
      if (url.pathname === "/trpc/start") {
        const input = Object(JSON.parse(body))
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: CLOUD,
              kiloSessionId: SESSION,
              messageId: input.message?.id,
              delivery: "queued",
              replayed: false,
            },
          },
        })
      }
      return Response.json({ error: "KILO_SESSION_NOT_FOUND" }, { status: 404 })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    issuer,
    worker,
    state,
    clock: () => now,
    advance: (ms: number) => {
      now += ms
    },
    stop: () => server.stop(true),
  }
}

function authStore(initial: string | undefined = SOURCE) {
  const writes = { set: 0, remove: 0 }
  let info: Auth.Info | undefined = initial ? new Auth.Api({ type: "api", key: initial }) : undefined
  return {
    writes,
    rotate(value: string | undefined) {
      info = value ? new Auth.Api({ type: "api", key: value }) : undefined
    },
    interface: {
      get: (id: string) => Effect.succeed(id === "kilo" ? info : undefined),
      all: () => Effect.succeed<Record<string, Auth.Info>>(info ? { kilo: info } : {}),
      set: () => {
        writes.set += 1
        return Effect.void
      },
      remove: () => {
        writes.remove += 1
        return Effect.void
      },
    } satisfies Auth.Interface,
  }
}

function client(app: ReturnType<typeof harness>, store: ReturnType<typeof authStore>) {
  return kiloCloud({
    auth: store.interface,
    env: { CLOUD_AGENT_NEXT_BASE_URL: app.url, KILO_WEB_APP_URL: app.url },
    clock: app.clock,
  })
}

it.effect("exchanges the source once and reads the Worker with the control token only", () => {
  const app = harness()
  const store = authStore()
  const cloud = client(app, store)
  return Effect.gen(function* () {
    yield* cloud.list({})
    yield* cloud.list({})

    expect(app.issuer).toHaveLength(1)
    expect(app.issuer[0]).toMatchObject({ path: "/api/cloud-agent-next/token", auth: `Bearer ${SOURCE}`, body: "{}" })
    expect(app.worker.map((call) => call.path)).toEqual(["/kilo/session", "/kilo/session"])
    expect(app.worker.every((call) => call.auth === `Bearer ${CONTROL}`)).toBe(true)
    expect(app.worker.some((call) => call.auth === `Bearer ${SOURCE}`)).toBe(false)
    // The exchange never writes to the user's credential store.
    expect(store.writes).toEqual({ set: 0, remove: 0 })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("scopes both the exchange and the Worker call to the selected organization", () => {
  const app = harness()
  const store = authStore()
  const cloud = client(app, store)
  return Effect.gen(function* () {
    yield* cloud.list({ organizationID: ORG })

    expect(app.issuer[0]).toMatchObject({ org: ORG, body: JSON.stringify({ organizationId: ORG }) })
    expect(app.worker[0].org).toBe(ORG)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("reports a denied exchange and never dispatches the Worker", () => {
  const app = harness()
  const store = authStore()
  const cloud = client(app, store)
  app.state.issue = "deny"
  return Effect.gen(function* () {
    const error = yield* cloud.list({}).pipe(Effect.flip)
    expect(error).toMatchObject({ code: "unauthorized", retryable: false })
    expect(app.worker).toHaveLength(0)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("keeps issuer outages retryable before reads and keyless starts", () => {
  const app = harness()
  const store = authStore()
  const cloud = client(app, store)
  app.state.issue = "unavailable"
  return Effect.gen(function* () {
    const error = yield* cloud.list({}).pipe(Effect.flip)
    expect(error).toMatchObject({ code: "unavailable", retryable: true })
    const start = yield* cloud
      .start({
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        prompt: "hello",
        agent: { mode: "build", model: "test/fake" },
      })
      .pipe(Effect.flip)
    expect(start).toMatchObject({ code: "unavailable", retryable: true })
    expect(app.issuer).toHaveLength(2)
    expect(app.worker).toHaveLength(0)
    expect(store.writes).toEqual({ set: 0, remove: 0 })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("reports issuer throttling as retryable without dispatching the Worker", () => {
  const app = harness()
  const store = authStore()
  const cloud = client(app, store)
  app.state.issue = "throttled"
  return Effect.gen(function* () {
    const error = yield* cloud.list({}).pipe(Effect.flip)
    expect(error).toMatchObject({ code: "unavailable", retryable: true })
    expect(app.issuer).toHaveLength(1)
    expect(app.worker).toHaveLength(0)
    expect(store.writes).toEqual({ set: 0, remove: 0 })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("keeps a keyless start retryable when the issuer transport fails", () => {
  const app = harness()
  const store = authStore()
  const cloud = kiloCloud({
    auth: store.interface,
    env: { CLOUD_AGENT_NEXT_BASE_URL: app.url, KILO_WEB_APP_URL: "http://127.0.0.1:1" },
  })
  return Effect.gen(function* () {
    const error = yield* cloud
      .start({
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        prompt: "hello",
        agent: { mode: "build", model: "test/fake" },
      })
      .pipe(Effect.flip)
    expect(error).toMatchObject({
      code: "unavailable",
      message: "Kilo control token could not be issued",
      retryable: true,
    })
    expect(app.issuer).toHaveLength(0)
    expect(app.worker).toHaveLength(0)
    expect(store.writes).toEqual({ set: 0, remove: 0 })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("re-exchanges after the cached control token expires or the source rotates", () => {
  const app = harness()
  const store = authStore()
  const cloud = client(app, store)
  return Effect.gen(function* () {
    yield* cloud.list({})
    expect(app.issuer).toHaveLength(1)

    app.advance(600_000)
    yield* cloud.list({})
    expect(app.issuer).toHaveLength(2)

    store.rotate("rotated-source")
    yield* cloud.list({})
    expect(app.issuer).toHaveLength(3)
    expect(app.issuer[2].auth).toBe("Bearer rotated-source")
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("dispatches one mutation with the control token and no automatic retry", () => {
  const app = harness()
  const store = authStore()
  const cloud = client(app, store)
  return Effect.gen(function* () {
    yield* cloud.start({
      repository: { type: "github", repo: "Kilo-Org/kilocode" },
      prompt: "hello",
      agent: { mode: "build", model: "test/fake" },
      operationKey: OPERATION,
      messageID: MESSAGE,
    })

    const starts = app.worker.filter((call) => call.path === "/trpc/start")
    expect(starts).toHaveLength(1)
    expect(starts[0].auth).toBe(`Bearer ${CONTROL}`)
    expect(app.issuer).toHaveLength(1)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})
