import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { WarpGrepClient } from "@morphllm/morphsdk/tools/warp-grep/client" // kilocode_change
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import DESCRIPTION from "./warpgrep.txt"

// FREE_PERIOD_TODO: Remove KILO_WARPGREP_PROXY_URL constant and the proxy
// fallback below. After the free period ends, require MORPH_API_KEY and
// return an error when it is missing.
const KILO_WARPGREP_PROXY_URL = "https://api.kilo.ai/api/gateway"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Search query describing what code you are looking for. Be specific and descriptive for best results.", // kilocode_change
  }),
})

export const CodebaseSearchTool = Tool.define(
  "codebase_search",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "codebase_search",
            patterns: [params.query],
            always: ["*"],
            metadata: { query: params.query },
          })

          const apiKey = process.env["MORPH_API_KEY"]

          // FREE_PERIOD_TODO: Remove proxy fallback — require apiKey, error if missing:
          //   if (!apiKey) return { title: ..., output: "Set MORPH_API_KEY to use codebase search.", metadata: {} }
          const client = new WarpGrepClient({
            morphApiKey: apiKey ?? "kilo-free",
            ...(apiKey ? {} : { morphApiUrl: KILO_WARPGREP_PROXY_URL }),
            timeout: 60_000,
          })

          const result = yield* Effect.promise(() =>
            client.execute({
              searchTerm: params.query,
              repoRoot: Instance.directory,
            }),
          )

          if (!result.success || !result.contexts?.length) {
            // FREE_PERIOD_TODO: When the proxy stops serving free requests, errors
            // from the proxy (401/402/429) will surface here. The message below
            // tells the user exactly what to do.
            const isAuthOrRateLimit =
              result.error && /401|402|429|rate.limit|free.period|unauthorized/i.test(result.error) // kilocode_change
            const apiKeyMsg =
              "Codebase search unavailable: free period ended. Set MORPH_API_KEY to continue. Get your key at https://www.morphllm.com/"
            if (isAuthOrRateLimit) {
              yield* Effect.promise(() =>
                Bus.publish(TuiEvent.ToastShow, {
                  title: "Codebase Search Unavailable",
                  message: "Free period has ended. Set MORPH_API_KEY to continue. Get your key at morphllm.com",
                  variant: "error",
                  duration: 10000,
                }).catch(() => {}),
              )
            }
            return {
              title: `Codebase Search: ${params.query}`,
              output: isAuthOrRateLimit ? apiKeyMsg : (result.error ?? "No relevant code found."),
              metadata: { count: 0 },
            }
          }

          const MAX_OUTPUT_CHARS = 45_000
          const fullOutput = result.contexts.map((c) => `### ${c.file}\n\`\`\`\n${c.content}\n\`\`\``).join("\n\n") // kilocode_change

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
        }).pipe(Effect.orDie),
    }
  }),
)
