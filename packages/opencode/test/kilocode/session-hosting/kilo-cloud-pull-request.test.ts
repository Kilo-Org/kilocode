import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import {
  HostedFailure,
  type WorkspacePullRequestInput,
  type WorkspacePullRequestSummary,
} from "@/kilocode/session-hosting/types"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const WORKSPACE = "worktree_12345678-1234-1234-1234-123456789abc"
const OTHER = "worktree_87654321-4321-4321-8321-cba987654321"
const ORG = "22222222-2222-4222-8222-222222222222"
const SAVED = "33333333-3333-4333-8333-333333333333"
const SOURCE = "kilo-source-bearer-value"
const CONTROL = "kilo-control-token-value"
const NOW = Date.parse("2026-10-21T12:00:00.000Z")
const ID = { providerID: PROVIDER, workspaceID: WORKSPACE }
const INPUT = { id: ID }

type Call = {
  method: string
  path: string
  search: string
  auth: string | null
  org: string | null
  content: string | null
  body: string
}

function summary(): WorkspacePullRequestSummary {
  return {
    url: "https://github.com/Kilo-Org/cloud/pull/142",
    number: 142,
    state: "open",
    title: "Expose hosted workspace PR status",
    headSha: "a".repeat(40),
    lastSyncedAt: "2026-10-21T12:00:00.000Z",
    review: { decision: "approved", available: true, pending: false },
    checks: { total: 6, passed: 2, failed: 1, pending: 1, skipped: 1, unknown: 1, complete: true, available: true },
    conversations: { unresolved: 1, complete: true },
    mergeability: { mergeable: false, state: "blocked", complete: true },
    partial: false,
    unavailable: [],
  }
}

function workspace(pullRequest: unknown = summary()) {
  return {
    workspaceId: WORKSPACE,
    userId: "private-workspace-owner",
    organizationId: null,
    name: "Hosted workspace",
    repositoryProvider: "github",
    gitUrl: "https://github.com/Kilo-Org/cloud",
    gitBranch: "main",
    profileId: null,
    deletionState: "active",
    created: 100,
    updated: 200,
    lastActivity: 300,
    sessions: [],
    nextSessionCursor: null,
    pullRequest,
  }
}

function harness() {
  const state = {
    read: workspace() as unknown,
    refresh: {
      workspaceId: WORKSPACE,
      pullRequest: summary(),
      refresh: { status: "refreshed", retryAt: null },
    } as unknown,
    issue: 200,
    status: 200,
    wire: "ok" as "ok" | "json" | "envelope",
    tokens: "shared" as "shared" | "scoped",
  }

  function serve(kind: "issuer" | "worker") {
    const calls: Call[] = []
    const server = Bun.serve({
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
          content: request.headers.get("content-type"),
          body: request.method === "POST" ? await request.text() : "",
        })
        if (kind === "issuer" && url.pathname === "/api/cloud-agent-next/token") {
          if (state.issue !== 200) return Response.json({ error: "private-issuer-error" }, { status: state.issue })
          const organization = Object(JSON.parse(calls.at(-1)?.body ?? "{}")).organizationId ?? "personal"
          const token = state.tokens === "scoped" ? `${CONTROL}-${organization}` : CONTROL
          return Response.json({ token, expiresAt: "2026-10-21T12:10:00.000Z" })
        }
        if (kind === "worker") {
          if (state.status !== 200) return Response.json({ error: "private-worker-error" }, { status: state.status })
          if (state.wire === "json") return new Response("not json")
          if (state.wire === "envelope") return Response.json({ data: state.read })
          if (url.pathname === "/trpc/getHostedWorkspace") return Response.json({ result: { data: state.read } })
          if (url.pathname === "/trpc/refreshHostedWorkspacePullRequest") {
            return Response.json({ result: { data: state.refresh } })
          }
        }
        return Response.json({ error: "Unexpected upstream operation" }, { status: 404 })
      },
    })
    return { url: `http://127.0.0.1:${server.port}`, calls, stop: () => server.stop(true) }
  }

  return { state, issuer: serve("issuer"), worker: serve("worker") }
}

