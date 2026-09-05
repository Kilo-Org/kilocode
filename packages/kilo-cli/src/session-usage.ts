import type { Database } from "@opencode-ai/core/database/database"
import { Model } from "@opencode-ai/schema/model"
import { Money } from "@opencode-ai/schema/money"
import { Provider } from "@opencode-ai/schema/provider"
import type { Session } from "@opencode-ai/schema/session"
import { Effect } from "effect"
import type { SessionUsage } from "./session-usage-rpc"

export type SessionUsageReader = (input: {
  readonly sessionID: Session.ID
}) => Effect.Effect<SessionUsage | undefined, never>

type Anchor = { readonly projectID: string }
type Ancestor = { readonly id: Session.ID; readonly parentID: Session.ID | null }
type SessionRow = { readonly id: Session.ID }
type UsageRow = {
  readonly providerID: string
  readonly modelID: string
  readonly steps: number
  readonly cost: number
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly read: number
  readonly write: number
}

/**
 * Read the v1 session-tree model-usage projection from v2's durable assistant
 * messages. Auxiliary title and compaction records intentionally stay out: v1
 * only counted normal assistant step finishes.
 */
export function createSessionFamilyUsageReader(database: Pick<Database.Interface, "db">): SessionUsageReader {
  return (input) =>
    database.db
      .transaction((db) =>
        Effect.gen(function* () {
          const anchor = yield* db.get<Anchor>(
            `SELECT project_id AS projectID FROM session_v2 WHERE id = ${literal(input.sessionID)}`,
          )
          if (!anchor) return undefined

          // UNION deduplicates before the next recursive edge, making malformed
          // parent cycles terminate while preserving v1's project boundary.
          const ancestors = yield* db.all<Ancestor>(`
          WITH RECURSIVE ancestor(id, parent_id) AS (
            SELECT id, parent_id
            FROM session_v2
            WHERE id = ${literal(input.sessionID)} AND project_id = ${literal(anchor.projectID)}

            UNION

            SELECT parent.id, parent.parent_id
            FROM session_v2 AS parent
            JOIN ancestor AS child ON child.parent_id = parent.id
            WHERE parent.project_id = ${literal(anchor.projectID)}
          )
          SELECT id, parent_id AS parentID
          FROM ancestor
        `)
          const ancestorIDs = new Set(ancestors.map((item) => item.id))
          const rootID =
            ancestors.find((item) => !item.parentID || !ancestorIDs.has(item.parentID))?.id ?? input.sessionID
          const sessionIDs = (yield* db.all<SessionRow>(`
            WITH RECURSIVE family(id) AS (
              SELECT id
              FROM session_v2
              WHERE id = ${literal(rootID)} AND project_id = ${literal(anchor.projectID)}

              UNION

              SELECT child.id
              FROM session_v2 AS child
              JOIN family AS parent ON child.parent_id = parent.id
              WHERE child.project_id = ${literal(anchor.projectID)}
            )
            SELECT id
            FROM family
            ORDER BY id
          `)).map((item) => item.id)
          const rows = yield* db.all<UsageRow>(usageSql(sessionIDs))
          const totals = empty()
          const models = rows.map((row) => {
            totals.steps += row.steps
            totals.cost += row.cost
            totals.tokens.input += row.input
            totals.tokens.output += row.output
            totals.tokens.reasoning += row.reasoning
            totals.tokens.cache.read += row.read
            totals.tokens.cache.write += row.write
            return {
              providerID: Provider.ID.make(row.providerID),
              modelID: Model.ID.make(row.modelID),
              steps: row.steps,
              cost: Money.USD.make(row.cost),
              tokens: {
                input: row.input,
                output: row.output,
                reasoning: row.reasoning,
                cache: { read: row.read, write: row.write },
              },
            }
          })
          return {
            sessionIDs,
            totals: { ...totals, cost: Money.USD.make(totals.cost) },
            models,
          } satisfies SessionUsage
        }),
      )
      .pipe(Effect.orElseSucceed(() => undefined))
}

function usageSql(sessionIDs: readonly Session.ID[]) {
  return `
    WITH step AS (
      -- Missing durable usage is zero, as in v1; this adapter never estimates
      -- cost, token counts, or throughput from transcript content.
      SELECT
        json_extract(message.data, '$.model.providerID') AS providerID,
        json_extract(message.data, '$.model.id') AS modelID,
        max(0.0, cast(coalesce(json_extract(message.data, '$.cost'), 0) AS REAL)) AS cost,
        max(0, cast(coalesce(json_extract(message.data, '$.tokens.input'), 0) AS INTEGER)) AS input,
        max(0, cast(coalesce(json_extract(message.data, '$.tokens.output'), 0) AS INTEGER)) AS output,
        max(0, cast(coalesce(json_extract(message.data, '$.tokens.reasoning'), 0) AS INTEGER)) AS reasoning,
        max(0, cast(coalesce(json_extract(message.data, '$.tokens.cache.read'), 0) AS INTEGER)) AS cache_read,
        max(0, cast(coalesce(json_extract(message.data, '$.tokens.cache.write'), 0) AS INTEGER)) AS cache_write
      FROM session_message AS message
      WHERE message.session_id IN (${sessionIDs.map(literal).join(",")})
        AND message.type = 'assistant'
        AND json_extract(message.data, '$.time.completed') IS NOT NULL
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
    ORDER BY cost DESC, providerID, modelID
  `
}

// The database wrapper exposes only raw reads to Kilo-owned host code. Values
// originate at the typed Session boundary; quote them once before SQL assembly.
function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function empty() {
  return {
    steps: 0,
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}
