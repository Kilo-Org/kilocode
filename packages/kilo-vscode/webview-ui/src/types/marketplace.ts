export type {
  McpParameter,
  McpInstallationMethod,
  MarketplaceSuggestFor,
  MarketplaceItemBase,
  McpMarketplaceItem,
  AgentContent,
  AgentMarketplaceItem,
  SkillMarketplaceItem,
  MarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceInstalledMetadata,
  MarketplaceRelevance,
  MarketplaceRelevanceMetadata,
} from "../../../src/services/marketplace/types"

export interface MarketplaceFilters {
  type?: string
  search?: string
  categories?: string[]
}
