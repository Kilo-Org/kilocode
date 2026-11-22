import * as Attachments from "@/kilocode/server/hosted-attachments"
import { SessionHostApi, SessionHostPaths } from "@/kilocode/server/httpapi/groups/session-host"
import { sessionHostHandlers } from "@/kilocode/server/httpapi/handlers/session-host"
import { SessionHost, createRegistry } from "@/kilocode/session-hosting"
import { PROVIDER } from "@/kilocode/session-hosting/kilo-cloud"
import {
  HostedFailure,
  HostedWorkspaceID,
  WorkspacePullRequestResult,
  type WorkspacePullRequestInput,
} from "@/kilocode/session-hosting/types"
import { Auth } from "@/auth"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "@/server/routes/instance/httpapi/middleware/schema-error"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { AppRuntime } from "@/effect/app-runtime"
import { ContinuationIntentTable } from "@opencode-ai/core/kilocode/continuation/sql"
import { createKiloClient } from "@kilocode/sdk/v2"
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
const ACCOUNT = "oauth/account-wire"
const NEW_ONE = "ses_0000000000000000000000000a"
const MESSAGE = "msg_00000000000000000000000009"
const TOKEN = "kilo-test-bearer-value"
const ORG = "22222222-2222-4222-8222-222222222222"
const HEAD = "1111111111111111111111111111111111111111"
const OTHER_HEAD = "2222222222222222222222222222222222222222"
const BASE = "3333333333333333333333333333333333333333"

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

function summary(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://github.com/Kilo-Org/cloud/pull/142",
    number: 142,
    state: "open" as const,
    title: "Expose hosted workspace PR status",
    headSha: "a".repeat(40),
    lastSyncedAt: "2026-10-21T12:00:00.000Z",
    review: { decision: "approved" as const, available: true, pending: false },
    checks: { total: 2, passed: 2, failed: 0, pending: 0, skipped: 0, unknown: 0, complete: true, available: true },
    conversations: { unresolved: 0, complete: true },
    mergeability: { mergeable: true, state: "clean", complete: true },
    partial: false,
    unavailable: [],
    ...overrides,
  }
}

function comparison() {
  return { baseRef: "main", mergeBase: BASE, head: HEAD }
}

function workspaceChanges(files: Array<Record<string, unknown>>, revision = 12) {
  return {
    status: "captured",
    workspaceId: WORKSPACE,
    revision,
    capturedAt: "2026-11-14T00:00:00.000Z",
    truncated: false,
    comparisons: [
      {
        repository: null,
        comparison: comparison(),
        truncated: false,
        files,
      },
    ],
  }
}

function changeFile(path: string, scope?: string) {
  return {
    path,
    status: "modified",
    ...(scope === undefined ? {} : { scope }),
    additions: 2,
    deletions: 1,
    tracked: true,
    binary: false,
    countsComplete: true,
    revision: 12,
    repository: null,
    diff: { status: "available" },
    content: { status: "available", source: "current" },
  }
}

