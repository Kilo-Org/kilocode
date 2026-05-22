import {
  INCEPTION_API_BASE_URL,
  INCEPTION_EDIT_PATH,
  MERCURY_EDIT_MODEL_ID,
} from "./constants"
import { parseMercuryEditReply } from "./editCompletionParser"
import { nesLog, nesWarn } from "./log"
import { buildMercuryEditPrompt } from "./mercuryPromptTemplate"
import type { MercuryEditRequestContext, MercuryEditSuggestion } from "./types"

/**
 * Cap on tokens Mercury may return. The docs (decoding speed ~1000 tok/s)
 * suggest 25-line edits land around 250 tokens; cap at 2× that so a single
 * runaway response can't blow the latency budget.
 */
const MERCURY_MAX_TOKENS = 512

export interface MercuryEditProviderOptions {
  apiKey: string
  /** Override the base URL (e.g., when routing through a gateway). Defaults to Inception. */
  baseUrl?: string
  /** Override the model id. Defaults to `mercury-edit-2`. */
  model?: string
  /** AbortSignal for cancellation (cursor moves, escape, etc.). */
  signal?: AbortSignal
  /** Hook to override `fetch` in tests. */
  fetchImpl?: typeof fetch
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * Calls the Inception `POST /v1/edit/completions` endpoint with a single
 * sentinel-tagged user message and parses the rewritten editable region from
 * the response. Endpoint contract:
 * https://docs.inceptionlabs.ai/api-reference/edit/create-a-code-edit-completion
 */
export class MercuryEditProvider {
  constructor(private readonly options: MercuryEditProviderOptions) {}

  async suggest(ctx: MercuryEditRequestContext): Promise<MercuryEditSuggestion | null> {
    const baseUrl = this.options.baseUrl ?? INCEPTION_API_BASE_URL
    const model = this.options.model ?? MERCURY_EDIT_MODEL_ID
    const url = baseUrl.replace(/\/+$/, "") + INCEPTION_EDIT_PATH
    const userContent = buildMercuryEditPrompt(ctx)

    const start = Date.now()
    const fetchImpl = this.options.fetchImpl ?? fetch
    nesLog(`-> ${url} model=${model} promptChars=${userContent.length} region=[${ctx.editableRegionStartLine},${ctx.editableRegionEndLine}] diffs=${ctx.editDiffHistory.length} snippets=${ctx.recentlyViewedSnippets.length}`)
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: MERCURY_MAX_TOKENS,
        // The /v1/edit/completions endpoint accepts ONLY a single user
        // message — the system prompt is baked in server-side. See
        // https://docs.inceptionlabs.ai/api-reference/edit/create-a-code-edit-completion
        messages: [{ role: "user", content: userContent }],
      }),
      signal: this.options.signal,
    })

    if (!res.ok) {
      const body = await safeReadBody(res)
      nesWarn(`<- ${res.status} ${res.statusText} (${Date.now() - start}ms): ${body.slice(0, 200)}`)
      throw new MercuryEditError(`Mercury edit request failed: ${res.status} ${res.statusText}: ${body}`, res.status)
    }

    const json = (await res.json()) as ChatCompletionResponse
    const content = json.choices?.[0]?.message?.content ?? ""
    const replacement = parseMercuryEditReply(content)
    nesLog(`<- 200 (${Date.now() - start}ms) tokens=${json.usage?.completion_tokens ?? "?"} parsedChars=${replacement?.length ?? 0}`)
    if (replacement === null) return null

    return {
      replacement,
      editableRegionStartLine: ctx.editableRegionStartLine,
      editableRegionEndLine: ctx.editableRegionEndLine,
      latencyMs: Date.now() - start,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
    }
  }
}

export class MercuryEditError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = "MercuryEditError"
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return "<unreadable>"
  }
}
