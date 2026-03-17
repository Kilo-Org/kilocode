import type { MarketplaceInstalledMetadata } from "../../types/marketplace"

export function isInstalled(
  id: string,
  type: string,
  metadata: MarketplaceInstalledMetadata,
): "project" | "global" | false {
  return installedScopes(id, type, metadata)[0] ?? false
}

export function installedScopes(
  id: string,
  type: string,
  metadata: MarketplaceInstalledMetadata,
): ("project" | "global")[] {
  const scopes: ("project" | "global")[] = []
  if (metadata.project[id]?.type === type) scopes.push("project")
  if (metadata.global[id]?.type === type) scopes.push("global")
  return scopes
}
