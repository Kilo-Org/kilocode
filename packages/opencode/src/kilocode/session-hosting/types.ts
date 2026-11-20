import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Redacted, Schema } from "effect"
import path from "node:path"

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
  // Continue-in-Cloud local preconditions and Cloud continuation outcomes.
  "worktree_dirty",
  "branch_detached",
  "branch_no_upstream",
  "branch_not_pushed",
  "remote_unsupported",
  "session_not_in_worktree",
  "session_busy",
  "session_changed",
  "sync_unavailable",
  "sync_failed",
  "organization_mismatch",
  "insufficient_balance",
  "continuation_incomplete",
  "creation_in_progress",
  "operation_key_reuse_mismatch",
]).annotate({ identifier: "SessionHostFailureCode" })
export type FailureCode = Schema.Schema.Type<typeof FailureCode>

export class HostedFailure extends Schema.TaggedErrorClass<HostedFailure>()("SessionHostFailure", {
  code: FailureCode,
  message: Schema.String,
  retryable: Schema.Boolean,
  status: Schema.optional(Schema.Int),
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

const revision = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
const commit = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/))
const baseRef = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1024),
  Schema.makeFilter((value) =>
    value.startsWith("-") || value.includes("\0") ? "Expected a valid comparison ref" : undefined,
  ),
)
const capturedAt = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/),
)
const workspacePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  Schema.makeFilter((value) =>
    value.includes("\0") || value.split("/").some((part) => part === "" || part === "." || part === "..")
      ? "Expected a repository-relative path"
      : undefined,
  ),
)

export const WorkspacePullRequestSummary = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  state: Schema.Literals(["open", "draft", "merged", "closed", "unknown"]),
  title: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024))),
  headSha: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{40}$/))),
  lastSyncedAt: Schema.String.check(Schema.isMinLength(1)),
  review: Schema.Struct({
    decision: Schema.NullOr(Schema.Literals(["none", "review_required", "approved", "changes_requested"])),
    available: Schema.Boolean,
    pending: Schema.Boolean,
  }),
  checks: Schema.Struct({
    total: count,
    passed: count,
    failed: count,
    pending: count,
    skipped: count,
    unknown: count,
    complete: Schema.Boolean,
    available: Schema.Boolean,
  }),
  conversations: Schema.Struct({ unresolved: Schema.NullOr(count), complete: Schema.Boolean }),
  mergeability: Schema.Struct({
    mergeable: Schema.NullOr(Schema.Boolean),
    state: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))),
    complete: Schema.Boolean,
  }),
  partial: Schema.Boolean,
  unavailable: Schema.Array(Schema.Literals(["checks", "statuses", "reviews"])),
}).annotate({ identifier: "SessionHostWorkspacePullRequestSummary" })
export type WorkspacePullRequestSummary = Schema.Schema.Type<typeof WorkspacePullRequestSummary>

export const WorkspacePullRequestState = Schema.Literals([
  "available",
  "no_pr",
  "signed_out",
  "rejected",
  "unreachable",
  "rate_limited",
  "unavailable",
  "unsupported",
]).annotate({ identifier: "SessionHostWorkspacePullRequestState" })
export type WorkspacePullRequestState = Schema.Schema.Type<typeof WorkspacePullRequestState>

export const WorkspacePullRequestRefresh = Schema.Struct({
  status: Schema.Literals([
    "refreshed",
    "no_pr",
    "no_integration",
    "rate_limited",
    "throttled",
    "unavailable",
    "failed",
  ]),
  retryAt: Schema.NullOr(Schema.String),
}).annotate({ identifier: "SessionHostWorkspacePullRequestRefresh" })
export type WorkspacePullRequestRefresh = Schema.Schema.Type<typeof WorkspacePullRequestRefresh>

export function refreshState(status: WorkspacePullRequestRefresh["status"]): WorkspacePullRequestState {
  if (status === "refreshed") return "available"
  if (status === "no_pr") return "no_pr"
  if (status === "rate_limited" || status === "throttled") return "rate_limited"
  return "unavailable"
}

/**
 * Only `no_pr` clears a previously known linked PR. Other states retain any
 * returned cache evidence, and a null summary must not erase client evidence.
 * Never merge observations across accounts, workspaces, PR identities, or heads.
 */
