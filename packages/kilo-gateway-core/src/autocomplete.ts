export * as KiloAutocomplete from "./autocomplete.js"

import { KiloServer } from "./server.js"

export type AutocompleteProviderID = "kilo" | "mistral" | "inception"
export type DirectAutocompleteProviderID = Exclude<AutocompleteProviderID, "kilo">

interface AutocompleteModelBase {
  readonly id: string
  readonly modelID: string
  readonly label: string
  readonly providerID: AutocompleteProviderID
  readonly provider: string
  readonly requestModel: string
  readonly directProvider?: DirectAutocompleteProviderID
  readonly temperature: number
}

export type AutocompleteModelDef = AutocompleteModelBase &
  (
    | {
        readonly kind: "edit"
        readonly fimModelID: string
      }
    | {
        readonly kind?: "fim"
        readonly fimModelID?: never
      }
  )

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
    id: "kilo/inception/mercury-edit-2",
    modelID: "inception/mercury-edit-2",
    label: "Mercury Edit 2 (FIM)",
    providerID: "kilo",
    provider: "Kilo Gateway",
    requestModel: "inception/mercury-edit-2",
    temperature: 0,
  },
  {
    id: "kilo/inception/mercury-next-edit",
    modelID: "inception/mercury-next-edit",
    label: "Mercury Edit 2 (Next Edit)",
    providerID: "kilo",
    provider: "Kilo Gateway",
    requestModel: "inception/mercury-edit-2",
    temperature: 0,
    kind: "edit",
    fimModelID: "kilo/inception/mercury-edit-2",
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
  {
    id: "inception/mercury-edit-2",
    modelID: "mercury-edit-2",
    label: "Mercury Edit 2 (FIM)",
    providerID: "inception",
    provider: "Inception",
    requestModel: "mercury-edit-2",
    directProvider: "inception",
    temperature: 0,
  },
  {
    id: "inception/mercury-next-edit",
    modelID: "mercury-next-edit",
    label: "Mercury Edit 2 (Next Edit)",
    providerID: "inception",
    provider: "Inception",
    requestModel: "mercury-edit-2",
    directProvider: "inception",
    temperature: 0,
    kind: "edit",
    fimModelID: "inception/mercury-edit-2",
  },
]

export const DEFAULT_AUTOCOMPLETE_PROVIDER_ID: AutocompleteProviderID = "kilo"
export const DEFAULT_AUTOCOMPLETE_MODEL_ID = "inception/mercury-next-edit"
export const DEFAULT_AUTOCOMPLETE_MODEL: AutocompleteModelDef = AUTOCOMPLETE_MODELS[2]!

const aliases: Record<string, string> = {
  "inception/mercury-edit": "inception/mercury-edit-2",
}

