export * as KiloStream from "./stream.js"

import { Option, Schema } from "effect"
import { KiloErrors } from "./errors.js"

const JsonValue = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownOption(JsonValue)
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/

export interface StreamMetadata {
  readonly routedModelID?: string
  readonly gateway?: Record<string, unknown>
  readonly vercelID?: string
  readonly generationID?: string
  readonly responseID?: string
}

// Inspects a single decoded SSE JSON payload for Kilo Gateway routing metadata
// (ported from v1 `packages/kilo-gateway/src/gateway-metadata.ts` and `routed.ts`).
export function extractMetadata(payload: unknown): StreamMetadata {
  if (!isRecord(payload)) return {}
  const response = isRecord(payload.response) ? payload.response : undefined
  const message = isRecord(payload.message) ? payload.message : undefined
  const firstChoice = Array.isArray(payload.choices) && isRecord(payload.choices[0]) ? payload.choices[0] : undefined
  const delta = isRecord(firstChoice?.delta) ? firstChoice.delta : undefined

  const gateway =
    readGateway(payload.provider_metadata) ??
    readGateway(response?.provider_metadata) ??
    readGateway(message?.provider_metadata) ??
    readGateway(delta?.provider_metadata)

  const routedFromGateway = gateway ? extractRoutedSlug(gateway) : undefined
  const directModel =
    validModelID(routedFromGateway) ??
    validModelID(response?.model) ??
    validModelID(message?.model) ??
    validModelID(payload.model)

  return {
    ...(directModel ? { routedModelID: directModel } : {}),
    ...(gateway ? { gateway } : {}),
    ...(typeof gateway?.generationId === "string" ? { generationID: gateway.generationId } : {}),
    ...(typeof (response?.id ?? message?.id ?? payload.id) === "string"
      ? { responseID: String(response?.id ?? message?.id ?? payload.id) }
      : {}),
  }
}

// Normalizes a single SSE `data: <json>` payload so that:
// 1. Mid-stream error frames (`response.failed`, envelope-less `{ error }`, bare `{ code, message }`) are
//    rewritten into the standard `{ type: "error", error: { code, type, message } }` shape with Kilo's
//    formatted error message.
// 2. Routing metadata (`routedModelID`, `gateway`) is reported to `onMetadata` and stamped onto `usage`
//    when present so `OpenAIChat` / `OpenRouter` `Usage.providerMetadata` retains `routedModelID`.
export function transformSseData(
  rawData: string,
  onMetadata?: (meta: StreamMetadata) => void,
  currentRoutedModelID?: string,
  currentMetadata?: StreamMetadata,
): string {
  const trimmed = rawData.trim()
  if (!trimmed || trimmed === "[DONE]") return rawData
  const decoded = decodeJson(trimmed)
  if (Option.isNone(decoded) || !isRecord(decoded.value)) return rawData
  const payload = decoded.value

  const meta = extractMetadata(payload)
  if (onMetadata && Object.keys(meta).length > 0) {
    onMetadata(meta)
  }
  const gateway = meta.gateway ? { ...currentMetadata?.gateway, ...meta.gateway } : currentMetadata?.gateway
  const effectiveRoutedModelID =
    (gateway && validModelID(extractRoutedSlug(gateway))) ?? meta.routedModelID ?? currentRoutedModelID

  // Only rewrite frames that represent an error (`type === "error"`, `type === "response.failed"`,
  // top-level `error` field, or bare `{ code, message }` without normal stream fields).
  const isErrorFrame =
    payload.type === "error" ||
    payload.type === "response.failed" ||
    payload.error !== undefined ||
    (payload.type === undefined &&
      payload.choices === undefined &&
      payload.id === undefined &&
      typeof payload.message === "string" &&
      (payload.code !== undefined || payload.message.trim().startsWith("{")))
  if (isErrorFrame) {
    const parsed = KiloErrors.parse(payload)
    if (!parsed) return rawData
    return JSON.stringify({
      ...payload,
      type: "error",
      // Anthropic reserves `message` for a message object, not a serialized error envelope.
      message: typeof payload.message === "string" ? undefined : payload.message,
      error: KiloErrors.toError(parsed),
    })
  }

  // Only usage frames are stamped; leave every other chunk (text deltas) byte-for-byte untouched.
  const usageFrame = [payload, payload.response, payload.message].some(
    (value) => isRecord(value) && isRecord(value.usage),
  )
  if (!usageFrame) return rawData
  const identity = {
    ...(effectiveRoutedModelID ? { routedModelID: effectiveRoutedModelID } : {}),
    ...(gateway ? { gateway } : {}),
    ...(currentMetadata?.vercelID ? { vercelID: currentMetadata.vercelID } : {}),
    ...((meta.generationID ?? currentMetadata?.generationID)
      ? { generationID: meta.generationID ?? currentMetadata?.generationID }
      : {}),
    ...((meta.responseID ?? currentMetadata?.responseID)
      ? { responseID: meta.responseID ?? currentMetadata?.responseID }
      : {}),
  }
  if (Object.keys(identity).length === 0) return rawData
  // All three Gateway dialects retain their raw usage through Usage.providerMetadata.
  const stamp = (value: Record<string, unknown>) => ({
    ...value,
    ...(isRecord(value.usage) ? { usage: { ...value.usage, ...identity } } : {}),
  })
  return JSON.stringify({
    ...stamp(payload),
    ...(isRecord(payload.response) ? { response: stamp(payload.response) } : {}),
    ...(isRecord(payload.message) ? { message: stamp(payload.message) } : {}),
  })
}

