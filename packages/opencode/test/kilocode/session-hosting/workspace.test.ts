import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import {
  WorkspaceID,
  workspaceKey,
  workspaceSessionKey,
  type WorkspaceCreateInput,
} from "@/kilocode/session-hosting/types"
import { Effect, Layer, Schema } from "effect"
import { expect } from "bun:test"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const TOKEN = "kilo-test-bearer-value"
const ORG = "22222222-2222-4222-8222-222222222222"
const WORKSPACE = "worktree_12345678-1234-1234-1234-123456789abc"
const OTHER_WORKSPACE = "worktree_87654321-4321-4321-4321-cba987654321"
const REMOTE = "workspace_12345678-1234-1234-1234-123456789abc"
const NATIVE = "ses_00000000000000000000000001"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"
const OPERATION = "11111111-1111-4111-8111-111111111111"

type Call = {
  readonly method: string
  readonly path: string
  readonly search: string
  readonly auth: string | null
  readonly org: string | null
  readonly body: string
}

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
    userId: "user_private",
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
    providerOrigin: "https://private.example",
    ...overrides,
  }
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE,
    deletionState: "deleting",
    observedAt: 1_000,
    compute: {
      status: "sleeping",
      detailCode: "sandbox_stopped",
      observedAt: 990,
      estimatedSleepAt: null,
    },
    activity: { activeSessionCount: 0, hasActiveTurn: false },
    wakeOnInput: { available: false, blockedReason: "deleting" },
    billing: {
      payer: { type: "org", id: "org_private" },
      sku: "cloud-agent",
      blocked: false,
      enforcementRequested: false,
      intervalStartedAt: null,
      rate: { rateCentsPerSecond: "0.01", estimatedHourlyMicrodollars: 360_000 },
      userId: "user_private",
    },
    deletion: {
      started: true,
      completed: false,
      startedAt: 900,
      phase: "runtime_cleanup",
      sessionCount: 1,
      runtimeLocationCount: 1,
      completedRuntimeLocationCount: 0,
      remainingRuntimeLocationCount: 1,
      deletedSessionIds: [],
    },
    provider: "private-provider",
    ...overrides,
  }
}

function harness() {
  const calls: Call[] = []
  const state = {
    workspace: "ok" as "ok" | "missing" | "mismatch",
    status: "ok" as "ok" | "missing",
    create: "ok" as "ok" | "conflict",
    delete: "ok" as "ok" | "conflict",
    profiles: "ok" as "ok" | "unavailable",
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

      if (url.pathname === "/trpc/listHostedWorkspaces") {
        return Response.json({
          result: { data: { items: [workspace()], nextCursor: null } },
        })
      }

      if (url.pathname === "/trpc/getHostedWorkspace") {
        if (state.workspace === "missing") return Response.json({ result: { data: null } })
        const mismatch = state.workspace === "mismatch"
        return Response.json({
          result: {
            data: workspace(mismatch ? { workspaceId: OTHER_WORKSPACE } : {}),
          },
        })
      }

      if (url.pathname === "/trpc/getHostedWorkspaceStatus") {
        if (state.status === "missing") {
          return Response.json({ error: { message: "workspace_not_found" } }, { status: 404 })
        }
        return Response.json({ result: { data: status() } })
      }

      if (url.pathname === "/trpc/createHostedWorkspace") {
        if (state.create === "conflict") {
          return Response.json({ error: { message: "workspace_deleting" } }, { status: 409 })
        }
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
        if (state.delete === "conflict") {
          return Response.json({ error: { message: "workspace_deleting" } }, { status: 409 })
        }
        return Response.json({
          result: { data: { success: true, deletedSessionIds: [NATIVE] } },
        })
      }

      if (url.pathname === "/api/trpc/agentProfiles.list") {
        if (state.profiles === "unavailable") {
          return Response.json({ error: { message: "unavailable" } }, { status: 503 })
        }
        return Response.json({
          result: {
            data: {
              json: [
                {
                  id: "profile_1",
                  name: "Default",
                  description: "Sanitized summary",
                  isDefault: true,
                  varCount: 2,
                  varValues: ["SECRET_VALUE"],
                },
              ],
            },
          },
        })
      }

      return Response.json({ error: "not found" }, { status: 404 })
    },
  })

  return { url: `http://127.0.0.1:${server.port}`, calls, state, stop: () => server.stop(true) }
}

