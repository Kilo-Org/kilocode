import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { formatContentWithMetadata, buildMetadataString, hasJsonContent, parseMessageJson } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display MCP server tool response with formatted output and metadata
 *
 * Supports both plain text and JSON response formats:
 * - Plain text: Direct response string (current core implementation)
 * - JSON: { type: "use_mcp_tool", serverName, toolName, response }
 *   Extracts the response content from the structured data
 *
 */

const MAX_LINES = 20
const PREVIEW_LINES = 5

export const SayMcpServerResponseMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()

	try {
		// Extract response text with memoization to avoid re-parsing on re-renders
		const responseText = useMemo(() => {
			if (!message.text) return null

			// Check if message contains JSON and parse it using existing utility
			if (hasJsonContent(message)) {
				const parsed = parseMessageJson<{ type?: string; response?: string | object }>(message.text)

				// Check if it's the expected McpServerData format
				if (parsed?.type === "use_mcp_tool" && parsed.response !== undefined) {
					return typeof parsed.response === "string" ? parsed.response : JSON.stringify(parsed.response)
				}
			}

			// Fall back to plain text format
			return message.text
		}, [message])

		// Format content with metadata
		const formatted = useMemo(
			() => (responseText ? formatContentWithMetadata(responseText, MAX_LINES, PREVIEW_LINES) : null),
			[responseText],
		)

		if (!responseText || !formatted) {
			return (
				<Box flexDirection="column" marginY={1}>
					<Box>
						<Text bold color={theme.semantic.error}>
							⚙ MCP Tool Response (No data)
						</Text>
					</Box>
				</Box>
			)
		}

		return (
			<Box flexDirection="column" marginY={1}>
				{/* Header */}
				<Box>
					<Text bold color={theme.semantic.success}>
						⚙ MCP Tool Response
					</Text>
				</Box>

				{/* Metadata */}
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed}>Response ({buildMetadataString(formatted)}):</Text>
				</Box>

				{/* Response content */}
				<Box
					width={getBoxWidth(3)}
					marginLeft={2}
					marginTop={1}
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}
					flexDirection="column">
					{formatted.content.split("\n").map((line, index) => (
						<Text key={index} color={formatted.isJson ? theme.ui.text.dimmed : theme.ui.text.primary}>
							{line}
						</Text>
					))}

					{/* Preview indicator */}
					{formatted.isPreview && (
						<Text color={theme.ui.text.dimmed} italic>
							{"  "}... ({formatted.hiddenLines} more line{formatted.hiddenLines !== 1 ? "s" : ""})
						</Text>
					)}
				</Box>
			</Box>
		)
	} catch {
		return (
			<Box flexDirection="column" marginY={1}>
				<Box>
					<Text bold color={theme.semantic.error}>
						⚙ MCP Tool Response (Error displaying content)
					</Text>
				</Box>
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed}>An error occurred while formatting the response.</Text>
				</Box>
			</Box>
		)
	}
}
