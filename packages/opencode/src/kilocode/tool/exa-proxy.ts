// kilocode_change - new file
//
// Proxied Exa endpoint for Kilo users.
// When Kilo auth is present, routes Exa requests through api.kilo.ai/api/exa
// instead of the public mcp.exa.ai MCP endpoint. This gives Kilo users free
// Exa credits with overage charged to Kilo Credits.

import type { Duration } from "effect"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "@/auth"
import { KILO_API_BASE, HEADER_ORGANIZATIONID } from "@kilocode/kilo-gateway"

type ExaResult = {
  title?: string
  url?: string
  publishedDate?: string
  highlights?: string[]
  text?: string
  summary?: string
}

async function credentials(): Promise<{ token: string; org?: string } | undefined> {
  const auth = await Auth.get("kilo")
  if (!auth) return undefined
  if (auth.type === "api") return { token: auth.key }
  if (auth.type === "oauth") return { token: auth.access, org: auth.accountId }
  return undefined
}

function format(results: ExaResult[]): string {
  if (!results.length) return "No results found."
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
 * If Kilo auth is available and the tool is a known Exa tool, call the
 * Kilo proxy and return the formatted result. Returns undefined to signal
 * the caller should fall back to the public MCP endpoint.
 */
export function kiloExaCall(
  http: HttpClient.HttpClient,
  tool: string,
  value: Record<string, unknown>,
  timeout: Duration.Input,
): Effect.Effect<string | undefined> {
  const body = toBody(tool, value)
  if (!body) return Effect.succeed(undefined)

  return Effect.gen(function* () {
    const auth = yield* Effect.promise(credentials)
    if (!auth) return undefined

    const h: Record<string, string> = {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    }
    if (auth.org) h[HEADER_ORGANIZATIONID] = auth.org

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
    const json = (yield* response.json) as { results?: ExaResult[] }
    return format(json.results ?? [])
  })
}
