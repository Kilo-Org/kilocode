import type { KiloEmbeddingModelCatalog } from "@kilocode/kilo-indexing/embedding-models"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"

// Retry while the catalog stays empty. The gateway request can race with
// network/auth readiness on first webview boot; without retries a single
// empty response leaves IndexingTab in its loading state until a full
// webview reload. Sends up to 5 retry requests, 500ms apart.
export const KILO_EMBEDDING_MAX_RETRIES = 5
export const KILO_EMBEDDING_RETRY_MS = 500

export const isEmptyKiloEmbeddingCatalog = (cat: KiloEmbeddingModelCatalog) =>
  !cat.defaultModel || cat.models.length === 0

type SubscribeOptions = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
  getCatalog: () => KiloEmbeddingModelCatalog
  setCatalog: (next: KiloEmbeddingModelCatalog) => void
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
  maxRetries?: number
  retryMs?: number
}

/**
 * Pure orchestration: subscribes to `kiloEmbeddingModelsLoaded` messages,
 * sends the initial request, and retries while the catalog is empty. Returned
 * function cleans up the subscription and timer.
 *
 * Lives in a JSX-free module so unit tests can import it without pulling in
 * the SolidJS render pipeline (the `.tsx` provider also re-exports it).
 */
export function subscribeKiloEmbeddingModels(opts: SubscribeOptions): () => void {
  const setIntervalFn = opts.setInterval ?? globalThis.setInterval
  const clearIntervalFn = opts.clearInterval ?? globalThis.clearInterval
  const maxRetries = opts.maxRetries ?? KILO_EMBEDDING_MAX_RETRIES
  const retryMs = opts.retryMs ?? KILO_EMBEDDING_RETRY_MS

  const unsubscribe = opts.onMessage((message: ExtensionMessage) => {
    if (message.type !== "kiloEmbeddingModelsLoaded") return
    // Never let an empty catalog overwrite a non-empty one that arrived
    // earlier (e.g. cached message replayed after a transient failure).
    if (isEmptyKiloEmbeddingCatalog(message.catalog) && !isEmptyKiloEmbeddingCatalog(opts.getCatalog())) return
    opts.setCatalog(message.catalog)
  })

  opts.postMessage({ type: "requestKiloEmbeddingModels" })

  let retries = 0
  const timer = setIntervalFn(() => {
    if (!isEmptyKiloEmbeddingCatalog(opts.getCatalog()) || retries >= maxRetries) {
      clearIntervalFn(timer)
      return
    }
    retries++
    opts.postMessage({ type: "requestKiloEmbeddingModels" })
    if (retries >= maxRetries) clearIntervalFn(timer)
  }, retryMs)

  return () => {
    clearIntervalFn(timer)
    unsubscribe()
  }
}
