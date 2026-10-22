/** Read-only backend configuration and chat display settings. */
import { createContext, useContext, createSignal, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Config, ConfigCollections, ExtensionMessage } from "../types/messages"

interface ConfigContextValue {
  config: Accessor<Config>
  globalConfig: Accessor<Config>
  projectConfig: Accessor<Config>
  collections: Accessor<ConfigCollections>
  settings: Accessor<Record<string, unknown>>
  shortcuts: Accessor<{ bindings: Record<string, string>; selection: boolean }>
  loading: Accessor<boolean>
}

export const ConfigContext = createContext<ConfigContextValue>()

function loadedSettings(message: ExtensionMessage): Record<string, unknown> | undefined {
  if (message.type === "chatSettingsLoaded") {
    return { "chat.shiftTabCyclesVariant": message.settings.shiftTabCyclesVariant }
  }
  if (message.type === "throughputSettingLoaded") return { showTokenThroughput: message.visible }
  if (message.type === "autoApprovalReasonSettingLoaded") return { showAutoApprovalReason: message.visible }
  if (message.type === "shortcutHintsSettingLoaded") return { showShortcutHints: message.visible }
}

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [config, setConfig] = createSignal<Config>({})
  const [globalConfig, setGlobalConfig] = createSignal<Config>({})
  const [projectConfig, setProjectConfig] = createSignal<Config>({})
  const [collections, setCollections] = createSignal<ConfigCollections>({})
  const [settings, setSettings] = createSignal<Record<string, unknown>>({})
  const [shortcuts, setShortcuts] = createSignal({ bindings: {} as Record<string, string>, selection: false })
  const [loading, setLoading] = createSignal(true)

  // Subscribe before mount so the initial host push is not lost.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    const patch = loadedSettings(message)
    if (patch) setSettings((prev) => ({ ...prev, ...patch }))
    if (message.type === "shortcutContext") {
      setShortcuts({ bindings: message.bindings, selection: message.selection })
    }
    if (message.type === "globalConfigLoaded") setGlobalConfig(message.config)
    if (message.type !== "configLoaded") return
    setConfig(message.config)
    if (message.globalConfig !== undefined) setGlobalConfig(message.globalConfig)
    if (message.projectConfig !== undefined) setProjectConfig(message.projectConfig)
    if (message.collections !== undefined) setCollections(message.collections)
    if (message.settings) setSettings((prev) => ({ ...prev, ...message.settings }))
    setLoading(false)
  })
  onCleanup(unsubscribe)

  const requestInitialData = () => {
    vscode.postMessage({ type: "requestConfig" })
    vscode.postMessage({ type: "requestChatSettings" })
    vscode.postMessage({ type: "requestThroughputSetting" })
    vscode.postMessage({ type: "requestAutoApprovalReasonSetting" })
  }
  requestInitialData()

  const fallback = setTimeout(() => {
    if (loading()) requestInitialData()
  }, 3000)
  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    clearTimeout(fallback)
    if (loading()) requestInitialData()
  })
  onCleanup(() => {
    unsubReady()
    clearTimeout(fallback)
  })

  const value: ConfigContextValue = { config, globalConfig, projectConfig, collections, settings, shortcuts, loading }
  return <ConfigContext.Provider value={value}>{props.children}</ConfigContext.Provider>
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext)
  if (!context) throw new Error("useConfig must be used within a ConfigProvider")
  return context
}
