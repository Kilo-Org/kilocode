import * as Attachments from "@/kilocode/server/hosted-attachments"
import { SessionHostApi, SessionHostPaths } from "@/kilocode/server/httpapi/groups/session-host"
import { sessionHostHandlers } from "@/kilocode/server/httpapi/handlers/session-host"
import { SessionHost } from "@/kilocode/session-hosting"
import { Auth } from "@/auth"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "@/server/routes/instance/httpapi/middleware/schema-error"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { NodeHttpServer } from "@effect/platform-node"
import { afterAll, afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { testEffect, pollWithTimeout } from "../../lib/effect"
import { parse } from "../../server/httpapi-exercise/assertions"

const SESSION = "ses_00000000000000000000000001"
const TOKEN = "kilo-test-bearer-value"

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(SessionHostApi)

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
  const calls: Array<{ method: string; path: string; search: string; body: string }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "POST" ? await request.text() : ""
      calls.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        body,
      })
      if (url.pathname === "/kilo/session" && request.method === "GET") {
        return Response.json([sessionInfo(SESSION)])
      }
      if (url.pathname === `/kilo/session/${SESSION}`) return Response.json(sessionInfo(SESSION))
      if (url.pathname === `/kilo/session/${SESSION}/message`) {
        return Response.json([
          {
            info: {
              id: "msg_00000000000000000000000001",
              sessionID: SESSION,
              role: "user",
              time: { created: 110 },
              agent: "build",
              model: { providerID: "test", modelID: "fake" },
            },
            parts: [
              {
                id: "prt_00000000000000000000000001",
                sessionID: SESSION,
                messageID: "msg_00000000000000000000000001",
                type: "text",
                text: "hello",
              },
            ],
          },
        ])
      }
      if (url.pathname === "/trpc/start") {
        const input = String(Object(parse(body)).message?.id)
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: "workspace_12345678-1234-1234-1234-123456789abc",
              kiloSessionId: SESSION,
              messageId: input,
              delivery: "queued",
              replayed: false,
            },
          },
        })
      }
      return Response.json({ error: "KILO_SESSION_NOT_FOUND" }, { status: 404 })
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