export const WorkspacePullRequestResult = Schema.Struct({
  id: HostedWorkspaceID,
  state: WorkspacePullRequestState,
  pullRequest: Schema.NullOr(WorkspacePullRequestSummary),
  refresh: Schema.optional(WorkspacePullRequestRefresh),
})
  .check(
    Schema.makeFilter((result) => {
      if (result.state === "available" && result.pullRequest === null) return "Available PR requires a summary"
      if (result.state === "no_pr" && result.pullRequest !== null) return "No PR requires a null summary"
      if (!result.refresh) return undefined
      const state = refreshState(result.refresh.status)
      return result.state === state ? undefined : "PR refresh status does not match availability"
    }),
  )
  .annotate({ identifier: "SessionHostWorkspacePullRequestResult" })
export type WorkspacePullRequestResult = Schema.Schema.Type<typeof WorkspacePullRequestResult>

export function pullRequestFailure(id: HostedWorkspaceID, err: HostedFailure): WorkspacePullRequestResult {
  const state = ((): WorkspacePullRequestState => {
    if (err.status === 429) return "rate_limited"
    if (err.status === 404 || err.status === 408 || (err.status != null && err.status >= 500)) return "unavailable"
    switch (err.code) {
      case "signed_out":
        return "signed_out"
      case "unauthorized":
      case "rejected":
      case "invalid_request":
      case "payment_required":
        return "rejected"
      case "unavailable":
        return err.status == null ? "unreachable" : "unavailable"
      default:
        return "unavailable"
    }
  })()
  return { id, state, pullRequest: null }
}

export const WorkspaceChangeScope = Schema.Literals(["uncommitted", "against-base-branch"]).annotate({
  identifier: "SessionHostWorkspaceChangeScope",
})
export type WorkspaceChangeScope = Schema.Schema.Type<typeof WorkspaceChangeScope>

export const WorkspaceChangeStatus = Schema.Literals(["added", "modified", "deleted"]).annotate({
  identifier: "SessionHostWorkspaceChangeStatus",
})
export type WorkspaceChangeStatus = Schema.Schema.Type<typeof WorkspaceChangeStatus>

export const WorkspaceOmissionReason = Schema.Literals([
  "binary",
  "unsupported",
  "invalid_utf8",
  "too_large",
  "line_limit",
  "budget_exhausted",
  "inconsistent",
  "capture_failed",
]).annotate({ identifier: "SessionHostWorkspaceOmissionReason" })
export type WorkspaceOmissionReason = Schema.Schema.Type<typeof WorkspaceOmissionReason>

export const WorkspaceDiffAvailability = Schema.Union([
  Schema.Struct({ status: Schema.Literal("available") }),
  Schema.Struct({ status: Schema.Literal("omitted"), reason: WorkspaceOmissionReason }),
]).annotate({ identifier: "SessionHostWorkspaceDiffAvailability" })
export type WorkspaceDiffAvailability = Schema.Schema.Type<typeof WorkspaceDiffAvailability>

export const WorkspaceContentAvailability = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    source: Schema.Literals(["current", "deleted-original"]),
  }),
  Schema.Struct({ status: Schema.Literal("unavailable"), reason: WorkspaceOmissionReason }),
]).annotate({ identifier: "SessionHostWorkspaceContentAvailability" })
export type WorkspaceContentAvailability = Schema.Schema.Type<typeof WorkspaceContentAvailability>

/** Identifies one repository of a multi-repository workspace snapshot. */
export const WorkspaceChangeRepository = Schema.Struct({
  path: Schema.String.check(Schema.isMaxLength(4096)),
  repoFullName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
}).annotate({ identifier: "SessionHostWorkspaceChangeRepository" })
export type WorkspaceChangeRepository = Schema.Schema.Type<typeof WorkspaceChangeRepository>

export const WorkspaceComparison = Schema.Struct({
  baseRef,
  mergeBase: commit,
  head: commit,
  baseRefFallback: Schema.optional(
    Schema.Struct({
      requested: baseRef,
      used: baseRef,
    }),
  ),
}).annotate({ identifier: "SessionHostWorkspaceComparison" })
export type WorkspaceComparison = Schema.Schema.Type<typeof WorkspaceComparison>

/**
 * One captured workspace file. `scope` distinguishes the uncommitted working
 * tree from the committed comparison against the base branch. Availability is
 * explicit, so an omitted payload never renders as an empty successful diff.
 */
