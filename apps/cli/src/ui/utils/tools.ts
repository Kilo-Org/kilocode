import type { TodoItem } from "@roo-code/types"

import type { ToolData } from "../types.js"

/**
 * Extract structured ToolData from parsed tool JSON
 * This provides rich data for tool-specific renderers
 */
export function extractToolData(toolInfo: Record<string, unknown>): ToolData {
	const toolName = (toolInfo.tool as string) || "unknown"

	// Base tool data with common fields
	const toolData: ToolData = {
		tool: toolName,
		path: toolInfo.path as string | undefined,
		isOutsideWorkspace: toolInfo.isOutsideWorkspace as boolean | undefined,
		isProtected: toolInfo.isProtected as boolean | undefined,
		content: toolInfo.content as string | undefined,
		reason: toolInfo.reason as string | undefined,
	}

	// Extract diff-related fields
	if (toolInfo.diff !== undefined) {
		toolData.diff = toolInfo.diff as string
	}
	if (toolInfo.diffStats !== undefined) {
		const stats = toolInfo.diffStats as { added?: number; removed?: number }
		if (typeof stats.added === "number" && typeof stats.removed === "number") {
			toolData.diffStats = { added: stats.added, removed: stats.removed }
		}
	}

	// Extract search-related fields
	if (toolInfo.regex !== undefined) {
		toolData.regex = toolInfo.regex as string
	}
	if (toolInfo.filePattern !== undefined) {
		toolData.filePattern = toolInfo.filePattern as string
	}
	if (toolInfo.query !== undefined) {
		toolData.query = toolInfo.query as string
	}

	// Extract mode-related fields
	if (toolInfo.mode !== undefined) {
		toolData.mode = toolInfo.mode as string
	}
	if (toolInfo.mode_slug !== undefined) {
		toolData.mode = toolInfo.mode_slug as string
	}

	// Extract command-related fields
	if (toolInfo.command !== undefined) {
		toolData.command = toolInfo.command as string
	}
	if (toolInfo.output !== undefined) {
		toolData.output = toolInfo.output as string
	}

	// Extract browser-related fields
	if (toolInfo.action !== undefined) {
		toolData.action = toolInfo.action as string
	}
	if (toolInfo.url !== undefined) {
		toolData.url = toolInfo.url as string
	}
	if (toolInfo.coordinate !== undefined) {
		toolData.coordinate = toolInfo.coordinate as string
	}

	// Extract batch file operations
	if (Array.isArray(toolInfo.files)) {
		toolData.batchFiles = (toolInfo.files as Array<Record<string, unknown>>).map((f) => ({
			path: (f.path as string) || "",
			lineSnippet: f.lineSnippet as string | undefined,
			isOutsideWorkspace: f.isOutsideWorkspace as boolean | undefined,
			key: f.key as string | undefined,
			content: f.content as string | undefined,
		}))
	}

	// Extract batch diff operations
	if (Array.isArray(toolInfo.batchDiffs)) {
		toolData.batchDiffs = (toolInfo.batchDiffs as Array<Record<string, unknown>>).map((d) => ({
			path: (d.path as string) || "",
			changeCount: d.changeCount as number | undefined,
			key: d.key as string | undefined,
			content: d.content as string | undefined,
			diffStats: d.diffStats as { added: number; removed: number } | undefined,
			diffs: d.diffs as Array<{ content: string; startLine?: number }> | undefined,
		}))
	}

	// Extract question/completion fields
	if (toolInfo.question !== undefined) {
		toolData.question = toolInfo.question as string
	}
	if (toolInfo.result !== undefined) {
		toolData.result = toolInfo.result as string
	}

	// Extract additional display hints
	if (toolInfo.lineNumber !== undefined) {
		toolData.lineNumber = toolInfo.lineNumber as number
	}
	if (toolInfo.additionalFileCount !== undefined) {
		toolData.additionalFileCount = toolInfo.additionalFileCount as number
	}

	return toolData
}

/**
 * Format tool output for display (used in the message body, header shows tool name separately)
 */
