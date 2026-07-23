import type { ModelSelection } from "../types/messages"

function legacyVariantKey(sel: ModelSelection) {
  return `${sel.providerID}/${sel.modelID}`
}

export function variantKey(sel: ModelSelection, agent: string, session?: string) {
  const base = legacyVariantKey(sel)
  if (session) return `session/${session}/${agent}/${base}`
  return `agent/${agent}/${base}`
}

export function agentVariantKeys(store: Record<string, string>, agent: string) {
  const prefix = `agent/${agent}/`
  return Object.keys(store).filter((key) => key.startsWith(prefix))
}

export function modeVariant(
  current: ModelSelection | null,
  config: ModelSelection | null | undefined,
  variant?: string | null,
) {
  if (!current) return undefined
  if (!config) return variant ?? undefined
  if (config.providerID !== current.providerID || config.modelID !== current.modelID) return undefined
  return variant ?? undefined
}

function valid(value: string | undefined, variants: string[]) {
  return value && variants.includes(value) ? value : undefined
}

function pick(value: string | undefined, variants: string[]) {
  if (value === "default") return null
  return valid(value, variants)
}

function prompt(value: string | undefined, variants: string[]) {
  if (value === "default") return value
  return valid(value, variants)
}

export function getVariant(
  store: Record<string, string>,
  sel: ModelSelection,
  variants: string[],
  agent: string,
  session?: string,
  config?: string,
) {
  if (variants.length === 0) return undefined
  const sessionValue = session ? pick(store[variantKey(sel, agent, session)], variants) : undefined
  if (sessionValue === null) return undefined
  if (sessionValue) return sessionValue
  const pendingValue = pick(store[variantKey(sel, agent)], variants)
  if (pendingValue === null) return undefined
  if (pendingValue) return pendingValue
  const configValue = pick(config, variants)
  if (configValue === null) return undefined
  return configValue
}

export function getPromptVariant(
  store: Record<string, string>,
  sel: ModelSelection,
  variants: string[],
  agent: string,
  session?: string,
  config?: string,
) {
  if (variants.length === 0) return undefined
  const sessionValue = session ? prompt(store[variantKey(sel, agent, session)], variants) : undefined
  if (sessionValue) return sessionValue
  const pendingValue = prompt(store[variantKey(sel, agent)], variants)
  if (pendingValue) return pendingValue
  const configValue = pick(config, variants)
  if (configValue === null) return undefined
  return configValue
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
