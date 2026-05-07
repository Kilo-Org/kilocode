import type { KiloClient } from "@kilocode/sdk/v2/client"

type Post = (msg: unknown) => void

interface Context {
  readonly client: KiloClient | null
  postMessage: Post
  getErrorMessage(error: unknown): string
  showErrorMessage(message: string): void
}

export function handleEnhancePrompt(ctx: Context, text: string, requestId: string): void {
  const client = ctx.client
  if (!client) {
    ctx.postMessage({
      type: "enhancePromptError",
      error: "Not connected to CLI backend",
      requestId,
    })
    return
  }

  void client.enhancePrompt
    .enhance({ text }, { throwOnError: true })
    .then(({ data }) => {
      ctx.postMessage({ type: "enhancePromptResult", text: data.text, requestId })
    })
    .catch((err: unknown) => {
      const msg = ctx.getErrorMessage(err) || "Failed to enhance prompt"
      console.error("[Kilo New] KiloProvider: Failed to enhance prompt:", err)
      ctx.showErrorMessage(`Enhance prompt failed: ${msg}`)
      ctx.postMessage({
        type: "enhancePromptError",
        error: msg,
        requestId,
      })
    })
}
