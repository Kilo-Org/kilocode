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

// kilocode_change start - add `"native"` as a provider-hosted alternative to
// Exa/Parallel. When selected, web search is executed at the model provider
// (Anthropic server-side web_search) instead of egressing to Exa/Parallel.
const WebSearchProviderSchema = Schema.Literals(["exa", "parallel", "kilo-exa", "native"]) // kilocode_change - native + kilo-exa
export type WebSearchProvider = Schema.Schema.Type<typeof WebSearchProviderSchema>

export function selectWebSearchProvider(sessionID: string, flags = { exa: false, parallel: false }): WebSearchProvider {
  const override = process.env.KILO_WEBSEARCH_PROVIDER
  // kilocode_change - allow native + kilo-exa env overrides
  if (override === "exa" || override === "parallel" || override === "kilo-exa" || override === "native") return override
  if (flags.parallel) return "parallel"
  if (flags.exa) return "exa"

  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa" || provider === "kilo-exa") return "Exa Web Search" // kilocode_change - kilo-exa shares label
  // kilocode_change start - Anthropic Web Search label
  if (provider === "native") return "Anthropic Web Search"
  // kilocode_change end
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

// kilocode_change start - provider-hosted (Anthropic-native) web search tool.
// `nativeAnthropicWebSearchTool` builds a ToolDefinition whose `native.anthropic`
// descriptor the @opencode-ai/llm Anthropic protocol lowers to
// `{ type: "web_search_20250305", ... }`; Claude runs the search server-side and
// results round-trip through the existing parser. Only @ai-sdk/anthropic Claude.
import type { ToolDefinition } from "@opencode-ai/llm" // kilocode_change

export interface AnthropicWebSearchOptions {
  readonly variant?: "web_search_20250305" | "web_search_20260209"
  readonly maxUses?: number
  readonly allowedDomains?: ReadonlyArray<string>
  readonly blockedDomains?: ReadonlyArray<string>
  readonly userLocation?: {
    readonly type: "approximate"
    readonly city?: string
    readonly region?: string
    readonly country?: string
    readonly timezone?: string
  }
}

const anthropicWebSearchNative = (opts: AnthropicWebSearchOptions) => {
  const anthropic: Record<string, unknown> = {
    type: opts.variant ?? "web_search_20250305",
    name: "web_search",
  }
  if (opts.maxUses !== undefined) anthropic.max_uses = opts.maxUses
  if (opts.allowedDomains) anthropic.allowed_domains = [...opts.allowedDomains]
  if (opts.blockedDomains) anthropic.blocked_domains = [...opts.blockedDomains]
  if (opts.userLocation) anthropic.user_location = opts.userLocation
  return { anthropic }
}

export function nativeAnthropicWebSearchTool(opts: AnthropicWebSearchOptions = {}): ToolDefinition.Input {
  return {
    name: "web_search",
    description: "Search the web using Anthropic's hosted web_search server tool.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    native: anthropicWebSearchNative(opts),
  }
}

/** Hosted (provider-native) web search is only available on @ai-sdk/anthropic Claude models. */
export function nativeWebSearchEnabled(modelNpm: string | undefined): boolean {
  return modelNpm === "@ai-sdk/anthropic" || modelNpm === "@ai-sdk/google-vertex/anthropic"
}

/**
 * Registry-only gate: true when the native hosted override is selected AND the
 * model supports it. Unlike `selectWebSearchProvider`, this is session-agnostic
 * (the 50/50 exa/parallel fallback is resolved later inside WebSearchTool with
 * the real sessionID).
 */
export function nativeWebSearchSelected(modelNpm: string | undefined): boolean {
  return process.env.KILO_WEBSEARCH_PROVIDER === "native" && nativeWebSearchEnabled(modelNpm)
}
// kilocode_change end
