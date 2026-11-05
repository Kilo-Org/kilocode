// The model picker preferences of v1: favorites, recent picks, usage counts and remembered reasoning efforts. The
// host keeps them in globalState and broadcasts each change, so every webview shows the same state. The picker
// reads them through this optional context, as v1 read them from the session context: a picker without it (a story,
// a test) shows no favorites and no most used group.
import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentComponent } from "solid-js"
import type { ModelPreferenceRef, ModelPreferences, ModelUsageMap } from "../../../src/protocol"
import { useVSCode } from "./vscode"

const RECENT_LIMIT = 5

export interface ModelPreferencesValue {
  favorites: Accessor<ModelPreferenceRef[]>
  recents: Accessor<ModelPreferenceRef[]>
  usage: Accessor<ModelUsageMap>
  /** Whether the host answered; a default model must not skip the recents before they load. */
  loaded: Accessor<boolean>
  toggleFavorite: (providerID: string, modelID: string) => void
  /** Records an explicit pick: first in the recents, at most 5 (v1 `pushRecent`). */
  pushRecent: (providerID: string, modelID: string) => void
  /** Counts a sent prompt for the most used group (v1 `recordModelUsage`). */
  recordUsage: (providerID: string, modelID: string) => void
  /** The remembered effort of an agent and model: undefined when none, "" for an explicit Default. */
  variant: (agent: string, providerID: string, modelID: string) => string | undefined
  rememberVariant: (agent: string, providerID: string, modelID: string, variant: string | undefined) => void
}

export const ModelPreferencesContext = createContext<ModelPreferencesValue>()

export function useModelPreferences() {
  return useContext(ModelPreferencesContext)
}

/** v1 `variantKey` for a draft: the effort the next session of this agent starts with on this model. */
export function variantKey(agent: string, providerID: string, modelID: string) {
  return `agent/${agent}/${providerID}/${modelID}`
}

export const ModelPreferencesProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [state, setState] = createSignal<ModelPreferences>({ favorites: [], recents: [], usage: {}, variants: {} })
  const [loaded, setLoaded] = createSignal(false)
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "modelPreferencesLoaded") return
      setState(message.value)
      setLoaded(true)
    }),
  )
  vscode.postMessage({ type: "requestModelPreferences" })

  const value: ModelPreferencesValue = {
    favorites: () => state().favorites,
    recents: () => state().recents,
    usage: () => state().usage,
    loaded,
    toggleFavorite(providerID, modelID) {
      const starred = state().favorites.some((item) => item.providerID === providerID && item.modelID === modelID)
      // Optimistic, as v1: the star changes at once and the host broadcast confirms it.
      setState((prev) => ({
        ...prev,
        favorites: starred
          ? prev.favorites.filter((item) => item.providerID !== providerID || item.modelID !== modelID)
          : [...prev.favorites, { providerID, modelID }],
      }))
      vscode.postMessage({ type: "toggleFavorite", action: starred ? "remove" : "add", providerID, modelID })
    },
    pushRecent(providerID, modelID) {
      const recents = [
        { providerID, modelID },
        ...state().recents.filter((item) => item.providerID !== providerID || item.modelID !== modelID),
      ].slice(0, RECENT_LIMIT)
      setState((prev) => ({ ...prev, recents }))
      vscode.postMessage({ type: "persistRecents", recents })
    },
    recordUsage(providerID, modelID) {
      vscode.postMessage({ type: "recordModelUsage", providerID, modelID })
    },
    variant: (agent, providerID, modelID) => state().variants[variantKey(agent, providerID, modelID)],
    rememberVariant(agent, providerID, modelID, variant) {
      const key = variantKey(agent, providerID, modelID)
      const next = variant ?? ""
      if (state().variants[key] === next) return
      setState((prev) => ({ ...prev, variants: { ...prev.variants, [key]: next } }))
      vscode.postMessage({ type: "persistVariant", key, value: next })
    },
  }

  return <ModelPreferencesContext.Provider value={value}>{props.children}</ModelPreferencesContext.Provider>
}
