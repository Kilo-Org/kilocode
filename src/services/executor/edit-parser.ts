// kilocode_change - new file

export interface EditBlock {
	search: string
	replace: string
	filePath: string
	startLine?: number
	endLine?: number
}

export interface ParsedEdit {
	type: "search_replace" | "insert" | "delete"
	filePath: string
	search?: string
	replace?: string
	position?: "before" | "after"
	anchor?: string
	startLine?: number
	endLine?: number
}

export interface ParseResult {
	edits: ParsedEdit[]
	errors: string[]
	warnings: string[]
}

/**
 * Parser for AI-generated edit blocks with support for multiple formats
 */
export class EditParser {
	private static readonly SEARCH_REPLACE_REGEX = /<<<< SEARCH\s*\n([\s\S]*?)\n====\s*\n([\s\S]*?)\n>>>> REPLACE/g
	private static readonly INSERT_REGEX =
		/<<<< INSERT\s*\n([\s\S]*?)\n====\s*\n([\s\S]*?)\n>>>> (BEFORE|AFTER)\s*\n([\s\S]*?)\n>>>> END/g
	private static readonly DELETE_REGEX = /<<<< DELETE\s*\n([\s\S]*?)\n====\s*\n([\s\S]*?)\n>>>> END/g

	/**
	 * Parse AI-generated edit blocks from text
	 */
	static parseEdits(text: string, defaultFilePath?: string): ParseResult {
		const edits: ParsedEdit[] = []
		const errors: string[] = []
		const warnings: string[] = []

		// Parse search/replace blocks
		this.parseSearchReplaceBlocks(text, edits, errors, warnings, defaultFilePath)

		// Parse insert blocks
		this.parseInsertBlocks(text, edits, errors, warnings, defaultFilePath)

		// Parse delete blocks
		this.parseDeleteBlocks(text, edits, errors, warnings, defaultFilePath)

		return { edits, errors, warnings }
	}

	/**
	 * Parse search/replace blocks
	 */
	private static parseSearchReplaceBlocks(
		text: string,
		edits: ParsedEdit[],
		errors: string[],
		warnings: string[],
		defaultFilePath?: string,
	): void {
		const matches = Array.from(text.matchAll(this.SEARCH_REPLACE_REGEX))

		for (const match of matches) {
			try {
				const search = match[1]?.trim()
				const replace = match[2]?.trim()

				if (!search || !replace) {
					errors.push("Invalid search/replace block: missing search or replace content")
					continue
				}

				// Extract file path from search content if specified
				const filePath = this.extractFilePath(search) || defaultFilePath

				if (!filePath) {
					errors.push("No file path specified in search/replace block")
					continue
				}

				edits.push({
					type: "search_replace",
					filePath,
					search: this.cleanSearchContent(search),
					replace: this.cleanReplaceContent(replace),
				})
			} catch (error) {
				errors.push(`Error parsing search/replace block: ${error}`)
			}
		}
	}

	/**
	 * Parse insert blocks
	 */
	private static parseInsertBlocks(
		text: string,
		edits: ParsedEdit[],
		errors: string[],
		warnings: string[],
		defaultFilePath?: string,
	): void {
		const matches = Array.from(text.matchAll(this.INSERT_REGEX))

		for (const match of matches) {
			try {
				const content = match[1]?.trim()
				const position = match[3]?.toLowerCase() as "before" | "after"
				const anchor = match[4]?.trim()

				if (!content || !position || !anchor) {
					errors.push("Invalid insert block: missing content, position, or anchor")
					continue
				}

				const filePath = this.extractFilePath(content) || defaultFilePath

				if (!filePath) {
					errors.push("No file path specified in insert block")
					continue
				}

				edits.push({
					type: "insert",
					filePath,
					replace: this.cleanReplaceContent(content),
					position,
					anchor: this.cleanSearchContent(anchor),
				})
			} catch (error) {
				errors.push(`Error parsing insert block: ${error}`)
			}
		}
	}

	/**
	 * Parse delete blocks
	 */
	private static parseDeleteBlocks(
		text: string,
		edits: ParsedEdit[],
		errors: string[],
		warnings: string[],
		defaultFilePath?: string,
	): void {
		const matches = Array.from(text.matchAll(this.DELETE_REGEX))

		for (const match of matches) {
			try {
				const content = match[1]?.trim()

				if (!content) {
					errors.push("Invalid delete block: missing content")
					continue
				}

				const filePath = this.extractFilePath(content) || defaultFilePath

				if (!filePath) {
					errors.push("No file path specified in delete block")
					continue
				}

				edits.push({
					type: "delete",
					filePath,
					search: this.cleanSearchContent(content),
				})
			} catch (error) {
				errors.push(`Error parsing delete block: ${error}`)
			}
		}
	}

