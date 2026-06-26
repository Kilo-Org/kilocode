export interface McpParameter {
  name: string
  key: string
  placeholder?: string
  optional?: boolean
}

export interface McpInstallationMethod {
  name: string
  content: string
  parameters?: McpParameter[]
  prerequisites?: string[]
}

export interface MarketplaceSuggestFor {
  filename?: string[]
  vscode_extension?: string[]
}

export interface MarketplaceItemBase {
  id: string
  name: string
  description: string
  category: string
  author?: string
  authorUrl?: string
  prerequisites?: string[]
  suggest_for?: MarketplaceSuggestFor
}

export interface McpMarketplaceItem extends MarketplaceItemBase {
  type: "mcp"
  url: string
  content: string | McpInstallationMethod[]
  parameters?: McpParameter[]
}

export interface AgentContent {
  mode: "primary" | "subagent" | "all"
  description: string
  prompt: string
  options?: Record<string, unknown>
  permission?: Record<string, unknown>
}

export interface AgentMarketplaceItem extends MarketplaceItemBase {
  type: "agent"
  content: AgentContent
}

export interface SkillMarketplaceItem extends MarketplaceItemBase {
  type: "skill"
  githubUrl: string
  content: string
  displayName: string
  displayCategory: string
}

export type MarketplaceItem = McpMarketplaceItem | AgentMarketplaceItem | SkillMarketplaceItem

export interface InstallMarketplaceItemOptions {
  target?: "global" | "project"
  parameters?: Record<string, unknown>
}

export interface MarketplaceInstalledMetadata {
  project: Record<string, { type: string }>
  global: Record<string, { type: string }>
}

export interface MarketplaceRelevance {
  filename?: string[]
  vscodeExtension?: string[]
}

export type MarketplaceRelevanceMetadata = Record<string, MarketplaceRelevance>

export interface MarketplaceFilters {
  type?: string
  search?: string
  categories?: string[]
}
