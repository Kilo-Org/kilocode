export interface MarketplaceItemBase {
  id: string
  name: string
  description: string
  author?: string
  authorUrl?: string
  tags?: string[]
  prerequisites?: string[]
}

export interface McpMarketplaceItem extends MarketplaceItemBase {
  type: "mcp"
  url: string
  content: string | unknown[]
}

export interface ModeMarketplaceItem extends MarketplaceItemBase {
  type: "mode"
  content: string
}

export interface SkillMarketplaceItem extends MarketplaceItemBase {
  type: "skill"
  category: string
  githubUrl: string
  content: string
  displayName: string
  displayCategory: string
}

export type MarketplaceItem = McpMarketplaceItem | ModeMarketplaceItem | SkillMarketplaceItem

export interface InstallMarketplaceItemOptions {
  target?: "global" | "project"
  parameters?: Record<string, unknown>
}

export interface MarketplaceInstalledMetadata {
  project: Record<string, { type: string }>
  global: Record<string, { type: string }>
}

export interface MarketplaceFilters {
  search?: string
  type?: string
  status?: string
  tags?: string[]
}
