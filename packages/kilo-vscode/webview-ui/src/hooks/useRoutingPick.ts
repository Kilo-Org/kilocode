/**
 * Optimistic state for the chat provider-routing pick.
 *
 * A pick is persisted through a global config write that disposes the backend
 * instances, so the confirming configUpdated can take seconds. The picked
 * value shows immediately and stays until its own write is confirmed or
 * fails. Config messages from other sources — an earlier queued pick, the
 * reload after the write — leave it alone.
 */

import { createSignal, onCleanup, type Accessor } from "solid-js"
import type { ExtensionMessage, ModelSelection, WebviewMessage } from "../types/messages"
import { modelRouting } from "../../../src/shared/provider-routing"

interface VSCode {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

interface RoutingPick extends ModelSelection {
  provider: string | null
}

/**
 * The global config carried by a config message — the scope a pick is written
 * to. Confirmation is checked there rather than in the effective config: a
 * project-level pin shadows the written value, and the chip must then settle
 * on the effective value, not on the pick.
 */
function writtenConfig(message: ExtensionMessage): unknown {
  switch (message.type) {
    case "configLoaded":
    case "configUpdated":
      return message.globalConfig
    case "globalConfigLoaded":
      return message.config
    default:
      return undefined
  }
}

export function useRoutingPick(config: Accessor<unknown>, vscode: VSCode) {
  const [pending, setPending] = createSignal<RoutingPick>()

  const unsubscribe = vscode.onMessage((message) => {
    const next = pending()
    if (!next) return
    // The config keeps the authoritative value when a write fails.
    if (message.type === "configUpdateFailed") {
      setPending(undefined)
      return
    }
    const written = writtenConfig(message)
    if (written === undefined) return
    if (modelRouting(written, next.providerID, next.modelID) === (next.provider ?? undefined)) setPending(undefined)
  })
  onCleanup(unsubscribe)

  return {
    value(model: ModelSelection): string | undefined {
      const next = pending()
      if (next && next.providerID === model.providerID && next.modelID === model.modelID) {
        return next.provider ?? undefined
      }
      return modelRouting(config(), model.providerID, model.modelID)
    },
    pick(model: ModelSelection, provider: string | null): void {
      setPending({ providerID: model.providerID, modelID: model.modelID, provider })
      vscode.postMessage({ type: "persistModelRouting", providerID: model.providerID, modelID: model.modelID, provider })
    },
  }
}
