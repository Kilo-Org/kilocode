// kilocode_change - new file
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

function headers(auth: { token: string; org?: string }): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    "Content-Type": "application/json",
  }
  if (auth.org) h[HEADER_ORGANIZATIONID] = auth.org
  return h
}

export const search = (
  http: HttpClient.HttpClient,
  params: {
    query: string
    type: string
    numResults: number
    livecrawl: string
    contextMaxCharacters?: number
  },
  timeout: Duration.Input,
) =>
  Effect.gen(function* () {
    const auth = yield* Effect.promise(credentials)
    if (!auth) return yield* Effect.die(new Error("Not authenticated with Kilo Gateway"))

    const body: Record<string, unknown> = {
      query: params.query,
      numResults: params.numResults,
      type: params.type,
      contents: {
        text: params.contextMaxCharacters ? { maxCharacters: params.contextMaxCharacters } : true,
        highlights: true,
      },
      livecrawl: params.livecrawl,
    }

    const request = yield* HttpClientRequest.post(`${KILO_API_BASE}/api/exa/search`).pipe(
      HttpClientRequest.setHeaders(headers(auth)),
      HttpClientRequest.bodyJson(body),
    )

    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.die(new Error("Exa proxy search request timed out")),
        }),
      )

    const json = (yield* response.json) as ExaResponse
    return format(json.results ?? [])
  })

export const context = (
  http: HttpClient.HttpClient,
  params: {
    query: string
    tokensNum: number
  },
  timeout: Duration.Input,
) =>
  Effect.gen(function* () {
    const auth = yield* Effect.promise(credentials)
    if (!auth) return yield* Effect.die(new Error("Not authenticated with Kilo Gateway"))

    const body: Record<string, unknown> = {
      query: params.query,
      numResults: 5,
      type: "auto",
      contents: {
        text: { maxCharacters: params.tokensNum * 4 },
      },
    }

    const request = yield* HttpClientRequest.post(`${KILO_API_BASE}/api/exa/search`).pipe(
      HttpClientRequest.setHeaders(headers(auth)),
      HttpClientRequest.bodyJson(body),
    )

    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.die(new Error("Exa proxy context request timed out")),
        }),
      )

    const json = (yield* response.json) as ExaResponse
    return format(json.results ?? [])
  })
