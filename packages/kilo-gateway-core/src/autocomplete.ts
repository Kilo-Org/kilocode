export * as KiloAutocomplete from "./autocomplete.js"

import { KiloServer } from "./server.js"

export type AutocompleteProviderID = "kilo" | "mistral"
export type DirectAutocompleteProviderID = Exclude<AutocompleteProviderID, "kilo">

export interface AutocompleteModelDef {
  readonly id: string
  readonly modelID: string
  readonly label: string
  readonly providerID: AutocompleteProviderID
  readonly provider: string
  readonly requestModel: string
  readonly directProvider?: DirectAutocompleteProviderID
  readonly temperature: number
}

export const AUTOCOMPLETE_MODELS: readonly AutocompleteModelDef[] = [
  {
    id: "kilo/mistralai/codestral-2508",
    modelID: "mistralai/codestral-2508",
    label: "Codestral",
    providerID: "kilo",
    provider: "Kilo Gateway",
    requestModel: "mistralai/codestral-2508",
    temperature: 0.2,
  },
  {
    id: "mistral/codestral-2508",
    modelID: "codestral-2508",
    label: "Codestral",
    providerID: "mistral",
    provider: "Mistral",
    requestModel: "codestral-2508",
    directProvider: "mistral",
    temperature: 0.2,
  },
]

export const DEFAULT_AUTOCOMPLETE_PROVIDER_ID: AutocompleteProviderID = "kilo"
export const DEFAULT_AUTOCOMPLETE_MODEL_ID = "mistralai/codestral-2508"
export const DEFAULT_AUTOCOMPLETE_MODEL: AutocompleteModelDef = AUTOCOMPLETE_MODELS[0]!

export function getAutocompleteModel(provider?: string, model?: string): AutocompleteModelDef {
  const pid = provider ?? "kilo"
  for (const item of AUTOCOMPLETE_MODELS) {
    if (item.providerID === pid && item.modelID === model) return item
  }
  return DEFAULT_AUTOCOMPLETE_MODEL
}

export function getAutocompleteModelById(id: string): AutocompleteModelDef {
  return AUTOCOMPLETE_MODELS.find((item) => item.id === id) ?? DEFAULT_AUTOCOMPLETE_MODEL
}

export function validAutocompleteProvider(value: unknown) {
  if (typeof value !== "string") return false
  return AUTOCOMPLETE_MODELS.some((item) => item.providerID === value)
}

export function validAutocompleteModel(value: unknown) {
  if (typeof value !== "string") return false
  return AUTOCOMPLETE_MODELS.some((item) => item.modelID === value)
}

export type FimTarget =
  | { readonly provider: "kilo"; readonly model: string; readonly url: string }
  | { readonly provider: "mistral"; readonly model: string }

export const MISTRAL_FIM_URL = "https://api.mistral.ai/v1/fim/completions"
export const CODESTRAL_FIM_URL = "https://codestral.mistral.ai/v1/fim/completions"

export function resolveFimTarget(
  provider?: string,
  model?: string,
  server?: string,
): FimTarget {
  const kiloUrl = `${KiloServer.gateway(server)}/fim/completions`
  if (!provider || provider === "kilo") {
    return { provider: "kilo", model: model ?? DEFAULT_AUTOCOMPLETE_MODEL.requestModel, url: kiloUrl }
  }
  const info = getAutocompleteModel(provider, model)
  if (info.directProvider === "mistral") {
    return { provider: "mistral", model: info.requestModel }
  }
  // An unknown direct provider, such as a retired one, falls back to the default Gateway model.
  return { provider: "kilo", model: info.requestModel, url: kiloUrl }
}

let preferredMistralEndpoint: string | undefined

export function clearMistralFimEndpointCache() {
  preferredMistralEndpoint = undefined
}

export async function requestMistralFim(request: (url: string) => Promise<Response>): Promise<Response> {
  const firstUrl = preferredMistralEndpoint ?? MISTRAL_FIM_URL
  const secondUrl = firstUrl === MISTRAL_FIM_URL ? CODESTRAL_FIM_URL : MISTRAL_FIM_URL
  const first = await request(firstUrl)
  if (first.ok) return first
  if (first.status !== 401 && first.status !== 403) return first
  await first.body?.cancel().catch(() => undefined)
  preferredMistralEndpoint = undefined
  const second = await request(secondUrl)
  if (second.ok) preferredMistralEndpoint = secondUrl
  return second
}

