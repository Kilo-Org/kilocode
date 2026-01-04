// kilocode_change - new file
// Task 4.2.1: Semantic Compressor

/**
 * Compression level
 */
export type CompressionLevel = "none" | "light" | "moderate" | "aggressive"

/**
 * Compressed content result
 */
export interface CompressedContent {
	id: string
	originalContent: string
	compressedContent: string
	compressionLevel: CompressionLevel
	originalTokens: number
	compressedTokens: number
	compressionRatio: number
	preservedElements: string[]
	removedElements: string[]
	metadata?: Record<string, any>
}

/**
 * Compression configuration
 */
export interface SemanticCompressorConfig {
	/** Preserve code blocks */
	preserveCodeBlocks: boolean
	/** Preserve URLs and links */
	preserveUrls: boolean
	/** Preserve file paths */
	preserveFilePaths: boolean
	/** Preserve numbers and data */
	preserveNumbers: boolean
	/** Minimum content length to compress */
	minContentLength: number
	/** Target compression ratios by level */
	targetRatios: Record<CompressionLevel, number>
}

const DEFAULT_CONFIG: SemanticCompressorConfig = {
	preserveCodeBlocks: true,
	preserveUrls: true,
	preserveFilePaths: true,
	preserveNumbers: true,
	minContentLength: 100,
	targetRatios: {
		none: 1.0,
		light: 0.8,
		moderate: 0.5,
		aggressive: 0.3,
	},
}

/**
 * Patterns to identify and preserve important elements
 */