const fixture = Effect.acquireRelease(Effect.sync(harness), (app) =>
  Effect.promise(async () => {
    await app.issuer.stop()
    await app.worker.stop()
  }),
)

function client(
  app: ReturnType<typeof harness>,
  info: Auth.Info | null = new Auth.Api({ type: "api", key: SOURCE }),
  env: Record<string, string | undefined> = {},
) {
  return kiloCloud({
    auth: {
      get: (id) => Effect.succeed(id === "kilo" ? (info ?? undefined) : undefined),
      all: () => (info ? Effect.succeed({ kilo: info }) : Effect.succeed({})),
      set: () => Effect.die(new Error("PR observations must not change stored credentials")),
      remove: () => Effect.die(new Error("PR observations must not remove stored credentials")),
    },
    env: { CLOUD_AGENT_NEXT_BASE_URL: app.worker.url, KILO_WEB_APP_URL: app.issuer.url, ...env },
    clock: () => NOW,
  })
}

function without(value: object, key: string) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
}

it.live("reads the cached PR passively with exact personal auth and never refreshes or wakes compute", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)

    expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "available", pullRequest: summary() })
    expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "available", pullRequest: summary() })

    expect(app.issuer.calls).toEqual([
      {
        method: "POST",
        path: "/api/cloud-agent-next/token",
        search: "",
        auth: `Bearer ${SOURCE}`,
        org: null,
        content: "application/json",
        body: "{}",
      },
    ])
    expect(app.worker.calls).toEqual(
      Array.from({ length: 2 }, () => ({
        method: "GET",
        path: "/trpc/getHostedWorkspace",
        search: `?input=${encodeURIComponent(JSON.stringify({ workspaceId: WORKSPACE, sessionLimit: 1 }))}`,
        auth: `Bearer ${CONTROL}`,
        org: null,
        content: null,
        body: "",
      })),
    )
  }),
)

it.live("scopes issuer and Worker auth to an organization without adding keys to strict PR payloads", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)
    const input = { ...INPUT, organizationID: ORG }

    expect(yield* cloud.getWorkspacePullRequest!(input)).toEqual({ id: ID, state: "available", pullRequest: summary() })
    expect(yield* cloud.refreshWorkspacePullRequest!(input)).toEqual({
      id: ID,
      state: "available",
      pullRequest: summary(),
      refresh: { status: "refreshed", retryAt: null },
    })

    expect(app.issuer.calls).toHaveLength(1)
    expect(app.issuer.calls.at(0)).toMatchObject({
      method: "POST",
      auth: `Bearer ${SOURCE}`,
      org: ORG,
      body: JSON.stringify({ organizationId: ORG }),
    })
    expect(app.worker.calls).toEqual([
      {
        method: "GET",
        path: "/trpc/getHostedWorkspace",
        search: `?input=${encodeURIComponent(JSON.stringify({ workspaceId: WORKSPACE, sessionLimit: 1 }))}`,
        auth: `Bearer ${CONTROL}`,
        org: ORG,
        content: null,
        body: "",
      },
      {
        method: "POST",
        path: "/trpc/refreshHostedWorkspacePullRequest",
        search: "",
        auth: `Bearer ${CONTROL}`,
        org: ORG,
        content: "application/json",
        body: JSON.stringify({ workspaceId: WORKSPACE }),
      },
    ])
  }),
)

it.live("keeps personal refresh payloads strict and exchanges a distinct token for each organization scope", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    app.state.tokens = "scoped"
    const cloud = client(app)

    yield* cloud.refreshWorkspacePullRequest!(INPUT)
    yield* cloud.refreshWorkspacePullRequest!({ ...INPUT, organizationID: ORG })
    yield* cloud.getWorkspacePullRequest!(INPUT)

    expect(app.issuer.calls.map((call) => ({ org: call.org, body: JSON.parse(call.body) }))).toEqual([
      { org: null, body: {} },
      { org: ORG, body: { organizationId: ORG } },
    ])
    expect(app.worker.calls.map((call) => ({ path: call.path, org: call.org, body: call.body }))).toEqual([
      { path: "/trpc/refreshHostedWorkspacePullRequest", org: null, body: JSON.stringify({ workspaceId: WORKSPACE }) },
      { path: "/trpc/refreshHostedWorkspacePullRequest", org: ORG, body: JSON.stringify({ workspaceId: WORKSPACE }) },
      { path: "/trpc/getHostedWorkspace", org: null, body: "" },
    ])
    expect(app.worker.calls.map((call) => call.auth)).toEqual([
      `Bearer ${CONTROL}-personal`,
      `Bearer ${CONTROL}-${ORG}`,
      `Bearer ${CONTROL}-personal`,
    ])
    expect(app.issuer.calls.every((call) => call.auth === `Bearer ${SOURCE}`)).toBe(true)
  }),
)

