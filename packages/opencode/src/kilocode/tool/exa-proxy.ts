// kilocode_change - new file
//
// Proxied Exa endpoint for Kilo users.
// When Kilo auth is present, routes Exa requests through api.kilo.ai/api/exa
// instead of the public mcp.exa.ai MCP endpoint. This gives Kilo users free
// Exa credits with overage charged to Kilo Credits.

import type { Duration, Schema } from "effect"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "@/auth"
import { KILO_API_BASE, HEADER_ORGANIZATIONID } from "@kilocode/kilo-gateway"

type ExaResponse = {
  results?: {
    title?: string
    url?: string
    publishedDate?: string
    highlights?: string[]
    text?: string
    summary?: string
  }[]
}

type McpCall = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
) => Effect.Effect<string | undefined>

async function credentials(): Promise<{ token: string; org?: string } | undefined> {
  const auth = await Auth.get("kilo")
  if (!auth) return undefined
  if (auth.type === "api") return { token: auth.key }
  if (auth.type === "oauth") return { token: auth.access, org: auth.accountId }
  return undefined
}

function format(results: ExaResponse["results"]): string {
  if (!results?.length) return "No results found."
  return JSON.stringify(
    results.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      ...(r.publishedDate ? { publishedDate: r.publishedDate } : {}),
      ...(r.text ? { text: r.text } : {}),
      ...(r.highlights?.length ? { highlights: r.highlights } : {}),
      ...(r.summary ? { summary: r.summary } : {}),
    })),
    null,
    2,
  )
}

function proxy(
  http: HttpClient.HttpClient,
  auth: { token: string; org?: string },
  body: Record<string, unknown>,
  timeout: Duration.Input,
) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    "Content-Type": "application/json",
  }
  if (auth.org) h[HEADER_ORGANIZATIONID] = auth.org

  return Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(`${KILO_API_BASE}/api/exa/search`).pipe(
      HttpClientRequest.setHeaders(h),
      HttpClientRequest.bodyJson(body),
    )
    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.die(new Error("Exa proxy request timed out")),
        }),
      )
    return format(((yield* response.json) as ExaResponse).results)
  })
}

function toBody(tool: string, value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (tool === "web_search_exa")
    return {
      query: value.query,
      numResults: value.numResults,
      type: value.type,
      livecrawl: value.livecrawl,
      contents: {
        text: value.contextMaxCharacters ? { maxCharacters: value.contextMaxCharacters } : true,
        highlights: true,
      },
    }
  if (tool === "get_code_context_exa")
    return {
      query: value.query,
      numResults: 5,
      type: "auto",
      contents: { text: { maxCharacters: ((value.tokensNum as number) || 5000) * 4 } },
    }
  return undefined
}

/**
 * Wrap the upstream MCP call so Kilo-authenticated users hit
 * api.kilo.ai/api/exa instead of the public mcp.exa.ai endpoint.
 * Falls back to the original MCP call when not authenticated with Kilo
 * or for unrecognised tool names.
 */
export function wrap(mcp: McpCall): McpCall {
  return (http, tool, args, value, timeout) => {
    const body = toBody(tool, value as Record<string, unknown>)
    if (!body) return mcp(http, tool, args, value, timeout)

    return Effect.gen(function* () {
      const auth = yield* Effect.promise(credentials)
      if (!auth) return yield* mcp(http, tool, args, value, timeout)
      return yield* proxy(http, auth, body, timeout)
    })
  }
}
