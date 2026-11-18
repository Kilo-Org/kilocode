export * as KiloAgentManagerRpc from "./agent-manager.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionID } from "../session-id.js"

// The `kilocode.agent-manager` RPC contract: Agent Manager orchestration between a session and the VS Code extension.
// The Agent Manager plugin in packages/kilo-plugin registers the handlers; clients import this contract from
// `@opencode/schema/kilocode/agent-manager`.
const portable = Schema.toStandardSchemaV1

const ID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500))
const Prompt = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000))

export const RequestID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({
  identifier: "AgentManagerRequestID",
})
export type RequestID = Schema.Schema.Type<typeof RequestID>

export const Activity = Schema.Literals(["idle", "busy", "retry", "offline"]).annotate({
  identifier: "AgentManagerActivity",
})
export type Activity = Schema.Schema.Type<typeof Activity>

export const FilterState = Schema.Literals(["idle", "busy", "retry", "offline", "waiting"]).annotate({
  identifier: "AgentManagerFilterState",
})

export const Filter = Schema.Struct({
  sectionIDs: optional(Schema.Array(ID).check(Schema.isMaxLength(100))),
  states: optional(Schema.Array(FilterState).check(Schema.isMaxLength(5))),
}).annotate({ identifier: "AgentManagerOverviewFilter" })
export type Filter = Schema.Schema.Type<typeof Filter>

export const Attention = Schema.Array(Schema.Literals(["permission", "question"]))
  .check(Schema.isMaxLength(2))
  .annotate({ identifier: "AgentManagerAttention" })

export const SessionSummary = Schema.Struct({
  id: SessionID,
  name: Name,
  activity: Activity,
  attention: optional(Attention),
}).annotate({ identifier: "AgentManagerSessionSummary" })
export type SessionSummary = Schema.Schema.Type<typeof SessionSummary>

export const GitSummary = Schema.Struct({
  additions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  deletions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ahead: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  behind: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "AgentManagerGitSummary" })

export const PullRequestSummary = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  state: Schema.Literals(["open", "draft", "merged", "closed"]),
  checks: Schema.Literals(["success", "failure", "pending", "none"]),
  review: optional(Schema.Literals(["approved", "changes_requested", "pending"])),
  unresolvedComments: optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).annotate({ identifier: "AgentManagerPullRequestSummary" })

export const WorktreeSummary = Schema.Struct({
  id: ID,
  name: Name,
  branch: Name,
  session: optional(SessionSummary),
  sessions: optional(Schema.Array(SessionSummary).check(Schema.isMinLength(2), Schema.isMaxLength(100))),
  git: optional(GitSummary),
  pullRequest: optional(PullRequestSummary),
}).annotate({ identifier: "AgentManagerWorktreeSummary" })
export type WorktreeSummary = Schema.Schema.Type<typeof WorktreeSummary>

export const SectionSummary = Schema.Struct({
  id: ID,
  name: Name,
  worktrees: Schema.Array(WorktreeSummary).check(Schema.isMaxLength(100)),
}).annotate({ identifier: "AgentManagerSectionSummary" })

export const LocalSummary = Schema.Struct({
  branch: optional(Name),
  sessions: Schema.Array(SessionSummary).check(Schema.isMaxLength(100)),
  git: optional(GitSummary),
}).annotate({ identifier: "AgentManagerLocalSummary" })

export const Overview = Schema.Struct({
  sections: Schema.Array(SectionSummary).check(Schema.isMaxLength(100)),
  ungrouped: Schema.Array(WorktreeSummary).check(Schema.isMaxLength(100)),
  local: optional(LocalSummary),
}).annotate({ identifier: "AgentManagerOverview" })
export type Overview = Schema.Schema.Type<typeof Overview>

const Base = { id: RequestID, sessionID: SessionID }

export const OverviewRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("overview"),
  filter: optional(Filter),
}).annotate({ identifier: "AgentManagerOverviewRequest" })

export const PromptRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("prompt"),
  targetSessionID: SessionID,
  sourceSessionID: optional(SessionID),
  prompt: Prompt,
  replyTo: optional(RequestID),
}).annotate({ identifier: "AgentManagerPromptRequest" })

export const StopRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("stop"),
  targetSessionID: SessionID,
}).annotate({ identifier: "AgentManagerStopRequest" })

export const MoveRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("move"),
  targetSessionID: SessionID,
  sectionID: Schema.NullOr(ID),
}).annotate({ identifier: "AgentManagerMoveRequest" })

