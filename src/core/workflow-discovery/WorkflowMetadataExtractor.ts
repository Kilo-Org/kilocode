// kilocode_change - new file

import matter from "gray-matter"
import type { WorkflowFrontmatter } from "./types"

/**
 * Maximum number of words for description truncation
 */
const MAX_DESCRIPTION_WORDS = 30

/**
 * Extracts metadata from workflow files by parsing YAML frontmatter
 */
export class WorkflowMetadataExtractor {
	/**
	 * Parse frontmatter from workflow content
	 * @param content - Raw workflow file content
	 * @returns Parsed frontmatter and content without frontmatter
	 */
	parseFrontmatter(content: string): { frontmatter: WorkflowFrontmatter; content: string } {
		try {
			const parsed = matter(content)
			return {
				frontmatter: parsed.data as WorkflowFrontmatter,
				content: parsed.content.trim(),
			}
		} catch (error) {
			// If parsing fails, return empty frontmatter and original content
			console.warn("Failed to parse workflow frontmatter:", error)
			return {
				frontmatter: {},
				content: content.trim(),
			}
		}
	}

	/**
	 * Extract and truncate description from frontmatter
	 * @param frontmatter - Parsed frontmatter
	 * @returns Description truncated to 30 words, or undefined if not present
	 */
	extractDescription(frontmatter: WorkflowFrontmatter): string | undefined {
		if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
			return undefined
		}

		const description = frontmatter.description.trim()
		const words = description.split(/\s+/)

		if (words.length <= MAX_DESCRIPTION_WORDS) {
			return description
		}

		// Truncate to 30 words and add ellipsis
		return words.slice(0, MAX_DESCRIPTION_WORDS).join(" ") + "..."
	}

	/**
	 * Extract arguments hint from frontmatter
	 * @param frontmatter - Parsed frontmatter
	 * @returns Arguments hint, or undefined if not present
	 */
	extractArguments(frontmatter: WorkflowFrontmatter): string | undefined {
		if (typeof frontmatter.arguments !== "string" || !frontmatter.arguments.trim()) {
			return undefined
		}
		return frontmatter.arguments.trim()
	}

	/**
	 * Extract all metadata from workflow content
	 * @param content - Raw workflow file content
	 * @returns Object containing description, arguments, and content
	 */
	extractMetadata(content: string): {
		description?: string
		arguments?: string
		content: string
	} {
		const { frontmatter, content: workflowContent } = this.parseFrontmatter(content)

		return {
			description: this.extractDescription(frontmatter),
			arguments: this.extractArguments(frontmatter),
			content: workflowContent,
		}
	}
}