function layer(url: string) {
  const host = SessionHost.layer({ env: { CLOUD_AGENT_NEXT_BASE_URL: url } }).pipe(
    Layer.provide(Layer.succeed(Auth.Service, auth())),
  )
  return HttpRouter.serve(
    HttpApiBuilder.layer(TestHttpApi).pipe(
      Layer.provide(sessionHostHandlers),
      Layer.provide(schemaErrorLayer),
      Layer.provide([
        Layer.succeed(Authorization, Authorization.of((effect) => effect)),
        host,
        AppNodeBuilder.build(EventV2Bridge.node),
      ]),
      Layer.provide(AppNodeBuilder.build(Database.node)),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
}

const app = harness()
const it = testEffect(layer(app.url))

afterEach(() => Attachments.store.clear())
afterAll(() => app.stop())

describe("session host HttpApi", () => {
  it.live("reports the registered provider without exposing provider internals", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(SessionHostPaths.provider)
      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        providers: [
          {
            id: "kilo-cloud",
            default: true,
            availability: { state: "available" },
            transport: { state: "unknown" },
          },
        ],
      })
    }),
  )

  it.live("lists, reads, and pages hosted sessions through the local API", () =>
    Effect.gen(function* () {
      const list = yield* HttpClient.get(`${SessionHostPaths.session}?limit=5`)
      expect(list.status).toBe(200)
      expect(yield* list.json).toMatchObject({ items: [{ id: { sessionID: SESSION } }] })

      const detail = yield* HttpClient.get(
        SessionHostPaths.sessionDetail.replace(":providerID", "kilo-cloud").replace(":sessionID", SESSION),
      )
      expect(detail.status).toBe(200)

      const transcript = yield* HttpClient.get(
        SessionHostPaths.message.replace(":providerID", "kilo-cloud").replace(":sessionID", SESSION),
      )
      expect(transcript.status).toBe(200)
      expect(yield* transcript.json).toMatchObject({ items: [{ parts: [{ type: "text" }] }] })

      expect(app.calls.some((call) => call.path.endsWith("/event"))).toBe(false)
    }),
  )

  it.live("returns an opaque attachment that carries no provider origin, credential, or selector", () =>
    Effect.gen(function* () {
      const announced: Array<{ state?: unknown; sessionID?: unknown }> = []
      const handler = (event: GlobalEvent) => {
        const payload: unknown = event.payload
        if (typeof payload !== "object" || payload === null) return
        if (!("type" in payload) || payload.type !== "session.host.availability") return
        if (!("properties" in payload) || typeof payload.properties !== "object" || payload.properties === null) return
        announced.push({
          ...("state" in payload.properties ? { state: payload.properties.state } : {}),
          ...("sessionID" in payload.properties ? { sessionID: payload.properties.sessionID } : {}),
        })
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", handler)),
        () => Effect.sync(() => GlobalBus.off("event", handler)),
      )

      const response = yield* HttpClient.post(
        SessionHostPaths.attach.replace(":providerID", "kilo-cloud").replace(":sessionID", SESSION),
      )
      expect(response.status).toBe(200)
      const body: unknown = yield* response.json
      expect(body).toBeTypeOf("object")
      const record = Object(body)
      const id = String(record.attachmentID)
      expect(Object.keys(record).sort()).toEqual(["attachmentID", "expiresAt", "session"])
      expect(Attachments.isID(id)).toBe(true)
      const text = JSON.stringify(body)
      for (const secret of [app.url, TOKEN, "directory", "agent_", "workspace_", "fence", "resnapshot"]) {
        expect(text).not.toContain(secret)
      }

      const detach = yield* HttpClient.execute(
        HttpClientRequest.delete(SessionHostPaths.attachment.replace(":attachmentID", id)),
      )
      expect(detach.status).toBe(200)
      expect(yield* detach.json).toEqual({ detached: true })

      yield* pollWithTimeout(
        Effect.sync(() => (announced.length >= 2 ? announced : undefined)),
        "hosted availability events should reach the global stream",
      )
      expect(announced).toEqual([
        { state: "available", sessionID: SESSION },
        { state: "unavailable", sessionID: SESSION },
      ])

      const again = yield* HttpClient.execute(
        HttpClientRequest.delete(SessionHostPaths.attachment.replace(":attachmentID", id)),
      )
      expect(again.status).toBe(410)

      const missing = yield* HttpClient.execute(
        HttpClientRequest.delete(SessionHostPaths.attachment.replace(":attachmentID", Attachments.createID())),
      )
      expect(missing.status).toBe(404)

      const malformed = yield* HttpClient.execute(
        HttpClientRequest.delete(SessionHostPaths.attachment.replace(":attachmentID", "not-an-attachment")),
      )
      expect(malformed.status).toBe(404)
    }),
  )

  it.live("keeps the session available until its final attachment is detached", () =>
    Effect.gen(function* () {
      const events: string[] = []
      const handler = (event: GlobalEvent) => {
        const payload: unknown = event.payload
        if (typeof payload !== "object" || payload === null || !("type" in payload)) return
        if (payload.type !== "session.host.availability" || !("properties" in payload)) return
        const properties = Object(payload.properties)
        if (properties.state === "unavailable") events.push(String(properties.state))
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", handler)),
        () => Effect.sync(() => GlobalBus.off("event", handler)),
      )
      const path = SessionHostPaths.attach.replace(":providerID", "kilo-cloud").replace(":sessionID", SESSION)
      const first = Object(yield* (yield* HttpClient.post(path)).json)
      const second = Object(yield* (yield* HttpClient.post(path)).json)

      yield* HttpClient.execute(HttpClientRequest.delete(SessionHostPaths.attachment.replace(":attachmentID", first.attachmentID)))
      expect(events).toEqual([])
      yield* HttpClient.execute(HttpClientRequest.delete(SessionHostPaths.attachment.replace(":attachmentID", second.attachmentID)))
      yield* pollWithTimeout(
        Effect.sync(() => (events.length === 1 ? true : undefined)),
        "the final detach should publish unavailable",
      )
    }),
  )

  it.live("starts a hosted session with caller-supplied idempotency fields", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(SessionHostPaths.session).pipe(
        HttpClientRequest.bodyJson({
          repository: { type: "github", repo: "owner/repo" },
          prompt: "hello",
          agent: { mode: "build", model: "test/fake" },
          operationKey: "11111111-1111-4111-8111-111111111111",
          messageID: "msg_00000000000000000000000002",
        }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(response.status).toBe(200)
      expect(yield* response.json).toMatchObject({ session: { sessionID: SESSION }, replayed: false })
    }),
  )
})
