/**
 * Shared endpoint store for provider routing selectors.
 *
 * Results are cached per workspace directory, provider and model for the
 * webview lifetime: the catalog is resolved with that workspace's
 * configuration (gateway URL, organization), so an Agent Manager worktree
 * with its own project config gets its own list. The request names the
 * directory it is keyed by, so a reply can never land under another one.
 * Failures are recorded but never treated as cached results, so the next
 * popover open retries — one request per open, no retry loops.
 */

import { createSignal } from "solid-js"
import type { ExtensionMessage, ModelEndpoint, ProfileData, WebviewMessage } from "../types/messages"

export type EndpointsEntry =
  | { status: "ok"; endpoints: ModelEndpoint[]; at: number; stale?: true }
  | { status: "error" }

/** Identifies one catalog: a model as seen from one workspace directory. */
export interface EndpointsScope {
  directory: string
  providerID: string
  modelID: string
}

/** Successful results older than this refresh in the background on the next open. */
const TTL = 5 * 60 * 1000

interface PendingRequest {
  scope: EndpointsScope
  requestID: number
  post: (message: WebviewMessage) => void
}

const [entries, setEntries] = createSignal<Record<string, EndpointsEntry>>({})
const pending = new Map<string, PendingRequest>()
let counter = 0
/** Account and organization the cached catalogs belong to; unknown until the first profile arrives. */
let identity: string | undefined

function key(scope: EndpointsScope): string {
  return `${scope.directory}\n${scope.providerID}/${scope.modelID}`
}

function identityOf(data: ProfileData | null): string {
  return data ? `${data.profile.email}\n${data.currentOrgId ?? ""}` : ""
}

function send(request: PendingRequest): void {
  request.post({
    type: "requestModelEndpoints",
    providerID: request.scope.providerID,
    modelID: request.scope.modelID,
    requestID: request.requestID,
    // An empty directory is the settings scope, which the extension resolves itself.
    ...(request.scope.directory !== "" ? { directory: request.scope.directory } : {}),
  })
}

/** Re-issue every in-flight request under a new ID so responses to the old ones are ignored. */
function restartPending(): void {
  for (const [id, request] of pending) {
    const next = { ...request, requestID: ++counter }
    pending.set(id, next)
    send(next)
  }
}

/** Feed extension messages into the store. Returns true when consumed. */
export function handleEndpointsMessage(message: ExtensionMessage): boolean {
  // Catalogs are scoped to the signed-in account and its organization. Once
  // that identity changes, nothing cached may stay visible or selectable — a
  // previous account's endpoints would otherwise survive a failed refresh.
  if (message.type === "profileData") {
    const next = identityOf(message.data)
    const changed = identity !== undefined && identity !== next
    identity = next
    if (changed) {
      setEntries({})
      restartPending()
    }
    return false
  }
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
    restartPending()
    return false
  }
  if (message.type !== "modelEndpointsLoaded") return false
  // Responses are matched by request ID: one from before a provider refresh or
  // a newer request is stale, and the directory reported by the extension is
  // informational — the store keys by the directory the request was made for.
  const found = [...pending].find(([, request]) => request.requestID === message.requestID)
  if (!found) return true
  const [id] = found
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

/** Reactive read of the stored entry for a model in a workspace. */
export function endpointsEntry(scope: EndpointsScope): EndpointsEntry | undefined {
  return entries()[key(scope)]
}

/**
 * Request the endpoint list unless a request is in flight or a successful
 * result is already cached. Error entries are re-requested.
 */
export function requestEndpoints(scope: EndpointsScope, post: (message: WebviewMessage) => void): void {
  const id = key(scope)
  if (pending.has(id)) return
  const entry = entries()[id]
  // Expired entries stay visible; the re-request refreshes them in the background.
  if (entry?.status === "ok" && !entry.stale && Date.now() - entry.at < TTL) return
  const request: PendingRequest = { scope, requestID: ++counter, post }
  pending.set(id, request)
  send(request)
}

/** Test-only: clear cached entries and in-flight bookkeeping. */
export function resetEndpointsStore(): void {
  setEntries({})
  pending.clear()
  counter = 0
  identity = undefined
}
