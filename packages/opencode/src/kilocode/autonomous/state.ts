import { Schema, type Types } from "effect"
import { SessionID } from "@/session/schema"
import { NonNegativeInt, optionalOmitUndefined } from "@opencode-ai/core/schema"

/** Persisted state of one autonomous goal. Every transition writes the whole document. */
export namespace AutonomousState {
  export const ModelClass = Schema.Literals(["local-small", "local-coder", "cloud-reasoner"])
  export type ModelClass = typeof ModelClass.Type

  export const GoalStatus = Schema.Literals([
    "planning",
    "running",
    "paused",
    "blocked",
    "reviewing",
    "completed",
    "failed",
  ])
  export type GoalStatus = typeof GoalStatus.Type

  export const TaskStatus = Schema.Literals([
    "pending",
    "ready",
    "running",
    "verifying",
    "repairing",
    "blocked",
    "completed",
    "failed",
  ])
  export type TaskStatus = typeof TaskStatus.Type

  export const TaskType = Schema.Literals(["research", "implementation", "test", "review", "repair", "verification"])
  export type TaskType = typeof TaskType.Type

  export const Complexity = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 4 }))

  export const Criterion = Schema.Struct({
    id: Schema.String,
    description: Schema.String,
    status: Schema.Literals(["open", "satisfied", "unsatisfied"]),
    evidence: optionalOmitUndefined(Schema.String),
    reason: optionalOmitUndefined(Schema.String),
  })
  export type Criterion = Types.DeepMutable<typeof Criterion.Type>

  export const Risk = Schema.Struct({
    security: optionalOmitUndefined(Schema.Boolean),
    auth: optionalOmitUndefined(Schema.Boolean),
    schema: optionalOmitUndefined(Schema.Boolean),
    infra: optionalOmitUndefined(Schema.Boolean),
  })
  export type Risk = Types.DeepMutable<typeof Risk.Type>

  export const Finding = Schema.Struct({
    id: Schema.String,
    taskID: optionalOmitUndefined(Schema.String),
    type: Schema.String,
    file: optionalOmitUndefined(Schema.String),
    description: Schema.String,
    blocking: Schema.Boolean,
    resolved: Schema.Boolean,
  })
  export type Finding = Types.DeepMutable<typeof Finding.Type>

  export const Result = Schema.Struct({
    status: Schema.Literals(["completed", "blocked"]),
    summary: Schema.String,
    changedFiles: Schema.Array(Schema.String),
    assumptions: Schema.Array(Schema.String),
    unresolved: Schema.Array(Schema.String),
    confidence: optionalOmitUndefined(Schema.Number),
  })
  export type Result = Types.DeepMutable<typeof Result.Type>

  /** `worker` = the worker run errored; `blocked` = the worker deliberately reported the task as blocked. */
  export const Stage = Schema.Literals(["worker", "blocked", "check", "review", "escalation"])
  export type Stage = typeof Stage.Type

  export const Failure = Schema.Struct({
    attempt: NonNegativeInt,
    stage: Stage,
    fingerprint: Schema.String,
    message: Schema.String,
    /** Class of the model that produced the failure (a review failure is attributed to the reviewer's class). */
    modelClass: ModelClass,
    /** Class that implemented the attempt, for routing history. */
    routed: optionalOmitUndefined(ModelClass),
  })
  export type Failure = Types.DeepMutable<typeof Failure.Type>

  export const Route = Schema.Struct({
    modelClass: ModelClass,
    model: Schema.String,
    reason: Schema.String,
  })
  export type Route = Types.DeepMutable<typeof Route.Type>

  export const Task = Schema.Struct({
    id: Schema.String,
    /** Class that ran the first attempt; routing history is keyed by it. */
    first: optionalOmitUndefined(ModelClass),
    title: Schema.String,
    description: Schema.String,
    type: TaskType,
    status: TaskStatus,
    complexity: Complexity,
    dependsOn: Schema.Array(Schema.String),
    relevantFiles: Schema.Array(Schema.String),
    acceptanceCriteria: Schema.Array(Schema.String),
    risk: Risk,
    preferredModelClass: ModelClass,
    attempts: NonNegativeInt,
    maxAttempts: NonNegativeInt,
    escalated: Schema.Boolean,
    failures: Schema.Array(Failure),
    result: optionalOmitUndefined(Result),
    route: optionalOmitUndefined(Route),
  })
  export type Task = Types.DeepMutable<typeof Task.Type>

  export const Usage = Schema.Struct({
    cost: Schema.Number,
    calls: NonNegativeInt,
    input: NonNegativeInt,
    output: NonNegativeInt,
  })
  export type Usage = Types.DeepMutable<typeof Usage.Type>

  export const Budget = Schema.Struct({
    cloud: Usage,
    local: Usage,
    perTask: Schema.Record(Schema.String, Usage),
  })
  export type Budget = Types.DeepMutable<typeof Budget.Type>

  export const Event = Schema.Struct({
    time: NonNegativeInt,
    event: Schema.String,
    taskID: optionalOmitUndefined(Schema.String),
    detail: optionalOmitUndefined(Schema.String),
  })
  export type Event = Types.DeepMutable<typeof Event.Type>

  export const Final = Schema.Struct({
    checks: Schema.Boolean,
    review: Schema.Boolean,
    modelClass: ModelClass,
    summary: Schema.String,
    time: NonNegativeInt,
  })
  export type Final = Types.DeepMutable<typeof Final.Type>

  export const Info = Schema.Struct({
    version: Schema.Literal(1),
    sessionID: SessionID,
    objective: Schema.String,
    status: GoalStatus,
    reason: optionalOmitUndefined(Schema.String),
    created: NonNegativeInt,
    updated: NonNegativeInt,
    summary: optionalOmitUndefined(Schema.String),
    criteria: Schema.Array(Criterion),
    tasks: Schema.Array(Task),
    findings: Schema.Array(Finding),
    revision: NonNegativeInt,
    escalations: NonNegativeInt,
    budget: Budget,
    events: Schema.Array(Event),
    final: optionalOmitUndefined(Final),
  }).annotate({ identifier: "AutonomousGoalState" })
  export type Info = Types.DeepMutable<typeof Info.Type>

  const decoder = Schema.decodeUnknownSync(Info)
  export const decode = (raw: unknown): Info => decoder(raw) as Info
  export const encode = Schema.encodeSync(Info)

  export const usage = (): Usage => ({ cost: 0, calls: 0, input: 0, output: 0 })

  export function create(input: { sessionID: SessionID; objective: string; now?: number }): Info {
    const now = input.now ?? Date.now()
    return {
      version: 1,
      sessionID: input.sessionID,
      objective: input.objective,
      status: "planning",
      created: now,
      updated: now,
      criteria: [],
      tasks: [],
      findings: [],
      revision: 0,
      escalations: 0,
      budget: { cloud: usage(), local: usage(), perTask: {} },
      events: [],
    }
  }

  export function task(state: Info, id: string) {
    return state.tasks.find((t) => t.id === id)
  }

  export const terminal = (status: GoalStatus) => status === "completed" || status === "failed"
  export const active = (status: GoalStatus) => status === "planning" || status === "running" || status === "reviewing"
}