	/**
	 * Extract file path from search content
	 */
	private static extractFilePath(content: string): string | null {
		// Look for file path patterns like "File: path/to/file.py" or "path/to/file.py"
		const fileMatch = content.match(
			/(?:File:\s*|path:\s*|filename:\s*)?([^\s\n]+\.(py|js|ts|jsx|tsx|xml|json|md|sql|html|css|scss|java|cpp|c|go|rs|php|rb))/i,
		)
		return fileMatch ? fileMatch[1] : null
	}

	/**
	 * Clean search content by removing file path markers
	 */
	private static cleanSearchContent(content: string): string {
		return content
			.replace(
				/(?:File:\s*|path:\s*|filename:\s*)?[^\s\n]+\.(py|js|ts|jsx|tsx|xml|json|md|sql|html|css|scss|java|cpp|c|go|rs|php|rb)[\s\n]*/gi,
				"",
			)
			.trim()
	}

	/**
	 * Clean replace content by removing file path markers
	 */
	private static cleanReplaceContent(content: string): string {
		return content
			.replace(
				/(?:File:\s*|path:\s*|filename:\s*)?[^\s\n]+\.(py|js|ts|jsx|tsx|xml|json|md|sql|html|css|scss|java|cpp|c|go|rs|php|rb)[\s\n]*/gi,
				"",
			)
			.trim()
	}

	/**
	 * Validate edit blocks for common issues
	 */
	static validateEdits(edits: ParsedEdit[]): string[] {
		const errors: string[] = []

		for (const edit of edits) {
			// Check file path
			if (!edit.filePath) {
				errors.push("Edit missing file path")
				continue
			}

			// Check for dangerous file paths
			if (this.isDangerousPath(edit.filePath)) {
				errors.push(`Dangerous file path: ${edit.filePath}`)
			}

			// Check search/replace content
			if (edit.type === "search_replace") {
				if (!edit.search || !edit.replace) {
					errors.push(`Search/replace edit missing search or replace content for ${edit.filePath}`)
				}
			}

			// Check insert content
			if (edit.type === "insert") {
				if (!edit.replace || !edit.position || !edit.anchor) {
					errors.push(`Insert edit missing content, position, or anchor for ${edit.filePath}`)
				}
			}

			// Check delete content
			if (edit.type === "delete") {
				if (!edit.search) {
					errors.push(`Delete edit missing search content for ${edit.filePath}`)
				}
			}
		}

		return errors
	}

	/**
	 * Check if a file path is dangerous
	 */
	private static isDangerousPath(filePath: string): boolean {
		const dangerousPatterns = [
			/\.git\//,
			/node_modules\//,
			/\.vscode\//,
			/\.idea\//,
			/\.\./,
			/^\/etc\//,
			/^\/usr\//,
			/^\/bin\//,
			/^\/sbin\//,
		]

		return dangerousPatterns.some((pattern) => pattern.test(filePath))
	}

	/**
	 * Extract line numbers from search content
	 */
	static extractLineNumbers(content: string): { startLine?: number; endLine?: number } {
		const lineMatch = content.match(/(?:lines?\s*|line\s*)?(\d+)(?:\s*-\s*(\d+))?/i)

		if (lineMatch) {
			const startLine = parseInt(lineMatch[1])
			const endLine = lineMatch[2] ? parseInt(lineMatch[2]) : startLine
			return { startLine, endLine }
		}

		return {}
	}

	/**
	 * Generate formatted edit block for output
	 */
	static formatEditBlock(edit: ParsedEdit): string {
		switch (edit.type) {
			case "search_replace":
				return `<<<< SEARCH
${edit.search}
====
${edit.replace}
>>>> REPLACE`

			case "insert":
				return `<<<< INSERT
${edit.replace}
====
${edit.position?.toUpperCase()}
${edit.anchor}
>>>> END`

			case "delete":
				return `<<<< DELETE
${edit.search}
====

>>>> END`

			default:
				return ""
		}
	}
}
