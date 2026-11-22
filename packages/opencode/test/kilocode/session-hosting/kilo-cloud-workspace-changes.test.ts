import { Auth } from "@/auth"
import { PROVIDER, provider as kiloCloud } from "@/kilocode/session-hosting/kilo-cloud"
import { ProviderID } from "@/kilocode/session-hosting/types"
import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

const WORKSPACE = "worktree_12345678-1234-1234-1234-123456789abc"
const OTHER_WORKSPACE = "worktree_87654321-4321-4321-8321-cba987654321"
const ORG = "22222222-2222-4222-8222-222222222222"
const TOKEN = "kilo-test-bearer-value"
const CONTROL = "kilo-test-control-value"
const HEAD = "1111111111111111111111111111111111111111"
const OTHER_HEAD = "2222222222222222222222222222222222222222"
const BASE = "3333333333333333333333333333333333333333"
const COMPARE = "4444444444444444444444444444444444444444"

type Call = {
  readonly method: string
  readonly path: string
  readonly search: string
  readonly auth: string | null
  readonly org: string | null
  readonly body: string
}

type State = {
  changes: "captured" | "empty" | "missing" | "mismatch" | "invalid"
  refresh: "offline" | "refreshed" | "failed"
  file: "available" | "omitted" | "stale" | "wrong-revision" | "deleted" | "not-captured" | "delisted"
  pull: "linked" | "not_linked" | "stale" | "unavailable" | "mismatch"
  pullFile: "available" | "omitted" | "stale"
  failure: "none" | "unauthorized" | "unavailable"
}

function comparison() {
  return {
    baseRef: "main",
    mergeBase: BASE,
    head: HEAD,
  }
}

function file(path: string, revision: number, scope?: string) {
  return {
    path,
    status: "modified",
    ...(scope === undefined ? {} : { scope }),
    additions: 2,
    deletions: 1,
    tracked: true,
    binary: false,
    countsComplete: true,
    revision,
    repository: scope === undefined ? null : { path: "", repoFullName: "Kilo-Org/kilocode" },
    diff: { status: "available" },
    content: { status: "available", source: "current" },
  }
}

