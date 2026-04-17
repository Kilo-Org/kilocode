/**
 * Config context
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 *
 * Changes are accumulated in a local draft and only sent to the extension
 * when saveConfig() is called. This allows batching multiple settings
 * changes into a single write (which triggers disposeAll on the CLI).
 */

import { createContext, useContext, createSignal, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Config, ExtensionMessage } from "../types/messages"
import { deepMerge, stripNulls, resolveConfig } from "../utils/config-utils"

export interface SaveError {
  message: string
  details?: string
}

interface ConfigContextValue {
  config: Accessor<Config>
  loading: Accessor<boolean>
  isDirty: Accessor<boolean>
  saving: Accessor<boolean>
  saveError: Accessor<SaveError | null>
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
  const [saving, setSaving] = createSignal(false)
  // Error from the most recent saveConfig() attempt, or null if no error.
  // Cleared when the user edits the draft again or starts a new save.
  const [saveError, setSaveError] = createSignal<SaveError | null>(null)

  // Register handler immediately (not in onMount) so we never miss
  // a configLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "configLoaded") {
      // Skip if a save is in-flight — a stale configLoaded must not overwrite
      // the optimistically-updated state while the write is being confirmed.
      if (saving()) return
      // Re-apply the draft on top so pending changes (e.g. a toggled switch the
      // user hasn't saved yet) stay visible instead of snapping back.
      setConfig(resolveConfig(message.config, draft(), isDirty()))
      setSaved(message.config)
      setLoading(false)
      return
    }
    if (message.type === "configUpdated") {
      if (saving()) {
        // This configUpdated is the confirmation of our saveConfig() write.
        // Clear the draft now that the server has confirmed the write.
        setSaving(false)
        setDraft({})
        setIsDirty(false)
        setSaveError(null)
        setConfig(message.config)
      } else {
        // configUpdated from a different source (e.g. PermissionDock save).
        // Re-apply the draft on top so pending settings changes are preserved.
        setConfig(resolveConfig(message.config, draft(), isDirty()))
      }
      setSaved(message.config)
      return
    }
    if (message.type === "configUpdateFailed") {
      // The write was rejected (e.g. schema validation) — surface the error
      // and keep the draft + isDirty so the user can correct and retry.
      setSaving(false)
      setSaveError({ message: message.message, details: message.details })
      return
    }
  })

  onCleanup(unsubscribe)

  // Request config immediately; if the extension's httpClient is not yet ready,
  // extensionDataReady will fire once initialization completes and we retry once.
  vscode.postMessage({ type: "requestConfig" })

  const fallback = setTimeout(() => {
    if (loading()) {
      vscode.postMessage({ type: "requestConfig" })
    }
  }, 3000)

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    clearTimeout(fallback)
    if (loading()) {
      vscode.postMessage({ type: "requestConfig" })
    }
  })

  onCleanup(() => {
    unsubReady()
    clearTimeout(fallback)
  })

  function updateConfig(partial: Partial<Config>) {
    // Optimistically update local state with deep merge + null stripping
    setConfig((prev) => stripNulls(deepMerge(prev, partial)))
    // Accumulate in draft — will be sent on saveConfig()
    setDraft((prev) => deepMerge(prev as Config, partial))
    setIsDirty(true)
    // Clear any stale error from a previous failed save — the user is editing
    // again, so the old error message no longer reflects the current draft.
    setSaveError(null)
  }

  function saveConfig() {
    const changes = draft()
    if (Object.keys(changes).length === 0) return
    // Don't clear draft/isDirty yet — wait for configUpdated confirmation.
    // If the write fails, the save bar stays visible so the user can retry.
    setSaving(true)
    setSaveError(null)
    vscode.postMessage({ type: "updateConfig", config: changes })
  }

  function discardConfig() {
    setConfig(saved())
    setDraft({})
    setIsDirty(false)
    setSaveError(null)
  }

  const value: ConfigContextValue = {
    config,
    loading,
    isDirty,
    saving,
    saveError,
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
