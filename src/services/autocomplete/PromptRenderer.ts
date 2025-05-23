// AIDIFF: Integrating continue/ templating logic
// PLANREF: continue/core/autocomplete/templating/index.ts
import { CodeContext } from "./ContextGatherer" // Removed CodeContextDefinition
import { AutocompleteTemplate, getTemplateForModel } from "./templating/AutocompleteTemplate" // AIDIFF: AutocompleteTemplate is used by getTemplateForModel
import { getStopTokens } from "./templating/getStopTokens"
import * as vscode from "vscode"
import { AutocompleteLanguageInfo, getLanguageInfo } from "./AutocompleteLanguageInfo" // AIDIFF: AutocompleteLanguageInfo is used by getLanguageInfo
import {
	AutocompleteSnippet,
	// AIDIFF: Specific snippet types like AutocompleteCodeSnippet are not directly instantiated here after changes,
	// but AutocompleteSnippet union type is used.
} from "./templating/snippetTypes"
import { getUriPathBasename } from "./templating/uri"
// AIDIFF: Removed Handlebars as it's not used directly in the new approach from continue/
// We will use simple string replacement for string templates, and function calls for function templates.

/**
 * Interface for prompt options
 */
export interface PromptOptions {
	maxTokens: number
	temperature: number
	language: string // AIDIFF: This is the language ID string e.g. "typescript"
	includeImports: boolean
	includeDefinitions: boolean
	multilineCompletions: string | boolean | "auto" // AIDIFF: Allow string to match AutocompleteConfig, "true"/"false" can be parsed if needed.
	stop?: string[]
}

/**
 * Renders prompts for autocomplete
 */
export class PromptRenderer {
	private defaultOptions: PromptOptions = {
		maxTokens: 2048,
		temperature: 0.2,
		language: "typescript",
		includeImports: true,
		includeDefinitions: true,
		multilineCompletions: "auto",
	}
	private modelName: string // AIDIFF: Default model name

	/**
	 * Create a new prompt renderer
	 * @param options Prompt options
	 * @param modelName Model name for template selection
	 */
	constructor(options: Partial<PromptOptions> = {}, modelName: string = "qwen2.5-coder:1.5b") {
		this.defaultOptions = { ...this.defaultOptions, ...options }
		this.modelName = modelName
	}