function changes(revision: number, files: ReturnType<typeof file>[]) {
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

function harness() {
  const calls: Call[] = []
  const state: State = {
    changes: "captured",
    refresh: "offline",
    file: "available",
    pull: "linked",
    pullFile: "available",
    failure: "none",
  }

  const envelope = (data: unknown) => Response.json({ result: { data } })
  const error = (code: string, status: number) => Response.json({ error: code }, { status })

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
      if (state.failure === "unauthorized") return error("UNAUTHORIZED", 401)
      if (state.failure === "unavailable") return error("SERVICE_UNAVAILABLE", 503)

      if (url.pathname === "/trpc/getHostedWorkspaceChanges") {
        if (state.changes === "mismatch") {
          return envelope({ ...changes(12, []), workspaceId: OTHER_WORKSPACE })
        }
        if (state.changes === "invalid") return envelope({ status: "captured", nope: true })
        if (state.changes === "missing") {
          return envelope({
            status: "not_captured",
            workspaceId: WORKSPACE,
            revision: null,
            capturedAt: null,
            truncated: false,
            comparisons: null,
          })
        }
        return envelope(
          state.changes === "empty"
            ? changes(12, [])
            : changes(12, [
                file("src/committed.ts", 12, "against-base-branch"),
                file("src/working.ts", 12, "uncommitted"),
              ]),
        )
      }

      if (url.pathname === "/trpc/refreshHostedWorkspaceChanges") {
        return envelope({
          status: state.refresh,
          changes: changes(12, [file("src/committed.ts", 12, "against-base-branch")]),
        })
      }

      if (url.pathname === "/trpc/getHostedWorkspaceChangeFile") {
        if (state.file === "stale") {
          return envelope({
            status: "stale",
            file: null,
            capturedAt: null,
            comparison: null,
            currentRevision: 13,
          })
        }
        if (state.file === "not-captured") {
          return envelope({
            status: "not_captured",
            file: null,
            capturedAt: null,
            comparison: null,
            currentRevision: null,
          })
        }
        if (state.file === "delisted") {
          return envelope({
            status: "no_longer_listed",
            file: null,
            capturedAt: null,
            comparison: null,
            currentRevision: 13,
          })
        }
        if (state.file === "wrong-revision") {
          return envelope({
            status: "available",
            file: {
              schemaVersion: 1,
              revision: 11,
              path: "src/committed.ts",
              diff: { status: "available", patch: "@@ -1 +1 @@" },
              content: { status: "available", source: "current", text: "x\n" },
            },
            capturedAt: "2026-11-14T00:00:00.000Z",
            comparison: comparison(),
            currentRevision: null,
          })
        }
        if (state.file === "omitted") {
          return envelope({
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
          })
        }
        if (state.file === "deleted") {
          return envelope({
            status: "available",
            file: {
              schemaVersion: 1,
              revision: 12,
              path: "src/old.ts",
              diff: { status: "available", patch: "@@ -1 +0,0 @@" },
              content: { status: "available", source: "deleted-original", text: "old\n" },
            },
            capturedAt: "2026-11-14T00:00:00.000Z",
            comparison: comparison(),
            currentRevision: null,
          })
        }
        return envelope({
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
        })
      }

      if (url.pathname === "/trpc/getHostedWorkspacePullRequest") {
        if (state.pull === "mismatch") {
          return envelope({
            status: "not_linked",
            workspaceId: OTHER_WORKSPACE,
            reason: "no_pull_request",
            pullRequest: null,
            truncated: false,
            files: [],
          })
        }
        if (state.pull === "not_linked") {
          return envelope({
            status: "not_linked",
            workspaceId: WORKSPACE,
            reason: "no_pull_request",
            pullRequest: null,
            truncated: false,
            files: [],
          })
        }
        if (state.pull === "stale") {
          return envelope({
            status: "stale",
            workspaceId: WORKSPACE,
            reason: "pull_request_changed",
            pullRequest: null,
            truncated: false,
            files: [],
          })
        }
        if (state.pull === "unavailable") {
          return envelope({
            status: "unavailable",
            workspaceId: WORKSPACE,
            reason: "github_unavailable",
            pullRequest: null,
            truncated: false,
            files: [],
          })
        }
        return envelope({
          status: "linked",
          workspaceId: WORKSPACE,
          reason: null,
          pullRequest: {
            number: 123,
            url: "https://github.com/Kilo-Org/kilocode/pull/123",
            state: "open",
            draft: true,
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
            {
              path: "src/binary.png",
              previousPath: null,
              status: "modified",
              additions: 0,
              deletions: 0,
              patchAvailable: false,
            },
          ],
        })
      }

      if (url.pathname === "/trpc/getHostedWorkspacePullRequestFile") {
        if (state.pullFile === "stale") {
          return envelope({
            status: "stale",
            path: "src/committed.ts",
            reason: null,
            omissionReason: null,
            headSha: OTHER_HEAD,
            patch: null,
          })
        }
        if (state.pullFile === "omitted") {
          return envelope({
            status: "omitted",
            path: "src/binary.png",
            reason: null,
            omissionReason: "provider_omitted",
            headSha: HEAD,
            patch: null,
          })
        }
        return envelope({
          status: "available",
          path: "src/committed.ts",
          reason: null,
          omissionReason: null,
          headSha: HEAD,
          patch: "@@ -1 +1 @@",
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

const client = (url: string) =>
  kiloCloud({
    auth: auth(new Auth.Api({ type: "api", key: TOKEN })),
    env: { CLOUD_AGENT_NEXT_BASE_URL: url, KILO_WEB_APP_URL: url, KILO_API_URL: url },
  })

const id = { providerID: PROVIDER, workspaceID: WORKSPACE }

it.effect("reads committed and uncommitted workspace files without provider data", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const result = yield* cloud.getWorkspaceChanges({ id, organizationID: ORG })
    expect(result.status).toBe("captured")
    expect(result.revision).toBe(12)
    expect(result.comparisons?.[0]?.files.map((item) => [item.path, item.scope])).toEqual([
      ["src/committed.ts", "against-base-branch"],
      ["src/working.ts", "uncommitted"],
    ])
    expect(app.calls[0]).toMatchObject({
      method: "GET",
      path: "/trpc/getHostedWorkspaceChanges",
      auth: `Bearer ${CONTROL}`,
      org: ORG,
    })
    expect(app.calls[0]?.search).toContain("kilocodeOrganizationId")
    expect(app.calls[0]?.search).toContain(WORKSPACE)
    expect(app.calls[0]?.search).not.toContain("kiloSessionId")
    expect(app.calls.filter((call) => call.path === "/trpc/listHostedWorkspaces" || call.path === "/trpc/getHostedWorkspace")).toEqual([])
    const text = JSON.stringify(result)
    for (const secret of [app.url, TOKEN, "cloudAgentSessionId", "workspace_12345678"])
      expect(text).not.toContain(secret)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("distinguishes an empty captured comparison from an unavailable snapshot", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.changes = "empty"
    const empty = yield* cloud.getWorkspaceChanges({ id })
    expect(empty.status).toBe("captured")
    expect(empty.comparisons?.[0]?.files).toEqual([])

    app.state.changes = "missing"
    const missing = yield* cloud.getWorkspaceChanges({ id })
    expect(missing.status).toBe("not_captured")
    expect(missing.comparisons).toBeNull()
    expect(missing.revision).toBeNull()
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("preserves omission reasons, deleted content, and refresh snapshots", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.file = "omitted"
    const file = yield* cloud.getWorkspaceChangeFile({
      id,
      path: "src/binary.png",
      expectedRevision: 12,
    })
    expect(file.status).toBe("omitted")
    expect(file.file?.diff).toEqual({ status: "omitted", reason: "binary" })
    expect(file.file?.content).toEqual({ status: "unavailable", reason: "too_large" })

    app.state.file = "available"
    const unscoped = yield* cloud.getWorkspaceChangeFile({
      id,
      path: "src/committed.ts",
      expectedRevision: 12,
    })
    expect(unscoped.status).toBe("available")
    expect(unscoped.file?.scope).toBe("against-base-branch")

    app.state.file = "deleted"
    const deleted = yield* cloud.getWorkspaceChangeFile({
      id,
      path: "src/old.ts",
      expectedRevision: 12,
    })
    expect(deleted.file?.content).toEqual({
      status: "available",
      source: "deleted-original",
      text: "old\n",
    })

    app.state.file = "available"
    app.state.refresh = "offline"
    const refresh = yield* cloud.refreshWorkspaceChanges({ id, organizationID: ORG })
    expect(refresh.status).toBe("offline")
    expect(refresh.changes.status).toBe("captured")
    expect(refresh.changes.revision).toBe(12)
    expect(app.calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/trpc/refreshHostedWorkspaceChanges",
    })
    expect(JSON.parse(app.calls.at(-1)?.body ?? "{}")).toEqual({
      workspaceId: WORKSPACE,
      kilocodeOrganizationId: ORG,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("fences stale and mismatched per-file revisions", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.file = "stale"
    const stale = yield* cloud.getWorkspaceChangeFile({
      id,
      path: "src/committed.ts",
      expectedRevision: 12,
    })
    expect(stale).toEqual({
      status: "stale",
      file: null,
      capturedAt: null,
      comparison: null,
      currentRevision: 13,
    })

    app.state.file = "wrong-revision"
    const mismatch = yield* cloud
      .getWorkspaceChangeFile({ id, path: "src/committed.ts", expectedRevision: 12 })
      .pipe(Effect.flip)
    expect(mismatch).toMatchObject({ code: "invalid_response", retryable: false })

    app.state.file = "not-captured"
    expect(yield* cloud.getWorkspaceChangeFile({ id, path: "src/committed.ts", expectedRevision: 12 })).toEqual({
      status: "not_captured",
      file: null,
      capturedAt: null,
      comparison: null,
      currentRevision: null,
    })

    app.state.file = "delisted"
    expect(yield* cloud.getWorkspaceChangeFile({ id, path: "src/committed.ts", expectedRevision: 12 })).toEqual({
      status: "no_longer_listed",
      file: null,
      capturedAt: null,
      comparison: null,
      currentRevision: 13,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("keeps linked PR files distinct and returns not_linked as success", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const linked = yield* cloud.getWorkspacePullRequestDiff({ id })
    expect(linked.status).toBe("linked")
    expect(linked.pullRequest?.number).toBe(123)
    expect(linked.pullRequest?.headSha).toBe(HEAD)
    expect(linked.files.map((item) => item.patchAvailable)).toEqual([true, false])

    const patch = yield* cloud.getWorkspacePullRequestDiffFile({
      id,
      path: "src/committed.ts",
      expectedHeadSha: HEAD,
    })
    expect(patch).toEqual({
      status: "available",
      path: "src/committed.ts",
      reason: null,
      omissionReason: null,
      headSha: HEAD,
      patch: "@@ -1 +1 @@",
    })

    app.state.pull = "stale"
    const stale = yield* cloud.getWorkspacePullRequestDiff({ id })
    expect(stale).toMatchObject({ status: "stale", reason: "pull_request_changed", pullRequest: null, files: [] })

    app.state.pull = "not_linked"
    const none = yield* cloud.getWorkspacePullRequestDiff({ id })
    expect(none).toMatchObject({ status: "not_linked", pullRequest: null, files: [] })

    app.state.pullFile = "omitted"
    const omitted = yield* cloud.getWorkspacePullRequestDiffFile({
      id,
      path: "src/binary.png",
      expectedHeadSha: HEAD,
    })
    expect(omitted).toEqual({
      status: "omitted",
      path: "src/binary.png",
      reason: null,
      omissionReason: "provider_omitted",
      headSha: HEAD,
      patch: null,
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("maps provider failures and inconsistent identities without synthesizing a diff", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    app.state.failure = "unauthorized"
    const unauthorized = yield* cloud.getWorkspaceChanges({ id }).pipe(Effect.flip)
    expect(unauthorized.code).toBe("unauthorized")

    app.state.failure = "unavailable"
    const unavailable = yield* cloud.getWorkspacePullRequestDiff({ id }).pipe(Effect.flip)
    expect(unavailable.code).toBe("unavailable")

    app.state.failure = "none"
    app.state.changes = "mismatch"
    expect(yield* cloud.getWorkspaceChanges({ id }).pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
    })

    app.state.changes = "invalid"
    expect(yield* cloud.getWorkspaceChanges({ id }).pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
    })

    app.state.pull = "mismatch"
    expect(yield* cloud.getWorkspacePullRequestDiff({ id }).pipe(Effect.flip)).toMatchObject({
      code: "invalid_response",
    })

    app.state.pull = "unavailable"
    expect(yield* cloud.getWorkspacePullRequestDiff({ id })).toMatchObject({
      status: "unavailable",
      reason: "github_unavailable",
      pullRequest: null,
      files: [],
    })
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})

it.effect("rejects a request for another provider identity", () => {
  const app = harness()
  return Effect.gen(function* () {
    const cloud = client(app.url)
    const wrong = Schema.decodeUnknownSync(ProviderID)("other")
    const result = yield* cloud
      .getWorkspaceChanges({ id: { providerID: wrong, workspaceID: WORKSPACE } })
      .pipe(Effect.flip)
    expect(result).toMatchObject({ code: "invalid_request", retryable: false })
    expect(app.calls).toHaveLength(0)
  }).pipe(Effect.ensuring(Effect.sync(() => app.stop())))
})