// Direct provider keys fall back to these variables when no stored credential exists.
export const DIRECT_PROVIDER_ENV: Record<DirectAutocompleteProviderID, readonly string[]> = {
  mistral: ["MISTRAL_API_KEY"],
}

export const REQUEST_TIMEOUT_MS = 30_000
const FIM_MAX_TOKENS = 256
const FIM_TEMPERATURE = 0.2

/** A failed provider request with the HTTP status it maps to (499 canceled, 504 timed out). */
export class AutocompleteRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "AutocompleteRequestError"
  }
}

export interface FimResult {
  readonly text: string
  readonly cost: number
  readonly inputTokens: number
  readonly outputTokens: number
}

interface RequestOptions {
  readonly key: string
  /** Attribution headers for the Kilo Gateway; empty for a direct provider. */
  readonly headers?: Record<string, string>
  readonly signal?: AbortSignal
  readonly fetch?: typeof globalThis.fetch
}

/**
 * One FIM completion. The provider streams server-sent events; this reads the stream to the end and returns the
 * collected text with the usage and cost of the last chunks that carry them.
 */
export async function requestFim(
  input: RequestOptions & {
    readonly target: FimTarget
    readonly prefix: string
    readonly suffix: string
    readonly maxTokens?: number
    readonly temperature?: number
  },
): Promise<FimResult> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const run = (url: string) =>
    (input.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.key}`, ...input.headers },
      signal,
      body: JSON.stringify({
        model: input.target.model,
        prompt: input.prefix,
        suffix: input.suffix,
        max_tokens: input.maxTokens ?? FIM_MAX_TOKENS,
        temperature: input.temperature ?? FIM_TEMPERATURE,
        stream: true,
      }),
    })
  try {
    const response = input.target.provider === "mistral" ? await requestMistralFim(run) : await run(input.target.url)
    if (!response.ok) {
      const text = await readText(response)
      throw new AutocompleteRequestError(`FIM request failed: ${response.status} ${text}`, response.status)
    }
    return parseFimStream(await response.text())
  } catch (error) {
    throw requestError(error, timeout, signal)
  }
}

/**
 * The text, usage and cost of a FIM event stream. A chunk carries the text in `choices[0].delta.content` (chat
 * style) or `choices[0].text` (completion style). A body without `data:` lines is read as one JSON chunk.
 */
export function parseFimStream(body: string): FimResult {
  const lines = body.split(/\r?\n/)
  const events = lines.some((line) => line.startsWith("data:"))
    ? lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim())
    : [body.trim()]
  return events
    .filter((data) => data.length > 0 && data !== "[DONE]")
    .map((data) => parseChunk(data))
    .reduce<FimResult>(
      (result, chunk) => {
        const choice = chunk?.choices?.[0]
        const content = choice?.delta?.content ?? choice?.text
        return {
          text: content ? result.text + content : result.text,
          cost: typeof chunk?.cost === "number" ? chunk.cost : result.cost,
          inputTokens: chunk?.usage ? (chunk.usage.prompt_tokens ?? 0) : result.inputTokens,
          outputTokens: chunk?.usage ? (chunk.usage.completion_tokens ?? 0) : result.outputTokens,
        }
      },
      { text: "", cost: 0, inputTokens: 0, outputTokens: 0 },
    )
}

interface FimChunk {
  choices?: { delta?: { content?: string | null }; text?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  cost?: number
}

function parseChunk(data: string): FimChunk | undefined {
  try {
    const value: unknown = JSON.parse(data)
    return typeof value === "object" && value !== null ? (value as FimChunk) : undefined
  } catch {
    return undefined
  }
}

async function readText(response: Response) {
  return response.text().catch(() => "<unreadable>")
}

function requestError(error: unknown, timeout: AbortSignal, signal: AbortSignal) {
  if (error instanceof AutocompleteRequestError) return error
  if ((error instanceof DOMException && error.name === "TimeoutError") || timeout.aborted)
    return new AutocompleteRequestError("FIM request timed out", 504)
  if (signal.aborted) return new AutocompleteRequestError("FIM request canceled", 499)
  return error
}
