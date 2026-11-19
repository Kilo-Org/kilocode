import { Auth } from "@/auth"
import { CloudAuth } from "@/kilocode/cloud/auth"
import { AgentStartRequestSchema, AgentStartResponseSchema } from "@/kilocode/cloud/contracts"
import { ControlTokenError, createControlTokenClient, type ControlTokenClient } from "@/kilocode/cloud/control-token"
import { createBearerHttpClient, type BearerRequest } from "@/kilocode/cloud/http"
import { createMessageId } from "@/kilocode/cloud/message-id"
import { resolveCloudAgentOrigin, resolveWebAppOrigin } from "@/kilocode/cloud/origin"
import { readBoundedJson } from "@/kilocode/cloud/response-json"
import { buildKiloHeaders } from "@kilocode/kilo-gateway"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Redacted, Schema } from "effect"
import z from "zod"
import {
  AttachInput,
  CreateWorkspaceInput,
  GetInput,
  HostedFailure,
  HostedSessionID,
  HostedWorkspaceID,
  ListInput,
  ProviderID,
  ProviderContinueWorkspaceInput,
  StartInput,
  TranscriptInput,
  WorkspaceDeleteInput,
  WorkspaceGetInput,
  WorkspaceListInput,
  WorkspaceChangeFileInput,
  WorkspaceChanges,
  WorkspaceChangesInput,
  WorkspaceChangesRefresh,
  WorkspaceChangeComparison,
  WorkspaceChangeFileResult,
  WorkspacePullRequestDiff,
  WorkspacePullRequestDiffInput,
  WorkspacePullRequestDiffFileInput,
  WorkspacePullRequestDiffFileResult,
  WorkspaceProfileDefaultInput,
  WorkspaceProfileListInput,
  WorkspacePullRequestInput,
  WorkspacePullRequestRefresh,
  WorkspacePullRequestResult,
  WorkspacePullRequestSummary,
  WorkspaceSessionStartInput,
  WorkspaceStatusInput,
  markDeletionDispatched,
  pullRequestFailure,
  refreshState,
  type Attachment,
  type Availability,
  type ContinueWorkspaceSession,
  type CreateWorkspaceResult,
  type DeleteWorkspaceResult,
  type HostedSession,
  type HostedSessionPage,
  type HostedTranscriptPage,
  type HostedWorkspace,
  type HostedWorkspacePage,
  type HostedWorkspaceStatus,
  type NativeRequest,
  type Provider,
  type ProviderContinueWorkspaceResult,
  type Repository,
  type Agent,
  type Profile,
  type StartResult,
  type Transport,
  type WorkspaceProfileDefaultResult,
  type WorkspaceProfilePage,
  type WorkspaceSessionStartResult,
} from "./types"
import { classify } from "./native-routes"
import { errorCandidates, errorCode } from "./response"

export const PROVIDER = Schema.decodeUnknownSync(ProviderID)("kilo-cloud")
export const ATTACHMENT_TTL_MS = 60_000

const MEMBERSHIP_PAGE_SIZE = 50
const MEMBERSHIP_SESSION_LIMIT = 100
const MEMBERSHIP_PAGE_LIMIT = 20
const MEMBERSHIP_SESSION_PAGE_LIMIT = 10

const Envelope = z.object({ result: z.object({ data: z.unknown() }) })

const WorkspaceSessionSummary = z.object({
  kiloSessionId: z.string().min(1),
  cloudAgentSessionId: z.string().min(1),
  workspaceId: z.string().min(1).nullable(),
  userId: z.string().min(1),
  organizationId: z.string().nullable(),
  title: z.string().nullable(),
  gitUrl: z.string().nullable(),
  gitBranch: z.string().nullable(),
  profileId: z.string().nullable(),
  createdOnPlatform: z.string().min(1),
  created: z.number(),
  updated: z.number(),
})

const WorkspaceSummary = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  organizationId: z.string().nullable(),
  name: z.string().nullable(),
  repositoryProvider: z.enum(["github", "gitlab", "bitbucket", "git"]).nullable(),
  gitUrl: z.string().nullable(),
  gitBranch: z.string().nullable(),
  profileId: z.string().nullable(),
  deletionState: z.enum(["active", "deleting", "deleted"]),
  created: z.number(),
  updated: z.number(),
  lastActivity: z.number(),
  sessions: z.array(WorkspaceSessionSummary),
  nextSessionCursor: z.string().nullable(),
})

const WorkspacePage = z.object({
  items: z.array(WorkspaceSummary),
  nextCursor: z.string().nullable(),
})

const PullRequestProjection = z.object({
  workspaceId: z.string(),
  pullRequest: z.unknown().optional(),
  refresh: z.unknown().optional(),
})

const CloudWorkspaceStatus = z.object({
  workspaceId: z.string().min(1),
  deletionState: z.enum(["active", "deleting", "deleted"]),
  observedAt: z.number(),
  compute: z.object({
    status: z.enum(["active", "sleeping", "starting", "stopping", "error", "unreachable", "unknown"]),
    detailCode: z.enum([
      "sandbox_ready",
      "sandbox_stopped",
      "sandbox_starting",
      "sandbox_stopping",
      "sandbox_failed",
      "connection_unavailable",
      "status_unavailable",
      "insufficient_evidence",
      "check_needed",
    ]),
    observedAt: z.number(),
    estimatedSleepAt: z.number().nullable(),
  }),
  activity: z.object({
    activeSessionCount: z.number(),
    hasActiveTurn: z.boolean(),
  }),
  wakeOnInput: z.object({
    available: z.boolean(),
    blockedReason: z.enum(["deleting", "deleted", "billing_blocked", "billing_status_unavailable"]).nullable(),
  }),
  billing: z.object({
    payer: z.object({ type: z.enum(["user", "org"]), id: z.string() }).nullable(),
    sku: z.string().nullable(),
    blocked: z.boolean().nullable(),
    enforcementRequested: z.boolean(),
    intervalStartedAt: z.number().nullable(),
    rate: z
      .object({
        rateCentsPerSecond: z.string(),
        estimatedHourlyMicrodollars: z.number(),
      })
      .nullable(),
  }),
  deletion: z.object({
    started: z.boolean(),
    completed: z.boolean(),
    startedAt: z.number().nullable(),
    phase: z.enum(["not_started", "runtime_cleanup", "finalizing", "completed"]),
    sessionCount: z.number(),
    runtimeLocationCount: z.number(),
    completedRuntimeLocationCount: z.number(),
    remainingRuntimeLocationCount: z.number(),
    deletedSessionIds: z.array(z.string()),
  }),
})

const CloudRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const CloudCommit = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
const CloudBaseRef = z
  .string()
  .min(1)
  .max(1024)
  .refine((ref) => !ref.startsWith("-") && !ref.includes("\0"), "Invalid comparison ref")
const CloudCapturedAt = z.iso.datetime({ offset: true })
const CloudOmissionReason = z.enum([
  "binary",
  "unsupported",
  "invalid_utf8",
  "too_large",
  "line_limit",
  "budget_exhausted",
  "inconsistent",
  "capture_failed",
])
const CloudChangeScope = z.enum(["uncommitted", "against-base-branch"])

const CloudDiffAvailability = z.union([
  z.object({ status: z.literal("available") }),
  z.object({ status: z.literal("omitted"), reason: CloudOmissionReason }),
])

