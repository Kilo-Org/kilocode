import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Schema } from "effect"

/**
 * Provider-neutral Session Host contract. These types are the boundary the
 * future local API and IDE integrations consume; nothing provider-private
 * (target URL, credential, Cloud control ID, fence) belongs here.
 */

export const ProviderID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
)
  .pipe(Schema.brand("SessionHostProviderID"))
  .annotate({ identifier: "SessionHostProviderID" })
export type ProviderID = Schema.Schema.Type<typeof ProviderID>

export const RemoteSessionID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
).annotate({ identifier: "SessionHostRemoteSessionID" })
export type RemoteSessionID = Schema.Schema.Type<typeof RemoteSessionID>

/**
 * Hosted identity is composite. A remote provider's bare session ID is never
 * an identity on its own, so equal remote IDs in two providers cannot collide.
 */
export const HostedSessionID = Schema.Struct({
  providerID: ProviderID,
  sessionID: RemoteSessionID,
}).annotate({ identifier: "SessionHostIdentity" })
export type HostedSessionID = Schema.Schema.Type<typeof HostedSessionID>

export function key(id: HostedSessionID) {
  return `${id.providerID}:${id.sessionID}`
}

export function equal(a: HostedSessionID, b: HostedSessionID) {
  return key(a) === key(b)
}

/**
 * Whether the provider can serve requests at all. This is not session turn
 * state and not transport state: durable reads stay available while a runtime
 * is idle-stopped, and a disconnected transport does not change availability.
 */
export const Availability = Schema.Union([
  Schema.Struct({ state: Schema.Literal("available") }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["signed_out", "rejected", "unreachable"]),
    message: Schema.String,
  }),
]).annotate({ identifier: "SessionHostAvailability" })
export type Availability = Schema.Schema.Type<typeof Availability>

/**
 * Result of the most recent request attempt. Kept separate from availability
 * so a transient failure never masquerades as a lifecycle or auth change.
 */
export const Transport = Schema.Union([
  Schema.Struct({ state: Schema.Literal("unknown") }),
  Schema.Struct({ state: Schema.Literal("reachable"), checkedAt: Schema.Finite }),
  Schema.Struct({
    state: Schema.Literal("unreachable"),
    checkedAt: Schema.Finite,
    message: Schema.String,
  }),
]).annotate({ identifier: "SessionHostTransport" })
export type Transport = Schema.Schema.Type<typeof Transport>

export const FailureCode = Schema.Literals([
  "signed_out",
  "unauthorized",
  "payment_required",
  "not_found",
  "invalid_request",
  "invalid_response",
  "auth_unavailable",
  "rejected",
  "unavailable",
  "unknown_provider",
]).annotate({ identifier: "SessionHostFailureCode" })
export type FailureCode = Schema.Schema.Type<typeof FailureCode>

export class HostedFailure extends Schema.TaggedErrorClass<HostedFailure>()("SessionHostFailure", {
  code: FailureCode,
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

export const HostedSession = Schema.Struct({
  id: HostedSessionID,
  session: SessionV1.SessionInfo,
}).annotate({ identifier: "SessionHostSession" })
export type HostedSession = Schema.Schema.Type<typeof HostedSession>

export const HostedSessionPage = Schema.Struct({
  items: Schema.Array(HostedSession),
}).annotate({ identifier: "SessionHostSessionPage" })
export type HostedSessionPage = Schema.Schema.Type<typeof HostedSessionPage>

export const HostedTranscriptPage = Schema.Struct({
  items: Schema.Array(SessionV1.WithParts),
  cursor: Schema.optional(Schema.String),
  omitted: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).annotate({ identifier: "SessionHostTranscriptPage" })
export type HostedTranscriptPage = Schema.Schema.Type<typeof HostedTranscriptPage>

export const Repository = Schema.Union([
  Schema.Struct({ type: Schema.Literal("github"), repo: Schema.String, branch: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("gitlab"), url: Schema.String, branch: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("git"), url: Schema.String, branch: Schema.optional(Schema.String) }),
]).annotate({ identifier: "SessionHostRepository" })
export type Repository = Schema.Schema.Type<typeof Repository>

export const Origin = Schema.Literals(["cli", "desktop"]).annotate({ identifier: "SessionHostOrigin" })
export type Origin = Schema.Schema.Type<typeof Origin>

export const OrganizationID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)).annotate({
  identifier: "SessionHostOrganizationID",
})
export type OrganizationID = Schema.Schema.Type<typeof OrganizationID>

export const WorkspaceID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
).annotate({ identifier: "SessionHostWorkspaceIDValue" })
export type WorkspaceID = Schema.Schema.Type<typeof WorkspaceID>

