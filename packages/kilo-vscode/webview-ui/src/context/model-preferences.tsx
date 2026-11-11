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
  /** The model a new-session draft or dialog in this webview last picked for that agent. */
  pick: (agent: string | undefined) => { providerID: string; id: string } | undefined
  toggleFavorite: (providerID: string, modelID: string) => void
  /** Records an explicit pick: first in the recents, at most 5. */
  pushRecent: (providerID: string, modelID: string) => void
  /** Records a draft or dialog pick for that agent in this webview and pushes it to the shared recents. */
  rememberPick: (agent: string | undefined, providerID: string, modelID: string) => void
  /** Counts a sent prompt for the most used group. */
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

// A picker waits for the recents before it falls back, so a dialog does not open on one model and jump to another.
// The wait is bounded: if the host never answers, the picker still resolves a model instead of staying unsubmittable.
const PREFERENCES_WAIT = 5000

export const ModelPreferencesProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [state, setState] = createSignal<ModelPreferences>({ favorites: [], recents: [], usage: {}, variants: {} })
  const [loaded, setLoaded] = createSignal(false)
  const [picks, setPicks] = createSignal<Record<string, { providerID: string; id: string }>>({})
  const answered = setTimeout(() => setLoaded(true), PREFERENCES_WAIT)
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "modelPreferencesLoaded") return
      clearTimeout(answered)
      if (loaded() && message.value.recents.length === 0) setPicks({})
      setState(message.value)
      setLoaded(true)
    }),
  )
  onCleanup(() => clearTimeout(answered))
  vscode.postMessage({ type: "requestModelPreferences" })

  const pushRecent = (providerID: string, modelID: string) => {
    const recents = [
      { providerID, modelID },
      ...state().recents.filter((item) => item.providerID !== providerID || item.modelID !== modelID),
    ].slice(0, RECENT_LIMIT)
    setState((prev) => ({ ...prev, recents }))
    vscode.postMessage({ type: "persistRecents", recents })
  }

  const value: ModelPreferencesValue = {
    favorites: () => state().favorites,
    recents: () => state().recents,
    usage: () => state().usage,
    loaded,
    pick: (agent) => (agent ? picks()[agent] : undefined),
    toggleFavorite(providerID, modelID) {
      const starred = state().favorites.some((item) => item.providerID === providerID && item.modelID === modelID)
      setState((prev) => ({
        ...prev,
        favorites: starred
          ? prev.favorites.filter((item) => item.providerID !== providerID || item.modelID !== modelID)
          : [...prev.favorites, { providerID, modelID }],
      }))
      vscode.postMessage({ type: "toggleFavorite", action: starred ? "remove" : "add", providerID, modelID })
    },
    pushRecent,
    rememberPick(agent, providerID, modelID) {
      if (agent) setPicks((prev) => ({ ...prev, [agent]: { providerID, id: modelID } }))
      pushRecent(providerID, modelID)
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
