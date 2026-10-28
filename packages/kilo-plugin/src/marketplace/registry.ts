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
