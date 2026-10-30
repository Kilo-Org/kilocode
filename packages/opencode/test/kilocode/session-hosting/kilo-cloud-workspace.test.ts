import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import { deletionDispatched } from "@/kilocode/session-hosting/types"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const SESSION = "ses_00000000000000000000000001"
const OTHER = "ses_00000000000000000000000002"
const WORKSPACE = "worktree_12345678-1234-1234-1234-123456789abc"
const OTHER_WORKSPACE = "worktree_87654321-4321-4321-8321-cba987654321"
const CLOUD = "workspace_12345678-1234-1234-1234-123456789abc"
const PROFILE = "33333333-3333-4333-8333-333333333333"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"
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
  page: "ok" | "unauthorized" | "unavailable" | "invalid"
  detail: "ok" | "null" | "mismatch" | "invalid"
  status: "ok" | "mismatch" | "invalid" | "unauthorized" | "conflict" | "unavailable"
  create: "ok" | "forbidden" | "conflict" | "notfound" | "payment" | "unavailable" | "mismatch"
  session: "ok" | "mismatch"
  profiles: "ok" | "direct" | "unauthorized" | "unavailable" | "invalid"
  membership: "default" | "nested" | "outer" | "wrong" | "flat" | "failure"
  remove: "ok" | "invalid"
  creates: number
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

