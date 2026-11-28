import type { KiloClient } from "@kilocode/sdk/v2/client"
import { normalizeEnhancePromptErrorMessage } from "../enhance-prompt-error"
import { getErrorMessage } from "../kilo-provider-utils"

type Reply =
  | { type: "enhancePromptResult"; text: string; requestId: string }
  | { type: "enhancePromptError"; error: string; requestId: string }

/** Enhance Prompt requests of one webview. A cancelled request is aborted and stays silent. */
export class EnhanceRequests {
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly post: (reply: Reply) => void,
    private readonly fail: (error: string) => void,
  ) {}

  start(client: KiloClient | null, text: string, id: string) {
    if (!client) {
      this.post({ type: "enhancePromptError", error: "Not connected to CLI backend", requestId: id })
      return
    }
    const abort = new AbortController()
    this.active.set(id, abort)
    void client.enhancePrompt
      .enhance({ text }, { throwOnError: true, signal: abort.signal })
      .then(({ data }) => {
        if (abort.signal.aborted) return
        this.post({ type: "enhancePromptResult", text: data.text, requestId: id })
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        const error = normalizeEnhancePromptErrorMessage(getErrorMessage(err) || "Failed to enhance prompt")
        console.error("[Kilo New] KiloProvider: Failed to enhance prompt:", err)
        this.fail(error)
        this.post({ type: "enhancePromptError", error, requestId: id })
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
