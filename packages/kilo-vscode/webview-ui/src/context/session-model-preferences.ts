import { batch, createEffect, createSignal, on, type Accessor } from "solid-js"
import type { ModelSelection, WebviewMessage } from "../types/messages"
import { DEFAULT_VARIANT, sessionVariantKeys, variantKey } from "./session-variant-store"

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
  clear: (update: (store: Store) => void) => void
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
  const inventories = new Set<Accessor<readonly string[]>>()
  const [version, setVersion] = createSignal(0)
  const scopes = () => {
    version()
    return new Set(
      [...options.scopes(), ...[...inventories].flatMap((ids) => [...ids()])].filter((id): id is string => !!id),
    )
  }
  let previous = new Set<string>()
  const sync = (ids: Set<string>) => {
    for (const id of previous) if (/^(?:sidebar-)?pending:/.test(id) && !ids.has(id)) forget(id)
    previous = ids
    return ids
  }
  createEffect(on(scopes, sync))

  function track(ids: Accessor<readonly string[]>) {
    inventories.add(ids)
    setVersion((value) => value + 1)
    return () => {
      inventories.delete(ids)
      setVersion((value) => value + 1)
    }
  }

  function forget(id: string) {
    options.clear((store) => {
      delete store.agentSelections[id]
      delete store.sessionOverrides[id]
      for (const key of sessionVariantKeys(store.variantSelections, id)) delete store.variantSelections[key]
    })
  }

  function pin(id: string, freeze = false) {
    if (!options.store.sessionOverrides[id] && !options.initialized(id)) return
    const model = options.store.sessionOverrides[id] ?? options.defaults(options.agent(id)) ?? options.selected(id)
    if (!model) return
    const key = variantKey(model, options.agent(id), id)
    // Freeze this draft's displayed Default before another scope changes shared preferences.
    // Otherwise leave unset effort available for mode defaults, rather than inventing a choice.
    const value = options.variant(id, model) ?? (freeze ? DEFAULT_VARIANT : undefined)
    if (options.store.variantSelections[key] === undefined && value !== undefined) options.set(key, value)
    // Copy inherited models so updates to a mode's store cannot mutate the session.
    if (!options.store.sessionOverrides[id]) options.model("sessionOverrides", id, { ...model })
  }

  function retain() {
    for (const id of sync(scopes())) pin(id, true)
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

  return { apply, pin, remember, track, forget }
}
