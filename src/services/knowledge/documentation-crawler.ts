// kilocode_change - new file

import { DocumentationSource, DocumentationChunk, ScrapingConfig, CrawlerProgress } from "./types"
import { HtmlToMarkdownConverter } from "./html-to-markdown"
import { EventEmitter } from "events"

export interface CrawlerOptions {
	config: ScrapingConfig
	onProgress?: (progress: CrawlerProgress) => void
	onChunkProcessed?: (chunk: DocumentationChunk) => void
}

export class DocumentationCrawler extends EventEmitter {
	private converter: HtmlToMarkdownConverter
	private config: ScrapingConfig
	private processedUrls: Set<string> = new Set()
	private queue: Array<{ url: string; depth: number; sourceId: string }> = []
	private isProcessing = false
	private rateLimitDelay = 0

	constructor(options: CrawlerOptions) {
		super()
		this.config = options.config
		this.converter = new HtmlToMarkdownConverter()
		this.rateLimitDelay = this.config.rateLimitMs || 1000
	}

	/**
	 * Start crawling a documentation source
	 */
	async crawlSource(source: DocumentationSource): Promise<DocumentationChunk[]> {
		console.log(`[DocumentationCrawler] Starting crawl for source: ${source.name}`)

		const chunks: DocumentationChunk[] = []
		const progress: CrawlerProgress = {
			sourceId: source.id,
			status: "pending",
			progress: 0,
			totalPages: 0,
			processedPages: 0,
			errors: [],
			startTime: new Date(),
		}

		try {
			if (source.type === "url") {
				progress.status = "crawling"
				this.emitProgress(progress)

				// Reset state for new crawl
				this.processedUrls.clear()
				this.queue = [{ url: source.source, depth: 0, sourceId: source.id }]
				progress.totalPages = 1 // Will be updated as we discover more pages

				const sourceChunks = await this.crawlUrl(source, progress)
				chunks.push(...sourceChunks)
			} else if (source.type === "local_file") {
				progress.status = "processing"
				this.emitProgress(progress)

				const fileChunks = await this.processLocalFile(source, progress)
				chunks.push(...fileChunks)
			} else if (source.type === "pdf") {
				progress.status = "processing"
				this.emitProgress(progress)

				const pdfChunks = await this.processPdfFile(source, progress)
				chunks.push(...pdfChunks)
			}

			progress.status = "completed"
			progress.progress = 100
			this.emitProgress(progress)

			console.log(`[DocumentationCrawler] Completed crawl for ${source.name}: ${chunks.length} chunks`)
			return chunks
		} catch (error) {
			progress.status = "failed"
			progress.errors.push(error instanceof Error ? error.message : String(error))
			this.emitProgress(progress)

			console.error(`[DocumentationCrawler] Failed to crawl ${source.name}:`, error)
			throw error
		}
	}