type State = {
  token: "ok" | "invalid"
  catalog: "single" | "two"
  workspace: "ok" | "missing"
  status: "ok" | "missing"
  changes: "captured" | "empty" | "missing" | "notfound" | "failure"
  file: "available" | "stale" | "omitted"
  pull: "linked" | "not_linked" | "unavailable"
  pullFile: "available" | "omitted" | "stale"
  remove: "ok" | "invalid" | "unauthorized" | "conflict" | "unavailable"
  continuation: "ok" | "balance" | "mismatch"
  pr?: { summary?: unknown; refresh?: unknown; status?: number; raw?: string; workspaceID?: string }
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
  const calls: Array<{
    method: string
    path: string
    search: string
    auth: string | null
    org: string | null
    body: string
  }> = []
  const state: State = {
    token: "ok",
    catalog: "single",
    workspace: "ok",
    status: "ok",
    changes: "captured",
    file: "available",
    pull: "linked",
    pullFile: "available",
    remove: "ok",
    continuation: "ok",
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
        org: request.headers.get("x-kilocode-organizationid"),
        body,
      })
      if (url.pathname === "/api/profile") {
        return Response.json({ user: { id: ACCOUNT } })
      }
      if (url.pathname === "/trpc/continueHostedWorkspace") {
        if (state.continuation === "balance") {
          return Response.json({ error: { message: "insufficient_balance" } }, { status: 402 })
        }
        if (state.continuation === "mismatch") {
          return Response.json({ error: { message: "operation_key_reuse_mismatch" } }, { status: 409 })
        }
        return Response.json({
          result: {
            data: {
              sessions: [
                {
                  sourceKiloSessionId: SESSION,
                  kiloSessionId: NEW_ONE,
                  cloudAgentSessionId: CLOUD,
                  agent: { mode: "build", model: "test/fake" },
                  modeFallback: false,
                },
              ],
              activeKiloSessionId: NEW_ONE,
            },
          },
        })
      }
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
      if (url.pathname === "/trpc/listHostedWorkspaceProfiles") {
        return Response.json({
          result: {
            data: {
              personalProfiles: [
                {
                  id: PROFILE,
                  name: "Default",
                  description: null,
                  ownerType: "user",
                  isPersonalDefault: true,
                  isOrganizationDefault: false,
                  varCount: 2,
                  varValues: ["SECRET_VALUE"],
                },
              ],
              organizationProfiles: [],
              personalDefaultProfileId: PROFILE,
              organizationDefaultProfileId: null,
              effectiveDefaultProfileId: PROFILE,
            },
          },
        })
      }
      if (url.pathname === "/trpc/setHostedWorkspacePersonalDefaultProfile") {
        return Response.json({ result: { data: { success: true } } })
      }
      if (url.pathname === "/trpc/clearHostedWorkspacePersonalDefaultProfile") {
        return Response.json({ result: { data: { success: true } } })
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
        return Response.json({
          result: {
            data: {
              items: [workspaceSummary(state.pr && "summary" in state.pr ? { pullRequest: state.pr.summary } : {})],
              nextCursor: "cursor-2",
            },
          },
        })
      }
      if (url.pathname === "/trpc/getHostedWorkspace") {
        if (state.pr?.status) return Response.json({ error: "private upstream failure" }, { status: state.pr.status })
        if (state.pr?.raw !== undefined) return new Response(state.pr.raw)
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
        return Response.json({
          result: {
            data: workspaceSummary({
              nextSessionCursor: "session-cursor-1",
              ...(state.pr && "summary" in state.pr ? { pullRequest: state.pr.summary } : {}),
              ...(state.pr?.workspaceID ? { workspaceId: state.pr.workspaceID } : {}),
            }),
          },
        })
      }
      if (url.pathname === "/trpc/refreshHostedWorkspacePullRequest") {
        if (state.pr?.status) return Response.json({ error: "private upstream failure" }, { status: state.pr.status })
        if (state.pr?.raw !== undefined) return new Response(state.pr.raw)
        return Response.json({
          result: {
            data: {
              workspaceId: state.pr?.workspaceID ?? WORKSPACE,
              pullRequest: state.pr?.summary,
              refresh: state.pr?.refresh ?? { status: "refreshed", retryAt: null },
              controlToken: CONTROL,
              ownerId: "private-owner",
              sandboxId: CLOUD,
            },
          },
        })
      }
      if (url.pathname === "/trpc/getHostedWorkspaceStatus") {
        const input = Object(parse(url.searchParams.get("input") ?? "{}"))
        if (state.status === "missing" || input.workspaceId !== WORKSPACE) {
          return Response.json({ error: "NOT_FOUND" }, { status: 404 })
        }
        return Response.json({ result: { data: workspaceStatus() } })
      }
      if (url.pathname === "/trpc/getHostedWorkspaceChanges") {
        if (state.changes === "failure") return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 })
        if (state.changes === "notfound") return Response.json({ error: "NOT_FOUND" }, { status: 404 })
        if (state.changes === "missing") {
          return Response.json({
            result: {
              data: {
                status: "not_captured",
                workspaceId: WORKSPACE,
                revision: null,
                capturedAt: null,
                truncated: false,
                comparisons: null,
              },
            },
          })
        }
        return Response.json({
          result: {
            data: workspaceChanges(
              state.changes === "empty"
                ? []
                : [changeFile("src/committed.ts", "against-base-branch"), changeFile("src/working.ts", "uncommitted")],
            ),
          },
        })
      }
      if (url.pathname === "/trpc/refreshHostedWorkspaceChanges") {
        return Response.json({
          result: {
            data: {
              status: "offline",
              changes: workspaceChanges([changeFile("src/committed.ts", "against-base-branch")]),
            },
          },
        })
      }
      if (url.pathname === "/trpc/getHostedWorkspaceChangeFile") {
        if (state.file === "stale") {
          return Response.json({
            result: {
              data: {
                status: "stale",
                file: null,
                capturedAt: null,
                comparison: null,
                currentRevision: 13,
              },
            },
          })
        }
        if (state.file === "omitted") {
          return Response.json({
            result: {
              data: {
                status: "omitted",
                file: {
                  schemaVersion: 1,
                  revision: 12,
                  path: "src/binary.png",
                  diff: { status: "omitted", reason: "binary" },
                  content: { status: "unavailable", reason: "too_large" },
                },
                capturedAt: "2026-11-14T00:00:00.000Z",
                comparison: comparison(),
                currentRevision: null,
              },
            },
          })
        }
        return Response.json({
          result: {
            data: {
              status: "available",
              file: {
                schemaVersion: 1,
                revision: 12,
                path: "src/committed.ts",
                scope: "against-base-branch",
                diff: { status: "available", patch: "@@ -1 +1 @@" },
                content: { status: "available", source: "current", text: "next\n" },
              },
              capturedAt: "2026-11-14T00:00:00.000Z",
              comparison: comparison(),
              currentRevision: null,
            },
          },
        })
      }
      if (url.pathname === "/trpc/getHostedWorkspacePullRequest") {
        if (state.pull === "unavailable") {
          return Response.json({
            result: {
              data: {
                status: "unavailable",
                workspaceId: WORKSPACE,
                reason: "github_unavailable",
                pullRequest: null,
                truncated: false,
                files: [],
              },
            },
          })
        }
        if (state.pull === "not_linked") {
          return Response.json({
            result: {
              data: {
                status: "not_linked",
                workspaceId: WORKSPACE,
                reason: "no_pull_request",
                pullRequest: null,
                truncated: false,
                files: [],
              },
            },
          })
        }
        return Response.json({
          result: {
            data: {
              status: "linked",
              workspaceId: WORKSPACE,
              reason: null,
              pullRequest: {
                number: 123,
                url: "https://github.com/Kilo-Org/kilocode/pull/123",
                state: "open",
                draft: false,
                headSha: HEAD,
                baseRef: "main",
                repository: { path: "", repoFullName: "Kilo-Org/kilocode" },
                cacheStale: false,
              },
              truncated: false,
              files: [
                {
                  path: "src/committed.ts",
                  previousPath: null,
                  status: "modified",
                  additions: 2,
                  deletions: 1,
                  patchAvailable: true,
                },
              ],
            },
          },
        })
      }
      if (url.pathname === "/trpc/getHostedWorkspacePullRequestFile") {
        if (state.pullFile === "stale") {
          return Response.json({
            result: {
              data: {
                status: "stale",
                path: "src/committed.ts",
                reason: null,
                omissionReason: null,
                headSha: OTHER_HEAD,
                patch: null,
              },
            },
          })
        }
        if (state.pullFile === "omitted") {
          return Response.json({
            result: {
              data: {
                status: "omitted",
                path: "src/committed.ts",
                reason: null,
                omissionReason: "provider_omitted",
                headSha: HEAD,
                patch: null,
              },
            },
          })
        }
        return Response.json({
          result: {
            data: {
              status: "available",
              path: "src/committed.ts",
              reason: null,
              omissionReason: null,
              headSha: HEAD,
              patch: "@@ -1 +1 @@",
            },
          },
        })
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

function auth(info: Auth.Info | null = new Auth.Api({ type: "api", key: TOKEN })) {
  return {
    get: (id: string) => Effect.succeed(id === "kilo" ? (info ?? undefined) : undefined),
    all: () => Effect.succeed<Record<string, Auth.Info>>(info ? { kilo: info } : {}),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
}

function layer(
  url: string,
  host = SessionHost.layer({
    env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_WEB_APP_URL: url, KILO_API_URL: url },
  }).pipe(Layer.provide(Layer.succeed(Auth.Service, auth()))),
) {
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
const itSignedOut = testEffect(
  layer(
    app.url,
    SessionHost.layer({
      env: { CLOUD_AGENT_NEXT_BASE_URL: app.url, KILO_WEB_APP_URL: app.url, KILO_API_URL: app.url },
    }).pipe(Layer.provide(Layer.succeed(Auth.Service, auth(null)))),
  ),
)
const itScoped = testEffect(
  layer(
    app.url,
    SessionHost.layer({
      env: {
        CLOUD_AGENT_NEXT_BASE_URL: app.url,
        KILO_WEB_APP_URL: app.url,
        KILO_API_URL: app.url,
        KILO_ORG_ID: ORG,
      },
    }).pipe(
      Layer.provide(
        Layer.succeed(
          Auth.Service,
          auth(
            new Auth.Oauth({
              type: "oauth",
              access: TOKEN,
              refresh: "private-refresh",
              expires: 0,
              accountId: PROFILE,
            }),
          ),
        ),
      ),
    ),
  ),
)
const offline = harness()
void offline.stop()
const itOffline = testEffect(layer(offline.url))
const legacy = fixture("legacy")
const registry = createRegistry([legacy.value])
const itLegacy = testEffect(layer(app.url, Layer.succeed(SessionHost.Service, { registry, default: registry.default })))
const projectionBase = Schema.decodeUnknownSync(WorkspacePullRequestResult)({
  id: { providerID: "projector", workspaceID: WORKSPACE },
  state: "available",
  pullRequest: summary(),
})
const projection: { value: WorkspacePullRequestResult; failure?: HostedFailure; calls: WorkspacePullRequestInput[] } = {
  value: projectionBase,
  calls: [],
}
const project = (input: WorkspacePullRequestInput) => {
  projection.calls.push(input)
  return projection.failure ? Effect.fail(projection.failure) : Effect.succeed(projection.value)
}
const projector = fixture("projector", { getWorkspacePullRequest: project, refreshWorkspacePullRequest: project })
const projections = createRegistry([projector.value])
const itProjection = testEffect(
  layer(app.url, Layer.succeed(SessionHost.Service, { registry: projections, default: projections.default })),
)

afterEach(() => {
  Attachments.store.clear()
  app.state.catalog = "single"
  app.state.workspace = "ok"
  app.state.status = "ok"
  app.state.changes = "captured"
  app.state.file = "available"
  app.state.pull = "linked"
  app.state.pullFile = "available"
  app.state.remove = "ok"
  app.state.continuation = "ok"
  app.state.pr = undefined
  projection.failure = undefined
  projection.value = projectionBase
  projection.calls.length = 0
})
afterAll(() => {
  void app.stop()
  void issuer.stop()
})

const workspacePath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceDetail.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const statusPath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceStatus.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const prPath = (workspaceID = WORKSPACE, providerID = "kilo-cloud") =>
  SessionHostPaths.workspacePullRequest.replace(":providerID", providerID).replace(":workspaceID", workspaceID)
const refreshPath = (workspaceID = WORKSPACE, providerID = "kilo-cloud") =>
  SessionHostPaths.workspacePullRequestRefresh.replace(":providerID", providerID).replace(":workspaceID", workspaceID)
const sessionsPath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceSession.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const changesPath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceChanges.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const changesRefreshPath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceChangesRefresh.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const changeFilePath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspaceChangeFile.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const pullPath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspacePullRequestDiff.replace(":providerID", "kilo-cloud").replace(":workspaceID", workspaceID)
const pullFilePath = (workspaceID = WORKSPACE) =>
  SessionHostPaths.workspacePullRequestDiffFile
    .replace(":providerID", "kilo-cloud")
    .replace(":workspaceID", workspaceID)
const attachPath = (sessionID = SESSION) =>
  SessionHostPaths.attach.replace(":providerID", "kilo-cloud").replace(":sessionID", sessionID)

const attach = (sessionID = SESSION) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.post(attachPath(sessionID))
    expect(response.status).toBe(200)
    return String(Object(yield* response.json).attachmentID)
  })

