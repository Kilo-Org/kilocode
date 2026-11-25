import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import { deletionDispatched, HostedFailure } from "@/kilocode/session-hosting/types"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../../lib/effect"
import contract from "./fixtures/hosted-workspace-v5.json"

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
  profiles: "ok" | "unauthorized" | "unavailable" | "invalid"
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

      if (url.pathname === "/trpc/listHostedWorkspaceProfiles") {
        if (state.profiles === "unauthorized") return error("UNAUTHORIZED", 401)
        if (state.profiles === "unavailable") return error("SERVICE_UNAVAILABLE", 503)
        if (state.profiles === "invalid") return envelope({ personalProfiles: [{ nope: true }] })
        const scoped = Object(JSON.parse(new URL(url).searchParams.get("input") ?? "{}")).kilocodeOrganizationId
        return envelope({
          personalProfiles: [
            {
              id: "profile_1",
              name: "Personal",
              description: null,
              ownerType: "user",
              isPersonalDefault: true,
              isOrganizationDefault: false,
            },
          ],
          organizationProfiles:
            scoped === undefined
              ? []
              : [
                  {
                    id: "profile_2",
                    name: "Organization",
                    description: "Visible",
                    ownerType: "organization",
                    isPersonalDefault: false,
                    isOrganizationDefault: true,
                  },
                ],
          personalDefaultProfileId: "profile_1",
          organizationDefaultProfileId: scoped === undefined ? null : "profile_2",
          effectiveDefaultProfileId: "profile_1",
        })
      }

      if (url.pathname === "/trpc/setHostedWorkspacePersonalDefaultProfile") {
        return envelope({ success: true })
      }

      if (url.pathname === "/trpc/clearHostedWorkspacePersonalDefaultProfile") {
        return envelope({ success: true })
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
          ...(input.message === undefined
            ? {}
            : { messageId: state.create === "mismatch" ? "msg_000000000000000000000000ff" : input.message.id }),
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

it.effect("creates an empty workspace without a profile or initial prompt", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const result = yield* cloud.createWorkspace({
      repository: repo,
      agent,
      operationKey: OPERATION,
      organizationID: ORG,
    })
    expect(result).toEqual({
      workspace: { providerID: PROVIDER, workspaceID: WORKSPACE },
      session: { providerID: PROVIDER, sessionID: SESSION },
      replayed: false,
    })

    const body = Object(JSON.parse(app.calls[0].body))
    expect(body).toMatchObject({
      operationKey: OPERATION,
      clientProvenance: "agent-manager",
      repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
      agent,
      options: { kilocodeOrganizationId: ORG },
    })
    expect(body).not.toHaveProperty("profile")
    expect(body).not.toHaveProperty("message")
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("rejects a workspace create that supplies only one of prompt and messageID", () =>
  Effect.gen(function* () {
    const cloud = client("http://127.0.0.1:1")
    expect(
      yield* cloud
        .createWorkspace({
          repository: repo,
          prompt: "Do the thing",
          agent,
          operationKey: OPERATION,
        })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid_request", retryable: false })
    expect(
      yield* cloud
        .createWorkspace({
          repository: repo,
          messageID: MESSAGE,
          agent,
          operationKey: OPERATION,
        })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid_request", retryable: false })
  }),
)

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

it.effect("lists personal and organization profiles with their default flags and no secret inputs", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const page = yield* cloud.listWorkspaceProfiles({ organizationID: ORG })
    expect(page).toEqual({
      personalProfiles: [
        {
          id: "profile_1",
          name: "Personal",
          description: null,
          ownerType: "user",
          isPersonalDefault: true,
          isOrganizationDefault: false,
        },
      ],
      organizationProfiles: [
        {
          id: "profile_2",
          name: "Organization",
          description: "Visible",
          ownerType: "organization",
          isPersonalDefault: false,
          isOrganizationDefault: true,
        },
      ],
      personalDefaultProfileID: "profile_1",
      organizationDefaultProfileID: "profile_2",
      effectiveDefaultProfileID: "profile_1",
    })

    expect(app.calls).toHaveLength(1)
    const scoped = app.calls[0]
    expect(scoped).toMatchObject({
      method: "GET",
      path: "/trpc/listHostedWorkspaceProfiles",
      auth: `Bearer ${CONTROL}`,
      org: ORG,
    })
    expect(JSON.parse(new URL(scoped.search, app.url).searchParams.get("input")!)).toEqual({
      kilocodeOrganizationId: ORG,
    })

    const unscoped = yield* cloud.listWorkspaceProfiles()
    expect(unscoped.organizationProfiles).toEqual([])
    expect(unscoped.organizationDefaultProfileID).toBe(null)
    expect(unscoped.effectiveDefaultProfileID).toBe("profile_1")
    expect(JSON.parse(new URL(app.calls[1].search, app.url).searchParams.get("input")!)).toEqual({})
    expect(app.calls[1].org).toBe(null)

    const text = JSON.stringify(page)
    for (const secret of ["SECRET_VALUE", "varCount", "varValues", "envVars", "setupCommands", "appendSystemPrompt"]) {
      expect(text).not.toContain(secret)
    }
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("sets and clears the personal default profile with the caller identity", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)

    expect(yield* cloud.setWorkspacePersonalDefaultProfile({ id: PROFILE, organizationID: ORG })).toEqual({
      success: true,
    })
    expect(yield* cloud.clearWorkspacePersonalDefaultProfile({ id: PROFILE, organizationID: ORG })).toEqual({
      success: true,
    })

    expect(app.calls).toMatchObject([
      { method: "POST", path: "/trpc/setHostedWorkspacePersonalDefaultProfile" },
      { method: "POST", path: "/trpc/clearHostedWorkspacePersonalDefaultProfile" },
    ])
    expect(JSON.parse(app.calls[0].body)).toEqual({ profileId: PROFILE })
    expect(JSON.parse(app.calls[1].body)).toEqual({ profileId: PROFILE })
    expect(app.calls[0].auth).toBe(`Bearer ${CONTROL}`)
    expect(app.calls[0].org).toBe(ORG)
    expect(app.calls[1].org).toBe(ORG)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("maps profile failures", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)

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

describe("Kilo Cloud v5 hosted workspace repositories", () => {
  const [list, create] = contract.requests.map((entry) => entry.example)
  const [listed, created] = contract.responses.map((entry) => entry.example)
  const version = 1 as const
  if (
    listed.hostedAdditionalRepositoriesVersion !== version ||
    !listed.repositories ||
    !created.workspaceId ||
    !created.kiloSessionId
  ) {
    throw new Error("Cloud v5 producer response examples are invalid")
  }
  const discovery = "/api/trpc/organizations.cloudAgentNext.listGitHubRepositories"
  const procedure = "listHostedWorkspaceRepositories"
  const catalog = `/trpc/${procedure}`
  const mutation = "/trpc/createHostedWorkspace"
  const issuer = "/api/cloud-agent-next/token"
  const scope = { organizationID: list.organizationId!, primaryRepo: list.primaryRepo! }
  const pin = list.integrationId!
  const primary = {
    id: 1001,
    name: "primary",
    fullName: scope.primaryRepo.toUpperCase(),
    private: true,
    platformIntegrationId: pin,
  }
  const inventory = {
    integrationInstalled: true,
    syncedAt: null,
    repositories: [primary, { ...primary, fullName: "other/primary", platformIntegrationId: PROFILE }],
  }
  const { additionalRepositoryIds: ids, ...legacy } = create
  const repository = { type: "github" as const, repo: create.repository!.repo, branch: create.repository!.branch }
  const input = {
    organizationID: scope.organizationID,
    integrationID: pin,
    repository,
    additionalRepositoryIDs: ids!,
    operationKey: create.operationKey!,
    agent: create.agent!,
  }
  const result = {
    workspace: { providerID: PROVIDER, workspaceID: created.workspaceId },
    session: { providerID: PROVIDER, sessionID: created.kiloSessionId },
    replayed: false,
  }
  const codes = new Map([
    ["BAD_REQUEST", [400, -32600]],
    ["FORBIDDEN", [403, -32003]],
    ["NOT_FOUND", [404, -32004]],
    ["CONFLICT", [409, -32009]],
    ["SERVICE_UNAVAILABLE", [503, -32603]],
  ])
  const paths = (calls: Call[]) => calls.map((call) => call.path)
  const query = (call: Call) => JSON.parse(new URLSearchParams(call.search).get("input")!)
  const envelope = (data: unknown) => Response.json({ result: { data } })

  function code(key: string) {
    const value = codes.get(key)
    if (!value) throw new Error(`Unsupported test tRPC code: ${key}`)
    return value
  }

  function failure(err: { code: string; message: string }, path: string) {
    const [status, rpc] = code(err.code)
    return Response.json(
      {
        error: {
          message: err.message,
          code: rpc,
          data: {
            code: err.code,
            httpStatus: status,
            path,
            clientError: { ...err, retryable: status === 503 },
          },
        },
      },
      { status },
    )
  }

  const upstream = Effect.acquireRelease(
    Effect.sync(() => {
      const state = {
        discovery: () => envelope(inventory),
        catalog: () => envelope(listed),
        create: () => envelope(created),
      }
      const web: Call[] = []
      const worker: Call[] = []
      function serve(calls: Call[], handle: (path: string) => Response) {
        return Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const url = new URL(request.url)
            calls.push({
              method: request.method,
              path: url.pathname,
              search: url.search,
              auth: request.headers.get("authorization"),
              org: request.headers.get("x-kilocode-organizationid"),
              body: request.method === "POST" ? await request.text() : "",
            })
            return handle(url.pathname)
          },
        })
      }

      const app = serve(web, (path) => {
        if (path === discovery) return state.discovery()
        if (path === issuer) {
          return Response.json({ token: CONTROL, expiresAt: "2026-11-21T00:10:00.000Z" })
        }
        return new Response("Unexpected Web request", { status: 400 })
      })
      const agent = serve(worker, (path) => {
        if (path === catalog) return state.catalog()
        if (path === mutation) return state.create()
        return new Response("Unexpected Worker request", { status: 400 })
      })
      const cloud = kiloCloud({
        auth: auth(signedIn()),
        env: { KILO_WEB_APP_URL: app.url.origin, CLOUD_AGENT_NEXT_BASE_URL: agent.url.origin, KILO_ORG_ID: ORG },
        clock: () => Date.parse("2026-11-21T00:00:00.000Z"),
      })
      return { web, worker, state, cloud, stop: () => Promise.all([app.stop(true), agent.stop(true)]) }
    }),
    (app) => Effect.promise(app.stop),
  )

  it.live("discovers the exact primary in either Web envelope and uses the pinned Worker for the next page", () =>
    Effect.gen(function* () {
      const app = yield* upstream
      const lookup = app.cloud.listWorkspaceRepositories!
      const expected = {
        ...listed,
        hostedAdditionalRepositoriesVersion: version,
        repositories: listed.repositories,
        integrationID: pin,
      }

      expect(yield* lookup({ ...scope, page: list.page })).toEqual(expected)
      expect(paths(app.web)).toEqual([discovery, issuer])
      expect(app.web[0]).toMatchObject({ method: "GET", path: discovery, auth: `Bearer ${TOKEN}`, body: "" })
      expect(query(app.web[0])).toEqual({ organizationId: scope.organizationID })
      expect(app.web[1]).toMatchObject({ method: "POST", path: issuer, auth: `Bearer ${TOKEN}` })
      expect(JSON.parse(app.web[1].body)).toEqual({ organizationId: scope.organizationID })
      expect(app.worker[0]).toMatchObject({
        method: "GET",
        path: catalog,
        auth: `Bearer ${CONTROL}`,
        org: scope.organizationID,
      })
      expect(query(app.worker[0])).toEqual(list)

      app.state.discovery = () => envelope({ json: inventory, meta: { v: 1 } })
      app.state.catalog = () =>
        envelope({
          ...listed,
          workerMetadata: "private worker detail",
          repositories: expected.repositories.map((repo) => ({ ...repo, installationToken: "private token" })),
        })
      const first = yield* lookup(scope)
      expect(first).toEqual(expected)
      expect(query(app.worker[1])).toEqual({
        organizationId: list.organizationId,
        integrationId: pin,
        primaryRepo: list.primaryRepo,
      })

      const last = { hostedAdditionalRepositoriesVersion: version, repositories: [] }
      app.state.catalog = () => envelope(last)
      expect(yield* lookup({ ...scope, integrationID: first.integrationID, page: first.nextPage })).toEqual({
        ...last,
        integrationID: pin,
      })
      expect(paths(app.web)).toEqual([discovery, issuer, discovery])
      expect(paths(app.worker)).toEqual([catalog, catalog, catalog])
      expect(query(app.worker[2])).toEqual({ ...list, page: listed.nextPage })
    }),
  )

  it.live("refuses ambiguous or incomplete Web discovery before contacting the Worker", () =>
    Effect.gen(function* () {
      const app = yield* upstream
      const lookup = app.cloud.listWorkspaceRepositories!
      app.state.discovery = () =>
        envelope({
          ...inventory,
          repositories: [primary, { ...primary, fullName: scope.primaryRepo, platformIntegrationId: PROFILE }],
        })
      expect(yield* lookup(scope).pipe(Effect.flip)).toMatchObject({
        reason: "hosted_workspace_repository_integration_ambiguous",
        status: 409,
        retryable: false,
      })

      for (const response of [
        { ...inventory, partial: true },
        { ...inventory, integrationInstalled: false },
        { ...inventory, errorMessage: "sensitive upstream diagnostic" },
        { ...inventory, repositories: [{ ...primary, platformIntegrationId: undefined }] },
        { ...inventory, repositories: [primary, { ...primary, platformIntegrationId: undefined }] },
        { ...inventory, repositories: [{ ...primary, platformIntegrationId: "not-a-uuid" }] },
        { ...inventory, repositories: [{ ...primary, fullName: "other/primary" }] },
      ]) {
        app.state.discovery = () => envelope(response)
        const err = yield* lookup(scope).pipe(Effect.flip)
        expect(err).toBeInstanceOf(HostedFailure)
        expect(err.message).not.toContain("sensitive upstream diagnostic")
      }
      expect(app.web.every((call) => call.path === discovery)).toBe(true)
      expect(app.worker).toEqual([])
    }),
  )

  it.live("requires exact Worker v1 support before posting a selected create", () =>
    Effect.gen(function* () {
      const app = yield* upstream
      const lookup = app.cloud.listWorkspaceRepositories!
      const { repositories, nextPage } = listed
      const unversioned = { repositories, nextPage }
      const unsupported = { reason: "hosted_workspace_repository_unsupported", status: 503, retryable: false }
      for (const response of [
        () => envelope(unversioned),
        () => envelope({ ...unversioned, hostedAdditionalRepositoriesVersion: version + 1 }),
        () => envelope({ ...unversioned, hostedAdditionalRepositoriesVersion: String(version) }),
        () => failure({ code: "NOT_FOUND", message: `No procedure found on path "${procedure}"` }, procedure),
      ]) {
        app.state.catalog = response
        app.worker.length = 0
        expect(yield* lookup({ ...scope, integrationID: pin }).pipe(Effect.flip)).toMatchObject(unsupported)
        expect(yield* app.cloud.createWorkspace(input).pipe(Effect.flip)).toMatchObject(unsupported)
        expect(paths(app.worker)).toEqual([catalog, catalog])
        expect(query(app.worker[1])).toEqual(list)
      }

      app.worker.length = 0
      app.state.catalog = () => envelope({ ...listed, repositories: [{ id: "1002" }] })
      expect(yield* app.cloud.createWorkspace(input).pipe(Effect.flip)).toMatchObject({
        code: "invalid_response",
        retryable: false,
      })
      expect(paths(app.worker)).toEqual([catalog])
    }),
  )

  it.live("preserves selected create identity and scope when retrying a promptless operation", () =>
    Effect.gen(function* () {
      const app = yield* upstream
      expect(yield* app.cloud.createWorkspace(input)).toEqual(result)
      app.state.create = () => envelope({ ...created, replayed: true })
      expect(yield* app.cloud.createWorkspace(input)).toEqual({ ...result, replayed: true })

      expect(paths(app.web)).toEqual([issuer])
      expect(JSON.parse(app.web[0].body)).toEqual({ organizationId: scope.organizationID })
      expect(paths(app.worker)).toEqual([catalog, mutation, catalog, mutation])
      for (const call of app.worker) {
        expect(call).toMatchObject({ auth: `Bearer ${CONTROL}`, org: scope.organizationID })
        if (call.path === catalog) {
          expect(call.method).toBe("GET")
          expect(query(call)).toEqual(list)
        } else {
          expect(call.method).toBe("POST")
          expect(JSON.parse(call.body)).toEqual(create)
        }
      }
    }),
  )

  it.live(
    "returns typed Worker failures for stale selections without downgrading or posting after a failed probe",
    () =>
      Effect.gen(function* () {
        const app = yield* upstream
        for (const err of contract.errors) {
          const [status] = code(err.code)
          const expected = { reason: err.message, status, retryable: status === 503 }
          app.worker.length = 0
          app.state.create = () => failure(err, "createHostedWorkspace")
          expect(yield* app.cloud.createWorkspace(input).pipe(Effect.flip)).toMatchObject(expected)
          expect(paths(app.worker)).toEqual([catalog, mutation])
          expect(JSON.parse(app.worker[1].body)).toEqual(create)

          if (status === 403 || status === 404 || status === 503) {
            app.worker.length = 0
            app.state.catalog = () => failure(err, procedure)
            expect(yield* app.cloud.createWorkspace(input).pipe(Effect.flip)).toMatchObject(expected)
            expect(paths(app.worker)).toEqual([catalog])
            app.state.catalog = () => envelope(listed)
          }
        }
      }),
  )

  it.live("rejects invalid selected create inputs without any Cloud request", () =>
    Effect.gen(function* () {
      const app = yield* upstream
      const unscoped = { reason: "hosted_workspace_repository_scope_required", status: 400 }
      const duplicate = { reason: "hosted_workspace_repository_duplicate", status: 400 }
      const invalid = { code: "invalid_request" }
      for (const [patch, expected] of [
        [{ organizationID: undefined }, unscoped],
        [{ organizationID: "not-a-uuid" }, unscoped],
        [{ integrationID: undefined }, unscoped],
        [{ integrationID: "not-a-uuid" }, invalid],
        [{ repository: { type: "gitlab", url: "https://gitlab.com/example/primary" } }, unscoped],
        [{ repository: { ...repository, repo: "not-owner-and-repo" } }, unscoped],
        [{ additionalRepositoryIDs: [1002, 1002] }, duplicate],
        [{ additionalRepositoryIDs: [0] }, invalid],
        [{ additionalRepositoryIDs: [-1] }, invalid],
        [{ additionalRepositoryIDs: [1.5] }, invalid],
        [{ additionalRepositoryIDs: [Number.MAX_SAFE_INTEGER + 1] }, invalid],
        [{ additionalRepositoryIDs: [1, 2, 3, 4, 5, 6] }, invalid],
      ] as const) {
        expect(yield* app.cloud.createWorkspace({ ...input, ...patch }).pipe(Effect.flip)).toMatchObject({
          ...expected,
          retryable: false,
        })
      }
      expect(app.web).toEqual([])
      expect(app.worker).toEqual([])
    }),
  )

  it.live("uses the original create payload and skips the catalog for omitted or empty selections", () =>
    Effect.gen(function* () {
      const app = yield* upstream
      expect(
        yield* app.cloud.createWorkspace({ ...input, integrationID: undefined, additionalRepositoryIDs: undefined }),
      ).toEqual(result)
      expect(yield* app.cloud.createWorkspace({ ...input, additionalRepositoryIDs: [] })).toEqual(result)
      expect(paths(app.worker)).toEqual([mutation, mutation])
      expect(app.worker.map((call) => JSON.parse(call.body))).toEqual([
        { ...legacy, repository },
        { ...legacy, repository },
      ])
    }),
  )
})
