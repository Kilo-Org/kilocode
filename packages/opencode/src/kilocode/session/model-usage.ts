import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Effect, Schema } from "effect"
import { ModelID, ProviderID } from "@/provider/schema"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { Database } from "@/storage/db"

export namespace ModelUsage {
  const Tokens = Schema.Struct({
    input: NonNegativeInt,
    output: NonNegativeInt,
    reasoning: NonNegativeInt,
    cache: Schema.Struct({
      read: NonNegativeInt,
      write: NonNegativeInt,
    }),
  })

  const Usage = Schema.Struct({
    steps: NonNegativeInt,
    cost: Schema.Finite,
    tokens: Tokens,
  })

  const Model = Schema.Struct({
    providerID: ProviderID,
    modelID: ModelID,
    ...Usage.fields,
  })

  type Model = typeof Model.Type

  export const Info = Schema.Struct({
    sessionIDs: Schema.Array(SessionID),
    totals: Usage,
    models: Schema.Array(Model),
  })

  type Info = typeof Info.Type

  type Anchor = {
    projectID: ProjectID
  }

  type Ancestor = {
    id: SessionID
    parentID: SessionID | null
  }

  type Row = {
    providerID: ProviderID
    modelID: ModelID
    steps: number
    cost: number
    input: number
    output: number
    reasoning: number
    read: number
    write: number
  }

  const ANCHOR_SQL = "SELECT project_id AS projectID FROM session WHERE id = ?"

  const ANCESTORS_SQL = `
    WITH RECURSIVE ancestor(id, parent_id) AS (
      SELECT id, parent_id
      FROM session
      WHERE id = ? AND project_id = ?

      UNION

      SELECT parent.id, parent.parent_id
      FROM session AS parent
      JOIN ancestor AS child ON child.parent_id = parent.id
      WHERE parent.project_id = ?
    )
    SELECT id, parent_id AS parentID
    FROM ancestor`

  const FAMILY_SQL = `
    WITH RECURSIVE family(id) AS (
      SELECT id
      FROM session
      WHERE id = ? AND project_id = ?

      UNION

      SELECT child.id
      FROM session AS child
      JOIN family AS parent ON child.parent_id = parent.id
      WHERE child.project_id = ?
    )
    SELECT id
    FROM family
    ORDER BY id`

  // Scope aggregation to the already-resolved family session IDs via an IN list.
  // Re-deriving the family with an inline recursive CTE prevents SQLite from
  // using part_session_idx and forces a full scan of the entire part table
  // (seconds on large histories), which blocks the single-threaded server on
  // every session open. A concrete IN list lets the planner seek the index.
  const usageSql = (placeholders: string) => `
    WITH step AS (
      SELECT
        coalesce(json_extract(part.data, '$.model.providerID'), json_extract(message.data, '$.providerID')) AS providerID,
        coalesce(json_extract(part.data, '$.model.modelID'), json_extract(message.data, '$.modelID')) AS modelID,
        max(0.0, cast(coalesce(json_extract(part.data, '$.cost'), 0) AS REAL)) AS cost,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.input'), 0) AS INTEGER)) AS input,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.output'), 0) AS INTEGER)) AS output,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.reasoning'), 0) AS INTEGER)) AS reasoning,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.cache.read'), 0) AS INTEGER)) AS cache_read,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.cache.write'), 0) AS INTEGER)) AS cache_write
      FROM part
      JOIN message ON message.id = part.message_id AND message.session_id = part.session_id
      WHERE part.session_id IN (${placeholders})
        AND json_extract(part.data, '$.type') = 'step-finish'
        AND json_extract(message.data, '$.role') = 'assistant'
    )
    SELECT
      providerID,
      modelID,
      count(*) AS steps,
      coalesce(sum(cost), 0) AS cost,
      coalesce(sum(input), 0) AS input,
      coalesce(sum(output), 0) AS output,
      coalesce(sum(reasoning), 0) AS reasoning,
      coalesce(sum(cache_read), 0) AS read,
      coalesce(sum(cache_write), 0) AS write
    FROM step
    WHERE providerID IS NOT NULL AND modelID IS NOT NULL
    GROUP BY providerID, modelID
    ORDER BY cost DESC, providerID, modelID`

  const empty = () => ({
    steps: 0,
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  })

  export const get = Effect.fn("ModelUsage.get")(function* (sessionID: SessionID) {
    return yield* Effect.sync(() => {
      const db = Database.Client().$client
      const anchor = db.prepare<Anchor, [string]>(ANCHOR_SQL).get(sessionID)
      if (!anchor) return undefined

      const args = [sessionID, anchor.projectID, anchor.projectID] as const
      const ancestors = db.prepare<Ancestor, [string, string, string]>(ANCESTORS_SQL).all(...args)
      const ids = new Set(ancestors.map((item) => item.id))
      const rootID = ancestors.find((item) => !item.parentID || !ids.has(item.parentID))?.id ?? sessionID
      const familyArgs = [rootID, anchor.projectID, anchor.projectID] as const
      const sessionIDs = db
        .prepare<{ id: SessionID }, [string, string, string]>(FAMILY_SQL)
        .all(...familyArgs)
        .map((item) => item.id)
      const rows =
        sessionIDs.length === 0
          ? []
          : db.prepare<Row, string[]>(usageSql(sessionIDs.map(() => "?").join(","))).all(...sessionIDs)
      const totals = empty()
      const models = rows.map((row): Model => {
        totals.steps += row.steps
        totals.cost += row.cost
        totals.tokens.input += row.input
        totals.tokens.output += row.output
        totals.tokens.reasoning += row.reasoning
        totals.tokens.cache.read += row.read
        totals.tokens.cache.write += row.write
        return {
          providerID: row.providerID,
          modelID: row.modelID,
          steps: row.steps,
          cost: row.cost,
          tokens: {
            input: row.input,
            output: row.output,
            reasoning: row.reasoning,
            cache: { read: row.read, write: row.write },
          },
        }
      })

      return { sessionIDs, totals, models } satisfies Info
    })
  })
}
