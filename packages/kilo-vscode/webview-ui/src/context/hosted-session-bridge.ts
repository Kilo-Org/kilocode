import type { SetStoreFunction } from "solid-js/store"
import type { SessionStore } from "./session-store"
import type { ExtensionMessage, Message, Part } from "../types/messages"

export interface HostedBridgeDeps {
  store: SetStoreFunction<SessionStore>
  loaded(key: string): void
  page(key: string, hasMore: boolean): void
  toolParts(key: string, messages: Message[]): void
  isolate(part: Part): Part
  current(key: string): void
  draft(key: string): void
  loading(value: boolean): void
  clearDraft(): void
  connected(): boolean
  post(message: { type: "hostedOpenSession"; providerID: string; sessionID: string }): void
  batch(run: () => void): void
}

type Loaded = Extract<ExtensionMessage, { type: "hostedSessionLoaded" }>

/**
 * Bridges hosted session messages into the existing session store.
 *
 * Hosted sessions reuse the local renderer under a namespaced key, so nothing
 * here needs a second transcript path; it only writes the same shapes the
 * local `messagesLoaded` handler writes.
 */
export function createHostedBridge(deps: HostedBridgeDeps) {
  function load(message: Loaded) {
    deps.batch(() => {
      deps.loaded(message.key)
      deps.store("sessions", message.key, {
        id: message.key,
        title: message.title,
        createdAt: new Date(message.session.time.created).toISOString(),
        updatedAt: new Date(message.session.time.updated).toISOString(),
      })
      deps.page(message.key, Boolean(message.cursor))
      deps.store("messages", message.key, message.messages)
      for (const msg of message.messages) {
        if (msg.parts && msg.parts.length > 0) deps.store("parts", msg.id, msg.parts.map(deps.isolate))
      }
      deps.toolParts(message.key, message.messages)
      deps.current(message.key)
      deps.loading(false)
    })
  }

  function select(providerID: string, sessionID: string) {
    if (!deps.connected()) {
      console.warn("[Kilo New] Cannot select hosted session: not connected")
      return
    }
    const key = `host:${providerID}:${sessionID}`
    deps.clearDraft()
    deps.current(key)
    deps.draft(key)
    deps.loading(true)
    deps.post({ type: "hostedOpenSession", providerID, sessionID })
  }

  function handle(message: ExtensionMessage) {
    if (message.type === "hostedSessionLoaded") load(message)
    if (message.type === "hostedSessionFailed" && message.sessionID) deps.loading(false)
  }

  return { handle, select }
}
