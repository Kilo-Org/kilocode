/**
 * Shared endpoint store for provider routing selectors.
 *
 * Results are cached per provider+model for the webview lifetime. Failures are
 * recorded but never treated as cached results, so the next popover open
 * retries — one request per open, no retry loops.
 */

import { createSignal } from "solid-js"
import type { ExtensionMessage, ModelEndpoint, WebviewMessage } from "../types/messages"

export type EndpointsEntry =
  | { status: "ok"; endpoints: ModelEndpoint[]; at: number; stale?: true }
  | { status: "error" }

/** Successful results older than this refresh in the background on the next open. */
const TTL = 5 * 60 * 1000

interface PendingRequest {
  providerID: string
  modelID: string
  requestID: number
  post: (message: WebviewMessage) => void
}

const [entries, setEntries] = createSignal<Record<string, EndpointsEntry>>({})
const pending = new Map<string, PendingRequest>()
let counter = 0

function key(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

/** Feed extension messages into the store. Returns true when consumed. */
export function handleEndpointsMessage(message: ExtensionMessage): boolean {
  // Provider refreshes happen after ordinary config writes as well as auth and
  // organization changes. Keep successful data visible, mark it stale, and
  // restart in-flight requests so a refresh cannot strand the selector in its
  // loading state. The next open refreshes stale cached data in the background.
  if (message.type === "providersLoaded") {
    setEntries((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, entry]) => [id, entry.status === "ok" ? { ...entry, stale: true } : entry]),
      ),
    )
    for (const [id, request] of pending) {
      const requestID = ++counter
      const next = { ...request, requestID }
      pending.set(id, next)
      request.post({
        type: "requestModelEndpoints",
        providerID: request.providerID,
        modelID: request.modelID,
        requestID,
      })
    }
    return false
  }
  if (message.type !== "modelEndpointsLoaded") return false
  const id = key(message.providerID, message.modelID)
  // A response from before a provider refresh or a newer request is stale.
  if (pending.get(id)?.requestID !== message.requestID) return true
  pending.delete(id)
  setEntries((prev) => {
    if (message.error && prev[id]?.status === "ok") return prev
    return {
      ...prev,
      [id]: message.error ? { status: "error" } : { status: "ok", endpoints: message.endpoints, at: Date.now() },
    }
  })
  return true
}

/** Reactive read of the stored entry for a model. */
export function endpointsEntry(providerID: string, modelID: string): EndpointsEntry | undefined {
  return entries()[key(providerID, modelID)]
}

/**
 * Request the endpoint list unless a request is in flight or a successful
 * result is already cached. Error entries are re-requested.
 */
export function requestEndpoints(providerID: string, modelID: string, post: (message: WebviewMessage) => void): void {
  const id = key(providerID, modelID)
  if (pending.has(id)) return
  const entry = entries()[id]
  // Expired entries stay visible; the re-request refreshes them in the background.
  if (entry?.status === "ok" && !entry.stale && Date.now() - entry.at < TTL) return
  const requestID = ++counter
  pending.set(id, { providerID, modelID, requestID, post })
  post({ type: "requestModelEndpoints", providerID, modelID, requestID })
}

/** Test-only: clear cached entries and in-flight bookkeeping. */
export function resetEndpointsStore(): void {
  setEntries({})
  pending.clear()
  counter = 0
}
