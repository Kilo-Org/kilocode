import { Auth } from "@/auth"
import { ATTACHMENT_TTL_MS, PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import { create } from "@/kilocode/session-hosting/registry"
import { key } from "@/kilocode/session-hosting/types"
import type { HostedSessionID } from "@/kilocode/session-hosting/types"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer, Schema } from "effect"
import { expect } from "bun:test"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const SESSION = "ses_00000000000000000000000001"
const OTHER = "ses_00000000000000000000000002"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"
const CLOUD = "agent_12345678-1234-1234-1234-123456789abc"
const WORKSPACE = "workspace_12345678-1234-1234-1234-123456789abc"
const OPERATION = "11111111-1111-4111-8111-111111111111"
const ORG = "22222222-2222-4222-8222-222222222222"
const TOKEN = "kilo-test-bearer-value"
const CONTROL = "kilo-test-control-value"

type Call = {
  readonly method: string
  readonly path: string
  readonly search: string
  readonly auth: string | null
  readonly org: string | null
  readonly body: string
}

type State = {
  list: "ok" | "unavailable"
  detail: "ok" | "invalid" | "notfound" | "mismatch"
  transcript: "ok" | "unavailable" | "mismatch"
  sessionID: string
  starts: number
}

function harness() {
  const calls: Call[] = []
  const state: State = { list: "ok", detail: "ok", transcript: "ok", sessionID: SESSION, starts: 0 }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/cloud-agent-next/token") {
        return Response.json({ token: CONTROL, expiresAt: new Date(Date.now() + 600_000).toISOString() })
      }
      const body = request.method === "POST" ? await request.text() : ""
      calls.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        auth: request.headers.get("authorization"),
        org: request.headers.get("x-kilocode-organizationid"),
        body,
      })

      if (url.pathname === "/trpc/start") {
        const input = Schema.decodeUnknownSync(StartBody)(JSON.parse(body))
        state.starts += 1
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: WORKSPACE,
              kiloSessionId: state.sessionID,
              messageId: input.message.id,
              delivery: "queued",
              replayed: state.starts > 1,
            },
          },
        })
      }

      if (url.pathname === "/kilo/session") {
        if (state.list === "unavailable") {
          return Response.json({ error: "KILO_SESSION_SNAPSHOT_PENDING" }, { status: 503 })
        }
        return Response.json([sessionInfo(state.sessionID), sessionInfo(OTHER)])
      }

      if (url.pathname === `/kilo/session/${SESSION}/message`) {
        if (state.transcript === "unavailable") {
          return Response.json({ error: "KILO_LIVE_RUNTIME_UNAVAILABLE" }, { status: 503 })
        }
        const entries = [message(state.transcript === "mismatch" ? OTHER : SESSION, MESSAGE)]
        return Response.json(entries, {
          headers: {
            "X-Next-Cursor": "cursor-2",
            Link: `<${url.toString().replace(MESSAGE, "next")}>; rel="next"`,
            "X-Kilo-Omitted-Item-Count": "3",
          },
        })
      }

      if (url.pathname === `/kilo/session/${SESSION}`) {
        if (state.detail === "notfound") return Response.json({ error: "KILO_SESSION_NOT_FOUND" }, { status: 404 })
        if (state.detail === "invalid") return Response.json({ id: 42 })
        return Response.json(sessionInfo(state.detail === "mismatch" ? OTHER : SESSION))
      }

      if (url.pathname === "/trpc/listHostedWorkspaces") {
        return Response.json({ result: { data: { items: [], nextCursor: null } } })
      }

      return Response.json({ error: "KILO_SESSION_NOT_FOUND" }, { status: 404 })
    },
  })

  return { url: `http://127.0.0.1:${server.port}`, calls, state, stop: () => server.stop(true) }
}

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

function message(sessionID: string, id: string) {
  return Schema.decodeUnknownSync(SessionV1.WithParts)({
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 110 },
      agent: "build",
      model: { providerID: "test", modelID: "fake" },
    },
    parts: [{ id: "prt_00000000000000000000000001", sessionID, messageID: id, type: "text", text: "hello" }],
  })
}

function auth(info: Auth.Info | undefined) {
  return {
    get: (id: string) => Effect.succeed(id === "kilo" ? info : undefined),
    all: () => Effect.succeed<Record<string, Auth.Info>>(info ? { kilo: info } : {}),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
}

const signedIn = () => new Auth.Api({ type: "api", key: TOKEN })

function client(url: string, info: Auth.Info | undefined) {
  return kiloCloud({ auth: auth(info), env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_WEB_APP_URL: url } })
}

const hosted: HostedSessionID = { providerID: PROVIDER, sessionID: SESSION }