export function getAutocompleteModel(provider?: string, model?: string): AutocompleteModelDef {
  const pid = provider ?? "kilo"
  const mid = aliases[model ?? ""] ?? model
  for (const item of AUTOCOMPLETE_MODELS) {
    if (item.providerID === pid && item.modelID === mid) return item
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
  const resolved = aliases[value] ?? value
  return AUTOCOMPLETE_MODELS.some((item) => item.modelID === resolved)
}

export type FimTarget =
  | { readonly provider: "kilo"; readonly model: string; readonly url: string }
  | { readonly provider: "inception"; readonly model: string; readonly url: string }
  | { readonly provider: "mistral"; readonly model: string }

export type EditTarget =
  | { readonly provider: "inception"; readonly model: string; readonly url: string }
  | { readonly provider: "kilo"; readonly model: string; readonly url: string }

const INCEPTION_FIM_URL = "https://api.inceptionlabs.ai/v1/fim/completions"
const INCEPTION_EDIT_URL = "https://api.inceptionlabs.ai/v1/edit/completions"
export const MISTRAL_FIM_URL = "https://api.mistral.ai/v1/fim/completions"
export const CODESTRAL_FIM_URL = "https://codestral.mistral.ai/v1/fim/completions"

export function resolveFimTarget(
  provider?: string,
  model?: string,
  server?: string,
): FimTarget {
  const kiloUrl = `${KiloServer.gateway(server)}/fim/completions`
  if (!provider || provider === "kilo") {
    return { provider: "kilo", model: model ?? "mistralai/codestral-2501", url: kiloUrl }
  }
  const info = getAutocompleteModel(provider, model)
  if (info.directProvider === "mistral") {
    return { provider: "mistral", model: info.requestModel }
  }
  if (info.directProvider === "inception") {
    return { provider: "inception", model: info.requestModel, url: INCEPTION_FIM_URL }
  }
  return { provider: "kilo", model: model ?? "mistralai/codestral-2501", url: kiloUrl }
}

export function resolveEditTarget(
  provider?: string,
  model?: string,
  server?: string,
): EditTarget {
  const info = getAutocompleteModel(provider, model)
  const kiloUrl = `${KiloServer.gateway(server)}/edit/completions`
  if (info.kind === "edit") {
    if (info.providerID === "kilo") {
      const m = info.requestModel.includes("/") ? info.requestModel : `inception/${info.requestModel}`
      return {
        provider: "kilo",
        model: m,
        url: kiloUrl,
      }
    }
    if (info.directProvider === "inception") {
      return { provider: "inception", model: info.requestModel, url: INCEPTION_EDIT_URL }
    }
  }
  return {
    provider: "kilo",
    model: info.requestModel,
    url: "",
  }
}

export function extractFencedBody(message: string): string {
  if (!message) return ""
  const normalized = message.replace(/\r\n/g, "\n")
  const fenceOpen = normalized.indexOf("```")
  if (fenceOpen === -1) return normalized
  const afterFenceOpen = normalized.indexOf("\n", fenceOpen + 3)
  if (afterFenceOpen === -1) return ""
  const fenceClose = normalized.indexOf("```", afterFenceOpen + 1)
  if (fenceClose === -1) return ""
  let body = normalized.slice(afterFenceOpen + 1, fenceClose)
  if (body.endsWith("\n")) body = body.slice(0, -1)
  body = body.replace(/^<\|code_to_edit\|>\n?/, "")
  body = body.replace(/\n?<\|\/code_to_edit\|>$/, "")
  return body
}

// Mercury Next Edit prompt, ported from v1 `edit-prompt.ts`. The Gateway builds it so that every client sends only
// structured editor context. The model defines the tags, so keep them verbatim:
// https://docs.inceptionlabs.ai/capabilities/next-edit
export interface MercuryRecentSnippet {
  readonly filepath: string
  readonly content: string
}

export interface MercuryEditContext {
  readonly currentFilePath: string
  readonly currentFileContent: string
  readonly cursorLine: number
  readonly cursorCharacter: number
  readonly editableRegionStartLine: number
  readonly editableRegionEndLine: number
  readonly recentlyViewedSnippets: readonly MercuryRecentSnippet[]
  readonly editDiffHistory: readonly string[]
}

export function buildMercuryEditPrompt(context: MercuryEditContext): string {
  return [
    recentlyViewedSnippetsBlock(context.recentlyViewedSnippets),
    "",
    currentFileContentBlock(
      context.currentFilePath,
      context.currentFileContent,
      context.editableRegionStartLine,
      context.editableRegionEndLine,
      context.cursorLine,
      context.cursorCharacter,
    ),
    "",
    editDiffHistoryBlock(context.editDiffHistory),
    "",
    // Tells the model that this is a next-edit request, not a chat request.
    "<|!@#IS_NEXT_EDIT!@#|>",
  ].join("\n")
}

export function recentlyViewedSnippetsBlock(snippets: readonly MercuryRecentSnippet[]): string {
  const inner = snippets
    .map((snippet) =>
      [
        "<|recently_viewed_code_snippet|>",
        `code_snippet_file_path: ${snippet.filepath}`,
        snippet.content,
        "<|/recently_viewed_code_snippet|>",
      ].join("\n"),
    )
    .join("\n")
  return ["<|recently_viewed_code_snippets|>", inner, "<|/recently_viewed_code_snippets|>"].join("\n")
}

export function currentFileContentBlock(
  currentFilePath: string,
  currentFileContent: string,
  editableRegionStartLine: number,
  editableRegionEndLine: number,
  cursorLine: number,
  cursorCharacter: number,
): string {
  const lines = insertCursor(currentFileContent.split("\n"), cursorLine, cursorCharacter)
  const start = Math.max(0, Math.min(editableRegionStartLine, lines.length))
  const end = Math.max(start, Math.min(editableRegionEndLine, lines.length - 1))
  return [
    "<|current_file_content|>",
    `current_file_path: ${currentFilePath}`,
    [
      ...lines.slice(0, start),
      "<|code_to_edit|>",
      ...lines.slice(start, end + 1),
      "<|/code_to_edit|>",
      ...lines.slice(end + 1),
    ].join("\n"),
    "<|/current_file_content|>",
  ].join("\n")
}

// Each unified diff from `diff.createPatch` starts with an `Index:` line and a separator, which are stripped. A blank
// line separates the diffs so that the model reads them as distinct hunks.
export function editDiffHistoryBlock(diffs: readonly string[]): string {
  const trimmed = diffs.map((diff) => {
    const lines = diff.split("\n")
    return lines.length > 2 ? lines.slice(2).join("\n") : diff
  })
  return ["<|edit_diff_history|>", trimmed.join("\n\n"), "<|/edit_diff_history|>"].join("\n")
}

function insertCursor(lines: string[], cursorLine: number, cursorCharacter: number): string[] {
  if (cursorLine < 0 || cursorLine >= lines.length) return lines
  const line = lines[cursorLine]
  const character = Math.min(Math.max(cursorCharacter, 0), line.length)
  return lines.with(cursorLine, line.slice(0, character) + "<|cursor|>" + line.slice(character))
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
  inception: ["INCEPTION_API_KEY"],
}

export const REQUEST_TIMEOUT_MS = 30_000
const FIM_MAX_TOKENS = 256
const FIM_TEMPERATURE = 0.2
const EDIT_MAX_TOKENS = 512

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

export interface EditResult {
  readonly content: string
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number }
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
    throw requestError(error, "FIM", timeout, signal)
  }
}

