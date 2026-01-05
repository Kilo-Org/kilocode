import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon, parseMessageJson } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Result item from the extension's codebase search
 */
interface ExtensionSearchResult {
	filePath: string
	score: number
	startLine: number
	endLine: number
	codeChunk: string
}

/**
 * Payload structure from the extension
 */
interface CodebaseSearchPayload {
	tool: string
	content: {
		query: string
		results: ExtensionSearchResult[]
		status?: {
			systemStatus: string
			message: string
			processedItems: number
			totalItems: number
			currentItemUnit: string
		}
	}
}

/**
 * Display codebase search results with scores
 */
export const SayCodebaseSearchResultMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("say", "codebase_search_result")
	const payload = parseMessageJson<CodebaseSearchPayload>(message.text)

	// Handle invalid or missing data
	if (!payload || !payload.content) {
		return (
			<Box marginY={1}>
				<Text color={theme.semantic.info} bold>
					{icon} Codebase Search Results (invalid data)
				</Text>
			</Box>
		)
	}

	const { content } = payload
	const results = content.results || []

	// Handle status messages (e.g., indexing in progress)
	if (content.status && content.status.systemStatus !== "Indexed") {
		return (
			<Box
				width={getBoxWidth(1)}
				flexDirection="column"
				borderStyle="single"
				borderColor={theme.semantic.warning}
				paddingX={1}
				marginY={1}>
				<Box>
					<Text color={theme.semantic.warning} bold>
						{icon} Codebase Search - {content.status.systemStatus}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color={theme.ui.text.dimmed}>{content.status.message}</Text>
				</Box>
				{content.status.totalItems > 0 && (
					<Box marginTop={1}>
						<Text color={theme.ui.text.dimmed} dimColor>
							Progress: {content.status.processedItems}/{content.status.totalItems}{" "}
							{content.status.currentItemUnit || "items"}
						</Text>
					</Box>
				)}
			</Box>
		)
	}

	// Handle empty results
	if (results.length === 0) {
		return (
			<Box
				width={getBoxWidth(1)}
				flexDirection="column"
				borderStyle="single"
				borderColor={theme.semantic.info}
				paddingX={1}
				marginY={1}>
				<Box>
					<Text color={theme.semantic.info} bold>
						{icon} Codebase Search Results
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text color={theme.ui.text.dimmed}>No results found for query: "{content.query}"</Text>
				</Box>
			</Box>
		)
	}

	return (
		<Box
			width={getBoxWidth(1)}
			flexDirection="column"
			borderStyle="single"
			borderColor={theme.semantic.info}
			paddingX={1}
			marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					{icon} Codebase Search Results
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Found {results.length} result{results.length !== 1 ? "s" : ""} for "{content.query}"
				</Text>
			</Box>

			{results.slice(0, 5).map((result, index) => (
				<Box key={index} flexDirection="column" marginTop={1} marginLeft={1}>
					<Box>
						<Text color={theme.ui.text.primary} bold>
							{index + 1}. {result.filePath}:{result.startLine}-{result.endLine}
						</Text>
					</Box>
					{result.codeChunk && (
						<Box marginLeft={2}>
							<Text color={theme.ui.text.dimmed}>
								{result.codeChunk.substring(0, 100)}
								{result.codeChunk.length > 100 ? "..." : ""}
							</Text>
						</Box>
					)}
					<Box marginLeft={2}>
						<Text color={theme.semantic.info} dimColor>
							Score: {result.score.toFixed(2)}
						</Text>
					</Box>
				</Box>
			))}

			{results.length > 5 && (
				<Box marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						... and {results.length - 5} more result{results.length - 5 !== 1 ? "s" : ""}
					</Text>
				</Box>
			)}
		</Box>
	)
}