it.live("uses saved and environment organization selection while honoring an explicit organization override", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const info = new Auth.Oauth({
      type: "oauth",
      access: SOURCE,
      refresh: "private-refresh",
      expires: NOW,
      accountId: SAVED,
    })

    yield* client(app, info).getWorkspacePullRequest!(INPUT)
    yield* client(app, info, { KILO_ORG_ID: ORG }).refreshWorkspacePullRequest!(INPUT)
    yield* client(app, info, { KILO_ORG_ID: SAVED }).getWorkspacePullRequest!({ ...INPUT, organizationID: ORG })

    expect(app.issuer.calls.map((call) => ({ org: call.org, body: JSON.parse(call.body) }))).toEqual([
      { org: SAVED, body: { organizationId: SAVED } },
      { org: ORG, body: { organizationId: ORG } },
      { org: ORG, body: { organizationId: ORG } },
    ])
    expect(app.worker.calls.map((call) => call.org)).toEqual([SAVED, ORG, ORG])
    expect(JSON.parse(app.worker.calls.at(1)!.body)).toEqual({ workspaceId: WORKSPACE })
    for (const call of app.worker.calls.filter((call) => call.method === "GET")) {
      expect(JSON.parse(new URLSearchParams(call.search).get("input")!)).toEqual({
        workspaceId: WORKSPACE,
        sessionLimit: 1,
      })
    }
  }),
)

it.live("projects only public PR fields and strips provider-private extras at every nesting level", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)
    const extra = {
      ownerId: "private-owner-id",
      sandboxId: "private-sandbox-id",
      directory: "/private/workspace/path",
      sourceToken: SOURCE,
      controlToken: CONTROL,
      controlUrl: app.worker.url,
      sourceUrl: app.issuer.url,
    }
    const pr = summary()
    const value = {
      ...pr,
      ...extra,
      review: { ...pr.review, ...extra },
      checks: { ...pr.checks, ...extra },
      conversations: { ...pr.conversations, ...extra },
      mergeability: { ...pr.mergeability, ...extra },
    }
    app.state.read = { ...workspace(value), ...extra }
    app.state.refresh = {
      workspaceId: WORKSPACE,
      pullRequest: value,
      refresh: { status: "refreshed", retryAt: null, ...extra },
      ...extra,
    }

    const read = yield* cloud.getWorkspacePullRequest!(INPUT)
    const refresh = yield* cloud.refreshWorkspacePullRequest!(INPUT)
    expect(read).toEqual({ id: ID, state: "available", pullRequest: pr })
    expect(refresh).toEqual({
      id: ID,
      state: "available",
      pullRequest: pr,
      refresh: { status: "refreshed", retryAt: null },
    })
    for (const secret of [...Object.keys(extra), ...Object.values(extra), "private-workspace-owner"]) {
      expect(JSON.stringify([read, refresh])).not.toContain(secret)
    }
  }),
)

it.live("preserves every PR state and review decision without turning none or unknown into approval", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)
    for (const state of ["open", "draft", "merged", "closed", "unknown"] as const) {
      for (const decision of ["none", "review_required", "approved", "changes_requested", null] as const) {
        const pr = { ...summary(), state, review: { decision, available: decision !== null, pending: false } }
        app.state.read = workspace(pr)
        expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "available", pullRequest: pr })
      }
    }
  }),
)

