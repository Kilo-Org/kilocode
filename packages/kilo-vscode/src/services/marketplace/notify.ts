import * as vscode from "vscode"
import type { MarketplaceItem, MarketplaceRelevanceMetadata } from "./types"

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
  action: "install" | "dismiss"
  item: MarketplaceItem
}

function describe(item: MarketplaceItem): string {
  if (item.type === "agent") return `the ${item.name} agent`
  if (item.type === "skill") return `the ${item.name} skill`
  return `the ${item.name} MCP server`
}

/**
 * Show a native VS Code notification for a matched item, offering a direct install
 * and a persistent "Don't show again" dismissal. Resolves with the user's choice,
 * or `undefined` if the toast was closed without picking an action.
 */
export async function showSuggestionNotification(item: MarketplaceItem): Promise<SuggestionChoice | undefined> {
  const install = "Install"
  const dismiss = "Don't show again"
  const picked = await vscode.window.showInformationMessage(
    `Kilo found ${describe(item)} that matches this workspace. Install it?`,
    install,
    dismiss,
  )
  if (picked === install) return { action: "install", item }
  if (picked === dismiss) return { action: "dismiss", item }
  return undefined
}
