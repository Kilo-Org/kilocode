import type { Accessor } from "solid-js"
import type { AgentConfig, ExtensionMessage, ModelSelection } from "../types/messages"
import {
  DEFAULT_VARIANT,
  getAgentVariant,
  getVariant,
  legacyVariantKey,
  preserveVariant,
  variantKey,
} from "./session-variant-store"

interface Model {
  variants?: Record<string, unknown>
}

type Message = { type: "requestVariants" } | { type: "persistVariant"; key: string; value: string }

interface Options {
  selections: Accessor<Record<string, string>>
  set: (key: string, value: string) => void
  selected: (sessionID?: string) => ModelSelection | null
  session: Accessor<string>
  agent: (sessionID?: string) => string
  config: (agent: string) => Pick<AgentConfig, "model" | "variant"> | undefined
  find: (selection: ModelSelection) => Model | undefined
  post: (message: Message) => void
  listen: (handler: (message: ExtensionMessage) => void) => () => void
  draft: (id: string) => boolean
  remember: (agent: string, model: ModelSelection, variant: string) => void
}

export function createSessionVariants(options: Options) {
  const list = (sessionID?: string) => {
    const selection = options.selected(sessionID)
    if (!selection) return []
    return Object.keys(options.find(selection)?.variants ?? {})
  }

  const configured = (name: string, selection: ModelSelection) => {
    const config = options.config(name)
    if (config?.model !== `${selection.providerID}/${selection.modelID}`) return undefined
    return config.variant ?? undefined
  }

  const agent = (name: string, selection: ModelSelection | null) => {
    if (!selection) return undefined
    return getAgentVariant(options.selections(), selection, options.find(selection), name, configured(name, selection))
  }

  const current = (sessionID?: string) => {
    const sid = sessionID ?? options.session()
    const selection = options.selected(sid)
    if (!selection) return undefined
    const variants = list(sid)
    if (variants.length === 0) return undefined
    const name = options.agent(sid)
    return getVariant(options.selections(), selection, variants, name, sid, configured(name, selection))
  }

  const request = (sessionID?: string) =>
    current(sessionID) ?? (list(sessionID).length > 0 ? DEFAULT_VARIANT : undefined)

  // The raw choice behind current(), in the same order: scoped, then the
  // configured variant, then remembered, then legacy. An explicit Default stays
  // "" so carry and the worktree dialog can honor it.
  const saved = (selection: ModelSelection, name: string, sessionID?: string) => {
    const scoped = sessionID ? options.selections()[variantKey(selection, name, sessionID)] : undefined
    if (scoped !== undefined) return scoped
    const preset = configured(name, selection)
    if (preset && Object.keys(options.find(selection)?.variants ?? {}).includes(preset)) return preset
    return options.selections()[variantKey(selection, name)] ?? options.selections()[legacyVariantKey(selection)]
  }

  const choice = (sessionID?: string) => {
    const id = sessionID ?? options.session()
    const model = options.selected(id)
    return model ? saved(model, options.agent(id), id) : undefined
  }

  const select = (value: string | undefined, sessionID?: string) => {
    const sid = sessionID ?? options.session()
    const selection = options.selected(sid)
    if (!selection) return
    const next = value ?? DEFAULT_VARIANT
    options.set(variantKey(selection, options.agent(sid), sid), next)
    if (options.draft(sid)) options.remember(options.agent(sid), selection, next)
  }

  const carry = (selection: ModelSelection, value: string | undefined, name: string, sessionID?: string) => {
    const list = Object.keys(options.find(selection)?.variants ?? {})
    if (list.length === 0) return
    // Undefined leaves the target's effort intact; an explicit Default must be carried.
    const next = value === DEFAULT_VARIANT ? DEFAULT_VARIANT : preserveVariant(value, list)
    if (next === undefined) return
    options.set(variantKey(selection, name, sessionID), next)
  }

  const load = () => {
    const unsub = options.listen((message) => {
      if (message.type !== "variantsLoaded") return
      for (const [key, value] of Object.entries(message.variants)) {
        if (key.startsWith("session/")) continue
        options.set(key, value)
      }
    })
    options.post({ type: "requestVariants" })
    return unsub
  }

  return { carry, list, agent, current, request, saved, choice, select, load }
}
