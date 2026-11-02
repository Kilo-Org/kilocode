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

const DELETION_DISPATCHED = Symbol("workspace-deletion-dispatched")

/**
 * Marks a deletion failure that happened after the Worker request was sent, so
 * the local handler can invalidate workspace attachments without treating a
 * pre-dispatch issuer failure as a successful deletion.
 */
export function markDeletionDispatched(error: HostedFailure) {
  return Object.assign(error, { [DELETION_DISPATCHED]: true })
}

export function deletionDispatched(error: HostedFailure) {
  return DELETION_DISPATCHED in error
}

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

export const Repository = Schema.Union([
  Schema.Struct({ type: Schema.Literal("github"), repo: Schema.String, branch: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("gitlab"), url: Schema.String, branch: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("git"), url: Schema.String, branch: Schema.optional(Schema.String) }),
]).annotate({ identifier: "SessionHostRepository" })
export type Repository = Schema.Schema.Type<typeof Repository>

export const OrganizationID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)).annotate({
  identifier: "SessionHostOrganizationID",
})
export type OrganizationID = Schema.Schema.Type<typeof OrganizationID>

/**
 * Hosted workspace identity. Like a hosted session, a provider workspace id is
 * only meaningful inside its provider, so the public identity is composite.
 */
export const WorkspaceID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
).annotate({ identifier: "SessionHostWorkspaceID" })
export type WorkspaceID = Schema.Schema.Type<typeof WorkspaceID>

export const HostedWorkspaceID = Schema.Struct({
  providerID: ProviderID,
  workspaceID: WorkspaceID,
}).annotate({ identifier: "SessionHostWorkspaceIdentity" })
export type HostedWorkspaceID = Schema.Schema.Type<typeof HostedWorkspaceID>

