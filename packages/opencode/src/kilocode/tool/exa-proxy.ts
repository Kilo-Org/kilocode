// kilocode_change - new file
//
// Proxied Exa endpoint for Kilo users.
// When Kilo auth is present, routes Exa requests through api.kilo.ai/api/exa
// instead of the public mcp.exa.ai MCP endpoint. This gives Kilo users free
// Exa credits with overage charged to Kilo Credits.

import { Duration, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "@/auth"
import { KILO_API_BASE, HEADER_ORGANIZATIONID } from "@kilocode/kilo-gateway"

type SearchResult = {
  title?: string
  url?: string
  publishedDate?: string
  highlights?: string[]
  text?: string
  summary?: string
}

type ExaResponse = {
  results?: SearchResult[]
}

function format(results: SearchResult[]): string {
  if (results.length === 0) return "No results found."
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

async function credentials(): Promise<{ token: string; org?: string } | undefined> {
  const auth = await Auth.get("kilo")
  if (!auth) return undefined
  if (auth.type === "api") return { token: auth.key }
  if (auth.type === "oauth") return { token: auth.access, org: auth.accountId }
  return undefined
}

function post(
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
    const json = (yield* response.json) as ExaResponse
    return format(json.results ?? [])
  })
}

/**
 * Try to handle an Exa MCP tool call via the Kilo proxy.
 * Returns undefined if Kilo auth is not available (caller should fall back to public MCP).
 */
export function intercept(
  http: HttpClient.HttpClient,
  tool: string,
  value: Record<string, unknown>,
  timeout: Duration.Input,
): Effect.Effect<string | undefined> | undefined {
  if (tool === "web_search_exa") {
    return Effect.gen(function* () {
      const auth = yield* Effect.promise(credentials)
      if (!auth) return undefined
      return yield* post(
        http,
        auth,
        {
          query: value.query,
          numResults: value.numResults,
          type: value.type,
          contents: {
            text: value.contextMaxCharacters ? { maxCharacters: value.contextMaxCharacters } : true,
            highlights: true,
          },
          livecrawl: value.livecrawl,
        },
        timeout,
      )
    })
  }

  if (tool === "get_code_context_exa") {
    return Effect.gen(function* () {
      const auth = yield* Effect.promise(credentials)
      if (!auth) return undefined
      return yield* post(
        http,
        auth,
        {
          query: value.query,
          numResults: 5,
          type: "auto",
          contents: {
            text: { maxCharacters: ((value.tokensNum as number) || 5000) * 4 },
          },
        },
        timeout,
      )
    })
  }

  return undefined
}
