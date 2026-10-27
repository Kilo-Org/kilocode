import * as Attachments from "@/kilocode/server/hosted-attachments"
import { SessionHostApi, SessionHostPaths } from "@/kilocode/server/httpapi/groups/session-host"
import { sessionHostHandlers } from "@/kilocode/server/httpapi/handlers/session-host"
import { SessionHost } from "@/kilocode/session-hosting"
import { HostedWorkspaceID } from "@/kilocode/session-hosting/types"
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
import { hosted, provider as fixture } from "./hosted-fixture"

const SESSION = "ses_00000000000000000000000001"
const OTHER = "ses_00000000000000000000000002"
const SESSION2 = "ses_00000000000000000000000003"
const WORKSPACE = "worktree_12345678-1234-1234-1234-123456789abc"
const OTHER_WORKSPACE = "worktree_87654321-4321-4321-8321-cba987654321"
const CLOUD = "workspace_12345678-1234-1234-1234-123456789abc"
const CONTROL = "kilo-test-control-value"
const PROFILE = "33333333-3333-4333-8333-333333333333"
const MESSAGE = "msg_00000000000000000000000009"
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

function workspaceStatus(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE,
    deletionState: "active",
    observedAt: 500,
    compute: {
      status: "sleeping",
      detailCode: "sandbox_stopped",
      observedAt: 490,
      estimatedSleepAt: null,
    },
    activity: { activeSessionCount: 2, hasActiveTurn: false },
    wakeOnInput: { available: true, blockedReason: null },
    billing: {
      payer: { type: "org", id: "org_private_payer_identifier" },
      sku: "hosted-workspace",
      blocked: false,
      enforcementRequested: false,
      intervalStartedAt: 400,
      rate: { rateCentsPerSecond: "0.0125", estimatedHourlyMicrodollars: 450 },
    },
    deletion: {
      started: false,
      completed: false,
      startedAt: null,
      phase: "not_started",
      sessionCount: 2,
      runtimeLocationCount: 2,
      completedRuntimeLocationCount: 0,
      remainingRuntimeLocationCount: 2,
      deletedSessionIds: ["ses_private_deleted_identifier"],
    },
    ...overrides,
  }
}

type State = {
  token: "ok" | "invalid"
  catalog: "single" | "two"
  workspace: "ok" | "missing"
  status: "ok" | "missing"
  remove: "ok" | "invalid" | "unauthorized" | "conflict" | "unavailable"
}

function workspaceSession(kiloSessionId: string, workspaceId: string) {
  return {
    kiloSessionId,
    cloudAgentSessionId: CLOUD,
    workspaceId,
    userId: "user_1",
    organizationId: null,
    title: "Root chat",
    gitUrl: "https://github.com/Kilo-Org/kilocode",
    gitBranch: "main",
    profileId: PROFILE,
    createdOnPlatform: "agent-manager",
    created: 100,
    updated: 200,
  }
}

function workspaceSummary(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE,
    userId: "user_1",
    organizationId: null,
    name: "Fix the thing",
    repositoryProvider: "github",
    gitUrl: "https://github.com/Kilo-Org/kilocode",
    gitBranch: "main",
    profileId: PROFILE,
    deletionState: "active",
    created: 100,
    updated: 200,
    lastActivity: 300,
    sessions: [workspaceSession(SESSION, WORKSPACE)],
    nextSessionCursor: null,
    ...overrides,
  }
}

