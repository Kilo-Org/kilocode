import { SessionID } from "@opencode/schema/session-id"
import { Schema } from "effect"

const Task = Schema.Struct({
  prompt: Schema.optional(
    Schema.NullOr(Schema.String).annotate({ description: "Initial prompt to send to the new session" }),
  ),
  name: Schema.optional(Schema.NullOr(Schema.String).annotate({ description: "Short display name for the Agent Manager card" })),
  branchName: Schema.optional(
    Schema.NullOr(Schema.String).annotate({ description: "Git branch name seed for worktree mode" }),
  ),
  baseBranch: Schema.optional(
    Schema.NullOr(Schema.String).annotate({
      description:
        "Existing branch that the new worktree starts from, like the base branch in the New Worktree dialog. Use the branch name without a remote prefix, for example 'main' or 'release/1.0'. Worktree mode only. Omit to use the configured default base branch or the repository default branch.",
    }),
  ),
  agent: Schema.optional(
    Schema.NullOr(Schema.String).annotate({
      description:
        "Optional agent name to run the new session as (e.g. a custom agent configured with mode 'all'). Must be a selectable primary agent: not a mode: 'subagent' agent and not an internal/hidden one. Omit to use the workspace default agent; prefer the name the user asked for. A rejected name lists the selectable agents.",
    }),
  ),
  model: Schema.optional(
    Schema.NullOr(Schema.String).annotate({
      description:
        "Optional model override from agent_manager_models (e.g. 'Claude Opus 4.1'). Omit unless the user requests a different model. Agent Manager otherwise inherits the current turn's model. A qualified provider/model ID is also accepted to force a specific provider.",
    }),
  ),
  provider: Schema.optional(
    Schema.NullOr(Schema.String).annotate({
      description:
        "Optional provider ID to constrain model resolution (e.g. 'anthropic'). Use with model to select a model from a specific provider; omit to use the current-turn provider preference.",
    }),
  ),
  variant: Schema.optional(
    Schema.NullOr(Schema.String).annotate({
      description:
        "Optional reasoning variant override from agent_manager_models. Specify it without model to override the inherited model's variant. Omit both to inherit the current turn's selection.",
    }),
  ),
}).check(
  Schema.makeFilter((task) =>
    task.prompt?.trim() || task.name?.trim() || task.branchName?.trim()
      ? undefined
      : "Each task must include prompt, name, or branchName",
  ),
  Schema.makeFilter((task) =>
    task.model?.trim() && !task.prompt?.trim() ? "A task model requires an initial prompt" : undefined,
  ),
  Schema.makeFilter((task) =>
    task.provider?.trim() && !task.model?.trim() ? "A task provider requires a model" : undefined,
  ),
  Schema.makeFilter((task) =>
    task.variant?.trim() && !task.prompt?.trim() ? "A task variant requires an initial prompt" : undefined,
  ),
)

const Mode = Schema.Literals(["worktree", "local"])

const WorktreeID = Schema.String.check(
  Schema.makeFilter((value: string) => (value.trim() ? undefined : "worktreeID must not be blank")),
)

const Start = Schema.Struct({
  mode: Mode.annotate({
    description: "Use worktree for isolated git worktrees, or local for same-directory Agent Manager sessions",
  }),
  versions: Schema.optional(
    Schema.NullOr(Schema.Boolean).annotate({
      description:
        "Set true only when tasks are alternative versions of the same work to compare. Omit or false for independent sessions.",
    }),
  ),
  worktreeID: Schema.optional(
    Schema.NullOr(WorktreeID).annotate({
      description:
        "Start sessions only. Existing managed worktree ID returned by action=list in the caller's project. Requires mode local; omit or null to use the caller's directory. Never use a path or branch name.",
    }),
  ),
  tasks: Schema.Array(Task)
    .check(Schema.isMinLength(1), Schema.isMaxLength(20))
    .annotate({ description: "Agent Manager sessions to start" }),
})

const Filter = Schema.Struct({
  sectionIDs: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(100))),
  states: Schema.optional(
    Schema.Array(Schema.Literals(["idle", "busy", "retry", "offline", "waiting"])).check(Schema.isMaxLength(5)),
  ),
})

const List = Schema.Struct({
  action: Schema.Literal("list").annotate({
    description:
      "Read the current Agent Manager sections, worktrees, and sessions before any assignment. This is the source of truth for section and session IDs.",
  }),
  filter: Schema.optional(
    Schema.NullOr(Filter).annotate({
      description: "Optional list filter. Omit this for an unfiltered overview when discovering assignments.",
    }),
  ),
})

const ReplyTo = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).check(
  Schema.makeFilter((value: string) => (value.trim() ? undefined : "replyTo must not be empty")),
)

