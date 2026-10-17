// kilocode_change - new file
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Effect, Schema } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Database } from "@opencode-ai/core/database/database"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, SessionID } from "@/session/schema"
import { sql, type SQL } from "drizzle-orm"

export namespace AgentUsage {
  const Tokens = Schema.Struct({
    input: NonNegativeInt,
    output: NonNegativeInt,
    reasoning: NonNegativeInt,
    cache: Schema.Struct({
      read: NonNegativeInt,
      write: NonNegativeInt,
    }),
  })

  export type Tokens = typeof Tokens.Type

  export const Outcome = Schema.Literals(["completed", "cancelled", "errored", "running"])
  export type Outcome = typeof Outcome.Type

  const Model = Schema.Struct({
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
  })

  /**
   * One run is the assistant messages in a single session that share a
   * user-message `parentID` and the same assistant `agent`, anchored by that
   * user message. `id` is the run's first assistant message, which is stable
   * and unique per run so callers can page on `(startedAt, id)`.
   */
  export const Run = Schema.Struct({
    id: MessageID,
    agent: Schema.String,
    sessionID: SessionID,
    rootSessionID: SessionID,
    parentSessionID: Schema.NullOr(SessionID),
    title: Schema.String,
    /** The assistant `mode` persisted at execution time (the agent/mode that produced the run). */
    role: Schema.String,
    model: Model,
    startedAt: NonNegativeInt,
    completedAt: Schema.NullOr(NonNegativeInt),
    activeMs: NonNegativeInt,
    cost: Schema.Finite,
    tokens: Tokens,
    outcome: Outcome,
  })

  export type Run = typeof Run.Type

  export const Summary = Schema.Struct({
    agent: Schema.String,
    runs: NonNegativeInt,
    sessions: NonNegativeInt,
    cost: Schema.Finite,
    activeMs: NonNegativeInt,
    tokens: Tokens,
    /** Runs that ended in an error; user cancellations are counted as `cancelled`, not `errors`. */
    errors: NonNegativeInt,
    lastRunAt: NonNegativeInt,
  })

  export type Summary = typeof Summary.Type

  export type Filter = {
    agent?: string
    from?: number
    to?: number
  }

  type Row = {
    id: MessageID
    agent: string
    sessionID: SessionID
    rootSessionID: SessionID
    parentSessionID: SessionID | null
    title: string
    role: string
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    startedAt: number
    completedAt: number | null
    activeMs: number
    cost: number
    input: number
    output: number
    reasoning: number
    read: number
    write: number
    outcome: Outcome
  }

  type SummaryRow = {
    agent: string
    runs: number
    sessions: number
    cost: number
    activeMs: number
    input: number
    output: number
    reasoning: number
    read: number
    write: number
    errors: number
    lastRunAt: number
  }

  const where = (filter: Filter) => {
    const conditions: SQL[] = []
    if (filter.agent !== undefined) conditions.push(sql`runs.agent = ${filter.agent}`)
    if (filter.from !== undefined) conditions.push(sql`runs.startedAt >= ${filter.from}`)
    if (filter.to !== undefined) conditions.push(sql`runs.startedAt <= ${filter.to}`)
    return conditions.length ? sql` WHERE ${sql.join(conditions, sql` AND `)}` : sql``
  }

