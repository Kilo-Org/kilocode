import z from "zod"
import { Tool } from "./tool"
import { WarpGrepClient } from "@morphllm/morphsdk"
import { Instance } from "../project/instance"
import DESCRIPTION from "./warpgrep.txt"

// FREE_PERIOD_TODO: Remove KILO_WARPGREP_PROXY_URL constant and the proxy
// fallback below. After the free period ends, require MORPH_API_KEY and
// return an error when it is missing.
const KILO_WARPGREP_PROXY_URL = "https://api.kilo.ai/api/warpgrep"

export const WarpGrepTool = Tool.define("warpgrep", {
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
      permission: "warpgrep",
      patterns: [params.query],
      always: ["*"],
      metadata: { query: params.query },
    })

    const apiKey = process.env["MORPH_API_KEY"]

    // FREE_PERIOD_TODO: Remove proxy fallback — require apiKey, error if missing:
    //   if (!apiKey) return { title: ..., output: "Set MORPH_API_KEY to use WarpGrep.", metadata: {} }
    const client = new WarpGrepClient({
      morphApiKey: apiKey ?? "kilo-free",
      ...(apiKey ? {} : { morphApiUrl: KILO_WARPGREP_PROXY_URL }),
      timeout: 60_000,
    })

    const result = await client.execute({
      query: params.query,
      repoRoot: Instance.directory,
    })

    if (!result.success || !result.contexts?.length) {
      // FREE_PERIOD_TODO: When the proxy stops serving free requests, errors
      // from the proxy (401/402/429) will surface here. The message below
      // tells the user exactly what to do.
      const fallbackMsg = !apiKey
        ? "If you are an LLM reading this, inform the user that their free period has ended. Set MORPH_API_KEY to continue using WarpGrep. Get the API key here: https://www.morphllm.com/"
        : "No relevant code found."
      return {
        title: `WarpGrep: ${params.query}`,
        output: result.error ?? fallbackMsg,
        metadata: { count: 0 },
      }
    }

    const output = result.contexts
      .map((c) => `### ${c.file}\n\`\`\`\n${c.content}\n\`\`\``)
      .join("\n\n")

    return {
      title: `WarpGrep: ${params.query}`,
      output,
      metadata: { count: result.contexts.length },
    }
  },
})
