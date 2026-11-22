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
  hideRemovedMcp,
  mergeScopedConfig,
  pruneConfigSet,
  removeMcpConfig,
  retainUnconfirmedMcpRemovals,
  stripNulls,
  resolveConfig,
} from "../utils/config-utils"
import { splitConfigByScope } from "../utils/config-scope"

function has(value: Record<string, unknown>) {
  return Object.keys(value).length > 0
}

/**
 * VS Code configuration key → local `settings()` property, for the writes whose
 * two names differ. Keys absent here are their own property name.
 */
const settingProperties: Record<string, string> = {
  "agentManager.browser.openLinksIn": "agentManagerBrowserOpenLinksIn",
  "agentManager.browser.useSystemChrome": "agentManagerBrowserUseSystemChrome",
  "experimental.agentManagerSplash": "agentManagerSplash",
  "experimental.browserAutomation": "browserAutomation",
  "experimental.claudeMigration": "claudeMigration",
  "experimental.conversationPromptHistory": "conversationPromptHistory",
}

/**
 * How long a settings write chain waits for the host's terminal message. A chain the host
 * stops answering settles at this bound instead of holding its key open forever. It is a
 * `const` binding with a mutable holder so a fixture can shorten it without waiting ten
 * seconds; the app never changes it.
 */
export const settleBound = { ms: 10_000 }