  // Project scope is resolved from the routed instance. The `msg`/`usage` CTEs
  // join `session` on `project_id` before touching message/part, and the planner
  // still drives both off the existing indexes: `session_project_idx` for the
  // session lookup, `message_session_time_created_id_idx` for messages, and
  // `part_session_step_finish_idx` for step-finish parts. That is verified by the
  // `EXPLAIN QUERY PLAN` assertion in the test suite, so the whole `part` table is
  // never scanned (which is what `ModelUsage`'s explicit id list guards against).
  //
  // Cost and tokens come from `step-finish` parts only (D4): `message.info.cost`
  // carries propagated subagent cost and would double-count a child run in its
  // parent.
  //
  // `role` is the assistant message's persisted `mode`, the execution-time
  // record the schema exposes alongside `agent`. Compaction summary messages
  // persist `agent`/`mode` = "compaction", so they surface as their own agent.
  const cte = (projectID: ProjectV2.ID) => sql`
    WITH RECURSIVE
    tree(id, root_id) AS (
      SELECT id, id
      FROM session
      WHERE project_id = ${projectID} AND parent_id IS NULL

      UNION ALL

      SELECT child.id, tree.root_id
      FROM session AS child
      JOIN tree ON child.parent_id = tree.id
      WHERE child.project_id = ${projectID}
    ),
    msg AS (
      SELECT
        message.id AS id,
        message.session_id AS sessionID,
        json_extract(message.data, '$.parentID') AS parentID,
        json_extract(message.data, '$.agent') AS agent,
        json_extract(message.data, '$.mode') AS role,
        json_extract(message.data, '$.providerID') AS providerID,
        json_extract(message.data, '$.modelID') AS modelID,
        cast(json_extract(message.data, '$.time.created') AS INTEGER) AS created,
        cast(json_extract(message.data, '$.time.completed') AS INTEGER) AS completed,
        json_extract(message.data, '$.error.name') AS errorName
      FROM message
      JOIN session ON session.id = message.session_id AND session.project_id = ${projectID}
      WHERE json_valid(message.data) AND json_extract(message.data, '$.role') = 'assistant'
    ),
    usage AS (
      SELECT
        part.message_id AS messageID,
        sum(max(0.0, cast(coalesce(json_extract(part.data, '$.cost'), 0) AS REAL))) AS cost,
        sum(max(0, cast(coalesce(json_extract(part.data, '$.tokens.input'), 0) AS INTEGER))) AS input,
        sum(max(0, cast(coalesce(json_extract(part.data, '$.tokens.output'), 0) AS INTEGER))) AS output,
        sum(max(0, cast(coalesce(json_extract(part.data, '$.tokens.reasoning'), 0) AS INTEGER))) AS reasoning,
        sum(max(0, cast(coalesce(json_extract(part.data, '$.tokens.cache.read'), 0) AS INTEGER))) AS read,
        sum(max(0, cast(coalesce(json_extract(part.data, '$.tokens.cache.write'), 0) AS INTEGER))) AS write
      FROM part
      JOIN session ON session.id = part.session_id AND session.project_id = ${projectID}
      WHERE json_valid(part.data) AND json_extract(part.data, '$.type') = 'step-finish'
      GROUP BY part.message_id
    ),
    perMessage AS (
      SELECT
        msg.id AS id,
        msg.sessionID AS sessionID,
        msg.parentID AS parentID,
        msg.agent AS agent,
        msg.role AS role,
        msg.providerID AS providerID,
        msg.modelID AS modelID,
        msg.created AS created,
        msg.completed AS completed,
        msg.errorName AS errorName,
        coalesce(usage.cost, 0) AS cost,
        coalesce(usage.input, 0) AS input,
        coalesce(usage.output, 0) AS output,
        coalesce(usage.reasoning, 0) AS reasoning,
        coalesce(usage.read, 0) AS read,
        coalesce(usage.write, 0) AS write
      FROM msg
      LEFT JOIN usage ON usage.messageID = msg.id
    ),
    ranked AS (
      SELECT
        perMessage.*,
        row_number() OVER (PARTITION BY sessionID, parentID, agent ORDER BY created DESC, id DESC) AS rnLast,
        row_number() OVER (PARTITION BY sessionID, parentID, agent ORDER BY created ASC, id ASC) AS rnFirst
      FROM perMessage
    ),
    grouped AS (
      SELECT
        sessionID AS sessionID,
        parentID AS parentID,
        agent AS agent,
        min(created) AS startedAt,
        sum(CASE WHEN completed IS NULL THEN 0 ELSE max(0, completed - created) END) AS activeMs,
        sum(cost) AS cost,
        sum(input) AS input,
        sum(output) AS output,
        sum(reasoning) AS reasoning,
        sum(read) AS read,
        sum(write) AS write
      FROM perMessage
      GROUP BY sessionID, parentID, agent
    ),
    runs AS (
      SELECT
        first.id AS id,
        grouped.agent AS agent,
        grouped.sessionID AS sessionID,
        coalesce(tree.root_id, grouped.sessionID) AS rootSessionID,
        session.parent_id AS parentSessionID,
        session.title AS title,
        first.role AS role,
        last.providerID AS providerID,
        last.modelID AS modelID,
        grouped.startedAt AS startedAt,
        last.completed AS completedAt,
        grouped.activeMs AS activeMs,
        grouped.cost AS cost,
        grouped.input AS input,
        grouped.output AS output,
        grouped.reasoning AS reasoning,
        grouped.read AS read,
        grouped.write AS write,
        CASE
          WHEN last.errorName = 'MessageAbortedError' THEN 'cancelled'
          WHEN last.errorName IS NOT NULL THEN 'errored'
          WHEN last.completed IS NULL THEN 'running'
          ELSE 'completed'
        END AS outcome
      FROM grouped
      JOIN ranked AS first
        ON first.sessionID = grouped.sessionID
        AND first.parentID = grouped.parentID
        AND first.agent = grouped.agent
        AND first.rnFirst = 1
      JOIN ranked AS last
        ON last.sessionID = grouped.sessionID
        AND last.parentID = grouped.parentID
        AND last.agent = grouped.agent
        AND last.rnLast = 1
      JOIN session ON session.id = grouped.sessionID
      LEFT JOIN tree ON tree.id = grouped.sessionID
    )`

