import { Effect, Stream } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "../auth"
import { render as renderEndpoint } from "../endpoint"
import { Framing, type Framing as FramingDef } from "../framing"
import type { Transport, TransportPrepareInput } from "./index"
import * as ProviderShared from "../../protocols/shared"
import { mergeJsonRecords, type LLMRequest, RateLimit } from "../../schema"

export type JsonRequestInput<Body> = TransportPrepareInput<Body>

export interface JsonRequestParts<Body = unknown> {
  readonly url: string
  readonly jsonBody: Body | Record<string, unknown>
  readonly bodyText: string
  readonly headers: Headers.Headers
}

export interface HttpPrepared<Frame> {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly framing: FramingDef<Frame>
}

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url
  const next = new URL(url)
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value))
  return next.toString()
}

const PROTOCOL_BODY_OVERLAY_DENYLIST = new Set([
  "content",
  "contents",
  "frequencyPenalty",
  "frequency_penalty",
  "generationConfig",
  "inferenceConfig",
  "input",
  "maxTokens",
  "max_tokens",
  "messages",
  "model",
  "presencePenalty",
  "presence_penalty",
  "responseFormat",
  "response_format",
  "seed",
  "stop",
  "stopSequences",
  "stop_sequences",
  "stream",
  "streamOptions",
  "stream_options",
  "system",
  "systemInstruction",
  "system_instruction",
  "temperature",
  "thinking",
  "toolChoice",
  "toolConfig",
  "tool_choice",
  "tool_config",
  "tools",
  "topK",
  "topP",
  "top_k",
  "top_p",
])

const forbiddenBodyOverlayKeys = (body: Record<string, unknown>) =>
  Object.keys(body).filter((key) => PROTOCOL_BODY_OVERLAY_DENYLIST.has(key))

const bodyWithOverlay = <Body>(body: Body, request: LLMRequest, encodeBody: (body: Body) => string) =>
  Effect.gen(function* () {
    if (request.http?.body === undefined) return { jsonBody: body, bodyText: encodeBody(body) }
    const forbiddenKeys = forbiddenBodyOverlayKeys(request.http.body)
    if (forbiddenKeys.length > 0)
      return yield* ProviderShared.invalidRequest(
        `http.body cannot overlay protocol-owned field(s): ${forbiddenKeys.join(", ")}`,
      )
    if (ProviderShared.isRecord(body)) {
      const overlaid = mergeJsonRecords(body, request.http.body) ?? {}
      return { jsonBody: overlaid, bodyText: ProviderShared.encodeJson(overlaid) }
    }
    return yield* ProviderShared.invalidRequest("http.body can only overlay JSON object request bodies")
  })

const KiloRateLimitRPM = "x-kilo-ratelimit-rpm"
const KiloRateLimitRPS = "x-kilo-ratelimit-rps"

const parseRateLimitHeaders = (headers: Record<string, string>): { rpm?: number; rps?: number } => {
  const rpm = headers[KiloRateLimitRPM] !== undefined ? Number(headers[KiloRateLimitRPM]) : undefined
  const rps = headers[KiloRateLimitRPS] !== undefined ? Number(headers[KiloRateLimitRPS]) : undefined
  if (Number.isFinite(rpm) && Number.isFinite(rps)) return { rpm, rps }
  if (Number.isFinite(rpm)) return { rpm }
  if (Number.isFinite(rps)) return { rps }
  return {}
}

const IdleEvictionMs = 300_000