export const WorkspaceChangeFile = Schema.Struct({
  path: workspacePath,
  status: WorkspaceChangeStatus,
  scope: Schema.optional(WorkspaceChangeScope),
  additions: count,
  deletions: count,
  tracked: Schema.Boolean,
  binary: Schema.Boolean,
  countsComplete: Schema.Boolean,
  revision,
  repository: Schema.NullOr(WorkspaceChangeRepository),
  diff: WorkspaceDiffAvailability,
  content: WorkspaceContentAvailability,
}).annotate({ identifier: "SessionHostWorkspaceChangeFile" })
export type WorkspaceChangeFile = Schema.Schema.Type<typeof WorkspaceChangeFile>

export const WorkspaceChangeComparison = Schema.Struct({
  repository: Schema.NullOr(WorkspaceChangeRepository),
  comparison: WorkspaceComparison,
  truncated: Schema.Boolean,
  files: Schema.Array(WorkspaceChangeFile),
}).annotate({ identifier: "SessionHostWorkspaceChangeComparison" })
export type WorkspaceChangeComparison = Schema.Schema.Type<typeof WorkspaceChangeComparison>

export const WorkspaceChangesInput = Schema.Struct({
  id: HostedWorkspaceID,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceChangesInput" })
export type WorkspaceChangesInput = Schema.Schema.Type<typeof WorkspaceChangesInput>

/**
 * A saved workspace comparison. Only `captured` carries a revision, capture
 * time, and per-repository comparisons; `not_captured` and `inconsistent`
 * carry none. `inconsistent` is the fail-closed answer when a saved
 * multi-repository file cannot be attributed to exactly one repository.
 */
export const WorkspaceChanges = Schema.Struct({
  id: HostedWorkspaceID,
  status: Schema.Literals(["captured", "not_captured", "inconsistent"]),
  revision: Schema.NullOr(revision),
  capturedAt: Schema.NullOr(capturedAt),
  truncated: Schema.Boolean,
  comparisons: Schema.NullOr(Schema.Array(WorkspaceChangeComparison)),
})
  .check(
    Schema.makeFilter((result) =>
      result.status === "captured"
        ? result.revision !== null &&
          result.capturedAt !== null &&
          result.comparisons !== null &&
          result.comparisons.length > 0
          ? undefined
          : "A captured workspace change result requires a revision, capture time, and comparisons"
        : result.revision === null && result.capturedAt === null && result.comparisons === null && !result.truncated
          ? undefined
          : "A non-captured workspace change result cannot carry comparison data",
    ),
  )
  .annotate({ identifier: "SessionHostWorkspaceChanges" })
export type WorkspaceChanges = Schema.Schema.Type<typeof WorkspaceChanges>

/**
 * `refreshed` carries the new saved snapshot. `offline` and `failed` keep the
 * previous durable snapshot when one exists.
 */
export const WorkspaceChangesRefresh = Schema.Struct({
  status: Schema.Literals(["refreshed", "offline", "failed"]),
  changes: WorkspaceChanges,
}).annotate({ identifier: "SessionHostWorkspaceChangesRefresh" })
export type WorkspaceChangesRefresh = Schema.Schema.Type<typeof WorkspaceChangesRefresh>

export const WorkspaceFileRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  revision,
  path: workspacePath,
  scope: Schema.optional(WorkspaceChangeScope),
  diff: Schema.Union([
    Schema.Struct({ status: Schema.Literal("available"), patch: Schema.String.check(Schema.isMinLength(1)) }),
    Schema.Struct({ status: Schema.Literal("omitted"), reason: WorkspaceOmissionReason }),
  ]),
  content: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("available"),
      source: Schema.Literals(["current", "deleted-original"]),
      text: Schema.String,
    }),
    Schema.Struct({ status: Schema.Literal("unavailable"), reason: WorkspaceOmissionReason }),
  ]),
}).annotate({ identifier: "SessionHostWorkspaceFileRecord" })
export type WorkspaceFileRecord = Schema.Schema.Type<typeof WorkspaceFileRecord>

