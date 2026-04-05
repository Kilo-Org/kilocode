/**
 * Config context
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 *
 * Changes are accumulated in a local draft and only sent to the extension
 * when saveConfig() is called. This allows batching multiple settings
 * changes into a single write (which triggers disposeAll on the CLI).
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Config, ExtensionMessage } from "../types/messages"
import { deepMerge, stripNulls, resolveConfig } from "../utils/config-utils"

interface ConfigContextValue {
  config: Accessor<Config>
  loading: Accessor<boolean>
  isDirty: Accessor<boolean>
  updateConfig: (partial: Partial<Config>) => void
  saveConfig: () => void
  discardConfig: () => void
}

export const ConfigContext = createContext<ConfigContextValue>()

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [config, setConfig] = createSignal<Config>({})
  const [loading, setLoading] = createSignal(true)
  const [draft, setDraft] = createSignal<Partial<Config>>({})
  const [isDirty, setIsDirty] = createSignal(false)
  // Last config received from the server — used to revert on discard
  const [saved, setSaved] = createSignal<Config>({})
  // True while a saveConfig() write is in-flight — used to clear draft on success
  // and to guard against stale configLoaded messages overwriting optimistic state.
  let saving = false

  // Register handler immediately (not in onMount) so we never miss
  // a configLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "configLoaded") {
      // Skip if a save is in-flight — a stale configLoaded must not overwrite
      // the optimistically-updated state while the write is being confirmed.
      if (saving) return
      // Re-apply the draft on top so pending changes (e.g. a toggled switch the
      // user hasn't saved yet) stay visible instead of snapping back.
      setConfig(resolveConfig(message.config, draft(), isDirty()))
      setSaved(message.config)
      setLoading(false)
      return
    }
    if (message.type === "configUpdated") {
      if (saving) {
        // This configUpdated is the confirmation of our saveConfig() write.
        // Clear the draft now that the server has confirmed the write.
        saving = false
        setDraft({})
        setIsDirty(false)
        setConfig(message.config)
      } else {
        // configUpdated from a different source (e.g. PermissionDock save).
        // Re-apply the draft on top so pending settings changes are preserved.
        setConfig(resolveConfig(message.config, draft(), isDirty()))
      }
      setSaved(message.config)
      return
    }
  })

  onCleanup(unsubscribe)

  // Request config in case the initial push was missed.
  // Retry a few times because the extension's httpClient may
  // not be ready yet when the first request arrives.
  let retries = 0
  const maxRetries = 5
  const retryMs = 500

  vscode.postMessage({ type: "requestConfig" })

  const retryTimer = setInterval(() => {
    retries++
    if (!loading() || retries >= maxRetries) {
      clearInterval(retryTimer)
      return
    }
    vscode.postMessage({ type: "requestConfig" })
  }, retryMs)

  onCleanup(() => clearInterval(retryTimer))

  function updateConfig(partial: Partial<Config>) {
    // Optimistically update local state with deep merge + null stripping
    setConfig((prev) => stripNulls(deepMerge(prev, partial)))
    // Accumulate in draft — will be sent on saveConfig()
    setDraft((prev) => deepMerge(prev as Config, partial))
    setIsDirty(true)
  }

  function saveConfig() {
    const changes = draft()
    if (Object.keys(changes).length === 0) return
    // Don't clear draft/isDirty yet — wait for configUpdated confirmation.
    // If the write fails, the save bar stays visible so the user can retry.
    saving = true
    vscode.postMessage({ type: "updateConfig", config: changes })
  }

  function discardConfig() {
    setConfig(saved())
    setDraft({})
    setIsDirty(false)
  }

  const value: ConfigContextValue = {
    config,
    loading,
    isDirty,
    updateConfig,
    saveConfig,
    discardConfig,
  }

  return <ConfigContext.Provider value={value}>{props.children}</ConfigContext.Provider>
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider")
  }
  return context
}