interface RateLimitState {
   window: number[]
   rpm?: number
   rps?: number
   idleSince: number
 }

 const rateLimiters = new Map<string, RateLimitState>()

 const evictIdle = () => {
   const now = Date.now()
   for (const [key, state] of rateLimiters) {
     if (now - state.idleSince > IdleEvictionMs) {
       rateLimiters.delete(key)
     }
   }
 }

 const getOrInitLimiter = (provider: string, rpm?: number, rps?: number) => {
   evictIdle()
   const existing = rateLimiters.get(provider)
   if (existing && existing.rpm === rpm && existing.rps === rps) return existing
   const state: RateLimitState = { window: [], rpm, rps, idleSince: Date.now() }
   rateLimiters.set(provider, state)
   return state
 }

 const checkRateLimit = (state: RateLimitState): number | undefined => {
   const now = Date.now()
   state.idleSince = now
   if (state.rpm !== undefined) {
     state.window = state.window.filter((t) => now - t < 60_000)
     if (state.window.length >= state.rpm) {
       const oldest = state.window[0]
       const wait = 60_000 - (now - oldest)
       return wait > 0 ? wait : undefined
     }
   }
   if (state.rps !== undefined) {
     const oneSecondAgo = now - 1000
     state.window = state.window.filter((t) => t > oneSecondAgo)
     if (state.window.length >= state.rps) {
       const oldest = state.window[0]
       if (oldest !== undefined) {
         const wait = 1000 - (now - oldest) + 1
         return wait > 0 ? Math.min(wait, 5000) : undefined
       }
     }
   }
   return undefined
 }

 const extractProvider = (baseURL: string) => {
   if (!baseURL) return "unknown"
   try {
     const parsed = new URL(baseURL)
     return parsed.hostname
   } catch {
     const segments = baseURL.split("/")
     return segments[2] || "unknown"
   }
 }

 const withRateLimit = <A, E>(request: LLMRequest, fn: () => Effect.Effect<A, E>) => {
   const headers = parseRateLimitHeaders(request.http?.headers ?? {})
   const rateLimit = request.rateLimit
   const rpm = headers.rpm ?? rateLimit?.rpm
   const rps = headers.rps ?? rateLimit?.rps
   if (!rpm && !rps) return fn()
   const provider = extractProvider(typeof request.model.route.endpoint.baseURL === "string" ? request.model.route.endpoint.baseURL : "")
   const limiter = getOrInitLimiter(provider, rpm, rps)
   const wait = checkRateLimit(limiter)
   if (wait !== undefined) {
     return Effect.sleep(wait).pipe(Effect.flatMap(() => fn()))
   }
   limiter.window.push(Date.now())
   return fn()
 }

export const jsonRequestParts = <Body>(input: JsonRequestInput<Body>) =>
  Effect.gen(function* () {
    const url = applyQuery(
      renderEndpoint(input.endpoint, { request: input.request, body: input.body }).toString(),
      input.request.http?.query,
    )
    const body = yield* bodyWithOverlay(input.body, input.request, input.encodeBody)
    const headers = yield* Auth.toEffect(input.auth)({
      request: input.request,
      method: "POST",
      url,
      body: body.bodyText,
      headers: Headers.fromInput({
        ...input.headers?.({ request: input.request }),
        ...input.request.http?.headers,
        ...(() => {
          const rateLimit = input.request.rateLimit
          if (!rateLimit || (rateLimit.rpm === undefined && rateLimit.rps === undefined)) return {}
          const result: Record<string, string> = {}
          if (rateLimit.rpm !== undefined) result["x-kilo-ratelimit-rpm"] = String(rateLimit.rpm)
          if (rateLimit.rps !== undefined) result["x-kilo-ratelimit-rps"] = String(rateLimit.rps)
          return result
        })(),
      }),
    })
    return { url, jsonBody: body.jsonBody, bodyText: body.bodyText, headers }
  })

export interface HttpJsonInput<_Body, Frame> {
  readonly framing: FramingDef<Frame>
}

export type HttpJsonPatch<Body, Frame> = Partial<HttpJsonInput<Body, Frame>>

export interface HttpJsonTransport<Body, Frame> extends Transport<Body, HttpPrepared<Frame>, Frame> {
  readonly with: (patch: HttpJsonPatch<Body, Frame>) => HttpJsonTransport<Body, Frame>
}

export const httpJson = <Body, Frame>(input: HttpJsonInput<Body, Frame>): HttpJsonTransport<Body, Frame> => ({
  id: "http-json",
  with: (patch) => httpJson({ ...input, ...patch }),
  prepare: (prepareInput) =>
    jsonRequestParts({
      ...prepareInput,
    }).pipe(
      Effect.map((parts) => ({
        request: ProviderShared.jsonPost({ url: parts.url, body: parts.bodyText, headers: parts.headers }),
        framing: input.framing,
      })),
    ),
  frames: (prepared, request, runtime) =>
    Stream.unwrap(
      withRateLimit(request, () =>
        runtime.http
          .execute(prepared.request)
          .pipe(
            Effect.map((response) =>
              prepared.framing.frame(
                response.stream.pipe(
                  Stream.mapError((error) =>
                    ProviderShared.eventError(
                      `${request.model.provider}/${request.model.route.id}`,
                      `Failed to read ${request.model.provider}/${request.model.route.id} stream`,
                      ProviderShared.errorText(error),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ),
    ),
})

export const sseJson = {
  id: "http-json/sse",
  with: <Body>() => httpJson<Body, string>({ framing: Framing.sse }),
} as const
