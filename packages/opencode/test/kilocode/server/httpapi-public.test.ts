import { describe, expect, test } from "bun:test"
import { Result, Schema as EffectSchema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { AgentBuilderPaths } from "../../../src/kilocode/server/httpapi/groups/agent-builder"
import { BackgroundProcessPaths } from "../../../src/kilocode/server/httpapi/groups/background-process"
import { BranchNamePaths } from "../../../src/kilocode/server/httpapi/groups/branch-name"
import { ConfigConsolePaths } from "../../../src/kilocode/server/httpapi/groups/config-console"
import { IndexingPaths, KiloEmbeddingModel } from "../../../src/kilocode/server/httpapi/groups/indexing"
import { KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { KilocodePaths } from "../../../src/kilocode/server/httpapi/groups/kilocode"
import { MemoryPaths } from "../../../src/kilocode/server/httpapi/groups/memory"
import { SessionHostPaths } from "../../../src/kilocode/server/httpapi/groups/session-host"
import { NetworkPaths } from "../../../src/kilocode/server/httpapi/groups/network"
import { TelemetryPaths } from "../../../src/kilocode/server/httpapi/groups/telemetry"
import { ExperimentalPaths } from "../../../src/server/routes/instance/httpapi/groups/experimental"
import { SessionPaths } from "../../../src/server/routes/instance/httpapi/groups/session"
import { PublicApi } from "../../../src/server/routes/instance/httpapi/public"

type Schema = {
  $ref?: string
  anyOf?: Schema[]
  items?: Schema
  properties?: Record<string, Schema>
  type?: string
  enum?: string[]
  minLength?: number
  maxLength?: number
  pattern?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  required?: string[]
}

type Parameter = {
  in?: string
  name?: string
  schema?: Schema
  required?: boolean
}

type Method = "get" | "post" | "patch" | "put" | "delete"

type Body = {
  content?: Record<string, { schema?: Schema }>
}

describe("Kilo PublicApi OpenAPI contract", () => {
  test("exposes board paging and reset with a minimal snapshot", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const path = KilocodePaths.sessionBoard.replace(":sessionID", "{sessionID}")
    const reset = KilocodePaths.resetSessionBoard.replace(":sessionID", "{sessionID}")
    const query = spec.paths[path]?.get?.parameters as Parameter[] | undefined
    expect(spec.paths[path]?.get?.operationId).toBe("kilocode.sessionBoard")
    expect(spec.paths[reset]?.post?.operationId).toBe("kilocode.resetSessionBoard")
    expect(query?.find((field) => field.name === "limit")?.schema).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 50,
    })
    expect(Object.keys(spec.components?.schemas?.SessionBoard.properties ?? {}).sort()).toEqual([
      "cursor",
      "hasMore",
      "messages",
      "ownerSessionID",
      "revision",
    ])
  }, 20_000)

  test("exposes only the proven hosted session surface with opaque attachment ids", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const routes = [
      { method: "get" as const, path: SessionHostPaths.provider, id: "sessionHost.providers" },
      { method: "get" as const, path: SessionHostPaths.session, id: "sessionHost.list" },
      { method: "post" as const, path: SessionHostPaths.session, id: "sessionHost.start" },
      { method: "get" as const, path: SessionHostPaths.sessionDetail, id: "sessionHost.get" },
      { method: "get" as const, path: SessionHostPaths.message, id: "sessionHost.transcript" },
      { method: "post" as const, path: SessionHostPaths.attach, id: "sessionHost.attach" },
      { method: "delete" as const, path: SessionHostPaths.attachment, id: "sessionHost.detach" },
      { method: "get" as const, path: SessionHostPaths.workspace, id: "sessionHost.listWorkspaces" },
      {
        method: "get" as const,
        path: SessionHostPaths.workspaceProfiles,
        id: "sessionHost.listWorkspaceProfiles",
      },
      {
        method: "post" as const,
        path: SessionHostPaths.workspaceProfilePersonalDefault,
        id: "sessionHost.setWorkspacePersonalDefaultProfile",
      },
      {
        method: "delete" as const,
        path: SessionHostPaths.workspaceProfilePersonalDefaultDetail,
        id: "sessionHost.clearWorkspacePersonalDefaultProfile",
      },
      { method: "post" as const, path: SessionHostPaths.workspace, id: "sessionHost.createWorkspace" },
      { method: "post" as const, path: SessionHostPaths.workspaceContinue, id: "sessionHost.continueWorkspace" },
      { method: "get" as const, path: SessionHostPaths.workspaceDetail, id: "sessionHost.getWorkspace" },
      { method: "get" as const, path: SessionHostPaths.workspaceStatus, id: "sessionHost.getWorkspaceStatus" },
      {
        method: "get" as const,
        path: SessionHostPaths.workspacePullRequest,
        id: "sessionHost.getWorkspacePullRequest",
      },
      {
        method: "post" as const,
        path: SessionHostPaths.workspacePullRequestRefresh,
        id: "sessionHost.refreshWorkspacePullRequest",
      },
      { method: "get" as const, path: SessionHostPaths.workspaceChanges, id: "sessionHost.getWorkspaceChanges" },
      {
        method: "post" as const,
        path: SessionHostPaths.workspaceChangesRefresh,
        id: "sessionHost.refreshWorkspaceChanges",
      },
      {
        method: "get" as const,
        path: SessionHostPaths.workspaceChangeFile,
        id: "sessionHost.getWorkspaceChangeFile",
      },
      {
        method: "get" as const,
        path: SessionHostPaths.workspacePullRequestDiff,
        id: "sessionHost.getWorkspacePullRequestDiff",
      },
      {
        method: "get" as const,
        path: SessionHostPaths.workspacePullRequestDiffFile,
        id: "sessionHost.getWorkspacePullRequestDiffFile",
      },
      { method: "delete" as const, path: SessionHostPaths.workspaceDetail, id: "sessionHost.deleteWorkspace" },
      { method: "get" as const, path: SessionHostPaths.workspaceSession, id: "sessionHost.listWorkspaceSessions" },
      { method: "post" as const, path: SessionHostPaths.workspaceSession, id: "sessionHost.startWorkspaceSession" },
    ]

    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
      expect(spec.paths[path]?.[route.method]?.operationId).toBe(route.id)
    }

    const detach = SessionHostPaths.attachment.replace(":attachmentID", "{attachmentID}")
    const params = spec.paths[detach]?.delete?.parameters as Parameter[] | undefined
    expect(params?.find((param) => param.name === "attachmentID")?.schema).toMatchObject({
      type: "string",
    })

    // The hosted surface must not grow M2 contracts.
    const hosted = Object.entries(spec.paths)
      .filter(([path]) => path.startsWith("/kilocode/session-host"))
      .flatMap(([, item]) => Object.values(item as Record<string, { operationId?: string }>))
      .map((operation) => operation.operationId)
      .sort()
    expect(hosted).toEqual(routes.map((route) => route.id).sort())
  })

  test("keeps authorized workspace profile descriptions and defaults nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const summary = spec.components?.schemas?.SessionHostWorkspaceProfileSummary?.properties
    const description = summary ? Object.entries(summary).find(([field]) => field === "description")?.[1] : undefined
    expect(description).toEqual({
      anyOf: [expect.objectContaining({ type: "string" }), { type: "null" }],
    })

    const page = spec.components?.schemas?.SessionHostWorkspaceProfilePage?.properties
    for (const field of [
      "personalDefaultProfileID",
      "organizationDefaultProfileID",
      "effectiveDefaultProfileID",
    ]) {
      const value = page ? Object.entries(page).find(([key]) => key === field)?.[1] : undefined
      expect(value).toEqual({
        anyOf: [expect.objectContaining({ type: "string" }), { type: "null" }],
      })
    }
  })

  test("preserves the published optional profile-default organization input", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const input = spec.components?.schemas?.SessionHostWorkspaceProfileDefaultInput
    const field = Object.entries(input?.properties ?? {}).find(([key]) => key === "organizationID")?.[1]
    expect(field).toEqual({ $ref: "#/components/schemas/SessionHostOrganizationID" })
    expect(input?.required).toEqual(["id"])
  })

  test("keeps passive hosted workspace status fields nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    type Node = { properties?: Record<string, Node>; anyOf?: unknown[] }
    const status = (spec.components?.schemas?.SessionHostWorkspaceStatus as Node | undefined)?.properties
    const nullable = { anyOf: [expect.objectContaining({}), { type: "null" }] }

    expect(status?.compute?.properties?.estimatedSleepAt).toEqual(nullable)
    expect(status?.wakeOnInput?.properties?.blockedReason).toEqual(nullable)
    expect(status?.billing?.properties?.payer).toEqual({
      anyOf: [{ type: "string", enum: ["user", "org"] }, { type: "null" }],
    })
    expect(status?.billing?.properties?.sku).toEqual(nullable)
    expect(status?.billing?.properties?.blocked).toEqual({
      anyOf: [{ type: "boolean" }, { type: "null" }],
    })
    expect(status?.billing?.properties?.intervalStartedAt).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    })
    expect(status?.billing?.properties?.rate).toEqual(nullable)
    expect(status?.deletion?.properties?.startedAt).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    })
  })

  test("publishes exact workspace PR control routes with optional query organization and no refresh payload", () => {
    const spec = OpenApi.fromApi(PublicApi)
    expect(SessionHostPaths.workspacePullRequest).toBe(
      "/kilocode/session-host/workspace/:providerID/:workspaceID/pull-request",
    )
    expect(SessionHostPaths.workspacePullRequestRefresh).toBe(
      "/kilocode/session-host/workspace/:providerID/:workspaceID/pull-request/refresh",
    )
    for (const [method, path, id] of [
      ["get", SessionHostPaths.workspacePullRequest, "sessionHost.getWorkspacePullRequest"],
      ["post", SessionHostPaths.workspacePullRequestRefresh, "sessionHost.refreshWorkspacePullRequest"],
    ] as const) {
      const route = spec.paths[path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")]?.[method]
      expect(route?.operationId).toBe(id)
      const params = route?.parameters as Parameter[] | undefined
      expect(
        params
          ?.filter((param) => param.in === "path")
          .map((param) => param.name)
          .sort(),
      ).toEqual(["providerID", "workspaceID"])
      expect(params?.filter((param) => param.in === "query").map((param) => param.name)).toEqual(["organizationID"])
      expect(params?.find((param) => param.name === "organizationID")?.required).not.toBe(true)
      expect(route?.requestBody).toBeUndefined()
      const response = route?.responses?.["200"] as Body | undefined
      expect(response?.content?.["application/json"]?.schema).toEqual({
        $ref: "#/components/schemas/SessionHostWorkspacePullRequestResult",
      })
    }
  })

  test("preserves PR projection enums, required evidence, integer minimums, references, and genuine nullability", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const schemas = (spec.components?.schemas ?? {}) as Record<string, Schema>
    const summary = schemas.SessionHostWorkspacePullRequestSummary
    const refresh = schemas.SessionHostWorkspacePullRequestRefresh
    const result = schemas.SessionHostWorkspacePullRequestResult
    expect(summary?.required?.toSorted()).toEqual([
      "checks",
      "conversations",
      "headSha",
      "lastSyncedAt",
      "mergeability",
      "number",
      "partial",
      "review",
      "state",
      "title",
      "unavailable",
      "url",
    ])
    expect(Object.keys(summary?.properties ?? {}).toSorted()).toEqual(summary?.required?.toSorted() ?? [])
    expect(summary?.properties?.state?.enum).toEqual(["open", "draft", "merged", "closed", "unknown"])
    expect(summary?.properties?.number).toMatchObject({ type: "integer", exclusiveMinimum: 0 })
    expect(summary?.properties?.url).toMatchObject({ type: "string", minLength: 1, maxLength: 2048 })
    expect(summary?.properties?.lastSyncedAt).toMatchObject({ type: "string", minLength: 1 })
    expect(summary?.properties?.title).toEqual({
      anyOf: [expect.objectContaining({ type: "string" }), { type: "null" }],
    })
    expect(summary?.properties?.headSha).toEqual({
      anyOf: [expect.objectContaining({ type: "string", pattern: "^[0-9a-fA-F]{40}$" }), { type: "null" }],
    })

    const review = summary?.properties?.review
    expect(review?.required?.toSorted()).toEqual(["available", "decision", "pending"])
    expect(review?.properties?.decision).toEqual({
      anyOf: [{ type: "string", enum: ["none", "review_required", "approved", "changes_requested"] }, { type: "null" }],
    })
    const checks = summary?.properties?.checks
    expect(checks?.required?.toSorted()).toEqual([
      "available",
      "complete",
      "failed",
      "passed",
      "pending",
      "skipped",
      "total",
      "unknown",
    ])
    for (const field of ["total", "passed", "failed", "pending", "skipped", "unknown"]) {
      expect(checks?.properties?.[field], field).toMatchObject({ type: "integer", minimum: 0 })
    }
    expect(checks?.properties?.complete).toEqual({ type: "boolean" })
    expect(checks?.properties?.available).toEqual({ type: "boolean" })
    const conversations = summary?.properties?.conversations
    expect(conversations?.required?.toSorted()).toEqual(["complete", "unresolved"])
    expect(conversations?.properties?.unresolved).toEqual({
      anyOf: [
        { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        { type: "null" },
      ],
    })
    const mergeability = summary?.properties?.mergeability
    expect(mergeability?.required?.toSorted()).toEqual(["complete", "mergeable", "state"])
    expect(mergeability?.properties?.mergeable).toEqual({ anyOf: [{ type: "boolean" }, { type: "null" }] })
    expect(mergeability?.properties?.state).toEqual({
      anyOf: [expect.objectContaining({ type: "string", maxLength: 100 }), { type: "null" }],
    })
    expect(summary?.properties?.unavailable?.items?.enum).toEqual(["checks", "statuses", "reviews"])

    expect(schemas.SessionHostWorkspacePullRequestState?.enum).toEqual([
      "available",
      "no_pr",
      "signed_out",
      "rejected",
      "unreachable",
      "rate_limited",
      "unavailable",
      "unsupported",
    ])
    expect(refresh?.required?.toSorted()).toEqual(["retryAt", "status"])
    expect(refresh?.properties?.status?.enum).toEqual([
      "refreshed",
      "no_pr",
      "no_integration",
      "rate_limited",
      "throttled",
      "unavailable",
      "failed",
    ])
    expect(refresh?.properties?.retryAt).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
    expect(result?.required?.toSorted()).toEqual(["id", "pullRequest", "state"])
    expect(Object.keys(result?.properties ?? {}).toSorted()).toEqual(["id", "pullRequest", "refresh", "state"])
    expect(result?.properties?.pullRequest).toEqual({
      anyOf: [{ $ref: "#/components/schemas/SessionHostWorkspacePullRequestSummary" }, { type: "null" }],
    })
    expect(result?.properties?.refresh).toEqual({ $ref: "#/components/schemas/SessionHostWorkspacePullRequestRefresh" })
    expect(schemas.SessionHostWorkspace?.properties).not.toHaveProperty("pullRequest")
  })

  test("keeps hosted workspace diff fields nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    type Node = { properties?: Record<string, Node>; anyOf?: unknown[] }
    const nullable = { anyOf: [expect.objectContaining({}), { type: "null" }] }

    const changes = (spec.components?.schemas?.SessionHostWorkspaceChanges as Node | undefined)?.properties
    expect(changes?.revision).toEqual(nullable)
    expect(changes?.capturedAt).toEqual(nullable)
    expect(changes?.comparisons).toEqual(nullable)

    const changeResult = (spec.components?.schemas?.SessionHostWorkspaceChangeFileResult as Node | undefined)
      ?.properties
    expect(changeResult?.file).toEqual(nullable)
    expect(changeResult?.capturedAt).toEqual(nullable)
    expect(changeResult?.comparison).toEqual(nullable)
    expect(changeResult?.currentRevision).toEqual(nullable)

    const changeFile = (spec.components?.schemas?.SessionHostWorkspaceChangeFile as Node | undefined)?.properties
    expect(changeFile?.repository).toEqual(nullable)

    const comparison = (spec.components?.schemas?.SessionHostWorkspaceChangeComparison as Node | undefined)?.properties
    expect(comparison?.repository).toEqual(nullable)

    const pull = (spec.components?.schemas?.SessionHostWorkspacePullRequestDiff as Node | undefined)?.properties
    expect(pull?.reason).toEqual(nullable)
    expect(pull?.pullRequest).toEqual(nullable)

    const pullFile = (spec.components?.schemas?.SessionHostWorkspacePullRequestDiffFile as Node | undefined)?.properties
    expect(pullFile?.previousPath).toEqual(nullable)

    const pullResult = (spec.components?.schemas?.SessionHostWorkspacePullRequestDiffFileResult as Node | undefined)
      ?.properties
    for (const field of ["reason", "omissionReason", "headSha", "patch"]) {
      expect(pullResult?.[field]).toEqual(nullable)
    }
  })

  test("publishes hosted availability and keeps native turn events off the global stream", () => {
    const spec = JSON.stringify(OpenApi.fromApi(PublicApi))

    expect(spec).toContain("session.host.availability")
    expect(spec).toContain("sessionHost.attach")
  })

  test("uses Kilo branding", () => {
    const spec = OpenApi.fromApi(PublicApi)
    expect(spec.info.title).toBe("kilo")
    expect(spec.info.description).toBe("kilo api")
  })

  test("includes legacy Kilo events in the generated SDK contract", () => {
    const spec = JSON.stringify(OpenApi.fromApi(PublicApi))
    for (const type of ["suggestion.shown", "session.network.asked", "background_process.updated", "indexing.status"]) {
      expect(spec).toContain(type)
    }
  })

  test("omits interactive terminal routes and events while preserving PTY routes", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const serialized = JSON.stringify(spec)
    expect(serialized).not.toContain("interactive-terminal")
    expect(serialized).not.toContain("interactive_terminal")
    expect(serialized).not.toContain("InteractiveTerminal")
    expect(spec.paths["/pty"]?.post).toBeDefined()
    expect(spec.paths["/pty/{ptyID}/connect"]?.get).toBeDefined()
  })

  test("constrains embedding model metadata", () => {
    const accepts = (dimension: number, scoreThreshold: number) =>
      Result.isSuccess(
        EffectSchema.decodeUnknownResult(KiloEmbeddingModel)({
          id: "provider/model",
          name: "Model",
          dimension,
          scoreThreshold,
        }),
      )

    expect(accepts(1, 0)).toBe(true)
    expect(accepts(1024, 1)).toBe(true)
    expect(accepts(0, 0.5)).toBe(false)
    expect(accepts(1.5, 0.5)).toBe(false)
    expect(accepts(1024, -0.1)).toBe(false)
    expect(accepts(1024, 1.1)).toBe(false)
  })

  test("constrains agent builder route ids", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const save = AgentBuilderPaths.save.replace(":id", "{id}")
    const params = spec.paths[save]?.put?.parameters as Parameter[] | undefined
    const schema = params?.find((param) => param.name === "id")?.schema

    expect(schema).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
    })
  })

  test("keeps workspace routing queries on background process routes", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const routes = [
      { method: "get", path: BackgroundProcessPaths.list },
      { method: "get", path: BackgroundProcessPaths.get },
      { method: "get", path: BackgroundProcessPaths.logs },
      { method: "post", path: BackgroundProcessPaths.stop },
      { method: "post", path: BackgroundProcessPaths.restart },
      { method: "post", path: BackgroundProcessPaths.stopSession },
    ] satisfies Array<{ method: Method; path: string }>

    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
      const params = spec.paths[path]?.[route.method]?.parameters as Parameter[] | undefined
      const query = params?.filter((param) => param.in === "query").map((param) => param.name)
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toEqual(["directory", "workspace"])
    }
  })

  test("keeps directory routing queries on Kilo Console routes", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const routes = [
      { method: "get", path: ExperimentalPaths.worktreeDiff },
      { method: "get", path: ExperimentalPaths.worktreeDiffSummary },
      { method: "get", path: ExperimentalPaths.worktreeDiffFile },
      { method: "post", path: SessionPaths.viewed },
      { method: "get", path: ConfigConsolePaths.overlay },
      { method: "patch", path: ConfigConsolePaths.overlay },
      { method: "get", path: IndexingPaths.status },
      { method: "get", path: IndexingPaths.models },
    ] satisfies Array<{ method: Method; path: string }>

    for (const route of routes) {
      const params = spec.paths[route.path]?.[route.method]?.parameters as Parameter[] | undefined
      const query = params?.filter((param) => param.in === "query").map((param) => param.name)
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toContain("directory")
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toContain("workspace")
    }
  })

  test("keeps workspace routing queries on all Kilo-owned routed endpoints", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const routes = [
      { method: "post", path: AgentBuilderPaths.preview },
      { method: "put", path: AgentBuilderPaths.save },
      { method: "post", path: "/commit-message" },
      { method: "post", path: "/enhance-prompt" },
      { method: "get", path: NetworkPaths.list },
      { method: "post", path: NetworkPaths.reply },
      { method: "post", path: NetworkPaths.reject },
      { method: "post", path: TelemetryPaths.capture },
      { method: "post", path: TelemetryPaths.setEnabled },
      { method: "get", path: ConfigConsolePaths.sources },
      { method: "get", path: ConfigConsolePaths.effective },
      { method: "get", path: ConfigConsolePaths.rules },
      { method: "put", path: ConfigConsolePaths.rules },
      { method: "get", path: ConfigConsolePaths.modelState },
      { method: "patch", path: ConfigConsolePaths.modelState },
      { method: "get", path: ConfigConsolePaths.tuiConfig },
      { method: "get", path: ConfigConsolePaths.tuiKeybinds },
      { method: "patch", path: ConfigConsolePaths.tuiConfig },
      { method: "get", path: KilocodePaths.providerUsage },
      { method: "post", path: KilocodePaths.providerUsageRefresh },
      { method: "get", path: KilocodePaths.sessionModelUsage },
      { method: "post", path: BranchNamePaths.generate },
      { method: "get", path: MemoryPaths.status },
      { method: "get", path: MemoryPaths.show },
      { method: "post", path: MemoryPaths.enable },
      { method: "post", path: MemoryPaths.disable },
      { method: "post", path: MemoryPaths.configure },
      { method: "post", path: MemoryPaths.rebuild },
      { method: "post", path: MemoryPaths.remember },
      { method: "post", path: MemoryPaths.correct },
      { method: "post", path: MemoryPaths.forget },
      { method: "post", path: MemoryPaths.purge },
    ] satisfies Array<{ method: Method; path: string }>

    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
      const params = spec.paths[path]?.[route.method]?.parameters as Parameter[] | undefined
      const query = params?.filter((param) => param.in === "query").map((param) => param.name)
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toContain("directory")
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toContain("workspace")
    }
  })

  test("keeps personal organization resets nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const body = spec.paths[KiloGatewayPaths.organization]?.post?.requestBody as Body | undefined
    const schema = body?.content?.["application/json"]?.schema
    const props = schema?.properties
    expect(props?.organizationId).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
  })

  test("keeps branch-name responses nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const path = BranchNamePaths.generate.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    const body = spec.paths[path]?.post?.responses?.["200"] as Body | undefined
    const branch = body?.content?.["application/json"]?.schema?.properties?.branch

    expect(branch).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
  })

  test("keeps Kilo gateway responses nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const response = (path: string) => {
      const body = spec.paths[path]?.get?.responses?.["200"] as Body | undefined
      return body?.content?.["application/json"]?.schema
    }

    const profile = response(KiloGatewayPaths.profile)?.properties
    expect(profile?.balance).toEqual({ anyOf: [expect.objectContaining({ type: "object" }), { type: "null" }] })
    expect(profile?.kiloPass).toEqual({ anyOf: [expect.objectContaining({ type: "object" }), { type: "null" }] })
    expect(profile?.profile?.properties?.selectedOrganizationId).toEqual({ type: "string" })
    expect(profile?.profile?.properties?.hasPersonalAccount).toEqual({ type: "boolean" })
    const pass = profile?.kiloPass?.anyOf?.find((item) => item.type === "object")?.properties
    expect(pass?.nextBillingAt).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
    expect(profile?.currentOrgId).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })

    const auth = response(KiloGatewayPaths.authStatus)?.properties
    expect(auth).toEqual({
      authenticated: { type: "boolean" },
      type: { type: "string", enum: ["api", "oauth"] },
      organizationId: { type: "string" },
    })

    const sessions = response(KiloGatewayPaths.cloudSessions)?.properties
    expect(sessions?.cliSessions?.items?.properties?.title).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    })
    expect(sessions?.nextCursor).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
  })

  test("keeps transcription prompts in the public contract", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const body = spec.paths[KiloGatewayPaths.audioTranscriptions]?.post?.requestBody as Body | undefined
    const schema = body?.content?.["application/json"]?.schema
    expect(schema?.properties?.prompt).toEqual({ type: "string" })
  })

  test("keeps provider usage flat and credential-free", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const schemas = (spec.components?.schemas ?? {}) as Record<string, Schema>
    const usage = Object.fromEntries(Object.entries(schemas).filter(([name]) => name.startsWith("ProviderUsage")))
    const keys = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.flatMap(keys)
      if (!value || typeof value !== "object") return []
      return Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)])
    }
    const fields = keys(usage).map((key) => key.toLowerCase())

    expect(spec.paths[KilocodePaths.providerUsage]?.get?.responses?.["200"]).toBeDefined()
    expect(spec.paths[KilocodePaths.providerUsageRefresh]?.post?.responses?.["200"]).toBeDefined()
    expect(schemas.ProviderUsageSnapshot?.properties?.windows).toBeDefined()
    for (const forbidden of [
      "key",
      "token",
      "authorization",
      "raw",
      "endpoint",
      "stripepaymentmethodid",
      "inventoryid",
      "upstreamplanid",
      "fingerprint",
      "ciphertext",
    ]) {
      expect(
        fields.filter((field) => field.includes(forbidden)),
        forbidden,
      ).toEqual([])
    }
  })

  test("documents the transcription model catalog route", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const route = spec.paths[KiloGatewayPaths.transcriptionModels]?.get
    const query = (route?.parameters as Parameter[] | undefined)?.map((item) => item.name)

    expect(query).toEqual(["directory", "workspace"])
    expect(route?.responses?.["200"]?.content?.["application/json"]?.schema).toMatchObject({ type: "array" })
  })
})

test("types the continuation route with the 409 and 402 continuation errors", () => {
  const spec = OpenApi.fromApi(PublicApi)
  const entry = Object.entries(spec.paths).find(([, item]) =>
    Object.values(item as Record<string, { operationId?: string }>).some(
      (operation) => operation.operationId === "sessionHost.continueWorkspace",
    ),
  )
  expect(entry).toBeDefined()
  const operation = Object.values(
    entry![1] as Record<string, { operationId?: string; responses?: Record<string, unknown> }>,
  ).find((item) => item.operationId === "sessionHost.continueWorkspace")
  const responses = operation?.responses ?? {}
  expect(Object.keys(responses)).toContain("409")
  expect(Object.keys(responses)).toContain("402")

  const schemas = (spec.components?.schemas ?? {}) as Record<string, { properties?: Record<string, unknown> }>
  expect(Object.keys(schemas["SessionHostContinuationError"]?.properties ?? {}).sort()).toEqual([
    "code",
    "message",
    "retryable",
  ])
  expect(Object.keys(schemas["SessionHostInsufficientBalanceError"]?.properties ?? {}).sort()).toEqual([
    "code",
    "message",
    "retryable",
  ])
})
