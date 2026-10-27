import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
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
  create: "ok" | "forbidden" | "conflict" | "notfound" | "payment" | "unavailable" | "mismatch"
  session: "ok" | "mismatch"
  creates: number
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

function harness() {
  const calls: Call[] = []
  const state: State = { page: "ok", detail: "ok", create: "ok", session: "ok", creates: 0 }

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

      if (url.pathname === "/trpc/listHostedWorkspaces") {
        if (state.page === "unauthorized") return error("UNAUTHORIZED", 401)
        if (state.page === "unavailable") return error("SERVICE_UNAVAILABLE", 503)
        if (state.page === "invalid") return envelope({ items: [{ nope: true }], nextCursor: null })
        return envelope({ items: [workspaceSummary()], nextCursor: "cursor-2" })
      }

      if (url.pathname === "/trpc/getHostedWorkspace") {
        if (state.detail === "null") return envelope(null)
        if (state.detail === "invalid") return envelope({ nope: true })
        return envelope(
          workspaceSummary({
            workspaceId: state.detail === "mismatch" ? OTHER_WORKSPACE : WORKSPACE,
            nextSessionCursor: "session-cursor-1",
          }),
        )
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
  kiloCloud({ auth: auth(info), env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_WEB_APP_URL: url } })

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
