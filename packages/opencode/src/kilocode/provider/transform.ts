import type { ModelMessage } from "ai"
import type * as Provider from "@/provider/provider"

// kilocode_change - new file (#42 / upstream #15215)

/** Kilo Gateway's AI SDK package. Its models are served through OpenRouter. */
const KILO_GATEWAY_NPM = "@kilocode/kilo-gateway"

/**
 * `format` for a synthesized reasoning detail.
 *
 * `@openrouter/ai-sdk-provider` drops `reasoning.text` details whose format is
 * `anthropic-claude-v1` or `google-gemini-v1` when they carry no `signature`,
 * and `DEFAULT_REASONING_FORMAT` is `anthropic-claude-v1`. Omitting `format`
 * would therefore be filtered out and the wire field would stay absent, so the
 * value has to be stated explicitly. `unknown` is the SDK's own enum member for
 * "vendor format not modelled here" and is exempt from the signature rule.
 */
const SYNTHESIZED_FORMAT = "unknown"

/** Formats the SDK requires a `signature` for. Mirrors `DEFAULT_REASONING_FORMAT`. */
const SIGNATURE_REQUIRED_FORMATS = new Set(["anthropic-claude-v1", "google-gemini-v1"])
const DEFAULT_SDK_FORMAT = "anthropic-claude-v1"

type Part = {
  type?: string
  text?: unknown
  providerOptions?: Record<string, any> | undefined
}

