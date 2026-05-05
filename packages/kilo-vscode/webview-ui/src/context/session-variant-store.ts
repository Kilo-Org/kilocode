import type { ModelSelection } from "../types/messages"

export function legacyVariantKey(sel: ModelSelection) {
  return `${sel.providerID}/${sel.modelID}`
}

export function variantKey(sel: ModelSelection, agent: string, session?: string) {
  const base = legacyVariantKey(sel)
  if (session) return `session/${session}/${base}`
  return `agent/${agent}/${base}`
}

export function getVariant(
  store: Record<string, string>,
  sel: ModelSelection,
  variants: string[],
  agent: string,
  session?: string,
) {
  if (variants.length === 0) return undefined
  const key = variantKey(sel, agent, session)
  const fallback = session ? store[variantKey(sel, agent)] : undefined
  const stored = store[key] ?? fallback ?? store[legacyVariantKey(sel)]
  return stored && variants.includes(stored) ? stored : variants[0]
}

export function transferVariants(store: Record<string, string>, from: string, to: string) {
  const prefix = `session/${from}/`
  return Object.fromEntries(
    Object.entries(store)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [`session/${to}/${key.slice(prefix.length)}`, value]),
  )
}

export function sessionVariantKeys(store: Record<string, string>, session: string) {
  const prefix = `session/${session}/`
  return Object.keys(store).filter((key) => key.startsWith(prefix))
}

export function sessionVariants(store: Record<string, string>, session: string) {
  const prefix = `session/${session}/`
  return Object.fromEntries(
    Object.entries(store)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  )
}
