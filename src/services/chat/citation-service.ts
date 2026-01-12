// kilocode_change - new file

/**
 * Citation Service
 * Manages citation extraction, validation, and storage for AI responses
 */

import * as fs from "fs/promises"
import * as path from "path"
import type { Citation } from "./types"
import { EntityFactory } from "./models"
import { getDatabaseManager } from "../../core/database/manager"
import type { DatabaseManager } from "../../core/database/manager"
import { CitationError } from "./types"

export interface CitationServiceConfig {
	/** Maximum snippet length */
	maxSnippetLength?: number
	/** Confidence threshold for citations */
	confidenceThreshold?: number
	/** Whether to verify citations exist */
	verifyCitations?: boolean
	/** Maximum number of citations per message */
	maxCitationsPerMessage?: number
}

export class CitationService {
	private db: DatabaseManager
	private config: Required<CitationServiceConfig>

	constructor(config: CitationServiceConfig = {}) {
		this.db = getDatabaseManager()
		this.config = {
			maxSnippetLength: config.maxSnippetLength ?? 1000,
			confidenceThreshold: config.confidenceThreshold ?? 0.7,
			verifyCitations: config.verifyCitations ?? true,
			maxCitationsPerMessage: config.maxCitationsPerMessage ?? 50,
		}
	}

	/**
	 * Extract citations from AI response content
	 */
	async extractCitations(messageId: string, content: string, context?: any): Promise<Citation[]> {
		try {
			const citations: Citation[] = []

			// Extract file citations with line numbers
			const fileCitations = this.extractFileCitations(content, messageId)
			citations.push(...fileCitations)

			// Extract documentation citations
			const docCitations = this.extractDocumentationCitations(content, messageId)
			citations.push(...docCitations)

			// Extract URL citations
			const urlCitations = this.extractUrlCitations(content, messageId)
			citations.push(...urlCitations)

			// Validate and filter citations
			const validCitations = await this.validateAndFilterCitations(citations)

			// Limit number of citations
			return validCitations.slice(0, this.config.maxCitationsPerMessage)
		} catch (error) {
			throw new CitationError(`Failed to extract citations: ${error}`, error)
		}
	}

	/**
	 * Validate a citation
	 */
	async validateCitation(citation: Citation): Promise<boolean> {
		try {
			// Validate confidence
			if (citation.confidence < 0 || citation.confidence > 1) {
				return false
			}

			// Validate confidence threshold
			if (citation.confidence < this.config.confidenceThreshold) {
				return false
			}

			// Validate source path
			if (!citation.sourcePath || citation.sourcePath.trim().length === 0) {
				return false
			}

			// Validate snippet
			if (!citation.snippet || citation.snippet.trim().length === 0) {
				return false
			}

			// Validate snippet length
			if (citation.snippet.length > this.config.maxSnippetLength) {
				return false
			}

			// Validate line numbers for file citations
			if (citation.sourceType === "file") {
				if (citation.startLine !== undefined && citation.startLine < 1) {
					return false
				}
				if (citation.endLine !== undefined && citation.endLine < 1) {
					return false
				}
				if (
					citation.startLine !== undefined &&
					citation.endLine !== undefined &&
					citation.endLine < citation.startLine
				) {
					return false
				}
			}

			// Verify file exists if enabled
			if (this.config.verifyCitations && citation.sourceType === "file") {
				const exists = await this.verifyFileExists(citation.sourcePath)
				if (!exists) {
					return false
				}
			}

			return true
		} catch (error) {
			console.error(`Error validating citation: ${error}`)
			return false
		}
	}

	/**
	 * Save citations to database
	 */
	async saveCitations(citations: Citation[]): Promise<void> {
		try {
			for (const citation of citations) {
				this.db.createCitation({
					message_id: citation.messageId,
					source_type: citation.sourceType,
					source_path: citation.sourcePath,
					start_line: citation.startLine,
					end_line: citation.endLine,
					snippet: citation.snippet,
					confidence: citation.confidence,
					metadata: JSON.stringify(citation.metadata),
				})
			}
		} catch (error) {
			throw new CitationError(`Failed to save citations: ${error}`, error)
		}
	}

	/**
	 * Get citations by message ID
	 */
	async getCitationsByMessage(messageId: string): Promise<Citation[]> {
		try {
			const rows = this.db.getCitationsByMessageId(messageId)
			return rows.map((row) => ({
				id: row.id,
				messageId: row.message_id,
				sourceType: row.source_type,
				sourcePath: row.source_path,
				startLine: row.start_line,
				endLine: row.end_line,
				snippet: row.snippet,
				confidence: row.confidence,
				metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			}))
		} catch (error) {
			throw new CitationError(`Failed to get citations: ${error}`, error)
		}
	}

