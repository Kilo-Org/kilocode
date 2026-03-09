// kilocode_change - new file
import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { KiloIndexing } from "@/kilocode/indexing"
import { Instance } from "@/project/instance"

import DESCRIPTION from "./codebase_search.txt"

type SearchResult = {
  filePath: string
  score: number
  startLine: number
  endLine: number
  codeChunk: string
}

export const CodebaseSearchTool = Tool.define("codebase_search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("The search query, expressed in natural language."),
    path: z
      .string()
      .optional()
      .describe(
        "Limit search to specific subdirectory (relative to the current workspace directory). Leave empty for entire workspace.",
      ),
  }),
  async execute(params, ctx) {
    if (!params.query) {
      throw new Error("query is required")
    }

    await ctx.ask({
      permission: "codebase_search",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        path: params.path,
      },
    })

    const prefix = normalizeSearchPath(params.path)
    const matches = await KiloIndexing.search(params.query, prefix)

    const results = matches.flatMap<SearchResult>((item) => {
      const payload = item.payload
      if (!payload) return []
      if (
        typeof payload.filePath !== "string" ||
        typeof payload.codeChunk !== "string" ||
        typeof payload.startLine !== "number" ||
        typeof payload.endLine !== "number"
      ) {
        return []
      }

      return [
        {
          filePath: normalizePath(payload.filePath),
          score: item.score,
          startLine: payload.startLine,
          endLine: payload.endLine,
          codeChunk: payload.codeChunk,
        },
      ]
    })

    if (results.length === 0) {
      return {
        title: "Codebase Search",
        metadata: {
          results,
        },
        output: `No relevant code found for "${params.query}"${prefix ? ` in ${normalizePath(prefix)}` : ""}.`,
      }
    }

    const output = [
      `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${params.query}"${prefix ? ` in ${normalizePath(prefix)}` : ""}.`,
      "",
      ...results.flatMap((item, index) => {
        return [
          `${index + 1}. ${item.filePath}:${item.startLine}-${item.endLine} (score ${item.score.toFixed(4)})`,
          item.codeChunk,
          "",
        ]
      }),
    ]

    return {
      title: "Codebase Search",
      metadata: {
        results,
      },
      output: output.join("\n").trim(),
    }
  },
})

function normalizeSearchPath(input?: string): string | undefined {
  if (!input) return undefined

  const absolute = path.resolve(Instance.directory, input)
  const relative = path.relative(Instance.directory, absolute)
  if (!relative || relative === ".") return undefined
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`path must be within the current workspace: ${input}`)
  }
  return path.normalize(relative)
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
