import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"

/** Catalog normalization stays separate from installation and durable ownership. */
export interface Registry {
  readonly id: string
  readonly name: string
  readonly list: (kind: KiloMarketplaceRpc.Kind) => Promise<readonly Entry[]>
}

export interface Entry {
  readonly item: KiloMarketplaceRpc.Item
  readonly archive?: string
  /** Optional skill directory within a repository archive. */
  readonly select?: string
  readonly payloads: readonly unknown[]
  readonly companions?: readonly { readonly id: string; readonly archive: string }[]
}

/**
 * Where a registry's catalog snapshot is cached. The version lets a changed snapshot shape be left behind instead of
 * misread; old rows are never read again and cost nothing. The gateway plugin removes every `catalog:personal:` row it
 * did not just write and owns `catalog:anonymous:`, and the version segment keeps these keys out of both prefixes
 * whatever the registry is called.
 */
export const catalogKey = (registry: string, kind: KiloMarketplaceRpc.Kind) => `catalog:v1:${registry}:${kind}`