	/**
	 * Search citations by file path
	 */
	async searchCitationsByPath(filePath: string): Promise<Citation[]> {
		try {
			const rows = this.db.getCitationsBySourcePath(filePath)
			return rows.map((row) => ({
				id: row.id,
				messageId: row.message_id,
				sourceType: row.source_type,
				sourcePath: row.source_path,
				startLine: row.start_line,
				endLine: row.end_line,
				snippet: row.snippet,
				confidence: row.confidence,
				metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			}))
		} catch (error) {
			throw new CitationError(`Failed to search citations: ${error}`, error)
		}
	}

	/**
	 * Extract code snippet from file
	 */
	async extractSnippet(filePath: string, startLine: number, endLine: number): Promise<string> {
		try {
			const absolutePath = path.resolve(filePath)
			const content = await fs.readFile(absolutePath, "utf-8")
			const lines = content.split("\n")

			const snippetLines = lines.slice(startLine - 1, endLine)
			let snippet = snippetLines.join("\n")

			// Truncate if too long
			if (snippet.length > this.config.maxSnippetLength) {
				snippet = snippet.substring(0, this.config.maxSnippetLength - 3) + "..."
			}

			return snippet
		} catch (error) {
			throw new CitationError(`Failed to extract snippet: ${error}`, error)
		}
	}

	/**
	 * Calculate confidence score for a citation
	 */
	calculateConfidence(matchType: "exact" | "fuzzy" | "partial"): number {
		switch (matchType) {
			case "exact":
				return 0.95
			case "fuzzy":
				return 0.75
			case "partial":
				return 0.55
			default:
				return 0.5
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Extract file citations from content
	 */
	private extractFileCitations(content: string, messageId: string): Citation[] {
		const citations: Citation[] = []

		// Pattern: [file/path.ts:start-end] or [file/path.ts:line]
		const filePattern =
			/\[([^\]]+\.ts(?:x)?|[^:\]]+\.(js|jsx|py|java|go|rs|cpp|c|h|cs|kt|swift)):(\d+)(?:-(\d+))?\]/g

		let match
		while ((match = filePattern.exec(content)) !== null) {
			const filePath = match[1]
			const startLine = parseInt(match[3], 10)
			const endLine = match[4] ? parseInt(match[4], 10) : startLine

			const citation = EntityFactory.createCitation({
				messageId,
				sourceType: "file",
				sourcePath: filePath,
				startLine,
				endLine,
				snippet: "", // Will be populated later
				confidence: this.calculateConfidence("exact"),
			})

			citation.setExtractedAt(new Date())
			citation.setVerified(false)

			citations.push(citation.toJSON())
		}

		return citations
	}

	/**
	 * Extract documentation citations from content
	 */
	private extractDocumentationCitations(content: string, messageId: string): Citation[] {
		const citations: Citation[] = []

		// Pattern: [Documentation: name] or [Docs: name]
		const docPattern = /\[(?:Documentation|Docs):\s*([^\]]+)\]/g

		let match
		while ((match = docPattern.exec(content)) !== null) {
			const docName = match[1]

			const citation = EntityFactory.createCitation({
				messageId,
				sourceType: "documentation",
				sourcePath: docName,
				snippet: docName,
				confidence: this.calculateConfidence("fuzzy"),
			})

			citation.setExtractedAt(new Date())

			citations.push(citation.toJSON())
		}

		return citations
	}

	/**
	 * Extract URL citations from content
	 */
	private extractUrlCitations(content: string, messageId: string): Citation[] {
		const citations: Citation[] = []

		// Pattern: [https://...] or [http://...]
		const urlPattern = /\[(https?:\/\/[^\]]+)\]/g

		let match
		while ((match = urlPattern.exec(content)) !== null) {
			const url = match[1]

			const citation = EntityFactory.createCitation({
				messageId,
				sourceType: "url",
				sourcePath: url,
				snippet: url,
				confidence: this.calculateConfidence("exact"),
			})

			citation.setExtractedAt(new Date())

			citations.push(citation.toJSON())
		}

		return citations
	}

	/**
	 * Validate and filter citations
	 */
	private async validateAndFilterCitations(citations: Citation[]): Promise<Citation[]> {
		const validCitations: Citation[] = []

		for (const citation of citations) {
			const isValid = await this.validateCitation(citation)
			if (isValid) {
				validCitations.push(citation)
			}
		}

		return validCitations
	}

	/**
	 * Verify that a file exists
	 */
	private async verifyFileExists(filePath: string): Promise<boolean> {
		try {
			const absolutePath = path.resolve(filePath)
			await fs.access(absolutePath)
			return true
		} catch {
			return false
		}
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: CitationService | null = null

export function getCitationService(config?: CitationServiceConfig): CitationService {
	if (!instance) {
		instance = new CitationService(config)
	}
	return instance
}

export function resetCitationService(): void {
	instance = null
}
