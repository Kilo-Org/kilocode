/**
 * Session export utilities
 * Converts session messages to Markdown, HTML, and JSONL formats
 */

import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { existsSync } from "node:fs"
import type { UnifiedMessage } from "../state/atoms/ui.js"
import type { ExtensionChatMessage } from "../types/messages.js"
import type { CliMessage } from "../types/cli.js"

export type ExportFormat = "markdown" | "html" | "jsonl"

export interface ExportMetadata {
	sessionId?: string | undefined
	title?: string | undefined
	mode?: string | undefined
	provider?: string | undefined
	model?: string | undefined
	workspace?: string | undefined
	exportedAt: string
	messageCount: number
}

export interface ExportOptions {
	format: ExportFormat
	outputPath?: string | undefined
	metadata?: Partial<ExportMetadata>
}

export interface ExportResult {
	success: boolean
	outputPath: string
	format: ExportFormat
	messageCount: number
	error?: string
}

function formatTimestamp(ts: number): string {
	return new Date(ts).toISOString()
}

function formatRelativeTimestamp(ts: number): string {
	const date = new Date(ts)
	return date.toLocaleString()
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;")
}

function extractTextContent(message: ExtensionChatMessage): string {
	if (!message.text) return ""

	try {
		const parsed = JSON.parse(message.text)
		if (typeof parsed === "object" && parsed !== null) {
			if (parsed.content) return parsed.content
			if (parsed.command) return `Command: ${parsed.command}\n${parsed.output || ""}`
			if (parsed.diff) return parsed.diff
			return JSON.stringify(parsed, null, 2)
		}
		return message.text
	} catch {
		return message.text
	}
}

function getMessageRole(message: UnifiedMessage): string {
	if (message.source === "cli") {
		const cliMsg = message.message as CliMessage
		switch (cliMsg.type) {
			case "user":
				return "User"
			case "assistant":
				return "Assistant"
			case "system":
				return "System"
			case "error":
				return "Error"
			case "welcome":
				return "Welcome"
			default:
				return "System"
		}
	} else {
		const extMsg = message.message as ExtensionChatMessage
		if (extMsg.type === "say") {
			const sayType = extMsg.say
			if (sayType === "user_feedback" || sayType === "user_feedback_diff") {
				return "User"
			}
			if (sayType === "text" || sayType === "reasoning") {
				return "Assistant"
			}
			if (sayType === "error") {
				return "Error"
			}
			if (sayType === "completion_result") {
				return "Result"
			}
			return "Assistant"
		} else if (extMsg.type === "ask") {
			if (extMsg.ask === "tool") {
				return "Tool"
			}
			return "Assistant"
		}
		return "System"
	}
}

function getMessageContent(message: UnifiedMessage): string {
	if (message.source === "cli") {
		return (message.message as CliMessage).content
	} else {
		return extractTextContent(message.message as ExtensionChatMessage)
	}
}

function shouldIncludeMessage(message: UnifiedMessage): boolean {
	if (message.source === "cli") {
		const cliMsg = message.message as CliMessage
		return cliMsg.type !== "empty"
	} else {
		const extMsg = message.message as ExtensionChatMessage
		if (extMsg.say === "api_req_started" || extMsg.say === "api_req_finished") {
			return false
		}
		if (extMsg.say === "checkpoint_saved") {
			return false
		}
		const content = extractTextContent(extMsg)
		return content.trim().length > 0
	}
}

export function renderToMarkdown(messages: UnifiedMessage[], metadata: ExportMetadata): string {
	const lines: string[] = []

	lines.push(`# ${metadata.title || "Session Export"}`)
	lines.push("")
	lines.push("## Metadata")
	lines.push("")
	if (metadata.sessionId) lines.push(`- **Session ID:** \`${metadata.sessionId}\``)
	if (metadata.mode) lines.push(`- **Mode:** ${metadata.mode}`)
	if (metadata.provider) lines.push(`- **Provider:** ${metadata.provider}`)
	if (metadata.model) lines.push(`- **Model:** ${metadata.model}`)
	if (metadata.workspace) lines.push(`- **Workspace:** \`${metadata.workspace}\``)
	lines.push(`- **Exported:** ${metadata.exportedAt}`)
	lines.push(`- **Messages:** ${metadata.messageCount}`)
	lines.push("")
	lines.push("---")
	lines.push("")
	lines.push("## Conversation")
	lines.push("")

	const filteredMessages = messages.filter(shouldIncludeMessage)

	for (const message of filteredMessages) {
		const role = getMessageRole(message)
		const content = getMessageContent(message)
		const timestamp = formatRelativeTimestamp(message.message.ts)

		lines.push(`### ${role}`)
		lines.push(`*${timestamp}*`)
		lines.push("")

		if (content.includes("```") || content.includes("\n")) {
			lines.push(content)
		} else {
			lines.push(content)
		}
		lines.push("")
	}

	return lines.join("\n")
}

