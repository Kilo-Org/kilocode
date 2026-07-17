/**
 * Config context
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 *
 * Changes are accumulated in a local draft and only sent to the extension
 * when saveConfig() is called. This allows batching multiple settings
 * changes into a single write (which triggers disposeAll on the CLI).
 */

import { createComponent, createContext, useContext, createSignal, createMemo, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type {
  Config,
  ConfigCollections,
  ExtensionMessage,
  FeatureFlags,
  SettingsConfigBinding,
} from "../types/messages"
import {
  configUnsetPaths,
  deepMerge,
  mergeScopedConfig,
  pruneConfigSet,
  stripNulls,
  resolveConfig,
} from "../utils/config-utils"
import { splitConfigByScope } from "../utils/config-scope"

function has(value: Record<string, unknown>) {
  return Object.keys(value).length > 0
}

export interface SaveError {
  message: string
  details?: string
}

type ConfigSnapshotMessage = Extract<ExtensionMessage, { type: "configLoaded" | "configUpdated" }>
type ConfigUpdatedMessage = Extract<ExtensionMessage, { type: "configUpdated" }>
type ConfigFailureMessage = Extract<ExtensionMessage, { type: "configUpdateFailed" }>

interface ConfigContextValue {
  config: Accessor<Config>
  globalConfig: Accessor<Config>
  globalDraft: Accessor<Partial<Config>>
  projectConfig: Accessor<Config>
  collections: Accessor<ConfigCollections>
  settings: Accessor<Record<string, unknown>>
  features: Accessor<FeatureFlags>
  loading: Accessor<boolean>
  isDirty: Accessor<boolean>
  saving: Accessor<boolean>
  saveError: Accessor<SaveError | null>
  updateConfig: (partial: Partial<Config>) => void
  updateGlobalConfig: (partial: Partial<Config>) => void
  applyGlobalConfig: (partial: Partial<Config>) => void
  updateProjectConfig: (partial: Partial<Config>) => void
  updateSetting: (key: string, value: unknown) => void
  applySetting: (key: string, value: unknown, writeKey?: string) => void
  saveConfig: () => void
  discardConfig: () => void
}

export const ConfigContext = createContext<ConfigContextValue>()

function loadedSettings(message: ExtensionMessage): Record<string, unknown> | undefined {
  if (message.type === "autocompleteSettingsLoaded") {
    return {
      "autocomplete.enableAutoTrigger": message.settings.enableAutoTrigger,
      "autocomplete.enableSmartInlineTaskKeybinding": message.settings.enableSmartInlineTaskKeybinding,
      "autocomplete.enableChatAutocomplete": message.settings.enableChatAutocomplete,
      "autocomplete.provider": message.settings.provider,
      "autocomplete.model": message.settings.model,
    }
  }
  if (message.type === "indexingSettingsLoaded") {
    return { "indexing.showButtonWhenDisabled": message.settings.showButtonWhenDisabled }
  }
  if (message.type === "chatSettingsLoaded") {
    return { "chat.shiftTabCyclesVariant": message.settings.shiftTabCyclesVariant }
  }
  if (message.type === "throughputSettingLoaded") return { showTokenThroughput: message.visible }
}

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [config, setConfig] = createSignal<Config>({})
  const [globalConfig, setGlobalConfig] = createSignal<Config>({})
  const [projectConfig, setProjectConfig] = createSignal<Config>({})
  const [collections, setCollections] = createSignal<ConfigCollections>({})
  const [settings, setSettings] = createSignal<Record<string, unknown>>({})
  const [features, setFeatures] = createSignal<FeatureFlags>({ indexing: false, sandboxControls: false })
  const [loading, setLoading] = createSignal(true)
  const [draft, setDraft] = createSignal<Partial<Config>>({})
  const [globalDraft, setGlobalDraft] = createSignal<Partial<Config>>({})
  const [projectDraft, setProjectDraft] = createSignal<Partial<Config>>({})
  const [settingsDraft, setSettingsDraft] = createSignal<Record<string, unknown>>({})
  const [bindings, setBindings] = createSignal<{ global?: SettingsConfigBinding; project?: SettingsConfigBinding }>({})
  const isDirty = createMemo(
    () =>
      has(draft() as Record<string, unknown>) ||
      has(globalDraft() as Record<string, unknown>) ||
      has(projectDraft() as Record<string, unknown>) ||
      has(settingsDraft()),
  )
  // Last config received from the server — used to revert on discard
  const [saved, setSaved] = createSignal<Config>({})
  const [savedGlobal, setSavedGlobal] = createSignal<Config>({})
  const [savedProject, setSavedProject] = createSignal<Config>({})
  const [savedSettings, setSavedSettings] = createSignal<Record<string, unknown>>({})
  // True while a saveConfig() write is in-flight — used to clear draft on success
  // and to guard against stale configLoaded messages overwriting optimistic state.
  const [saving, setSaving] = createSignal(false)
  const [applying, setApplying] = createSignal<{ config: Partial<Config>; requestID: string }>()
  const [queued, setQueued] = createSignal<Partial<Config>>()
  // Error from the most recent saveConfig() attempt, or null if no error.
  // Cleared when the user edits the draft again or starts a new save.
  const [saveError, setSaveError] = createSignal<SaveError | null>(null)
  const updateCollections = (next: ConfigCollections | undefined) => {
    if (next !== undefined) setCollections(next)
  }

  function sync(message: ConfigSnapshotMessage, draft = true) {
    if (message.globalConfig !== undefined) {
      setGlobalConfig(mergeScopedConfig(message.globalConfig, draft ? globalDraft() : {}))
      setSavedGlobal(message.globalConfig)
    }
    if (message.projectConfig !== undefined) {
      setProjectConfig(draft ? mergeScopedConfig(message.projectConfig, projectDraft()) : message.projectConfig)
      setSavedProject(message.projectConfig)
    }
    updateCollections(message.collections)
    setFeatures(message.features)
    setBindings(message.bindings ?? bindings())
  }

  function merge(message: ConfigSnapshotMessage) {
    setConfig(resolveConfig(message.config, draft(), has(draft() as Record<string, unknown>)))
    sync(message)
  }

  function receipt(message: ConfigSnapshotMessage) {
    if (message.settings) mergeSettings(message.settings)
    setSaved(message.config)
  }

  function loaded(message: ConfigSnapshotMessage) {
    if (saving() || applying()) return
    merge(message)
    receipt(message)
    setLoading(false)
  }

  function updated(message: ConfigUpdatedMessage) {
    const direct = applying()
    if (direct && message.requestID !== direct.requestID) return
    if (direct) {
      setApplying(undefined)
      merge(message)
      setSaveError(null)
    } else if (saving()) {
      setSaving(false)
      setDraft({})
      setGlobalDraft({})
      setProjectDraft({})
      setSaveError(null)
      setConfig(message.config)
      sync(message, false)
    } else {
      merge(message)
    }
    receipt(message)
    if (!direct) return
    const next = queued()
    setQueued(undefined)
    if (next) applyGlobalConfig(next)
  }

  function directFailure(message: ConfigFailureMessage) {
    setApplying(undefined)
    setQueued(undefined)
    const config = message.config ?? saved()
    setConfig(resolveConfig(config, draft(), has(draft() as Record<string, unknown>)))
    setSaved(config)
    if (message.globalConfig !== undefined) {
      setGlobalConfig(mergeScopedConfig(message.globalConfig, globalDraft()))
      setSavedGlobal(message.globalConfig)
    }
    if (message.projectConfig !== undefined) {
      setProjectConfig(mergeScopedConfig(message.projectConfig, projectDraft()))
      setSavedProject(message.projectConfig)
    }
    if (message.bindings) setBindings(message.bindings)
    if (!message.config) vscode.postMessage({ type: "requestConfig" })
    setSaveError({ message: message.message, details: message.details })
  }

  function savedFailure(message: ConfigFailureMessage) {
    setSaving(false)
    if (message.completedScopes?.length) {
      const split = splitConfigByScope(draft())
      const remaining = message.completedScopes.includes("global")
        ? split.project
        : message.completedScopes.includes("project")
          ? split.global
          : draft()
      setDraft(message.completedScopes.length === 2 ? {} : remaining)
    }
    if (message.completedScopes?.includes("global")) {
      setGlobalDraft({})
      if (message.globalConfig) {
        setGlobalConfig(message.globalConfig)
        setSavedGlobal(message.globalConfig)
      }
    }
    if (message.completedScopes?.includes("project")) {
      setProjectDraft({})
      if (message.projectConfig) {
        setProjectConfig(message.projectConfig)
        setSavedProject(message.projectConfig)
      }
    }
    if (message.config) {
      setConfig(resolveConfig(message.config, draft(), has(draft() as Record<string, unknown>)))
      setSaved(message.config)
    }
    if (message.bindings) setBindings(message.bindings)
    setSaveError({ message: message.message, details: message.details })
  }

  function failed(message: ConfigFailureMessage) {
    const direct = applying()
    if (direct && message.requestID !== direct.requestID) return
    if (direct) return directFailure(message)
    savedFailure(message)
  }

  // Register handler immediately (not in onMount) so we never miss
  // a configLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    const patch = loadedSettings(message)
    if (patch) return mergeSettings(patch)
    if (message.type === "configLoaded") return loaded(message)
    if (message.type === "globalConfigLoaded") {
      if (saving() || applying()) return
      setGlobalConfig(mergeScopedConfig(message.config, globalDraft()))
      setSavedGlobal(message.config)
      return
    }
    if (message.type === "configUpdated") return updated(message)
  })
  const unsubscribeExpired = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "configBindingExpired") return
    setBindings({})
    if (isDirty()) {
      setSaveError({ message: "The Settings project changed. Discard or reload before saving." })
      return
    }
    vscode.postMessage({ type: "requestConfig" })
  })
  const unsubscribeFailure = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "configUpdateFailed") return
    failed(message)
  })
  const unsubscribeIndexing = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "indexingSettingsLoaded") return
    mergeSettings({
      "indexing.showButtonWhenDisabled": message.settings.showButtonWhenDisabled,
      "indexing.consent": message.settings.consent,
      "indexing.projects": message.settings.projects,
      "indexing.projectId": message.settings.projectId,
    })
  })
  const unsubscribeChat = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "chatSettingsLoaded") return
    mergeSettings({
      "chat.shiftTabCyclesVariant": message.settings.shiftTabCyclesVariant,
    })
  })

  onCleanup(() => {
    unsubscribe()
    unsubscribeExpired()
    unsubscribeFailure()
    unsubscribeIndexing()
    unsubscribeChat()
  })

  function mergeSettings(patch: Record<string, unknown>) {
    setSavedSettings((prev) => ({ ...prev, ...patch }))
    setSettings((prev) => ({ ...prev, ...patch, ...settingsDraft() }))
  }

  const requestInitialData = () => {
    vscode.postMessage({ type: "requestConfig" })
    vscode.postMessage({ type: "requestAutocompleteSettings" })
    vscode.postMessage({ type: "requestIndexingSettings" })
    vscode.postMessage({ type: "requestChatSettings" })
  }

  // Request config immediately; if the extension's httpClient is not yet ready,
  // extensionDataReady will fire once initialization completes and we retry once.
  requestInitialData()

  const fallback = setTimeout(() => {
    if (loading()) {
      requestInitialData()
    }
  }, 3000)

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    clearTimeout(fallback)
    if (loading()) {
      requestInitialData()
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

  function updateGlobalConfig(partial: Partial<Config>) {
    setGlobalConfig((prev) => mergeScopedConfig(prev, partial))
    setGlobalDraft((prev) => deepMerge(prev as Config, partial))
    setSaveError(null)
  }

  function applyGlobalConfig(partial: Partial<Config>) {
    if (saving()) {
      setSaveError({ message: "Settings are saving. Retry after the current save completes." })
      return
    }
    const current = applying()
    if (current) {
      const next = deepMerge((queued() ?? {}) as Config, partial)
      setQueued(next)
      setConfig((prev) => stripNulls(deepMerge(prev, next)))
      return
    }
    const binding = bindings().global?.id
    if (!binding) {
      setSaveError({ message: "Settings changed or expired. Reload before saving." })
      return
    }
    const requestID = crypto.randomUUID()
    setApplying({ config: partial, requestID })
    setConfig((prev) => stripNulls(deepMerge(prev, partial)))
    vscode.postMessage({ type: "updateConfig", config: partial, globalBindingId: binding, requestID })
  }

  function updateProjectConfig(partial: Partial<Config>) {
    setProjectConfig((prev) => mergeScopedConfig(prev, partial))
    setProjectDraft((prev) => deepMerge(prev as Config, partial))
    setSaveError(null)
  }

  function updateSetting(key: string, value: unknown) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSettingsDraft((prev) => ({ ...prev, [key]: value }))
    setSaveError(null)
  }

  /**
   * Write a VS Code setting immediately, bypassing the save-bar draft.
   * For app-level feature gates whose effect lives outside the settings page,
   * where staging the change would make the control feel unresponsive.
   * `key` is the local settings() property; `writeKey` is the VS Code
   * configuration key when the two differ (e.g. namespaced experimental keys).
   */
  function applySetting(key: string, value: unknown, writeKey?: string) {
    setSavedSettings((prev) => ({ ...prev, [key]: value }))
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSettingsDraft((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setSaveError(null)
    vscode.postMessage({ type: "updateSetting", key: writeKey ?? key, value })
  }

  function saveConfig() {
    if (applying()) {
      setSaveError({ message: "A model variant is saving. Retry after it completes." })
      return
    }
    const changes = draft()
    const globals = globalDraft()
    const projects = projectDraft()
    const pending = settingsDraft()
    const configDirty = has(changes as Record<string, unknown>)
    const globalDirty = has(globals as Record<string, unknown>)
    const projectDirty = has(projects as Record<string, unknown>)
    const settingsDirty = has(pending)
    if (!configDirty && !globalDirty && !projectDirty && !settingsDirty) return
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
    if (!configDirty && !globalDirty && !projectDirty) {
      setSaving(false)
      return
    }
    // Split so per-project settings (e.g. commit_message.prompt) land in the
    // workspace's kilo.json instead of the global one. Send one message so the
    // extension confirms only after both scopes are saved.
    const split = splitConfigByScope(changes)
    const next = deepMerge(split.global as Config, globals)
    const project = deepMerge(split.project as Config, projects)
    vscode.postMessage({
      type: "updateConfig",
      config: pruneConfigSet(next) as Config,
      projectConfig: pruneConfigSet(project) as Config,
      globalUnset: configUnsetPaths(next),
      projectUnset: configUnsetPaths(project),
      globalBindingId: bindings().global?.id,
      projectBindingId: bindings().project?.id,
    })
  }

  function discardConfig() {
    setConfig(saved())
    setGlobalConfig(savedGlobal())
    setProjectConfig(savedProject())
    setDraft({})
    setGlobalDraft({})
    setProjectDraft({})
    setSettings(savedSettings())
    setSettingsDraft({})
    setSaveError(null)
  }

  const value: ConfigContextValue = {
    config,
    globalConfig,
    globalDraft,
    projectConfig,
    collections,
    settings,
    features,
    loading,
    isDirty,
    saving,
    saveError,
    updateConfig,
    updateGlobalConfig,
    applyGlobalConfig,
    updateProjectConfig,
    updateSetting,
    applySetting,
    saveConfig,
    discardConfig,
  }

  return createComponent(ConfigContext.Provider, {
    value,
    get children() {
      return props.children
    },
  })
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider")
  }
  return context
}
