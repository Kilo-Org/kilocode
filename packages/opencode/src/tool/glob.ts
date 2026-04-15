import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"

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

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe(
        `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
      ),
  }),
  async execute(params, ctx) {
    const absolute = split(params.pattern) // kilocode_change
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
      },
    })

    let search = absolute?.dir ?? params.path ?? Instance.directory // kilocode_change
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)
    await assertExternalDirectory(ctx, search, { kind: "directory" })

    const limit = 100
    const files = []
    let truncated = false
    for await (const file of Ripgrep.files({
      cwd: search,
      glob: [absolute?.pattern ?? params.pattern], // kilocode_change
      signal: ctx.abort,
    })) {
      if (files.length >= limit) {
        truncated = true
        break
      }
      const full = path.resolve(search, file)
      const stats = Filesystem.stat(full)?.mtime.getTime() ?? 0
      files.push({
        path: full,
        mtime: stats,
      })
    }
    files.sort((a, b) => b.mtime - a.mtime)

    const output = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      output.push(...files.map((f) => f.path))
      if (truncated) {
        output.push("")
        output.push(
          `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
        )
      }
    }

    return {
      title: path.relative(Instance.worktree, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
