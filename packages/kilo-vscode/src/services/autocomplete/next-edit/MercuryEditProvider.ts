import type { KiloConnectionService } from "../../cli-backend"
import { nesLog, nesWarn } from "./log"
import type { MercuryEditRequestContext, MercuryEditSuggestion } from "./types"

const MERCURY_MAX_TOKENS = 512
const PROVIDER_ID = "inception"
const MODEL_ID = "mercury-next-edit"

type EditResponseData = { content?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }

export interface MercuryEditProviderOptions {
  connectionService: KiloConnectionService
  /** AbortSignal for cancellation (cursor moves, escape, etc.). */
  signal?: AbortSignal
}

/**
 * Thin wrapper around the SDK's `client.kilo.edit(...)` endpoint (non-streaming).
 * The gateway (`packages/kilo-gateway/src/server/edit.ts`) handles auth, routing
 * to Mercury's `/v1/edit/completions`, and unwrapping the triple-backtick fence —
 * so the VSCode side only deals in already-parsed code.
 */
export class MercuryEditProvider {
  constructor(private readonly options: MercuryEditProviderOptions) {}

  async suggest(ctx: MercuryEditRequestContext): Promise<MercuryEditSuggestion | null> {
    const start = Date.now()
    nesLog(
      `-> /kilo/edit model=${MODEL_ID} region=[${ctx.editableRegionStartLine},${ctx.editableRegionEndLine}] diffs=${ctx.editDiffHistory.length} snippets=${ctx.recentlyViewedSnippets.length}`,
    )

    const client = await this.options.connectionService.getClientAsync()
    try {
      // Send structured editor context; the gateway assembles the Mercury prompt.
      const { data, error, response } = await client.kilo.edit(
        {
          provider: PROVIDER_ID,
          model: MODEL_ID,
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
        { signal: this.options.signal, throwOnError: false },
      )
      const latencyMs = Date.now() - start
      if (error) {
        // HTTP status lives on the Response object, not the parsed error body.
        const status = typeof response?.status === "number" ? response.status : null
        nesWarn(`<- error ${status ?? "?"} (${latencyMs}ms): ${safeStringify(error)}`)
        throw new MercuryEditError(`Edit request failed: ${status ?? "?"} ${safeStringify(error)}`, status)
      }
      return this.parseSuccess(ctx, data, latencyMs)
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err
      if (err instanceof MercuryEditError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      nesWarn(`<- transport error: ${msg}`)
      throw new MercuryEditError(`Edit request failed: ${msg}`, null)
    }
  }

  private parseSuccess(
    ctx: MercuryEditRequestContext,
    data: EditResponseData | undefined,
    latencyMs: number,
  ): MercuryEditSuggestion | null {
    const replacement = data?.content ?? null
    const usage = data?.usage
    nesLog(`<- ok (${latencyMs}ms) tokens=${usage?.completion_tokens ?? "?"} parsedChars=${replacement?.length ?? 0}`)
    if (replacement === null || replacement.length === 0) return null
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
  constructor(message: string, public readonly status: number | null) {
    super(message)
    this.name = "MercuryEditError"
  }
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return value
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
