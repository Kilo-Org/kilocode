// kilocode_change - new file

import type { ReflectionPrompt } from "./types"

export class ReflectionPromptManager {
	private prompts: Map<string, ReflectionPrompt> = new Map()

	constructor(private defaultTemplates: Record<string, string>) {}

	createPrompt(id: string, template: string, context: Record<string, unknown> = {}): ReflectionPrompt {
		const variables = this.extractVariables(template)
		const prompt: ReflectionPrompt = {
			id,
			template,
			context,
			variables,
		}
		this.prompts.set(id, prompt)
		return prompt
	}

	getPrompt(id: string): ReflectionPrompt | undefined {
		return this.prompts.get(id)
	}

	updatePrompt(id: string, updates: Partial<ReflectionPrompt>): boolean {
		const prompt = this.prompts.get(id)
		if (!prompt) return false

		if (updates.template) {
			updates.variables = this.extractVariables(updates.template)
		}

		Object.assign(prompt, updates)
		this.prompts.set(id, prompt)
		return true
	}

	renderPrompt(id: string, additionalContext?: Record<string, unknown>): string | null {
		const prompt = this.prompts.get(id)
		if (!prompt) return null

		const context = { ...prompt.context, ...additionalContext }
		let rendered = prompt.template

		for (const variable of prompt.variables) {
			const value = context[variable]
			if (value !== undefined) {
				rendered = rendered.replace(new RegExp(`\\{\\{${variable}\\}\\}`, "g"), String(value))
			}
		}

		return rendered
	}

	validatePrompt(id: string): { valid: boolean; missingVariables: string[] } {
		const prompt = this.prompts.get(id)
		if (!prompt) {
			return { valid: false, missingVariables: [] }
		}

		const missingVariables: string[] = []
		for (const variable of prompt.variables) {
			if (!(variable in prompt.context)) {
				missingVariables.push(variable)
			}
		}

		return {
			valid: missingVariables.length === 0,
			missingVariables,
		}
	}

	private extractVariables(template: string): string[] {
		const matches = template.match(/\{\{(\w+)\}\}/g)
		if (!matches) return []

		return matches
			.map((match) => match.slice(2, -2))
			.filter((variable, index, array) => array.indexOf(variable) === index)
	}

	getDefaultPrompt(type: string): ReflectionPrompt | null {
		const template = this.defaultTemplates[type]
		if (!template) return null

		return this.createPrompt(`default-${type}`, template)
	}

	listPrompts(): ReflectionPrompt[] {
		return Array.from(this.prompts.values())
	}

	deletePrompt(id: string): boolean {
		return this.prompts.delete(id)
	}

	clearPrompts(): void {
		this.prompts.clear()
	}
}

// Default reflection templates
export const DEFAULT_REFLECTION_TEMPLATES: Record<string, string> = {
	observation: "Based on the observation: {{observation}}, what insights can we derive?",
	error: "The following error occurred: {{error}}. What should be our next approach?",
	decision: "Given the context: {{context}} and options: {{options}}, what is the optimal decision?",
	progress: "Current progress: {{progress}}. What adjustments should be made to our strategy?",
	learning: "From the experience: {{experience}}, what key lessons have we learned?",
}
