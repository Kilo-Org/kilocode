import type { MarketplaceInstalledMetadata } from "../../types/marketplace"

export function installedScopes(
  id: string,
  type: string,
  metadata: MarketplaceInstalledMetadata,
): Array<"project" | "global"> {
  const scopes: Array<"project" | "global"> = []
  if (metadata.project[id]?.type === type) scopes.push("project")
  if (metadata.global[id]?.type === type) scopes.push("global")
  return scopes
}
