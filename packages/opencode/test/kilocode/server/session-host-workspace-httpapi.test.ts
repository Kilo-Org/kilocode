import * as Attachments from "@/kilocode/server/hosted-attachments"
import { SessionHostApi, SessionHostPaths } from "@/kilocode/server/httpapi/groups/session-host"
import { sessionHostHandlers } from "@/kilocode/server/httpapi/handlers/session-host"
import { SessionHost } from "@/kilocode/session-hosting"
import { Auth } from "@/auth"
import { ProviderID } from "@/kilocode/session-hosting/types"
import { Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "@/server/routes/instance/httpapi/middleware/schema-error"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { NodeHttpServer } from "@effect/platform-node"
import { afterAll, afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { testEffect } from "../../lib/effect"

const TOKEN = "kilo-test-bearer-value"
const ORG = "22222222-2222-4222-8222-222222222222"
const WORKSPACE = "worktree_12345678-1234-1234-1234-123456789abc"
const REMOTE = "workspace_12345678-1234-1234-1234-123456789abc"
const NATIVE = "ses_00000000000000000000000001"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"
const OPERATION = "11111111-1111-4111-8111-111111111111"

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(SessionHostApi)

function session(overrides: Record<string, unknown> = {}) {
  return {
    kiloSessionId: NATIVE,
    cloudAgentSessionId: REMOTE,
    workspaceId: WORKSPACE,
    organizationId: ORG,
    title: "Hosted root",
    profileId: "profile_1",
    created: 100,
    updated: 200,
    ...overrides,
  }
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE,
    organizationId: ORG,
    name: "Cloud workspace",
    repositoryProvider: "github",
    gitUrl: "https://github.com/Kilo-Org/kilocode.git",
    gitBranch: "main",
    profileId: "profile_1",
    deletionState: "active",
    created: 100,
    updated: 200,
    lastActivity: 300,
    sessions: [session()],
    nextSessionCursor: null,
    userId: "user_private",
    sandboxId: "sandbox_private",
    ...overrides,
  }
}

function harness() {
  const calls: Array<{ method: string; path: string; search: string; body: string }> = []
  const state = {
    workspace: "ok" as "ok" | "missing",
    native: "ok" as "ok" | "deleted",
    deletion: "ok" as "ok" | "invalid" | "malformed" | "conflict" | "unavailable",
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "POST" ? await request.text() : ""
      calls.push({ method: request.method, path: url.pathname, search: url.search, body })

      if (url.pathname === "/trpc/listHostedWorkspaces") {
        return Response.json({ result: { data: { items: [workspace()], nextCursor: null } } })
      }
      if (url.pathname === "/trpc/getHostedWorkspace") {
        if (state.workspace === "missing") return Response.json({ result: { data: null } })
        return Response.json({ result: { data: workspace() } })
      }
      if (url.pathname === "/trpc/getHostedWorkspaceStatus") {
        if (state.workspace === "missing") {
          return Response.json({ error: "workspace_not_found" }, { status: 404 })
        }
        return Response.json({
          result: {
            data: {
              workspaceId: WORKSPACE,
              deletionState: "active",
              observedAt: 1_000,
              compute: {
                status: "sleeping",
                detailCode: "sandbox_stopped",
                observedAt: 990,
                estimatedSleepAt: null,
              },
              activity: { activeSessionCount: 0, hasActiveTurn: false },
              wakeOnInput: { available: true, blockedReason: null },
              billing: {
                payer: { type: "org", id: "org_private" },
                sku: "cloud-agent",
                blocked: false,
                enforcementRequested: false,
                intervalStartedAt: null,
                rate: { rateCentsPerSecond: "0.01", estimatedHourlyMicrodollars: 360_000 },
              },
              deletion: {
                started: false,
                completed: false,
                startedAt: null,
                phase: "not_started",
                sessionCount: 1,
                runtimeLocationCount: 1,
                completedRuntimeLocationCount: 1,
                remainingRuntimeLocationCount: 0,
                deletedSessionIds: [],
              },
              provider: "private-provider",
            },
          },
        })
      }
      if (url.pathname === "/trpc/createHostedWorkspace") {
        return Response.json({
          result: {
            data: {
              workspaceId: WORKSPACE,
              cloudAgentSessionId: REMOTE,
              kiloSessionId: NATIVE,
              messageId: MESSAGE,
              replayed: false,
            },
          },
        })
      }
      if (url.pathname === "/trpc/createHostedWorkspaceSession") {
        return Response.json({
          result: {
            data: {
              workspaceId: WORKSPACE,
              cloudAgentSessionId: REMOTE,
              kiloSessionId: NATIVE,
              messageId: MESSAGE,
              replayed: true,
            },
          },
        })
      }
      if (url.pathname === "/trpc/deleteWorktree") {
        if (state.deletion === "invalid") return Response.json({ result: { data: { success: true } } })
        if (state.deletion === "malformed") return new Response("not-json", { status: 200 })
        if (state.deletion === "conflict") return Response.json({ error: "workspace_deleting" }, { status: 409 })
        if (state.deletion === "unavailable") return Response.json({ error: "unavailable" }, { status: 503 })
        return Response.json({ result: { data: { success: true, deletedSessionIds: [NATIVE] } } })
      }
      if (url.pathname === "/api/trpc/agentProfiles.list") {
        return Response.json({
          result: {
            data: { json: [{ id: "profile_1", name: "Default", description: null, isDefault: true, varCount: 2 }] },
          },
        })
      }
      if (url.pathname === `/kilo/session/${NATIVE}/message`) {
        if (state.native === "deleted") {
          return Response.json({ error: "KILO_SESSION_NOT_FOUND" }, { status: 404 })
        }
        return Response.json({ ok: true })
      }
      return Response.json({ error: "not found" }, { status: 404 })
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
    env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_API_URL: url },
  }).pipe(Layer.provide(Layer.succeed(Auth.Service, auth())))
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