function workspaceSessionSummary(kiloSessionId: string) {
  return {
    kiloSessionId,
    cloudAgentSessionId: CLOUD,
    workspaceId: WORKSPACE,
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
    sessions: [workspaceSessionSummary(SESSION)],
    nextSessionCursor: null,
    ...overrides,
  }
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

function harness() {
  const calls: Call[] = []
  const state: State = {
    page: "ok",
    detail: "ok",
    status: "ok",
    create: "ok",
    session: "ok",
    profiles: "ok",
    membership: "default",
    remove: "ok",
    creates: 0,
  }

  const error = (code: string, status: number) => Response.json({ error: code }, { status })
  const envelope = (data: unknown) => Response.json({ result: { data } })

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

      if (url.pathname === `/kilo/session/${SESSION}`) {
        return Response.json(sessionInfo(SESSION))
      }

      if (url.pathname === "/api/trpc/agentProfiles.list") {
        if (state.profiles === "unauthorized") return error("UNAUTHORIZED", 401)
        if (state.profiles === "unavailable") return error("SERVICE_UNAVAILABLE", 503)
        if (state.profiles === "invalid") return envelope({ json: [{ nope: true }] })
        if (state.profiles === "direct") {
          return Response.json({
            result: { data: [{ id: "profile_2", name: "Direct", description: "Visible", isDefault: false }] },
          })
        }
        return envelope({
          json: [
            {
              id: "profile_1",
              name: "Default",
              description: null,
              isDefault: true,
              varCount: 2,
              varValues: ["SECRET_VALUE"],
              envVars: { SECRET: "SECRET_VALUE" },
              setupCommands: ["echo SECRET_VALUE"],
              appendSystemPrompt: "SECRET_VALUE",
            },
          ],
        })
      }

      if (url.pathname === "/trpc/listHostedWorkspaces") {
        if (state.page === "unauthorized") return error("UNAUTHORIZED", 401)
        if (state.page === "unavailable") return error("SERVICE_UNAVAILABLE", 503)
        if (state.page === "invalid") return envelope({ items: [{ nope: true }], nextCursor: null })
        if (state.membership === "failure") return error("SERVICE_UNAVAILABLE", 503)
        if (state.membership === "flat") {
          return envelope({ items: [workspaceSummary({ sessions: [] })], nextCursor: null })
        }
        if (state.membership === "wrong") {
          return envelope({
            items: [
              workspaceSummary({
                sessions: [
                  {
                    ...workspaceSessionSummary(SESSION),
                    workspaceId: OTHER_WORKSPACE,
                  },
                ],
              }),
            ],
            nextCursor: null,
          })
        }
        if (state.membership === "nested") {
          return envelope({
            items: [workspaceSummary({ sessions: [], nextSessionCursor: "nested-1" })],
            nextCursor: null,
          })
        }
        if (state.membership === "outer") {
          const input = Object(JSON.parse(new URL(url).searchParams.get("input") ?? "{}"))
          if (input.cursor === undefined) {
            return envelope({
              items: [workspaceSummary({ sessions: [], nextSessionCursor: null })],
              nextCursor: "outer-2",
            })
          }
          return envelope({ items: [workspaceSummary()], nextCursor: null })
        }
        return envelope({ items: [workspaceSummary()], nextCursor: "cursor-2" })
      }

      if (url.pathname === "/trpc/getHostedWorkspace") {
        if (state.detail === "null") return envelope(null)
        if (state.detail === "invalid") return envelope({ nope: true })
        if (state.membership === "nested") {
          const input = Object(JSON.parse(new URL(url).searchParams.get("input") ?? "{}"))
          if (input.sessionCursor === "nested-1") {
            return envelope(
              workspaceSummary({
                sessions: [workspaceSessionSummary(SESSION)],
                nextSessionCursor: null,
              }),
            )
          }
          return envelope(workspaceSummary({ sessions: [], nextSessionCursor: "nested-1" }))
        }
        return envelope(
          workspaceSummary({
            workspaceId: state.detail === "mismatch" ? OTHER_WORKSPACE : WORKSPACE,
            nextSessionCursor: "session-cursor-1",
          }),
        )
      }

      if (url.pathname === "/trpc/deleteWorktree") {
        const input = Object(JSON.parse(body))
        if (state.remove === "invalid") return envelope({ success: true })
        return envelope({ success: true, deletedSessionIds: [SESSION], worktreeId: input.worktreeId })
      }

      if (url.pathname === "/trpc/getHostedWorkspaceStatus") {
        if (state.status === "unauthorized") return error("UNAUTHORIZED", 401)
        if (state.status === "conflict") return error("CONFLICT", 409)
        if (state.status === "unavailable") return error("SERVICE_UNAVAILABLE", 503)
        if (state.status === "invalid") return envelope({ nope: true })
        return envelope(workspaceStatus({ workspaceId: state.status === "mismatch" ? OTHER_WORKSPACE : WORKSPACE }))
      }

      if (url.pathname === "/trpc/createHostedWorkspace") {
        state.creates += 1
        if (state.create === "forbidden") return error("FORBIDDEN", 403)
        if (state.create === "conflict") return error("CONFLICT", 409)
        if (state.create === "notfound") return error("NOT_FOUND", 404)
        if (state.create === "payment") return error("PAYMENT_REQUIRED", 402)
        if (state.create === "unavailable") return error("SERVICE_UNAVAILABLE", 503)
        const input = Object(JSON.parse(body))
        return envelope({
          workspaceId: WORKSPACE,
          cloudAgentSessionId: CLOUD,
          kiloSessionId: SESSION,
          messageId: state.create === "mismatch" ? "msg_000000000000000000000000ff" : input.message.id,
          replayed: state.creates > 1,
        })
      }

      if (url.pathname === "/trpc/createHostedWorkspaceSession") {
        const input = Object(JSON.parse(body))
        return envelope({
          workspaceId: state.session === "mismatch" ? OTHER_WORKSPACE : input.workspaceId,
          cloudAgentSessionId: CLOUD,
          kiloSessionId: OTHER,
          messageId: input.message.id,
          replayed: false,
        })
      }

      return error("NOT_FOUND", 404)
    },
  })

  return { url: `http://127.0.0.1:${server.port}`, calls, state, stop: () => server.stop(true) }
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
const client = (url: string, info: Auth.Info | undefined = signedIn()) =>
  kiloCloud({
    auth: auth(info),
    env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_WEB_APP_URL: url, KILO_API_URL: url },
  })

const membership = (cloud: ReturnType<typeof client>) => {
  if (!cloud.membership) throw new Error("Kilo Cloud must resolve workspace membership")
  return cloud.membership({ id: { providerID: PROVIDER, sessionID: SESSION } })
}

const repo = { type: "github" as const, repo: "Kilo-Org/kilocode", branch: "main" }
const agent = { mode: "build", model: "test/fake" }

