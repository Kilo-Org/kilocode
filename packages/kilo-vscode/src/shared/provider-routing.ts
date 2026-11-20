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

/** Read the routing preferences configured for a model, if any. */
function routingOptions(config: unknown, providerID: string, modelID: string): Record<string, unknown> | undefined {
  const providers = isRecord(config) ? config.provider : undefined
  const entry = isRecord(providers) ? providers[providerID] : undefined
  const models = isRecord(entry) ? entry.models : undefined
  const model = isRecord(models) ? models[modelID] : undefined
  const options = isRecord(model) ? model.options : undefined
  const routing = isRecord(options) ? options.provider : undefined
  return isRecord(routing) ? routing : undefined
}

/**
 * Whether a layer above the global config decides the routing fields this UI
 * owns: a pin in any project file, an explicit project reset
 * (`options.provider: null`), or a managed config. Selections are written to
 * the global config, so while this is true they cannot take effect. Both
 * configs must be the server-resolved ones — the effective config of the
 * session's workspace and the merged global config — because the backend
 * merges every config file, not only the ones the UI writes.
 */
export function routingOverridden(config: unknown, global: unknown, providerID: string, modelID: string): boolean {
  const effective = routingOptions(config, providerID, modelID)
  const written = routingOptions(global, providerID, modelID)
  return ROUTING_KEYS.some((key) => JSON.stringify(effective?.[key]) !== JSON.stringify(written?.[key]))
}

function slug(routing: Record<string, unknown> | undefined): string | undefined {
  if (!routing) return undefined
  const first = (value: unknown) => {
    if (!Array.isArray(value)) return undefined
    const head: unknown = value[0]
    return typeof head === "string" ? head : undefined
  }
  return first(routing.only) ?? first(routing.order)
}

/** Read the routing slug pinned for a model in a config object, if any. */
export function modelRouting(config: unknown, providerID: string, modelID: string): string | undefined {
  return slug(routingOptions(config, providerID, modelID))
}

/**
 * Whether the routing for a model is a hand-written setup the single-pin UI
 * cannot represent: several providers in `only` or `order`, or lists that
 * start with different providers. Presenting it as a pin of its first entry
 * would misstate what the gateway does, and a selection replaces all of it.
 */
export function routingCustom(config: unknown, providerID: string, modelID: string): boolean {
  const routing = routingOptions(config, providerID, modelID)
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  const only = list(routing?.only)
  const order = list(routing?.order)
  if (only.length > 1 || order.length > 1) return true
  return only.length === 1 && order.length === 1 && only[0] !== order[0]
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
