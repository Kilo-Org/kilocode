import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const RequestID = Schema.String.pipe(Schema.brand("AgentManagerRequestID")).annotate({
  identifier: "AgentManagerRequestID",
})
export type RequestID = Schema.Schema.Type<typeof RequestID>

const ID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500))
const Prompt = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000))

export const Activity = Schema.Literals(["idle", "busy", "retry", "offline"]).annotate({
  identifier: "AgentManagerActivity",
})
export type Activity = Schema.Schema.Type<typeof Activity>

export const FilterState = Schema.Literals(["idle", "busy", "retry", "offline", "waiting"]).annotate({
  identifier: "AgentManagerFilterState",
})

export const Filter = Schema.Struct({
  sectionIDs: Schema.optional(Schema.Array(ID).check(Schema.isMaxLength(100))),
  states: Schema.optional(Schema.Array(FilterState).check(Schema.isMaxLength(5))),
}).annotate({ identifier: "AgentManagerOverviewFilter" })
export type Filter = Schema.Schema.Type<typeof Filter>

export const Attention = Schema.Array(Schema.Literals(["permission", "question"]))
  .check(Schema.isMaxLength(2))
  .annotate({ identifier: "AgentManagerAttention" })

export const Session = Schema.Struct({
  id: SessionID,
  name: Name,
  activity: Activity,
  attention: Schema.optional(Attention),
}).annotate({ identifier: "AgentManagerSessionSummary" })
export type Session = Schema.Schema.Type<typeof Session>

export const Git = Schema.Struct({
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
}).annotate({ identifier: "AgentManagerGitSummary" })

export const PullRequest = Schema.Struct({
  number: NonNegativeInt,
  state: Schema.Literals(["open", "draft", "merged", "closed"]),
  checks: Schema.Literals(["success", "failure", "pending", "none"]),
  review: Schema.optional(Schema.Literals(["approved", "changes_requested", "pending"])),
  unresolvedComments: Schema.optional(NonNegativeInt),
}).annotate({ identifier: "AgentManagerPullRequestSummary" })

export const Worktree = Schema.Struct({
  id: ID,
  name: Name,
  branch: Name,
  session: Schema.optional(Session),
  sessions: Schema.optional(Schema.Array(Session).check(Schema.isMinLength(2), Schema.isMaxLength(100))),
  git: Schema.optional(Git),
  pullRequest: Schema.optional(PullRequest),
}).annotate({ identifier: "AgentManagerWorktreeSummary" })
export type Worktree = Schema.Schema.Type<typeof Worktree>

export const Section = Schema.Struct({
  id: ID,
  name: Name,
  worktrees: Schema.Array(Worktree).check(Schema.isMaxLength(100)),
}).annotate({ identifier: "AgentManagerSectionSummary" })

export const Local = Schema.Struct({
  branch: Schema.optional(Name),
  sessions: Schema.Array(Session).check(Schema.isMaxLength(100)),
  git: Schema.optional(Git),
}).annotate({ identifier: "AgentManagerLocalSummary" })

export const Overview = Schema.Struct({
  sections: Schema.Array(Section).check(Schema.isMaxLength(100)),
  ungrouped: Schema.Array(Worktree).check(Schema.isMaxLength(100)),
  local: Schema.optional(Local),
}).annotate({ identifier: "AgentManagerOverview" })
export type Overview = Schema.Schema.Type<typeof Overview>

const Base = { id: RequestID, sessionID: SessionID }

export const OverviewRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("overview"),
  filter: Schema.optional(Filter),
}).annotate({ identifier: "AgentManagerOverviewRequest" })

export const PromptRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("prompt"),
  targetSessionID: SessionID,
  prompt: Prompt,
}).annotate({ identifier: "AgentManagerPromptRequest" })

export const StopRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("stop"),
  targetSessionID: SessionID,
}).annotate({ identifier: "AgentManagerStopRequest" })

export const Request = Schema.Union([OverviewRequest, PromptRequest, StopRequest]).annotate({
  identifier: "AgentManagerRequest",
})
export type Request = Schema.Schema.Type<typeof Request>

export const OverviewResult = Schema.Struct({
  operation: Schema.Literal("overview"),
  overview: Overview,
}).annotate({ identifier: "AgentManagerOverviewResult" })

export const PromptResult = Schema.Struct({
  operation: Schema.Literal("prompt"),
  sessionID: SessionID,
  delivered: Schema.Literal(true),
}).annotate({ identifier: "AgentManagerPromptResult" })

export const StopResult = Schema.Struct({
  operation: Schema.Literal("stop"),
  sessionID: SessionID,
  stopped: Schema.Literal(true),
}).annotate({ identifier: "AgentManagerStopResult" })

export const Result = Schema.Union([OverviewResult, PromptResult, StopResult]).annotate({
  identifier: "AgentManagerResult",
})
export type Result = Schema.Schema.Type<typeof Result>

export const ErrorCode = Schema.Literals([
  "cancelled",
  "cross_workspace",
  "disconnected",
  "host_error",
  "stale_session",
  "timeout",
  "unavailable_session",
  "unknown_session",
  "workspace_unavailable",
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export const Failure = Schema.Struct({
  code: ErrorCode,
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
}).annotate({ identifier: "AgentManagerFailure" })
export type Failure = Schema.Schema.Type<typeof Failure>

export const Event = {
  Requested: BusEvent.define("kilocode.agent_manager.requested", Request),
  Cancelled: BusEvent.define(
    "kilocode.agent_manager.cancelled",
    Schema.Struct({
      requestID: RequestID,
      sessionID: SessionID,
      reason: Schema.Literals(["cancelled", "disposed", "timeout"]),
    }),
  ),
}
