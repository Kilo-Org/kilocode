export * as KiloFlowRpc from "./flow.js"

import { Schema } from "effect"
import { Agent } from "../agent.js"
import { ascending } from "../identifier.js"
import { Model } from "../model.js"
import { Permission } from "../permission.js"
import { Project } from "../project.js"
import { Rpc } from "../rpc.js"
import { Schedule } from "../schedule.js"
import { AbsolutePath, optional, statics } from "../schema.js"
import { SessionID } from "../session-id.js"

const portable = Schema.toStandardSchemaV1

export const ID = Schema.String.check(Schema.isStartingWith("flw_")).pipe(
  Schema.brand("KiloFlow.ID"),
  Schema.annotate({ identifier: "KiloFlow.ID" }),
  statics((schema) => ({ create: () => schema.make(`flw_${ascending()}`) })),
)
export type ID = typeof ID.Type

export const RunID = Schema.String.check(Schema.isStartingWith("flr_")).pipe(
  Schema.brand("KiloFlow.RunID"),
  Schema.annotate({ identifier: "KiloFlow.RunID" }),
  statics((schema) => ({ create: () => schema.make(`flr_${ascending()}`) })),
)
export type RunID = typeof RunID.Type

export const Authority = Schema.Struct({ type: Schema.tag("local") }).annotate({ identifier: "KiloFlow.Authority" })
export type Authority = typeof Authority.Type

export const TimeTrigger = Schema.Struct({
  type: Schema.tag("time"),
  when: Schedule.When,
  timezone: Schema.String,
}).annotate({ identifier: "KiloFlow.Trigger.Time" })

export const PollTrigger = Schema.Struct({
  type: Schema.tag("poll"),
  when: Schedule.When,
  timezone: Schema.String,
  mode: Schedule.CheckMode,
  condition: Schedule.Condition,
}).annotate({ identifier: "KiloFlow.Trigger.Poll" })

export const Trigger = Schema.Union([TimeTrigger, PollTrigger]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "KiloFlow.Trigger" }),
)
export type Trigger = typeof Trigger.Type

export const SessionExecution = Schema.Struct({
  type: Schema.tag("local"),
  mode: Schema.tag("session-reuse"),
  sessionID: SessionID.pipe(optional),
}).annotate({ identifier: "KiloFlow.Execution.SessionReuse" })

export const FreshExecution = Schema.Struct({
  type: Schema.tag("local"),
  mode: Schema.tag("fresh"),
  sourceSessionID: SessionID,
  templateSessionID: SessionID.pipe(optional),
  worktree: Schema.Literals(["reuse", "new"]),
}).annotate({ identifier: "KiloFlow.Execution.Fresh" })

export const Execution = Schema.Union([SessionExecution, FreshExecution]).pipe(
  Schema.toTaggedUnion("mode"),
  Schema.annotate({ identifier: "KiloFlow.Execution" }),
)
export type Execution = typeof Execution.Type

export const Context = Schema.Struct({
  directory: AbsolutePath.pipe(optional),
  projectID: Project.ID.pipe(optional),
  sessionID: SessionID.pipe(optional),
  model: Model.Ref.pipe(optional),
  agent: Agent.ID.pipe(optional),
}).annotate({ identifier: "KiloFlow.Context" })
export type Context = typeof Context.Type

export const PermissionGrant = Schema.Struct({
  action: Permission.Rule.fields.action,
  resource: Permission.Rule.fields.resource,
}).annotate({ identifier: "KiloFlow.PermissionGrant" })
export type PermissionGrant = typeof PermissionGrant.Type

export const ManagedReference = Schema.Struct({
  type: Schema.tag("managed"),
  flowID: ID,
  scheduleID: Schedule.ID.pipe(optional),
}).annotate({ identifier: "KiloFlow.Reference.Managed" })

export const NativeScheduleReference = Schema.Struct({
  type: Schema.tag("native-schedule"),
  scheduleID: Schedule.ID,
}).annotate({ identifier: "KiloFlow.Reference.NativeSchedule" })

export const Reference = Schema.Union([ManagedReference, NativeScheduleReference]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "KiloFlow.Reference" }),
)
export type Reference = typeof Reference.Type

export const Health = Schema.Union([
  Schema.Struct({ status: Schema.tag("healthy") }),
  Schema.Struct({ status: Schema.tag("error"), message: Schema.String }),
]).pipe(Schema.toTaggedUnion("status"), Schema.annotate({ identifier: "KiloFlow.Health" }))
export type Health = typeof Health.Type

export const Status = Schema.Literals(["active", "paused", "completed", "error"]).annotate({
  identifier: "KiloFlow.Status",
})
export type Status = typeof Status.Type

export const RunStatus = Schema.Literals([
  "starting",
  "running",
  "succeeded",
  "failed",
  "interrupted",
  "skipped",
]).annotate({ identifier: "KiloFlow.RunStatus" })
export type RunStatus = typeof RunStatus.Type

export const ScheduledOccurrence = Schema.Struct({
  scheduleID: Schedule.ID,
  dueAt: Schema.Finite,
}).annotate({ identifier: "KiloFlow.ScheduledOccurrence" })
export type ScheduledOccurrence = typeof ScheduledOccurrence.Type

