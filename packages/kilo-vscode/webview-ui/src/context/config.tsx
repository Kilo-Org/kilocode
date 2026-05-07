/**
 * Config context
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 *
 * Changes are accumulated in a local draft and only sent to the extension
 * when saveConfig() is called. This allows batching multiple settings
 * changes into a single write (which triggers disposeAll on the CLI).
 */

import { createContext, useContext, createSignal, createMemo, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Config, ExtensionMessage, FeatureFlags } from "../types/messages"
import { deepMerge, stripNulls, resolveConfig } from "../utils/config-utils"
import { splitConfigByScope } from "../utils/config-scope"

function has(value: Record<string, unknown>) {
  return Object.keys(value).length > 0
}

export interface SaveError {
  message: string
  details?: string
}

interface ConfigContextValue {
  config: Accessor<Config>
  settings: Accessor<Record<string, unknown>>
  features: Accessor<FeatureFlags>
  loading: Accessor<boolean>
  isDirty: Accessor<boolean>
  saving: Accessor<boolean>
  saveError: Accessor<SaveError | null>
  updateConfig: (partial: Partial<Config>) => void
  updateSetting: (key: string, value: unknown) => void
  saveConfig: () => void
  discardConfig: () => void
}

export const ConfigContext = createContext<ConfigContextValue>()

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [config, setConfig] = createSignal<Config>({})
  const [settings, setSettings] = createSignal<Record<string, unknown>>({})
  const [features, setFeatures] = createSignal<FeatureFlags>({ indexing: false })
  const [loading, setLoading] = createSignal(true)
  const [draft, setDraft] = createSignal<Partial<Config>>({})
  const [settingsDraft, setSettingsDraft] = createSignal<Record<string, unknown>>({})
  const isDirty = createMemo(() => has(draft() as Record<string, unknown>) || has(settingsDraft()))
  // Last config received from the server — used to revert on discard
  const [saved, setSaved] = createSignal<Config>({})
  const [savedSettings, setSavedSettings] = createSignal<Record<string, unknown>>({})
  // True while a saveConfig() write is in-flight — used to clear draft on success
  // and to guard against stale configLoaded messages overwriting optimistic state.
  const [saving, setSaving] = createSignal(false)
  // Error from the most recent saveConfig() attempt, or null if no error.
  // Cleared when the user edits the draft again or starts a new save.
  const [saveError, setSaveError] = createSignal<SaveError | null>(null)

  // Register handler immediately (not in onMount) so we never miss
  // a configLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "autocompleteSettingsLoaded") {
      const patch = {
        "autocomplete.enableAutoTrigger": message.settings.enableAutoTrigger,
        "autocomplete.enableSmartInlineTaskKeybinding": message.settings.enableSmartInlineTaskKeybinding,
        "autocomplete.enableChatAutocomplete": message.settings.enableChatAutocomplete,
        "autocomplete.model": message.settings.model,
      }
      setSavedSettings((prev) => ({ ...prev, ...patch }))
      setSettings((prev) => ({ ...prev, ...patch, ...settingsDraft() }))
      return
    }
    if (message.type === "configLoaded") {
      // Skip if a save is in-flight — a stale configLoaded must not overwrite
      // the optimistically-updated state while the write is being confirmed.
      if (saving()) return
      // Re-apply the draft on top so pending changes (e.g. a toggled switch the
      // user hasn't saved yet) stay visible instead of snapping back.
      setConfig(resolveConfig(message.config, draft(), has(draft() as Record<string, unknown>)))
      setFeatures(message.features)
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
        setSaveError(null)
        setConfig(message.config)
        setFeatures(message.features)
      } else {
        // configUpdated from a different source (e.g. PermissionDock save).
        // Re-apply the draft on top so pending settings changes are preserved.
        setConfig(resolveConfig(message.config, draft(), has(draft() as Record<string, unknown>)))
        setFeatures(message.features)
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
  vscode.postMessage({ type: "requestAutocompleteSettings" })

  const fallback = setTimeout(() => {
    if (loading()) {
      vscode.postMessage({ type: "requestConfig" })
      vscode.postMessage({ type: "requestAutocompleteSettings" })
    }
  }, 3000)

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    clearTimeout(fallback)
    if (loading()) {
      vscode.postMessage({ type: "requestConfig" })
      vscode.postMessage({ type: "requestAutocompleteSettings" })
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
    // Clear any stale error from a previous failed save — the user is editing
    // again, so the old error message no longer reflects the current draft.
    setSaveError(null)
  }

  function updateSetting(key: string, value: unknown) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSettingsDraft((prev) => ({ ...prev, [key]: value }))
    setSaveError(null)
  }

  function saveConfig() {
    const changes = draft()
    const pending = settingsDraft()
    const configDirty = has(changes as Record<string, unknown>)
    const settingsDirty = has(pending)
    if (!configDirty && !settingsDirty) return
    // Don't clear draft/isDirty yet — wait for configUpdated confirmation.
    // If the write fails, the save bar stays visible so the user can retry.
    setSaving(true)
    setSaveError(null)
    if (settingsDirty) {
      for (const [key, value] of Object.entries(pending)) {
        vscode.postMessage({ type: "updateSetting", key, value })
      }
      setSavedSettings((prev) => ({ ...prev, ...pending }))
      setSettingsDraft({})
    }
    if (!configDirty) {
      setSaving(false)
      return
    }
    // Split so per-project settings (e.g. commit_message.prompt) land in the
    // workspace's kilo.json instead of the global one. Send one message so the
    // extension confirms only after both scopes are saved.
    const split = splitConfigByScope(changes)
    vscode.postMessage({ type: "updateConfig", config: split.global, projectConfig: split.project })
  }

  function discardConfig() {
    setConfig(saved())
    setDraft({})
    setSettings(savedSettings())
    setSettingsDraft({})
    setSaveError(null)
  }

  const value: ConfigContextValue = {
    config,
    settings,
    features,
    loading,
    isDirty,
    saving,
    saveError,
    updateConfig,
    updateSetting,
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