const Prompt = Schema.Struct({
  action: Schema.Literal("prompt"),
  sessionID: SessionID,
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)).check(
    Schema.makeFilter((value: string) => (value.trim() ? undefined : "Prompt must not be empty")),
  ),
  replyTo: Schema.optional(
    Schema.NullOr(ReplyTo).annotate({
      description:
        "Optional request ID from a peer-agent prompt. Use it only when replying to the session that sent the request.",
    }),
  ),
})

const Stop = Schema.Struct({
  action: Schema.Literal("stop"),
  sessionID: SessionID,
})

const SectionID = Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))

const Move = Schema.Struct({
  action: Schema.Literal("move").annotate({
    description: "Move exactly one managed worktree by targeting one of its session IDs returned by action=list.",
  }),
  sessionID: SessionID.annotate({
    description: "Session ID returned by action=list. Do not use a worktree name, branch, or section name.",
  }),
  sectionID: SectionID.annotate({
    description: "Section ID returned by action=list. Use null to unassign the worktree from its current section.",
  }),
})

const Answers = Schema.Array(
  Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))).check(Schema.isMaxLength(20)),
)
  .check(Schema.isMinLength(1), Schema.isMaxLength(20))
  .annotate({
    description:
      "One array of selected option labels per question of the request, in order. Labels must match the advertised options.",
  })

const Answer = Schema.Struct({
  action: Schema.Literal("answer").annotate({
    description: "Resolve the pending question that blocks exactly one managed session.",
  }),
  sessionID: SessionID,
  questionID: Schema.optional(
    Schema.NullOr(Schema.String).annotate({
      description:
        "Pending question ID, learned from a failed prompt or an earlier answer error. Omit only when exactly one question is pending.",
    }),
  ),
  answers: Answers,
})

const Action = Schema.Literals(["list", "prompt", "stop", "move", "answer"])

export const StartParams = Start
export const TaskParams = Task
export const ModeParams = Mode

export const Params = Schema.Union([
  Schema.Struct({
    ...Start.fields,
    tasks: Schema.Union([Start.fields.tasks, Schema.fromJsonString(Start.fields.tasks)]),
  }).check(
    Schema.makeFilter((params) => {
      const base = params.tasks.some((task) => task.baseBranch?.trim())
      if (params.worktreeID == null) {
        if (base && params.mode !== "worktree")
          return "baseBranch requires mode worktree. Local sessions start in an existing directory and cannot choose a base branch."
        return undefined
      }
      if (params.mode !== "local")
        return `worktreeID ${JSON.stringify(params.worktreeID)} requires mode local. To start a new worktree, omit worktreeID or send JSON null`
      if (params.versions === true) return "worktreeID cannot be combined with versions true"
      if (params.tasks.some((task) => task.branchName != null)) return "worktreeID cannot be combined with branchName"
      if (base) return "worktreeID cannot be combined with baseBranch"
      return undefined
    }),
  ),
  List,
  Prompt,
  Stop,
  Move,
  Answer,
])
export type Params = Schema.Schema.Type<typeof Params>

// Anthropic rejects a top-level anyOf/oneOf/allOf, so the advertised schema stays one flat object while `Params`
// keeps the real per-operation validation. Strict structured outputs require a value for every property, so every
// field is nullable: null says the field is not part of the selected operation.
export const WireParams = Schema.Struct({
  mode: Schema.NullOr(Mode).annotate({
    description:
      "Start sessions only. Use worktree for isolated git worktrees, or local for same-directory Agent Manager sessions. Send null whenever action is set.",
  }),
  versions: Schema.NullOr(Schema.Boolean).annotate({
    description:
      "Set true only when tasks are alternative versions of the same work to compare. Omit or false for independent sessions.",
  }),
  tasks: Schema.NullOr(Start.fields.tasks).annotate({
    description: "Start sessions only. Agent Manager sessions to start. Send null whenever action is set.",
  }),
  worktreeID: Schema.NullOr(WorktreeID),
  action: Schema.NullOr(Action).annotate({
    description:
      "Use list first to discover IDs and assignments. Use move only after list, once per worktree. Never edit .kilo2/agent-manager.json for these operations. Send null when starting sessions with mode and tasks, otherwise the action is used instead of the start request.",
  }),
  filter: Schema.NullOr(Filter),
  sessionID: Schema.NullOr(Schema.String).annotate({
    description:
      "For prompt, stop, move, and answer: a session ID returned by action=list (IDs start with ses_). Send null for every other operation.",
  }),
  prompt: Schema.NullOr(Schema.String).annotate({
    description:
      "For prompt: the instruction to send to that session. Start requests use tasks[].prompt instead, so send null.",
  }),
  replyTo: Schema.NullOr(ReplyTo).annotate({
    description:
      "For prompt replies: the request ID included by Agent Manager in the peer-agent request. Send null otherwise.",
  }),
  sectionID: SectionID,
  questionID: Schema.NullOr(Schema.String),
  answers: Schema.NullOr(Answers),
})

export type WireParams = Schema.Schema.Type<typeof WireParams>
