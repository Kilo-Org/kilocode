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
  isRecord,
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

/** Deep equality over the draft's shape: records, arrays, and leaves, without serialising. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameValue(item, b[index]))
  }
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
}

/**
 * Remove from `draft` every path whose value a save posted unchanged, keeping the rest. A
 * confirmation clears what the save carried and leaves an edit the user made after posting
 * staged, so that edit stays on screen and dirty instead of being dropped with the draft.
 */
function prunePosted(draft: Partial<Config>, posted: Partial<Config>): Partial<Config> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    const source = posted as Record<string, unknown>
    if (!Object.hasOwn(source, key)) {
      result[key] = value
      continue
    }
    const saved = source[key]
    if (sameValue(value, saved)) continue
    if (isRecord(value) && isRecord(saved)) {
      const left = prunePosted(value as Config, saved as Partial<Config>)
      if (has(left as Record<string, unknown>)) result[key] = left
      continue
    }
    result[key] = value
  }
  return result as Partial<Config>
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

/**
 * How long a `saveConfig` write waits for the host's answering message. A save the host never
 * answers settles at this bound instead of leaving the Save button disabled forever. It is a
 * `const` binding with a mutable holder so a fixture can shorten it without waiting ten
 * seconds; the app never changes it.
 */
export const saveBound = { ms: 10_000 }

let writeCount = 0
/**
 * A fresh id for one `updateSetting` write. The host echoes it on that write's terminal
 * message, so the answer names the write it settles even when two writes share a key, a
 * value, or both.
 */