it.live("preserves zero-check availability and completeness instead of treating zero as clean evidence", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)
    for (const available of [true, false]) {
      for (const complete of [true, false]) {
        const pr = {
          ...summary(),
          checks: { total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, unknown: 0, available, complete },
          partial: !available || !complete,
          unavailable: [],
        }
        app.state.read = workspace(pr)
        expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "available", pullRequest: pr })
      }
    }
  }),
)

it.live("preserves stale partial evidence, pending review, nullable observations and unparseable sync strings", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)
    const pr = {
      ...summary(),
      state: "unknown",
      title: null,
      headSha: "B".repeat(40),
      lastSyncedAt: "unparseable database timestamp",
      review: { decision: null, available: false, pending: true },
      checks: { total: 4, passed: 1, failed: 1, pending: 1, skipped: 0, unknown: 1, complete: false, available: false },
      conversations: { unresolved: null, complete: false },
      mergeability: { mergeable: null, state: null, complete: false },
      partial: true,
      unavailable: ["checks", "statuses", "reviews"],
    } satisfies WorkspacePullRequestSummary
    app.state.read = workspace(pr)
    expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "available", pullRequest: pr })

    const nullable = { ...pr, headSha: null, unavailable: [] }
    app.state.read = workspace(nullable)
    app.state.refresh = {
      workspaceId: WORKSPACE,
      pullRequest: nullable,
      refresh: { status: "refreshed", retryAt: null },
    }
    expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "available", pullRequest: nullable })
    expect(yield* cloud.refreshWorkspacePullRequest!(INPUT)).toEqual({
      id: ID,
      state: "available",
      pullRequest: nullable,
      refresh: { status: "refreshed", retryAt: null },
    })
  }),
)

it.live("returns no_pr only for an explicit nullable PR projection and does not invent a server cache", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)
    yield* cloud.getWorkspacePullRequest!(INPUT)

    app.state.read = workspace(null)
    expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "no_pr", pullRequest: null })

    app.state.read = null
    expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "unavailable", pullRequest: null })

    app.state.read = without(workspace(), "pullRequest")
    expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "unsupported", pullRequest: null })

    const pr = {
      ...summary(),
      url: "https://github.com/another/repository/pull/99",
      number: 99,
      headSha: "c".repeat(40),
    }
    app.state.read = { ...workspace(pr), workspaceId: OTHER }
    expect(yield* cloud.getWorkspacePullRequest!({ id: { ...ID, workspaceID: OTHER } })).toEqual({
      id: { ...ID, workspaceID: OTHER },
      state: "available",
      pullRequest: pr,
    })
    expect(app.worker.calls.map((call) => call.path)).toEqual(Array(5).fill("/trpc/getHostedWorkspace"))
  }),
)

for (const item of [
  { name: "null workspace", value: null },
  { name: "wrong workspace", value: { ...workspace(), workspaceId: OTHER } },
  { name: "missing workspace identity", value: without(workspace(), "workspaceId") },
  { name: "missing summary", value: { workspaceId: WORKSPACE, pullRequest: {} } },
  { name: "non-object summary", value: workspace("not a PR") },
]) {
  it.live(`treats ${item.name} as unavailable, never authoritative PR absence`, () =>
    Effect.gen(function* () {
      const app = yield* fixture
      app.state.read = item.value
      expect(yield* client(app).getWorkspacePullRequest!(INPUT)).toEqual({
        id: ID,
        state: "unavailable",
        pullRequest: null,
      })
      expect(app.worker.calls).toHaveLength(1)
    }),
  )
}

