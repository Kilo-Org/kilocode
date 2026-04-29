import z from "zod"
import { Tool } from "@/tool/tool"

const NETWORK_TIMEOUT_MS = 30000

const parameters = z.object({
  query: z.string().describe("The GraphQL query or mutation document"),
  variables: z.record(z.string(), z.unknown()).optional().describe("Variables for the GraphQL operation"),
})

export const LinearGraphqlTool = Tool.define("linear_graphql", {
  description:
    "Execute a GraphQL query against the Linear API. Use this to update issue state, post comments, and link pull requests. Exactly one operation per call.",
  parameters,
  async execute(args, ctx) {
    const symphonyConfig = ctx.extra?.symphonyConfig as
      | { endpoint: string; apiKey: string }
      | undefined

    if (!symphonyConfig) {
      return {
        title: "linear_graphql",
        output: "Error: linear_graphql tool is only available in Symphony daemon mode",
        metadata: {} as Record<string, unknown>,
      }
    }

    ctx.metadata({ title: `Linear GraphQL: ${args.query.slice(0, 60)}...` })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)

    try {
      const response = await fetch(symphonyConfig.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: symphonyConfig.apiKey,
        },
        body: JSON.stringify({
          query: args.query,
          variables: args.variables ?? {},
        }),
        signal: controller.signal,
      })

      const json = (await response.json()) as { data?: unknown; errors?: unknown[] }

      if (!response.ok || (json.errors && json.errors.length > 0)) {
        return {
          title: "linear_graphql",
          output: JSON.stringify({
            success: false,
            errors: json.errors ?? [{ message: `HTTP ${response.status}: ${response.statusText}` }],
            data: json.data,
          }),
          metadata: { statusCode: response.status } as Record<string, unknown>,
        }
      }

      return {
        title: "linear_graphql",
        output: JSON.stringify({ success: true, data: json.data }),
        metadata: {} as Record<string, unknown>,
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return {
          title: "linear_graphql",
          output: JSON.stringify({ success: false, errors: [{ message: "Request timed out" }] }),
          metadata: {} as Record<string, unknown>,
        }
      }
      return {
        title: "linear_graphql",
        output: JSON.stringify({
          success: false,
          errors: [{ message: e instanceof Error ? e.message : String(e) }],
        }),
        metadata: {} as Record<string, unknown>,
      }
    } finally {
      clearTimeout(timeout)
    }
  },
})
