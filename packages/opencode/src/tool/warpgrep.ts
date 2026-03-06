import z from "zod"
import { Tool } from "./tool"
import { WarpGrep } from "../kilocode/warpgrep"
import { abortAfterAny } from "../util/abort"
import DESCRIPTION from "./warpgrep.txt"

export const WarpGrepTool = Tool.define("warpgrep", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe("Search query describing what code you are looking for. Be specific and descriptive for best results."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "warpgrep",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
      },
    })

    const apiKey = WarpGrep.key()
    if (!apiKey) {
      return {
        title: `WarpGrep: ${params.query}`,
        output: "Set MORPH_API_KEY or WARPGREP_API_KEY environment variable to use WarpGrep",
        metadata: {},
      }
    }

    const { signal, clearTimeout } = abortAfterAny(60000, ctx.abort)

    try {
      const result = await WarpGrep.search(params.query, apiKey, signal)

      clearTimeout()

      return {
        title: `WarpGrep: ${params.query}`,
        output: result,
        metadata: {},
      }
    } catch (error) {
      clearTimeout()

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("WarpGrep search request timed out")
      }
      throw error
    }
  },
})
