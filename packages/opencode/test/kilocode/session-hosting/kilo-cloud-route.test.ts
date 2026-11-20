import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import type { HostedSessionID, NativeRequest } from "@/kilocode/session-hosting/types"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const SESSION = "ses_00000000000000000000000001"
const OTHER = "ses_00000000000000000000000002"
const TOKEN = "kilo-test-bearer-value"
const CONTROL = "kilo-test-control-value"

type Call = { method: string; path: string; search: URLSearchParams; auth: string | null; body: string }

function harness() {
  const calls: Call[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/cloud-agent-next/token") {
        return Response.json({ token: CONTROL, expiresAt: new Date(Date.now() + 600_000).toISOString() })
      }
      calls.push({
        method: request.method,
        path: url.pathname,
        search: url.searchParams,
        auth: request.headers.get("authorization"),
        body: request.method === "POST" ? await request.text() : "",
      })
      return Response.json({ ok: true })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, calls, stop: () => server.stop(true) }
}

function auth() {
  const info = new Auth.Api({ type: "api", key: TOKEN })
  return {
    get: (id: string) => Effect.succeed(id === "kilo" ? info : undefined),
    all: () => Effect.succeed<Record<string, Auth.Info>>({ kilo: info }),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
}

const hosted: HostedSessionID = { providerID: PROVIDER, sessionID: SESSION }

function native(path: string, options: { method?: string; query?: string; body?: string } = {}): NativeRequest {
  const url = new URL(path + (options.query ? `?${options.query}` : ""), "http://localhost")
  const headers = new Headers({ accept: "application/json" })
  if (options.body) headers.set("content-type", "application/json")
  return {
    session: hosted,
    method: options.method ?? (options.body ? "POST" : "GET"),
    path: url.pathname,
    query: url.searchParams,
    headers,
    ...(options.body ? { body: new TextEncoder().encode(options.body) } : {}),
  }
}

it.effect("maps only the proven native allowlist onto the Cloud facade", () => {
  const app = harness()
  const cloud = kiloCloud({ auth: auth(), env: { CLOUD_AGENT_NEXT_BASE_URL: app.url, KILO_WEB_APP_URL: app.url } })
  return Effect.gen(function* () {
    const route = cloud.route
    if (!route) throw new Error("kilo-cloud must implement native routing")

    yield* route(native(`/session/${SESSION}`, { query: "trace=detail&workspace=wrk_local" }))
    yield* route(native(`/session/${SESSION}/message`, { query: "limit=2&before=cursor-1&directory=%2Ftmp" }))
    yield* route(native(`/session/${SESSION}/prompt_async`, { query: "trace=prompt", body: '{"parts":[]}' }))
    yield* route(native(`/session/${SESSION}/abort`, { query: "scope=session", body: "{}" }))
    yield* route(native(`/session/${SESSION}/command`, { query: "trace=command", body: '{"command":"init"}' }))
    yield* route(native(`/session/${SESSION}/todo`))
    yield* route(native(`/session/${SESSION}/diff`))
    yield* route(native("/session/status", { query: "workspace=wrk_att_x" }))
    yield* route(native("/question"))
    yield* route(native("/permission"))
    yield* route(native("/event"))
    yield* route(native("/question/que_1/reply", { method: "POST", body: '{"answers":[["a"]]}' }))
    yield* route(native("/question/que_1/reject", { method: "POST", body: "{}" }))
    yield* route(native("/permission/per_1/reply", { method: "POST", body: '{"reply":"once"}' }))

    expect(app.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /kilo/session/${SESSION}`,
      `GET /kilo/session/${SESSION}/message`,
      `POST /kilo/session/${SESSION}/prompt_async`,
      `POST /kilo/session/${SESSION}/abort`,
      `POST /kilo/session/${SESSION}/command`,
      `GET /kilo/session/${SESSION}/todo`,
      `GET /kilo/session/${SESSION}/diff`,
      "GET /kilo/session/status",
      "GET /kilo/question",
      "GET /kilo/permission",
      "GET /kilo/event",
      "POST /kilo/question/que_1/reply",
      "POST /kilo/question/que_1/reject",
      "POST /kilo/permission/per_1/reply",
    ])

    // Cloud rejects every id-scoped selector except the transcript pagination
    // keys, so only limit/before survive and every local selector is dropped.
    expect(app.calls.map((call) => call.search.toString())).toEqual([
      "",
      "limit=2&before=cursor-1",
      "",
      "",
      "",
      "",
      "",
      `directory=${encodeURIComponent(`/cloud-agent/sessions/${SESSION}`)}`,
      `directory=${encodeURIComponent(`/cloud-agent/sessions/${SESSION}`)}`,
      `directory=${encodeURIComponent(`/cloud-agent/sessions/${SESSION}`)}`,
      `directory=${encodeURIComponent(`/cloud-agent/sessions/${SESSION}`)}`,
      `directory=${encodeURIComponent(`/cloud-agent/sessions/${SESSION}`)}`,
      `directory=${encodeURIComponent(`/cloud-agent/sessions/${SESSION}`)}`,
      `directory=${encodeURIComponent(`/cloud-agent/sessions/${SESSION}`)}`,
    ])

    // Fresh provider auth: the Worker sees only the exchanged control token.
    expect(app.calls.map((call) => call.auth)).toEqual(app.calls.map(() => `Bearer ${CONTROL}`))
    expect(app.calls.map((call) => call.body)).toEqual([
      "",
      "",
      '{"parts":[]}',
      "{}",
      '{"command":"init"}',
      "",
      "",
      "",
      "",
      "",
      "",
      '{"answers":[["a"]]}',
      "{}",
      '{"reply":"once"}',
    ])
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("rejects unsupported and mismatched native requests without a Cloud request", () => {
  const app = harness()
  const cloud = kiloCloud({ auth: auth(), env: { CLOUD_AGENT_NEXT_BASE_URL: app.url, KILO_WEB_APP_URL: app.url } })
  return Effect.gen(function* () {
    const route = cloud.route
    if (!route) throw new Error("kilo-cloud must implement native routing")

    const unsupported = yield* Effect.flip(route(native(`/session/${SESSION}/children`)))
    expect(unsupported.code).toBe("invalid_request")

    const mismatched = yield* Effect.flip(route(native(`/session/${OTHER}/message`)))
    expect(mismatched.code).toBe("invalid_request")

    const unknown = yield* Effect.flip(route(native("/session/not-a-route")))
    expect(unknown.code).toBe("invalid_request")

    const message = yield* Effect.flip(route(native(`/session/${SESSION}/message/msg_1`)))
    expect(message.code).toBe("invalid_request")

    const rules = yield* Effect.flip(route(native("/permission/per_1/always-rules", { method: "POST", body: "{}" })))
    expect(rules.code).toBe("invalid_request")

    expect(app.calls).toHaveLength(0)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("distinguishes credential storage failures from a signed-out provider", () => {
  const broken = {
    get: () => Effect.fail(new Auth.AuthError({ message: "disk read failed" })),
    all: () => Effect.succeed<Record<string, Auth.Info>>({}),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
  const cloud = kiloCloud({ auth: broken })
  return Effect.gen(function* () {
    expect(yield* cloud.availability).toMatchObject({ state: "unavailable", reason: "unreachable" })
    const failure = yield* Effect.flip(cloud.list({}))
    expect(failure).toMatchObject({ code: "auth_unavailable", retryable: true })
  })
})