const CloudContentAvailability = z.union([
  z.object({ status: z.literal("available"), source: z.enum(["current", "deleted-original"]) }),
  z.object({ status: z.literal("unavailable"), reason: CloudOmissionReason }),
])

const CloudChangeRepository = z.object({
  path: z.string().max(4096),
  repoFullName: z.string().min(1).max(500),
})

const CloudComparison = z.object({
  baseRef: CloudBaseRef,
  mergeBase: CloudCommit,
  head: CloudCommit,
  baseRefFallback: z
    .object({
      requested: CloudBaseRef,
      used: CloudBaseRef,
    })
    .optional(),
})

const CloudChangeFile = z.object({
  path: z.string().min(1).max(4096),
  status: z.enum(["added", "modified", "deleted"]),
  scope: CloudChangeScope.optional(),
  additions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  deletions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  tracked: z.boolean(),
  binary: z.boolean(),
  countsComplete: z.boolean(),
  revision: CloudRevision,
  repository: CloudChangeRepository.nullable(),
  diff: CloudDiffAvailability,
  content: CloudContentAvailability,
})

const CloudChangeComparison = z.object({
  repository: CloudChangeRepository.nullable(),
  comparison: CloudComparison,
  truncated: z.boolean(),
  files: z.array(CloudChangeFile),
})

const CloudWorkspaceChanges = z.object({
  status: z.enum(["captured", "not_captured", "inconsistent"]),
  workspaceId: z.string().min(1),
  revision: CloudRevision.nullable(),
  capturedAt: CloudCapturedAt.nullable(),
  truncated: z.boolean(),
  comparisons: z.array(CloudChangeComparison).nullable(),
})

const CloudWorkspaceChangesRefresh = z.object({
  status: z.enum(["refreshed", "offline", "failed"]),
  changes: CloudWorkspaceChanges,
})

const CloudFileRecord = z.object({
  schemaVersion: z.literal(1),
  revision: CloudRevision,
  path: z.string().min(1).max(4096),
  scope: CloudChangeScope.optional(),
  diff: z.union([
    z.object({ status: z.literal("available"), patch: z.string().min(1) }),
    z.object({ status: z.literal("omitted"), reason: CloudOmissionReason }),
  ]),
  content: z.union([
    z.object({
      status: z.literal("available"),
      source: z.enum(["current", "deleted-original"]),
      text: z.string(),
    }),
    z.object({ status: z.literal("unavailable"), reason: CloudOmissionReason }),
  ]),
})

const CloudWorkspaceChangeFileResult = z.object({
  status: z.enum(["available", "omitted", "not_captured", "no_longer_listed", "stale"]),
  file: CloudFileRecord.nullable(),
  capturedAt: CloudCapturedAt.nullable(),
  comparison: CloudComparison.nullable(),
  currentRevision: CloudRevision.nullable(),
})

const CloudPullRequestReason = z.enum([
  "no_pull_request",
  "pull_request_not_found",
  "head_ref_mismatch",
  "repository_mismatch",
  "installation_unavailable",
  "connected_user_required",
  "github_access_denied",
  "github_rate_limited",
  "github_unavailable",
  "pull_request_changed",
  "unsupported_repository",
])

const CloudPullRequestFile = z.object({
  path: z.string().min(1).max(4096),
  previousPath: z.string().min(1).max(4096).nullable(),
  status: z.enum(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
  additions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  deletions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  patchAvailable: z.boolean(),
})

const CloudPullRequestIdentity = z.object({
  number: z.number().int().positive(),
  url: z.string().min(1).max(2048),
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  headSha: CloudCommit,
  baseRef: CloudBaseRef,
  repository: CloudChangeRepository,
  cacheStale: z.boolean(),
})

const CloudWorkspacePullRequestDiff = z.object({
  status: z.enum(["linked", "stale", "not_linked", "unverified", "credential_required", "unavailable", "not_github"]),
  workspaceId: z.string().min(1),
  reason: CloudPullRequestReason.nullable(),
  pullRequest: CloudPullRequestIdentity.nullable(),
  truncated: z.boolean(),
  files: z.array(CloudPullRequestFile),
})

const CloudWorkspacePullRequestDiffFile = z.object({
  status: z.enum([
    "available",
    "omitted",
    "not_listed",
    "stale",
    "not_linked",
    "unverified",
    "credential_required",
    "unavailable",
    "not_github",
  ]),
  path: z.string().min(1).max(4096),
  reason: CloudPullRequestReason.nullable(),
  omissionReason: z.literal("provider_omitted").nullable(),
  headSha: CloudCommit.nullable(),
  patch: z.string().min(1).nullable(),
})

const WorkspaceCreate = z.object({
  workspaceId: z.string().min(1),
  cloudAgentSessionId: z.string().min(1),
  kiloSessionId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  replayed: z.boolean().optional(),
})

const WorkspaceDelete = z.object({
  success: z.literal(true),
  deletedSessionIds: z.array(z.string()),
})

const ContinuationOutput = z.object({
  workspaceId: z.string().min(1),
  sessions: z.array(
    z.object({
      sourceKiloSessionId: z.string().min(1),
      kiloSessionId: z.string().min(1),
      cloudAgentSessionId: z.string().min(1),
      agent: z.object({
        mode: z.string().min(1),
        model: z.string().min(1),
        variant: z.string().max(50).optional(),
      }),
      modeFallback: z.boolean(),
    }),
  ),
  activeKiloSessionId: z.string().min(1),
  replayed: z.literal(true).optional(),
})

const CONTINUATION_CODES = [
  "organization_mismatch",
  "operation_key_reuse_mismatch",
  "creation_in_progress",
  "continuation_incomplete",
  "insufficient_balance",
] as const

function continuationCode(body: unknown) {
  // A real tRPC failure carries a generic transport code beside the actionable
  // Kilo code, so match any nested code or message, not just `errorCode`'s pick.
  const candidates = errorCandidates(body)
  return CONTINUATION_CODES.find((code) => candidates.some((raw) => raw === code || raw.includes(code)))
}

const CloudProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  ownerType: z.enum(["user", "organization"]),
  isPersonalDefault: z.boolean(),
  isOrganizationDefault: z.boolean(),
})

const CloudProfilePage = z.object({
  personalProfiles: z.array(CloudProfile),
  organizationProfiles: z.array(CloudProfile),
  personalDefaultProfileId: z.string().nullable(),
  organizationDefaultProfileId: z.string().nullable(),
  effectiveDefaultProfileId: z.string().nullable(),
})

export interface Options {
  readonly auth: Auth.Interface
  readonly env?: CloudAuth.Environment
  readonly fetch?: typeof globalThis.fetch
  readonly clock?: () => number
}

/**
 * Built-in adapter for Kilo Cloud. Every provider-private detail the future
 * IDE-facing boundary must not see (Cloud control IDs, target origin, bearer,
 * directory selector, SSE fence) stays inside this module.
 */