const AnswerLabel = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
const AnswerArray = Schema.Array(AnswerLabel).check(Schema.isMaxLength(20))
export const Answers = Schema.Array(AnswerArray)
  .check(Schema.isMinLength(1), Schema.isMaxLength(20))
  .annotate({ identifier: "AgentManagerAnswers" })

export const AnswerRequest = Schema.Struct({
  ...Base,
  operation: Schema.Literal("answer"),
  targetSessionID: SessionID,
  questionID: optional(ID),
  answers: Answers,
}).annotate({ identifier: "AgentManagerAnswerRequest" })

export const Request = Schema.Union([OverviewRequest, PromptRequest, StopRequest, MoveRequest, AnswerRequest]).annotate({
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

export const MoveResult = Schema.Struct({
  operation: Schema.Literal("move"),
  sessionID: SessionID,
  sectionID: Schema.NullOr(ID),
  moved: Schema.Literal(true),
}).annotate({ identifier: "AgentManagerMoveResult" })

export const AnswerResult = Schema.Struct({
  operation: Schema.Literal("answer"),
  sessionID: SessionID,
  questionID: ID,
  resolved: Schema.Literal(true),
}).annotate({ identifier: "AgentManagerAnswerResult" })

export const Result = Schema.Union([OverviewResult, PromptResult, StopResult, MoveResult, AnswerResult]).annotate({
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
  "unknown_section",
  "unknown_session",
  "workspace_unavailable",
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export const Failure = Schema.Struct({
  code: ErrorCode,
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
}).annotate({ identifier: "AgentManagerFailure" })
export type Failure = Schema.Schema.Type<typeof Failure>

export const Cancelled = Schema.Struct({
  requestID: RequestID,
  sessionID: SessionID,
  reason: Schema.Literals(["cancelled", "disposed", "timeout"]),
}).annotate({ identifier: "AgentManagerCancelled" })
export type Cancelled = Schema.Schema.Type<typeof Cancelled>

export const Task = Schema.Struct({
  prompt: optional(Schema.String.annotate({ description: "Initial prompt to send to the new session" })),
  name: optional(Schema.String.annotate({ description: "Short display name for the Agent Manager card" })),
  branchName: optional(Schema.String.annotate({ description: "Git branch name seed for worktree mode" })),
  baseBranch: optional(
    Schema.String.annotate({
      description: "Existing branch a worktree starts from. Omit to use the configured or repository default branch.",
    }),
  ),
  agent: optional(
    Schema.String.annotate({
      description: "Primary agent to run the new session as. Omit to use the workspace default agent.",
    }),
  ),
  model: optional(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }),
  ),
  variant: optional(Schema.String),
})
export type Task = Schema.Schema.Type<typeof Task>

export const Mode = Schema.Literals(["worktree", "local"])

export const Start = Schema.Struct({
  requestID: Schema.String,
  sessionID: SessionID,
  mode: Mode,
  worktreeID: optional(Schema.String),
  versions: optional(Schema.Boolean),
  tasks: Schema.Array(Task).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
}).annotate({ identifier: "AgentManagerStart" })
export type Start = Schema.Schema.Type<typeof Start>

export const Definition = Rpc.define({
  id: "kilocode.agent-manager",
  methods: {
    /** Pending requests of the location, for reconnect recovery. */
    list: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(Request)),
      errors: {},
    },
    /** Completes a pending request with the extension's result. */
    reply: {
      input: portable(Schema.Struct({ requestID: RequestID, result: Result })),
      output: portable(Schema.Struct({})),
      errors: {
        not_found: portable(Schema.Undefined),
        invalid_reply: portable(Schema.Undefined),
      },
    },
    /** Completes a pending request with the extension's structured failure. */
    reject: {
      input: portable(Schema.Struct({ requestID: RequestID, error: Failure })),
      output: portable(Schema.Struct({})),
      errors: {
        not_found: portable(Schema.Undefined),
      },
    },
    /** Removes the snapshot repository of a managed worktree that is already gone. */
    removeSnapshot: {
      input: portable(Schema.Struct({ worktree: Schema.String })),
      output: portable(Schema.Struct({ removed: Schema.Boolean })),
      errors: {
        invalid_worktree: portable(Schema.Undefined),
      },
    },
  },
  events: {
    /** A tool call asked Agent Manager to start sessions. */
    start: { schema: portable(Start) },
    /** A tool call is waiting for the extension to answer. */
    requested: { schema: portable(Request) },
    /** A pending request ended without a reply. */
    cancelled: { schema: portable(Cancelled) },
  },
})
