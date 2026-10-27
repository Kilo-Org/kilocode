import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"

/**
 * A marketplace source. Each registry maps its own API format onto the normalized `Item` of the RPC contract and
 * keeps what an install needs (archive URLs, raw server configs) in `Entry`. Registries: the curated Kilo marketplace
 * (`kilo.ts`), skills.sh (`skills-sh.ts`) and the official MCP registry (`mcp-registry.ts`).
 */
export interface Registry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly kinds: readonly KiloMarketplaceRpc.Kind[]
  readonly curated: boolean
  /** The registry searches its whole catalog for a query; without one it lists a top slice. */
  readonly searchable: boolean
  readonly list: (kind: KiloMarketplaceRpc.Kind, query?: string) => Promise<readonly Entry[]>
}

export interface Entry {
  readonly item: KiloMarketplaceRpc.Item
  /** The `.tar.gz` of a skill, with the skill directory at its root or below one top-level directory. */
  readonly archive?: string
  /** For an archive of a whole repository: the name of the skill directory to install from it. */
  readonly select?: string
  /** Raw install payloads of the item, per install option (MCP server configs, agent definitions). */
  readonly payloads: readonly unknown[]
  /** Skills that ship with an MCP server and install and uninstall together with it. */
  readonly companions?: readonly { readonly id: string; readonly archive: string }[]
}