export const WorkspaceChangeFileInput = Schema.Struct({
  id: HostedWorkspaceID,
  path: workspacePath,
  scope: Schema.optional(WorkspaceChangeScope),
  expectedRevision: revision,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceChangeFileInput" })
export type WorkspaceChangeFileInput = Schema.Schema.Type<typeof WorkspaceChangeFileInput>

export const WorkspaceChangeFileResult = Schema.Struct({
  status: Schema.Literals(["available", "omitted", "not_captured", "no_longer_listed", "stale"]),
  file: Schema.NullOr(WorkspaceFileRecord),
  capturedAt: Schema.NullOr(capturedAt),
  comparison: Schema.NullOr(WorkspaceComparison),
  currentRevision: Schema.NullOr(revision),
})
  .check(
    Schema.makeFilter((result) =>
      result.status === "available" || result.status === "omitted"
        ? result.file !== null &&
          result.file.diff.status === result.status &&
          result.capturedAt !== null &&
          result.comparison !== null
          ? undefined
          : "An available or omitted file requires a matching file record"
        : result.file === null && result.capturedAt === null && result.comparison === null
          ? undefined
          : "A non-file result cannot carry a file record",
    ),
    Schema.makeFilter((result) =>
      result.status === "no_longer_listed" || result.status === "stale"
        ? result.currentRevision === null
          ? "A stale or delisted file result requires the current revision"
          : undefined
        : result.currentRevision === null
          ? undefined
          : "Only a stale or delisted file result names the current revision",
    ),
  )
  .annotate({ identifier: "SessionHostWorkspaceChangeFileResult" })
export type WorkspaceChangeFileResult = Schema.Schema.Type<typeof WorkspaceChangeFileResult>

export const WorkspacePullRequestReason = Schema.Literals([
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
]).annotate({ identifier: "SessionHostWorkspacePullRequestReason" })
export type WorkspacePullRequestReason = Schema.Schema.Type<typeof WorkspacePullRequestReason>

/** The live, verified linked PR. A stale or unverified link never carries one. */
export const WorkspacePullRequestDiffIdentity = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  state: Schema.Literals(["open", "closed"]),
  draft: Schema.Boolean,
  headSha: commit,
  baseRef,
  repository: WorkspaceChangeRepository,
  cacheStale: Schema.Boolean,
}).annotate({ identifier: "SessionHostWorkspacePullRequestDiffIdentity" })
export type WorkspacePullRequestDiffIdentity = Schema.Schema.Type<typeof WorkspacePullRequestDiffIdentity>

export const WorkspacePullRequestDiffFile = Schema.Struct({
  path: workspacePath,
  previousPath: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))),
  status: Schema.Literals(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
  additions: count,
  deletions: count,
  patchAvailable: Schema.Boolean,
}).annotate({ identifier: "SessionHostWorkspacePullRequestDiffFile" })
export type WorkspacePullRequestDiffFile = Schema.Schema.Type<typeof WorkspacePullRequestDiffFile>

