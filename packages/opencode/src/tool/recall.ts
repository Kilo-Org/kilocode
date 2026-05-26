// kilocode_change - new file
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "../effect/instance-state"
import { Project } from "../project/project"
import { Locale } from "../util/locale"
import { Filesystem } from "../util/filesystem"
import { WorktreeFamily } from "../kilocode/worktree-family"
import DESCRIPTION from "./recall.txt"

const Parameters = Schema.Struct({
  mode: Schema.Literals(["search", "read"]).annotate({
    description: "'search' to find sessions by title, 'read' to get a session transcript",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query to match against session titles (required for search mode)",
  }),
  sessionID: Schema.optional(Schema.String).annotate({
    description: "Session ID to read the transcript of (required for read mode)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of search results to return (default: 20, max: 50)",
  }),
})

export const RecallTool = Tool.define(
  "kilo_local_recall",
  Effect.gen(function* () {
    const project = yield* Project.Service

    const search = Effect.fn("RecallTool.search")(function* (
      params: { query?: string; limit?: number },
      ctx: Tool.Context,
    ) {
      if (!params.query) {
        throw new Error("The 'query' parameter is required when mode is 'search'")
      }

      yield* ctx.ask({
        permission: "recall",
        patterns: ["search"],
        always: ["search"],
        metadata: {
          mode: "search",
          query: params.query,
        },
      })

      const limit = Math.min(params.limit ?? 20, 50)
      const state = yield* InstanceState.context
      const dirs = yield* WorktreeFamily.list(project, state)
      const { Session } = yield* Effect.promise(() => import("../session/session"))

      const results: Array<{
        id: string
        title: string
        directory: string
        updated: string
      }> = []

      for (const session of Session.listGlobal({
        projectID: state.project.id,
        directories: dirs,
        search: params.query,
        roots: true,
        limit,
      })) {
        results.push({
          id: session.id,
          title: session.title,
          directory: session.directory,
          updated: Locale.todayTimeOrDateTime(session.time.updated),
        })
      }

      if (results.length === 0) {
        return {
          title: `Search: "${params.query}" (no results)`,
          output: `No sessions found matching "${params.query}".`,
          metadata: {},
        }
      }

      const lines = results.map((r) => `- **${r.title}**\n  ID: ${r.id} | Updated: ${r.updated} | Dir: ${r.directory}`)

      return {
        title: `Search: "${params.query}" (${results.length} results)`,
        output: lines.join("\n"),
        metadata: {},
      }
    })

    const read = Effect.fn("RecallTool.read")(function* (params: { sessionID?: string }, ctx: Tool.Context) {
      if (!params.sessionID) {
        throw new Error("The 'sessionID' parameter is required when mode is 'read'")
      }

      const id = params.sessionID
      const { Session } = yield* Effect.promise(() => import("../session/session"))
      const { SessionID } = yield* Effect.promise(() => import("../session/schema"))
      const session = yield* Effect.tryPromise(() => Session.get(SessionID.make(id))).pipe(
        Effect.catch(() =>
          Effect.fail(new Error(`Session "${id}" not found. Use search mode first to find valid session IDs.`)),
        ),
      )
      const state = yield* InstanceState.context
      const dirs = yield* WorktreeFamily.list(project, state)
      const dir = Filesystem.resolve(session.directory)
      if (!dirs.some((root) => Filesystem.contains(root, dir))) {
        throw new Error(`Session "${id}" belongs to a different workspace and cannot be read from this directory.`)
      }

      const cross = session.projectID !== state.project.id
      if (cross) {
        yield* ctx.ask({
          permission: "recall",
          patterns: [session.directory],
          always: [session.directory],
          metadata: {
            sessionID: session.id,
            title: session.title,
            directory: session.directory,
          },
        })
      }

      const msgs = yield* Effect.tryPromise(() => Session.messages({ sessionID: session.id }))
      const lines: string[] = [
        `# Session: ${session.title}`,
        `Directory: ${session.directory}`,
        `Created: ${Locale.todayTimeOrDateTime(session.time.created)}`,
        "",
      ]

      for (const msg of msgs) {
        if (msg.info.role === "user") {
          lines.push("## User")
          for (const part of msg.parts) {
            if (part.type === "text") lines.push(part.text)
          }
          lines.push("")
        }
        if (msg.info.role === "assistant") {
          lines.push("## Assistant")
          for (const part of msg.parts) {
            if (part.type === "text") lines.push(part.text)
            if (part.type === "tool" && part.state.status === "completed") {
              lines.push(`[Tool: ${part.tool}] ${part.state.title}`)
            }
          }
          lines.push("")
        }
      }

      return {
        title: `Read: ${session.title}`,
        output: lines.join("\n"),
        metadata: {},
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        (params.mode === "search" ? search(params, ctx) : read(params, ctx)).pipe(Effect.orDie),
    }
  }),
)
