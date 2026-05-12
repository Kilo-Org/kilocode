import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentComponent } from "solid-js"
import {
  EMPTY_KILO_EMBEDDING_MODEL_CATALOG,
  type KiloEmbeddingModelCatalog,
} from "@kilocode/kilo-indexing/embedding-models"
import { useVSCode } from "./vscode"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"

type KiloEmbeddingModelsContextValue = {
  catalog: Accessor<KiloEmbeddingModelCatalog>
}

export const KiloEmbeddingModelsContext = createContext<KiloEmbeddingModelsContextValue>()

// Retry while the catalog stays empty. The gateway request can race with
// network/auth readiness on first webview boot; without retries a single
// empty response leaves IndexingTab showing the literal "provider/model"
// placeholder until a full webview reload. Mirrors the retry shape used by
// indexing.tsx (5 attempts, 500ms apart).
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
 * Extracted from the SolidJS provider so the retry/empty-catalog behaviour can
 * be unit-tested without spinning up a webview.
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
    retries++
    if (!isEmptyKiloEmbeddingCatalog(opts.getCatalog()) || retries >= maxRetries) {
      clearIntervalFn(timer)
      return
    }
    opts.postMessage({ type: "requestKiloEmbeddingModels" })
  }, retryMs)

  return () => {
    clearIntervalFn(timer)
    unsubscribe()
  }
}

export const KiloEmbeddingModelsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [catalog, setCatalog] = createSignal<KiloEmbeddingModelCatalog>(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)

  const cleanup = subscribeKiloEmbeddingModels({
    postMessage: vscode.postMessage,
    onMessage: vscode.onMessage,
    getCatalog: catalog,
    setCatalog,
  })

  onCleanup(cleanup)

  return <KiloEmbeddingModelsContext.Provider value={{ catalog }}>{props.children}</KiloEmbeddingModelsContext.Provider>
}

export function useKiloEmbeddingModels(): KiloEmbeddingModelsContextValue {
  const context = useContext(KiloEmbeddingModelsContext)
  if (!context) {
    throw new Error("useKiloEmbeddingModels must be used within a KiloEmbeddingModelsProvider")
  }
  return context
}
