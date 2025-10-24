import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon, parseMcpServerData } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display MCP server usage request (tool or resource access)
 * Approval is handled centrally by useApprovalMonitor in UI.tsx
 */
export const AskUseMcpServerMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()

	const icon = getMessageIcon("ask", "use_mcp_server")
	const mcpData = parseMcpServerData(message)

	if (!mcpData) {
		return (
			<Box marginY={1}>
				<Text color={theme.semantic.warning} bold>
					{icon} MCP Server Request (invalid data)
				</Text>
			</Box>
		)
	}

	const isToolUse = mcpData.type === "use_mcp_tool"
	const title = isToolUse ? "Use MCP Tool" : "Access MCP Resource"

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.warning} bold>
					{icon} {title}
				</Text>
			</Box>

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.semantic.info}>Server: {mcpData.serverName}</Text>
			</Box>

			{isToolUse && mcpData.toolName && (
				<Box marginLeft={2}>
					<Text color={theme.ui.text.primary}>Tool: {mcpData.toolName}</Text>
				</Box>
			)}

			{!isToolUse && mcpData.uri && (
				<Box marginLeft={2}>
					<Text color={theme.ui.text.primary}>URI: {mcpData.uri}</Text>
				</Box>
			)}

			{mcpData.arguments && (
				<Box
					width={getBoxWidth(3)}
					marginLeft={2}
					marginTop={1}
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						Arguments: {mcpData.arguments.substring(0, 100)}
						{mcpData.arguments.length > 100 ? "..." : ""}
					</Text>
				</Box>
			)}

			{message.isAnswered && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						✓ Answered
					</Text>
				</Box>
			)}
		</Box>
	)
}
