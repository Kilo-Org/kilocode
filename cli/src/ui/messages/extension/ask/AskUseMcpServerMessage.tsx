import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon, parseMcpServerData, formatContentWithMetadata, buildMetadataString } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

const MAX_LINES = 20
const PREVIEW_LINES = 5

/**
 * Display MCP server usage request (tool or resource access)
 * Approval is handled centrally by useApprovalMonitor in UI.tsx
 */
export const AskUseMcpServerMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()

	try {
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

		// Format arguments if present
		const formattedArgs = mcpData.arguments
			? formatContentWithMetadata(mcpData.arguments, MAX_LINES, PREVIEW_LINES)
			: null

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

				{formattedArgs && (
					<>
						{/* Arguments metadata */}
						<Box marginLeft={2} marginTop={1}>
							<Text color={theme.ui.text.dimmed} dimColor>
								Arguments ({buildMetadataString(formattedArgs)}):
							</Text>
						</Box>

						{/* Arguments content */}
						<Box
							width={getBoxWidth(3)}
							marginLeft={2}
							marginTop={1}
							borderStyle="single"
							borderColor={theme.ui.border.default}
							paddingX={1}
							flexDirection="column">
							{formattedArgs.content.split("\n").map((line, index) => (
								<Text key={index} color={theme.ui.text.dimmed} dimColor>
									{line}
								</Text>
							))}
							{formattedArgs.isPreview && (
								<Text color={theme.ui.text.dimmed} dimColor italic>
									{"  "}... ({formattedArgs.hiddenLines} more line
									{formattedArgs.hiddenLines !== 1 ? "s" : ""})
								</Text>
							)}
						</Box>
					</>
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
	} catch {
		const icon = getMessageIcon("ask", "use_mcp_server")
		return (
			<Box flexDirection="column" marginY={1}>
				<Box>
					<Text color={theme.semantic.error} bold>
						{icon} MCP Server Request (Error displaying content)
					</Text>
				</Box>
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed}>An error occurred while formatting the request.</Text>
				</Box>
			</Box>
		)
	}
}