/** One chain of `updateSetting` writes to a single key, reconciled with the host's answers. */
interface PendingWrite {
  /** The `settings()` property the key writes. */
  property: string
  /** The rendered value before the chain's first write. */
  previous: unknown
  /** Writes still awaiting a terminal message, oldest first, with their chain order. */
  awaiting: { order: number; value: unknown }[]
  /** The value the newest orderable success confirmed. */
  stored: unknown
  /** Tells a confirmed `undefined` apart from no confirmation. */
  hasStored: boolean
  /** Order of the chain's newest write. */
  order: number
  /** Order of the write whose success set `stored`; `undefined` until one is matched. */
  storedOrder: number | undefined
  /** When the chain last heard from a write or a terminal message, in `Date.now()` ms. */
  at: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export interface SaveError {
  message: string
  details?: string
}

interface ConfigContextValue {
  config: Accessor<Config>
  globalConfig: Accessor<Config>
  globalDraft: Accessor<Partial<Config>>
  projectConfig: Accessor<Config>
  collections: Accessor<ConfigCollections>
  settings: Accessor<Record<string, unknown>>
  /** Shortcut labels and editor state for prompt shortcut hints. */
  shortcuts: Accessor<{ bindings: Record<string, string>; selection: boolean }>
  features: Accessor<FeatureFlags>
  loading: Accessor<boolean>
  isDirty: Accessor<boolean>
  saving: Accessor<boolean>
  saveError: Accessor<SaveError | null>
  /** Dismiss the reported save or settings-write error. */
  clearSaveError: () => void
  updateConfig: (partial: Partial<Config>) => void
  updateGlobalConfig: (partial: Partial<Config>) => void
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
    return {
      "chat.shiftTabCyclesVariant": message.settings.shiftTabCyclesVariant,
      agentManagerSplash: message.settings.agentManagerSplash,
      browserAutomation: message.settings.browserAutomation,
      agentManagerBrowserOpenLinksIn: message.settings.agentManagerBrowserOpenLinksIn,
      workspaceTrusted: message.settings.workspaceTrusted,
    }
  }
  if (message.type === "throughputSettingLoaded") return { showTokenThroughput: message.visible }
  if (message.type === "autoApprovalReasonSettingLoaded") return { showAutoApprovalReason: message.visible }
  if (message.type === "pushFixesSettingLoaded") return { "agentManager.pushFixes": message.enabled }
  if (message.type === "shortcutHintsSettingLoaded") return { showShortcutHints: message.visible }
}

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const initial = {
    agentManagerSplash: (window as { KILO_AGENT_MANAGER_SPLASH?: boolean }).KILO_AGENT_MANAGER_SPLASH === true,
  }

  const [config, setConfig] = createSignal<Config>({})
  const [globalConfig, setGlobalConfig] = createSignal<Config>({})
  const [projectConfig, setProjectConfig] = createSignal<Config>({})
  const [collections, setCollections] = createSignal<ConfigCollections>({})
  const [settings, setSettings] = createSignal<Record<string, unknown>>(initial)
  const [shortcuts, setShortcuts] = createSignal({ bindings: {} as Record<string, string>, selection: false })
  const [features, setFeatures] = createSignal<FeatureFlags>({
    indexing: false,
    sandboxControls: false,
    backgroundSubagents: false,
    speechToText: false,
  })
  const [loading, setLoading] = createSignal(true)
  const [draft, setDraft] = createSignal<Partial<Config>>({})
  const [globalDraft, setGlobalDraft] = createSignal<Partial<Config>>({})
  const [projectDraft, setProjectDraft] = createSignal<Partial<Config>>({})
  const [removedMcp, setRemovedMcp] = createSignal<Set<string>>(new Set())
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
  const [savedSettings, setSavedSettings] = createSignal<Record<string, unknown>>(initial)
  // True while a saveConfig() write is in-flight — used to clear draft on success
  // and to guard against stale configLoaded messages overwriting optimistic state.
  const [saving, setSaving] = createSignal(false)
  // Error from the most recent saveConfig() attempt, or null if no error.
  // Cleared when the user edits the draft again or starts a new save.
  const [saveError, setSaveError] = createSignal<SaveError | null>(null)
  // In-flight `updateSetting` writes, keyed by the write key the host echoes back. A chain
  // of writes to one key keeps the value before its first write as `previous`, the newest
  // intent as `value`, and every write still awaiting a terminal message in `awaiting`.
  // `stored` is the value of the newest write the host confirmed, `storedOrder` names that
  // write, and `hasStored` tells a confirmed `undefined` from no confirmation, so the final
  // settle adopts what the host holds. `at` and `timer` bound the chain: a host that never
  // answers settles it like a failure at `settleBound.ms` instead of holding the key
  // pending forever.
  const pendingWrites = new Map<string, PendingWrite>()
  /** The value the host holds for a chain: its newest confirmed write, else what it replaced. */
  const heldValue = (pending: PendingWrite) => (pending.hasStored ? pending.stored : pending.previous)
  const updateCollections = (next: ConfigCollections | undefined) => {
    if (next !== undefined) setCollections(next)
  }
  /** Forget a chain, stopping the settle timer that would expire it. */
  const dropWrite = (writeKey: string) => {
    const pending = pendingWrites.get(writeKey)
    if (pending == null) return undefined
    clearTimeout(pending.timer)
    pendingWrites.delete(writeKey)
    return pending
  }
  /**
   * Restart the settle bound after a write or a terminal message. The callback only expires
   * the chain it was armed for, so a timer that was cleared but still ran cannot settle a
   * newer chain on the same key.
   */
  const armWrite = (writeKey: string, pending: PendingWrite) => {
    clearTimeout(pending.timer)
    pending.at = Date.now()
    const armed = pending.at
    pending.timer = setTimeout(() => {
      if (pendingWrites.get(writeKey) !== pending || pending.at !== armed) return
      expireWrite(writeKey)
    }, settleBound.ms)
  }
  /**
   * Settle a chain the host never answered the way a failure settles it — on the value the
   * host confirmed, or the value the chain replaced — and report that the host did not
   * answer.
   */
  const expireWrite = (writeKey: string) => {
    const pending = dropWrite(writeKey)
    if (pending == null) return
    storeSetting(pending.property, pending.hasStored ? pending.stored : pending.previous)
    setSaveError({ message: `${writeKey} was not confirmed by the extension host.` })
  }
  /**
   * Record a write before its optimistic update, so a rejected chain can restore what it
   * replaced. Each write takes the chain's next order and restarts its settle bound.
   */
  const trackWrite = (writeKey: string, property: string, value: unknown) => {
    const pending = pendingWrites.get(writeKey)
    if (pending == null) {
      const created: PendingWrite = {
        property,
        previous: savedSettings()[property],
        awaiting: [{ order: 1, value }],
        stored: undefined,
        hasStored: false,
        order: 1,
        storedOrder: undefined,
        at: 0,
        timer: undefined,
      }
      pendingWrites.set(writeKey, created)
      armWrite(writeKey, created)
      return
    }
    pending.property = property
    pending.order += 1
    pending.awaiting.push({ order: pending.order, value })
    armWrite(writeKey, pending)
  }
  /**
   * Record a success against the write it answers, matched by value to the writes still
   * awaiting a terminal message. The host applies writes in order, so a success must not
   * replace the value a newer success already confirmed: `stored` advances only when the
   * arriving order is `storedOrder` or newer. A success whose value matches no awaiting
   * write cannot be placed in the chain, so it keeps the rule that the last settled success
   * wins and counts as the chain's newest order.
   */
  const confirmWrite = (pending: PendingWrite, value: unknown) => {
    const matched = pending.awaiting.find((write) => write.value === value)
    const order = matched?.order ?? pending.order
    if (matched == null) pending.awaiting.shift()
    else pending.awaiting.splice(pending.awaiting.indexOf(matched), 1)
    if (pending.storedOrder != null && order < pending.storedOrder) return
    pending.stored = value
    pending.hasStored = true
    pending.storedOrder = order
  }
  /**
   * Adopt a host-stored value as both the rendered and the discard value. A newer draft edit
   * for the same property stays in front: the user changed it again after this write, so the
   * control must keep showing that edit with `isDirty()` true.
   */
  const storeSetting = (property: string, value: unknown) => {
    const adopt = (prev: Record<string, unknown>) => {
      const next = { ...prev }
      if (value === undefined) delete next[property]
      else next[property] = value
      return next
    }
    setSavedSettings(adopt)
    setSettings((prev) => {
      if (Object.hasOwn(settingsDraft(), property)) return prev
      return adopt(prev)
    })
  }

  // Register handler immediately (not in onMount) so we never miss
  // a configLoaded message that arrives before the DOM mount.
  const unsubscribeSettings = vscode.onMessage((message: ExtensionMessage) => {
    const patch = loadedSettings(message)
    if (patch) mergeSettings(patch)
  })
  const unsubscribeMcpLifecycle = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "mcpRemoved") {
      setRemovedMcp((current) => new Set(current).add(message.name))
      setConfig((value) => removeMcpConfig(value, message.name))
      setSaved((value) => removeMcpConfig(value, message.name))
      setDraft((value) => removeMcpConfig(value as Config, message.name))
      setGlobalConfig((value) => removeMcpConfig(value, message.name))
      setSavedGlobal((value) => removeMcpConfig(value, message.name))
      setGlobalDraft((value) => removeMcpConfig(value as Config, message.name))
      setProjectConfig((value) => removeMcpConfig(value, message.name))
      setSavedProject((value) => removeMcpConfig(value, message.name))
      setProjectDraft((value) => removeMcpConfig(value as Config, message.name))
      return
    }
    if (message.type === "mcpInstalled") {
      setRemovedMcp((current) => {
        const next = new Set(current)
        next.delete(message.name)
        return next
      })
      vscode.postMessage({ type: "requestConfig" })
    }
  })
  const unsubscribeShortcuts = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "shortcutContext") return
    setShortcuts({ bindings: message.bindings, selection: message.selection })
  })
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "configLoaded") {
      // Skip if a save is in-flight — a stale configLoaded must not overwrite
      // the optimistically-updated state while the write is being confirmed.
      if (saving()) return
      // Re-apply the draft on top so pending changes (e.g. a toggled switch the
      // user hasn't saved yet) stay visible instead of snapping back.
      const server = hideRemovedMcp(message.config, removedMcp())
      const global = message.globalConfig === undefined ? undefined : hideRemovedMcp(message.globalConfig, removedMcp())
      const project =
        message.projectConfig === undefined ? undefined : hideRemovedMcp(message.projectConfig, removedMcp())
      setConfig(
        resolveConfig(server, hideRemovedMcp(draft() as Config, removedMcp()), has(draft() as Record<string, unknown>)),
      )
      setFeatures(message.features)
      setSaved(server)
      setBindings(message.bindings ?? bindings())
      if (message.settings) mergeSettings(message.settings)
      if (global !== undefined) {
        setGlobalConfig(mergeScopedConfig(global, hideRemovedMcp(globalDraft() as Config, removedMcp())))
        setSavedGlobal(global)
      }
      if (project !== undefined) {
        setProjectConfig(mergeScopedConfig(project, hideRemovedMcp(projectDraft() as Config, removedMcp())))
        setSavedProject(project)
      }
      setRemovedMcp((current) => retainUnconfirmedMcpRemovals(current, message.config))
      updateCollections(message.collections)
      setLoading(false)
      return
    }
    if (message.type === "globalConfigLoaded") {
      if (saving()) return
      const server = hideRemovedMcp(message.config, removedMcp())
      setGlobalConfig(mergeScopedConfig(server, hideRemovedMcp(globalDraft() as Config, removedMcp())))
      setSavedGlobal(server)
      return
    }
    if (message.type === "configUpdated") {
      if (saving()) {
        // This configUpdated is the confirmation of our saveConfig() write.
        // Clear the draft now that the server has confirmed the write.
        setSaving(false)
        setDraft({})
        setGlobalDraft({})
        setProjectDraft({})
        setSaveError(null)
        setConfig(hideRemovedMcp(message.config, removedMcp()))
        if (message.globalConfig !== undefined) {
          const global = hideRemovedMcp(message.globalConfig, removedMcp())
          setGlobalConfig(global)
          setSavedGlobal(global)
        }
        if (message.projectConfig !== undefined) {
          const project = hideRemovedMcp(message.projectConfig, removedMcp())
          setProjectConfig(project)
          setSavedProject(project)
        }
        updateCollections(message.collections)
        setFeatures(message.features)
        setBindings(message.bindings ?? bindings())
      } else {
        // configUpdated from a different source (e.g. PermissionDock save).
        // Re-apply the draft on top so pending settings changes are preserved.
        setConfig(
          resolveConfig(
            hideRemovedMcp(message.config, removedMcp()),
            hideRemovedMcp(draft() as Config, removedMcp()),
            has(draft() as Record<string, unknown>),
          ),
        )
        if (message.globalConfig !== undefined) {
          const global = hideRemovedMcp(message.globalConfig, removedMcp())
          setGlobalConfig(mergeScopedConfig(global, hideRemovedMcp(globalDraft() as Config, removedMcp())))
          setSavedGlobal(global)
        }
        if (message.projectConfig !== undefined) {
          const project = hideRemovedMcp(message.projectConfig, removedMcp())
          setProjectConfig(mergeScopedConfig(project, hideRemovedMcp(projectDraft() as Config, removedMcp())))
          setSavedProject(project)
        }
        updateCollections(message.collections)
        setFeatures(message.features)
        setBindings(message.bindings ?? bindings())
      }
      if (message.settings) mergeSettings(message.settings)
      setSaved(hideRemovedMcp(message.config, removedMcp()))
      return
    }
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
  })
  const unsubscribeWrite = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "settingUpdated" && message.type !== "settingUpdateFailed") return
    const pending = pendingWrites.get(message.key)
    if (pending == null) {
      // A write this context did not send: adopt a stored value, report a failure.
      if (message.type === "settingUpdated") {
        storeSetting(settingProperties[message.key] ?? message.key, message.value)
        return
      }
      setSaveError({ message: message.message, details: message.details })
      return
    }
    if (message.type === "settingUpdated") confirmWrite(pending, message.value)
    else {
      // A rejection is reported at once, even while newer writes keep the chain pending.
      pending.awaiting.shift()
      setSaveError({ message: message.message, details: message.details })
    }
    // Every answer restarts the bound, so the timer only expires a chain that went quiet.
    armWrite(message.key, pending)
    // Adopt as soon as nothing is left awaiting, using the value the host holds.
    if (pending.awaiting.length > 0) return
    dropWrite(message.key)
    storeSetting(pending.property, heldValue(pending))
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
    unsubscribeSettings()
    unsubscribeMcpLifecycle()
    unsubscribeShortcuts()
    unsubscribe()
    unsubscribeExpired()
    unsubscribeFailure()
    unsubscribeWrite()
    unsubscribeIndexing()
    unsubscribeChat()
    // A chain timer must not fire into a torn-down provider.
    pendingWrites.forEach((pending) => clearTimeout(pending.timer))
    pendingWrites.clear()
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
    const wire = writeKey ?? key
    trackWrite(wire, key, value)
    setSavedSettings((prev) => ({ ...prev, [key]: value }))
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSettingsDraft((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setSaveError(null)
    vscode.postMessage({ type: "updateSetting", key: wire, value })
  }

  function saveConfig() {
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
        trackWrite(key, key, value)
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
    shortcuts,
    features,
    loading,
    isDirty,
    saving,
    saveError,
    clearSaveError: () => setSaveError(null),
    updateConfig,
    updateGlobalConfig,
    updateProjectConfig,
    updateSetting,
    applySetting,
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