// Wraps an HTTP 200 `text/event-stream` `Response` to extract `routedModelID` / `x-vercel-id` and
// normalize mid-stream SSE error frames on the fly.
export function transformResponse(response: Response, onComplete?: (metadata: StreamMetadata) => void): Response {
  const contentType = response.headers.get("content-type") ?? ""
  const vercelID = response.headers.get("x-vercel-id")?.trim() || undefined
  const sse = contentType.includes("text/event-stream")
  if (!response.body || (!sse && !contentType.includes("application/json"))) {
    if (vercelID && onComplete) onComplete({ vercelID })
    return response
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  let routedModelID: string | undefined
  let gateway: Record<string, unknown> | undefined
  let generationID: string | undefined
  let responseID: string | undefined

  const recordMeta = (meta: StreamMetadata) => {
    if (meta.gateway) gateway = { ...gateway, ...meta.gateway }
    routedModelID = (gateway && validModelID(extractRoutedSlug(gateway))) ?? meta.routedModelID ?? routedModelID
    if (meta.generationID) generationID = meta.generationID
    if (meta.responseID) responseID = meta.responseID
  }

  const processLine = (line: string): string => {
    const cr = line.endsWith("\r") ? "\r" : ""
    const stripped = cr ? line.slice(0, -1) : line
    if (!stripped.startsWith("data:")) return line
    const content = stripped.slice("data:".length).replace(/^ /, "")
    const next = transformSseData(content, recordMeta, routedModelID, { gateway, vercelID, generationID, responseID })
    return next === content ? line : `data: ${next}${cr}`
  }

  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        if (!sse) return
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        if (lines.length > 0) {
          controller.enqueue(encoder.encode(`${lines.map(processLine).join("\n")}\n`))
        }
      },
      flush(controller) {
        buffer += decoder.decode()
        if (buffer.length > 0) {
          controller.enqueue(
            encoder.encode(
              sse
                ? processLine(buffer)
                : transformSseData(buffer, recordMeta, routedModelID, { gateway, vercelID, generationID, responseID }),
            ),
          )
          buffer = ""
        }
        if (onComplete) {
          onComplete({
            ...(routedModelID ? { routedModelID } : {}),
            ...(gateway ? { gateway } : {}),
            ...(vercelID ? { vercelID } : {}),
            ...(generationID ? { generationID } : {}),
            ...(responseID ? { responseID } : {}),
          })
        }
      },
    }),
  )

  const headers = new Headers(response.headers)
  headers.delete("content-length")
  headers.delete("content-encoding")
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function readGateway(providerMetadata: unknown): Record<string, unknown> | undefined {
  if (!isRecord(providerMetadata)) return undefined
  return isRecord(providerMetadata.gateway) ? providerMetadata.gateway : undefined
}

function extractRoutedSlug(gateway: Record<string, unknown>): string | undefined {
  const routing = isRecord(gateway.routing) ? gateway.routing : undefined
  if (!routing) return undefined
  const attempts = Array.isArray(routing.modelAttempts) ? routing.modelAttempts : []
  for (let i = attempts.length - 1; i >= 0; i--) {
    const item = attempts[i]
    if (
      isRecord(item) &&
      item.success === true &&
      typeof item.canonicalSlug === "string" &&
      item.canonicalSlug.trim()
    ) {
      return item.canonicalSlug.trim()
    }
  }
  return typeof routing.canonicalSlug === "string" && routing.canonicalSlug.trim()
    ? routing.canonicalSlug.trim()
    : undefined
}

function validModelID(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 256 || !MODEL_ID_PATTERN.test(trimmed)) return undefined
  return trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