export function renderToHtml(messages: UnifiedMessage[], metadata: ExportMetadata): string {
	const filteredMessages = messages.filter(shouldIncludeMessage)

	const messageRows = filteredMessages
		.map((message) => {
			const role = getMessageRole(message)
			const content = getMessageContent(message)
			const timestamp = formatRelativeTimestamp(message.message.ts)
			const roleClass = role.toLowerCase().replace(/\s+/g, "-")

			return `
		<div class="message ${roleClass}">
			<div class="message-header">
				<span class="role">${escapeHtml(role)}</span>
				<span class="timestamp">${escapeHtml(timestamp)}</span>
			</div>
			<div class="message-content">
				<pre>${escapeHtml(content)}</pre>
			</div>
		</div>`
		})
		.join("\n")

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(metadata.title || "Session Export")}</title>
	<style>
		:root {
			--bg-color: #1a1a2e;
			--text-color: #e0e0e0;
			--border-color: #333;
			--user-bg: #2d4a3e;
			--assistant-bg: #2d3a4a;
			--system-bg: #3a3a3a;
			--error-bg: #4a2d2d;
			--tool-bg: #4a3a2d;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background-color: var(--bg-color);
			color: var(--text-color);
			max-width: 900px;
			margin: 0 auto;
			padding: 2rem;
			line-height: 1.6;
		}
		h1 { color: #00d9ff; border-bottom: 2px solid #00d9ff; padding-bottom: 0.5rem; }
		h2 { color: #a0a0a0; margin-top: 2rem; }
		.metadata {
			background: #252540;
			padding: 1rem;
			border-radius: 8px;
			margin-bottom: 2rem;
		}
		.metadata p { margin: 0.25rem 0; }
		.metadata code { background: #333; padding: 0.2rem 0.4rem; border-radius: 4px; }
		hr { border: none; border-top: 1px solid var(--border-color); margin: 2rem 0; }
		.message {
			margin-bottom: 1.5rem;
			border-radius: 8px;
			overflow: hidden;
		}
		.message-header {
			padding: 0.5rem 1rem;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		.role { font-weight: bold; }
		.timestamp { font-size: 0.85rem; opacity: 0.7; }
		.message-content {
			padding: 1rem;
			background: rgba(0,0,0,0.2);
		}
		.message-content pre {
			margin: 0;
			white-space: pre-wrap;
			word-wrap: break-word;
			font-family: 'Fira Code', 'Consolas', monospace;
			font-size: 0.9rem;
		}
		.user .message-header { background: var(--user-bg); }
		.assistant .message-header { background: var(--assistant-bg); }
		.system .message-header { background: var(--system-bg); }
		.error .message-header { background: var(--error-bg); }
		.tool .message-header { background: var(--tool-bg); }
		.result .message-header { background: #2d4a4a; }
	</style>
</head>
<body>
	<h1>${escapeHtml(metadata.title || "Session Export")}</h1>
	
	<div class="metadata">
		<h2>Metadata</h2>
		${metadata.sessionId ? `<p><strong>Session ID:</strong> <code>${escapeHtml(metadata.sessionId)}</code></p>` : ""}
		${metadata.mode ? `<p><strong>Mode:</strong> ${escapeHtml(metadata.mode)}</p>` : ""}
		${metadata.provider ? `<p><strong>Provider:</strong> ${escapeHtml(metadata.provider)}</p>` : ""}
		${metadata.model ? `<p><strong>Model:</strong> ${escapeHtml(metadata.model)}</p>` : ""}
		${metadata.workspace ? `<p><strong>Workspace:</strong> <code>${escapeHtml(metadata.workspace)}</code></p>` : ""}
		<p><strong>Exported:</strong> ${escapeHtml(metadata.exportedAt)}</p>
		<p><strong>Messages:</strong> ${metadata.messageCount}</p>
	</div>

	<hr>

	<h2>Conversation</h2>

	${messageRows}

</body>
</html>`
}

export function renderToJsonl(messages: UnifiedMessage[], metadata: ExportMetadata): string {
	const lines: string[] = []

	lines.push(JSON.stringify({ type: "metadata", ...metadata }))

	const filteredMessages = messages.filter(shouldIncludeMessage)

	for (const message of filteredMessages) {
		const role = getMessageRole(message)
		const content = getMessageContent(message)
		const timestamp = formatTimestamp(message.message.ts)

		lines.push(
			JSON.stringify({
				type: "message",
				role,
				content,
				timestamp,
				ts: message.message.ts,
				source: message.source,
			}),
		)
	}

	return lines.join("\n")
}

export function renderSession(messages: UnifiedMessage[], format: ExportFormat, metadata: ExportMetadata): string {
	switch (format) {
		case "markdown":
			return renderToMarkdown(messages, metadata)
		case "html":
			return renderToHtml(messages, metadata)
		case "jsonl":
			return renderToJsonl(messages, metadata)
		default:
			throw new Error(`Unsupported export format: ${format}`)
	}
}

function getFileExtension(format: ExportFormat): string {
	switch (format) {
		case "markdown":
			return "md"
		case "html":
			return "html"
		case "jsonl":
			return "jsonl"
		default:
			return "txt"
	}
}

export async function exportSession(messages: UnifiedMessage[], options: ExportOptions): Promise<ExportResult> {
	const { format, outputPath, metadata = {} } = options

	const exportMetadata: ExportMetadata = {
		exportedAt: new Date().toISOString(),
		messageCount: messages.filter(shouldIncludeMessage).length,
		...metadata,
	}

	try {
		const content = renderSession(messages, format, exportMetadata)

		const extension = getFileExtension(format)
		const filename = metadata.sessionId
			? `session-${metadata.sessionId}.${extension}`
			: `session-${Date.now()}.${extension}`

		const finalPath = outputPath ? resolve(outputPath) : join(process.cwd(), "kilo-exports", filename)

		const dir = dirname(finalPath)
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true })
		}

		await writeFile(finalPath, content, "utf-8")

		return {
			success: true,
			outputPath: finalPath,
			format,
			messageCount: exportMetadata.messageCount,
		}
	} catch (error) {
		return {
			success: false,
			outputPath: outputPath || "",
			format,
			messageCount: 0,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
