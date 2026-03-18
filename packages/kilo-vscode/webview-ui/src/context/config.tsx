/**
 * Config context
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Config, ExtensionMessage } from "../types/messages"

interface ConfigContextValue {
  config: Accessor<Config>
  loading: Accessor<boolean>
  updateConfig: (partial: Partial<Config>) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** Deep merge two objects, with source values overriding target values. */
function deepMerge(target: Config, source: Partial<Config>): Config {
  const result: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key] as Config, value as Partial<Config>)
    } else {
      result[key] = value
    }
  }
  return result as Config
}

/** Recursively remove keys whose value is null (null = "deleted"). */
function stripNulls(obj: Config): Config {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (isRecord(value)) {
      result[key] = stripNulls(value as Config)
    } else {
      result[key] = value
    }
  }
  return result as Config
}

export const ConfigContext = createContext<ConfigContextValue>()

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [config, setConfig] = createSignal<Config>({})
  const [loading, setLoading] = createSignal(true)

  // Register handler immediately (not in onMount) so we never miss
  // a configLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "configLoaded") {
      setConfig(message.config)
      setLoading(false)
      return
    }
    if (message.type === "configUpdated") {
      setConfig(message.config)
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
    // Send to extension for persistence
    vscode.postMessage({ type: "updateConfig", config: partial })
  }

  const value: ConfigContextValue = {
    config,
    loading,
    updateConfig,
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
