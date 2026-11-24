/**
 * Provider/model context
 * Manages available providers, models, and the global default selection.
 * Selection is now per-session — see session.tsx.
 */

import { batch, createContext, useContext, createSignal, createMemo, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Provider, ProviderModel, ModelSelection, ExtensionMessage, ProviderAuthState } from "../types/messages"
import type { ProviderAuthMethod, ProviderFailure } from "@kilocode/sdk/v2/client"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { flattenModels, findModel as _findModel, isModelValid as isValid } from "./provider-utils"
import { KILO_AUTO } from "../../../src/shared/provider-model"

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }

interface ProviderContextValue {
  providers: Accessor<Record<string, Provider>>
  connected: Accessor<string[]>
  defaults: Accessor<Record<string, string>>
  organizationId: Accessor<string | null | undefined>
  ready: Accessor<boolean>
  defaultSelection: Accessor<ModelSelection>
  models: Accessor<EnrichedModel[]>
  findModel: (selection: ModelSelection | null) => EnrichedModel | undefined
  authMethods: Accessor<Record<string, ProviderAuthMethod[]>>
  authStates: Accessor<Record<string, ProviderAuthState>>
  isModelValid: (selection: ModelSelection | null) => boolean
  /** The organization's Kilo catalog failed to load; the host retries until it recovers. */
  kiloUnavailable: Accessor<boolean>
  /** Typed reasons providers failed to load, so the UI can explain why instead of hiding them. */
  failures: Accessor<ProviderFailure[]>
  /** The last provider read failed, so the view has no provider data for this project. */
  loadFailed: Accessor<boolean>
  /** Registers the calling provider dialog, so a project switch closes it with that project's state. */
  trackDialog: () => void
}

export const ProviderContext = createContext<ProviderContextValue>()

export const ProviderProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const dialog = useDialog()

  const [providers, setProviders] = createSignal<Record<string, Provider>>({})
  const [connected, setConnected] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<Record<string, string>>({})
  const [organizationId, setOrganizationId] = createSignal<string | null>()
  const [ready, setReady] = createSignal(false)
  const [defaultSelection, setDefaultSelection] = createSignal<ModelSelection>(KILO_AUTO)
  const [authMethods, setAuthMethods] = createSignal<Record<string, ProviderAuthMethod[]>>({})
  const [authStates, setAuthStates] = createSignal<Record<string, ProviderAuthState>>({})
  const [kiloUnavailable, setKiloUnavailable] = createSignal(false)
  const [failures, setFailures] = createSignal<ProviderFailure[]>([])
  const [loadFailed, setLoadFailed] = createSignal(false)
  // Provider dialogs that belong to one project's provider state, so a switch closes them
  // instead of every dialog the settings surface happens to have open.
  const [dialogs, setDialogs] = createSignal(0)

  function trackDialog() {
    setDialogs((count) => count + 1)
    let open = true
    onCleanup(() => {
      if (!open) return
      open = false
      setDialogs((count) => count - 1)
    })
  }

  const models = createMemo<EnrichedModel[]>(() => flattenModels(providers()))

  function findModel(selection: ModelSelection | null): EnrichedModel | undefined {
    return _findModel(models(), selection)
  }

  function isModelValid(selection: ModelSelection | null): boolean {
    return isValid(providers(), connected(), selection)
  }

  // Register handler immediately (not in onMount) so we never miss
  // a providersLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "providersReset") {
      // A different project is shown now, so no row from the previous read may survive.
      batch(() => {
        setReady(false)
        setOrganizationId(undefined)
        setProviders({})
        setDefaults({})
        setConnected([])
        setAuthMethods({})
        setAuthStates({})
        setFailures([])
        setKiloUnavailable(false)
        setDefaultSelection(KILO_AUTO)
        setLoadFailed(false)
        // A provider dialog belongs to one project, so it closes with that project's state;
        // an unrelated settings dialog stays open.
        if (dialogs() > 0 && dialog.active) dialog.close()
      })
      return
    }
    if (message.type === "providersLoading") {
      batch(() => {
        setReady(false)
        setOrganizationId(undefined)
        setProviders((prev) => {
          const next = { ...prev }
          delete next.kilo
          return next
        })
        setDefaults((prev) => {
          const next = { ...prev }
          delete next.kilo
          return next
        })
        setConnected((prev) => prev.filter((id) => id !== "kilo"))
        setFailures((prev) => prev.filter((item) => item.providerID !== "kilo"))
        setLoadFailed(false)
      })
      return
    }
    if (message.type !== "providersLoaded") return

    batch(() => {
      setProviders(message.providers)
      setConnected(message.connected)
      setDefaults(message.defaults)
      setOrganizationId(message.ready === false ? undefined : (message.organizationId ?? null))
      setReady(message.ready ?? true)
      setDefaultSelection(message.defaultSelection)
      setAuthMethods(message.authMethods)
      setAuthStates(message.authStates)
      setKiloUnavailable(message.kiloUnavailable ?? false)
      setFailures(message.failures ?? [])
      setLoadFailed(message.loadFailed === true)
    })
  })

  onCleanup(unsubscribe)

  // Request providers immediately; if the extension's httpClient is not yet ready,
  // extensionDataReady will fire once initialization completes and we retry once.
  vscode.postMessage({ type: "requestProviders" })

  const fallback = setTimeout(() => {
    if (Object.keys(providers()).length === 0) {
      vscode.postMessage({ type: "requestProviders" })
    }
  }, 3000)

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    clearTimeout(fallback)
    if (Object.keys(providers()).length === 0) {
      vscode.postMessage({ type: "requestProviders" })
    }
  })

  onCleanup(() => {
    unsubReady()
    clearTimeout(fallback)
  })

  const value: ProviderContextValue = {
    providers,
    connected,
    defaults,
    organizationId,
    ready,
    defaultSelection,
    models,
    findModel,
    authMethods,
    authStates,
    isModelValid,
    kiloUnavailable,
    failures,
    loadFailed,
    trackDialog,
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
