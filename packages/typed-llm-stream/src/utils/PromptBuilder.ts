import { LLMPromptSection, LLMToolContext } from "../core/functional-types.js"

export class PromptBuilder {
	private sections: LLMPromptSection[] = []
	private context: LLMToolContext = {}

	constructor(context: LLMToolContext = {}) {
		this.context = context
	}

	addSection(section: LLMPromptSection): this {
		this.sections.push(section)
		return this
	}

	addSections(sections: LLMPromptSection[]): this {
		this.sections.push(...sections)
		return this
	}

	setContext(context: LLMToolContext): this {
		this.context = { ...this.context, ...context }
		return this
	}

	build(template?: { prefix?: string; suffix?: string; separator?: string; numbering?: boolean }): string {
		const { prefix = "", suffix = "", separator = "\n\n", numbering = true } = template || {}

		const sortedSections = [...this.sections].sort((a, b) => a.order - b.order)

		let prompt = prefix

		sortedSections.forEach((section, index) => {
			if (numbering) {
				prompt += `${index + 1}. ${section.content}${separator}`
			} else {
				prompt += `${section.content}${separator}`
			}
		})

		prompt += suffix

		return prompt.trim()
	}

	clear(): this {
		this.sections = []
		return this
	}

	getSections(): LLMPromptSection[] {
		return [...this.sections]
	}

	static contextualReplace(template: string, context: LLMToolContext): string {
		return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
			return context[key]?.toString() || match
		})
	}

	static validateXMLStructure(xmlString: string): boolean {
		try {
			// Basic XML validation for LLM responses - you might want to use a proper XML validator
			const openTags = xmlString.match(/<[^\/!][^>]*>/g) || []
			const closeTags = xmlString.match(/<\/[^>]+>/g) || []

			return openTags.length === closeTags.length
		} catch {
			return false
		}
	}

	// LLM-specific utility methods
	static optimizeForLLM(
		prompt: string,
		options?: {
			maxTokens?: number
			model?: string
			temperature?: number
		},
	): string {
		let optimized = prompt

		// Add model-specific optimizations
		if (options?.model?.includes("gpt")) {
			optimized = `${optimized}\n\nPlease respond with well-formed XML as specified above.`
		} else if (options?.model?.includes("claude")) {
			optimized = `${optimized}\n\nUse the exact XML format shown in the examples.`
		}

		return optimized
	}
}