export const WorkspacePullRequestDiffInput = Schema.Struct({
  id: HostedWorkspaceID,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspacePullRequestDiffInput" })
export type WorkspacePullRequestDiffInput = Schema.Schema.Type<typeof WorkspacePullRequestDiffInput>

/**
 * The published linked-PR comparison is distinct from the committed and
 * uncommitted workspace changes. Any non-`linked` result carries no PR, and
 * only `linked` carries files; `stale` means the head moved during the read.
 */
export const WorkspacePullRequestDiff = Schema.Struct({
  id: HostedWorkspaceID,
  status: Schema.Literals([
    "linked",
    "stale",
    "not_linked",
    "unverified",
    "credential_required",
    "unavailable",
    "not_github",
  ]),
  reason: Schema.NullOr(WorkspacePullRequestReason),
  pullRequest: Schema.NullOr(WorkspacePullRequestDiffIdentity),
  truncated: Schema.Boolean,
  files: Schema.Array(WorkspacePullRequestDiffFile),
})
  .check(
    Schema.makeFilter((result) =>
      (result.status === "linked") === (result.pullRequest !== null)
        ? undefined
        : "Only a linked PR diff carries a pull request",
    ),
    Schema.makeFilter((result) =>
      result.status === "linked" || result.files.length === 0
        ? undefined
        : "Only a linked PR diff carries pull-request files",
    ),
  )
  .annotate({ identifier: "SessionHostWorkspacePullRequestDiff" })
export type WorkspacePullRequestDiff = Schema.Schema.Type<typeof WorkspacePullRequestDiff>

export const WorkspacePullRequestDiffFileInput = Schema.Struct({
  id: HostedWorkspaceID,
  path: workspacePath,
  expectedHeadSha: commit,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspacePullRequestDiffFileInput" })
export type WorkspacePullRequestDiffFileInput = Schema.Schema.Type<typeof WorkspacePullRequestDiffFileInput>

export const WorkspacePullRequestDiffFileResult = Schema.Struct({
  status: Schema.Literals([
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
  path: workspacePath,
  reason: Schema.NullOr(WorkspacePullRequestReason),
  omissionReason: Schema.NullOr(Schema.Literal("provider_omitted")),
  headSha: Schema.NullOr(commit),
  patch: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
})
  .check(
    Schema.makeFilter((result) =>
      result.status === "available"
        ? result.patch !== null && result.omissionReason === null && result.headSha !== null
          ? undefined
          : "An available PR file requires a patch and head"
        : result.status === "omitted"
          ? result.patch === null && result.omissionReason !== null && result.headSha !== null
            ? undefined
            : "An omitted PR file requires an omission reason and head"
          : result.patch === null && result.omissionReason === null
            ? undefined
            : "A non-file PR result cannot carry a patch or omission reason",
    ),
  )
  .annotate({ identifier: "SessionHostWorkspacePullRequestDiffFileResult" })
export type WorkspacePullRequestDiffFileResult = Schema.Schema.Type<typeof WorkspacePullRequestDiffFileResult>

export const Agent = Schema.Struct({
  mode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  variant: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50))),
}).annotate({ identifier: "SessionHostAgent" })
export type Agent = Schema.Schema.Type<typeof Agent>

/**
 * Continuation agent settings. Unlike `Agent`, the variant may be an empty
 * string: a local `""` and an absent variant are distinct and must survive the
 * round trip to Cloud and back.
 */
export const ContinuationAgent = Schema.Struct({
  mode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  variant: Schema.optional(Schema.String.check(Schema.isMaxLength(50))),
}).annotate({ identifier: "SessionHostContinuationAgent" })
export type ContinuationAgent = Schema.Schema.Type<typeof ContinuationAgent>

/** The number of local root sessions one continuation may copy. */
export const MAX_CONTINUE_SESSIONS = 10

export const ProfileOverrides = Schema.Struct({
  envVars: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  setupCommands: Schema.optional(Schema.Array(Schema.String)),
  appendSystemPrompt: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionHostProfileOverrides" })
export type ProfileOverrides = Schema.Schema.Type<typeof ProfileOverrides>

/**
 * An explicitly selected Cloud profile. When omitted, Cloud applies the
 * caller's effective default profile, if any.
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

export const WorkspaceProfileOwner = Schema.Literals(["user", "organization"]).annotate({
  identifier: "SessionHostWorkspaceProfileOwner",
})
export type WorkspaceProfileOwner = Schema.Schema.Type<typeof WorkspaceProfileOwner>

export const WorkspaceProfileSummary = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
  ownerType: WorkspaceProfileOwner,
  isPersonalDefault: Schema.Boolean,
  isOrganizationDefault: Schema.Boolean,
}).annotate({ identifier: "SessionHostWorkspaceProfileSummary" })
export type WorkspaceProfileSummary = Schema.Schema.Type<typeof WorkspaceProfileSummary>

/**
 * Personal and organization profiles available for workspace creation, plus the
 * stored defaults and the effective default Cloud applies when no profile is
 * supplied. A personal default always wins over an organization default.
 */
export const WorkspaceProfilePage = Schema.Struct({
  personalProfiles: Schema.Array(WorkspaceProfileSummary),
  organizationProfiles: Schema.Array(WorkspaceProfileSummary),
  personalDefaultProfileID: Schema.NullOr(Schema.String),
  organizationDefaultProfileID: Schema.NullOr(Schema.String),
  effectiveDefaultProfileID: Schema.NullOr(Schema.String),
}).annotate({ identifier: "SessionHostWorkspaceProfilePage" })
export type WorkspaceProfilePage = Schema.Schema.Type<typeof WorkspaceProfilePage>

export const WorkspaceProfileDefaultInput = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostWorkspaceProfileDefaultInput" })
export type WorkspaceProfileDefaultInput = Schema.Schema.Type<typeof WorkspaceProfileDefaultInput>

export const WorkspaceProfileDefaultResult = Schema.Struct({
  success: Schema.Literal(true),
}).annotate({ identifier: "SessionHostWorkspaceProfileDefaultResult" })
export type WorkspaceProfileDefaultResult = Schema.Schema.Type<typeof WorkspaceProfileDefaultResult>

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

export const WorkspacePullRequestInput = WorkspaceStatusInput.annotate({
  identifier: "SessionHostWorkspacePullRequestInput",
})
export type WorkspacePullRequestInput = Schema.Schema.Type<typeof WorkspacePullRequestInput>

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
 * Create a hosted workspace and, optionally, its root initial turn. `operationKey`
 * is required so a retried request is admitted once. A prompt and its `messageID`
 * arrive together: omitting both creates an empty workspace whose first prompt
 * is submitted later through the workspace session start route. Supplying a
 * `profile` pins one explicitly; omitting it lets Cloud apply the effective
 * default profile.
 */
export const CreateWorkspaceInput = Schema.Struct({
  repository: Repository,
  profile: Schema.optional(Profile),
  prompt: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000))),
  agent: Agent,
  operationKey: Schema.String.check(Schema.isUUID()),
  messageID: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  organizationID: Schema.optional(OrganizationID),
})
  .check(
    Schema.makeFilter((input) =>
      (input.prompt === undefined) === (input.messageID === undefined)
        ? undefined
        : "prompt and messageID must be supplied together",
    ),
  )
  .annotate({ identifier: "SessionHostCreateWorkspaceInput" })
export type CreateWorkspaceInput = Schema.Schema.Type<typeof CreateWorkspaceInput>

export const CreateWorkspaceResult = Schema.Struct({
  workspace: HostedWorkspaceID,
  session: HostedSessionID,
  messageID: Schema.optional(Schema.String),
  replayed: Schema.Boolean,
}).annotate({ identifier: "SessionHostCreateWorkspaceResult" })
export type CreateWorkspaceResult = Schema.Schema.Type<typeof CreateWorkspaceResult>

/**
 * Copy the open root sessions of one local worktree into one hosted workspace.
 * The CLI owns Git and session validation, mode/model capture, ingest sync,
 * and the web URL; Cloud owns workspace and destination creation.
 */
export const ContinueWorkspaceInput = Schema.Struct({
  operationKey: Schema.String.check(Schema.isUUID()),
  directory: Schema.String.check(Schema.isMinLength(1)),
  sessionIDs: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_CONTINUE_SESSIONS),
  ),
  activeSessionID: Schema.String.check(Schema.isMinLength(1)),
})
  .check(
    Schema.makeFilter((input) => {
      const unique = new Set(input.sessionIDs)
      if (unique.size !== input.sessionIDs.length) return "sessionIDs must be unique"
      if (!unique.has(input.activeSessionID)) return "activeSessionID must be in sessionIDs"
      if (!path.isAbsolute(input.directory)) return "directory must be an absolute path"
      return undefined
    }),
  )
  .annotate({ identifier: "SessionHostContinueWorkspaceInput" })