	/**
	 * Crawl a URL and its linked pages
	 */
	private async crawlUrl(source: DocumentationSource, progress: CrawlerProgress): Promise<DocumentationChunk[]> {
		const chunks: DocumentationChunk[] = []

		while (this.queue.length > 0 && !this.isProcessing) {
			const { url, depth, sourceId } = this.queue.shift()!

			// Skip if already processed or depth exceeded
			if (this.processedUrls.has(url) || depth > this.config.maxDepth) {
				continue
			}

			this.processedUrls.add(url)
			progress.processedPages++
			progress.progress = Math.round((progress.processedPages / progress.totalPages) * 100)
			this.emitProgress(progress)

			try {
				// Rate limiting
				if (this.rateLimitDelay > 0) {
					await this.delay(this.rateLimitDelay)
				}

				// Fetch and process the page
				const response = await fetch(url, {
					headers: {
						"User-Agent": this.config.userAgent || "KiloCode-DocsCrawler/1.0",
					},
				})

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`)
				}

				const contentType = response.headers.get("content-type") || ""
				if (!contentType.includes("text/html")) {
					console.log(`[DocumentationCrawler] Skipping non-HTML content: ${contentType}`)
					continue
				}

				const html = await response.text()
				const markdown = await this.converter.convert(html, url)

				// Split into chunks
				const pageChunks = this.chunkMarkdown(markdown, sourceId, url, source.metadata)
				chunks.push(...pageChunks)

				// Extract and queue linked pages if enabled and within depth limit
				if (this.config.followExternalLinks && depth < this.config.maxDepth) {
					const linkedUrls = this.extractLinks(html, url)
					for (const linkedUrl of linkedUrls) {
						if (!this.processedUrls.has(linkedUrl) && this.shouldCrawlUrl(linkedUrl)) {
							this.queue.push({ url: linkedUrl, depth: depth + 1, sourceId })
							progress.totalPages++
						}
					}
				}
			} catch (error) {
				const errorMsg = `Failed to process ${url}: ${error instanceof Error ? error.message : String(error)}`
				progress.errors.push(errorMsg)
				console.warn(`[DocumentationCrawler] ${errorMsg}`)
			}
		}

		return chunks
	}

	/**
	 * Process a local markdown file
	 */
	private async processLocalFile(
		source: DocumentationSource,
		progress: CrawlerProgress,
	): Promise<DocumentationChunk[]> {
		const fs = await import("fs/promises")
		const path = await import("path")

		try {
			const content = await fs.readFile(source.source, "utf-8")
			const extension = path.extname(source.source).toLowerCase()

			let markdown = content
			if (extension === ".html" || extension === ".htm") {
				// Convert HTML to markdown
				markdown = await this.converter.convert(content, `file://${source.source}`)
			}

			progress.totalPages = 1
			progress.processedPages = 1
			progress.progress = 100

			const chunks = this.chunkMarkdown(markdown, source.id, source.source, source.metadata)

			// Update progress
			for (let i = 0; i < chunks.length; i++) {
				chunks[i].metadata.chunkIndex = i
				chunks[i].metadata.totalChunks = chunks.length
				this.emit("chunkProcessed", chunks[i])
			}

			return chunks
		} catch (error) {
			throw new Error(
				`Failed to process local file ${source.source}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Process a PDF file (placeholder implementation)
	 */
	private async processPdfFile(
		source: DocumentationSource,
		progress: CrawlerProgress,
	): Promise<DocumentationChunk[]> {
		// This is a placeholder - PDF processing would require additional libraries
		// like pdf-parse or pdf2pic
		console.warn(`[DocumentationCrawler] PDF processing not yet implemented for: ${source.source}`)

		progress.totalPages = 1
		progress.processedPages = 1
		progress.progress = 100

		return []
	}

	/**
	 * Split markdown content into chunks with sliding window overlap
	 */
	private chunkMarkdown(markdown: string, sourceId: string, sourceUrl: string, metadata: any): DocumentationChunk[] {
		const chunks: DocumentationChunk[] = []
		const maxChunkSize = 2000 // characters
		const overlapSize = 200 // characters for overlap

		// Split by sections first
		const sections = this.splitIntoSections(markdown)

		let currentChunk = ""
		let chunkIndex = 0

		for (const section of sections) {
			// If section is small enough, add to current chunk
			if (currentChunk.length + section.length <= maxChunkSize) {
				currentChunk += (currentChunk ? "\n\n" : "") + section
			} else {
				// Save current chunk if it exists
				if (currentChunk.trim()) {
					chunks.push(
						this.createChunk(currentChunk, sourceId, sourceUrl, metadata, chunkIndex++, sections.length),
					)
				}

				// If section itself is too large, split it
				if (section.length > maxChunkSize) {
					const sectionChunks = this.splitLongText(section, maxChunkSize, overlapSize)
					for (const sectionChunk of sectionChunks) {
						chunks.push(
							this.createChunk(
								sectionChunk,
								sourceId,
								sourceUrl,
								metadata,
								chunkIndex++,
								sections.length,
							),
						)
					}
					currentChunk = ""
				} else {
					currentChunk = section
				}
			}
		}

		// Add the last chunk
		if (currentChunk.trim()) {
			chunks.push(this.createChunk(currentChunk, sourceId, sourceUrl, metadata, chunkIndex++, sections.length))
		}

		return chunks
	}

	/**
	 * Split markdown into logical sections
	 */
	private splitIntoSections(markdown: string): string[] {
		const sections: string[] = []
		const lines = markdown.split("\n")
		let currentSection = ""

		for (const line of lines) {
			// Check if this is a heading
			if (line.match(/^#{1,6}\s/)) {
				// Save previous section if it exists
				if (currentSection.trim()) {
					sections.push(currentSection.trim())
				}
				currentSection = line
			} else {
				currentSection += "\n" + line
			}
		}

		// Add the last section
		if (currentSection.trim()) {
			sections.push(currentSection.trim())
		}

		// If no sections were found, return the whole content
		if (sections.length === 0) {
			sections.push(markdown)
		}

		return sections
	}

	/**
	 * Split long text with overlap
	 */
	private splitLongText(text: string, maxSize: number, overlap: number): string[] {
		const chunks: string[] = []
		let start = 0

		while (start < text.length) {
			let end = start + maxSize

			// Try to break at a sentence boundary
			if (end < text.length) {
				const sentenceEnd = Math.max(
					text.lastIndexOf(".", end),
					text.lastIndexOf("!", end),
					text.lastIndexOf("?", end),
					text.lastIndexOf("\n\n", end),
				)

				if (sentenceEnd > start) {
					end = sentenceEnd + 1
				}
			}

			chunks.push(text.slice(start, end).trim())

			// Move start position with overlap
			start = Math.max(start + 1, end - overlap)
		}

		return chunks
	}

	/**
	 * Create a documentation chunk
	 */
	private createChunk(
		content: string,
		sourceId: string,
		sourceUrl: string,
		metadata: any,
		chunkIndex: number,
		totalChunks: number,
	): DocumentationChunk {
		// Extract title from content
		const titleMatch = content.match(/^#\s+(.+)$/m)
		const title = titleMatch ? titleMatch[1] : undefined

		return {
			id: `${sourceId}-chunk-${chunkIndex}`,
			sourceId,
			content: content.trim(),
			metadata: {
				sourceUrl,
				lastUpdated: new Date(),
				docVersion: metadata.version,
				tags: metadata.tags || [],
				chunkIndex,
				totalChunks,
				title,
				section: this.extractSection(content),
			},
			createdAt: new Date(),
		}
	}

	/**
	 * Extract section information from content
	 */
	private extractSection(content: string): string {
		const lines = content.split("\n")
		for (const line of lines) {
			const match = line.match(/^#{1,6}\s+(.+)$/)
			if (match) {
				return match[1]
			}
		}
		return "Introduction"
	}

	/**
	 * Extract links from HTML content
	 */
	private extractLinks(html: string, baseUrl: string): string[] {
		const links: string[] = []
		const urlPattern = /href=["']([^"']+)["']/gi
		let match

		while ((match = urlPattern.exec(html)) !== null) {
			const url = match[1]

			// Skip anchors, mailto, javascript, etc.
			if (url.startsWith("#") || url.startsWith("mailto:") || url.startsWith("javascript:")) {
				continue
			}

			// Convert relative URLs to absolute
			const absoluteUrl = new URL(url, baseUrl).toString()

			// Check if URL should be crawled
			if (this.shouldCrawlUrl(absoluteUrl)) {
				links.push(absoluteUrl)
			}
		}

		return [...new Set(links)] // Remove duplicates
	}

	/**
	 * Check if a URL should be crawled based on configuration
	 */
	private shouldCrawlUrl(url: URL | string): boolean {
		const urlStr = typeof url === "string" ? url : url.toString()

		try {
			const parsed = new URL(urlStr)

			// Check allowed domains
			if (this.config.allowedDomains.length > 0) {
				const isAllowed = this.config.allowedDomains.some(
					(domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
				)
				if (!isAllowed) return false
			}

			// Check excluded patterns
			for (const pattern of this.config.excludedPatterns) {
				if (urlStr.match(pattern)) {
					return false
				}
			}

			// Check robots.txt if enabled
			if (this.config.respectRobotsTxt) {
				// This would require implementing robots.txt parsing
				// For now, we'll just skip common non-content paths
				if (parsed.pathname.match(/\.(css|js|png|jpg|jpeg|gif|pdf|zip|tar|gz)$/i)) {
					return false
				}
			}

			return true
		} catch {
			return false
		}
	}

	/**
	 * Emit progress update
	 */
	private emitProgress(progress: CrawlerProgress): void {
		this.emit("progress", progress)
	}

	/**
	 * Delay helper for rate limiting
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * Stop the crawling process
	 */
	stop(): void {
		this.isProcessing = true
		this.queue = []
		console.log("[DocumentationCrawler] Crawling stopped")
	}
}