/**
 * Hosted workspace identity is composite for the same reason session identity
 * is: a provider's bare workspace id is never an identity on its own.
 */
export const HostedWorkspaceID = Schema.Struct({
  providerID: ProviderID,
  workspaceID: WorkspaceID,
}).annotate({ identifier: "SessionHostWorkspaceIdentity" })
export type HostedWorkspaceID = Schema.Schema.Type<typeof HostedWorkspaceID>

export function workspaceKey(id: HostedWorkspaceID) {
  return `${id.providerID}:${id.workspaceID}`
}

/**
 * A hosted root session inside a workspace. `remoteSessionID` is the provider's
 * durable session identifier; `nativeSessionID` is the native Kilo session the
 * attachment routes to. Both are scoped by workspace and provider.
 */
export const HostedWorkspaceSessionID = Schema.Struct({
  providerID: ProviderID,
  workspaceID: WorkspaceID,
  remoteSessionID: RemoteSessionID,
  nativeSessionID: RemoteSessionID,
}).annotate({ identifier: "SessionHostWorkspaceSessionIdentity" })
export type HostedWorkspaceSessionID = Schema.Schema.Type<typeof HostedWorkspaceSessionID>

export function workspaceSessionKey(id: HostedWorkspaceSessionID) {
  return `${workspaceKey(id)}:${id.remoteSessionID}:${id.nativeSessionID}`
}

export const WorkspaceRepositoryProvider = Schema.NullOr(
  Schema.Literals(["github", "gitlab", "bitbucket", "git"]),
).annotate({ identifier: "SessionHostWorkspaceRepositoryProvider" })
export type WorkspaceRepositoryProvider = Schema.Schema.Type<typeof WorkspaceRepositoryProvider>

export const WorkspaceRepository = Schema.Struct({
  type: WorkspaceRepositoryProvider,
  url: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
}).annotate({ identifier: "SessionHostWorkspaceRepository" })
export type WorkspaceRepository = Schema.Schema.Type<typeof WorkspaceRepository>

export const WorkspaceDeletionState = Schema.Literals(["active", "deleting", "deleted"]).annotate({
  identifier: "SessionHostWorkspaceDeletionState",
})
export type WorkspaceDeletionState = Schema.Schema.Type<typeof WorkspaceDeletionState>

export const WorkspaceSession = Schema.Struct({
  id: HostedWorkspaceSessionID,
  title: Schema.NullOr(Schema.String),
  organizationID: Schema.NullOr(OrganizationID),
  profileID: Schema.NullOr(Schema.String),
  created: Schema.Finite,
  updated: Schema.Finite,
}).annotate({ identifier: "SessionHostWorkspaceSession" })
export type WorkspaceSession = Schema.Schema.Type<typeof WorkspaceSession>

export const WorkspaceSessionPage = Schema.Struct({
  items: Schema.Array(WorkspaceSession),
  nextCursor: Schema.NullOr(Schema.String),
}).annotate({ identifier: "SessionHostWorkspaceSessionPage" })
export type WorkspaceSessionPage = Schema.Schema.Type<typeof WorkspaceSessionPage>

export const Workspace = Schema.Struct({
  id: HostedWorkspaceID,
  name: Schema.NullOr(Schema.String),
  repository: WorkspaceRepository,
  profileID: Schema.NullOr(Schema.String),
  organizationID: Schema.NullOr(OrganizationID),
  deletionState: WorkspaceDeletionState,
  created: Schema.Finite,
  updated: Schema.Finite,
  lastActivity: Schema.Finite,
  sessions: Schema.Array(WorkspaceSession),
  nextSessionCursor: Schema.NullOr(Schema.String),
}).annotate({ identifier: "SessionHostWorkspace" })
export type Workspace = Schema.Schema.Type<typeof Workspace>

export const WorkspacePage = Schema.Struct({
  items: Schema.Array(Workspace),
  nextCursor: Schema.NullOr(Schema.String),
}).annotate({ identifier: "SessionHostWorkspacePage" })
export type WorkspacePage = Schema.Schema.Type<typeof WorkspacePage>

