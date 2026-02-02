// kilocode_change: imported from Cline
import { McpMarketplaceCatalog } from "../../../../src/shared/kilocode/mcp"

/**
 * Attempts to convert an MCP server name to its display name using the marketplace catalog
 * @param serverName The server name/ID to look up
 * @param mcpMarketplaceCatalog The marketplace catalog containing server metadata
 * @returns The display name if found in catalog, otherwise returns the original server name
 */
export function getMcpServerDisplayName(serverName: string, mcpMarketplaceCatalog: McpMarketplaceCatalog): string {
	// Find matching item in marketplace catalog
	const catalogItem = mcpMarketplaceCatalog.items.find(
		(item) => ((item as any).mcpId ?? (item as any).id) === serverName, // kilocode_change
	)

	// Return display name if found, otherwise return original server name
	return catalogItem?.name || serverName
}
