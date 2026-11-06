import type { InstallMarketplaceItemOptions, MarketplaceItem } from "./types"

// Property keys for the marketplace install/remove events. Reporting selects these names, and the
// JetBrains client sends the same keys, so keep them stable.

/** Properties for `Marketplace Item Installed`, built from the request the host actually ran. */
export function installed(item: MarketplaceItem, opts: InstallMarketplaceItemOptions) {
  const params = opts.parameters ?? {}
  const method = typeof params.__method === "string" ? params.__method : undefined
  const keys = Object.keys(params).filter((key) => key !== "__method")
  return {
    itemId: item.id,
    itemType: item.type,
    itemName: item.name,
    target: opts.target ?? "project",
    ...(keys.length > 0 && { hasParameters: true }),
    ...(method && { installationMethodName: method }),
  }
}

/** Properties for `Marketplace Item Removed`. */
export function removed(item: MarketplaceItem, scope: "project" | "global") {
  return {
    itemId: item.id,
    itemType: item.type,
    itemName: item.name,
    target: scope,
  }
}
