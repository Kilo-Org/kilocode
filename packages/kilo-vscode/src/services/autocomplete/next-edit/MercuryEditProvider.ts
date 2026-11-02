import { AutocompleteRequestError } from "../connection"
import type { AutocompleteConnection, EditResult } from "../connection"
import { nesLog, nesWarn } from "./log"
import type { MercuryEditRequestContext, MercuryEditSuggestion } from "./types"

const MERCURY_MAX_TOKENS = 512
const DEFAULT_PROVIDER_ID = "inception"
const DEFAULT_MODEL_ID = "mercury-next-edit"

export interface MercuryEditProviderOptions {
  connection: AutocompleteConnection
  /** Provider id to send to the server (e.g. `"kilo"` or `"inception"`). */
  providerId?: string
  /** Model id to send to the server (e.g. `"inception/mercury-next-edit"`). */
  modelId?: string
  /** AbortSignal for cancellation (cursor moves, escape, etc.). */
  signal?: AbortSignal
}

/**
 * Thin wrapper around the server's `autocomplete.edit` RPC (non-streaming).
 * The server handles auth, routing to Mercury's `/v1/edit/completions`, and
 * unwrapping the triple-backtick fence, so the extension only deals in
 * already-parsed code.
 */
export class MercuryEditProvider {
  constructor(private readonly options: MercuryEditProviderOptions) {}

  async suggest(ctx: MercuryEditRequestContext): Promise<MercuryEditSuggestion | null> {
    const start = Date.now()
    const provider = this.options.providerId ?? DEFAULT_PROVIDER_ID
    const model = this.options.modelId ?? DEFAULT_MODEL_ID
    nesLog(
      `-> autocomplete.edit provider=${provider} model=${model} region=[${ctx.editableRegionStartLine},${ctx.editableRegionEndLine}] diffs=${ctx.editDiffHistory.length} snippets=${ctx.recentlyViewedSnippets.length}`,
    )

    try {
      // Send structured editor context; the server assembles the Mercury prompt.
      const data = await this.options.connection.edit(
        {
          provider,
          model,
          maxTokens: MERCURY_MAX_TOKENS,
          currentFilePath: ctx.currentFilePath,
          currentFileContent: ctx.currentFileContent,
          cursorLine: ctx.cursorLine,
          cursorCharacter: ctx.cursorCharacter,
          editableRegionStartLine: ctx.editableRegionStartLine,
          editableRegionEndLine: ctx.editableRegionEndLine,
          recentlyViewedSnippets: ctx.recentlyViewedSnippets,
          editDiffHistory: ctx.editDiffHistory,
        },
        this.options.signal,
      )
      return this.parseSuccess(ctx, data, Date.now() - start)
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err
      const latencyMs = Date.now() - start
      if (err instanceof AutocompleteRequestError) {
        nesWarn(`<- error ${err.status ?? "?"} (${latencyMs}ms): ${err.message}`)
        throw new MercuryEditError(err.message, err.status)
      }
      const msg = err instanceof Error ? err.message : String(err)
      nesWarn(`<- transport error: ${msg}`)
      throw new MercuryEditError(`Edit request failed: ${msg}`, null)
    }
  }

  private parseSuccess(
    ctx: MercuryEditRequestContext,
    data: EditResult,
    latencyMs: number,
  ): MercuryEditSuggestion | null {
    const replacement = data.content
    const usage = data.usage
    nesLog(`<- ok (${latencyMs}ms) tokens=${usage?.completion_tokens ?? "?"} parsedChars=${replacement.length}`)
    if (replacement.length === 0) return null
    return {
      replacement,
      editableRegionStartLine: ctx.editableRegionStartLine,
      editableRegionEndLine: ctx.editableRegionEndLine,
      latencyMs,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    }
  }
}

export class MercuryEditError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message)
    this.name = "MercuryEditError"
  }
}
