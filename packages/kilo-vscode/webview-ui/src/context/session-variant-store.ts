import type { ModelSelection } from "../types/messages"

const effort = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

/** Keep the selected effort when possible, falling back to the nearest known effort. */
export function preserveVariant(current: string | undefined, variants: string[]) {
  if (!current || variants.length === 0) return undefined
  if (variants.includes(current)) return current

  const rank = effort.indexOf(current)
  if (rank === -1) return undefined

  return variants
    .map((value, index) => ({
      value,
      index,
      rank: effort.indexOf(value),
      distance: Math.abs(effort.indexOf(value) - rank),
    }))
    .filter((item) => effort.includes(item.value))
    .sort((a, b) => a.distance - b.distance || b.rank - a.rank || a.index - b.index)[0]?.value
}

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
  return preserveVariant(stored, variants) ?? variants[0]
}

export function getAgentVariant(
  store: Record<string, string>,
  sel: ModelSelection,
  model: { variants?: Record<string, unknown> } | undefined,
  agent: string,
) {
  if (!model?.variants) return undefined
  return getVariant(store, sel, Object.keys(model.variants), agent)
}

/**
 * Next variant in the list, wrapping back to the first after the last.
 * An unknown or missing current value starts at the first variant.
 */
export function cycleVariant(current: string | undefined, variants: string[]) {
  if (variants.length === 0) return undefined
  const idx = current ? variants.indexOf(current) : -1
  return variants[(idx + 1) % variants.length]
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