/** One Next Edit request. Mercury answers with a fenced replacement of the editable region. */
export async function requestEdit(
  input: RequestOptions & {
    readonly target: EditTarget
    readonly context: MercuryEditContext
    readonly maxTokens?: number
  },
): Promise<EditResult> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  try {
    const response = await (input.fetch ?? globalThis.fetch)(input.target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.key}`, ...input.headers },
      signal,
      body: JSON.stringify({
        model: input.target.model,
        max_tokens: input.maxTokens ?? EDIT_MAX_TOKENS,
        // Mercury rejects a system message on this endpoint, so the whole prompt is one user message.
        messages: [{ role: "user", content: buildMercuryEditPrompt(input.context) }],
      }),
    })
    if (!response.ok) {
      const text = await readText(response)
      throw new AutocompleteRequestError(`Edit request failed: ${response.status} ${text}`, response.status)
    }
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    return {
      content: extractFencedBody(json.choices?.[0]?.message?.content ?? ""),
      ...(json.usage
        ? { usage: { prompt_tokens: json.usage.prompt_tokens, completion_tokens: json.usage.completion_tokens } }
        : {}),
    }
  } catch (error) {
    throw requestError(error, "Edit", timeout, signal)
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

function requestError(error: unknown, kind: "FIM" | "Edit", timeout: AbortSignal, signal: AbortSignal) {
  if (error instanceof AutocompleteRequestError) return error
  if ((error instanceof DOMException && error.name === "TimeoutError") || timeout.aborted)
    return new AutocompleteRequestError(`${kind} request timed out`, 504)
  if (signal.aborted) return new AutocompleteRequestError(`${kind} request canceled`, 499)
  return error
}