afterEach(() => {
  Attachments.store.clear()
  app.state.workspace = "ok"
  app.state.deletion = "ok"
})
afterAll(() => app.stop())

const detail = SessionHostPaths.workspaceDetail
  .replace(":providerID", "kilo-cloud")
  .replace(":workspaceID", WORKSPACE)
const statusPath = SessionHostPaths.workspaceStatus
  .replace(":providerID", "kilo-cloud")
  .replace(":workspaceID", WORKSPACE)
const sessionsPath = SessionHostPaths.workspaceSessions
  .replace(":providerID", "kilo-cloud")
  .replace(":workspaceID", WORKSPACE)
const attachPath = SessionHostPaths.workspaceSessionAttach
  .replace(":providerID", "kilo-cloud")
  .replace(":workspaceID", WORKSPACE)
  .replace(":remoteSessionID", REMOTE)

const PROVIDER = Schema.decodeUnknownSync(ProviderID)("kilo-cloud")

function attached() {
  return Attachments.store.mint({
    provider: {
      id: PROVIDER,
      availability: Effect.succeed({ state: "available" }),
      transport: Effect.succeed({ state: "unknown" }),
      list: () => Effect.succeed({ items: [] }),
      get: () => Effect.die("unused"),
      transcript: () => Effect.die("unused"),
      start: () => Effect.die("unused"),
      attach: () => Effect.die("unused"),
      route: () =>
        Effect.succeed(Response.json({ error: "KILO_SESSION_NOT_FOUND" }, { status: 404 })),
    },
    session: { providerID: PROVIDER, sessionID: NATIVE },
    workspace: {
      id: { providerID: PROVIDER, workspaceID: WORKSPACE },
      remoteSessionID: REMOTE,
    },
    expiresAt: Date.now() + 60_000,
  })
}

