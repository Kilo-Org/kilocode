// kilocode_change - new file
import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Instance } from "../project/instance"
import { Locale } from "../util"
import { Filesystem } from "../util" // kilocode_change
import { WorktreeFamily } from "../kilocode/worktree-family" // kilocode_change
import DESCRIPTION from "./recall.txt"

const Parameters = z.object({
  mode: z.enum(["search", "read"]).describe("'search' to find sessions by title, 'read' to get a session transcript"),
  query: z.string().optional().describe("Search query to match against session titles (required for search mode)"),
  sessionID: z.string().optional().describe("Session ID to read the transcript of (required for read mode)"),
  limit: z.number().optional().describe("Maximum number of search results to return (default: 20, max: 50)"),
})

export const RecallTool = Tool.define(
  "kilo_local_recall",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.mode === "search") {
            return yield* Effect.promise(() => search(params, ctx))
          }
          return yield* Effect.promise(() => read(params, ctx))
        }).pipe(Effect.orDie),
    }
  }),
)

async function search(params: { query?: string; limit?: number }, ctx: Tool.Context) {
  if (!params.query) {
    throw new Error("The 'query' parameter is required when mode is 'search'")
  }

  await ctx.ask({
    permission: "recall",
    patterns: ["search"],
    always: ["search"],
    metadata: {
      mode: "search",
      query: params.query,
    },
  })

  const limit = Math.min(params.limit ?? 20, 50)
  const dirs = await WorktreeFamily.list() // kilocode_change
  const { Session } = await import("../session/index") // kilocode_change

  const results: Array<{
    id: string
    title: string
    directory: string
    updated: string
  }> = []

  for (const session of Session.listGlobal({
    projectID: Instance.project.id, // kilocode_change
    directories: dirs, // kilocode_change
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
}

async function read(params: { sessionID?: string }, ctx: Tool.Context) {
  if (!params.sessionID) {
    throw new Error("The 'sessionID' parameter is required when mode is 'read'")
  }

  const { Session } = await import("../session/index") // kilocode_change
  const { SessionID } = await import("../session/schema") // kilocode_change
  const session = await Session.get(SessionID.make(params.sessionID)).catch(() => {
    throw new Error(`Session "${params.sessionID}" not found. Use search mode first to find valid session IDs.`)
  })
  const dirs = await WorktreeFamily.list() // kilocode_change
  // kilocode_change start
  const dir = Filesystem.resolve(session.directory)
  if (!dirs.some((root) => Filesystem.contains(root, dir))) {
    throw new Error(
      `Session "${params.sessionID}" belongs to a different workspace and cannot be read from this directory.`,
    )
  }
  // kilocode_change end

  const cross = session.projectID !== Instance.project.id
  if (cross) {
    await ctx.ask({
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

  const msgs = await Session.messages({ sessionID: session.id })
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
}
