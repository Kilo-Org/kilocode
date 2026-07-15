import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"

// kilocode_change start — support absolute glob patterns (e.g. ~/.config/kilo/command/*.md)
function normalize(p: string) {
  return p.replaceAll("\\", "/")
}

function split(pattern: string) {
  const normalized = normalize(pattern)
  if (!path.isAbsolute(normalized)) return
  const index = normalized.search(/[*?{[]/)
  if (index === -1) return { dir: normalized, pattern: "*" }
  const slice = normalized.slice(0, index)
  const cut = slice.lastIndexOf("/")
  const dir = cut > 0 ? slice.slice(0, cut) : "/"
  const next = normalized.slice(cut + 1)
  return { dir, pattern: next || "*" }
}
// kilocode_change end

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
  }),
})

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const absolute = split(params.pattern) // kilocode_change
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
            },
          })

          // kilocode_change start
          const base = absolute?.dir ?? params.path ?? ins.directory
          const search = path.isAbsolute(base) ? base : path.resolve(ins.directory, base)
          // kilocode_change end
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info?.type === "File") {
            throw new Error(`glob path must be a directory: ${search}`)
          }
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: false,
            kind: "directory",
          })

          const limit = 100
          // kilocode_change start - retain bounded-search metadata from Core ripgrep.
          const result = yield* ripgrep.glob({
            cwd: search,
            pattern: absolute?.pattern ?? params.pattern, // kilocode_change - absolute patterns are split into cwd + relative glob
            limit,
            signal: ctx.abort, // kilocode_change - stop ripgrep when the tool call is cancelled
          })
          const files = result.items
          const truncated = result.truncated
          // kilocode_change end

          const output = []
          if (files.length === 0) output.push("No files found")
          if (files.length > 0) {
            output.push(...files.map((file) => path.resolve(search, file.path)))
            if (truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
              )
            }
            if (result.partial) output.push("", "(Some discovered files could not be read.)") // kilocode_change
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.length,
              truncated,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