it.effect("lists workspaces with cursor preservation and an organization scope", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const page = yield* cloud.listWorkspaces({ limit: 5, sessionLimit: 2, organizationID: ORG })
    expect(page.cursor).toBe("cursor-2")
    expect(page.items[0].id).toEqual({ providerID: PROVIDER, workspaceID: WORKSPACE })
    expect(page.items[0].repository).toEqual({
      provider: "github",
      url: "https://github.com/Kilo-Org/kilocode",
      branch: "main",
    })
    expect(page.items[0].profileID).toBe(PROFILE)
    expect(page.items[0].sessions[0].id).toEqual({ providerID: PROVIDER, sessionID: SESSION })

    expect(app.calls[0]).toMatchObject({
      method: "GET",
      path: "/trpc/listHostedWorkspaces",
      auth: `Bearer ${CONTROL}`,
      org: ORG,
    })
    expect(app.calls[0].search).toContain("limit%22%3A5")
    expect(app.calls[0].search).toContain("sessionLimit%22%3A2")

    const text = JSON.stringify(page)
    for (const secret of [app.url, TOKEN, CLOUD, "cloudAgentSessionId"]) expect(text).not.toContain(secret)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("reads a workspace, preserves its nested session cursor, and rejects a null or mismatched detail", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const detail = yield* cloud.getWorkspace({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } })
    expect(detail.id).toEqual({ providerID: PROVIDER, workspaceID: WORKSPACE })
    expect(detail.cursor).toBe("session-cursor-1")
    expect(app.calls[0]).toMatchObject({
      method: "GET",
      path: "/trpc/getHostedWorkspace",
    })
    expect(app.calls[0].search).toContain(WORKSPACE)

    app.state.detail = "null"
    expect(
      yield* cloud.getWorkspace({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } }).pipe(Effect.flip),
    ).toMatchObject({ code: "not_found", retryable: false })

    app.state.detail = "mismatch"
    expect(
      yield* cloud.getWorkspace({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } }).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid_response", retryable: false })

    app.state.detail = "invalid"
    expect(
      yield* cloud.getWorkspace({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } }).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid_response", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("reads passive workspace status with the exact organization input and no private identifiers", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const status = yield* cloud.getWorkspaceStatus({
      id: { providerID: PROVIDER, workspaceID: WORKSPACE },
      organizationID: ORG,
    })
    expect(status).toEqual({
      id: { providerID: PROVIDER, workspaceID: WORKSPACE },
      deletionState: "active",
      observedAt: 500,
      compute: { status: "sleeping", detailCode: "sandbox_stopped", observedAt: 490, estimatedSleepAt: null },
      activity: { activeSessionCount: 2, hasActiveTurn: false },
      wakeOnInput: { available: true, blockedReason: null },
      billing: {
        payer: "org",
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
      },
    })

    expect(app.calls).toHaveLength(1)
    expect(app.calls[0]).toMatchObject({
      method: "GET",
      path: "/trpc/getHostedWorkspaceStatus",
      auth: `Bearer ${CONTROL}`,
      org: ORG,
    })
    expect(JSON.parse(new URL(app.calls[0].search, app.url).searchParams.get("input")!)).toEqual({
      workspaceId: WORKSPACE,
      kilocodeOrganizationId: ORG,
    })

    const text = JSON.stringify(status)
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
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("omits the organization input when unscoped and rejects a mismatched status identity", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    yield* cloud.getWorkspaceStatus({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } })
    expect(JSON.parse(new URL(app.calls[0].search, app.url).searchParams.get("input")!)).toEqual({
      workspaceId: WORKSPACE,
    })

    app.state.status = "mismatch"
    expect(
      yield* cloud.getWorkspaceStatus({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } }).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid_response", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("maps signed-out, unauthorized, conflict, unavailable and malformed status failures", () => {
  const app = harness()
  return Effect.gen(function* () {
    const signedOut = kiloCloud({
      auth: auth(undefined),
      env: { CLOUD_AGENT_NEXT_BASE_URL: app.url, KILO_WEB_APP_URL: app.url, KILO_API_URL: app.url },
    })
    expect(
      yield* signedOut.getWorkspaceStatus({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } }).pipe(Effect.flip),
    ).toMatchObject({ code: "signed_out", retryable: false })
    expect(app.calls).toHaveLength(0)

    const cloud = client(app.url)
    const status = (state: State["status"]) => {
      app.state.status = state
      return cloud.getWorkspaceStatus({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } }).pipe(Effect.flip)
    }

    expect(yield* status("unauthorized")).toMatchObject({ code: "unauthorized", retryable: false })
    expect(yield* status("conflict")).toMatchObject({ code: "rejected", retryable: false })
    expect(yield* status("unavailable")).toMatchObject({ code: "unavailable", retryable: true })
    expect(yield* status("invalid")).toMatchObject({ code: "invalid_response", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("creates a workspace with a fixed provenance and never returns a Cloud control identity", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const result = yield* cloud.createWorkspace({
      repository: repo,
      profile: { id: PROFILE },
      prompt: "Do the thing",
      agent,
      operationKey: OPERATION,
      messageID: MESSAGE,
      organizationID: ORG,
    })
    expect(result).toEqual({
      workspace: { providerID: PROVIDER, workspaceID: WORKSPACE },
      session: { providerID: PROVIDER, sessionID: SESSION },
      messageID: MESSAGE,
      replayed: false,
    })

    const call = app.calls[0]
    expect(call).toMatchObject({ method: "POST", path: "/trpc/createHostedWorkspace", org: ORG })
    const body = Object(JSON.parse(call.body))
    expect(body).toMatchObject({
      operationKey: OPERATION,
      clientProvenance: "agent-manager",
      repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
      profile: { id: PROFILE },
      message: { prompt: "Do the thing", id: MESSAGE },
      agent,
      options: { kilocodeOrganizationId: ORG },
    })

    const text = JSON.stringify(result)
    for (const secret of [app.url, TOKEN, CLOUD, "cloudAgentSessionId"]) expect(text).not.toContain(secret)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("replays an idempotent create and rejects a different message identity", () => {
  const app = harness()
  const input = {
    repository: repo,
    profile: { id: PROFILE },
    prompt: "Do the thing",
    agent,
    operationKey: OPERATION,
    messageID: MESSAGE,
  }
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const first = yield* cloud.createWorkspace(input)
    expect(first.replayed).toBe(false)
    const replay = yield* cloud.createWorkspace(input)
    expect(replay.replayed).toBe(true)
    expect(replay.workspace).toEqual(first.workspace)
    expect(app.calls.map((call) => JSON.parse(call.body).operationKey)).toEqual([OPERATION, OPERATION])

    app.state.create = "mismatch"
    expect(yield* cloud.createWorkspace(input).pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
      retryable: false,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("starts another session in a workspace and rejects a mismatched workspace identity", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const result = yield* cloud.startWorkspaceSession({
      id: { providerID: PROVIDER, workspaceID: WORKSPACE },
      prompt: "More work",
      agent,
      operationKey: OPERATION,
      messageID: MESSAGE,
    })
    expect(result).toEqual({
      workspace: { providerID: PROVIDER, workspaceID: WORKSPACE },
      session: { providerID: PROVIDER, sessionID: OTHER },
      messageID: MESSAGE,
      replayed: false,
    })

    const body = Object(JSON.parse(app.calls[0].body))
    expect(app.calls[0]).toMatchObject({ method: "POST", path: "/trpc/createHostedWorkspaceSession" })
    expect(body).toMatchObject({
      workspaceId: WORKSPACE,
      operationKey: OPERATION,
      clientProvenance: "agent-manager",
      message: { prompt: "More work", id: MESSAGE },
      agent,
    })
    expect(body).not.toHaveProperty("kilocodeOrganizationId")
    expect(body).not.toHaveProperty("options")

    // The Cloud input is strict and carries the organization at the top level, unlike start and createWorkspace.
    app.calls.length = 0
    yield* cloud.startWorkspaceSession({
      id: { providerID: PROVIDER, workspaceID: WORKSPACE },
      prompt: "More work",
      agent,
      operationKey: OPERATION,
      messageID: MESSAGE,
      organizationID: ORG,
    })
    const scoped = app.calls.find((call) => call.path === "/trpc/createHostedWorkspaceSession")
    expect(Object(JSON.parse(scoped?.body ?? "{}"))).toMatchObject({
      workspaceId: WORKSPACE,
      kilocodeOrganizationId: ORG,
    })
    expect(Object(JSON.parse(scoped?.body ?? "{}"))).not.toHaveProperty("options")
    expect(scoped?.org).toBe(ORG)

    app.state.session = "mismatch"
    expect(
      yield* cloud
        .startWorkspaceSession({
          id: { providerID: PROVIDER, workspaceID: WORKSPACE },
          prompt: "More work",
          agent,
          operationKey: OPERATION,
          messageID: MESSAGE,
        })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid_response", retryable: false })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("maps membership, payment, conflict, not-found and unavailable failures", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const create = (state: State["create"]) => {
      app.state.create = state
      return cloud
        .createWorkspace({
          repository: repo,
          profile: { id: PROFILE },
          prompt: "Do the thing",
          agent,
          operationKey: OPERATION,
          messageID: MESSAGE,
        })
        .pipe(Effect.flip)
    }

    expect(yield* create("forbidden")).toMatchObject({ code: "unauthorized", retryable: false })
    expect(yield* create("notfound")).toMatchObject({ code: "not_found", retryable: false })
    expect(yield* create("payment")).toMatchObject({ code: "payment_required", retryable: false })
    expect(yield* create("conflict")).toMatchObject({ code: "rejected", retryable: false })
    expect(yield* create("unavailable")).toMatchObject({ code: "unavailable", retryable: true })

    app.state.page = "unauthorized"
    expect(yield* cloud.listWorkspaces().pipe(Effect.flip)).toMatchObject({ code: "unauthorized", retryable: false })
    app.state.page = "invalid"
    expect(yield* cloud.listWorkspaces().pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
      retryable: false,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("lists authorized profile summaries with the resolved organization and no secret inputs", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const page = yield* cloud.listWorkspaceProfiles({ organizationID: ORG })
    expect(page).toEqual({
      items: [{ id: "profile_1", name: "Default", description: null, isDefault: true }],
    })

    expect(app.calls).toHaveLength(1)
    const scoped = app.calls[0]
    expect(scoped).toMatchObject({
      method: "GET",
      path: "/api/trpc/agentProfiles.list",
      auth: `Bearer ${TOKEN}`,
      org: ORG,
    })
    expect(JSON.parse(new URL(scoped.search, app.url).searchParams.get("input")!)).toEqual({ organizationId: ORG })

    const unscoped = yield* cloud.listWorkspaceProfiles()
    expect(unscoped.items).toEqual(page.items)
    expect(JSON.parse(new URL(app.calls[1].search, app.url).searchParams.get("input")!)).toEqual({})
    expect(app.calls[1].org).toBe(null)

    const text = JSON.stringify(page)
    for (const secret of ["SECRET_VALUE", "varCount", "varValues", "envVars", "setupCommands", "appendSystemPrompt"]) {
      expect(text).not.toContain(secret)
    }
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("accepts a result.data profile array and maps profile failures", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)

    app.state.profiles = "direct"
    expect((yield* cloud.listWorkspaceProfiles()).items).toEqual([
      { id: "profile_2", name: "Direct", description: "Visible", isDefault: false },
    ])

    app.state.profiles = "unauthorized"
    expect(yield* cloud.listWorkspaceProfiles().pipe(Effect.flip)).toMatchObject({
      code: "unauthorized",
      retryable: false,
    })

    app.state.profiles = "unavailable"
    expect(yield* cloud.listWorkspaceProfiles().pipe(Effect.flip)).toMatchObject({
      code: "unavailable",
      retryable: true,
    })

    app.state.profiles = "invalid"
    expect(yield* cloud.listWorkspaceProfiles().pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
      retryable: false,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("reports a signed-out host and performs no Cloud request", () => {
  let requests = 0
  const cloud = kiloCloud({
    auth: auth(undefined),
    env: { CLOUD_AGENT_NEXT_BASE_URL: "http://127.0.0.1:1" },
    fetch: Object.assign(
      () => {
        requests += 1
        return Promise.reject(new Error("signed out must not request"))
      },
      { preconnect: () => undefined },
    ),
  })
  return Effect.gen(function* () {
    const error = yield* cloud
      .createWorkspace({
        repository: repo,
        profile: { id: PROFILE },
        prompt: "Do the thing",
        agent,
        operationKey: OPERATION,
        messageID: MESSAGE,
      })
      .pipe(Effect.flip)
    expect(error).toMatchObject({ code: "signed_out", retryable: false })
    expect(requests).toBe(0)
  })
})

it.effect("attaches by session validity alone without walking the workspace catalog", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const result = yield* cloud.attach({ id: { providerID: PROVIDER, sessionID: SESSION } })
    expect(result).toEqual({
      session: { providerID: PROVIDER, sessionID: SESSION },
      expiresAt: expect.any(Number),
    })
    expect(app.calls.map((call) => call.path)).toEqual([`/kilo/session/${SESSION}`])
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("resolves cold membership without a prior workspace list", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const result = yield* membership(cloud)
    expect(result).toEqual({ providerID: PROVIDER, workspaceID: WORKSPACE })
    expect(app.calls.map((call) => call.path)).toEqual(["/trpc/listHostedWorkspaces"])
    expect(app.calls[0]?.search).toContain("limit%22%3A50")
    expect(app.calls[0]?.search).toContain("sessionLimit%22%3A100")
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("follows outer and nested workspace pages to find membership", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)

    app.state.membership = "outer"
    expect(yield* membership(cloud)).toEqual({ providerID: PROVIDER, workspaceID: WORKSPACE })
    expect(app.calls.filter((call) => call.path === "/trpc/listHostedWorkspaces")).toHaveLength(2)

    app.calls.length = 0
    app.state.membership = "nested"
    expect(yield* membership(cloud)).toEqual({ providerID: PROVIDER, workspaceID: WORKSPACE })
    const detail = app.calls.find((call) => call.path === "/trpc/getHostedWorkspace")
    expect(Object(JSON.parse(new URL(detail?.search ?? "", app.url).searchParams.get("input") ?? "{}"))).toEqual({
      workspaceId: WORKSPACE,
      sessionLimit: 100,
      sessionCursor: "nested-1",
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("skips a workspace that disappears during the membership scan", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.membership = "nested"
    app.state.detail = "null"
    expect(yield* membership(cloud)).toBeUndefined()
    expect(app.calls.map((call) => call.path)).toEqual(["/trpc/listHostedWorkspaces", "/trpc/getHostedWorkspace"])
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("rejects a nested session that belongs to another workspace", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.membership = "wrong"
    expect(yield* membership(cloud).pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
      retryable: false,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("allows a legacy flat session without workspace membership", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.membership = "flat"
    expect(yield* membership(cloud)).toBeUndefined()
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("propagates a membership lookup failure instead of treating it as legacy", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.membership = "failure"
    expect(yield* membership(cloud).pipe(Effect.flip)).toMatchObject({
      code: "unavailable",
      retryable: true,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("deletes a workspace with an organization scope and hides deleted session ids", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const result = yield* cloud.deleteWorkspace({
      id: { providerID: PROVIDER, workspaceID: WORKSPACE },
      organizationID: ORG,
    })
    expect(result).toEqual({
      workspace: { providerID: PROVIDER, workspaceID: WORKSPACE },
      success: true,
    })
    expect(JSON.stringify(result)).not.toContain("deletedSessionIds")
    expect(JSON.stringify(result)).not.toContain(SESSION)

    const call = app.calls[0]
    expect(call).toMatchObject({ method: "POST", path: "/trpc/deleteWorktree", auth: `Bearer ${CONTROL}`, org: ORG })
    expect(Object(JSON.parse(call.body))).toEqual({
      worktreeId: WORKSPACE,
      kilocodeOrganizationId: ORG,
    })

    yield* cloud.deleteWorkspace({ id: { providerID: PROVIDER, workspaceID: OTHER_WORKSPACE } })
    expect(Object(JSON.parse(app.calls[1].body))).toEqual({ worktreeId: OTHER_WORKSPACE })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("rejects a malformed deletion response after dispatch", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.remove = "invalid"
    const error = yield* cloud
      .deleteWorkspace({ id: { providerID: PROVIDER, workspaceID: WORKSPACE } })
      .pipe(Effect.flip)
    expect(error).toMatchObject({ code: "invalid_response", retryable: false })
    expect(deletionDispatched(error)).toBe(true)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})
