import type { Accessor } from "solid-js"
import type { ExtensionMessage, ModelSelection } from "../types/messages"
import { DEFAULT_VARIANT, getAgentVariant, getVariant, preserveVariant, variantKey } from "./session-variant-store"

interface Model {
  variants?: Record<string, unknown>
}

type Message = { type: "requestVariants" } | { type: "persistVariant"; key: string; value: string }

interface Options {
  selections: Accessor<Record<string, string>>
  set: (key: string, value: string) => void
  selected: (sessionID?: string) => ModelSelection | null
  session: Accessor<string | undefined>
  agent: (sessionID?: string) => string
  find: (selection: ModelSelection) => Model | undefined
  post: (message: Message) => void
  listen: (handler: (message: ExtensionMessage) => void) => () => void
}

export function createSessionVariants(options: Options) {
  const list = (sessionID?: string) => {
    const selection = options.selected(sessionID)
    if (!selection) return []
    return Object.keys(options.find(selection)?.variants ?? {})
  }

  const agent = (name: string, selection: ModelSelection | null) => {
    if (!selection) return undefined
    return getAgentVariant(options.selections(), selection, options.find(selection), name)
  }

  const current = (sessionID?: string) => {
    const sid = sessionID ?? options.session()
    const selection = options.selected(sid)
    if (!selection) return undefined
    const variants = list(sid)
    if (variants.length === 0) return undefined
    return getVariant(options.selections(), selection, variants, options.agent(sid), sid)
  }

  const select = (value: string | undefined, sessionID?: string) => {
    const sid = sessionID ?? options.session()
    const selection = options.selected(sid)
    if (!selection) return
    const key = variantKey(selection, options.agent(sid), sid)
    const next = value ?? DEFAULT_VARIANT
    options.set(key, next)
    if (!sid) options.post({ type: "persistVariant", key, value: next })
  }

  const carry = (selection: ModelSelection, value: string | undefined, name: string, sessionID?: string) => {
    const list = Object.keys(options.find(selection)?.variants ?? {})
    if (list.length === 0) return
    const next = value === undefined ? DEFAULT_VARIANT : preserveVariant(value, list)
    if (next === undefined) return
    const key = variantKey(selection, name, sessionID)
    options.set(key, next)
    if (!sessionID) options.post({ type: "persistVariant", key, value: next })
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

  return { carry, list, agent, current, select, load }
}
