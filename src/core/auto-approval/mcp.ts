import type { McpServerUse } from "@roo-code/types"

import type { McpServer, McpTool } from "../../shared/mcp"

export function isMcpToolAlwaysAllowed(mcpServerUse: McpServerUse, mcpServers: McpServer[] | undefined): boolean {
	if (mcpServerUse.type === "use_mcp_tool" && mcpServerUse.toolName) {
		const server = mcpServers?.find((s: McpServer) => s.name === mcpServerUse.serverName)
		const tool = server?.tools?.find((t: McpTool) => t.name === mcpServerUse.toolName)
		return tool?.alwaysAllow || false
	}

	return false
}