const malformed = [
  ...Object.keys(summary()).map((key) => ({ name: `missing ${key}`, value: without(summary(), key) })),
  ...(["review", "checks", "conversations", "mergeability"] as const).flatMap((part) =>
    Object.keys(summary()[part]).map((key) => ({
      name: `missing ${part}.${key}`,
      value: { ...summary(), [part]: without(summary()[part], key) },
    })),
  ),
  { name: "invalid PR state", value: { ...summary(), state: "ready" } },
  { name: "zero PR number", value: { ...summary(), number: 0 } },
  { name: "fractional PR number", value: { ...summary(), number: 1.5 } },
  { name: "negative PR number", value: { ...summary(), number: -1 } },
  { name: "invalid SHA", value: { ...summary(), headSha: "g".repeat(40) } },
  { name: "short SHA", value: { ...summary(), headSha: "a".repeat(39) } },
  { name: "empty sync timestamp", value: { ...summary(), lastSyncedAt: "" } },
  { name: "invalid title", value: { ...summary(), title: 123 } },
  { name: "invalid review decision", value: { ...summary(), review: { ...summary().review, decision: "unknown" } } },
  { name: "invalid review availability", value: { ...summary(), review: { ...summary().review, available: null } } },
  { name: "invalid review pending", value: { ...summary(), review: { ...summary().review, pending: "yes" } } },
  ...(["total", "passed", "failed", "pending", "skipped", "unknown"] as const).flatMap((key) => [
    { name: `negative ${key} count`, value: { ...summary(), checks: { ...summary().checks, [key]: -1 } } },
    { name: `fractional ${key} count`, value: { ...summary(), checks: { ...summary().checks, [key]: 0.5 } } },
  ]),
  { name: "negative conversations", value: { ...summary(), conversations: { unresolved: -1, complete: true } } },
  { name: "fractional conversations", value: { ...summary(), conversations: { unresolved: 0.5, complete: true } } },
  {
    name: "invalid mergeability",
    value: { ...summary(), mergeability: { ...summary().mergeability, mergeable: "yes" } },
  },
  {
    name: "long mergeability state",
    value: { ...summary(), mergeability: { ...summary().mergeability, state: "a".repeat(101) } },
  },
  { name: "invalid partial flag", value: { ...summary(), partial: null } },
  { name: "invalid unavailable category", value: { ...summary(), unavailable: ["mergeability"] } },
  ...[
    "http://github.com/Kilo-Org/cloud/pull/142",
    "https://gitlab.com/Kilo-Org/cloud/pull/142",
    "https://github.com.evil.example/Kilo-Org/cloud/pull/142",
    "https://private@github.com/Kilo-Org/cloud/pull/142",
    "https://user:secret@github.com/Kilo-Org/cloud/pull/142",
    "https://@github.com/Kilo-Org/cloud/pull/142",
    "https://github.com:443/Kilo-Org/cloud/pull/142",
    "https://github.com:444/Kilo-Org/cloud/pull/142",
    "https://github.com/Kilo-Org/cloud/./pull/142",
    "https://github.com/Kilo-Org/cloud/pull/142?",
    "https://github.com/Kilo-Org/cloud/pull/142#",
    "https://github.com/Kilo-Org/cloud/pull/142?token=private",
    "https://github.com/Kilo-Org/cloud/pull/142#private",
    "https://github.com/Kilo-Org/cloud/issues/142",
    "https://github.com/Kilo-Org/cloud/pull/0",
    "https://github.com/Kilo-Org/cloud/pull/143",
    "https://github.com/Kilo-Org/cloud/pull/142/files",
    "javascript:alert(1)",
  ].map((url) => ({ name: `unsafe URL ${url}`, value: { ...summary(), url } })),
]

for (const item of malformed) {
  it.live(`rejects ${item.name} in both passive and refreshed PR summaries`, () =>
    Effect.gen(function* () {
      const app = yield* fixture
      const cloud = client(app)
      app.state.read = workspace(item.value)
      app.state.refresh = {
        workspaceId: WORKSPACE,
        pullRequest: item.value,
        refresh: { status: "refreshed", retryAt: null },
      }
      expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "unavailable", pullRequest: null })
      expect(yield* cloud.refreshWorkspacePullRequest!(INPUT)).toEqual({
        id: ID,
        state: "unavailable",
        pullRequest: null,
      })
      expect(app.worker.calls).toHaveLength(2)
    }),
  )
}

