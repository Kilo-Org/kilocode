import z from "zod"
import { Tool } from "./tool"
import { WarpGrepClient } from "@morphllm/morphsdk"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import DESCRIPTION from "./warpgrep.txt"

export const CodebaseSearchTool = Tool.define("codebase_search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query describing what code you are looking for. Be specific and descriptive for best results.",
      ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "codebase_search",
      patterns: [params.query],
      always: ["*"],
      metadata: { query: params.query },
    })

    const apiKey = process.env["MORPH_API_KEY"]

    // devilcode_change start - Require MORPH_API_KEY, remove proxy fallback
    if (!apiKey) {
      return {
        title: `Codebase Search: ${params.query}`,
        output: "Codebase search requires MORPH_API_KEY. Get your key at https://www.morphllm.com/",
        metadata: { count: 0 },
      }
    }

    const client = new WarpGrepClient({
      morphApiKey: apiKey,
      timeout: 60_000,
    })
    // devilcode_change end

    const result = await client.execute({
      searchTerm: params.query,
      repoRoot: Instance.directory,
    })

    if (!result.success || !result.contexts?.length) {
      // devilcode_change start - Simplified error handling without proxy fallback
      const isAuthOrRateLimit =
        result.error && /401|402|429|rate.limit|unauthorized/i.test(result.error)
      const apiKeyMsg =
        "Codebase search unavailable. Check your MORPH_API_KEY or try again later. Get your key at https://www.morphllm.com/"
      if (isAuthOrRateLimit) {
        Bus.publish(TuiEvent.ToastShow, {
          title: "Codebase Search Unavailable",
          message: "Check your MORPH_API_KEY or try again later. Get your key at morphllm.com",
          variant: "error",
          duration: 10000,
        }).catch(() => {})
      }
      return {
        title: `Codebase Search: ${params.query}`,
        output: isAuthOrRateLimit ? apiKeyMsg : (result.error ?? "No relevant code found."),
        metadata: { count: 0 },
      }
      // devilcode_change end
    }

    const MAX_OUTPUT_CHARS = 45_000
    const fullOutput = result.contexts
      .map((c) => `### ${c.file}\n\`\`\`\n${c.content}\n\`\`\``)
      .join("\n\n")

    let output: string
    if (fullOutput.length > MAX_OUTPUT_CHARS) {
      const summary = result.contexts
        .map((c) => {
          const lineInfo = !c.lines
            ? ""
            : c.lines === "*"
              ? " (full file)"
              : ` (lines ${c.lines.map((r) => r.join("-")).join(", ")})`
          return `- ${c.file}${lineInfo}`
        })
        .join("\n")
      output = `Results too large to show inline. Showing file paths and line ranges. Use Read tool to view specific files.\n\n${summary}`
    } else {
      output = fullOutput
    }

    return {
      title: `Codebase Search: ${params.query}`,
      output,
      metadata: { count: result.contexts.length },
    }
  },
})
