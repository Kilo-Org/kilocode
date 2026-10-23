import { produce, type SetStoreFunction } from "solid-js/store"
import type { SessionStore } from "./session-store"
import type { ExtensionMessage } from "../types/messages"

export interface CloudFailureDeps {
  store: SetStoreFunction<SessionStore>
  prune(key: string): void
  clearPreview(rawID: string): void
  clearCurrent(key: string): void
  clearDraft(key: string): void
  toast(error: string): void
}

/**
 * Cloud import failure cleanup stays separate from hosted session handling:
 * the legacy `cloud:<id>` preview is a different identity space and must not
 * be cleared by a hosted attachment failure.
 */
export function handleCloudImportFailure(message: ExtensionMessage, deps: CloudFailureDeps): void {
  if (message.type !== "cloudSessionImportFailed") return
  const key = `cloud:${message.cloudSessionId}`
  deps.prune(key)
  deps.store(
    "sessions",
    produce((sessions) => {
      delete sessions[key]
    }),
  )
  deps.store(
    "messages",
    produce((messages) => {
      delete messages[key]
    }),
  )
  deps.store(
    "toolParts",
    produce((parts) => {
      delete parts[key]
    }),
  )
  // cloudPreviewId stores the raw cloud session id, not the synthetic key.
  deps.clearPreview(message.cloudSessionId)
  deps.clearCurrent(key)
  deps.clearDraft(key)
  deps.toast(message.error)
}