export type ContinueWorkspaceInput = Schema.Schema.Type<typeof ContinueWorkspaceInput>

export const ContinueWorkspaceSession = Schema.Struct({
  source: Schema.String,
  destination: HostedSessionID,
  agent: ContinuationAgent,
  modeFallback: Schema.Boolean,
}).annotate({ identifier: "SessionHostContinueWorkspaceSession" })
export type ContinueWorkspaceSession = Schema.Schema.Type<typeof ContinueWorkspaceSession>

export const ContinueWorkspaceResult = Schema.Struct({
  workspace: HostedWorkspaceID,
  sessions: Schema.Array(ContinueWorkspaceSession),
  active: HostedSessionID,
  url: Schema.String,
  replayed: Schema.Boolean,
}).annotate({ identifier: "SessionHostContinueWorkspaceResult" })
export type ContinueWorkspaceResult = Schema.Schema.Type<typeof ContinueWorkspaceResult>

/**
 * The exact Cloud request body (`continueHostedWorkspace`) that the CLI stores
 * as `prepared_json` before any dispatch. It is validated once and posted
 * verbatim on every retry.
 */
export const ProviderContinueWorkspaceInput = Schema.Struct({
  operationKey: Schema.String.check(Schema.isUUID()),
  clientProvenance: Schema.Literal("agent-manager"),
  repository: Repository,
  activeSourceKiloSessionId: Schema.String.check(Schema.isMinLength(1)),
  sessions: Schema.Array(
    Schema.Struct({
      sourceKiloSessionId: Schema.String.check(Schema.isMinLength(1)),
      agent: ContinuationAgent,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_CONTINUE_SESSIONS)),
}).annotate({ identifier: "SessionHostProviderContinueWorkspaceInput" })
export type ProviderContinueWorkspaceInput = Schema.Schema.Type<typeof ProviderContinueWorkspaceInput>

export const ProviderContinueWorkspaceResult = Schema.Struct({
  workspace: HostedWorkspaceID,
  sessions: Schema.Array(ContinueWorkspaceSession),
  active: HostedSessionID,
  replayed: Schema.Boolean,
}).annotate({ identifier: "SessionHostProviderContinueWorkspaceResult" })
export type ProviderContinueWorkspaceResult = Schema.Schema.Type<typeof ProviderContinueWorkspaceResult>

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
  readonly getWorkspacePullRequest?: (
    input: WorkspacePullRequestInput,
  ) => Effect.Effect<WorkspacePullRequestResult, HostedFailure>
  readonly refreshWorkspacePullRequest?: (
    input: WorkspacePullRequestInput,
  ) => Effect.Effect<WorkspacePullRequestResult, HostedFailure>
  /** Reads the saved workspace change snapshot without waking compute. */
  readonly getWorkspaceChanges: (input: WorkspaceChangesInput) => Effect.Effect<WorkspaceChanges, HostedFailure>
  /** Explicitly refreshes the snapshot; offline/failed keeps the previous one. */
  readonly refreshWorkspaceChanges: (
    input: WorkspaceChangesInput,
  ) => Effect.Effect<WorkspaceChangesRefresh, HostedFailure>
  /** Reads one captured file, fenced by the snapshot revision. */
  readonly getWorkspaceChangeFile: (
    input: WorkspaceChangeFileInput,
  ) => Effect.Effect<WorkspaceChangeFileResult, HostedFailure>
  /** Reads the verified linked PR and its published file comparison. */
  readonly getWorkspacePullRequestDiff: (
    input: WorkspacePullRequestDiffInput,
  ) => Effect.Effect<WorkspacePullRequestDiff, HostedFailure>
  /** Reads one PR patch, fenced by the verified head. */
  readonly getWorkspacePullRequestDiffFile: (
    input: WorkspacePullRequestDiffFileInput,
  ) => Effect.Effect<WorkspacePullRequestDiffFileResult, HostedFailure>
  readonly deleteWorkspace: (input: WorkspaceDeleteInput) => Effect.Effect<DeleteWorkspaceResult, HostedFailure>
  readonly createWorkspace: (input: CreateWorkspaceInput) => Effect.Effect<CreateWorkspaceResult, HostedFailure>
  /**
   * Copy local root sessions into one hosted workspace. The input is the exact
   * Cloud body; the provider validates it, resolves auth without an
   * organization, posts it unchanged, and maps the response source order.
   * `opts.token` pins the dispatch bearer to the credential that already read
   * the principal, so identity and dispatch never resolve different tokens.
   */
  readonly continueWorkspace: (
    input: ProviderContinueWorkspaceInput,
    opts?: { readonly token?: Redacted.Redacted },
  ) => Effect.Effect<ProviderContinueWorkspaceResult, HostedFailure>
  readonly startWorkspaceSession: (
    input: WorkspaceSessionStartInput,
  ) => Effect.Effect<WorkspaceSessionStartResult, HostedFailure>
  readonly listWorkspaceProfiles: (
    input?: WorkspaceProfileListInput,
  ) => Effect.Effect<WorkspaceProfilePage, HostedFailure>
  /** Sets the authenticated user's personal default workspace profile. */
  readonly setWorkspacePersonalDefaultProfile: (
    input: WorkspaceProfileDefaultInput,
  ) => Effect.Effect<WorkspaceProfileDefaultResult, HostedFailure>
  /** Clears the authenticated user's personal default workspace profile. */
  readonly clearWorkspacePersonalDefaultProfile: (
    input: WorkspaceProfileDefaultInput,
  ) => Effect.Effect<WorkspaceProfileDefaultResult, HostedFailure>
  /**
   * Provider-owned request mapping for the proven native allowlist. Provider
   * origin, credentials, control identities, selectors, and fences stay inside
   * the implementation. Omitted by providers without native routing.
   */
  readonly route?: (input: NativeRequest) => Effect.Effect<Response, HostedFailure>
}
