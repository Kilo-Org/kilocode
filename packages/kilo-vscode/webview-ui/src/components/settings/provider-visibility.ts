// Provider helpers for the Providers tab. On v2 an integration and its credentials answer whether a key can change
// and which connections are visible, so this module holds only the custom-provider package set and the disable list.
import type { IntegrationInfo } from "@opencode/client"
import { matchAction } from "./permission-utils"

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

export function canDisconnect(item: Pick<IntegrationInfo, "connections">): boolean {
  return item.connections.some((connection) => connection.type === "credential")
}

export function canManageProvider(item: Pick<IntegrationInfo, "connections">, value: unknown): boolean {
  return isCustomProvider(value) || canDisconnect(item)
}

/** The canonical parent must exist before a nested unset can also remove its legacy alias. */
export function providerRemovalPath(raw: Record<string, unknown>, id: string): string[] {
  return [!("providers" in raw) && "provider" in raw ? "provider" : "providers", id]
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

/** Updates the per-provider denies without changing the order of retained policies. */
export function withDisabledProviders(policies: ProviderPolicy[], next: string[]): ProviderPolicy[] {
  const wanted = new Set(next)
  const current = new Set(disabledProviderIds(policies))
  return [
    ...policies.filter((policy) => !isDisabledProviderPolicy(policy) || wanted.has(policy.resource)),
    ...next.filter((id) => !current.has(id)).map((id) => ({ action: "provider.use", resource: id, effect: "deny" })),
  ]
}

/**
 * Removes explicit denies for `id` and adds an allow only if the last matching remaining rule still denies it.
 * Returns `undefined` when no write is needed and an empty list when the key must be unset.
 */
export function enableProvider(policies: unknown, id: string): ProviderPolicy[] | undefined {
  if (!Array.isArray(policies)) return
  const current = policies as ProviderPolicy[]
  const next = current.filter((policy) => !(isDisabledProviderPolicy(policy) && policy.resource === id))
  const decision = next.findLast((policy) => policy.action === "provider.use" && matchAction(id, policy.resource))
  if (next.length === current.length && decision?.effect !== "deny") return
  if (decision?.effect === "deny") next.push({ action: "provider.use", resource: id, effect: "allow" })
  return next
}

type PolicyScope = "global" | "project"
type PolicyDocument = { type: string; path?: string; info?: { policies?: readonly ProviderPolicy[] } }
type PolicyConfig = {
  entries: () => readonly PolicyDocument[]
  path: (scope: PolicyScope) => string | undefined
  optimistic: (path: string[]) => { scope: PolicyScope; value: unknown } | undefined
  set: (path: string[], value: unknown, scope: PolicyScope) => Promise<boolean>
  unset: (path: string[], scope: PolicyScope) => Promise<boolean>
}

/** Enable in the deciding writable document, and clear a visible explicit deny in the other scope. */
export async function enableProviderInConfig(config: PolicyConfig, id: string): Promise<boolean> {
  const optimistic = config.optimistic(["policies"])
  const optimisticPath = optimistic && config.path(optimistic.scope)
  const documents = config
    .entries()
    .filter((entry) => entry.type === "document")
    .map((entry) => {
      if (!optimisticPath || entry.path !== optimisticPath) return entry
      return {
        ...entry,
        info: {
          ...entry.info,
          policies: Array.isArray(optimistic?.value) ? (optimistic.value as ProviderPolicy[]) : undefined,
        },
      }
    })
    .filter((entry) => entry.info?.policies !== undefined)
  const pendingDocument =
    optimisticPath && Array.isArray(optimistic?.value)
      ? (documents.find((entry) => entry.path === optimisticPath) ?? {
          type: "document",
          path: optimisticPath,
          info: { policies: optimistic.value as ProviderPolicy[] },
        })
      : undefined
  // Policy evaluation reverses document order, so the first document with a matching rule decides.
  const decision = documents
    .map((entry) => ({
      entry,
      policy: entry.info?.policies?.findLast(
        (policy) => policy.action === "provider.use" && matchAction(id, policy.resource),
      ),
    }))
    .find((item) => item.policy)
  const visible = optimistic ? pendingDocument : documents.at(-1)
  const targets = new Set([
    decision?.policy?.effect === "deny" ? decision.entry : undefined,
    disabledProviderIds(visible?.info?.policies).includes(id) ? visible : undefined,
  ])

  for (const entry of targets) {
    if (!entry?.path) continue
    const scope =
      entry.path === config.path("global") ? "global" : entry.path === config.path("project") ? "project" : undefined
    if (!scope) continue
    const policies = enableProvider(entry.info?.policies, id)
    if (!policies) continue
    const written = policies.length
      ? await config.set(["policies"], policies, scope)
      : await config.unset(["policies"], scope)
    if (!written) return false
  }
  return true
}
