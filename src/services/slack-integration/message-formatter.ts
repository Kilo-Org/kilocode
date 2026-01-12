// kilocode_change - Message Formatting for Slack Integration

import type { ChatMessage, Citation } from "./models"

export interface SlackMessageOptions {
	includeCodeBlocks?: boolean
	includeCitations?: boolean
	includeFileReferences?: boolean
	maxLength?: number
	language?: string
}

/**
 * MessageFormatter provides utilities for formatting messages for Slack sharing.
 */
export class MessageFormatter {
	private defaultOptions: SlackMessageOptions = {
		includeCodeBlocks: true,
		includeCitations: true,
		includeFileReferences: true,
		maxLength: 4000, // Slack message limit
		language: "typescript",
	}

	/**
	 * Format a chat message for Slack sharing
	 */
	formatChatMessage(message: ChatMessage, options?: SlackMessageOptions): string {
		const opts = { ...this.defaultOptions, ...options }
		let content = message.content

		if (opts.includeCodeBlocks) {
			content = this.formatCodeContent(content, opts.language)
		}

		// Add citations if available
		if (opts.includeCitations && message.citations && message.citations.length > 0) {
			content += this.formatCitations(message.citations)
		}

		// Truncate if necessary
		if (opts.maxLength && content.length > opts.maxLength) {
			content = this.truncate(content, opts.maxLength)
		}

		return content
	}

	/**
	 * Format code content with syntax highlighting
	 */
	formatCodeContent(content: string, language?: string): string {
		const lang = language || "text"
		return `\`\`\`${lang}\n${content}\n\`\`\``
	}

	/**
	 * Format a code snippet for Slack
	 */
	formatCodeSnippet(code: string, language?: string): string {
		const lang = language || "text"
		return `\`\`\`${lang}\n${code}\n\`\`\``
	}

	/**
	 * Format citations for Slack
	 */
	formatCitations(citations: Citation[]): string {
		if (!citations || citations.length === 0) {
			return ""
		}

		const lines = ["\n\n*Sources:*"]
		for (const citation of citations) {
			const sourceInfo = this.formatCitation(citation)
			lines.push(sourceInfo)
		}

		return lines.join("\n")
	}

	/**
	 * Format a single citation
	 */
	formatCitation(citation: Citation): string {
		const parts: string[] = []

		switch (citation.sourceType) {
			case "file":
				if (citation.startLine !== undefined && citation.endLine !== undefined) {
					parts.push(`📄 *${citation.sourcePath}* (lines ${citation.startLine}-${citation.endLine})`)
				} else {
					parts.push(`📄 *${citation.sourcePath}*`)
				}
				break
			case "documentation":
				parts.push(`📚 *${citation.sourcePath}*`)
				break
			case "url":
				parts.push(`🔗 <${citation.sourcePath}|Link>`)
				break
		}

		if (citation.snippet) {
			const snippetPreview = citation.snippet.substring(0, 100)
			parts.push(`\`\`\`\n${snippetPreview}\n\`\`\``)
		}

		return parts.join("\n")
	}

	/**
	 * Format file references for Slack
	 */
	formatFileReferences(files: Array<{ path: string; line?: number }>): string {
		if (!files || files.length === 0) {
			return ""
		}

		const lines = ["\n*Files:*"]
		for (const file of files) {
			if (file.line) {
				lines.push(`📄 ${file.path}:${file.line}`)
			} else {
				lines.push(`📄 ${file.path}`)
			}
		}

		return lines.join("\n")
	}

	/**
	 * Create a rich message with all available context
	 */
	createRichMessage(
		question: string,
		answer: string,
		citations?: Citation[],
		files?: Array<{ path: string; line?: number }>,
		options?: SlackMessageOptions,
	): string {
		const opts = { ...this.defaultOptions, ...options }

		let message = `*🤖 Kilo Code Analysis*\n\n`
		message += `*Question:* ${question}\n\n`
		message += `*Answer:*\n${this.formatChatMessage({ content: answer } as ChatMessage, { includeCitations: false, ...opts })}`

		if (opts.includeCitations && citations && citations.length > 0) {
			message += this.formatCitations(citations)
		}

		if (opts.includeFileReferences && files && files.length > 0) {
			message += this.formatFileReferences(files)
		}

		if (opts.maxLength && message.length > opts.maxLength) {
			message = this.truncate(message, opts.maxLength - 50) // Leave room for truncation message
			message += "\n\n_(message truncated)_"
		}

		return message
	}

	/**
	 * Truncate text to a maximum length
	 */
	private truncate(text: string, maxLength: number): string {
		if (text.length <= maxLength) {
			return text
		}
		return text.substring(0, maxLength - 3) + "..."
	}
}