describe("session host workspace HttpApi", () => {
  it.live("lists, reads, pages, and reports passive status without leaking internals", () =>
    Effect.gen(function* () {
      const list = yield* HttpClient.get(`${SessionHostPaths.workspace}?limit=5&sessionLimit=2`)
      expect(list.status).toBe(200)
      const page: unknown = yield* list.json
      expect(page).toMatchObject({
        items: [
          {
            id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
            repository: {
              type: "github",
              url: "https://github.com/Kilo-Org/kilocode.git",
              branch: "main",
            },
            sessions: [
              {
                id: {
                  providerID: "kilo-cloud",
                  workspaceID: WORKSPACE,
                  remoteSessionID: REMOTE,
                  nativeSessionID: NATIVE,
                },
              },
            ],
          },
        ],
      })
      expect(JSON.stringify(page)).not.toContain("user_private")
      expect(JSON.stringify(page)).not.toContain("sandbox_private")

      const get = yield* HttpClient.get(`${detail}?sessionLimit=2`)
      expect(get.status).toBe(200)

      const sessions = yield* HttpClient.get(`${sessionsPath}?limit=2`)
      expect(sessions.status).toBe(200)
      expect(yield* sessions.json).toMatchObject({ items: [{ id: { nativeSessionID: NATIVE } }], nextCursor: null })

      const status = yield* HttpClient.get(statusPath)
      expect(status.status).toBe(200)
      const body: unknown = yield* status.json
      expect(body).toMatchObject({
        compute: { status: "sleeping", detailCode: "sandbox_stopped" },
        billing: { payer: "org" },
        deletion: { phase: "not_started" },
      })
      expect(JSON.stringify(body)).not.toContain("org_private")
      expect(JSON.stringify(body)).not.toContain("private-provider")
    }),
  )

  it.live("creates a workspace with its first session and a sibling session", () =>
    Effect.gen(function* () {
      const created = yield* HttpClientRequest.post(SessionHostPaths.workspace).pipe(
        HttpClientRequest.bodyJson({
          repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
          profileID: "profile_1",
          prompt: "Ship it",
          agent: { mode: "code", model: "kilo/test-model" },
          organizationID: ORG,
          operationKey: OPERATION,
          messageID: MESSAGE,
        }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(created.status).toBe(200)
      expect(yield* created.json).toEqual({
        workspace: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
        session: {
          providerID: "kilo-cloud",
          workspaceID: WORKSPACE,
          remoteSessionID: REMOTE,
          nativeSessionID: NATIVE,
        },
        messageID: MESSAGE,
        replayed: false,
      })
      expect(JSON.parse(app.calls.at(-1)!.body)).toMatchObject({
        operationKey: OPERATION,
        clientProvenance: "agent-manager",
        options: { kilocodeOrganizationId: ORG },
      })

      const sibling = yield* HttpClientRequest.post(sessionsPath).pipe(
        HttpClientRequest.bodyJson({
          prompt: "Another root",
          agent: { mode: "code", model: "kilo/test-model" },
          organizationID: ORG,
          operationKey: OPERATION,
          messageID: MESSAGE,
        }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(sibling.status).toBe(200)
      expect(yield* sibling.json).toMatchObject({ replayed: true })
      expect(JSON.parse(app.calls.at(-1)!.body)).toMatchObject({
        workspaceId: WORKSPACE,
        kilocodeOrganizationId: ORG,
      })
    }),
  )

  it.live("attaches to a listed workspace session and invalidates it after local deletion", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.post(attachPath)
      expect(response.status).toBe(200)
      const body: unknown = yield* response.json
      const record = Object(body)
      const attachmentID = String(record.attachmentID)
      expect(record).toMatchObject({
        workspace: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
        session: { nativeSessionID: NATIVE },
      })
      expect(Attachments.store.countWorkspace({ providerID: PROVIDER, workspaceID: WORKSPACE })).toBe(
        1,
      )

      const deleted = yield* HttpClient.execute(HttpClientRequest.delete(detail))
      expect(deleted.status).toBe(200)
      expect(yield* deleted.json).toMatchObject({ success: true, deletedSessionIDs: [NATIVE] })
      expect(
        Attachments.store.countWorkspace({ providerID: PROVIDER, workspaceID: WORKSPACE }),
      ).toBe(0)
      expect(Attachments.store.lookup(attachmentID).kind).toBe("disposed")
    }),
  )

  it.live("invalidates workspace attachments when another client deleted the workspace", () =>
    Effect.gen(function* () {
      const entry = attached()
      app.state.workspace = "missing"
      const get = yield* HttpClient.get(detail)
      expect(get.status).toBe(404)
      expect(Attachments.store.lookup(entry.id)).toMatchObject({ kind: "disposed" })
      app.state.workspace = "ok"
    }),
  )

  for (const mode of ["invalid", "malformed"] as const) {
    it.live(`invalidates attachments when a successful delete returns an ${mode} result`, () =>
      Effect.gen(function* () {
        const entry = attached()
        app.state.deletion = mode
        const response = yield* HttpClient.execute(HttpClientRequest.delete(detail))
        expect(response.status).toBe(502)
        expect(Attachments.store.lookup(entry.id)).toEqual({ kind: "disposed" })
      }),
    )
  }

  for (const [mode, status] of [
    ["conflict", 409],
    ["unavailable", 503],
  ] as const) {
    it.live(`preserves attachments when deletion fails with ${mode}`, () =>
      Effect.gen(function* () {
        const entry = attached()
        app.state.deletion = mode
        const response = yield* HttpClient.execute(HttpClientRequest.delete(detail))
        expect(response.status).toBe(status)
        expect(Attachments.store.lookup(entry.id)).toMatchObject({ kind: "found" })
      }),
    )
  }

  it.live("keeps control routes local even when an attachment selector is configured", () =>
    Effect.gen(function* () {
      const entry = attached()
      const response = yield* HttpClient.get(`${SessionHostPaths.workspace}?limit=5&workspace=${entry.id}`, {
        headers: { "x-kilo-workspace": entry.id },
      })
      expect(response.status).toBe(200)
      expect(yield* response.json).toMatchObject({ items: [{ id: { workspaceID: WORKSPACE } }] })
      expect(app.calls.some((call) => call.path.startsWith("/kilo/"))).toBe(false)
    }),
  )

  it.live("returns authorized profile summaries without secret values", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(`${SessionHostPaths.workspaceProfiles}?organizationID=${ORG}`)
      expect(response.status).toBe(200)
      const body: unknown = yield* response.json
      expect(body).toEqual({
        items: [{ id: "profile_1", name: "Default", description: null, isDefault: true }],
      })
      expect(JSON.stringify(body)).not.toContain("varCount")
      expect(app.calls.at(-1)!.path).toBe("/api/trpc/agentProfiles.list")
    }),
  )
})