const nextWriteId = () => `w${(writeCount += 1).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

let saveCount = 0
/**
 * A fresh id for one `saveConfig` write. The host echoes it on the one message that answers
 * that write, so a `configUpdated` from another writer cannot be mistaken for its confirmation.
 */
const nextSaveId = () => `s${(saveCount += 1).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** One `updateSetting` write a chain is waiting on, with the chain order and id it was sent with. */
interface AwaitingWrite {
  order: number
  value: unknown
  writeId: string
  /**
   * Whether the write came from the save-bar draft (`saveConfig`) rather than an immediate
   * control (`applySetting`). One chain can hold both kinds, so the kind is per write: a
   * rejected draft write is staged again, a rejected immediate one is not.
   */
  staged: boolean
}

/** One chain of `updateSetting` writes to a single key, reconciled with the host's answers. */
interface PendingWrite {
  /** The `settings()` property the key writes. */
  property: string
  /**
   * The user-facing name of the control the chain writes, when the caller knows it. An
   * unanswered chain reports this name instead of the internal `property`.
   */
  label: string | undefined
  /** The rendered value before the chain's first write. */
  previous: unknown
  /** Writes still awaiting a terminal message, oldest first, with their chain order and id. */
  awaiting: AwaitingWrite[]
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

/**
 * A reported save or settings-write error. An error the host worded already carries its
 * `message`; one this context raises itself carries a translation `key` and the params to
 * resolve it with, so it is shown in the user's language. `ConfigProvider` mounts outside
 * `LanguageProvider`, so the key is resolved at the render site instead of here.
 */
export type SaveError =
  | { message: string; details?: string }
  | { key: string; params?: SaveErrorParams; details?: string }

export type SaveErrorParams = Record<string, string | number>

/** The sentence an error reports, translated when it carries a key and verbatim otherwise. */
export function saveErrorText(error: SaveError, t: (key: string, params?: SaveErrorParams) => string): string {
  if ("message" in error) return error.message
  return t(error.key, error.params)
}

/** The detail block an error shows, falling back to its own sentence when it carries none. */
export function saveErrorDetails(error: SaveError, t: (key: string, params?: SaveErrorParams) => string): string {
  return error.details ?? saveErrorText(error, t)
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
  applySetting: (key: string, value: unknown, writeKey?: string, label?: string) => void
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
  // The "not confirmed" error the most recent expiry raised, with the wire key it named. A
  // confirmation that arrives after the chain expired adopts the value and resolves that
  // error instead of leaving the page reporting a write the control has already taken.
  let expiredWrite: { wire: string; error: SaveError } | undefined
  // The id of the `saveConfig` write the Save button is waiting on, if any. Only the
  // `configUpdated` or `configUpdateFailed` that echoes it settles that save; an answer
  // without it came from another writer and must leave the save, and its draft, alone.
  let saveRequest: string | undefined
  // The "not confirmed" error the most recent save expiry raised, with the id it named. The
  // answer that arrives after the bound adopts the saved config and resolves that error
  // instead of leaving the page reporting a save the host has already stored.
  let expiredSave: { id: string; error: SaveError } | undefined
  // The drafts the in-flight save posted. Its confirmation clears only the paths they carry,
  // so an edit the user made after posting the save stays staged instead of being dropped.
  let postedSave: { config: Partial<Config>; global: Partial<Config>; project: Partial<Config> } | undefined
  // The bound that settles a save the host never answers.
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  /** Stop the bound that would settle an unanswered save. */
  const disarmSave = () => {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }
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
    const error: SaveError = {
      key: "settings.saveBar.unconfirmedWrite",
      params: { name: pending.label ?? pending.property },
    }
    expiredWrite = { wire: writeKey, error }
    setSaveError(error)
  }
  /**
   * Record a write before its optimistic update, so a rejected chain can restore what it
   * replaced, and return the id its outcome message must echo. Each write takes the chain's
   * next order, binds that id to it, and restarts its settle bound. `staged` tells a
   * `saveConfig` write apart from an immediate `applySetting` one; `label` names the control
   * the write comes from, and the newest named write names the chain.
   */
  const trackWrite = (writeKey: string, property: string, value: unknown, staged: boolean, label?: string) => {
    const writeId = nextWriteId()
    // A new write supersedes the "not confirmed" report an expiry raised for the same key.
    if (expiredWrite != null && expiredWrite.wire === writeKey) expiredWrite = undefined
    const pending = pendingWrites.get(writeKey)
    if (pending == null) {
      const created: PendingWrite = {
        property,
        label,
        previous: savedSettings()[property],
        awaiting: [{ order: 1, value, writeId, staged }],
        stored: undefined,
        hasStored: false,
        order: 1,
        storedOrder: undefined,
        at: 0,
        timer: undefined,
      }
      pendingWrites.set(writeKey, created)
      armWrite(writeKey, created)
      return writeId
    }
    pending.property = property
    pending.label = label ?? pending.label
    pending.order += 1
    pending.awaiting.push({ order: pending.order, value, writeId, staged })
    armWrite(writeKey, pending)
    return writeId
  }
  /** Remove the write an answer's id names, or nothing when it carries no id or names none. */
  const removeNamed = (pending: PendingWrite, writeId: string | undefined) => {
    if (writeId == null) return undefined
    const index = pending.awaiting.findIndex((write) => write.writeId === writeId)
    if (index < 0) return undefined
    return pending.awaiting.splice(index, 1)[0]
  }
  /**
   * Record a success against the write it answers. An id names exactly one write, so that
   * write settles even when another write sent the same value, or when the host returned a
   * different one (it stores `null` as `undefined`). An answer with no id falls back to the
   * oldest write whose value the host returned, and to the oldest write when the host
   * normalized that value; that write's own order is what the success confirms, so the
   * fallback cannot advance `stored` past a value another success already confirmed. Either
   * way `stored` only moves forward, to the newest write a success has confirmed.
   *
   * An id-less answer cannot be told apart from another write that carries the same value,
   * so the fallback matches primitives by value and otherwise takes the oldest outstanding
   * write; every write this context sends carries an id, so the fallback exists for a
   * message built elsewhere.
   */
  const confirmWrite = (pending: PendingWrite, value: unknown, writeId?: string) => {
    const named = removeNamed(pending, writeId)
    if (writeId != null && named == null) return false
    const index = pending.awaiting.findIndex((write) => write.value === value)
    const matched = named ?? pending.awaiting.splice(index < 0 ? 0 : index, 1)[0]
    if (matched == null) return false
    if (pending.storedOrder != null && matched.order < pending.storedOrder) return true
    pending.stored = value
    pending.hasStored = true
    pending.storedOrder = matched.order
    return true
  }
  /**
   * Drop the write a rejection settles: the one its id names, or with no id the oldest
   * pending write, and return it. An id that names no outstanding write leaves the chain
   * untouched and returns nothing, so a duplicate answer cannot consume another write.
   */
  const rejectWrite = (pending: PendingWrite, writeId?: string) => {
    const named = removeNamed(pending, writeId)
    if (named != null) return named
    if (writeId == null) return pending.awaiting.shift()
    return undefined
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
  /**
   * Apply a `configUpdated` push. The message that echoes the id of the save the Save button
   * is waiting on confirms that save and clears the paths it posted, and the same holds for a
   * save that already settled at the bound: its answer still adopts the stored config. Every
   * other push — another webview's save, a provider action, or the SSE-driven refresh —
   * re-applies the draft on top and leaves the in-flight save alone.
   */
  const applyConfigUpdated = (message: Extract<ExtensionMessage, { type: "configUpdated" }>) => {
    const pending = saveRequest != null && message.requestId === saveRequest
    const late = !pending && saveRequest == null && expiredSave != null && message.requestId === expiredSave.id
    const confirming = pending || late
    let leftConfig = draft()
    let leftGlobal = globalDraft()
    let leftProject = projectDraft()
    if (confirming) {
      saveRequest = undefined
      disarmSave()
      setSaving(false)
      // Clear only the paths the save posted. An edit the user made after posting it has a
      // different value, so it survives here, stays on screen, and keeps `isDirty()` true.
      const posted = postedSave
      postedSave = undefined
      if (posted != null) {
        leftConfig = prunePosted(leftConfig, posted.config)
        leftGlobal = prunePosted(leftGlobal, posted.global)
        leftProject = prunePosted(leftProject, posted.project)
      }
      setDraft(leftConfig)
      setGlobalDraft(leftGlobal)
      setProjectDraft(leftProject)
      if (pending) {
        expiredSave = undefined
        setSaveError(null)
      } else if (expiredSave != null) {
        // The host stored the save the bound had reported as unconfirmed. Resolve that report
        // only while it is the one on screen, so a newer error survives it.
        if (saveError() === expiredSave.error) setSaveError(null)
        expiredSave = undefined
      }
    }
    setConfig(
      resolveConfig(
        hideRemovedMcp(message.config, removedMcp()),
        hideRemovedMcp(leftConfig as Config, removedMcp()),
        has(leftConfig as Record<string, unknown>),
      ),
    )
    if (message.globalConfig !== undefined) {
      const global = hideRemovedMcp(message.globalConfig, removedMcp())
      setGlobalConfig(mergeScopedConfig(global, hideRemovedMcp(leftGlobal as Config, removedMcp())))
      setSavedGlobal(global)
    }
    if (message.projectConfig !== undefined) {
      const project = hideRemovedMcp(message.projectConfig, removedMcp())
      setProjectConfig(mergeScopedConfig(project, hideRemovedMcp(leftProject as Config, removedMcp())))
      setSavedProject(project)
    }
    updateCollections(message.collections)
    setFeatures(message.features)
    setBindings(message.bindings ?? bindings())
    if (message.settings) mergeSettings(message.settings)
    setSaved(hideRemovedMcp(message.config, removedMcp()))
  }

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
    if (message.type === "configUpdated") applyConfigUpdated(message)
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
    // A failure that names another writer's request cannot be the answer to our save: while a
    // save is in flight it must not settle ours, nor report over it.
    if (saving() && message.requestId !== undefined && message.requestId !== saveRequest) return
    // The host answered the save the bound had reported as unconfirmed, and answered it with
    // a failure: that answer is reported below, so the expiry report no longer stands for it.
    if (expiredSave != null && message.requestId === expiredSave.id) expiredSave = undefined
    saveRequest = undefined
    disarmSave()
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
      // A late answer for one of this context's own keys resolves through the mapping and
      // must still land, but a control that keeps its own state must not gain a
      // wire-key-named property here, so only a property this context already holds is set.
      if (message.type === "settingUpdated") {
        const property = settingProperties[message.key] ?? message.key
        if (Object.hasOwn(savedSettings(), property)) storeSetting(property, message.value)
        // The host confirmed after the chain expired and reported it unanswered: the control
        // now shows the value the host holds, so that report no longer describes anything.
        if (expiredWrite?.wire === message.key && saveError() === expiredWrite.error) {
          expiredWrite = undefined
          setSaveError(null)
        }
        return
      }
      // A failure that names a write id is this context's own write answering after its chain
      // settled. The host is answering something already answered, so it reports nothing.
      if (message.writeId != null) return
      setSaveError({ message: message.message, details: message.details })
      return
    }
    if (message.type === "settingUpdated") {
      if (!confirmWrite(pending, message.value, message.writeId)) return
    } else {
      const rejected = rejectWrite(pending, message.writeId)
      // An answer that consumes no outstanding write is the host answering something already
      // settled: it must not restart the bound, nor report a failure of a write that was
      // already answered.
      if (rejected == null) return
      // A rejection is reported at once, even while newer writes keep the chain pending.
      setSaveError({ message: message.message, details: message.details })
      // `saveConfig` cleared the draft before this answer landed, so a rejected staged write
      // would otherwise be lost with no Save button to retry it. Stage its value again so the
      // control shows the edit, `isDirty()` is true, and Discard returns to the stored value.
      // A newer edit for the same property stays in front, as the stored value does below.
      // Only the chain's newest write still carries the user's intent: a later write for the
      // same key already replaced it, and the settle adopts the value the host holds for that
      // later write, so re-staging this one would offer to write a value the host refused
      // over the one it accepted.
      if (rejected.staged && rejected.order === pending.order) {
        const property = pending.property
        setSettingsDraft((prev) => (Object.hasOwn(prev, property) ? prev : { ...prev, [property]: rejected.value }))
      }
    }
    // Every answer that consumed a write restarts the bound, so the timer only expires a
    // chain that went quiet.
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
    saveRequest = undefined
    disarmSave()
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
   * configuration key when the two differ (e.g. namespaced experimental keys);
   * `label` is the control's user-facing name, which an unanswered write reports
   * instead of the internal property name.
   */
  function applySetting(key: string, value: unknown, writeKey?: string, label?: string) {
    const wire = writeKey ?? key
    const writeId = trackWrite(wire, key, value, false, label)
    setSavedSettings((prev) => ({ ...prev, [key]: value }))
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSettingsDraft((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setSaveError(null)
    vscode.postMessage({ type: "updateSetting", key: wire, value, writeId })
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
    // A newer save supersedes the report an expiry raised for an older one, and the drafts it
    // posted, because only this save's answer settles it.
    expiredSave = undefined
    postedSave = undefined
    if (settingsDirty) {
      for (const [key, value] of Object.entries(pending)) {
        const writeId = trackWrite(key, key, value, true)
        vscode.postMessage({ type: "updateSetting", key, value, writeId })
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
    // Name this write so only the host's answer to it clears the save and its draft; a
    // configUpdated from another writer that lands in the meantime leaves both alone.
    const requestId = nextSaveId()
    saveRequest = requestId
    // What this save carries, per scope, so its confirmation clears exactly these paths. The
    // config payload spans both scopes, so the global and project drafts together are it.
    postedSave = {
      config: deepMerge(next, project),
      global: next,
      project,
    }
    disarmSave()
    saveTimer = setTimeout(() => {
      // Only the write this timer was armed for settles here: a newer save disarmed it, and a
      // stale callback must not clear a save the user started afterwards.
      if (saveRequest !== requestId) return
      saveRequest = undefined
      saveTimer = undefined
      setSaving(false)
      const error: SaveError = { key: "settings.saveBar.unconfirmedSave" }
      // Remember which save went unanswered, so the host's late answer for it still adopts
      // the stored config and resolves this report instead of reading as another writer's push.
      expiredSave = { id: requestId, error }
      // Every draft stays, so the save bar keeps showing the unconfirmed edit for a retry.
      setSaveError(error)
    }, saveBound.ms)
    vscode.postMessage({
      type: "updateConfig",
      config: pruneConfigSet(next) as Config,
      projectConfig: pruneConfigSet(project) as Config,
      globalUnset: configUnsetPaths(next),
      projectUnset: configUnsetPaths(project),
      globalBindingId: bindings().global?.id,
      projectBindingId: bindings().project?.id,
      requestId,
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
    expiredWrite = undefined
    saveRequest = undefined
    expiredSave = undefined
    disarmSave()
    setSaveError(null)
  }

  /**
   * Dismiss the reported error. The settings-write expiry goes with it, but the save expiry
   * stays: a dismissed report must not disable the answer that resolves it.
   */
  function clearSaveError() {
    expiredWrite = undefined
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
    clearSaveError,
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