	/**
	 * Render a prompt for autocomplete using templates based on the model
	 * @param context Code context from ContextGatherer
	 * @param options Prompt options to override defaults
	 * @returns Rendered prompt, prefix, suffix, and completion options for the LLM
	 */
	// PLANREF: Main structure mirrors continue/core/autocomplete/templating/index.ts (renderPrompt function)
	renderPrompt(
		context: CodeContext,
		snippets: AutocompleteSnippet[], // Added snippets parameter
		options: Partial<PromptOptions> = {},
	): {
		prompt: string
		prefix: string // The prefix text used in the FIM template
		suffix: string // The suffix text used in the FIM template
		completionOptions: Partial<PromptOptions> | undefined // Options to pass to the LLM API
	} {
		const mergedOptions = { ...this.defaultOptions, ...options }
		const langInfo: AutocompleteLanguageInfo = getLanguageInfo(mergedOptions.language)

		const currentTemplate: AutocompleteTemplate = getTemplateForModel(this.modelName)

		let prefix = ""
		if (context.precedingLines.length > 0) {
			prefix += `${context.precedingLines.join("\n")}\n`
		}
		prefix += context.currentLine

		let suffix = ""
		if (context.followingLines.length > 0) {
			suffix = `\n${context.followingLines.join("\n")}`
		}
		// PLANREF: continue/core/autocomplete/templating/index.ts ensures suffix is at least a newline
		if (suffix === "") {
			suffix = "\n"
		}

		const filepath = vscode.window.activeTextEditor?.document.uri.toString() || "file:///Untitled.txt" //WTF fallback?
		const workspaceFolders = vscode.workspace.workspaceFolders
		const reponame = workspaceFolders?.[0]?.uri.fsPath
			? getUriPathBasename(workspaceFolders[0].uri.fsPath)
			: "my-repository" // AIDIFF: Default reponame
		const workspaceUris = workspaceFolders?.map((folder) => folder.uri.toString()) || []

		// PLANREF: continue/core/autocomplete/templating/index.ts (compilePrefixSuffix logic)
		if (currentTemplate.compilePrefixSuffix) {
			;[prefix, suffix] = currentTemplate.compilePrefixSuffix(
				prefix,
				suffix,
				filepath,
				reponame,
				snippets,
				workspaceUris,
			)
		} else {
			// PLANREF: continue/core/autocomplete/templating/formatting.ts (formatSnippets - simplified adaptation)
			// AIDIFF: If no compilePrefixSuffix, prepend formatted snippets to the prefix.
			let formattedSnippetsContent = ""
			if (snippets.length > 0) {
				formattedSnippetsContent = snippets
					.map((snippet) => {
						let header = ""
						// AIDIFF: Provide a generic header for snippets if a filepath is available.
						// PLANREF: Inspired by formatCodeSnippet in continue/core/autocomplete/templating/formatting.ts
						if ("filepath" in snippet && snippet.filepath) {
							header = `// Path: ${getUriPathBasename(snippet.filepath)}\n`
						}
						return `${header}${snippet.content}`
					})
					.join("\n\n") // AIDIFF: Using \n\n for better separation of snippets.
			}

			if (formattedSnippetsContent) {
				// PLANREF: continue/core/autocomplete/templating/index.ts (prefix = [formattedSnippets, prefix].join("\n");)
				// AIDIFF: Adapted to use \n\n for clearer separation.
				prefix = `${formattedSnippetsContent}\n\n${prefix}`
			}
		}

		let prompt: string
		// PLANREF: continue/core/autocomplete/templating/index.ts (template rendering logic)
		if (typeof currentTemplate.template === "string") {
			// PLANREF: continue/core/autocomplete/templating/index.ts (renderStringTemplate)
			// AIDIFF: Using simple string replacement instead of Handlebars.
			prompt = currentTemplate.template
				.replace("{{{prefix}}}", prefix)
				.replace("{{{suffix}}}", suffix)
				.replace("{{{filename}}}", getUriPathBasename(filepath))
				.replace("{{{reponame}}}", reponame)
				.replace("{{{language}}}", langInfo.name)
		} else {
			// AIDIFF: Calling the template function with all required arguments.
			prompt = currentTemplate.template(
				prefix,
				suffix,
				filepath,
				reponame,
				langInfo.name, // language name string
				snippets,
				workspaceUris,
			)
		}

		// PLANREF: continue/core/autocomplete/templating/index.ts (getStopTokens call)
		const stop = getStopTokens(currentTemplate.completionOptions, langInfo, this.modelName)

		return {
			prompt,
			prefix,
			suffix,
			completionOptions: {
				...currentTemplate.completionOptions,
				stop, // AIDIFF: Determined stop tokens
				// AIDIFF: Pass through common options from mergedOptions
				maxTokens: mergedOptions.maxTokens,
				temperature: mergedOptions.temperature,
				// Other options like topP, topK could be added if supported by PromptOptions and LLM
			},
		}
	}

	/**
	 * Render a system prompt for autocomplete. This is specific to our implementation.
	 * @returns System prompt string
	 */
	renderSystemPrompt(): string {
		// AIDIFF: This system prompt is a generic one. Specific models might have their own system prompt requirements.
		// For now, this is kept as a general instruction.
		return `You are an AI coding assistant that provides accurate and helpful code completions.
Your task is to complete the code at the cursor position.
Provide only the completion text, without any explanations or markdown formatting.
The completion should be valid, syntactically correct code that fits the context.`
	}

	/**
	 * Get the stop tokens for the current model.
	 * This method can be used if only stop tokens are needed without full prompt rendering.
	 * @returns Array of stop tokens
	 */
	getStopTokens(): string[] {
		// AIDIFF: This method directly uses the getStopTokens utility from the templating folder.
		// It ensures consistency if stop tokens are needed separately from the full renderPrompt call.
		const template = getTemplateForModel(this.modelName)
		const langInfo = getLanguageInfo(this.defaultOptions.language)
		return getStopTokens(template.completionOptions, langInfo, this.modelName)
	}

	/**
	 * Extract completion from model response. This is specific to our implementation.
	 * @param response Model response string
	 * @returns Extracted completion string
	 */
	extractCompletion(response: string): string {
		// AIDIFF: Basic extraction logic. May need refinement based on typical model outputs.
		let completion = response.trim()

		// Remove markdown code blocks if present (e.g., ```typescript\n...\n```)
		const codeBlockRegex = /^```[\w]*\n([\s\S]*?)\n```$/
		const match = completion.match(codeBlockRegex)
		if (match) {
			completion = match[1].trim() // AIDIFF: Trim content inside code block as well
		}

		// AIDIFF: Removed the loop that stripped leading comments as it might be too aggressive.
		// Models are generally instructed to provide only code. If they still add comments,
		// it might be part of the intended completion or require more sophisticated stripping.
		// Keeping it simple for now.

		return completion
	}
}
