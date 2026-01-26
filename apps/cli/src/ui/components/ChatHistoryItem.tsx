import { memo } from "react"
import { Box, Newline, Text } from "ink"

import type { TUIMessage } from "../types.js"
import * as theme from "../theme.js"

import TodoDisplay from "./TodoDisplay.js"
import { getToolRenderer } from "./tools/index.js"

/**
 * Tool categories for styling
 */
type ToolCategory = "file" | "directory" | "search" | "command" | "browser" | "mode" | "completion" | "other"

function getToolCategory(toolName: string): ToolCategory {
	const fileTools = ["readFile", "read_file", "writeToFile", "write_to_file", "applyDiff", "apply_diff"]
	const dirTools = ["listFiles", "list_files", "listFilesRecursive", "listFilesTopLevel"]
	const searchTools = ["searchFiles", "search_files"]
	const commandTools = ["executeCommand", "execute_command"]
	const browserTools = ["browserAction", "browser_action"]
	const modeTools = ["switchMode", "switch_mode", "newTask", "new_task"]
	const completionTools = ["attemptCompletion", "attempt_completion", "askFollowupQuestion", "ask_followup_question"]

	if (fileTools.includes(toolName)) return "file"
	if (dirTools.includes(toolName)) return "directory"
	if (searchTools.includes(toolName)) return "search"
	if (commandTools.includes(toolName)) return "command"
	if (browserTools.includes(toolName)) return "browser"
	if (modeTools.includes(toolName)) return "mode"
	if (completionTools.includes(toolName)) return "completion"
	return "other"
}

/**
 * Category colors for tool types
 */
const CATEGORY_COLORS: Record<ToolCategory, string> = {
	file: theme.toolHeader,
	directory: theme.toolHeader,
	search: theme.warningColor,
	command: theme.successColor,
	browser: theme.focusColor,
	mode: theme.userHeader,
	completion: theme.successColor,
	other: theme.toolHeader,
}

/**
 * Sanitize content for terminal display by:
 * - Replacing tab characters with spaces (tabs expand to variable widths in terminals)
 * - Stripping carriage returns that could cause display issues
 */
function sanitizeContent(text: string): string {
	return text.replace(/\t/g, "    ").replace(/\r/g, "")
}

/**
 * Truncate content for display, showing line count
 */
function truncateContent(
	content: string,
	maxLines: number = 10,
): { text: string; truncated: boolean; totalLines: number } {
	const lines = content.split("\n")
	const totalLines = lines.length

	if (lines.length <= maxLines) {
		return { text: content, truncated: false, totalLines }
	}

	const truncatedText = lines.slice(0, maxLines).join("\n")
	return { text: truncatedText, truncated: true, totalLines }
}

/**
 * Parse tool info from raw JSON content
 */
function parseToolInfo(content: string): Record<string, unknown> | null {
	try {
		return JSON.parse(content)
	} catch {
		return null
	}
}

/**
 * Render tool display component
 */
function ToolDisplay({ message }: { message: TUIMessage }) {
	const toolName = message.toolName || "unknown"
	const category = getToolCategory(toolName)
	const categoryColor = CATEGORY_COLORS[category]

	// Try to parse the raw content for additional tool info
	const toolInfo = parseToolInfo(message.content || "")

	// Extract key fields from tool info
	const path = toolInfo?.path as string | undefined
	const isOutsideWorkspace = toolInfo?.isOutsideWorkspace as boolean | undefined
	const reason = toolInfo?.reason as string | undefined
	const rawContent = toolInfo?.content as string | undefined

	// Get the display output (formatted by App.tsx) - already sanitized
	const toolDisplayOutput = message.toolDisplayOutput ? sanitizeContent(message.toolDisplayOutput) : undefined

	// Sanitize raw content if present
	const sanitizedRawContent = rawContent ? sanitizeContent(rawContent) : undefined

	// Format the header
	const headerText = message.toolDisplayName || toolName

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Tool Header */}
			<Text bold color={categoryColor}>
				{headerText}
			</Text>

			{/* Path indicator for file/directory operations */}
			{path && (
				<Box marginLeft={2}>
					<Text color={theme.dimText}>
						{category === "file" ? "file: " : category === "directory" ? "dir: " : "path: "}
					</Text>
					<Text color={theme.text} bold>
						{path}
					</Text>
					{isOutsideWorkspace && (
						<Text color={theme.warningColor} dimColor>
							{" (outside workspace)"}
						</Text>
					)}
				</Box>
			)}

			{/* Reason/explanation if present */}
			{reason && (
				<Box marginLeft={2}>
					<Text color={theme.dimText} italic>
						{reason}
					</Text>
				</Box>
			)}

			{/* Content display */}
			{(toolDisplayOutput || sanitizedRawContent) && (
				<Box flexDirection="column" marginLeft={2} marginTop={0}>
					{(() => {
						const contentToDisplay = toolDisplayOutput || sanitizedRawContent || ""
						const { text, truncated, totalLines } = truncateContent(contentToDisplay, 15)

						return (
							<>
								<Text color={theme.toolText}>{text}</Text>
								{truncated && (
									<Text color={theme.dimText} dimColor>
										{`... (${totalLines - 15} more lines)`}
									</Text>
								)}
							</>
						)
					})()}
				</Box>
			)}

			<Text>
				<Newline />
			</Text>
		</Box>
	)
}

interface ChatHistoryItemProps {
	message: TUIMessage
}

function ChatHistoryItem({ message }: ChatHistoryItemProps) {
	const content = sanitizeContent(message.content || "...")

	switch (message.role) {
		case "user":
			return (
				<Box flexDirection="column" paddingX={1}>
					<Text bold color="magenta">
						You said:
					</Text>
					<Text color={theme.userText}>
						{content}
						<Newline />
					</Text>
				</Box>
			)
		case "assistant":
			return (
				<Box flexDirection="column" paddingX={1}>
					<Text bold color="yellow">
						Roo said:
					</Text>
					<Text color={theme.rooText}>
						{content}
						<Newline />
					</Text>
				</Box>
			)
		case "thinking":
			return (
				<Box flexDirection="column" paddingX={1}>
					<Text bold color={theme.thinkingHeader} dimColor>
						Roo is thinking:
					</Text>
					<Text color={theme.thinkingText} dimColor>
						{content}
						<Newline />
					</Text>
				</Box>
			)
		case "tool": {
			// Special rendering for update_todo_list tool - show full TODO list
			if (
				(message.toolName === "update_todo_list" || message.toolName === "updateTodoList") &&
				message.todos &&
				message.todos.length > 0
			) {
				return <TodoDisplay todos={message.todos} previousTodos={message.previousTodos} showProgress={true} />
			}

			// Use the new structured tool renderers when toolData is available
			if (message.toolData) {
				const ToolRenderer = getToolRenderer(message.toolData.tool)
				return <ToolRenderer toolData={message.toolData} rawContent={message.content} />
			}

			// Fallback to generic ToolDisplay for messages without toolData
			return <ToolDisplay message={message} />
		}
		case "system":
			// System messages are typically rendered as Header, not here.
			// But if they appear, show them subtly.
			return (
				<Box flexDirection="column" paddingX={1}>
					<Text color="gray" dimColor>
						{content}
						<Newline />
					</Text>
				</Box>
			)
		default:
			return null
	}
}

export default memo(ChatHistoryItem)