const StartBody = Schema.Struct({
  message: Schema.Struct({ prompt: Schema.String, id: Schema.String }),
  agent: Schema.Struct({ mode: Schema.String, model: Schema.String }),
  repository: Schema.Struct({
    type: Schema.String,
    repo: Schema.String,
    branch: Schema.optional(Schema.String),
  }),
  options: Schema.Struct({
    createdOnPlatform: Schema.String,
    kilocodeOrganizationId: Schema.optional(Schema.String),
  }),
  operationKey: Schema.optional(Schema.String),
})

it.effect("normalizes an idle-stopped transcript into native models without a live target", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url, signedIn())
    const page = yield* cloud.list({ limit: 2 })
    expect(page.items.map((item) => key(item.id))).toEqual([`${PROVIDER}:${SESSION}`, `${PROVIDER}:${OTHER}`])
    expect("cursor" in page).toBe(false)
    expect(page.items[0]?.session.title).toBe(`Hosted ${SESSION}`)

    const transcript = yield* cloud.transcript({ id: hosted, limit: 1, before: "cursor-1" })
    expect(transcript.items).toHaveLength(1)
    expect(String(transcript.items[0]?.info.sessionID)).toBe(SESSION)
    expect(transcript.items[0]?.parts[0]?.type).toBe("text")
    expect(transcript.cursor).toBe("cursor-2")
    expect(transcript.omitted).toBe(3)

    expect(app.calls[0]).toMatchObject({
      method: "GET",
      path: "/kilo/session",
      search: "?limit=2",
      auth: `Bearer ${CONTROL}`,
    })
    expect(app.calls[1]).toMatchObject({
      path: `/kilo/session/${SESSION}/message`,
      search: "?limit=1&before=cursor-1",
    })
    expect(app.calls.some((call) => call.path.endsWith("/event"))).toBe(false)

    const read = JSON.stringify({ page, transcript })
    for (const secret of [app.url, TOKEN, CLOUD, WORKSPACE, "fence", "resnapshot"]) {
      expect(read).not.toContain(secret)
    }
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("applies an explicit organization scope to every read operation", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url, signedIn())
    yield* cloud.list({ organizationID: ORG })
    yield* cloud.get({ id: hosted, organizationID: ORG })
    yield* cloud.transcript({ id: hosted, organizationID: ORG })
    yield* cloud.attach({ id: hosted, organizationID: ORG })
    if (!cloud.membership) throw new Error("Kilo Cloud must resolve workspace membership")
    yield* cloud.membership({ id: hosted, organizationID: ORG })

    expect(app.calls).toHaveLength(5)
    expect(app.calls.every((call) => call.org === ORG)).toBe(true)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("reports signed-out state as actionable and performs no Cloud request", () => {
  let requests = 0
  const cloud = kiloCloud({
    auth: auth(undefined),
    env: { CLOUD_AGENT_NEXT_BASE_URL: "http://127.0.0.1:1", KILO_WEB_APP_URL: "http://127.0.0.1:1" },
    fetch: Object.assign(
      () => {
        requests += 1
        return Promise.reject(new Error("signed out must not request"))
      },
      { preconnect: () => undefined },
    ),
  })
  return Effect.gen(function* () {
    const availability = yield* cloud.availability
    expect(availability).toEqual({
      state: "unavailable",
      reason: "signed_out",
      message: "Kilo credentials are required; run `kilo auth login`",
    })
    const error = yield* cloud.list().pipe(Effect.flip)
    expect(error).toMatchObject({ code: "signed_out", retryable: false })
    expect(requests).toBe(0)
  })
})

