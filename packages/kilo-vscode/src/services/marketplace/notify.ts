import * as vscode from "vscode"
import type { MarketplaceItem, MarketplaceItemRef, MarketplaceRelevanceMetadata } from "./types"

/** Stable, discardable identifier for a suggestion. Matches the relevance map key. */
export function suggestionSlug(item: Pick<MarketplaceItem, "id" | "type">): string {
  return `${item.type}:${item.id}`
}

/**
 * Pick the items worth surfacing as a notification: relevant to the workspace and
 * not previously dismissed. Pure so it can be unit tested without VS Code.
 */
export function selectSuggestions(
  items: MarketplaceItem[],
  relevance: MarketplaceRelevanceMetadata,
  dismissed: Iterable<string>,
): MarketplaceItem[] {
  const skip = new Set(dismissed)
  return items.filter((item) => {
    const slug = suggestionSlug(item)
    return Boolean(relevance[slug]) && !skip.has(slug)
  })
}

export interface SuggestionChoice {
  action: "install" | "dismiss" | "details"
  item: MarketplaceItem
  /** Browser URL for the item's marketplace catalog entry. Only set for "details". */
  url?: string
}

const CATALOG_BASE_URL = "https://github.com/Kilo-Org/kilo-marketplace/tree/main"

const CATALOG_KINDS: Record<MarketplaceItem["type"], string> = {
  agent: "agents",
  skill: "skills",
  plugin: "plugins",
  mcp: "mcps",
}

/**
 * Build the browser URL for an item's entry in the public marketplace catalog
 * repository (the source the registry API serves). Dynamic for any type and id.
 * Ids may contain "/" path separators (git-sourced plugins and scoped ids), so
 * encode each segment while keeping the separators that GitHub resolves.
 */
export function catalogUrl(item: MarketplaceItemRef): string {
  const id = item.id.split("/").map(encodeURIComponent).join("/")
  return `${CATALOG_BASE_URL}/${CATALOG_KINDS[item.type]}/${id}`
}

function describe(item: MarketplaceItem): string {
  if (item.type === "agent") return `the ${item.name} agent`
  if (item.type === "skill") return `the ${item.name} skill`
  if (item.type === "plugin") return `the ${item.name} plugin`
  return `the ${item.name} MCP server`
}

/**
 * Show a native VS Code notification for a matched item, offering a direct install,
 * a "View details" link to the catalog entry, and a persistent "Don't show again"
 * dismissal. Resolves with the user's choice, or `undefined` if the toast was
 * closed without picking an action.
 */
export async function showSuggestionNotification(item: MarketplaceItem): Promise<SuggestionChoice | undefined> {
  const install = "Install"
  const details = "View details"
  const dismiss = "Don't show again"
  const picked = await vscode.window.showInformationMessage(
    `Kilo found ${describe(item)} that matches this workspace. Install it?`,
    install,
    details,
    dismiss,
  )
  if (picked === install) return { action: "install", item }
  if (picked === details) return { action: "details", item, url: catalogUrl(item) }
  if (picked === dismiss) return { action: "dismiss", item }
  return undefined
}
