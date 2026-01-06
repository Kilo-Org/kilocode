import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Parsed browser action result data
 */
interface BrowserActionResultData {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
	viewportWidth?: number
	viewportHeight?: number
}

/**
 * Parse browser action result from message text
 */
function parseBrowserActionResult(text: string | undefined): BrowserActionResultData | null {
	if (!text) return null
	try {
		return JSON.parse(text) as BrowserActionResultData
	} catch {
		return null
	}
}

/**
 * Display browser action results in a readable format
 * Parses the JSON data and shows meaningful info instead of raw base64 screenshot data
 */
export const SayBrowserActionResultMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const result = parseBrowserActionResult(message.text)

	// If we can't parse, show a simple message
	if (!result) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Box>
					<Text color={theme.semantic.info} bold>
						🌐 Browser Action Result
					</Text>
				</Box>
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed}>Browser action completed</Text>
				</Box>
			</Box>
		)
	}

	const hasScreenshot = !!result.screenshot
	const hasLogs = result.logs && result.logs.trim().length > 0
	const hasUrl = !!result.currentUrl
	const hasViewport = result.viewportWidth && result.viewportHeight

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					🌐 Browser Action Result
				</Text>
			</Box>

			<Box flexDirection="column" marginLeft={2} marginTop={1}>
				{/* Screenshot indicator */}
				{hasScreenshot && (
					<Box>
						<Text color={theme.ui.text.dimmed}>📷 Screenshot captured</Text>
					</Box>
				)}

				{/* Current URL */}
				{hasUrl && (
					<Box>
						<Text color={theme.ui.text.dimmed}>
							URL: <Text color={theme.markdown.link}>{result.currentUrl}</Text>
						</Text>
					</Box>
				)}

				{/* Viewport dimensions */}
				{hasViewport && (
					<Box>
						<Text color={theme.ui.text.dimmed}>
							Viewport: {result.viewportWidth}x{result.viewportHeight}
						</Text>
					</Box>
				)}

				{/* Cursor position */}
				{result.currentMousePosition && (
					<Box>
						<Text color={theme.ui.text.dimmed}>Cursor: {result.currentMousePosition}</Text>
					</Box>
				)}

				{/* Console logs */}
				{hasLogs && (
					<Box flexDirection="column" marginTop={1}>
						<Text color={theme.ui.text.dimmed}>Console logs:</Text>
						<Box marginLeft={2}>
							<Text color={theme.ui.text.secondary}>{result.logs}</Text>
						</Box>
					</Box>
				)}

				{/* Fallback if no meaningful data */}
				{!hasScreenshot && !hasLogs && !hasUrl && !hasViewport && (
					<Box>
						<Text color={theme.ui.text.dimmed}>Browser action completed</Text>
					</Box>
				)}
			</Box>
		</Box>
	)
}