export function formatToolOutput(toolInfo: Record<string, unknown>): string {
	const toolName = (toolInfo.tool as string) || "unknown"

	switch (toolName) {
		case "switchMode": {
			const mode = (toolInfo.mode as string) || "unknown"
			const reason = toolInfo.reason as string
			return `→ ${mode} mode${reason ? `\n  ${reason}` : ""}`
		}

		case "switch_mode": {
			const mode = (toolInfo.mode_slug as string) || (toolInfo.mode as string) || "unknown"
			const reason = toolInfo.reason as string
			return `→ ${mode} mode${reason ? `\n  ${reason}` : ""}`
		}

		case "execute_command": {
			const command = toolInfo.command as string
			return `$ ${command || "(no command)"}`
		}

		case "read_file": {
			const files = toolInfo.files as Array<{ path: string }> | undefined
			const path = toolInfo.path as string
			if (files && files.length > 0) {
				return files.map((f) => `📄 ${f.path}`).join("\n")
			}
			return `📄 ${path || "(no path)"}`
		}

		case "write_to_file": {
			const writePath = toolInfo.path as string
			return `📝 ${writePath || "(no path)"}`
		}

		case "apply_diff": {
			const diffPath = toolInfo.path as string
			return `✏️ ${diffPath || "(no path)"}`
		}

		case "search_files": {
			const searchPath = toolInfo.path as string
			const regex = toolInfo.regex as string
			return `🔍 "${regex}" in ${searchPath || "."}`
		}

		case "list_files": {
			const listPath = toolInfo.path as string
			const recursive = toolInfo.recursive as boolean
			return `📁 ${listPath || "."}${recursive ? " (recursive)" : ""}`
		}

		case "browser_action": {
			const action = toolInfo.action as string
			const url = toolInfo.url as string
			return `🌐 ${action || "action"}${url ? `: ${url}` : ""}`
		}

		case "attempt_completion": {
			const result = toolInfo.result as string
			if (result) {
				const truncated = result.length > 100 ? result.substring(0, 100) + "..." : result
				return `✅ ${truncated}`
			}
			return "✅ Task completed"
		}

		case "ask_followup_question": {
			const question = toolInfo.question as string
			return `❓ ${question || "(no question)"}`
		}

		case "new_task": {
			const taskMode = toolInfo.mode as string
			return `📋 Creating subtask${taskMode ? ` in ${taskMode} mode` : ""}`
		}

		case "update_todo_list":
		case "updateTodoList": {
			// Special marker - actual rendering is handled by TodoChangeDisplay component
			return "☑ TODO list updated"
		}

		default: {
			const params = Object.entries(toolInfo)
				.filter(([key]) => key !== "tool")
				.map(([key, value]) => {
					const displayValue = typeof value === "string" ? value : JSON.stringify(value)
					const truncated = displayValue.length > 100 ? displayValue.substring(0, 100) + "..." : displayValue
					return `${key}: ${truncated}`
				})
				.join("\n")
			return params || "(no parameters)"
		}
	}
}

/**
 * Format tool ask message for user approval prompt
 */
export function formatToolAskMessage(toolInfo: Record<string, unknown>): string {
	const toolName = (toolInfo.tool as string) || "unknown"

	switch (toolName) {
		case "switchMode":
		case "switch_mode": {
			const mode = (toolInfo.mode as string) || (toolInfo.mode_slug as string) || "unknown"
			const reason = toolInfo.reason as string
			return `Switch to ${mode} mode?${reason ? `\nReason: ${reason}` : ""}`
		}

		case "execute_command": {
			const command = toolInfo.command as string
			return `Run command?\n$ ${command || "(no command)"}`
		}

		case "read_file": {
			const files = toolInfo.files as Array<{ path: string }> | undefined
			const path = toolInfo.path as string
			if (files && files.length > 0) {
				return `Read ${files.length} file(s)?\n${files.map((f) => `  ${f.path}`).join("\n")}`
			}
			return `Read file: ${path || "(no path)"}`
		}

		case "write_to_file": {
			const writePath = toolInfo.path as string
			return `Write to file: ${writePath || "(no path)"}`
		}

		case "apply_diff": {
			const diffPath = toolInfo.path as string
			return `Apply changes to: ${diffPath || "(no path)"}`
		}

		case "browser_action": {
			const action = toolInfo.action as string
			const url = toolInfo.url as string
			return `Browser: ${action || "action"}${url ? ` - ${url}` : ""}`
		}

		default: {
			const params = Object.entries(toolInfo)
				.filter(([key]) => key !== "tool")
				.map(([key, value]) => {
					const displayValue = typeof value === "string" ? value : JSON.stringify(value)
					const truncated = displayValue.length > 80 ? displayValue.substring(0, 80) + "..." : displayValue
					return `  ${key}: ${truncated}`
				})
				.join("\n")
			return `${toolName}${params ? `\n${params}` : ""}`
		}
	}
}

/**
 * Parse TODO items from tool info
 * Handles both array format and markdown checklist string format
 */
export function parseTodosFromToolInfo(toolInfo: Record<string, unknown>): TodoItem[] | null {
	// Try to get todos directly as an array
	const todosArray = toolInfo.todos as unknown[] | undefined
	if (Array.isArray(todosArray)) {
		return todosArray
			.map((item, index) => {
				if (typeof item === "object" && item !== null) {
					const todo = item as Record<string, unknown>
					return {
						id: (todo.id as string) || `todo-${index}`,
						content: (todo.content as string) || "",
						status: ((todo.status as string) || "pending") as TodoItem["status"],
					}
				}
				return null
			})
			.filter((item): item is TodoItem => item !== null)
	}

	// Try to parse markdown checklist format from todos string
	const todosString = toolInfo.todos as string | undefined
	if (typeof todosString === "string") {
		return parseMarkdownChecklist(todosString)
	}

	return null
}

/**
 * Parse a markdown checklist string into TodoItem array
 * Format:
 *   [ ] pending item
 *   [-] in progress item
 *   [x] completed item
 */
export function parseMarkdownChecklist(markdown: string): TodoItem[] {
	const lines = markdown.split("\n")
	const todos: TodoItem[] = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		if (!line) {
			continue
		}

		const trimmedLine = line.trim()

		if (!trimmedLine) {
			continue
		}

		// Match markdown checkbox patterns
		const checkboxMatch = trimmedLine.match(/^\[([x\-\s])\]\s*(.+)$/i)

		if (checkboxMatch) {
			const statusChar = checkboxMatch[1] ?? " "
			const content = checkboxMatch[2] ?? ""
			let status: TodoItem["status"] = "pending"

			if (statusChar.toLowerCase() === "x") {
				status = "completed"
			} else if (statusChar === "-") {
				status = "in_progress"
			}

			todos.push({ id: `todo-${i}`, content: content.trim(), status })
		}
	}

	return todos
}