export const WorkspaceComputeStatus = Schema.Literals([
  "active",
  "sleeping",
  "starting",
  "stopping",
  "error",
  "unreachable",
  "unknown",
]).annotate({ identifier: "SessionHostWorkspaceComputeStatus" })
export type WorkspaceComputeStatus = Schema.Schema.Type<typeof WorkspaceComputeStatus>

export const WorkspaceComputeDetail = Schema.Literals([
  "sandbox_ready",
  "sandbox_stopped",
  "sandbox_starting",
  "sandbox_stopping",
  "sandbox_failed",
  "connection_unavailable",
  "status_unavailable",
  "insufficient_evidence",
  "check_needed",
]).annotate({ identifier: "SessionHostWorkspaceComputeDetail" })
export type WorkspaceComputeDetail = Schema.Schema.Type<typeof WorkspaceComputeDetail>

export const WorkspaceDeletionPhase = Schema.Literals([
  "not_started",
  "runtime_cleanup",
  "finalizing",
  "completed",
]).annotate({ identifier: "SessionHostWorkspaceDeletionPhase" })
export type WorkspaceDeletionPhase = Schema.Schema.Type<typeof WorkspaceDeletionPhase>

export const WorkspaceWakeBlockedReason = Schema.Literals([
  "deleting",
  "deleted",
  "billing_blocked",
  "billing_status_unavailable",
]).annotate({ identifier: "SessionHostWorkspaceWakeBlockedReason" })
export type WorkspaceWakeBlockedReason = Schema.Schema.Type<typeof WorkspaceWakeBlockedReason>

export const WorkspaceStatus = Schema.Struct({
  id: HostedWorkspaceID,
  deletionState: WorkspaceDeletionState,
  observedAt: Schema.Finite,
  compute: Schema.Struct({
    status: WorkspaceComputeStatus,
    detailCode: WorkspaceComputeDetail,
    observedAt: Schema.Finite,
    estimatedSleepAt: Schema.NullOr(Schema.Finite),
  }),
  activity: Schema.Struct({
    activeSessionCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    hasActiveTurn: Schema.Boolean,
  }),
  wakeOnInput: Schema.Struct({
    available: Schema.Boolean,
    blockedReason: Schema.NullOr(WorkspaceWakeBlockedReason),
  }),
  billing: Schema.Struct({
    payer: Schema.NullOr(Schema.Literals(["user", "org"])),
    sku: Schema.NullOr(Schema.String),
    blocked: Schema.NullOr(Schema.Boolean),
    enforcementRequested: Schema.Boolean,
    intervalStartedAt: Schema.NullOr(Schema.Finite),
    rate: Schema.NullOr(
      Schema.Struct({
        rateCentsPerSecond: Schema.String,
        estimatedHourlyMicrodollars: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      }),
    ),
  }),
  deletion: Schema.Struct({
    started: Schema.Boolean,
    completed: Schema.Boolean,
    startedAt: Schema.NullOr(Schema.Finite),
    phase: WorkspaceDeletionPhase,
    sessionCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    runtimeLocationCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    completedRuntimeLocationCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    remainingRuntimeLocationCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    deletedSessionIDs: Schema.Array(Schema.String),
  }),
}).annotate({ identifier: "SessionHostWorkspaceStatus" })
export type WorkspaceStatus = Schema.Schema.Type<typeof WorkspaceStatus>

export const WorkspaceAgent = Schema.Struct({
  mode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  variant: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50))),
}).annotate({ identifier: "SessionHostWorkspaceAgent" })
export type WorkspaceAgent = Schema.Schema.Type<typeof WorkspaceAgent>

export const OperationKey = Schema.String.check(
  Schema.isPattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
).annotate({ identifier: "SessionHostOperationKey" })
export type OperationKey = Schema.Schema.Type<typeof OperationKey>