  const runsSql = (projectID: ProjectV2.ID, filter: Filter) => sql`
    ${cte(projectID)}
    SELECT
      runs.id AS id,
      runs.agent AS agent,
      runs.sessionID AS sessionID,
      runs.rootSessionID AS rootSessionID,
      runs.parentSessionID AS parentSessionID,
      runs.title AS title,
      runs.role AS role,
      runs.providerID AS providerID,
      runs.modelID AS modelID,
      runs.startedAt AS startedAt,
      runs.completedAt AS completedAt,
      runs.activeMs AS activeMs,
      runs.cost AS cost,
      runs.input AS input,
      runs.output AS output,
      runs.reasoning AS reasoning,
      runs.read AS read,
      runs.write AS write,
      runs.outcome AS outcome
    FROM runs${where(filter)}
    ORDER BY runs.startedAt DESC, runs.id DESC`

  const summarySql = (projectID: ProjectV2.ID, filter: Filter) => sql`
    ${cte(projectID)}
    SELECT
      runs.agent AS agent,
      count(*) AS runs,
      count(DISTINCT runs.sessionID) AS sessions,
      sum(runs.cost) AS cost,
      sum(runs.activeMs) AS activeMs,
      sum(runs.input) AS input,
      sum(runs.output) AS output,
      sum(runs.reasoning) AS reasoning,
      sum(runs.read) AS read,
      sum(runs.write) AS write,
      sum(CASE WHEN runs.outcome = 'errored' THEN 1 ELSE 0 END) AS errors,
      max(runs.startedAt) AS lastRunAt
    FROM runs${where(filter)}
    GROUP BY runs.agent
    ORDER BY runs.agent`

  const toRun = (row: Row): Run => ({
    id: row.id,
    agent: row.agent,
    sessionID: row.sessionID,
    rootSessionID: row.rootSessionID,
    parentSessionID: row.parentSessionID,
    title: row.title,
    role: row.role,
    model: { providerID: row.providerID, modelID: row.modelID },
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    activeMs: row.activeMs,
    cost: row.cost,
    tokens: {
      input: row.input,
      output: row.output,
      reasoning: row.reasoning,
      cache: { read: row.read, write: row.write },
    },
    outcome: row.outcome,
  })

  const toSummary = (row: SummaryRow): Summary => ({
    agent: row.agent,
    runs: row.runs,
    sessions: row.sessions,
    cost: row.cost,
    activeMs: row.activeMs,
    tokens: {
      input: row.input,
      output: row.output,
      reasoning: row.reasoning,
      cache: { read: row.read, write: row.write },
    },
    errors: row.errors,
    lastRunAt: row.lastRunAt,
  })

  export const runs = Effect.fn("AgentUsage.runs")(function* (filter: Filter = {}) {
    const { db } = yield* Database.Service
    const ctx = yield* InstanceState.context
    const rows = yield* db.all<Row>(runsSql(ctx.project.id, filter)).pipe(Effect.orDie)
    return rows.map(toRun)
  })

  /** Exposed for index-usage regression coverage; not part of the usage surface. */
  export const runsQuery = (projectID: ProjectV2.ID, filter: Filter = {}) => runsSql(projectID, filter)

  export const summary = Effect.fn("AgentUsage.summary")(function* (filter: Filter = {}) {
    const { db } = yield* Database.Service
    const ctx = yield* InstanceState.context
    const rows = yield* db.all<SummaryRow>(summarySql(ctx.project.id, filter)).pipe(Effect.orDie)
    return rows.map(toSummary)
  })
}
