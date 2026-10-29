// Provider helpers for the Providers tab. On v2 an integration and its credentials answer whether a key can change
// and which connections are visible, so this module holds only the custom-provider package set and the disable list.
import type { IntegrationInfo } from "@opencode/client"

/**
 * The v2 provider packages the custom provider dialog offers, in the dialog's order. They are built-in packages, so
 * a saved provider loads without an npm install.
 */
export const CUSTOM_PROVIDER_PACKAGES = [
  "@opencode/ai/providers/openai-compatible",
  "@opencode/ai/providers/openai",
  "@opencode/ai/providers/anthropic-compatible",
] as const

export type CustomProviderPackage = (typeof CUSTOM_PROVIDER_PACKAGES)[number]

export const CUSTOM_PROVIDER_PACKAGE: CustomProviderPackage = "@opencode/ai/providers/openai-compatible"

export function isCustomProviderPackage(value: unknown): value is CustomProviderPackage {
  return CUSTOM_PROVIDER_PACKAGES.includes(value as CustomProviderPackage)
}

/** Whether a `providers.<id>` config value describes a custom provider. */
export function isCustomProvider(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  return isCustomProviderPackage((value as { package?: unknown }).package)
}

/** The providers a user may still disable, sorted by name. */
export function disabledProviderOptions(items: IntegrationInfo[], disabled: string[]) {
  const current = new Set(disabled)
  return items
    .filter((item) => !current.has(item.id))
    .map((item) => ({ value: item.id, label: item.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export type ProviderPolicy = { action: string; resource: string; effect: string }

/**
 * True for a `provider.use` deny that names one provider. A `resource: "*"` deny is the catch-all of a legacy
 * `enabled_providers` allow-list, not a disabled provider, so it is excluded.
 */
export function isDisabledProviderPolicy(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const policy = value as { action?: unknown; resource?: unknown; effect?: unknown }
  return (
    policy.action === "provider.use" &&
    policy.effect === "deny" &&
    typeof policy.resource === "string" &&
    policy.resource !== "*"
  )
}

/** The disabled provider ids in a normalized `policies` value. */
export function disabledProviderIds(policies: unknown): string[] {
  if (!Array.isArray(policies)) return []
  return policies.flatMap((policy) =>
    isDisabledProviderPolicy(policy) ? [(policy as { resource: string }).resource] : [],
  )
}

/**
 * Replaces the per-provider deny policies with `next`, keeping every other policy, including the `*` catch-all of an
 * `enabled_providers` allow-list.
 */
export function withDisabledProviders(policies: ProviderPolicy[], next: string[]): ProviderPolicy[] {
  return [
    ...policies.filter((policy) => !isDisabledProviderPolicy(policy)),
    ...next.map((id) => ({ action: "provider.use", resource: id, effect: "deny" })),
  ]
}