export const WorkspaceProfileInput = Schema.Struct({
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceProfileInput" })
export type WorkspaceProfileInput = Schema.Schema.Type<typeof WorkspaceProfileInput>

export const WorkspaceListInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  sessionLimit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  repositoryUrl: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceListInput" })
export type WorkspaceListInput = Schema.Schema.Type<typeof WorkspaceListInput>

export const WorkspaceGetInput = Schema.Struct({
  id: HostedWorkspaceID,
  sessionLimit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  sessionCursor: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceGetInput" })
export type WorkspaceGetInput = Schema.Schema.Type<typeof WorkspaceGetInput>

export const WorkspaceStatusInput = Schema.Struct({
  id: HostedWorkspaceID,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceStatusInput" })
export type WorkspaceStatusInput = Schema.Schema.Type<typeof WorkspaceStatusInput>

export const WorkspaceSessionListInput = Schema.Struct({
  id: HostedWorkspaceID,
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceSessionListInput" })
export type WorkspaceSessionListInput = Schema.Schema.Type<typeof WorkspaceSessionListInput>

export const WorkspaceCreateInput = Schema.Struct({
  repository: Repository,
  profileID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  agent: WorkspaceAgent,
  organizationID: Schema.optional(OrganizationID),
  operationKey: OperationKey,
  messageID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
}).annotate({ identifier: "SessionHostWorkspaceCreateInput" })
export type WorkspaceCreateInput = Schema.Schema.Type<typeof WorkspaceCreateInput>

export const WorkspaceCreateResult = Schema.Struct({
  workspace: HostedWorkspaceID,
  session: HostedWorkspaceSessionID,
  messageID: Schema.String,
  replayed: Schema.Boolean,
}).annotate({ identifier: "SessionHostWorkspaceCreateResult" })
export type WorkspaceCreateResult = Schema.Schema.Type<typeof WorkspaceCreateResult>

export const WorkspaceSessionCreateInput = Schema.Struct({
  id: HostedWorkspaceID,
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  agent: WorkspaceAgent,
  organizationID: Schema.optional(OrganizationID),
  operationKey: OperationKey,
  messageID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
}).annotate({ identifier: "SessionHostWorkspaceSessionCreateInput" })
export type WorkspaceSessionCreateInput = Schema.Schema.Type<typeof WorkspaceSessionCreateInput>

export const WorkspaceSessionCreateResult = WorkspaceCreateResult.annotate({
  identifier: "SessionHostWorkspaceSessionCreateResult",
})
export type WorkspaceSessionCreateResult = Schema.Schema.Type<typeof WorkspaceSessionCreateResult>

export const WorkspaceDeleteResult = Schema.Struct({
  workspace: HostedWorkspaceID,
  success: Schema.Literal(true),
  deletedSessionIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "SessionHostWorkspaceDeleteResult" })
export type WorkspaceDeleteResult = Schema.Schema.Type<typeof WorkspaceDeleteResult>

export const WorkspaceSessionRef = Schema.Struct({
  providerID: ProviderID,
  workspaceID: WorkspaceID,
  remoteSessionID: RemoteSessionID,
}).annotate({ identifier: "SessionHostWorkspaceSessionRef" })
export type WorkspaceSessionRef = Schema.Schema.Type<typeof WorkspaceSessionRef>

export const WorkspaceSessionAttachInput = Schema.Struct({
  id: WorkspaceSessionRef,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceSessionAttachInput" })
export type WorkspaceSessionAttachInput = Schema.Schema.Type<typeof WorkspaceSessionAttachInput>

export const WorkspaceAttachment = Schema.Struct({
  session: HostedWorkspaceSessionID,
  expiresAt: Schema.Finite,
}).annotate({ identifier: "SessionHostWorkspaceAttachment" })
export type WorkspaceAttachment = Schema.Schema.Type<typeof WorkspaceAttachment>

export const WorkspaceProfile = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
  isDefault: Schema.Boolean,
}).annotate({ identifier: "SessionHostWorkspaceProfile" })
export type WorkspaceProfile = Schema.Schema.Type<typeof WorkspaceProfile>

export const WorkspaceProfilePage = Schema.Struct({
  items: Schema.Array(WorkspaceProfile),
}).annotate({ identifier: "SessionHostWorkspaceProfilePage" })
export type WorkspaceProfilePage = Schema.Schema.Type<typeof WorkspaceProfilePage>

export interface WorkspaceProvider {
  readonly list: (input?: WorkspaceListInput) => Effect.Effect<WorkspacePage, HostedFailure>
  readonly get: (input: WorkspaceGetInput) => Effect.Effect<Workspace, HostedFailure>
  readonly status: (input: WorkspaceStatusInput) => Effect.Effect<WorkspaceStatus, HostedFailure>
  readonly sessions: (input: WorkspaceSessionListInput) => Effect.Effect<WorkspaceSessionPage, HostedFailure>
  readonly create: (input: WorkspaceCreateInput) => Effect.Effect<WorkspaceCreateResult, HostedFailure>
  readonly createSession: (
    input: WorkspaceSessionCreateInput,
  ) => Effect.Effect<WorkspaceSessionCreateResult, HostedFailure>
  readonly delete: (input: WorkspaceGetInput) => Effect.Effect<WorkspaceDeleteResult, HostedFailure>
  readonly attach: (input: WorkspaceSessionAttachInput) => Effect.Effect<WorkspaceAttachment, HostedFailure>
  readonly profiles: (input?: WorkspaceProfileInput) => Effect.Effect<WorkspaceProfilePage, HostedFailure>
}

/**
 * Opaque attachment validity window. Provider routing material (target origin,
 * selector, credential, fence) is deliberately absent: the local attachment
 * API and its proxy hooks are introduced by the next issue.
 */
export const Attachment = Schema.Struct({
  session: HostedSessionID,
  expiresAt: Schema.Finite,
}).annotate({ identifier: "SessionHostAttachment" })
export type Attachment = Schema.Schema.Type<typeof Attachment>

export const ListInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostListInput" })
export type ListInput = Schema.Schema.Type<typeof ListInput>

export const GetInput = Schema.Struct({
  id: HostedSessionID,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostGetInput" })
export type GetInput = Schema.Schema.Type<typeof GetInput>

export const TranscriptInput = Schema.Struct({
  id: HostedSessionID,
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  before: Schema.optional(Schema.String),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostTranscriptInput" })
export type TranscriptInput = Schema.Schema.Type<typeof TranscriptInput>

export const AttachInput = GetInput.annotate({ identifier: "SessionHostAttachInput" })
export type AttachInput = Schema.Schema.Type<typeof AttachInput>

export const StartInput = Schema.Struct({
  repository: Repository,
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  agent: Schema.Struct({
    mode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
    model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  }),
  organizationID: Schema.optional(OrganizationID),
  origin: Schema.optional(Origin),
  /** Stable idempotency key. Reuse it with the same `messageID` to retry safely. */
  operationKey: Schema.optional(Schema.String),
  /** Stable initial message identity. Required for a retry-safe start after an ambiguous failure. */
  messageID: Schema.optional(Schema.String),
})
  .check(
    Schema.makeFilter((input) =>
      input.operationKey === undefined || input.messageID !== undefined
        ? undefined
        : "messageID is required when operationKey is supplied",
    ),
  )
  .annotate({ identifier: "SessionHostStartInput" })
export type StartInput = Schema.Schema.Type<typeof StartInput>

export const StartResult = Schema.Struct({
  session: HostedSessionID,
  messageID: Schema.String,
  delivery: Schema.Literals(["sent", "queued"]),
  replayed: Schema.Boolean,
}).annotate({ identifier: "SessionHostStartResult" })
export type StartResult = Schema.Schema.Type<typeof StartResult>

/**
 * A proven native request bound to one hosted session. The local attachment
 * layer reduces the inbound request to this shape before the provider maps it,
 * so local credentials, cookies, and selectors never reach the provider.
 */
export interface NativeRequest {
  readonly session: HostedSessionID
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: Headers
  /** Native request bodies are JSON bytes; binary content travels base64 inside JSON. */
  readonly body?: Uint8Array
  readonly organizationID?: string
}

export interface Provider {
  readonly id: ProviderID
  readonly default?: boolean
  readonly availability: Effect.Effect<Availability>
  readonly transport: Effect.Effect<Transport>
  readonly list: (input?: ListInput) => Effect.Effect<HostedSessionPage, HostedFailure>
  readonly get: (input: GetInput) => Effect.Effect<HostedSession, HostedFailure>
  readonly transcript: (input: TranscriptInput) => Effect.Effect<HostedTranscriptPage, HostedFailure>
  readonly start: (input: StartInput) => Effect.Effect<StartResult, HostedFailure>
  readonly attach: (input: AttachInput) => Effect.Effect<Attachment, HostedFailure>
  /**
   * Provider-owned request mapping for the proven native allowlist. Provider
   * origin, credentials, control identities, selectors, and fences stay inside
   * the implementation. Omitted by providers without native routing.
   */
  readonly route?: (input: NativeRequest) => Effect.Effect<Response, HostedFailure>
  /**
   * Durable workspace catalog and nested root sessions. Omitted by providers
   * that only expose flat sessions.
   */
  readonly workspace?: WorkspaceProvider
}