for (const item of [
  { status: "refreshed", state: "available" },
  { status: "rate_limited", state: "rate_limited" },
  { status: "throttled", state: "rate_limited" },
  { status: "no_integration", state: "unavailable" },
  { status: "unavailable", state: "unavailable" },
  { status: "failed", state: "unavailable" },
] as const) {
  it.live(`preserves cached PR evidence and retry metadata for refresh ${item.status} without replay`, () =>
    Effect.gen(function* () {
      const app = yield* fixture
      const retryAt = "2026-10-21T12:05:00.000Z"
      app.state.refresh = {
        workspaceId: WORKSPACE,
        pullRequest: summary(),
        refresh: { status: item.status, retryAt },
      }
      expect(yield* client(app).refreshWorkspacePullRequest!(INPUT)).toEqual({
        id: ID,
        state: item.state,
        pullRequest: summary(),
        refresh: { status: item.status, retryAt },
      })
      expect(app.issuer.calls).toHaveLength(1)
      expect(app.worker.calls.map((call) => call.path)).toEqual(["/trpc/refreshHostedWorkspacePullRequest"])
    }),
  )
}

it.live("returns explicit no_pr only when refresh authoritatively returns no_pr with a null summary", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    app.state.refresh = { workspaceId: WORKSPACE, pullRequest: null, refresh: { status: "no_pr", retryAt: null } }
    expect(yield* client(app).refreshWorkspacePullRequest!(INPUT)).toEqual({
      id: ID,
      state: "no_pr",
      pullRequest: null,
      refresh: { status: "no_pr", retryAt: null },
    })
    expect(app.worker.calls).toHaveLength(1)
  }),
)

it.live("does not interpret null cached evidence in a failed or cooled-down refresh as no_pr", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)
    for (const item of [
      { status: "rate_limited", state: "rate_limited" },
      { status: "throttled", state: "rate_limited" },
      { status: "no_integration", state: "unavailable" },
      { status: "unavailable", state: "unavailable" },
      { status: "failed", state: "unavailable" },
    ] as const) {
      app.state.refresh = { workspaceId: WORKSPACE, pullRequest: null, refresh: { status: item.status, retryAt: null } }
      expect(yield* cloud.refreshWorkspacePullRequest!(INPUT)).toEqual({
        id: ID,
        state: item.state,
        pullRequest: null,
        refresh: { status: item.status, retryAt: null },
      })
    }
    expect(app.worker.calls).toHaveLength(5)
  }),
)

for (const item of [
  { name: "whole null", value: null },
  {
    name: "wrong workspace",
    value: { workspaceId: OTHER, pullRequest: summary(), refresh: { status: "refreshed", retryAt: null } },
  },
  { name: "missing workspace", value: { pullRequest: summary(), refresh: { status: "refreshed", retryAt: null } } },
  { name: "missing PR", value: { workspaceId: WORKSPACE, refresh: { status: "no_pr", retryAt: null } } },
  { name: "missing refresh metadata", value: { workspaceId: WORKSPACE, pullRequest: null } },
  { name: "missing retryAt", value: { workspaceId: WORKSPACE, pullRequest: null, refresh: { status: "no_pr" } } },
  {
    name: "invalid retryAt",
    value: { workspaceId: WORKSPACE, pullRequest: null, refresh: { status: "no_pr", retryAt: 123 } },
  },
  {
    name: "invalid refresh status",
    value: { workspaceId: WORKSPACE, pullRequest: null, refresh: { status: "ready", retryAt: null } },
  },
  {
    name: "refreshed without PR",
    value: { workspaceId: WORKSPACE, pullRequest: null, refresh: { status: "refreshed", retryAt: null } },
  },
  {
    name: "no_pr with cached PR",
    value: { workspaceId: WORKSPACE, pullRequest: summary(), refresh: { status: "no_pr", retryAt: null } },
  },
]) {
  it.live(`treats malformed refresh ${item.name} as unavailable without clearing or replaying`, () =>
    Effect.gen(function* () {
      const app = yield* fixture
      app.state.refresh = item.value
      expect(yield* client(app).refreshWorkspacePullRequest!(INPUT)).toEqual({
        id: ID,
        state: "unavailable",
        pullRequest: null,
      })
      expect(app.worker.calls).toHaveLength(1)
    }),
  )
}

it.live("reports missing credentials as signed_out without any issuer or Worker request", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app, null)
    expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "signed_out", pullRequest: null })
    expect(yield* cloud.refreshWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "signed_out", pullRequest: null })
    expect(app.issuer.calls).toHaveLength(0)
    expect(app.worker.calls).toHaveLength(0)
  }),
)

