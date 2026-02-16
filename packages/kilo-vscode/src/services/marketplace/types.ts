export type MarketplaceItemType = "mode" | "mcp" | "skill"

export interface MarketplaceItemBase {
  type: MarketplaceItemType
  id: string
  name: string
  description: string
  managedByOrganization?: boolean
  author?: string
  authorUrl?: string
  tags?: string[]
  prerequisites?: string[]
}

export interface MarketplaceModeItem extends MarketplaceItemBase {
  type: "mode"
  content: string
}

export interface MarketplaceMcpParameter {
  name: string
  key: string
  placeholder?: string
  optional: boolean
}

export interface MarketplaceMcpInstallMethod {
  name: string
  content: string
  parameters?: MarketplaceMcpParameter[]
  prerequisites?: string[]
}

export interface MarketplaceMcpItem extends MarketplaceItemBase {
  type: "mcp"
  url: string
  content: string | MarketplaceMcpInstallMethod[]
  parameters?: MarketplaceMcpParameter[]
}

export interface MarketplaceSkillItem extends MarketplaceItemBase {
  type: "skill"
  category: string
  githubUrl: string
  content: string
  displayName: string
  displayCategory: string
}

export type MarketplaceItem = MarketplaceModeItem | MarketplaceMcpItem | MarketplaceSkillItem

export interface MarketplaceInstallOptions {
  target: "project" | "global"
  selectedIndex?: number
  parameters?: Record<string, unknown>
}

export interface MarketplaceInstalledMetadata {
  project: Record<string, { type: MarketplaceItemType }>
  global: Record<string, { type: MarketplaceItemType }>
}

export interface MarketplaceCatalogResult {
  items: MarketplaceItem[]
  installedMetadata: MarketplaceInstalledMetadata
  errors?: string[]
}

export interface MarketplaceOrganizationPolicy {
  hideMarketplaceMcps?: boolean
  hiddenMcps?: string[]
  mcps?: Array<Omit<MarketplaceMcpItem, "type">>
}