/** The repository a workspace was created from, normalized across providers. */
export const WorkspaceRepository = Schema.Struct({
  provider: Schema.optional(Schema.Literals(["github", "gitlab", "bitbucket", "git"])),
  url: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionHostWorkspaceRepository" })
export type WorkspaceRepository = Schema.Schema.Type<typeof WorkspaceRepository>

/**
 * A root session that belongs to a workspace. Its identity is the local-native
 * session identity; the provider's routing session id is never exposed.
 */
export const HostedWorkspaceSession = Schema.Struct({
  id: HostedSessionID,
  title: Schema.optional(Schema.String),
  createdOnPlatform: Schema.String,
  created: Schema.Finite,
  updated: Schema.Finite,
}).annotate({ identifier: "SessionHostWorkspaceSession" })
export type HostedWorkspaceSession = Schema.Schema.Type<typeof HostedWorkspaceSession>

export const HostedWorkspace = Schema.Struct({
  id: HostedWorkspaceID,
  name: Schema.optional(Schema.String),
  repository: WorkspaceRepository,
  profileID: Schema.optional(Schema.String),
  deletionState: Schema.Literals(["active", "deleting", "deleted"]),
  created: Schema.Finite,
  updated: Schema.Finite,
  lastActivity: Schema.Finite,
  sessions: Schema.Array(HostedWorkspaceSession),
  cursor: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionHostWorkspace" })
export type HostedWorkspace = Schema.Schema.Type<typeof HostedWorkspace>

export const HostedWorkspacePage = Schema.Struct({
  items: Schema.Array(HostedWorkspace),
  cursor: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionHostWorkspacePage" })
export type HostedWorkspacePage = Schema.Schema.Type<typeof HostedWorkspacePage>

export const HostedWorkspaceSessionPage = Schema.Struct({
  items: Schema.Array(HostedWorkspaceSession),
  cursor: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionHostWorkspaceSessionPage" })
export type HostedWorkspaceSessionPage = Schema.Schema.Type<typeof HostedWorkspaceSessionPage>

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

/**
 * Passive workspace status. Fees are reduced to the payer class: the provider's
 * payer identity never crosses the boundary.
 */
export const HostedWorkspaceStatus = Schema.Struct({
  id: HostedWorkspaceID,
  deletionState: Schema.Literals(["active", "deleting", "deleted"]),
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
  }),
}).annotate({ identifier: "SessionHostWorkspaceStatus" })
export type HostedWorkspaceStatus = Schema.Schema.Type<typeof HostedWorkspaceStatus>

export const Agent = Schema.Struct({
  mode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  variant: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50))),
}).annotate({ identifier: "SessionHostAgent" })
export type Agent = Schema.Schema.Type<typeof Agent>

export const ProfileOverrides = Schema.Struct({
  envVars: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  setupCommands: Schema.optional(Schema.Array(Schema.String)),
  appendSystemPrompt: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionHostProfileOverrides" })
export type ProfileOverrides = Schema.Schema.Type<typeof ProfileOverrides>

/**
 * Cloud resolves this profile server-side. The id is required because an
 * Agent Manager workspace must resolve to a named Cloud profile.
 */
export const Profile = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  overrides: Schema.optional(ProfileOverrides),
}).annotate({ identifier: "SessionHostProfile" })
export type Profile = Schema.Schema.Type<typeof Profile>

/**
 * Authorized profile summaries available for workspace creation. Only the
 * display fields are exposed; provider-private secrets and setup inputs stay
 * behind the API origin.
 */
export const WorkspaceProfileListInput = Schema.Struct({
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceProfileListInput" })
export type WorkspaceProfileListInput = Schema.Schema.Type<typeof WorkspaceProfileListInput>

export const WorkspaceProfileSummary = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
  isDefault: Schema.Boolean,
}).annotate({ identifier: "SessionHostWorkspaceProfileSummary" })
export type WorkspaceProfileSummary = Schema.Schema.Type<typeof WorkspaceProfileSummary>

export const WorkspaceProfilePage = Schema.Struct({
  items: Schema.Array(WorkspaceProfileSummary),
}).annotate({ identifier: "SessionHostWorkspaceProfilePage" })
export type WorkspaceProfilePage = Schema.Schema.Type<typeof WorkspaceProfilePage>

export const WorkspaceListInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  sessionLimit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  repositoryUrl: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceListInput" })
export type WorkspaceListInput = Schema.Schema.Type<typeof WorkspaceListInput>

export const WorkspaceGetInput = Schema.Struct({
  id: HostedWorkspaceID,
  sessionLimit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  sessionCursor: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceGetInput" })
export type WorkspaceGetInput = Schema.Schema.Type<typeof WorkspaceGetInput>

export const WorkspaceStatusInput = Schema.Struct({
  id: HostedWorkspaceID,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceStatusInput" })
export type WorkspaceStatusInput = Schema.Schema.Type<typeof WorkspaceStatusInput>

export const WorkspaceDeleteInput = Schema.Struct({
  id: HostedWorkspaceID,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceDeleteInput" })
export type WorkspaceDeleteInput = Schema.Schema.Type<typeof WorkspaceDeleteInput>

export const DeleteWorkspaceResult = Schema.Struct({
  workspace: HostedWorkspaceID,
  success: Schema.Literal(true),
}).annotate({ identifier: "SessionHostDeleteWorkspaceResult" })
export type DeleteWorkspaceResult = Schema.Schema.Type<typeof DeleteWorkspaceResult>

/**
 * Create a hosted workspace and its root session. `operationKey` is required so
 * a retried request is admitted once, and `messageID` names the root initial
 * message so an ambiguous failure can be retried without a duplicate turn.
 */
export const CreateWorkspaceInput = Schema.Struct({
  repository: Repository,
  profile: Profile,
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  agent: Agent,
  operationKey: Schema.String.check(Schema.isUUID()),
  messageID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostCreateWorkspaceInput" })
export type CreateWorkspaceInput = Schema.Schema.Type<typeof CreateWorkspaceInput>

export const CreateWorkspaceResult = Schema.Struct({
  workspace: HostedWorkspaceID,
  session: HostedSessionID,
  messageID: Schema.String,
  replayed: Schema.Boolean,
}).annotate({ identifier: "SessionHostCreateWorkspaceResult" })
export type CreateWorkspaceResult = Schema.Schema.Type<typeof CreateWorkspaceResult>

export const WorkspaceSessionStartBody = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  agent: Agent,
  operationKey: Schema.String.check(Schema.isUUID()),
  messageID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceSessionStartBody" })
export type WorkspaceSessionStartBody = Schema.Schema.Type<typeof WorkspaceSessionStartBody>

export const WorkspaceSessionStartInput = Schema.Struct({
  ...WorkspaceSessionStartBody.fields,
  id: HostedWorkspaceID,
}).annotate({ identifier: "SessionHostWorkspaceSessionStartInput" })
export type WorkspaceSessionStartInput = Schema.Schema.Type<typeof WorkspaceSessionStartInput>

export const WorkspaceSessionStartResult = Schema.Struct({
  workspace: HostedWorkspaceID,
  session: HostedSessionID,
  messageID: Schema.String,
  replayed: Schema.Boolean,
}).annotate({ identifier: "SessionHostWorkspaceSessionStartResult" })
export type WorkspaceSessionStartResult = Schema.Schema.Type<typeof WorkspaceSessionStartResult>

export const Origin = Schema.Literals(["cli", "desktop"]).annotate({ identifier: "SessionHostOrigin" })
export type Origin = Schema.Schema.Type<typeof Origin>

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
  /** Validates the session and returns a fresh validity window. Runs on every renewal, so it stays cheap. */
  readonly attach: (input: AttachInput) => Effect.Effect<Attachment, HostedFailure>
  /**
   * Resolves the workspace that holds a session, once per new attachment.
   * Workspace membership is local routing state and is absent from the public
   * attach response. Omitted by providers without workspaces.
   */
  readonly membership?: (input: AttachInput) => Effect.Effect<HostedWorkspaceID | undefined, HostedFailure>
  readonly listWorkspaces: (input?: WorkspaceListInput) => Effect.Effect<HostedWorkspacePage, HostedFailure>
  readonly getWorkspace: (input: WorkspaceGetInput) => Effect.Effect<HostedWorkspace, HostedFailure>
  readonly getWorkspaceStatus: (input: WorkspaceStatusInput) => Effect.Effect<HostedWorkspaceStatus, HostedFailure>
  readonly deleteWorkspace: (input: WorkspaceDeleteInput) => Effect.Effect<DeleteWorkspaceResult, HostedFailure>
  readonly createWorkspace: (input: CreateWorkspaceInput) => Effect.Effect<CreateWorkspaceResult, HostedFailure>
  readonly startWorkspaceSession: (
    input: WorkspaceSessionStartInput,
  ) => Effect.Effect<WorkspaceSessionStartResult, HostedFailure>
  readonly listWorkspaceProfiles: (
    input?: WorkspaceProfileListInput,
  ) => Effect.Effect<WorkspaceProfilePage, HostedFailure>
  /**
   * Provider-owned request mapping for the proven native allowlist. Provider
   * origin, credentials, control identities, selectors, and fences stay inside
   * the implementation. Omitted by providers without native routing.
   */
  readonly route?: (input: NativeRequest) => Effect.Effect<Response, HostedFailure>
}