for (const boundary of ["issuer", "worker"] as const) {
  for (const item of [
    { status: 401, state: "rejected" },
    { status: 403, state: "rejected" },
    { status: 404, state: "unavailable" },
    { status: 429, state: "rate_limited" },
    { status: 500, state: "unavailable" },
    { status: 503, state: "unavailable" },
  ] as const) {
    it.live(`maps ${boundary} HTTP ${item.status} to ${item.state} without leaking errors or retrying`, () =>
      Effect.gen(function* () {
        const app = yield* fixture
        const cloud = client(app)
        if (boundary === "issuer") app.state.issue = item.status
        if (boundary === "worker") app.state.status = item.status

        const read = yield* cloud.getWorkspacePullRequest!(INPUT)
        const refresh = yield* cloud.refreshWorkspacePullRequest!(INPUT)
        expect(read).toEqual({ id: ID, state: item.state, pullRequest: null })
        expect(refresh).toEqual({ id: ID, state: item.state, pullRequest: null })
        expect(app.issuer.calls).toHaveLength(boundary === "issuer" ? 2 : 1)
        expect(app.worker.calls.map((call) => call.path)).toEqual(
          boundary === "issuer" ? [] : ["/trpc/getHostedWorkspace", "/trpc/refreshHostedWorkspacePullRequest"],
        )
        for (const secret of [
          app.worker.url,
          app.issuer.url,
          SOURCE,
          CONTROL,
          "private-issuer-error",
          "private-worker-error",
        ]) {
          expect(JSON.stringify([read, refresh])).not.toContain(secret)
        }
      }),
    )
  }

  it.live(`distinguishes ${boundary} network failures from authoritative PR absence`, () =>
    Effect.gen(function* () {
      const app = yield* fixture
      const cloud = client(app)
      yield* Effect.promise(() => app[boundary].stop())

      expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "unreachable", pullRequest: null })
      expect(yield* cloud.refreshWorkspacePullRequest!(INPUT)).toEqual({
        id: ID,
        state: "unreachable",
        pullRequest: null,
      })
      expect(app.worker.calls).toHaveLength(0)
      expect(app.issuer.calls).toHaveLength(boundary === "issuer" ? 0 : 1)
    }),
  )
}

for (const wire of ["json", "envelope"] as const) {
  it.live(`treats malformed upstream ${wire} as unavailable for read and refresh`, () =>
    Effect.gen(function* () {
      const app = yield* fixture
      const cloud = client(app)
      app.state.wire = wire
      expect(yield* cloud.getWorkspacePullRequest!(INPUT)).toEqual({ id: ID, state: "unavailable", pullRequest: null })
      expect(yield* cloud.refreshWorkspacePullRequest!(INPUT)).toEqual({
        id: ID,
        state: "unavailable",
        pullRequest: null,
      })
      expect(app.worker.calls).toHaveLength(2)
    }),
  )
}

it.live("rejects invalid inputs as HostedFailure invalid_request before any HTTP dispatch", () =>
  Effect.gen(function* () {
    const app = yield* fixture
    const cloud = client(app)
    for (const input of [
      {},
      { id: {} },
      { id: { ...ID, providerID: "Invalid Provider" } },
      { id: { ...ID, providerID: "other-cloud" } },
      { id: { ...ID, workspaceID: "" } },
      { id: { ...ID, workspaceID: "../private/path" } },
      { ...INPUT, organizationID: "" },
      { ...INPUT, organizationID: 123 },
    ]) {
      for (const operation of [cloud.getWorkspacePullRequest!, cloud.refreshWorkspacePullRequest!]) {
        const error = yield* operation(input as WorkspacePullRequestInput).pipe(Effect.flip)
        expect(error).toBeInstanceOf(HostedFailure)
        expect(error).toMatchObject({ code: "invalid_request", retryable: false })
      }
    }
    expect(app.issuer.calls).toHaveLength(0)
    expect(app.worker.calls).toHaveLength(0)
  }),
)