const PATTERNS = {
	codeBlock: /```[\s\S]*?```/g,
	inlineCode: /`[^`]+`/g,
	url: /https?:\/\/[^\s)]+/g,
	filePath: /(?:\/[\w.-]+)+(?:\.\w+)?/g,
	functionCall: /\b\w+\([^)]*\)/g,
	variableName: /\b[a-z_][a-zA-Z0-9_]*\b/g,
	className: /\b[A-Z][a-zA-Z0-9]*\b/g,
	number: /\b\d+(?:\.\d+)?\b/g,
}

/**
 * Words to remove during compression
 */
const STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"but",
	"in",
	"on",
	"at",
	"to",
	"for",
	"of",
	"with",
	"by",
	"from",
	"as",
	"is",
	"was",
	"are",
	"were",
	"been",
	"be",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"must",
	"shall",
	"can",
	"need",
	"that",
	"this",
	"these",
	"those",
	"it",
	"its",
	"they",
	"them",
	"their",
	"we",
	"us",
	"our",
	"you",
	"your",
	"he",
	"she",
	"him",
	"her",
	"his",
	"very",
	"really",
	"just",
	"also",
	"even",
	"still",
	"already",
	"always",
])

/**
 * Semantic compressor that reduces content while preserving meaning.
 */
export class SemanticCompressor {
	private config: SemanticCompressorConfig
	private compressionCache: Map<string, CompressedContent> = new Map()

	constructor(config: Partial<SemanticCompressorConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Compress content at specified level
	 */
	compress(content: string, level: CompressionLevel = "moderate", id?: string): CompressedContent {
		const contentId = id ?? this.generateId(content)

		// Check cache
		const cacheKey = `${contentId}:${level}`
		const cached = this.compressionCache.get(cacheKey)
		if (cached) return cached

		if (level === "none" || content.length < this.config.minContentLength) {
			return this.createResult(contentId, content, content, level, [], [])
		}

		// Extract and preserve important elements
		const preserved = this.extractPreservedElements(content)

		// Apply compression
		let compressed: string
		const removed: string[] = []

		switch (level) {
			case "light":
				compressed = this.lightCompression(content, preserved, removed)
				break
			case "moderate":
				compressed = this.moderateCompression(content, preserved, removed)
				break
			case "aggressive":
				compressed = this.aggressiveCompression(content, preserved, removed)
				break
			default:
				compressed = content
		}

		const result = this.createResult(contentId, content, compressed, level, preserved.all, removed)

		// Cache result
		this.compressionCache.set(cacheKey, result)

		return result
	}

	/**
	 * Decompress/expand content (retrieve original if available)
	 */
	decompress(id: string): string | null {
		for (const [key, result] of this.compressionCache) {
			if (key.startsWith(id + ":")) {
				return result.originalContent
			}
		}
		return null
	}

	/**
	 * Batch compress multiple contents
	 */
	batchCompress(
		contents: Array<{ content: string; id?: string }>,
		level: CompressionLevel = "moderate",
	): CompressedContent[] {
		return contents.map(({ content, id }) => this.compress(content, level, id))
	}

	/**
	 * Get optimal compression level for target token count
	 */
	getOptimalLevel(content: string, targetTokens: number): CompressionLevel {
		const originalTokens = this.estimateTokens(content)

		if (targetTokens >= originalTokens) return "none"

		const targetRatio = targetTokens / originalTokens

		if (targetRatio >= 0.8) return "light"
		if (targetRatio >= 0.5) return "moderate"
		return "aggressive"
	}

	/**
	 * Clear compression cache
	 */
	clearCache(): void {
		this.compressionCache.clear()
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): {
		size: number
		avgCompressionRatio: number
		totalOriginalTokens: number
		totalCompressedTokens: number
	} {
		let totalOriginal = 0
		let totalCompressed = 0

		for (const result of this.compressionCache.values()) {
			totalOriginal += result.originalTokens
			totalCompressed += result.compressedTokens
		}

		return {
			size: this.compressionCache.size,
			avgCompressionRatio: totalOriginal > 0 ? totalCompressed / totalOriginal : 1,
			totalOriginalTokens: totalOriginal,
			totalCompressedTokens: totalCompressed,
		}
	}

	// Private methods

	private extractPreservedElements(content: string): {
		codeBlocks: string[]
		inlineCode: string[]
		urls: string[]
		filePaths: string[]
		all: string[]
	} {
		const codeBlocks = this.config.preserveCodeBlocks ? content.match(PATTERNS.codeBlock) || [] : []

		const inlineCode = this.config.preserveCodeBlocks ? content.match(PATTERNS.inlineCode) || [] : []

		const urls = this.config.preserveUrls ? content.match(PATTERNS.url) || [] : []

		const filePaths = this.config.preserveFilePaths ? content.match(PATTERNS.filePath) || [] : []

		return {
			codeBlocks,
			inlineCode,
			urls,
			filePaths,
			all: [...codeBlocks, ...inlineCode, ...urls, ...filePaths],
		}
	}

	private lightCompression(
		content: string,
		preserved: ReturnType<typeof this.extractPreservedElements>,
		removed: string[],
	): string {
		let result = content

		// Remove extra whitespace
		result = result.replace(/\s+/g, " ")

		// Remove redundant phrases
		const redundantPhrases = [
			/\b(I think |I believe |It seems |In my opinion )/gi,
			/\b(basically |essentially |actually |literally )/gi,
			/\b(kind of |sort of |more or less )/gi,
		]

		for (const pattern of redundantPhrases) {
			const matches = result.match(pattern)
			if (matches) {
				removed.push(...matches)
			}
			result = result.replace(pattern, "")
		}

		return result.trim()
	}

	private moderateCompression(
		content: string,
		preserved: ReturnType<typeof this.extractPreservedElements>,
		removed: string[],
	): string {
		// Start with light compression
		let result = this.lightCompression(content, preserved, removed)

		// Placeholder for preserved content
		const preservedMap = new Map<string, string>()
		let placeholderIndex = 0

		// Replace preserved elements with placeholders
		for (const element of preserved.all) {
			const placeholder = `__PRESERVED_${placeholderIndex++}__`
			preservedMap.set(placeholder, element)
			result = result.replace(element, placeholder)
		}

		// Remove some stopwords
		const words = result.split(/\s+/)
		const filteredWords = words.filter((word) => {
			const lowerWord = word.toLowerCase().replace(/[^a-z]/g, "")
			if (STOPWORDS.has(lowerWord) && Math.random() > 0.5) {
				removed.push(word)
				return false
			}
			return true
		})

		result = filteredWords.join(" ")

		// Restore preserved elements
		for (const [placeholder, element] of preservedMap) {
			result = result.replace(placeholder, element)
		}

		return result.trim()
	}

	private aggressiveCompression(
		content: string,
		preserved: ReturnType<typeof this.extractPreservedElements>,
		removed: string[],
	): string {
		// Extract key information only
		const sentences = content.split(/[.!?]+/).filter((s) => s.trim())

		if (sentences.length <= 2) {
			return this.moderateCompression(content, preserved, removed)
		}

		// Score each sentence
		const scoredSentences = sentences.map((sentence) => {
			let score = 0

			// Boost for containing preserved elements
			for (const element of preserved.all) {
				if (sentence.includes(element)) {
					score += 5
				}
			}

			// Boost for containing important keywords
			const importantKeywords = [
				"error",
				"fix",
				"bug",
				"issue",
				"problem",
				"create",
				"modify",
				"delete",
				"update",
				"change",
				"function",
				"class",
				"method",
				"file",
				"module",
				"important",
				"note",
				"warning",
				"todo",
				"fixme",
			]

			for (const keyword of importantKeywords) {
				if (sentence.toLowerCase().includes(keyword)) {
					score += 2
				}
			}

			// Boost for containing code-like patterns
			if (PATTERNS.functionCall.test(sentence)) score += 3
			if (PATTERNS.className.test(sentence)) score += 2

			return { sentence, score }
		})

		// Sort by score and take top half
		scoredSentences.sort((a, b) => b.score - a.score)
		const keepCount = Math.max(2, Math.ceil(sentences.length * 0.4))
		const keptSentences = scoredSentences.slice(0, keepCount)

		// Track removed sentences
		const removedSentences = scoredSentences.slice(keepCount)
		removed.push(...removedSentences.map((s) => s.sentence))

		// Restore original order
		const orderedKept = keptSentences.sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence))

		return orderedKept.map((s) => s.sentence.trim()).join(". ") + "."
	}

	private createResult(
		id: string,
		original: string,
		compressed: string,
		level: CompressionLevel,
		preserved: string[],
		removed: string[],
	): CompressedContent {
		const originalTokens = this.estimateTokens(original)
		const compressedTokens = this.estimateTokens(compressed)

		return {
			id,
			originalContent: original,
			compressedContent: compressed,
			compressionLevel: level,
			originalTokens,
			compressedTokens,
			compressionRatio: originalTokens > 0 ? compressedTokens / originalTokens : 1,
			preservedElements: preserved,
			removedElements: removed,
		}
	}

	private estimateTokens(text: string): number {
		// Simple estimation: ~4 characters per token
		return Math.ceil(text.length / 4)
	}

	private generateId(content: string): string {
		// Simple hash based on content
		let hash = 0
		for (let i = 0; i < Math.min(content.length, 100); i++) {
			hash = (hash << 5) - hash + content.charCodeAt(i)
			hash = hash & hash
		}
		return `comp_${Math.abs(hash).toString(36)}`
	}
}

// Singleton instance
let compressorInstance: SemanticCompressor | null = null

export function getSemanticCompressor(config?: Partial<SemanticCompressorConfig>): SemanticCompressor {
	if (!compressorInstance) {
		compressorInstance = new SemanticCompressor(config)
	}
	return compressorInstance
}

export function resetSemanticCompressor(): void {
	compressorInstance = null
}