export function provider(options: Options): Provider {
  const env = options.env ?? process.env
  const clock = options.clock ?? Date.now
  const transport: { current: Transport } = { current: { state: "unknown" } }

  const provided = <A, E>(effect: Effect.Effect<A, E, Auth.Service>) =>
    Effect.provideService(effect, Auth.Service, options.auth)

  const resolveRaw = (orgID?: string) => provided(CloudAuth.resolve({ orgID, env }))

  const authFailure = (error: CloudAuth.ResolutionError) => {
    if (error.kind === "missing") {
      return new HostedFailure({ code: "signed_out", message: error.message, retryable: false })
    }
    if (error.kind === "unavailable") {
      return new HostedFailure({ code: "auth_unavailable", message: error.message, retryable: true })
    }
    return new HostedFailure({ code: "rejected", message: error.message, retryable: false })
  }

  const resolve = (orgID?: string) => resolveRaw(orgID).pipe(Effect.mapError(authFailure))

  // Continuation resolves the bearer only: Cloud takes the organization from the
  // source sessions' ingest rows, so no organization is attached here.
  const resolveToken: Effect.Effect<CloudAuth.Resolved, HostedFailure> = provided(CloudAuth.token(env)).pipe(
    Effect.map((token) => ({ token }) satisfies CloudAuth.Resolved),
    Effect.mapError(authFailure),
  )

  const availability: Effect.Effect<Availability> = Effect.suspend(() => resolveRaw()).pipe(
    Effect.as({ state: "available" } as Availability),
    Effect.catchTag("CloudAuthResolutionError", (error) =>
      Effect.succeed({
        state: "unavailable",
        reason: error.kind === "missing" ? "signed_out" : error.kind === "unavailable" ? "unreachable" : "rejected",
        message: error.message,
      } as Availability),
    ),
  )

  const reachable = () => {
    transport.current = { state: "reachable", checkedAt: clock() }
  }

  const unreachable = () => {
    transport.current = { state: "unreachable", checkedAt: clock(), message: "Kilo Cloud is unreachable" }
  }

  const origin = Effect.try({
    try: () => resolveCloudAgentOrigin(env),
    catch: () => new HostedFailure({ code: "rejected", message: "Kilo Cloud base URL is invalid", retryable: false }),
  })

  const webOrigin = Effect.try({
    try: () => resolveWebAppOrigin(env),
    catch: () => new HostedFailure({ code: "rejected", message: "Kilo web app URL is invalid", retryable: false }),
  })

  const controlTokens: ControlTokenClient = createControlTokenClient({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    clock,
  })

  const controlError = (error: unknown): HostedFailure => {
    const status = error instanceof ControlTokenError && error.status != null ? { status: error.status } : {}
    if (error instanceof ControlTokenError) {
      if (error.reason === "unauthorized") {
        return new HostedFailure({ code: "unauthorized", message: error.message, retryable: false, ...status })
      }
      if (error.reason === "invalid_response") {
        return new HostedFailure({ code: "invalid_response", message: error.message, retryable: false, ...status })
      }
    }
    unreachable()
    return new HostedFailure({
      code: "unavailable",
      message: error instanceof ControlTokenError ? error.message : "Kilo control token could not be issued",
      retryable: true,
      ...status,
    })
  }

  /**
   * Every Worker call exchanges the original user source credential for a
   * short-lived control token first. The source credential is presented only to
   * the issuer; the Worker sees only the control token.
   */
  const request = (auth: CloudAuth.Resolved, req: BearerRequest, retryable = true) =>
    Effect.gen(function* () {
      const base = yield* origin
      const issuer = yield* webOrigin
      const control = yield* Effect.tryPromise({
        try: () =>
          controlTokens.exchange({
            source: auth.token,
            ...(auth.organizationID ? { organizationID: auth.organizationID } : {}),
            issuer,
            worker: base,
          }),
        catch: controlError,
      })
      const response = yield* Effect.tryPromise({
        try: () =>
          createBearerHttpClient({
            origin: base,
            apiKey: Redacted.value(control.token),
            ...(options.fetch ? { fetch: options.fetch } : {}),
          }).request(req),
        catch: () => {
          unreachable()
          return new HostedFailure({
            code: "unavailable",
            message: retryable
              ? "Kilo Cloud is unreachable"
              : "Kilo Cloud start outcome is unknown; retry with the same operation key and message ID",
            retryable,
          })
        },
      })
      reachable()
      return response
    })

  const headers = (auth: CloudAuth.Resolved) =>
    buildKiloHeaders(undefined, auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : undefined)

  const decodeBody = (response: Response) =>
    Effect.tryPromise({
      try: () => readBoundedJson(response),
      catch: () =>
        new HostedFailure({
          code: "invalid_response",
          message: "Kilo Cloud returned an invalid response",
          retryable: false,
        }),
    })

  const failure = (response: Response, body: unknown) => {
    const code = errorCode(body)
    if (response.status === 401 || response.status === 403) {
      return new HostedFailure({
        code: "unauthorized",
        message: "Kilo Cloud rejected these credentials",
        retryable: false,
      })
    }
    if (response.status === 402) {
      return new HostedFailure({
        code: "payment_required",
        message: "Kilo Cloud requires additional balance",
        retryable: false,
      })
    }
    if (response.status === 404) {
      return new HostedFailure({ code: "not_found", message: "Kilo Cloud session was not found", retryable: false })
    }
    if (response.status === 409) {
      return new HostedFailure({
        code: "rejected",
        message: "Kilo Cloud rejected this operation",
        retryable: code === "KILO_INTERACTION_UNAVAILABLE",
      })
    }
    if (response.status === 503 || response.status >= 500) {
      return new HostedFailure({
        code: "unavailable",
        message: "Kilo Cloud is temporarily unavailable",
        retryable: true,
      })
    }
    return new HostedFailure({ code: "rejected", message: "Kilo Cloud rejected the request", retryable: false })
  }

  const consume = (response: Response) =>
    Effect.gen(function* () {
      if (response.ok) return yield* decodeBody(response)
      const body = yield* decodeBody(response).pipe(Effect.catch(() => Effect.succeed(undefined)))
      return yield* Effect.fail(failure(response, body))
    })

  /**
   * Continuation failures are typed: the endpoint surfaces `code`, `message`,
   * and `retryable` so the client can decide whether to keep the operation key.
   */
  const continuationFailure = (response: Response, body: unknown) => {
    const code = continuationCode(body)
    if (response.status === 402) {
      return new HostedFailure({
        code: "insufficient_balance",
        message: "Kilo Cloud requires additional balance to continue this worktree",
        retryable: false,
      })
    }
    if (code === "organization_mismatch") {
      return new HostedFailure({ code, message: "Selected sessions belong to different accounts", retryable: false })
    }
    if (response.status === 401 || response.status === 403) {
      return new HostedFailure({
        code: "unauthorized",
        message: "Kilo Cloud rejected these credentials",
        retryable: false,
      })
    }
    if (code === "operation_key_reuse_mismatch") {
      return new HostedFailure({
        code,
        message: "This operation key was used for a different request",
        retryable: false,
      })
    }
    if (code === "creation_in_progress") {
      return new HostedFailure({ code, message: "Kilo Cloud is still completing this workspace", retryable: true })
    }
    if (code === "continuation_incomplete") {
      return new HostedFailure({ code, message: "Kilo Cloud created part of this workspace", retryable: true })
    }
    if (response.status === 409) {
      return new HostedFailure({
        code: "continuation_incomplete",
        message: "Kilo Cloud created part of this workspace",
        retryable: true,
      })
    }
    if (response.status === 503 || response.status >= 500) {
      return new HostedFailure({
        code: "unavailable",
        message: "Kilo Cloud is temporarily unavailable",
        retryable: true,
      })
    }
    return new HostedFailure({ code: "rejected", message: "Kilo Cloud rejected the request", retryable: false })
  }

  const consumeContinuation = (response: Response) =>
    Effect.gen(function* () {
      if (response.ok) return yield* decodeBody(response)
      const body = yield* decodeBody(response).pipe(Effect.catch(() => Effect.succeed(undefined)))
      return yield* Effect.fail(continuationFailure(response, body))
    })

  const codec = (schema: Schema.Top) => schema as Schema.Codec<unknown, unknown>

  const decode = <S extends Schema.Top>(schema: S, value: unknown, message: string) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(codec(schema))(value) as S["Type"],
      catch: () => new HostedFailure({ code: "invalid_response", message, retryable: false }),
    })

  const check = <S extends Schema.Top>(schema: S, value: unknown) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(codec(schema))(value) as S["Type"],
      catch: () =>
        new HostedFailure({ code: "invalid_request", message: "Session host request is invalid", retryable: false }),
    })

  const invalid = (message: string) => new HostedFailure({ code: "invalid_response", message, retryable: false })

  const identity = (sessionID: unknown) =>
    decode(HostedSessionID, { providerID: PROVIDER, sessionID }, "Kilo Cloud returned an unsupported session identity")

  const hosted = (session: SessionV1.SessionInfo) =>
    identity(session.id).pipe(Effect.map((id): HostedSession => ({ id, session })))

  const list = (raw: ListInput = {}): Effect.Effect<HostedSessionPage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(ListInput, raw)
      const auth = yield* resolve(input.organizationID)
      const query = new URLSearchParams()
      if (input.limit !== undefined) query.set("limit", String(input.limit))
      const response = yield* request(auth, {
        method: "GET",
        path: route("/kilo/session", query),
        headers: headers(auth),
      })
      const body = yield* consume(response)
      const sessions = yield* decode(
        Schema.Array(SessionV1.SessionInfo),
        body,
        "Kilo Cloud returned unsupported sessions",
      )
      return { items: yield* Effect.forEach(sessions, hosted) }
    })

  const get = (raw: GetInput): Effect.Effect<HostedSession, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(GetInput, raw)
      const auth = yield* resolve(input.organizationID)
      const response = yield* request(auth, {
        method: "GET",
        path: `/kilo/session/${input.id.sessionID}`,
        headers: headers(auth),
      })
      const body = yield* consume(response)
      const session = yield* decode(SessionV1.SessionInfo, body, "Kilo Cloud returned an unsupported session")
      if (session.id !== input.id.sessionID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different session identity"))
      }
      return yield* hosted(session)
    })

  const transcript = (raw: TranscriptInput): Effect.Effect<HostedTranscriptPage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(TranscriptInput, raw)
      const auth = yield* resolve(input.organizationID)
      const query = new URLSearchParams()
      if (input.limit !== undefined) query.set("limit", String(input.limit))
      if (input.before !== undefined) query.set("before", input.before)
      const response = yield* request(auth, {
        method: "GET",
        path: route(`/kilo/session/${input.id.sessionID}/message`, query),
        headers: headers(auth),
      })
      const body = yield* consume(response)
      const entries = yield* decode(
        Schema.Array(SessionV1.WithParts),
        body,
        "Kilo Cloud returned an unsupported transcript",
      )
      for (const entry of entries) {
        if (entry.info.sessionID !== input.id.sessionID) {
          return yield* Effect.fail(invalid("Kilo Cloud returned a transcript for a different session"))
        }
      }
      const cursor = response.headers.get("X-Next-Cursor")
      const omitted = omittedCount(response.headers.get("X-Kilo-Omitted-Item-Count"))
      return {
        items: entries,
        ...(cursor ? { cursor } : {}),
        ...(omitted === undefined ? {} : { omitted }),
      }
    })

  const start = (raw: StartInput): Effect.Effect<StartResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(StartInput, raw)
      const auth = yield* resolve(input.organizationID)
      const messageID = input.messageID ?? createMessageId()
      const payload = {
        message: { prompt: input.prompt, id: messageID },
        agent: { mode: input.agent.mode, model: input.agent.model },
        repository: input.repository,
        options: {
          createdOnPlatform: input.origin === "desktop" ? "desktop" : "kilo-cli",
          ...(auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : {}),
        },
        ...(input.operationKey ? { operationKey: input.operationKey } : {}),
      }
      const parsed = AgentStartRequestSchema.safeParse(payload)
      if (!parsed.success) {
        return yield* Effect.fail(
          new HostedFailure({ code: "invalid_request", message: "Session start request is invalid", retryable: false }),
        )
      }
      const response = yield* request(
        auth,
        {
          method: "POST",
          path: "/trpc/start",
          headers: { ...headers(auth), "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
        input.operationKey !== undefined,
      )
      const body = yield* consume(response)
      const envelope = Envelope.safeParse(body)
      const parsedResult = envelope.success ? AgentStartResponseSchema.safeParse(envelope.data.result.data) : envelope
      if (!parsedResult.success) {
        return yield* Effect.fail(
          new HostedFailure({
            code: "invalid_response",
            message: "Kilo Cloud returned an unsupported start result",
            retryable: false,
          }),
        )
      }
      const result = parsedResult.data
      if (result.messageId !== messageID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different message identity"))
      }
      if (result.delivery !== "sent" && result.delivery !== "queued") {
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported delivery state"))
      }
      const session = yield* identity(result.kiloSessionId)
      return {
        session,
        messageID,
        delivery: result.delivery,
        replayed: result.replayed === true,
      }
    })

  const attach = (raw: AttachInput): Effect.Effect<Attachment, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(AttachInput, raw)
      const session = yield* get(input)
      return { session: session.id, expiresAt: clock() + ATTACHMENT_TTL_MS }
    })

  const data = (value: unknown) =>
    Effect.gen(function* () {
      const envelope = Envelope.safeParse(value)
      if (!envelope.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported response"))
      return envelope.data.result.data
    })

  const query = (auth: CloudAuth.Resolved, procedure: string, input: unknown) =>
    request(auth, {
      method: "GET",
      path: `/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
      headers: headers(auth),
    }).pipe(Effect.flatMap(consume), Effect.flatMap(data))

  const mutation = (auth: CloudAuth.Resolved, procedure: string, input: unknown) =>
    request(auth, {
      method: "POST",
      path: `/trpc/${procedure}`,
      headers: { ...headers(auth), "content-type": "application/json" },
      body: JSON.stringify(input),
    }).pipe(Effect.flatMap(consume), Effect.flatMap(data))

  const continuationMutation = (auth: CloudAuth.Resolved, input: unknown) =>
    request(auth, {
      method: "POST",
      path: "/trpc/continueHostedWorkspace",
      headers: { ...headers(auth), "content-type": "application/json" },
      body: JSON.stringify(input),
    }).pipe(Effect.flatMap(consumeContinuation), Effect.flatMap(data))

  const consistent = (raw: z.infer<typeof WorkspaceSummary>) =>
    raw.sessions.every((session) => session.workspaceId === raw.workspaceId)

  const holds = (raw: z.infer<typeof WorkspaceSummary>, kiloSessionID: string) =>
    raw.sessions.some((session) => session.kiloSessionId === kiloSessionID)

  /**
   * Resolves workspace membership from the existing workspace catalog, once
   * per new attachment. A session that no catalog page mentions is a legacy
   * flat session, so the attachment stays valid without workspace-scoped
   * invalidation. A catalog larger than the scan bound, or a workspace that
   * disappears during the scan, also yields no membership; routed
   * session-not-found responses still invalidate the attachment.
   */
  const membership = (raw: AttachInput): Effect.Effect<HostedWorkspaceID | undefined, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(AttachInput, raw)
      const auth = yield* resolve(input.organizationID)
      const kiloSessionID = input.id.sessionID
      let cursor: string | undefined
      for (let page = 0; page < MEMBERSHIP_PAGE_LIMIT; page++) {
        const payload: Record<string, unknown> = {
          limit: MEMBERSHIP_PAGE_SIZE,
          sessionLimit: MEMBERSHIP_SESSION_LIMIT,
        }
        if (cursor !== undefined) payload.cursor = cursor
        const body = yield* query(auth, "listHostedWorkspaces", payload)
        const parsed = WorkspacePage.safeParse(body)
        if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace page"))
        for (const raw of parsed.data.items) {
          const found = yield* nested(auth, raw, kiloSessionID)
          if (found !== undefined) return yield* workspaceIdentity(found)
        }
        if (parsed.data.nextCursor == null) return undefined
        cursor = parsed.data.nextCursor
      }
      return undefined
    })

  const nested = (
    auth: CloudAuth.Resolved,
    raw: z.infer<typeof WorkspaceSummary>,
    kiloSessionID: string,
  ): Effect.Effect<string | undefined, HostedFailure> =>
    Effect.gen(function* () {
      if (!consistent(raw)) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a workspace with a session from another workspace"))
      }
      if (holds(raw, kiloSessionID)) return raw.workspaceId

      let cursor: string | null = raw.nextSessionCursor
      for (let page = 0; cursor != null && page < MEMBERSHIP_SESSION_PAGE_LIMIT; page++) {
        const body = yield* query(auth, "getHostedWorkspace", {
          workspaceId: raw.workspaceId,
          sessionLimit: MEMBERSHIP_SESSION_LIMIT,
          sessionCursor: cursor,
        })
        // This workspace disappeared during the scan; it says nothing about the session.
        if (body === null) return undefined
        const parsed = WorkspaceSummary.safeParse(body)
        if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace"))
        if (parsed.data.workspaceId !== raw.workspaceId) {
          return yield* Effect.fail(invalid("Kilo Cloud returned a different workspace identity"))
        }
        if (!consistent(parsed.data)) {
          return yield* Effect.fail(invalid("Kilo Cloud returned a workspace with a session from another workspace"))
        }
        if (holds(parsed.data, kiloSessionID)) return parsed.data.workspaceId
        cursor = parsed.data.nextSessionCursor
      }
      return undefined
    })

  const workspaceIdentity = (workspaceID: unknown) =>
    decode(
      HostedWorkspaceID,
      { providerID: PROVIDER, workspaceID },
      "Kilo Cloud returned an unsupported workspace identity",
    )

  const workspace = (raw: z.infer<typeof WorkspaceSummary>): Effect.Effect<HostedWorkspace, HostedFailure> =>
    Effect.gen(function* () {
      if (!consistent(raw)) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a workspace with a session from another workspace"))
      }
      const id = yield* workspaceIdentity(raw.workspaceId)
      const sessions = yield* Effect.forEach(raw.sessions, (session) =>
        identity(session.kiloSessionId).pipe(
          Effect.map((sessionID) => ({
            id: sessionID,
            ...(session.title == null ? {} : { title: session.title }),
            createdOnPlatform: session.createdOnPlatform,
            created: session.created,
            updated: session.updated,
          })),
        ),
      )
      return {
        id,
        ...(raw.name == null ? {} : { name: raw.name }),
        repository: {
          ...(raw.repositoryProvider == null ? {} : { provider: raw.repositoryProvider }),
          ...(raw.gitUrl == null ? {} : { url: raw.gitUrl }),
          ...(raw.gitBranch == null ? {} : { branch: raw.gitBranch }),
        },
        ...(raw.profileId == null ? {} : { profileID: raw.profileId }),
        deletionState: raw.deletionState,
        created: raw.created,
        updated: raw.updated,
        lastActivity: raw.lastActivity,
        sessions,
        ...(raw.nextSessionCursor == null ? {} : { cursor: raw.nextSessionCursor }),
      }
    })

  const listWorkspaces = (raw: WorkspaceListInput = {}): Effect.Effect<HostedWorkspacePage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceListInput, raw)
      const auth = yield* resolve(input.organizationID)
      const payload: Record<string, unknown> = {}
      if (input.limit !== undefined) payload.limit = input.limit
      if (input.sessionLimit !== undefined) payload.sessionLimit = input.sessionLimit
      if (input.cursor !== undefined) payload.cursor = input.cursor
      if (input.repositoryUrl !== undefined) payload.repositoryUrl = input.repositoryUrl
      const body = yield* query(auth, "listHostedWorkspaces", payload)
      const parsed = WorkspacePage.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace page"))
      const items = yield* Effect.forEach(parsed.data.items, workspace)
      return { items, ...(parsed.data.nextCursor == null ? {} : { cursor: parsed.data.nextCursor }) }
    })

  const getWorkspace = (raw: WorkspaceGetInput): Effect.Effect<HostedWorkspace, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceGetInput, raw)
      const auth = yield* resolve(input.organizationID)
      const payload: Record<string, unknown> = { workspaceId: input.id.workspaceID }
      if (input.sessionLimit !== undefined) payload.sessionLimit = input.sessionLimit
      if (input.sessionCursor !== undefined) payload.sessionCursor = input.sessionCursor
      const body = yield* query(auth, "getHostedWorkspace", payload)
      if (body === null) {
        return yield* Effect.fail(
          new HostedFailure({ code: "not_found", message: "Kilo Cloud workspace was not found", retryable: false }),
        )
      }
      const parsed = WorkspaceSummary.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace"))
      if (parsed.data.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different workspace identity"))
      }
      return yield* workspace(parsed.data)
    })

  const getWorkspaceStatus = (raw: WorkspaceStatusInput): Effect.Effect<HostedWorkspaceStatus, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceStatusInput, raw)
      const auth = yield* resolve(input.organizationID)
      const body = yield* query(auth, "getHostedWorkspaceStatus", {
        workspaceId: input.id.workspaceID,
        ...(input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID }),
      })
      const parsed = CloudWorkspaceStatus.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace status"))
      if (parsed.data.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a status for a different workspace"))
      }
      const id = yield* workspaceIdentity(parsed.data.workspaceId)
      return {
        id,
        deletionState: parsed.data.deletionState,
        observedAt: parsed.data.observedAt,
        compute: {
          status: parsed.data.compute.status,
          detailCode: parsed.data.compute.detailCode,
          observedAt: parsed.data.compute.observedAt,
          estimatedSleepAt: parsed.data.compute.estimatedSleepAt,
        },
        activity: {
          activeSessionCount: parsed.data.activity.activeSessionCount,
          hasActiveTurn: parsed.data.activity.hasActiveTurn,
        },
        wakeOnInput: {
          available: parsed.data.wakeOnInput.available,
          blockedReason: parsed.data.wakeOnInput.blockedReason,
        },
        billing: {
          payer: parsed.data.billing.payer?.type ?? null,
          sku: parsed.data.billing.sku,
          blocked: parsed.data.billing.blocked,
          enforcementRequested: parsed.data.billing.enforcementRequested,
          intervalStartedAt: parsed.data.billing.intervalStartedAt,
          rate: parsed.data.billing.rate,
        },
        deletion: {
          started: parsed.data.deletion.started,
          completed: parsed.data.deletion.completed,
          startedAt: parsed.data.deletion.startedAt,
          phase: parsed.data.deletion.phase,
          sessionCount: parsed.data.deletion.sessionCount,
          runtimeLocationCount: parsed.data.deletion.runtimeLocationCount,
          completedRuntimeLocationCount: parsed.data.deletion.completedRuntimeLocationCount,
          remainingRuntimeLocationCount: parsed.data.deletion.remainingRuntimeLocationCount,
        },
      } satisfies HostedWorkspaceStatus
    })

  const pullRequest = (
    raw: WorkspacePullRequestInput,
    refresh: boolean,
  ): Effect.Effect<WorkspacePullRequestResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspacePullRequestInput, raw)
      if (input.id.providerID !== PROVIDER) {
        return yield* Effect.fail(
          new HostedFailure({
            code: "invalid_request",
            message: "Session host provider does not match",
            retryable: false,
          }),
        )
      }
      return yield* Effect.gen(function* () {
        const auth = yield* resolve(input.organizationID)
        const payload = { workspaceId: input.id.workspaceID }
        const response = yield* request(
          auth,
          refresh
            ? {
                method: "POST",
                path: "/trpc/refreshHostedWorkspacePullRequest",
                headers: { ...headers(auth), "content-type": "application/json" },
                body: JSON.stringify(payload),
                // The Worker allows 110 seconds for its internal refresh call.
                timeoutMs: 120_000,
              }
            : {
                method: "GET",
                path: `/trpc/getHostedWorkspace?input=${encodeURIComponent(JSON.stringify({ ...payload, sessionLimit: 1 }))}`,
                headers: headers(auth),
              },
        )
        const body = yield* consume(response).pipe(
          Effect.mapError(
            (err) =>
              new HostedFailure({
                code: err.code,
                message: err.message,
                retryable: err.retryable,
                status: response.status,
              }),
          ),
          Effect.flatMap(data),
        )
        const parsed = PullRequestProjection.safeParse(body)
        if (!parsed.success || parsed.data.workspaceId !== input.id.workspaceID) {
          return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace PR projection"))
        }
        if (!refresh && parsed.data.pullRequest === undefined) {
          return { id: input.id, state: "unsupported", pullRequest: null } as const
        }
        const summary = yield* decode(
          Schema.NullOr(WorkspacePullRequestSummary),
          parsed.data.pullRequest,
          "Kilo Cloud returned an unsupported PR summary",
        )
        if (summary !== null) {
          const url = yield* Effect.try({
            try: () => new URL(summary.url),
            catch: () => invalid("Kilo Cloud returned an unsupported PR URL"),
          })
          const match = /^\/[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+\/pull\/([1-9]\d*)$/.exec(url.pathname)
          if (
            url.origin !== "https://github.com" ||
            summary.url !== `${url.origin}${url.pathname}` ||
            match?.at(1) !== String(summary.number)
          ) {
            return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported PR URL"))
          }
        }
        if (!refresh) {
          return { id: input.id, state: summary === null ? "no_pr" : "available", pullRequest: summary } as const
        }
        const metadata = yield* decode(
          WorkspacePullRequestRefresh,
          parsed.data.refresh,
          "Kilo Cloud returned an unsupported PR refresh result",
        )
        const state = refreshState(metadata.status)
        return yield* decode(
          WorkspacePullRequestResult,
          { id: input.id, state, pullRequest: summary, refresh: metadata },
          "Kilo Cloud returned an inconsistent PR refresh result",
        )
      }).pipe(Effect.catch((err) => Effect.succeed(pullRequestFailure(input.id, err))))
    })

  const workspaceScope = (input: { id: HostedWorkspaceID; organizationID?: string }) => ({
    workspaceId: input.id.workspaceID,
    ...(input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID }),
  })

  const providerMismatch = (id: HostedWorkspaceID) =>
    id.providerID === PROVIDER
      ? undefined
      : new HostedFailure({
          code: "invalid_request",
          message: "Session host provider does not match",
          retryable: false,
        })

  const changeComparison = (raw: z.infer<typeof CloudChangeComparison>): WorkspaceChangeComparison => ({
    repository: raw.repository,
    comparison: raw.comparison,
    truncated: raw.truncated,
    files: raw.files,
  })

  const changePayload = (id: HostedWorkspaceID, raw: z.infer<typeof CloudWorkspaceChanges>) => ({
    id,
    status: raw.status,
    revision: raw.revision,
    capturedAt: raw.capturedAt,
    truncated: raw.truncated,
    comparisons: raw.comparisons === null ? null : raw.comparisons.map(changeComparison),
  })

  const getWorkspaceChanges = (raw: WorkspaceChangesInput): Effect.Effect<WorkspaceChanges, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceChangesInput, raw)
      const mismatch = providerMismatch(input.id)
      if (mismatch !== undefined) return yield* Effect.fail(mismatch)
      const auth = yield* resolve(input.organizationID)
      const body = yield* query(auth, "getHostedWorkspaceChanges", workspaceScope(input))
      const parsed = CloudWorkspaceChanges.safeParse(body)
      if (!parsed.success || parsed.data.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace change snapshot"))
      }
      return yield* decode(
        WorkspaceChanges,
        changePayload(input.id, parsed.data),
        "Kilo Cloud returned an inconsistent workspace change snapshot",
      )
    })

  const refreshWorkspaceChanges = (raw: WorkspaceChangesInput): Effect.Effect<WorkspaceChangesRefresh, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceChangesInput, raw)
      const mismatch = providerMismatch(input.id)
      if (mismatch !== undefined) return yield* Effect.fail(mismatch)
      const auth = yield* resolve(input.organizationID)
      const body = yield* mutation(auth, "refreshHostedWorkspaceChanges", workspaceScope(input))
      const parsed = CloudWorkspaceChangesRefresh.safeParse(body)
      if (!parsed.success || parsed.data.changes.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace change refresh"))
      }
      return yield* decode(
        WorkspaceChangesRefresh,
        {
          status: parsed.data.status,
          changes: changePayload(input.id, parsed.data.changes),
        },
        "Kilo Cloud returned an inconsistent workspace change refresh",
      )
    })

  const getWorkspaceChangeFile = (
    raw: WorkspaceChangeFileInput,
  ): Effect.Effect<WorkspaceChangeFileResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceChangeFileInput, raw)
      const mismatch = providerMismatch(input.id)
      if (mismatch !== undefined) return yield* Effect.fail(mismatch)
      const auth = yield* resolve(input.organizationID)
      const body = yield* query(auth, "getHostedWorkspaceChangeFile", {
        ...workspaceScope(input),
        path: input.path,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        expectedRevision: input.expectedRevision,
      })
      const parsed = CloudWorkspaceChangeFileResult.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace file"))
      const result = parsed.data
      if (
        (result.status === "available" || result.status === "omitted") &&
        (result.file === null ||
          result.file.revision !== input.expectedRevision ||
          result.file.path !== input.path ||
          (input.scope !== undefined && result.file.scope !== input.scope))
      ) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a file for a different path or revision"))
      }
      return yield* decode(
        WorkspaceChangeFileResult,
        result,
        "Kilo Cloud returned an inconsistent workspace file result",
      )
    })

  const pullRequestURL = (url: string, number: number) => {
    try {
      const parsed = new URL(url)
      const match = /^\/[^/]+\/[^/]+\/pull\/([1-9]\d*)$/.exec(parsed.pathname)
      return (
        parsed.origin === "https://github.com" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        url === `${parsed.origin}${parsed.pathname}` &&
        Number(match?.[1]) === number
      )
    } catch {
      return false
    }
  }

  const getWorkspacePullRequestDiff = (
    raw: WorkspacePullRequestDiffInput,
  ): Effect.Effect<WorkspacePullRequestDiff, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspacePullRequestDiffInput, raw)
      const mismatch = providerMismatch(input.id)
      if (mismatch !== undefined) return yield* Effect.fail(mismatch)
      const auth = yield* resolve(input.organizationID)
      const body = yield* query(auth, "getHostedWorkspacePullRequest", workspaceScope(input))
      const parsed = CloudWorkspacePullRequestDiff.safeParse(body)
      if (!parsed.success || parsed.data.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace pull request diff"))
      }
      const pullRequest = parsed.data.pullRequest
      if (pullRequest !== null && !pullRequestURL(pullRequest.url, pullRequest.number)) {
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported pull request URL"))
      }
      return yield* decode(
        WorkspacePullRequestDiff,
        {
          id: input.id,
          status: parsed.data.status,
          reason: parsed.data.reason,
          pullRequest,
          truncated: parsed.data.truncated,
          files: parsed.data.files,
        },
        "Kilo Cloud returned an inconsistent workspace pull request diff",
      )
    })

  const getWorkspacePullRequestDiffFile = (
    raw: WorkspacePullRequestDiffFileInput,
  ): Effect.Effect<WorkspacePullRequestDiffFileResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspacePullRequestDiffFileInput, raw)
      const mismatch = providerMismatch(input.id)
      if (mismatch !== undefined) return yield* Effect.fail(mismatch)
      const auth = yield* resolve(input.organizationID)
      const body = yield* query(auth, "getHostedWorkspacePullRequestFile", {
        ...workspaceScope(input),
        path: input.path,
        expectedHeadSha: input.expectedHeadSha,
      })
      const parsed = CloudWorkspacePullRequestDiffFile.safeParse(body)
      if (!parsed.success) {
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported pull request file"))
      }
      const result = parsed.data
      if (
        result.path !== input.path ||
        ((result.status === "available" || result.status === "omitted") &&
          result.headSha?.toLowerCase() !== input.expectedHeadSha.toLowerCase())
      ) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a pull request file from a different head"))
      }
      return yield* decode(
        WorkspacePullRequestDiffFileResult,
        result,
        "Kilo Cloud returned an inconsistent pull request file result",
      )
    })

  const deleteWorkspace = (raw: WorkspaceDeleteInput): Effect.Effect<DeleteWorkspaceResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceDeleteInput, raw)
      const auth = yield* resolve(input.organizationID)
      // Failures from this request happen before Cloud admits the deletion. Only
      // a malformed response after dispatch may invalidate local attachments.
      const response = yield* request(auth, {
        method: "POST",
        path: "/trpc/deleteWorktree",
        headers: { ...headers(auth), "content-type": "application/json" },
        body: JSON.stringify({
          worktreeId: input.id.workspaceID,
          ...(input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID }),
        }),
      })
      const body = yield* consume(response).pipe(
        Effect.flatMap(data),
        Effect.catch((error) => Effect.fail(error.code === "invalid_response" ? markDeletionDispatched(error) : error)),
      )
      const parsed = WorkspaceDelete.safeParse(body)
      if (!parsed.success) {
        return yield* Effect.fail(
          markDeletionDispatched(invalid("Kilo Cloud returned an unsupported workspace deletion result")),
        )
      }
      return { workspace: input.id, success: true }
    })

  const createWorkspace = (raw: CreateWorkspaceInput): Effect.Effect<CreateWorkspaceResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(CreateWorkspaceInput, raw)
      const auth = yield* resolve(input.organizationID)
      const body = yield* mutation(auth, "createHostedWorkspace", {
        operationKey: input.operationKey,
        clientProvenance: "agent-manager",
        repository: repositoryPayload(input.repository),
        ...(input.profile === undefined ? {} : { profile: profilePayload(input.profile) }),
        ...(input.prompt === undefined || input.messageID === undefined
          ? {}
          : { message: { prompt: input.prompt, id: input.messageID } }),
        agent: agentPayload(input.agent),
        ...(auth.organizationID ? { options: { kilocodeOrganizationId: auth.organizationID } } : {}),
      })
      const parsed = WorkspaceCreate.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace result"))
      if (input.messageID !== undefined && parsed.data.messageId !== input.messageID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different message identity"))
      }
      return {
        workspace: yield* workspaceIdentity(parsed.data.workspaceId),
        session: yield* identity(parsed.data.kiloSessionId),
        ...(input.messageID === undefined ? {} : { messageID: input.messageID }),
        replayed: parsed.data.replayed === true,
      }
    })

  const continueWorkspace = (
    raw: ProviderContinueWorkspaceInput,
    opts?: { readonly token?: Redacted.Redacted },
  ): Effect.Effect<ProviderContinueWorkspaceResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(ProviderContinueWorkspaceInput, raw)
      // Pin the bearer: the caller may pass the same credential it used to read
      // the principal, so identity and dispatch cannot resolve different tokens.
      const auth = opts?.token ? ({ token: opts.token } satisfies CloudAuth.Resolved) : yield* resolveToken
      const body = yield* continuationMutation(auth, input)
      const parsed = ContinuationOutput.safeParse(body)
      if (!parsed.success) {
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported continuation result"))
      }
      if (parsed.data.sessions.length !== input.sessions.length) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different number of sessions"))
      }
      for (const [index, session] of parsed.data.sessions.entries()) {
        const expected = input.sessions.at(index)
        if (!expected || session.sourceKiloSessionId !== expected.sourceKiloSessionId) {
          return yield* Effect.fail(invalid("Kilo Cloud returned sessions in a different order"))
        }
      }
      const destinations = parsed.data.sessions.map((session) => session.kiloSessionId)
      if (new Set(destinations).size !== destinations.length) {
        return yield* Effect.fail(invalid("Kilo Cloud returned duplicate destination sessions"))
      }
      const activeIndex = input.sessions.findIndex(
        (session) => session.sourceKiloSessionId === input.activeSourceKiloSessionId,
      )
      const expectedActive = activeIndex < 0 ? undefined : destinations.at(activeIndex)
      if (expectedActive === undefined || parsed.data.activeKiloSessionId !== expectedActive) {
        return yield* Effect.fail(
          invalid("Kilo Cloud returned an active session that does not match the active source"),
        )
      }
      const sessions = yield* Effect.forEach(
        parsed.data.sessions,
        (session): Effect.Effect<ContinueWorkspaceSession, HostedFailure> =>
          identity(session.kiloSessionId).pipe(
            Effect.map((destination) => ({
              source: session.sourceKiloSessionId,
              destination,
              agent: {
                mode: session.agent.mode,
                model: session.agent.model,
                ...(session.agent.variant === undefined ? {} : { variant: session.agent.variant }),
              },
              modeFallback: session.modeFallback,
            })),
          ),
      )
      return {
        workspace: yield* workspaceIdentity(parsed.data.workspaceId),
        sessions,
        active: yield* identity(parsed.data.activeKiloSessionId),
        replayed: parsed.data.replayed === true,
      }
    })

  const startWorkspaceSession = (
    raw: WorkspaceSessionStartInput,
  ): Effect.Effect<WorkspaceSessionStartResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceSessionStartInput, raw)
      const auth = yield* resolve(input.organizationID)
      const body = yield* mutation(auth, "createHostedWorkspaceSession", {
        workspaceId: input.id.workspaceID,
        operationKey: input.operationKey,
        clientProvenance: "agent-manager",
        message: { prompt: input.prompt, id: input.messageID },
        agent: agentPayload(input.agent),
        ...(auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : {}),
      })
      const parsed = WorkspaceCreate.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace result"))
      if (parsed.data.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different workspace identity"))
      }
      if (parsed.data.messageId !== input.messageID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different message identity"))
      }
      return {
        workspace: { providerID: PROVIDER, workspaceID: parsed.data.workspaceId },
        session: yield* identity(parsed.data.kiloSessionId),
        messageID: input.messageID,
        replayed: parsed.data.replayed === true,
      }
    })

  const listWorkspaceProfiles = (
    raw: WorkspaceProfileListInput = {},
  ): Effect.Effect<WorkspaceProfilePage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceProfileListInput, raw)
      const auth = yield* resolve(input.organizationID)
      const body = yield* query(
        auth,
        "listHostedWorkspaceProfiles",
        input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID },
      )
      const parsed = CloudProfilePage.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned unsupported profile summaries"))
      const summary = (profile: z.infer<typeof CloudProfile>) => ({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        ownerType: profile.ownerType,
        isPersonalDefault: profile.isPersonalDefault,
        isOrganizationDefault: profile.isOrganizationDefault,
      })
      return {
        personalProfiles: parsed.data.personalProfiles.map(summary),
        organizationProfiles: parsed.data.organizationProfiles.map(summary),
        personalDefaultProfileID: parsed.data.personalDefaultProfileId,
        organizationDefaultProfileID: parsed.data.organizationDefaultProfileId,
        effectiveDefaultProfileID: parsed.data.effectiveDefaultProfileId,
      }
    })

  const profileDefault = (
    procedure: "setHostedWorkspacePersonalDefaultProfile" | "clearHostedWorkspacePersonalDefaultProfile",
    raw: WorkspaceProfileDefaultInput,
  ): Effect.Effect<WorkspaceProfileDefaultResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceProfileDefaultInput, raw)
      const auth = yield* resolve(input.organizationID)
      const body = yield* mutation(auth, procedure, { profileId: input.id })
      const parsed = z.object({ success: z.literal(true) }).safeParse(body)
      if (!parsed.success)
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported profile default result"))
      return { success: true }
    })

  const setWorkspacePersonalDefaultProfile = (raw: WorkspaceProfileDefaultInput) =>
    profileDefault("setHostedWorkspacePersonalDefaultProfile", raw)

  const clearWorkspacePersonalDefaultProfile = (raw: WorkspaceProfileDefaultInput) =>
    profileDefault("clearHostedWorkspacePersonalDefaultProfile", raw)

  /**
   * Maps one allowlisted native request onto the merged `/kilo` facade. Cloud
   * control identities, origin, bearer, selector, and fence never leave this
   * module.
   */
  const native = (input: NativeRequest): Effect.Effect<Response, HostedFailure> =>
    Effect.gen(function* () {
      const mapped = classify(input.session.sessionID, input.method, input.path, input.query)
      if (mapped === undefined) {
        return yield* Effect.fail(
          new HostedFailure({
            code: "invalid_request",
            message: "Native route is not supported by this session host",
            retryable: false,
          }),
        )
      }
      if (mapped.kind === "mismatch") {
        return yield* Effect.fail(
          new HostedFailure({
            code: "invalid_request",
            message: "Session identity does not match this attachment",
            retryable: false,
          }),
        )
      }
      const auth = yield* resolve(input.organizationID)
      const headers: Record<string, string> = {
        ...buildKiloHeaders(
          undefined,
          auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : undefined,
        ),
      }
      for (const [key, value] of input.headers.entries()) headers[key] = value
      const query = mapped.query.toString()
      return yield* request(auth, {
        method: mapped.method,
        path: query.length === 0 ? mapped.remote : `${mapped.remote}?${query}`,
        headers,
        ...(input.body && input.body.length > 0 ? { body: new Blob([new Uint8Array(input.body).buffer]) } : {}),
        // Both native event streams are long-lived; every other call keeps the default bound.
        ...(mapped.remote === "/kilo/event" || mapped.remote === "/kilo/cloud-agent/event" ? { timeoutMs: 0 } : {}),
      })
    })

  return {
    id: PROVIDER,
    default: true,
    availability,
    transport: Effect.sync(() => transport.current),
    list,
    get,
    transcript,
    start,
    attach,
    membership,
    listWorkspaces,
    getWorkspace,
    getWorkspaceStatus,
    getWorkspacePullRequest: (input) => pullRequest(input, false),
    refreshWorkspacePullRequest: (input) => pullRequest(input, true),
    getWorkspaceChanges,
    refreshWorkspaceChanges,
    getWorkspaceChangeFile,
    getWorkspacePullRequestDiff,
    getWorkspacePullRequestDiffFile,
    deleteWorkspace,
    createWorkspace,
    continueWorkspace,
    startWorkspaceSession,
    listWorkspaceProfiles,
    setWorkspacePersonalDefaultProfile,
    clearWorkspacePersonalDefaultProfile,
    route: native,
  }
}

function repositoryPayload(repo: Repository): Record<string, unknown> {
  if (repo.type === "github") return { type: "github", repo: repo.repo, branch: repo.branch }
  if (repo.type === "gitlab") return { type: "gitlab", url: repo.url, branch: repo.branch }
  return { type: "git", url: repo.url, branch: repo.branch }
}

function agentPayload(agent: Agent): Record<string, unknown> {
  return { mode: agent.mode, model: agent.model, ...(agent.variant ? { variant: agent.variant } : {}) }
}

function profilePayload(profile: Profile): Record<string, unknown> {
  return { id: profile.id, ...(profile.overrides ? { overrides: profile.overrides } : {}) }
}

function route(base: `/${string}`, query: URLSearchParams): `/${string}` {
  return query.size === 0 ? base : `${base}?${query.toString()}`
}

function omittedCount(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const count = Number(value)
  return Number.isSafeInteger(count) ? count : undefined
}