it.effect("selects kilo-cloud as the default only while authenticated", () => {
  const app = harness()
  return Effect.gen(function* () {
    const live = create([client(app.url, signedIn())])
    expect((yield* live.default)?.id).toBe(PROVIDER)

    const out = create([client(app.url, undefined)])
    expect(yield* out.default).toBeUndefined()
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("starts the proven flow with a retry-safe key and never returns a Cloud control identity", () => {
  const app = harness()
  const input = {
    repository: { type: "github" as const, repo: "Kilo-Org/kilocode", branch: "main" },
    prompt: "Do the thing",
    agent: { mode: "code", model: "kilo/test-model" },
    organizationID: ORG,
    origin: "desktop" as const,
    operationKey: OPERATION,
    messageID: MESSAGE,
  }
  return Effect.gen(function* () {
    const cloud = client(app.url, signedIn())
    const first = yield* cloud.start(input)
    expect(first).toEqual({
      session: { providerID: PROVIDER, sessionID: SESSION },
      messageID: MESSAGE,
      delivery: "queued",
      replayed: false,
    })
    expect(JSON.stringify(first)).not.toContain(WORKSPACE)
    expect(JSON.stringify(first)).not.toContain(CLOUD)
    expect(JSON.stringify(first)).not.toContain(TOKEN)

    const call = app.calls[0]
    expect(call).toMatchObject({ method: "POST", path: "/trpc/start", auth: `Bearer ${CONTROL}`, org: ORG })
    const body = Schema.decodeUnknownSync(StartBody)(JSON.parse(call.body))
    expect(body).toMatchObject({
      message: { prompt: "Do the thing", id: MESSAGE },
      agent: { mode: "code", model: "kilo/test-model" },
      repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
      options: { createdOnPlatform: "desktop", kilocodeOrganizationId: ORG },
      operationKey: OPERATION,
    })

    const replay = yield* cloud.start(input)
    expect(replay.replayed).toBe(true)
    expect(replay.session).toEqual(first.session)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("keeps durable reads while a later operation failure exposes retryability", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url, signedIn())
    const before = yield* cloud.list()
    expect(before.items).toHaveLength(2)

    app.state.transcript = "unavailable"
    const failure = yield* cloud.transcript({ id: hosted }).pipe(Effect.flip)
    expect(failure).toMatchObject({ code: "unavailable", retryable: true })

    const after = yield* cloud.list()
    expect(after.items.map((item) => key(item.id))).toEqual(before.items.map((item) => key(item.id)))

    app.state.detail = "notfound"
    expect(yield* cloud.get({ id: hosted }).pipe(Effect.flip)).toMatchObject({ code: "not_found", retryable: false })

    app.state.detail = "ok"
    expect(String((yield* cloud.get({ id: hosted })).session.id)).toBe(SESSION)

    app.state.transcript = "ok"
    app.state.list = "unavailable"
    const list = yield* cloud.list().pipe(Effect.flip)
    expect(list.code).toBe("unavailable")
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("keeps transport state separate from provider availability", () => {
  const unreachable = kiloCloud({
    auth: auth(signedIn()),
    env: { CLOUD_AGENT_NEXT_BASE_URL: "http://127.0.0.1:1", KILO_WEB_APP_URL: "http://127.0.0.1:1" },
  })
  return Effect.gen(function* () {
    const failure = yield* unreachable.list().pipe(Effect.flip)
    expect(failure).toMatchObject({ code: "unavailable", retryable: true })
    expect(yield* unreachable.transport).toMatchObject({ state: "unreachable" })
    expect(yield* unreachable.availability).toEqual({ state: "available" })
  })
})

it.effect("marks an ambiguous start as non-retryable without an idempotency key", () => {
  const app = harness()
  const cloud = kiloCloud({
    auth: auth(signedIn()),
    env: { CLOUD_AGENT_NEXT_BASE_URL: "http://127.0.0.1:1", KILO_WEB_APP_URL: app.url },
  })
  return Effect.gen(function* () {
    const failure = yield* cloud
      .start({
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        prompt: "Do the thing",
        agent: { mode: "code", model: "kilo/test-model" },
      })
      .pipe(Effect.flip)
    expect(failure).toMatchObject({ code: "unavailable", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("requires a stable message identity for an idempotent start", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url, signedIn())
    const failure = yield* cloud
      .start({
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        prompt: "Do the thing",
        agent: { mode: "code", model: "kilo/test-model" },
        operationKey: OPERATION,
      })
      .pipe(Effect.flip)
    expect(failure).toMatchObject({ code: "invalid_request", retryable: false })
    expect(app.calls).toHaveLength(0)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("rejects Cloud identities that the host seam cannot accept", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url, signedIn())
    app.state.sessionID = "ses/bad"

    expect(yield* cloud.list().pipe(Effect.flip)).toMatchObject({ code: "invalid_response", retryable: false })
    expect(
      yield* cloud
        .start({
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          prompt: "Do the thing",
          agent: { mode: "code", model: "kilo/test-model" },
          operationKey: OPERATION,
          messageID: MESSAGE,
        })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid_response", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("rejects mismatched or malformed payloads without retryability", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url, signedIn())
    app.state.detail = "invalid"
    expect(yield* cloud.get({ id: hosted }).pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
      retryable: false,
    })

    app.state.detail = "mismatch"
    expect(yield* cloud.get({ id: hosted }).pipe(Effect.flip)).toMatchObject({ code: "invalid_response" })

    app.state.detail = "ok"
    app.state.transcript = "mismatch"
    expect(yield* cloud.transcript({ id: hosted }).pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("returns an attachment descriptor with no provider-private material", () => {
  const app = harness()
  const now = 1_000_000
  const cloud = kiloCloud({
    auth: auth(signedIn()),
    env: { CLOUD_AGENT_NEXT_BASE_URL: app.url, KILO_WEB_APP_URL: app.url },
    clock: () => now,
  })
  return Effect.gen(function* () {
    const descriptor = yield* cloud.attach({ id: hosted })
    expect(Object.keys(descriptor).sort()).toEqual(["expiresAt", "session"])
    expect(descriptor).toEqual({ session: hosted, expiresAt: now + ATTACHMENT_TTL_MS })

    const text = JSON.stringify(descriptor)
    for (const secret of [app.url, TOKEN, CLOUD, WORKSPACE, "/cloud-agent/sessions", "fence", "resnapshot"]) {
      expect(text).not.toContain(secret)
    }
    expect(app.calls.map((call) => call.path)).toEqual([`/kilo/session/${SESSION}`])
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})