function harness(initial: Partial<State> = {}) {
  const calls: Array<{ method: string; path: string; search: string; auth: string | null; body: string }> = []
  const state: State = {
    token: "ok",
    catalog: "single",
    workspace: "ok",
    status: "ok",
    remove: "ok",
    ...initial,
  }
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
        auth: request.headers.get("authorization"),
        body,
      })
      if (url.pathname === "/api/cloud-agent-next/token") {
        if (state.token === "invalid") return new Response("invalid", { status: 418 })
        return Response.json({ token: CONTROL, expiresAt: new Date(Date.now() + 600_000).toISOString() })
      }
      if (url.pathname === "/kilo/session" && request.method === "GET") {
        return Response.json([sessionInfo(SESSION)])
      }
      if (url.pathname === `/kilo/session/${SESSION}`) return Response.json(sessionInfo(SESSION))
      if (url.pathname === `/kilo/session/${OTHER}`) return Response.json(sessionInfo(OTHER))
      if (url.pathname === `/kilo/session/${SESSION2}`) return Response.json(sessionInfo(SESSION2))
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
      if (url.pathname === "/api/trpc/agentProfiles.list") {
        return Response.json({
          result: {
            data: {
              json: [
                {
                  id: PROFILE,
                  name: "Default",
                  description: null,
                  isDefault: true,
                  varCount: 2,
                  varValues: ["SECRET_VALUE"],
                },
              ],
            },
          },
        })
      }
      if (url.pathname === "/trpc/listHostedWorkspaces") {
        if (state.catalog === "two") {
          return Response.json({
            result: {
              data: {
                items: [
                  workspaceSummary({
                    sessions: [workspaceSession(SESSION, WORKSPACE), workspaceSession(OTHER, WORKSPACE)],
                  }),
                  workspaceSummary({
                    workspaceId: OTHER_WORKSPACE,
                    sessions: [workspaceSession(SESSION2, OTHER_WORKSPACE)],
                  }),
                ],
                nextCursor: null,
              },
            },
          })
        }
        return Response.json({ result: { data: { items: [workspaceSummary()], nextCursor: "cursor-2" } } })
      }
      if (url.pathname === "/trpc/getHostedWorkspace") {
        const input = Object(parse(url.searchParams.get("input") ?? "{}"))
        if (state.workspace === "missing" || input.workspaceId !== WORKSPACE) {
          if (input.workspaceId === OTHER_WORKSPACE) {
            return Response.json({
              result: {
                data: workspaceSummary({
                  workspaceId: OTHER_WORKSPACE,
                  sessions: [workspaceSession(SESSION2, OTHER_WORKSPACE)],
                }),
              },
            })
          }
          return Response.json({ result: { data: null } })
        }
        return Response.json({ result: { data: workspaceSummary({ nextSessionCursor: "session-cursor-1" }) } })
      }
      if (url.pathname === "/trpc/getHostedWorkspaceStatus") {
        const input = Object(parse(url.searchParams.get("input") ?? "{}"))
        if (state.status === "missing" || input.workspaceId !== WORKSPACE) {
          return Response.json({ error: "NOT_FOUND" }, { status: 404 })
        }
        return Response.json({ result: { data: workspaceStatus() } })
      }
      if (url.pathname === "/trpc/deleteWorktree") {
        if (state.remove === "unauthorized") return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
        if (state.remove === "conflict") return Response.json({ error: "CONFLICT" }, { status: 409 })
        if (state.remove === "unavailable") return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 })
        if (state.remove === "invalid") return Response.json({ result: { data: { success: true } } })
        return Response.json({
          result: { data: { success: true, deletedSessionIds: [SESSION, OTHER, SESSION2] } },
        })
      }
      if (url.pathname === "/trpc/createHostedWorkspace") {
        const input = Object(parse(body))
        return Response.json({
          result: {
            data: {
              workspaceId: WORKSPACE,
              cloudAgentSessionId: CLOUD,
              kiloSessionId: SESSION,
              messageId: input.message?.id,
              replayed: false,
            },
          },
        })
      }
      if (url.pathname === "/trpc/createHostedWorkspaceSession") {
        const input = Object(parse(body))
        return Response.json({
          result: {
            data: {
              workspaceId: input.workspaceId,
              cloudAgentSessionId: CLOUD,
              kiloSessionId: OTHER,
              messageId: input.message?.id,
              replayed: false,
            },
          },
        })
      }
      return Response.json({ error: "KILO_SESSION_NOT_FOUND" }, { status: 404 })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, calls, state, stop: () => server.stop(true) }
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
  const host = SessionHost.layer({
    env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_WEB_APP_URL: url, KILO_API_URL: url },
  }).pipe(Layer.provide(Layer.succeed(Auth.Service, auth())))
  return HttpRouter.serve(
    HttpApiBuilder.layer(TestHttpApi).pipe(
      Layer.provide(sessionHostHandlers),
      Layer.provide(schemaErrorLayer),
      Layer.provide([
        Layer.succeed(
          Authorization,
          Authorization.of((effect) => effect),
        ),
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
const issuer = harness({ token: "invalid" })
const itIssuer = testEffect(layer(issuer.url))

afterEach(() => {
  Attachments.store.clear()
  app.state.catalog = "single"
  app.state.workspace = "ok"
  app.state.status = "ok"
  app.state.remove = "ok"
})
afterAll(() => {
  void app.stop()
  void issuer.stop()
})

const workspacePath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceDetail.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const statusPath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceStatus.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const sessionsPath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceSession.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const attachPath = (sessionID = SESSION) =>
  SessionHostPaths.attach.replace(":providerID", "kilo-cloud").replace(":sessionID", sessionID)

const attach = (sessionID = SESSION) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.post(attachPath(sessionID))
    expect(response.status).toBe(200)
    return String(Object(yield* response.json).attachmentID)
  })

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

      yield* HttpClient.execute(
        HttpClientRequest.delete(SessionHostPaths.attachment.replace(":attachmentID", first.attachmentID)),
      )
      expect(events).toEqual([])
      yield* HttpClient.execute(
        HttpClientRequest.delete(SessionHostPaths.attachment.replace(":attachmentID", second.attachmentID)),
      )
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

  it.live("lists and reads hosted workspaces with cursor preservation and no private identity", () =>
    Effect.gen(function* () {
      const list = yield* HttpClient.get(`${SessionHostPaths.workspace}?limit=5&sessionLimit=2`)
      expect(list.status).toBe(200)
      const page: unknown = yield* list.json
      expect(page).toMatchObject({
        items: [
          {
            id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
            repository: { provider: "github", url: "https://github.com/Kilo-Org/kilocode", branch: "main" },
            profileID: PROFILE,
            deletionState: "active",
            sessions: [{ id: { providerID: "kilo-cloud", sessionID: SESSION } }],
          },
        ],
        cursor: "cursor-2",
      })
      const text = JSON.stringify(page)
      for (const secret of [app.url, TOKEN, CLOUD, "cloudAgentSessionId"]) expect(text).not.toContain(secret)

      const detail = yield* HttpClient.get(
        SessionHostPaths.workspaceDetail.replace(":providerID", "kilo-cloud").replace(":workspaceID", WORKSPACE),
      )
      expect(detail.status).toBe(200)
      expect(yield* detail.json).toMatchObject({ id: { workspaceID: WORKSPACE }, cursor: "session-cursor-1" })

      const missing = yield* HttpClient.get(
        SessionHostPaths.workspaceDetail
          .replace(":providerID", "kilo-cloud")
          .replace(":workspaceID", "worktree_00000000-0000-4000-8000-000000000000"),
      )
      expect(missing.status).toBe(404)
    }),
  )

  it.live("lists workspace sessions as a projection of the workspace detail read", () =>
    Effect.gen(function* () {
      const path = SessionHostPaths.workspaceSession
        .replace(":providerID", "kilo-cloud")
        .replace(":workspaceID", WORKSPACE)
      const response = yield* HttpClient.get(`${path}?limit=2&cursor=session-cursor-0&organizationID=${PROFILE}`)
      expect(response.status).toBe(200)
      const body: unknown = yield* response.json
      expect(body).toEqual({
        items: [
          {
            id: { providerID: "kilo-cloud", sessionID: SESSION },
            title: "Root chat",
            createdOnPlatform: "agent-manager",
            created: 100,
            updated: 200,
          },
        ],
        cursor: "session-cursor-1",
      })

      const text = JSON.stringify(body)
      for (const secret of [app.url, TOKEN, CLOUD, "cloudAgentSessionId", "kiloSessionId"]) {
        expect(text).not.toContain(secret)
      }

      const call = app.calls.at(-1)
      expect(call?.path).toBe("/trpc/getHostedWorkspace")
      expect(Object(parse(new URL(call?.search ?? "", app.url).searchParams.get("input") ?? "{}"))).toEqual({
        workspaceId: WORKSPACE,
        sessionLimit: 2,
        sessionCursor: "session-cursor-0",
      })

      const missing = yield* HttpClient.get(
        SessionHostPaths.workspaceSession
          .replace(":providerID", "kilo-cloud")
          .replace(":workspaceID", "worktree_00000000-0000-4000-8000-000000000000"),
      )
      expect(missing.status).toBe(404)
    }),
  )

  it.live("reads passive workspace status without waking compute or leaking payer identity", () =>
    Effect.gen(function* () {
      const path = SessionHostPaths.workspaceStatus
        .replace(":providerID", "kilo-cloud")
        .replace(":workspaceID", WORKSPACE)
      const response = yield* HttpClient.get(`${path}?organizationID=${PROFILE}`)
      expect(response.status).toBe(200)
      const body: unknown = yield* response.json
      expect(body).toMatchObject({
        id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
        deletionState: "active",
        compute: { status: "sleeping", detailCode: "sandbox_stopped", estimatedSleepAt: null },
        activity: { activeSessionCount: 2, hasActiveTurn: false },
        wakeOnInput: { available: true, blockedReason: null },
        billing: { payer: "org", sku: "hosted-workspace", blocked: false, intervalStartedAt: 400 },
        deletion: { phase: "not_started", startedAt: null, remainingRuntimeLocationCount: 2 },
      })

      const text = JSON.stringify(body)
      for (const secret of [
        app.url,
        TOKEN,
        CLOUD,
        "org_private_payer_identifier",
        "ses_private_deleted_identifier",
        "deletedSessionIds",
      ]) {
        expect(text).not.toContain(secret)
      }

      const call = app.calls.at(-1)
      expect(call?.path).toBe("/trpc/getHostedWorkspaceStatus")
      expect(Object(parse(new URL(call?.search ?? "", app.url).searchParams.get("input") ?? "{}"))).toEqual({
        workspaceId: WORKSPACE,
        kilocodeOrganizationId: PROFILE,
      })

      const missing = yield* HttpClient.get(
        SessionHostPaths.workspaceStatus
          .replace(":providerID", "kilo-cloud")
          .replace(":workspaceID", "worktree_00000000-0000-4000-8000-000000000000"),
      )
      expect(missing.status).toBe(404)
    }),
  )

  it.live("lists authorized workspace profiles without profile secret inputs", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(`${SessionHostPaths.workspaceProfiles}?organizationID=${PROFILE}`)
      expect(response.status).toBe(200)
      const body: unknown = yield* response.json
      expect(body).toEqual({
        items: [{ id: PROFILE, name: "Default", description: null, isDefault: true }],
      })
      expect(JSON.stringify(body)).not.toContain("SECRET_VALUE")
      expect(JSON.stringify(body)).not.toContain("varCount")
      const call = app.calls.at(-1)
      expect(call?.path).toBe("/api/trpc/agentProfiles.list")
      expect(call?.auth).toBe(`Bearer ${TOKEN}`)
    }),
  )

  it.live("creates a workspace and starts another session in it with caller-supplied idempotency", () =>
    Effect.gen(function* () {
      const created = yield* HttpClientRequest.post(SessionHostPaths.workspace).pipe(
        HttpClientRequest.bodyJson({
          repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
          profile: { id: PROFILE },
          prompt: "hello",
          agent: { mode: "build", model: "test/fake" },
          operationKey: "11111111-1111-4111-8111-111111111111",
          messageID: MESSAGE,
        }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(created.status).toBe(200)
      const result: unknown = yield* created.json
      expect(result).toMatchObject({
        workspace: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
        session: { providerID: "kilo-cloud", sessionID: SESSION },
        messageID: MESSAGE,
        replayed: false,
      })
      expect(JSON.stringify(result)).not.toContain(CLOUD)

      const call = app.calls.find((item) => item.path === "/trpc/createHostedWorkspace")
      expect(call?.body).toContain('"clientProvenance":"agent-manager"')
      expect(call?.body).toContain(`"id":"${MESSAGE}"`)
      // The issuer sees the source credential; the Worker sees only the control token.
      const issued = app.calls.find((item) => item.path === "/api/cloud-agent-next/token")
      expect(issued?.auth).toBe(`Bearer ${TOKEN}`)
      expect(issued?.body).toBe("{}")
      expect(call?.auth).toBe(`Bearer ${CONTROL}`)

      const started = yield* HttpClientRequest.post(
        SessionHostPaths.workspaceSession.replace(":providerID", "kilo-cloud").replace(":workspaceID", WORKSPACE),
      ).pipe(
        HttpClientRequest.bodyJson({
          prompt: "again",
          agent: { mode: "build", model: "test/fake" },
          operationKey: "22222222-2222-4222-8222-222222222222",
          messageID: "msg_0000000000000000000000000a",
        }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(started.status).toBe(200)
      expect(yield* started.json).toMatchObject({
        workspace: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
        session: { providerID: "kilo-cloud", sessionID: OTHER },
        messageID: "msg_0000000000000000000000000a",
      })

      const sessionCall = app.calls.find((item) => item.path === "/trpc/createHostedWorkspaceSession")
      expect(sessionCall?.body).toContain(`"workspaceId":"${WORKSPACE}"`)
    }),
  )

  it.live("deletes a workspace and invalidates every attachment in it", () =>
    Effect.gen(function* () {
      app.state.catalog = "two"
      const first = yield* attach(SESSION)
      const second = yield* attach(SESSION)
      const sibling = yield* attach(OTHER)
      const survivor = yield* attach(SESSION2)

      const response = yield* HttpClient.execute(HttpClientRequest.delete(workspacePath()))
      expect(response.status).toBe(200)
      const body: unknown = yield* response.json
      expect(body).toEqual({
        workspace: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
        success: true,
      })
      expect(JSON.stringify(body)).not.toContain("deletedSessionIds")

      for (const id of [first, second, sibling]) {
        expect(Attachments.store.lookup(id).kind).toBe("disposed")
      }
      expect(Attachments.store.lookup(survivor).kind).toBe("found")

      const call = app.calls.filter((item) => item.path === "/trpc/deleteWorktree").at(-1)
      expect(Object(parse(call?.body ?? "{}"))).toEqual({ worktreeId: WORKSPACE })
    }),
  )

  it.live("invalidates workspace attachments when its reads report not found", () =>
    Effect.gen(function* () {
      const first = yield* attach()
      app.state.workspace = "missing"
      expect((yield* HttpClient.get(workspacePath())).status).toBe(404)
      expect(Attachments.store.lookup(first).kind).toBe("disposed")

      app.state.workspace = "ok"
      const second = yield* attach()
      app.state.status = "missing"
      expect((yield* HttpClient.get(statusPath())).status).toBe(404)
      expect(Attachments.store.lookup(second).kind).toBe("disposed")

      app.state.status = "ok"
      const third = yield* attach()
      app.state.workspace = "missing"
      expect((yield* HttpClient.get(sessionsPath())).status).toBe(404)
      expect(Attachments.store.lookup(third).kind).toBe("disposed")
    }),
  )

  it.live("invalidates workspace attachments when a dispatched deletion response is malformed", () =>
    Effect.gen(function* () {
      const id = yield* attach()
      app.state.remove = "invalid"
      const response = yield* HttpClient.execute(HttpClientRequest.delete(workspacePath()))
      expect(response.status).toBe(502)
      expect(Attachments.store.lookup(id).kind).toBe("disposed")
    }),
  )

  it.live("preserves workspace attachments when deletion is rejected or unreachable", () =>
    Effect.gen(function* () {
      const id = yield* attach()
      for (const [state, status] of [
        ["unauthorized", 401],
        ["conflict", 409],
        ["unavailable", 503],
      ] as const) {
        app.state.remove = state
        const response = yield* HttpClient.execute(HttpClientRequest.delete(workspacePath()))
        expect(response.status).toBe(status)
        expect(Attachments.store.lookup(id).kind).toBe("found")
      }
    }),
  )

  itIssuer.live("preserves workspace attachments when the issuer response is invalid", () =>
    Effect.gen(function* () {
      const fake = fixture("kilo-cloud")
      const entry = Attachments.store.mint({
        provider: fake.value,
        session: hosted("kilo-cloud", SESSION),
        workspace: Schema.decodeUnknownSync(HostedWorkspaceID)({
          providerID: "kilo-cloud",
          workspaceID: WORKSPACE,
        }),
        expiresAt: Date.now() + 60_000,
      })

      const response = yield* HttpClient.execute(HttpClientRequest.delete(workspacePath()))
      expect(response.status).toBe(502)
      expect(Attachments.store.lookup(entry.id).kind).toBe("found")
    }),
  )
})
