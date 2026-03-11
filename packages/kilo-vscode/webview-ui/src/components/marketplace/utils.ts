import type { MarketplaceInstalledMetadata } from "../../types/marketplace"

export function isInstalled(
  id: string,
  type: string,
  metadata: MarketplaceInstalledMetadata,
): "project" | "global" | false {
  if (metadata.project[id]?.type === type) return "project"
  if (metadata.global[id]?.type === type) return "global"
  return false
}
