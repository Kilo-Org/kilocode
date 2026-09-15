import { batch } from "solid-js"
import type { ModelSelection, WebviewMessage } from "../types/messages"
import { variantKey } from "./session-variant-store"

interface Store {
  modelSelections: Record<string, ModelSelection | null>
  sessionOverrides: Record<string, ModelSelection>
  agentSelections: Record<string, string>
  variantSelections: Record<string, string>
}

export function createModelPreferences(options: {
  store: Store
  model: (scope: "modelSelections" | "sessionOverrides", id: string, model: ModelSelection) => void
  set: (key: string, variant: string) => void
  scopes: () => (string | undefined)[]
  initialized: (id: string) => boolean
  selected: (id: string) => ModelSelection | null
  defaults: (agent: string) => ModelSelection | null | undefined
  agent: (id: string) => string
  variant: (id: string, model: ModelSelection) => string | undefined
  recent: (model: ModelSelection) => void
  update: (agent: string, model: ModelSelection, variant: string) => void
  post: (message: WebviewMessage) => void
}) {
  function pin(id: string) {
    if (!options.store.sessionOverrides[id] && !options.initialized(id)) return
    const model = options.store.sessionOverrides[id] ?? options.defaults(options.agent(id)) ?? options.selected(id)
    if (!model) return
    const key = variantKey(model, options.agent(id), id)
    const value = options.variant(id, model)
    if (options.store.variantSelections[key] === undefined && value !== undefined) options.set(key, value)
    // Copy inherited models so updates to a mode's store cannot mutate the session.
    if (!options.store.sessionOverrides[id]) options.model("sessionOverrides", id, { ...model })
  }

  function retain() {
    const ids = new Set([...options.scopes(), ...Object.keys(options.store.agentSelections)])
    for (const id of ids) if (id) pin(id)
  }

  function apply(agent: string, model: ModelSelection, id?: string) {
    if (id) {
      if (!/^(?:sidebar-)?pending:/.test(id)) options.recent(model)
      options.model("sessionOverrides", id, model)
      return
    }
    retain()
    options.model("modelSelections", agent, model)
  }

  function remember(agent: string, model: ModelSelection, variant = "") {
    batch(() => {
      // New-session defaults must not change other open sessions or drafts.
      retain()
      options.recent(model)
      options.model("modelSelections", agent, { ...model })
      options.set(variantKey(model, agent), variant)
      options.update(agent, model, variant)
    })
    options.post({
      type: "persistModelSelection",
      agent,
      providerID: model.providerID,
      modelID: model.modelID,
      variant,
    })
    options.post({ type: "persistVariant", key: variantKey(model, agent), value: variant })
  }

  return { apply, pin, remember }
}
