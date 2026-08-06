import { Effect, Option, Schema } from "effect" // kilocode_change - Option added for kilo-exa transport dispatch
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import * as KiloExa from "@/kilocode/tool/websearch-kilo-exa" // kilocode_change - Kilo-REST Exa transport
import DESCRIPTION from "./websearch.txt"
import { checksum } from "@opencode-ai/core/util/encode"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Auth } from "@/auth" // kilocode_change - source Kilo bearer for Kilo-REST transport

const MAX_RESULTS = 10 // kilocode_change - cap numResults across all transports

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8, maximum: 10)", // kilocode_change - note MAX_RESULTS cap
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
  }),
})

const WebSearchProviderSchema = Schema.Literals(["exa", "parallel", "kilo-exa"]) // kilocode_change - kilo-exa env override
export type WebSearchProvider = Schema.Schema.Type<typeof WebSearchProviderSchema>

export function selectWebSearchProvider(sessionID: string, flags = { exa: false, parallel: false }): WebSearchProvider {
  const override = process.env.KILO_WEBSEARCH_PROVIDER
  if (override === "exa" || override === "parallel" || override === "kilo-exa") return override // kilocode_change - kilo-exa env override
  if (flags.parallel) return "parallel"
  if (flags.exa) return "exa"

  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa" || provider === "kilo-exa") return "Exa Web Search" // kilocode_change - kilo-exa shares label
  return "Web Search"
}

export function webSearchModelName(extra: Tool.Context["extra"]) {
  const model = extra?.model
  if (!model || typeof model !== "object") return undefined
  const api = "api" in model && model.api && typeof model.api === "object" ? model.api : undefined
  const apiID = api && "id" in api && typeof api.id === "string" ? api.id : undefined
  const id = "id" in model && typeof model.id === "string" ? model.id : undefined
  return (apiID ?? id)?.slice(0, 100)
}

function parallelAuthHeaders() {
  const headers = { "User-Agent": `opencode/${InstallationVersion}` }
  if (!process.env.PARALLEL_API_KEY) return headers
  return { ...headers, Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
) {
  if (provider === "parallel") {
    return McpWebSearch.call(
      http,
      McpWebSearch.PARALLEL_URL,
      "web_search",
      McpWebSearch.ParallelSearchArgs,
      {
        objective: params.query,
        search_queries: [params.query],
        session_id: ctx.sessionID,
        model_name: webSearchModelName(ctx.extra),
      },
      "25 seconds",
      parallelAuthHeaders(),
    )
  }

  return McpWebSearch.call(
    http,
    McpWebSearch.EXA_URL,
    "web_search_exa",
    McpWebSearch.SearchArgs,
    {
      query: params.query,
      type: params.type || "auto",
      numResults: Math.min(params.numResults || 8, MAX_RESULTS), // kilocode_change - cap at MAX_RESULTS
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    },
    "25 seconds",
  )
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service
    const authSvc = yield* Auth.Service // kilocode_change - source Kilo bearer for Kilo-REST transport

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const provider = selectWebSearchProvider(ctx.sessionID, {
            exa: flags.enableExa,
            parallel: flags.enableParallel,
          })
          const title = webSearchProviderLabel(provider)
          // kilocode_change start - Kilo-REST Exa transport
          // Precedence:
          //   provider="kilo-exa"          -> kilo-rest  (auth required)
          //   provider="exa" + EXA_API_KEY -> mcp-exa-byok     (BYOK wins)
          //   provider="exa" + Kilo auth   -> kilo-rest        (new default for authed users)
          //   provider="exa" + no auth     -> mcp-exa-unauth   (preserves current fallback)
          //   provider="parallel"          -> mcp-parallel     (unchanged)
          const kiloToken = yield* Effect.gen(function* () {
            if (provider !== "exa" && provider !== "kilo-exa") return undefined as string | undefined
            const info = yield* authSvc.get("kilo")
            if (!info) return undefined
            return info.type === "api" ? info.key : info.type === "oauth" ? info.access : undefined
          })
          const transport =
            provider === "kilo-exa"
              ? "kilo-rest"
              : provider === "parallel"
                ? "mcp-parallel"
                : provider === "exa" && process.env.EXA_API_KEY
                  ? "mcp-exa-byok"
                  : provider === "exa" && kiloToken
                    ? "kilo-rest"
                    : "mcp-exa-unauth"
          // kilocode_change end
          // kilocode_change start - add transport to metadata
          yield* ctx.metadata({
            title: `${title} "${params.query}"`,
            metadata: { provider, transport },
          })
          // kilocode_change end

          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              provider,
            },
          })

          // kilocode_change start - dispatch Kilo-REST transport
          const result = yield* transport === "kilo-rest"
            ? kiloToken
              ? KiloExa.callKiloExa(
                  http,
                  {
                    query: params.query,
                    type: params.type,
                    numResults: params.numResults,
                  },
                  kiloToken,
                )
              : Effect.die(new Error("KILO_WEBSEARCH_PROVIDER=kilo-exa requires Kilo auth; run `kilo auth login`"))
            : callProvider(http, provider, params, ctx)
          // kilocode_change end

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${title}: ${params.query}`,
            metadata: { provider, transport }, // kilocode_change - add transport
          }
        }).pipe(Effect.orDie),
    }
  }),
)