function signedIn() {
  const info = new Auth.Api({ type: "api", key: TOKEN })
  return {
    get: (id: string) => Effect.succeed(id === "kilo" ? info : undefined),
    all: () => Effect.succeed<Record<string, Auth.Info>>({ kilo: info }),
    set: () => Effect.void,
    remove: () => Effect.void,
  } satisfies Auth.Interface
}

function client(url: string) {
  return kiloCloud({
    auth: signedIn(),
    env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_API_URL: url },
  })
}

const createInput: WorkspaceCreateInput = {
  repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
  profileID: "profile_1",
  prompt: "Ship the workspace",
  agent: { mode: "code", model: "kilo/test-model", variant: "fast" },
  organizationID: ORG,
  operationKey: OPERATION,
  messageID: MESSAGE,
}

it.effect("maps workspace and nested session identities without leaking provider internals", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const page = yield* cloud.workspace!.list({ limit: 5, sessionLimit: 2, repositoryUrl: "Kilo-Org/kilocode" })

    expect(page.items).toHaveLength(1)
    const workspace = page.items.at(0)!
    expect(workspaceKey(workspace.id)).toBe(`${PROVIDER}:${WORKSPACE}`)
    expect(workspace.repository).toEqual({
      type: "github",
      url: "https://github.com/Kilo-Org/kilocode.git",
      branch: "main",
    })
    expect(workspace.sessions).toHaveLength(1)
    expect(workspaceSessionKey(workspace.sessions[0]!.id)).toBe(
      `${PROVIDER}:${WORKSPACE}:${REMOTE}:${NATIVE}`,
    )
    expect(workspace.sessions[0]!.title).toBe("Hosted root")

    const serialized = JSON.stringify(page)
    for (const secret of ["user_private", "sandbox_private", "private.example", TOKEN]) {
      expect(serialized).not.toContain(secret)
    }

    const call = app.calls[0]
    expect(call).toMatchObject({ method: "GET", path: "/trpc/listHostedWorkspaces", auth: `Bearer ${TOKEN}` })
    const input = JSON.parse(new URL(call.search, "http://localhost").searchParams.get("input")!)
    expect(input).toEqual({ limit: 5, sessionLimit: 2, repositoryUrl: "Kilo-Org/kilocode" })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("creates a workspace with the first session using explicit scope and idempotency keys", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const created = yield* cloud.workspace!.create(createInput)

    expect(created).toEqual({
      workspace: { providerID: PROVIDER, workspaceID: WORKSPACE },
      session: {
        providerID: PROVIDER,
        workspaceID: WORKSPACE,
        remoteSessionID: REMOTE,
        nativeSessionID: NATIVE,
      },
      messageID: MESSAGE,
      replayed: false,
    })

    const call = app.calls[0]
    expect(call).toMatchObject({ method: "POST", path: "/trpc/createHostedWorkspace", org: ORG })
    expect(JSON.parse(call.body)).toEqual({
      operationKey: OPERATION,
      clientProvenance: "agent-manager",
      repository: { type: "github", repo: "Kilo-Org/kilocode", branch: "main" },
      profile: { id: "profile_1" },
      message: { prompt: "Ship the workspace", id: MESSAGE },
      agent: { mode: "code", model: "kilo/test-model", variant: "fast" },
      options: { kilocodeOrganizationId: ORG },
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("creates sibling sessions, projects passive status, and deletes the workspace", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const id = { providerID: PROVIDER, workspaceID: WORKSPACE }

    const created = yield* cloud.workspace!.createSession({
      id,
      prompt: "Another root",
      agent: { mode: "code", model: "kilo/test-model" },
      organizationID: ORG,
      operationKey: OPERATION,
      messageID: MESSAGE,
    })
    expect(created.replayed).toBe(true)
    expect(JSON.parse(app.calls[0]!.body)).toEqual({
      workspaceId: WORKSPACE,
      operationKey: OPERATION,
      clientProvenance: "agent-manager",
      message: { prompt: "Another root", id: MESSAGE },
      agent: { mode: "code", model: "kilo/test-model" },
      kilocodeOrganizationId: ORG,
    })

    const current = yield* cloud.workspace!.status({ id, organizationID: ORG })
    expect(current.compute).toEqual({
      status: "sleeping",
      detailCode: "sandbox_stopped",
      observedAt: 990,
      estimatedSleepAt: null,
    })
    expect(current.billing.payer).toBe("org")
    expect(current.deletion).toMatchObject({ phase: "runtime_cleanup", remainingRuntimeLocationCount: 1 })
    expect(JSON.stringify(current)).not.toContain("org_private")
    expect(JSON.stringify(current)).not.toContain("private-provider")

    const deleted = yield* cloud.workspace!.delete({ id, organizationID: ORG })
    expect(deleted).toEqual({ workspace: id, success: true, deletedSessionIDs: [NATIVE] })
    expect(JSON.parse(app.calls[2]!.body)).toEqual({
      worktreeId: WORKSPACE,
      kilocodeOrganizationId: ORG,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("returns deterministic not_found and rejected failures without fallback", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const id = { providerID: PROVIDER, workspaceID: WORKSPACE }

    app.state.workspace = "missing"
    expect(yield* cloud.workspace!.get({ id }).pipe(Effect.flip)).toMatchObject({
      code: "not_found",
      retryable: false,
    })

    app.state.workspace = "mismatch"
    expect(yield* cloud.workspace!.get({ id }).pipe(Effect.flip)).toMatchObject({ code: "invalid_response" })

    app.state.status = "missing"
    expect(yield* cloud.workspace!.status({ id }).pipe(Effect.flip)).toMatchObject({
      code: "not_found",
      retryable: false,
    })

    app.state.create = "conflict"
    expect(yield* cloud.workspace!.create(createInput).pipe(Effect.flip)).toMatchObject({
      code: "rejected",
      retryable: false,
    })

    app.state.delete = "conflict"
    expect(yield* cloud.workspace!.delete({ id }).pipe(Effect.flip)).toMatchObject({
      code: "rejected",
      retryable: false,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("pages to the requested workspace session before minting an attachment", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const attached = yield* cloud.workspace!.attach({
      id: { providerID: PROVIDER, workspaceID: WORKSPACE, remoteSessionID: REMOTE },
      organizationID: ORG,
    })
    expect(attached.session).toEqual({
      providerID: PROVIDER,
      workspaceID: WORKSPACE,
      remoteSessionID: REMOTE,
      nativeSessionID: NATIVE,
    })
    expect(attached.expiresAt).toBeGreaterThan(Date.now())

    const missing = yield* cloud.workspace!.attach({
      id: { providerID: PROVIDER, workspaceID: WORKSPACE, remoteSessionID: "workspace_other" },
      organizationID: ORG,
    }).pipe(Effect.flip)
    expect(missing).toMatchObject({ code: "not_found" })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("returns authorized profile summaries only", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const profiles = yield* cloud.workspace!.profiles({ organizationID: ORG })

    expect(profiles.items).toEqual([
      { id: "profile_1", name: "Default", description: "Sanitized summary", isDefault: true },
    ])
    expect(JSON.stringify(profiles)).not.toContain("SECRET_VALUE")
    expect(app.calls[0]).toMatchObject({ method: "GET", path: "/api/trpc/agentProfiles.list", org: ORG })
    const input = JSON.parse(new URL(app.calls[0]!.search, "http://localhost").searchParams.get("input")!)
    expect(input).toEqual({ organizationId: ORG })

    app.state.profiles = "unavailable"
    expect(yield* cloud.workspace!.profiles({ organizationID: ORG }).pipe(Effect.flip)).toMatchObject({
      code: "unavailable",
      retryable: true,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("keeps workspace identities composite across providers and workspaces", () => {
  const app = harness()
  return Effect.gen(function* () {
    const a = client(app.url)
    const b = kiloCloud({
      auth: signedIn(),
      env: { CLOUD_AGENT_NEXT_BASE_URL: app.url, KILO_API_URL: app.url },
    })
    const pageA = yield* a.workspace!.list()
    const pageB = yield* b.workspace!.list()

    const one = pageA.items[0]!.id
    const two = pageB.items[0]!.id
    expect(workspaceKey(one)).toBe(workspaceKey(two))

    Schema.decodeUnknownSync(WorkspaceID)("worktree_12345678-1234-1234-1234-123456789abc")
    expect(workspaceKey({ ...one, workspaceID: "worktree_other" })).not.toBe(workspaceKey(one))
    expect(workspaceSessionKey(pageA.items[0]!.sessions[0]!.id)).not.toBe(
      workspaceSessionKey({ ...pageA.items[0]!.sessions[0]!.id, workspaceID: "worktree_other" }),
    )
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})
