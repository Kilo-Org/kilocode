import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"

import type { ToolRendererProps } from "./types.js"
import { truncateText, sanitizeContent, getToolDisplayName, getToolIconName } from "./utils.js"

const MAX_CONTENT_LINES = 12

export function GenericTool({ toolData, rawContent }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const displayName = getToolDisplayName(toolData.tool)

	// Gather all available information
	const path = toolData.path
	const content = toolData.content ? sanitizeContent(toolData.content) : ""
	const reason = toolData.reason ? sanitizeContent(toolData.reason) : ""
	const mode = toolData.mode

	// Build display content from available fields
	let displayContent = content || reason || ""

	// If we have no structured content but have raw content, try to parse it
	if (!displayContent && rawContent) {
		try {
			const parsed = JSON.parse(rawContent)
			// Extract any content-like fields
			displayContent = sanitizeContent(parsed.content || parsed.output || parsed.result || parsed.reason || "")
		} catch {
			// Use raw content as-is if not JSON
			displayContent = sanitizeContent(rawContent)
		}
	}

	const { text: previewContent, truncated, hiddenLines } = truncateText(displayContent, MAX_CONTENT_LINES)

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Header */}
			<Box>
				<Icon name={iconName} color={theme.toolHeader} />
				<Text bold color={theme.toolHeader}>
					{" "}
					{displayName}
				</Text>
			</Box>

			{/* Path if present */}
			{path && (
				<Box marginLeft={2}>
					<Text color={theme.dimText}>path: </Text>
					<Text color={theme.text} bold>
						{path}
					</Text>
					{toolData.isOutsideWorkspace && (
						<Text color={theme.warningColor} dimColor>
							{" "}
							⚠ outside workspace
						</Text>
					)}
					{toolData.isProtected && <Text color={theme.errorColor}> 🔒 protected</Text>}
				</Box>
			)}

			{/* Mode if present */}
			{mode && (
				<Box marginLeft={2}>
					<Text color={theme.dimText}>mode: </Text>
					<Text color={theme.userHeader} bold>
						{mode}
					</Text>
				</Box>
			)}

			{/* Content */}
			{previewContent && (
				<Box flexDirection="column" marginLeft={2} marginTop={path || mode ? 1 : 0}>
					{previewContent.split("\n").map((line, i) => (
						<Text key={i} color={theme.toolText}>
							{line}
						</Text>
					))}
					{truncated && (
						<Text color={theme.dimText} dimColor>
							... ({hiddenLines} more lines)
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}