function wire(text: string, status: number) {
  const calls: Request[] = []
  const client = createKiloClient({
    baseUrl: "http://handler.invalid",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Request(input, init))
        return new Response(text, { status, headers: { "content-type": "application/json" } })
      },
      { preconnect: fetch.preconnect },
    ),
  })
  return { client, calls }
}

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

  for (const [name, value] of [
    ["complete", summary()],
    ["draft", summary({ state: "draft", review: { decision: "review_required", available: true, pending: false } })],
    ["merged", summary({ state: "merged", review: { decision: "none", available: true, pending: false } })],
    [
      "closed",
      summary({ state: "closed", review: { decision: "changes_requested", available: true, pending: false } }),
    ],
    [
      "partial and unknown",
      summary({
        state: "unknown",
        title: null,
        headSha: null,
        lastSyncedAt: "producer timestamp preserved verbatim",
        review: { decision: null, available: false, pending: true },
        checks: {
          total: 6,
          passed: 1,
          failed: 1,
          pending: 1,
          skipped: 1,
          unknown: 2,
          complete: false,
          available: false,
        },
        conversations: { unresolved: null, complete: false },
        mergeability: { mergeable: null, state: null, complete: false },
        partial: true,
        unavailable: ["checks", "statuses", "reviews"],
      }),
    ],
    [
      "zero checks without inventing a passed check",
      summary({
        checks: { total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, unknown: 0, complete: true, available: true },
        mergeability: { mergeable: false, state: "blocked", complete: true },
        partial: true,
        unavailable: [],
      }),
    ],
  ] as const) {
    it.live(`returns ${name} PR evidence through the real handler and generated SDK`, () =>
      Effect.gen(function* () {
        app.state.pr = { summary: value }
        const before = app.calls.length
        const response = yield* HttpClient.get(`${prPath()}?organizationID=${PROFILE}`)
        expect(response.status).toBe(200)
        const text = yield* response.text
        const expected = {
          id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
          state: "available" as const,
          pullRequest: value,
        }
        expect(parse(text)).toEqual(expected)

        const calls = app.calls.slice(before)
        const call = calls.find((item) => item.path === "/trpc/getHostedWorkspace")
        expect(call?.method).toBe("GET")
        expect(call?.auth).toBe(`Bearer ${CONTROL}`)
        expect(call?.org).toBe(PROFILE)
        expect(parse(new URL(call?.search ?? "", app.url).searchParams.get("input") ?? "{}")).toEqual({
          workspaceId: WORKSPACE,
          sessionLimit: 1,
        })
        expect(calls.filter((item) => item.path.startsWith("/trpc/"))).toHaveLength(1)
        expect(Attachments.store.count(hosted("kilo-cloud", SESSION))).toBe(0)

        const sdk = wire(text, response.status)
        const typed = yield* Effect.promise(() =>
          sdk.client.sessionHost.getWorkspacePullRequest({
            providerID: "kilo-cloud",
            workspaceID: WORKSPACE,
            organizationID: PROFILE,
          }),
        )
        expect(typed.error).toBeUndefined()
        expect(typed.data).toEqual(expected)
        expect(typed.data?.pullRequest?.checks).toEqual(value.checks)
        const request = sdk.calls.at(0)
        expect(request?.method).toBe("GET")
        expect(request?.url).toBe(`http://handler.invalid${prPath()}?organizationID=${PROFILE}`)
        expect(request?.body).toBeNull()
      }),
    )
  }

  for (const [status, state, value, retryAt] of [
    ["refreshed", "available", summary(), null],
    ["no_pr", "no_pr", null, null],
    ["no_integration", "unavailable", summary(), null],
    ["rate_limited", "rate_limited", summary(), "2026-10-21T12:01:00.000Z"],
    ["throttled", "rate_limited", summary(), "2026-10-21T12:02:00.000Z"],
    ["unavailable", "unavailable", summary(), null],
    ["failed", "unavailable", summary(), null],
    ["failed", "unavailable", null, null],
  ] as const) {
    it.live(
      `refreshes PR status ${status} with ${value ? "cached evidence" : "null evidence"} and no local request body`,
      () =>
        Effect.gen(function* () {
          app.state.pr = { summary: value, refresh: { status, retryAt } }
          const before = app.calls.length
          const response = yield* HttpClient.post(`${refreshPath()}?organizationID=${PROFILE}`)
          expect(response.status).toBe(200)
          const text = yield* response.text
          const expected = {
            id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
            state,
            pullRequest: value,
            refresh: { status, retryAt },
          }
          expect(parse(text)).toEqual(expected)
          const calls = app.calls.slice(before)
          const call = calls.find((item) => item.path === "/trpc/refreshHostedWorkspacePullRequest")
          expect(call?.method).toBe("POST")
          expect(call?.auth).toBe(`Bearer ${CONTROL}`)
          expect(call?.org).toBe(PROFILE)
          expect(call?.search).toBe("")
          expect(parse(call?.body ?? "{}")).toEqual({ workspaceId: WORKSPACE })
          expect(calls.filter((item) => item.path.startsWith("/trpc/"))).toHaveLength(1)
          expect(Attachments.store.count(hosted("kilo-cloud", SESSION))).toBe(0)

          const sdk = wire(text, response.status)
          const typed = yield* Effect.promise(() =>
            sdk.client.sessionHost.refreshWorkspacePullRequest({
              providerID: "kilo-cloud",
              workspaceID: WORKSPACE,
              organizationID: PROFILE,
            }),
          )
          expect(typed.error).toBeUndefined()
          expect(typed.data).toEqual(expected)
          expect(typed.data?.refresh?.retryAt).toBe(retryAt)
          const request = sdk.calls.at(0)
          expect(request?.method).toBe("POST")
          expect(request?.url).toBe(`http://handler.invalid${refreshPath()}?organizationID=${PROFILE}`)
          expect(request?.body).toBeNull()
        }),
    )
  }

  it.live("does not extend existing workspace list or detail responses with PR fields", () =>
    Effect.gen(function* () {
      app.state.pr = { summary: summary() }
      const response = yield* HttpClient.get(workspacePath())
      expect(response.status).toBe(200)
      expect(yield* response.json).not.toHaveProperty("pullRequest")
      const page = yield* HttpClient.get(SessionHostPaths.workspace)
      expect(page.status).toBe(200)
      expect(JSON.stringify(yield* page.json)).not.toContain("pullRequest")
    }),
  )

  it.live("sanitizes private PR response fields at every nested boundary", () =>
    Effect.gen(function* () {
      const value = summary()
      app.state.pr = {
        summary: summary({
          origin: app.url,
          controlToken: CONTROL,
          ownerId: "private-owner",
          directory: "/private/workspace",
          review: { ...value.review, raw: TOKEN },
          checks: { ...value.checks, contexts: ["private-check"] },
          conversations: { ...value.conversations, threads: ["private-thread"] },
          mergeability: { ...value.mergeability, sandboxId: CLOUD },
        }),
        refresh: { status: "refreshed", retryAt: null, credential: TOKEN },
      }
      for (const request of [HttpClientRequest.get(prPath()), HttpClientRequest.post(refreshPath())]) {
        const response = yield* HttpClient.execute(request)
        expect(response.status).toBe(200)
        const text = yield* response.text
        expect(Object(parse(text)).pullRequest).toEqual(value)
        for (const secret of [
          app.url,
          CONTROL,
          TOKEN,
          CLOUD,
          "private-owner",
          "/private/workspace",
          "private-check",
          "private-thread",
        ]) {
          expect(text).not.toContain(secret)
        }
      }
    }),
  )

  for (const [status, state] of [
    [401, "rejected"],
    [403, "rejected"],
    [404, "unavailable"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const) {
    it.live(`keeps upstream HTTP ${status} distinct from no PR and preserves attachments`, () =>
      Effect.gen(function* () {
        const id = yield* attach()
        app.state.pr = { status }
        for (const request of [HttpClientRequest.get(prPath()), HttpClientRequest.post(refreshPath())]) {
          const before = app.calls.length
          const response = yield* HttpClient.execute(request)
          expect(response.status).toBe(200)
          const text = yield* response.text
          expect(parse(text)).toEqual({
            id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
            state,
            pullRequest: null,
          })
          expect(text).not.toContain("private upstream failure")
          expect(Attachments.store.lookup(id).kind).toBe("found")
          expect(Attachments.store.count(hosted("kilo-cloud", SESSION))).toBe(1)
          expect(app.calls.slice(before).filter((item) => item.path.startsWith("/trpc/"))).toHaveLength(1)

          const sdk = wire(text, response.status)
          const typed = yield* Effect.promise(() =>
            request.method === "GET"
              ? sdk.client.sessionHost.getWorkspacePullRequest({ providerID: "kilo-cloud", workspaceID: WORKSPACE })
              : sdk.client.sessionHost.refreshWorkspacePullRequest({
                  providerID: "kilo-cloud",
                  workspaceID: WORKSPACE,
                }),
          )
          expect(typed.data?.state).toBe(state)
          expect(typed.data?.pullRequest).toBeNull()
          expect(typed.error).toBeUndefined()
        }
      }),
    )
  }

  it.live("reserves no_pr for an explicit null projection and never invalidates its workspace attachments", () =>
    Effect.gen(function* () {
      const id = yield* attach()
      for (const [pr, workspace, state] of [
        [{ summary: null }, "ok", "no_pr"],
        [undefined, "ok", "unsupported"],
        [{ summary: summary() }, "missing", "unavailable"],
        [{ raw: "not JSON" }, "ok", "unavailable"],
        [{ raw: JSON.stringify({ result: { data: {} } }) }, "ok", "unavailable"],
        [{ summary: summary({ title: undefined }) }, "ok", "unavailable"],
        [{ summary: summary({ checks: { total: -1 } }) }, "ok", "unavailable"],
        [{ summary: summary(), workspaceID: OTHER_WORKSPACE }, "ok", "unavailable"],
      ] as const) {
        app.state.pr = pr
        app.state.workspace = workspace
        const response = yield* HttpClient.get(prPath())
        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual({
          id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
          state,
          pullRequest: null,
        })
        expect(Attachments.store.lookup(id).kind).toBe("found")
        expect(Attachments.store.count(hosted("kilo-cloud", SESSION))).toBe(1)
      }
    }),
  )

  it.live("treats malformed or inconsistent refresh results as unavailable, not no PR", () =>
    Effect.gen(function* () {
      const id = yield* attach()
      for (const pr of [
        { summary: summary(), refresh: { status: "refreshed" } },
        { summary: null, refresh: { status: "refreshed", retryAt: null } },
        { summary: summary(), refresh: { status: "no_pr", retryAt: null } },
        { summary: summary(), refresh: { status: "unknown", retryAt: null } },
        { summary: summary(), workspaceID: OTHER_WORKSPACE },
        { raw: JSON.stringify({ result: { data: null } }) },
        { raw: "not JSON" },
      ]) {
        app.state.pr = pr
        const response = yield* HttpClient.post(refreshPath())
        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual({
          id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
          state: "unavailable",
          pullRequest: null,
        })
        expect(Attachments.store.lookup(id).kind).toBe("found")
      }
    }),
  )

  itScoped.live(
    "keeps organization selection in query/auth with explicit query precedence over environment and saved account",
    () =>
      Effect.gen(function* () {
        app.state.pr = { summary: summary() }
        for (const [organization, query] of [
          [ORG, ""],
          [PROFILE, `?organizationID=${PROFILE}`],
        ] as const) {
          for (const request of [
            HttpClientRequest.get(`${prPath()}${query}`),
            HttpClientRequest.post(`${refreshPath()}${query}`),
          ]) {
            const before = app.calls.length
            const response = yield* HttpClient.execute(request)
            expect(response.status).toBe(200)
            expect(Object(yield* response.json).state).toBe("available")
            const calls = app.calls.slice(before)
            const issued = calls.find((item) => item.path === "/api/cloud-agent-next/token")
            if (issued) {
              expect(issued.auth).toBe(`Bearer ${TOKEN}`)
              expect(parse(issued.body)).toEqual({ organizationId: organization })
            }
            const worker = calls.find((item) => item.path.startsWith("/trpc/"))
            expect(worker?.auth).toBe(`Bearer ${CONTROL}`)
            expect(worker?.org).toBe(organization)
            if (request.method === "GET") {
              expect(parse(new URLSearchParams(worker?.search ?? "").get("input") ?? "{}")).toEqual({
                workspaceId: WORKSPACE,
                sessionLimit: 1,
              })
              expect(worker?.body).toBe("")
            } else {
              expect(worker?.search).toBe("")
              expect(parse(worker?.body ?? "{}")).toEqual({ workspaceId: WORKSPACE })
            }
          }
        }
      }),
  )

  itSignedOut.live("reports signed_out only for absent local credentials without calling the issuer or Worker", () =>
    Effect.gen(function* () {
      const before = app.calls.length
      for (const request of [HttpClientRequest.get(prPath()), HttpClientRequest.post(refreshPath())]) {
        const response = yield* HttpClient.execute(request)
        expect(response.status).toBe(200)
        const text = yield* response.text
        expect(parse(text)).toEqual({
          id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
          state: "signed_out",
          pullRequest: null,
        })
        const sdk = wire(text, response.status)
        const typed = yield* Effect.promise(() =>
          request.method === "GET"
            ? sdk.client.sessionHost.getWorkspacePullRequest({ providerID: "kilo-cloud", workspaceID: WORKSPACE })
            : sdk.client.sessionHost.refreshWorkspacePullRequest({ providerID: "kilo-cloud", workspaceID: WORKSPACE }),
        )
        expect(typed.data?.state).toBe("signed_out")
        expect(typed.data?.pullRequest).toBeNull()
      }
      expect(app.calls).toHaveLength(before)
      expect(Attachments.store.count(hosted("kilo-cloud", SESSION))).toBe(0)
    }),
  )

  itOffline.live("reports unreachable rather than signed_out or no PR on transport failure", () =>
    Effect.gen(function* () {
      for (const request of [HttpClientRequest.get(prPath()), HttpClientRequest.post(refreshPath())]) {
        const response = yield* HttpClient.execute(request)
        expect(response.status).toBe(200)
        const text = yield* response.text
        expect(parse(text)).toEqual({
          id: { providerID: "kilo-cloud", workspaceID: WORKSPACE },
          state: "unreachable",
          pullRequest: null,
        })
        const sdk = wire(text, response.status)
        const typed = yield* Effect.promise(() =>
          request.method === "GET"
            ? sdk.client.sessionHost.getWorkspacePullRequest({ providerID: "kilo-cloud", workspaceID: WORKSPACE })
            : sdk.client.sessionHost.refreshWorkspacePullRequest({ providerID: "kilo-cloud", workspaceID: WORKSPACE }),
        )
        expect(typed.data?.state).toBe("unreachable")
        expect(typed.data?.pullRequest).toBeNull()
      }
    }),
  )

  itLegacy.live("returns unsupported for providers that omit the optional PR operations", () =>
    Effect.gen(function* () {
      for (const request of [
        HttpClientRequest.get(prPath(WORKSPACE, "legacy")),
        HttpClientRequest.post(refreshPath(WORKSPACE, "legacy")),
      ]) {
        const response = yield* HttpClient.execute(request)
        expect(response.status).toBe(200)
        const text = yield* response.text
        expect(parse(text)).toEqual({
          id: { providerID: "legacy", workspaceID: WORKSPACE },
          state: "unsupported",
          pullRequest: null,
        })
        const sdk = wire(text, response.status)
        const typed = yield* Effect.promise(() =>
          request.method === "GET"
            ? sdk.client.sessionHost.getWorkspacePullRequest({ providerID: "legacy", workspaceID: WORKSPACE })
            : sdk.client.sessionHost.refreshWorkspacePullRequest({ providerID: "legacy", workspaceID: WORKSPACE }),
        )
        expect(typed.data?.state).toBe("unsupported")
        expect(typed.data?.pullRequest).toBeNull()
      }
      expect(legacy.calls).toHaveLength(0)
    }),
  )

  itProjection.live(
    "validates optional-provider identity and result invariants and strips private provider fields",
    () =>
      Effect.gen(function* () {
        const id = Schema.decodeUnknownSync(HostedWorkspaceID)({ providerID: "projector", workspaceID: WORKSPACE })
        const value = Schema.decodeUnknownSync(WorkspacePullRequestResult)({
          id,
          state: "available",
          pullRequest: summary(),
        })
        projection.value = Object.assign({}, value, {
          origin: app.url,
          sourceToken: TOKEN,
          pullRequest: Object.assign({}, value.pullRequest, { controlToken: CONTROL }),
        })
        for (const request of [
          HttpClientRequest.get(`${prPath(WORKSPACE, "projector")}?organizationID=${PROFILE}`),
          HttpClientRequest.post(`${refreshPath(WORKSPACE, "projector")}?organizationID=${PROFILE}`),
        ]) {
          const response = yield* HttpClient.execute(request)
          expect(response.status).toBe(200)
          expect(yield* response.json).toEqual(value)
        }
        expect(projection.calls).toEqual([
          { id, organizationID: PROFILE },
          { id, organizationID: PROFILE },
        ])

        for (const result of [
          { ...value, id: { ...id, workspaceID: OTHER_WORKSPACE } },
          { ...value, id: { ...id, providerID: legacy.value.id } },
          { ...value, pullRequest: null },
          { ...value, state: "no_pr" as const },
          { ...value, refresh: { status: "failed" as const, retryAt: null } },
        ]) {
          projection.value = result
          for (const request of [
            HttpClientRequest.get(prPath(WORKSPACE, "projector")),
            HttpClientRequest.post(refreshPath(WORKSPACE, "projector")),
          ]) {
            const response = yield* HttpClient.execute(request)
            expect(response.status).toBe(200)
            expect(yield* response.json).toEqual({ id, state: "unavailable", pullRequest: null })
          }
        }
      }),
  )

  itProjection.live("does not invalidate attachments when an optional provider reports not_found", () =>
    Effect.gen(function* () {
      const entry = Attachments.store.mint({
        provider: projector.value,
        session: hosted("projector", SESSION),
        workspace: Schema.decodeUnknownSync(HostedWorkspaceID)({ providerID: "projector", workspaceID: WORKSPACE }),
        expiresAt: Date.now() + 60_000,
      })
      projection.failure = new HostedFailure({ code: "not_found", message: `private ${TOKEN}`, retryable: false })
      for (const request of [
        HttpClientRequest.get(prPath(WORKSPACE, "projector")),
        HttpClientRequest.post(refreshPath(WORKSPACE, "projector")),
      ]) {
        const response = yield* HttpClient.execute(request)
        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual({
          id: { providerID: "projector", workspaceID: WORKSPACE },
          state: "unavailable",
          pullRequest: null,
        })
        expect(Attachments.store.lookup(entry.id).kind).toBe("found")
      }
    }),
  )

  it.live("validates PR route params and organization query before making provider requests", () =>
    Effect.gen(function* () {
      const before = app.calls.length
      for (const path of [prPath(), refreshPath()]) {
        for (const target of [
          path.replace("kilo-cloud", "INVALID"),
          path.replace(WORKSPACE, "invalid%20workspace"),
          `${path}?organizationID=`,
        ]) {
          const response = yield* HttpClient.execute(
            path === prPath() ? HttpClientRequest.get(target) : HttpClientRequest.post(target),
          )
          expect(response.status).toBe(400)
        }
        const response = yield* HttpClient.execute(
          path === prPath()
            ? HttpClientRequest.get(path.replace("kilo-cloud", "missing"))
            : HttpClientRequest.post(path.replace("kilo-cloud", "missing")),
        )
        expect(response.status).toBe(503)
      }
      expect(app.calls).toHaveLength(before)
    }),
  )

  it.live("lists authorized workspace profiles with their default flags and no secret inputs", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(`${SessionHostPaths.workspaceProfiles}?organizationID=${PROFILE}`)
      expect(response.status).toBe(200)
      const body: unknown = yield* response.json
      expect(body).toEqual({
        personalProfiles: [
          {
            id: PROFILE,
            name: "Default",
            description: null,
            ownerType: "user",
            isPersonalDefault: true,
            isOrganizationDefault: false,
          },
        ],
        organizationProfiles: [],
        personalDefaultProfileID: PROFILE,
        organizationDefaultProfileID: null,
        effectiveDefaultProfileID: PROFILE,
      })
      expect(JSON.stringify(body)).not.toContain("SECRET_VALUE")
      expect(JSON.stringify(body)).not.toContain("varCount")
      const call = app.calls.at(-1)
      expect(call?.path).toBe("/trpc/listHostedWorkspaceProfiles")
      expect(call?.auth).toBe(`Bearer ${CONTROL}`)
      expect(Object(parse(new URL(call?.search ?? "", app.url).searchParams.get("input") ?? "{}"))).toEqual({
        kilocodeOrganizationId: PROFILE,
      })
    }),
  )

  it.live("sets and clears the personal default workspace profile", () =>
    Effect.gen(function* () {
      const before = app.calls.length
      const set = yield* HttpClientRequest.post(SessionHostPaths.workspaceProfilePersonalDefault).pipe(
        HttpClientRequest.bodyJson({ id: PROFILE, organizationID: PROFILE }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(set.status).toBe(200)
      expect(yield* set.json).toEqual({ success: true })

      const cleared = yield* HttpClient.execute(
        HttpClientRequest.delete(
          `${SessionHostPaths.workspaceProfilePersonalDefaultDetail.replace(":profileID", PROFILE)}?organizationID=${PROFILE}`,
        ),
      )
      expect(cleared.status).toBe(200)
      expect(yield* cleared.json).toEqual({ success: true })

      const calls = app.calls.slice(before)
      const issued = calls.find((call) => call.path === "/api/cloud-agent-next/token")
      expect(parse(issued?.body ?? "{}")).toEqual({ organizationId: PROFILE })
      const assigned = calls.find((call) => call.path === "/trpc/setHostedWorkspacePersonalDefaultProfile")
      expect(assigned?.org).toBe(PROFILE)
      expect(assigned?.body).toBe(JSON.stringify({ profileId: PROFILE }))
      const removed = calls.find((call) => call.path === "/trpc/clearHostedWorkspacePersonalDefaultProfile")
      expect(removed?.org).toBe(PROFILE)
      expect(removed?.body).toBe(JSON.stringify({ profileId: PROFILE }))
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
  it.live("returns the typed 409 and 402 continuation errors through the generated client", () =>
    Effect.gen(function* () {
      const directory = "/tmp/kilo-continuation-wire"
      const saved = {
        KILO_API_KEY: process.env["KILO_API_KEY"],
        KILO_API_URL: process.env["KILO_API_URL"],
        CLOUD_AGENT_NEXT_BASE_URL: process.env["CLOUD_AGENT_NEXT_BASE_URL"],
        KILO_WEB_APP_URL: process.env["KILO_WEB_APP_URL"],
      }
      process.env["KILO_API_KEY"] = TOKEN
      process.env["KILO_API_URL"] = app.url
      process.env["CLOUD_AGENT_NEXT_BASE_URL"] = app.url
      process.env["KILO_WEB_APP_URL"] = app.url

      try {
        for (const [state, status, code] of [
          ["mismatch", 409, "operation_key_reuse_mismatch"],
          ["balance", 402, "insufficient_balance"],
        ] as const) {
          app.state.continuation = state
          const operationKey = crypto.randomUUID()
          const selection = JSON.stringify({ directory, sessionIDs: [SESSION], activeSessionID: SESSION })
          // A matching intent makes the route take the replay path straight to
          // the provider, so the real handler and Cloud mapping are exercised.
          yield* Effect.promise(() =>
            AppRuntime.runPromise(
              Database.Service.use((db) =>
                db.db
                  .insert(ContinuationIntentTable)
                  .values({
                    account_id: ACCOUNT,
                    operation_key: operationKey,
                    selection_json: selection,
                    cloud_origin: app.url,
                    provider: PROVIDER,
                    prepared_json: JSON.stringify({
                      operationKey,
                      clientProvenance: "agent-manager",
                      repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
                      activeSourceKiloSessionId: SESSION,
                      sessions: [{ sourceKiloSessionId: SESSION, agent: { mode: "build", model: "test/fake" } }],
                    }),
                    created_at: Date.now(),
                    expires_at: Date.now() + 60_000,
                  })
                  .run(),
              ),
            ),
          )

          const body = {
            sessionHostContinueWorkspaceInput: {
              operationKey,
              directory,
              sessionIDs: [SESSION],
              activeSessionID: SESSION,
            },
          }
          // Drive the real handler in-memory and capture its exact response.
          const response = yield* HttpClientRequest.post(SessionHostPaths.workspaceContinue).pipe(
            HttpClientRequest.bodyJson(body.sessionHostContinueWorkspaceInput),
            Effect.flatMap(HttpClient.execute),
          )
          expect(response.status).toBe(status)
          const text = yield* response.text

          // Pass those real bytes through the generated client and assert the
          // typed continuation error fields.
          const typed = createKiloClient({
            baseUrl: "http://handler.invalid",
            fetch: (async () =>
              new Response(text, {
                status,
                headers: { "content-type": "application/json" },
              })) as unknown as typeof fetch,
          })
          const { error } = yield* Effect.promise(() =>
            typed.sessionHost.continueWorkspace(body, { throwOnError: false }),
          )
          expect(error).toMatchObject({ code, retryable: false })
          expect(typeof (error as { message?: unknown }).message).toBe("string")
        }
      } finally {
        app.state.continuation = "ok"
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    }),
  )

  it.live("serves committed and uncommitted workspace changes as passive reads", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get(`${changesPath()}?organizationID=${ORG}`)
      expect(response.status).toBe(200)
      const body = Object(yield* response.json)
      expect(body.status).toBe("captured")
      expect(body.revision).toBe(12)
      expect(
        body.comparisons[0].files.map((file: { path: string; scope?: string }) => [file.path, file.scope]),
      ).toEqual([
        ["src/committed.ts", "against-base-branch"],
        ["src/working.ts", "uncommitted"],
      ])
      const call = app.calls.findLast((entry) => entry.path === "/trpc/getHostedWorkspaceChanges")
      expect(call).toMatchObject({ method: "GET", org: ORG })
      expect(Attachments.store.count(hosted("kilo-cloud", SESSION))).toBe(0)
    }),
  )

  it.live("keeps an offline refresh on the previous snapshot and distinguishes an unavailable read", () =>
    Effect.gen(function* () {
      const refresh = yield* HttpClient.post(`${changesRefreshPath()}?organizationID=${ORG}`)
      expect(refresh.status).toBe(200)
      expect(yield* refresh.json).toMatchObject({
        status: "offline",
        changes: { status: "captured", revision: 12 },
      })

      app.state.changes = "missing"
      const missing = yield* HttpClient.get(changesPath())
      expect(yield* missing.json).toMatchObject({
        status: "not_captured",
        revision: null,
        capturedAt: null,
        comparisons: null,
      })

      app.state.changes = "empty"
      const empty = yield* HttpClient.get(changesPath())
      expect(yield* empty.json).toMatchObject({
        status: "captured",
        comparisons: [{ files: [] }],
      })
    }),
  )

  it.live("fences per-file reads by the expected revision", () =>
    Effect.gen(function* () {
      const file = yield* HttpClient.get(
        `${changeFilePath()}?path=src%2Fcommitted.ts&scope=against-base-branch&expectedRevision=12`,
      )
      expect(file.status).toBe(200)
      expect(yield* file.json).toMatchObject({
        status: "available",
        file: { revision: 12, path: "src/committed.ts", scope: "against-base-branch" },
      })

      app.state.file = "stale"
      const stale = yield* HttpClient.get(`${changeFilePath()}?path=src%2Fcommitted.ts&expectedRevision=12`)
      expect(yield* stale.json).toEqual({
        status: "stale",
        file: null,
        capturedAt: null,
        comparison: null,
        currentRevision: 13,
      })

      app.state.file = "omitted"
      const omitted = yield* HttpClient.get(`${changeFilePath()}?path=src%2Fbinary.png&expectedRevision=12`)
      expect(yield* omitted.json).toMatchObject({
        status: "omitted",
        file: { diff: { status: "omitted", reason: "binary" } },
      })
    }),
  )

  it.live("returns no linked PR without failing the workspace changes read", () =>
    Effect.gen(function* () {
      app.state.pull = "not_linked"
      const none = yield* HttpClient.get(pullPath())
      expect(none.status).toBe(200)
      expect(yield* none.json).toMatchObject({
        status: "not_linked",
        reason: "no_pull_request",
        pullRequest: null,
        files: [],
      })

      const changes = yield* HttpClient.get(changesPath())
      expect(changes.status).toBe(200)
      expect(yield* changes.json).toMatchObject({ status: "captured" })

      app.state.pull = "linked"
      const linked = yield* HttpClient.get(pullPath())
      expect(yield* linked.json).toMatchObject({
        status: "linked",
        pullRequest: { number: 123, headSha: HEAD },
        files: [{ path: "src/committed.ts", patchAvailable: true }],
      })
    }),
  )

  it.live("serves PR patches fenced by the verified head and preserves omissions", () =>
    Effect.gen(function* () {
      const patch = yield* HttpClient.get(`${pullFilePath()}?path=src%2Fcommitted.ts&expectedHeadSha=${HEAD}`)
      expect(patch.status).toBe(200)
      expect(yield* patch.json).toEqual({
        status: "available",
        path: "src/committed.ts",
        reason: null,
        omissionReason: null,
        headSha: HEAD,
        patch: "@@ -1 +1 @@",
      })

      app.state.pullFile = "omitted"
      const omitted = yield* HttpClient.get(`${pullFilePath()}?path=src%2Fcommitted.ts&expectedHeadSha=${HEAD}`)
      expect(yield* omitted.json).toMatchObject({
        status: "omitted",
        omissionReason: "provider_omitted",
        patch: null,
      })

      app.state.pullFile = "stale"
      const stale = yield* HttpClient.get(`${pullFilePath()}?path=src%2Fcommitted.ts&expectedHeadSha=${HEAD}`)
      expect(yield* stale.json).toMatchObject({ status: "stale", headSha: OTHER_HEAD, patch: null })
    }),
  )

  it.live("maps a provider failure to a typed local error", () =>
    Effect.gen(function* () {
      app.state.changes = "failure"
      const response = yield* HttpClient.get(changesPath())
      expect(response.status).toBe(503)
    }),
  )

  it.live("disposes attachments when a workspace diff read reports not found", () =>
    Effect.gen(function* () {
      yield* attach()
      expect(Attachments.store.count(hosted("kilo-cloud", SESSION))).toBe(1)
      app.state.changes = "notfound"
      const response = yield* HttpClient.get(changesPath())
      expect(response.status).toBe(404)
      expect(Attachments.store.count(hosted("kilo-cloud", SESSION))).toBe(0)
    }),
  )
})
