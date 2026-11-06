import type { KiloClient } from "@kilocode/sdk/v2/client"
import { normalizeEnhancePromptErrorMessage } from "../enhance-prompt-error"
import { getErrorMessage } from "../kilo-provider-utils"

/** How long one request may run. A stalled network or provider would otherwise keep the spinner on. */
const TIMEOUT_MS = 2 * 60 * 1000

type Reply =
  | { type: "enhancePromptResult"; text: string; requestId: string }
  | { type: "enhancePromptError"; error: string; reason: "failed" | "timeout"; requestId: string }

/**
 * Enhance Prompt requests of one webview. A cancelled request is aborted and stays silent.
 * A failed or timed-out request is reported to the webview, which shows it next to the draft.
 */
export class EnhanceRequests {
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly post: (reply: Reply) => void,
    private readonly timeout = TIMEOUT_MS,
  ) {}

  start(client: KiloClient | null, text: string, id: string) {
    if (!client) {
      this.post({ type: "enhancePromptError", error: "Not connected to CLI backend", reason: "failed", requestId: id })
      return
    }
    const abort = new AbortController()
    const timer = AbortSignal.timeout(this.timeout)
    this.active.set(id, abort)
    void client.enhancePrompt
      .enhance({ text }, { throwOnError: true, signal: AbortSignal.any([abort.signal, timer]) })
      .then(({ data }) => {
        if (abort.signal.aborted) return
        this.post({ type: "enhancePromptResult", text: data.text, requestId: id })
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        if (timer.aborted) {
          const error = `No reply after ${this.timeout / 1000} s`
          console.error(`[Kilo New] KiloProvider: Enhance prompt ${id} timed out:`, error)
          this.post({ type: "enhancePromptError", error, reason: "timeout", requestId: id })
          return
        }
        const error = normalizeEnhancePromptErrorMessage(getErrorMessage(err) || "Failed to enhance prompt")
        console.error(`[Kilo New] KiloProvider: Enhance prompt ${id} failed:`, err)
        this.post({ type: "enhancePromptError", error, reason: "failed", requestId: id })
      })
      .finally(() => {
        if (this.active.get(id) === abort) this.active.delete(id)
      })
  }

  cancel(id: string) {
    this.active.get(id)?.abort()
    this.active.delete(id)
  }

  dispose() {
    for (const abort of this.active.values()) abort.abort()
    this.active.clear()
  }
}
