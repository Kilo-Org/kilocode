/**
 * Optimistic state for the chat provider-routing pick.
 *
 * A pick is persisted through a global config write that disposes the backend
 * instances, so the confirming configUpdated can take seconds, and the
 * workspace config the chip reads reloads only after it. The picked value
 * shows immediately and stays until its own write is confirmed and the
 * workspace config has reloaded since, or until the write fails. Config
 * messages from other sources — an earlier queued pick, the reload after the
 * write — leave it alone.
 */

import { createSignal, onCleanup } from "solid-js"
import type { ExtensionMessage, ModelSelection, WebviewMessage } from "../types/messages"
import { modelRouting } from "../../../src/shared/provider-routing"

interface VSCode {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

interface RoutingPick extends ModelSelection {
  provider: string | null
  /** The global config confirmed the write. */
  written?: true
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

/**
 * `current` resolves the routing that applies to a model from the workspace
 * config; `fresh` reports whether that config loaded after the last config
 * change, so once a write is confirmed it already reflects the write.
 */
export function useRoutingPick(
  current: (model: ModelSelection) => string | undefined,
  fresh: () => boolean,
  vscode: VSCode,
) {
  const [pending, setPending] = createSignal<RoutingPick>()

  const unsubscribe = vscode.onMessage((message) => {
    const next = pending()
    if (!next) return
    // The config keeps the authoritative value when a write fails.
    if (message.type === "configUpdateFailed") {
      setPending(undefined)
      return
    }
    if (next.written) {
      if (fresh()) setPending(undefined)
      return
    }
    const written = writtenConfig(message)
    if (written === undefined) return
    if (modelRouting(written, next.providerID, next.modelID) === (next.provider ?? undefined))
      setPending({ ...next, written: true })
  })
  onCleanup(unsubscribe)

  const picking = (model: ModelSelection) => {
    const next = pending()
    if (next === undefined || next.providerID !== model.providerID || next.modelID !== model.modelID) return false
    return !next.written || !fresh()
  }

  return {
    picking,
    value(model: ModelSelection): string | undefined {
      if (picking(model)) return pending()?.provider ?? undefined
      return current(model)
    },
    pick(model: ModelSelection, provider: string | null): void {
      setPending({ providerID: model.providerID, modelID: model.modelID, provider })
      vscode.postMessage({
        type: "persistModelRouting",
        providerID: model.providerID,
        modelID: model.modelID,
        provider,
      })
    },
  }
}
