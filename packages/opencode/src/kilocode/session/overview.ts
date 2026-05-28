// kilocode_change - new file
import { Effect, Schema } from "effect"
import { inArray } from "@/storage/db"
import { Database } from "@/storage/db"
import { KiloSession } from "@/kilocode/session"
import { MessageTable } from "@/session/session.sql"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"

export namespace SessionOverview {
  type ActivityKind = "running" | "login_required" | "permission" | "plan" | "question"

  export const Activity = Schema.Struct({
    kind: Schema.Literals(["running", "login_required", "permission", "plan", "question"]),
    requestID: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }).annotate({ identifier: "SessionActivity" })
  export type Activity = Schema.Schema.Type<typeof Activity>

  export const Query = Schema.Struct({
    directory: Schema.optional(Schema.String),
    projectID: Schema.optional(Schema.String),
    worktrees: Schema.optional(Schema.Boolean),
    roots: Schema.optional(Schema.Boolean),
    start: Schema.optional(Schema.Number),
    cursor: Schema.optional(Schema.Number),
    search: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
    archived: Schema.optional(Schema.Boolean),
  })
  export type Query = Schema.Schema.Type<typeof Query>

  export const Response = Schema.Struct({
    sessions: Schema.Array(Schema.Union([Session.Info, Session.GlobalInfo])),
    statuses: Schema.Record(Schema.String, SessionStatus.Info),
    activities: Schema.Record(Schema.String, Activity),
    costs: Schema.Record(Schema.String, Schema.Number),
  }).annotate({ identifier: "SessionOverview" })
  export type Response = Schema.Schema.Type<typeof Response>

  const rank: Record<ActivityKind, number> = {
    permission: 5,
    plan: 4,
    question: 3,
    login_required: 2,
    running: 1,
  }

  function set(map: Map<string, Activity>, id: string, activity: Activity) {
    const prev = map.get(id)
    if (prev && rank[prev.kind] >= rank[activity.kind]) return
    map.set(id, activity)
  }

  function plan(req: Question.Request) {
    return req.questions.some(
      (item) => item.questionKey === "plan.followup.question" || item.headerKey === "plan.followup.header",
    )
  }

  function costs(ids: string[]) {
    if (ids.length === 0) return {}
    const rows = Database.use((db) =>
      db
        .select({ sessionID: MessageTable.session_id, data: MessageTable.data })
        .from(MessageTable)
        .where(
          inArray(
            MessageTable.session_id,
            ids.map((id) => SessionID.make(id)),
          ),
        )
        .all(),
    )
    const result: Record<string, number> = {}
    for (const row of rows) {
      if (row.data.role !== "assistant") continue
      const cost = "cost" in row.data && typeof row.data.cost === "number" ? row.data.cost : undefined
      if (cost === undefined || !Number.isFinite(cost)) continue
      result[row.sessionID] = (result[row.sessionID] ?? 0) + cost
    }
    return result
  }

  export function build(input: Query) {
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const statuses = yield* SessionStatus.Service
      const permissions = yield* Permission.Service
      const questions = yield* Question.Service

      const items = input.worktrees
        ? yield* Effect.sync(() =>
            Array.from(
              KiloSession.listGlobal<Session.GlobalInfo>({
                fromRow: Session.fromRow,
                projectID: input.projectID,
                directory: input.directory,
                roots: input.roots,
                start: input.start,
                cursor: input.cursor,
                search: input.search,
                limit: input.limit,
                archived: input.archived,
              }),
            ),
          )
        : yield* sessions.list({
            directory: input.directory,
            roots: input.roots,
            start: input.start,
            search: input.search,
            limit: input.limit,
          })

      const ids = new Set<string>(items.map((item) => item.id))
      const status = Object.fromEntries(
        [...(yield* statuses.list())].filter(([id, value]) => ids.has(id) || value.type === "busy"),
      )
      const activity = new Map<string, Activity>()

      for (const [id, value] of Object.entries(status)) {
        if (value.type === "busy") set(activity, id, { kind: "running" })
      }
      for (const req of yield* permissions.list()) {
        const id = KiloSession.resolveRoot(req.sessionID)
        if (ids.has(id)) set(activity, id, { kind: "permission", requestID: String(req.id) })
      }
      for (const req of yield* questions.list()) {
        const id = KiloSession.resolveRoot(req.sessionID)
        if (ids.has(id)) set(activity, id, { kind: plan(req) ? "plan" : "question", requestID: String(req.id) })
      }

      return {
        sessions: items,
        statuses: status,
        activities: Object.fromEntries(activity),
        costs: costs(items.map((item) => item.id)),
      }
    })
  }
}
