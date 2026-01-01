// kilocode_change - new file

import { JSDOM } from "jsdom"
import { HtmlToMarkdownOptions } from "./types"

export class HtmlToMarkdownConverter {
	private options: HtmlToMarkdownOptions

	constructor(options: Partial<HtmlToMarkdownOptions> = {}) {
		this.options = {
			preserveLinks: true,
			preserveImages: false, // Skip images for documentation
			preserveCodeBlocks: true,
			removeSelectors: [
				"nav",
				"header",
				"footer",
				"aside",
				".sidebar",
				".navigation",
				".menu",
				".ads",
				".advertisement",
				"script",
				"style",
				".cookie-banner",
				".popup",
			],
			headingStrategy: "simplify",
			...options,
		}
	}

	/**
	 * Convert HTML content to clean Markdown optimized for LLM consumption
	 */
	async convert(html: string, baseUrl?: string): Promise<string> {
		const dom = new JSDOM(html, { url: baseUrl })
		const document = dom.window.document

		// Remove unwanted elements
		this.removeUnwantedElements(document)

		// Process content
		let markdown = ""

		// Extract title if present
		const title = this.extractTitle(document)
		if (title) {
			markdown += `# ${title}\n\n`
		}

		// Process body content
		const body = document.body || document.documentElement
		markdown += this.processNode(body)

		// Clean up markdown
		return this.cleanupMarkdown(markdown)
	}

	/**
	 * Remove unwanted elements from the DOM
	 */
	private removeUnwantedElements(document: Document): void {
		for (const selector of this.options.removeSelectors) {
			const elements = document.querySelectorAll(selector)
			elements.forEach((el) => el.remove())
		}
	}

	/**
	 * Extract the main title from the document
	 */
	private extractTitle(document: Document): string | null {
		// Try various title selectors
		const titleSelectors = ["h1", "title", ".title", ".page-title", "[data-title]", ".main-title"]

		for (const selector of titleSelectors) {
			const element = document.querySelector(selector)
			if (element && element.textContent?.trim()) {
				return element.textContent.trim()
			}
		}

		return null
	}

	/**
	 * Process a DOM node and convert to markdown
	 */
	private processNode(node: Node): string {
		if (node.nodeType === 3) {
			// Text node
			return node.textContent || ""
		}

		if (node.nodeType !== 1) {
			// Not an element
			return ""
		}

		const element = node as Element
		const tagName = element.tagName.toLowerCase()

		switch (tagName) {
			case "h1":
				return `\n# ${this.processInlineContent(element)}\n\n`

			case "h2":
				return `\n## ${this.processInlineContent(element)}\n\n`

			case "h3":
				return `\n### ${this.processInlineContent(element)}\n\n`

			case "h4":
				return `\n#### ${this.processInlineContent(element)}\n\n`

			case "h5":
				return `\n##### ${this.processInlineContent(element)}\n\n`

			case "h6":
				return `\n###### ${this.processInlineContent(element)}\n\n`

			case "p":
				return `${this.processInlineContent(element)}\n\n`

			case "ul":
				return `${this.processList(element, "ul")}\n`

			case "ol":
				return `${this.processList(element, "ol")}\n`

			case "li":
				return this.processListItem(element)

			case "pre":
				if (this.options.preserveCodeBlocks) {
					const code = element.textContent || ""
					const language = this.detectCodeLanguage(element)
					return `\n\`\`\`${language}\n${code}\n\`\`\`\n\n`
				}
				return ""

			case "code":
				if (this.options.preserveCodeBlocks && !element.closest("pre")) {
					return `\`${element.textContent}\``
				}
				return element.textContent || ""

			case "blockquote":
				return `\n> ${this.processInlineContent(element).replace(/\n/g, "\n> ")}\n\n`

			case "strong":
			case "b":
				return `**${this.processInlineContent(element)}**`

			case "em":
			case "i":
				return `*${this.processInlineContent(element)}*`

			case "a":
				return this.processLink(element)

			case "img":
				return this.options.preserveImages ? this.processImage(element) : ""

			case "table":
				return this.processTable(element)

			case "div":
			case "section":
			case "article":
			case "main":
				// Process container elements
				return this.processChildren(element)

			case "br":
				return "\n"

			default:
				// Skip unknown tags but process their children
				return this.processChildren(element)
		}
	}

	/**
	 * Process inline content of an element
	 */
	private processInlineContent(element: Element): string {
		let content = ""
		for (const child of element.childNodes) {
			content += this.processNode(child)
		}
		return content.trim()
	}

	/**
	 * Process children of an element
	 */
	private processChildren(element: Element): string {
		let content = ""
		for (const child of element.childNodes) {
			content += this.processNode(child)
		}
		return content
	}

	/**
	 * Process list elements
	 */
	private processList(element: Element, type: "ul" | "ol"): string {
		let content = ""
		const items = element.querySelectorAll("li")

		items.forEach((item, index) => {
			const prefix = type === "ul" ? "- " : `${index + 1}. `
			const itemContent = this.processInlineContent(item)
			content += `${prefix}${itemContent}\n`
		})

		return `\n${content}\n`
	}

	/**
	 * Process list item
	 */
	private processListItem(element: Element): string {
		return `${this.processInlineContent(element)}\n`
	}

	/**
	 * Process link elements
	 */
	private processLink(element: Element): string {
		const href = element.getAttribute("href")
		const text = this.processInlineContent(element)

		if (!href) return text

		if (this.options.preserveLinks) {
			return `[${text}](${href})`
		}

		return text
	}

	/**
	 * Process image elements
	 */
	private processImage(element: Element): string {
		const src = element.getAttribute("src")
		const alt = element.getAttribute("alt") || ""

		if (!src) return ""

		return `![${alt}](${src})`
	}

	/**
	 * Process table elements
	 */
	private processTable(element: Element): string {
		const rows = element.querySelectorAll("tr")
		if (rows.length === 0) return ""

		let table = ""
		let isFirstRow = true

		rows.forEach((row) => {
			const cells = row.querySelectorAll("td, th")
			const rowData = Array.from(cells).map((cell) => this.processInlineContent(cell).trim())

			table += `| ${rowData.join(" | ")} |\n`

			if (isFirstRow) {
				const separator = "| " + rowData.map(() => "---").join(" | ") + " |\n"
				table += separator
				isFirstRow = false
			}
		})

		return `\n${table}\n`
	}

	/**
	 * Detect code language from code element
	 */
	private detectCodeLanguage(element: Element): string {
		// Check for language indicators
		const classList = element.className
		const languageMatch = classList.match(/language-(\w+)/)
		if (languageMatch) return languageMatch[1]

		// Check parent pre element
		const pre = element.closest("pre")
		if (pre) {
			const preClass = pre.className
			const preMatch = preClass.match(/language-(\w+)/)
			if (preMatch) return preMatch[1]
		}

		return ""
	}

	/**
	 * Clean up the generated markdown
	 */
	private cleanupMarkdown(markdown: string): string {
		return (
			markdown
				// Remove excessive blank lines
				.replace(/\n{3,}/g, "\n\n")
				// Clean up whitespace around headings
				.replace(/\n{2,}#/g, "\n#")
				// Remove leading/trailing whitespace
				.trim()
		)
	}
}
