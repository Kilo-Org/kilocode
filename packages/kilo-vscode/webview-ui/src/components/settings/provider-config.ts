import type { Config, Provider } from "../../types/messages"
import {
  CUSTOM_PROVIDER_PACKAGE,
  KILO_PROVIDER_ID,
  kiloGatewayHidden,
} from "../../../../src/shared/provider-model"

export function providersFromConfig(cfg: Config, catalog: Record<string, Provider>): Provider[] {
  const items: Provider[] = []
  for (const [id, raw] of Object.entries(cfg.provider ?? {})) {
    if (id === KILO_PROVIDER_ID || !raw) continue
    const models = raw.models ?? {}
    if (Object.keys(models).length === 0) continue
    const existing = catalog[id]
    if (existing) {
      items.push(existing)
      continue
    }
    items.push({
      id,
      name: raw.name ?? id,
      env: [],
      models,
      source: raw.npm === CUSTOM_PROVIDER_PACKAGE ? "config" : "custom",
    } as Provider)
  }
  return items
}

export function customApiOnly(cfg: Config) {
  const enabled = cfg.enabled_providers
  if (!enabled?.length) return false
  return kiloGatewayHidden(cfg)
}
