/**
 * Provider/model context
 * Manages available providers, models, and the global default selection.
 * Selection is now per-session — see session.tsx.
 */

import { createContext, useContext, createSignal, createMemo, onCleanup, ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Provider, ProviderModel, ModelSelection, ExtensionMessage } from "../types/messages"
import { flattenModels, findModel as _findModel } from "./provider-utils"

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }

interface ProviderContextValue {
  providers: Accessor<Record<string, Provider>>
  connected: Accessor<string[]>
  defaults: Accessor<Record<string, string>>
  defaultSelection: Accessor<ModelSelection>
  models: Accessor<EnrichedModel[]>
  findModel: (selection: ModelSelection | null) => EnrichedModel | undefined
}

const KILO_AUTO: ModelSelection = { providerID: "kilo", modelID: "kilo/auto" }

const ProviderContext = createContext<ProviderContextValue>()

export const ProviderProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [providers, setProviders] = createSignal<Record<string, Provider>>({})
  const [connected, setConnected] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<Record<string, string>>({})
  const [defaultSelection, setDefaultSelection] = createSignal<ModelSelection>(KILO_AUTO)

  const models = createMemo<EnrichedModel[]>(() => flattenModels(providers()))

  function findModel(selection: ModelSelection | null): EnrichedModel | undefined {
    return _findModel(models(), selection)
  }

  // Register handler immediately (not in onMount) so we never miss
  // a providersLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "providersLoaded") {
      return
    }

    setProviders(message.providers)
    setConnected(message.connected)
    setDefaults(message.defaults)
    setDefaultSelection(message.defaultSelection)
  })

  onCleanup(unsubscribe)

  // Request providers in case the initial push was missed.
  // Retry a few times because the extension's httpClient may
  // not be ready yet when the first request arrives.
  let retries = 0
  const maxRetries = 5
  const retryMs = 500

  vscode.postMessage({ type: "requestProviders" })

  const retryTimer = setInterval(() => {
    retries++
    if (Object.keys(providers()).length > 0 || retries >= maxRetries) {
      clearInterval(retryTimer)
      return
    }
    vscode.postMessage({ type: "requestProviders" })
  }, retryMs)

  onCleanup(() => clearInterval(retryTimer))

  const value: ProviderContextValue = {
    providers,
    connected,
    defaults,
    defaultSelection,
    models,
    findModel,
  }

  return <ProviderContext.Provider value={value}>{props.children}</ProviderContext.Provider>
}

export function useProvider(): ProviderContextValue {
  const context = useContext(ProviderContext)
  if (!context) {
    throw new Error("useProvider must be used within a ProviderProvider")
  }
  return context
}