type Msg = ModelMessage & {
  role?: string
  content?: unknown
  providerOptions?: Record<string, any> | undefined
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function reasoningDetailsOf(holder: { providerOptions?: Record<string, any> | undefined } | undefined) {
  const providerOptions = holder?.providerOptions
  if (!isRecord(providerOptions) || !isRecord(providerOptions.openrouter)) return undefined
  const details = providerOptions.openrouter.reasoning_details
  return Array.isArray(details) ? details : undefined
}

/**
 * Whether the SDK would keep this detail. It filters unsigned `reasoning.text`
 * entries in signature-bound formats before deciding whether to emit `reasoning`,
 * so a detail that fails here still reproduces the #42 failure.
 */
function isUsableDetail(detail: unknown) {
  if (!isRecord(detail) || detail.type !== "reasoning.text") return true
  const format = typeof detail.format === "string" ? detail.format : DEFAULT_SDK_FORMAT
  if (!SIGNATURE_REQUIRED_FORMATS.has(format)) return true
  return typeof detail.signature === "string" && detail.signature.length > 0
}

/**
 * The SDK's `findFirstReasoningDetails`: every `tool-call` part first, then
 * every `reasoning` part, returning the first one that carries details.
 */
function firstPartDetails(parts: Part[]) {
  for (const type of ["tool-call", "reasoning"] as const) {
    for (const part of parts) {
      if (part?.type !== type) continue
      const details = reasoningDetailsOf(part)
      if (details?.length) return details
    }
  }
  return []
}

/**
 * Whether the message already carries replay details the SDK can actually use.
 *
 * The SDK picks the message-level array whenever it is an array at all — an
 * empty one included, which then shadows any part-level details — and only
 * otherwise falls back to the first part that carries some. It then drops
 * unsigned `reasoning.text` entries in signature-bound formats before deciding
 * whether to emit `reasoning`. Anything this predicate rejects would leave the
 * wire field missing and reproduce the #42 failure, so a replay has to be added
 * instead. One usable entry is enough: that is what the SDK needs to set
 * `reasoning`, even if it drops its siblings.
 */
function hasUsableDetails(msg: Msg, parts: Part[]) {
  const fromMessage = reasoningDetailsOf(msg)
  const candidates = fromMessage ?? firstPartDetails(parts)
  return candidates.some(isUsableDetail)
}

/**
 * Kilo Gateway reasoning replay (#42 / upstream #15215).
 *
 * Kilo Gateway models default to the OpenRouter AI SDK runtime
 * (`kilocode/provider/provider.ts` `getModel` falls back to `sdk.languageModel`,
 * which `createKilo()` backs with `createOpenRouter`), so their providerOptions
 * key is `openrouter`. That SDK only re-emits assistant reasoning on the wire
 * when replay details are present:
 *
 * ```ts
 * const effectiveReasoning = reasoning && finalReasoningDetails?.length > 0 ? reasoning : undefined
 * ```
 *
 * `reasoning` is accumulated from the reasoning parts of the message, but
 * `finalReasoningDetails` comes solely from `providerOptions.openrouter.reasoning_details`.
 * opencode only persists those details when the provider reported them
 * (`kilocode/session/reasoning-replay.ts`). Providers that answer with a bare
 * `reasoning` string — Beam 1.0 free (`kilo/reflection/beam-free`), Kimi K2
 * thinking, MiMo, DeepSeek deployments behind the gateway — produce reasoning
 * parts with no details, so the next turn sends no reasoning at all and the
 * gateway rejects it with `Missing required parameter: messages[N].reasoning_content`.
 *
 * Backfilling the replay detail at request-assembly time fixes already-stored
 * sessions too, since nothing has to be re-fetched or migrated.
 *
 * The reasoning parts are deliberately left in `content`: the OpenRouter SDK
 * needs them for `reasoning`, and `@ai-sdk/openai-compatible` (used when a
 * catalog entry sets `ai_sdk_provider: "openai-compatible"`) derives
 * `reasoning_content` from those very parts. The cost is that a replayed turn
 * carries the reasoning text twice on the wire — as `reasoning` and again
 * inside `reasoning_details[].text` — because the two runtimes need different
 * shapes.
 *
 * Scope: this covers the default Kilo Gateway runtime. A model routed elsewhere
 * by `ai_sdk_provider` reaches a different SDK and is gated out above.
 *
 * An explicitly configured `interleaved` field is treated as authoritative.
 * `normalizeMessages` runs first and already moves reasoning into
 * `openaiCompatible[field]` for such models, so this hook finds no reasoning
 * parts and stays out of the way; the guard keeps that true if the upstream
 * branch is ever changed to stop stripping.
 *
 * Assistant turns whose reasoning text is empty are left alone: the synthesized
 * detail would be empty, and the SDK's duplicate tracker keys `reasoning.text`
 * on its text (`getCanonicalKey` → `null`), so an empty entry is dropped and
 * could not unblock the wire field.
 *
 * `providerOptions.openrouter.reasoning_details` is read directly rather than
 * through the SDK's schema. That is equivalent here: the schema object is a
 * plain strip-mode zod object, so unrelated sibling keys are dropped without
 * failing the parse and the details stay readable.
 *
 * Returns `undefined` when nothing applies, so callers can keep the original
 * array identity.
 */
export function applyKiloGatewayReasoning(
  msgs: ModelMessage[],
  model: Provider.Model,
): ModelMessage[] | undefined {
  if (model.api.npm !== KILO_GATEWAY_NPM) return undefined
  // Kilo Gateway routes a model to sdk.anthropic / sdk.openai /
  // sdk.openaiCompatible when the catalog sets `ai_sdk_provider`. Those SDKs do
  // not read `openrouter.*` — and the openai-compatible one already derives
  // `reasoning_content` from the reasoning parts themselves. Only the default
  // (openrouter) runtime needs the replay.
  if (model.ai_sdk_provider && model.ai_sdk_provider !== "openrouter") return undefined
  if (!model.capabilities?.reasoning) return undefined
  // A configured interleaved field (catalog or user config) is authoritative.
  const interleaved = model.capabilities?.interleaved
  if (isRecord(interleaved) && typeof interleaved.field === "string" && interleaved.field.length > 0) return undefined

  let changed = false
  const next = msgs.map((msg) => {
    const candidate = msg as Msg
    if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return msg

    const parts = candidate.content as Part[]
    const text = parts
      .filter((part) => part?.type === "reasoning")
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
    // An empty detail is dropped by the SDK's duplicate tracker, so it could not
    // unblock the wire field. Leave those messages alone.
    if (text.length === 0) return msg
    if (hasUsableDetails(candidate, parts)) return msg

    changed = true
    const providerOptions = isRecord(candidate.providerOptions) ? candidate.providerOptions : {}
    const openrouter = isRecord(providerOptions.openrouter) ? providerOptions.openrouter : {}
    return {
      ...candidate,
      providerOptions: {
        ...providerOptions,
        openrouter: {
          ...openrouter,
          reasoning_details: [{ type: "reasoning.text", text, format: SYNTHESIZED_FORMAT }],
        },
      },
    } as ModelMessage
  })

  return changed ? next : undefined
}
