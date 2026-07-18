/**
 * Provider routing config shapes shared by the webview (Settings save path)
 * and the extension host (chat persistence path). Keeping the owned-field
 * list in one place guarantees both entry points touch exactly the same keys
 * and leave hand-configured siblings (e.g. data_collection, sort) alone.
 */

/** The routing-preference fields owned by the provider routing UI. */
export const ROUTING_KEYS = ["order", "only", "allow_fallbacks"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Routing preferences pinning a model to a single upstream provider. */
export function routingValue(provider: string): Record<string, unknown> {
  return { order: [provider], only: [provider], allow_fallbacks: false }
}

/** Null sentinels clearing exactly the owned fields (null = unset downstream). */
export function routingClear(): Record<string, null> {
  return Object.fromEntries(ROUTING_KEYS.map((key) => [key, null])) as Record<string, null>
}

/** Config unset paths for the owned fields of one model. */
export function routingUnsetPaths(providerID: string, modelID: string): string[][] {
  return ROUTING_KEYS.map((key) => ["provider", providerID, "models", modelID, "options", "provider", key])
}

/** Read the routing slug pinned for a model in a config object, if any. */
export function modelRouting(config: unknown, providerID: string, modelID: string): string | undefined {
  const providers = isRecord(config) ? config.provider : undefined
  const entry = isRecord(providers) ? providers[providerID] : undefined
  const models = isRecord(entry) ? entry.models : undefined
  const model = isRecord(models) ? models[modelID] : undefined
  const options = isRecord(model) ? model.options : undefined
  const routing = isRecord(options) ? options.provider : undefined
  if (!isRecord(routing)) return undefined
  const first = (value: unknown) => {
    if (!Array.isArray(value)) return undefined
    const head: unknown = value[0]
    return typeof head === "string" ? head : undefined
  }
  return first(routing.only) ?? first(routing.order)
}

/**
 * Config partial pinning a model to a routing slug. Clearing (null) writes null
 * sentinels for only the fields this UI owns — sibling routing preferences the
 * user configured by hand stay untouched.
 */
export function routingPartial(providerID: string, modelID: string, provider: string | null) {
  const value = provider === null ? routingClear() : routingValue(provider)
  return { provider: { [providerID]: { models: { [modelID]: { options: { provider: value } } } } } }
}