/** Durable execution record stored under `flow-run:v1:<flowID>:<runID>`. */
export const Run = Schema.Struct({
  version: Schema.Literal(1),
  id: RunID,
  flowID: ID,
  status: RunStatus,
  worktree: Schema.Literals(["reuse", "new"]),
  sessionID: SessionID.pipe(optional),
  directory: AbsolutePath.pipe(optional),
  scheduled: ScheduledOccurrence.pipe(optional),
  error: Schema.String.pipe(optional),
  time: Schema.Struct({
    created: Schema.Finite,
    updated: Schema.Finite,
    started: Schema.Finite.pipe(optional),
    completed: Schema.Finite.pipe(optional),
  }),
}).annotate({ identifier: "KiloFlow.Run.V1" })
export type Run = typeof Run.Type

export const Outcome = Schema.Union([Schedule.Outcome, Schema.Literals(["succeeded", "interrupted"])]).annotate({
  identifier: "KiloFlow.Outcome",
})
export type Outcome = typeof Outcome.Type

export const Info = Schema.Struct({
  reference: Reference,
  name: Schema.String,
  authority: Authority,
  trigger: Trigger,
  execution: Execution,
  context: Context,
  prompt: Schema.String,
  permissions: Schema.Array(PermissionGrant).pipe(optional),
  status: Status,
  nextRunAt: Schema.Finite.pipe(optional),
  lastRunAt: Schema.Finite.pipe(optional),
  lastOutcome: Outcome.pipe(optional),
  latestRun: Run.pipe(optional),
  health: Health,
  time: Schema.Struct({ created: Schema.Finite, updated: Schema.Finite }),
}).annotate({ identifier: "KiloFlow.Info" })
export type Info = typeof Info.Type

/** Durable Kilo-owned definition stored under `flow:v1:<flowID>`. */
export const Record = Schema.Struct({
  version: Schema.Literal(1),
  id: ID,
  name: Schema.String,
  authority: Authority,
  trigger: Trigger,
  execution: FreshExecution,
  context: Context,
  prompt: Schema.String,
  permissions: Schema.Array(PermissionGrant).pipe(optional),
  scheduleID: Schedule.ID.pipe(optional),
  time: Schema.Struct({ created: Schema.Finite, updated: Schema.Finite }),
}).annotate({ identifier: "KiloFlow.Record.V1" })
export type Record = typeof Record.Type

const CreateFields = {
  name: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "Short name shown in Flow inventories." }),
  when: Schedule.WhenInput.annotate({ description: "Time trigger for the Flow." }),
  prompt: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Prompt each fresh local Session will run.",
  }),
  worktree: Schema.Literals(["reuse", "new"]).annotate({
    description: "Reuse the source directory or create a new worktree for each run.",
  }),
  permissions: Schema.Array(PermissionGrant).annotate({
    description:
      "Derive the complete minimum unattended allowlist from the Flow prompt before creation. Resources are wildcard patterns matched against actual tool requests, not descriptions of intent. Use shell for every command a run may invoke, including helper commands; prefer a bounded executable family such as `git *` when flags or working-directory arguments may vary, and avoid unrestricted `shell: *`. Use edit for file writes and read for reads. Paths outside the Flow directory additionally need external_directory with a directory wildcard such as `/home/user/*`; an exact directory path does not cover its contents. Include other tool actions the prompt requires. The user reviews this exact list before creation, and the executor receives it as a constraint. Use an empty array only when the prompt needs no tools.",
  }),
  model: Model.Ref.pipe(optional).annotate({ description: "Model override. Defaults to the source Session model." }),
  agent: Agent.ID.pipe(optional).annotate({ description: "Agent override. Defaults to the source Session agent." }),
}

/** The fields exposed by the agent tool, which supplies its own Session ID. */
export const CreateRequest = Schema.Struct(CreateFields).annotate({ identifier: "KiloFlow.CreateRequest" })
export type CreateRequest = typeof CreateRequest.Type

export const CreateInput = Schema.Struct({
  sourceSessionID: SessionID,
  ...CreateFields,
}).annotate({ identifier: "KiloFlow.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const RunInput = Schema.Struct({ flowID: ID }).annotate({ identifier: "KiloFlow.RunInput" })
export type RunInput = typeof RunInput.Type

export const Warning = Schema.Struct({
  source: Schema.Literals(["managed", "managed-run", "native-schedule"]),
  reference: Schema.String.pipe(optional),
  message: Schema.String,
}).annotate({ identifier: "KiloFlow.Warning" })
export type Warning = typeof Warning.Type

export const ListOutput = Schema.Struct({
  flows: Schema.Array(Info),
  warnings: Schema.Array(Warning),
  observedAt: Schema.Finite,
}).annotate({ identifier: "KiloFlow.ListOutput" })
export type ListOutput = typeof ListOutput.Type

export const Definition = Rpc.define({
  id: "kilocode.flow",
  methods: {
    list: {
      input: portable(Schema.Struct({})),
      output: portable(ListOutput),
      errors: { failed: portable(Schema.Undefined) },
      description:
        "Experimental: may change without compatibility guarantees. Lists local Flow definitions and schedules.",
    },
    create: {
      input: portable(CreateInput),
      output: portable(Info),
      errors: { failed: portable(Schema.Undefined) },
      description:
        "Experimental: may change without compatibility guarantees. Creates a local managed Flow definition.",
    },
    run: {
      input: portable(RunInput),
      output: portable(Run),
      errors: { failed: portable(Schema.Undefined) },
      description:
        "Experimental: may change without compatibility guarantees. Starts one fresh local execution of a managed Flow.",
    },
  },
  events: {},
})
