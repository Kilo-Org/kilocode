//PLANREF: continue/core/autocomplete/templating/index.ts
import Handlebars from "handlebars"
import * as vscode from "vscode"
import { AutocompleteLanguageInfo, getLanguageInfo } from "./AutocompleteLanguageInfo"
import { CodeContext } from "./ContextGatherer"
import { RangeInFileWithContents, RecentlyEditedRange as RecentlyEditedRangeIde } from "./ide-types" // Renamed import to avoid conflict
import { getTemplateForModel } from "./templating/AutocompleteTemplate"
import { getStopTokens as getStopTokensForTemplate } from "./templating/getStopTokens"
import { getUriPathBasename } from "./templating/uri"
import { AutocompleteInput, RecentlyEditedRange as RecentlyEditedRangeCore } from "./types" // Import AutocompleteInput's RecentlyEditedRange
import { HelperVars, TabAutocompleteOptions } from "./utils/HelperVars"
import { IDE, VsCodeIde } from "./utils/ide"

// Corresponds to SnippetPayload in continue/
interface KilocodeSnippetPayload {
	definitions: RangeInFileWithContents[] // Combines rootPathSnippets, importDefinitionSnippets, ideSnippets
	recentlyEditedRanges: RangeInFileWithContents[]
	recentlyVisitedRanges: RangeInFileWithContents[]
	// diffSnippets: AutocompleteDiffSnippet[]; // Not yet implemented
	// clipboardSnippets: AutocompleteClipboardSnippet[]; // Not yet implemented
	imports: string[] // Our existing imports
}

// Simplified version of continue's AutocompleteSnippet for now
// We can expand this if we add more complex snippet types like diff or clipboard
// interface KilocodeAutocompleteSnippet { // This interface is not used yet
// 	filepath: string
// 	content: string
// 	// type: AutocompleteSnippetType; // Not strictly needed if all are code snippets for now
// }

/**
 * Interface for prompt options (remains for constructor, but renderPrompt will use TabAutocompleteOptions via HelperVars)
 */
export interface PromptOptions {
	maxTokens: number
	temperature: number
	language: string // Will be derived from HelperVars.lang
	// includeImports: boolean; // Will be handled by snippet formatting
	// includeDefinitions: boolean; // Will be handled by snippet formatting
	multilineCompletions: boolean | "auto"
	// Options for HelperVars, mirroring TabAutocompleteOptions from continue/
	prefixPercentage: number
	maxSuffixPercentage: number
	onlyMyCode?: boolean
	useRecentlyEdited?: boolean // Maps to experimental_includeRecentlyEditedRanges
	useRecentlyVisited?: boolean // Maps to experimental_includeRecentlyVisitedRanges
	// experimental_includeClipboard: boolean; // Not yet implemented
	// experimental_includeDiff: boolean; // Not yet implemented
	template?: string // Allow overriding template string
}

/**
 * Renders prompts for autocomplete
 */
export class PromptRenderer {
	private defaultOptions: PromptOptions = {
		maxTokens: 2048,
		temperature: 0.2,
		language: "typescript", // Default, will be overridden by actual file language
		multilineCompletions: "auto",
		prefixPercentage: 0.6, // Default from continue/
		maxSuffixPercentage: 0.2, // Default from continue/
		useRecentlyEdited: true,
		useRecentlyVisited: true,
	}
	private modelName: string = "qwen2.5-coder:1.5b" // Default, can be overridden
	private ide: IDE

	/**
	 * Create a new prompt renderer
	 * @param options Prompt options
	 * @param modelName Model name for template selection
	 * @param ide IDE instance
	 */
	constructor(
		options: Partial<PromptOptions> = {},
		modelName: string = "qwen2.5-coder:1.5b",
		ide: IDE = new VsCodeIde(), // Provide a default IDE instance
	) {
		this.defaultOptions = { ...this.defaultOptions, ...options }
		this.modelName = modelName
		this.ide = ide
	}

	private convertCodeContextToSnippetPayload(context: CodeContext): KilocodeSnippetPayload {
		const recentlyEditedRangesMapped: RangeInFileWithContents[] = context.recentlyEdited.ranges.map(
			(r: RecentlyEditedRangeIde): RangeInFileWithContents => ({
				// Use RecentlyEditedRangeIde here
				filepath: r.filepath,
				range: r.range, // Use range from RecentlyEditedRangeIde
				contents: r.contents, // Use contents from RecentlyEditedRangeIde
			}),
		)

		return {
			definitions: context.definitions,
			recentlyEditedRanges: [
				...recentlyEditedRangesMapped,
				...context.recentlyEdited.documents, // These are already RangeInFileWithContents
			],
			recentlyVisitedRanges: context.recentlyVisited,
			imports: context.imports,
		}
	}

	private formatSnippets(
		helper: HelperVars,
		payload: KilocodeSnippetPayload,
		_workspaceDirs: string[], // Mark as unused if not needed immediately
	): string {
		const commentMark = helper.lang.singleLineComment || "//"
		const formattedSnippets: string[] = []

		for (const def of payload.definitions) {
			const relativePath = getUriPathBasename(def.filepath)
			formattedSnippets.push(
				`${commentMark} From ${relativePath}\n${commentMark} ${def.contents.split("\n").join(`\n${commentMark} `)}`, // Use .contents
			)
		}

		if (helper.options.experimental_includeRecentlyEditedRanges) {
			for (const edited of payload.recentlyEditedRanges) {
				const relativePath = getUriPathBasename(edited.filepath)
				formattedSnippets.push(
					`${commentMark} Recently edited ${relativePath}\n${commentMark} ${edited.contents.split("\n").join(`\n${commentMark} `)}`, // Use .contents
				)
			}
		}

		if (helper.options.experimental_includeRecentlyVisitedRanges) {
			for (const visited of payload.recentlyVisitedRanges) {
				const relativePath = getUriPathBasename(visited.filepath)
				formattedSnippets.push(
					`${commentMark} Recently visited ${relativePath}\n${commentMark} ${visited.contents.split("\n").join(`\n${commentMark} `)}`, // Use .contents
				)
			}
		}

		if (payload.imports.length > 0) {
			formattedSnippets.unshift(
				`${commentMark} Imports:\n${payload.imports.map((imp) => `${commentMark} ${imp}`).join("\n")}`,
			)
		}

		const caretWindow = helper.prunedCaretWindow
		const finalSnippets = formattedSnippets.filter(
			(s) =>
				!caretWindow.includes(
					s
						.split("\n")
						.slice(1)
						.join("\n")
						.replace(new RegExp(`^${commentMark} `, "gm"), ""),
				),
		)

		if (finalSnippets.length === 0) {
			return ""
		}
		const currentFilepathComment = `${commentMark} Current file: ${getUriPathBasename(helper.filepath)}`
		return `${finalSnippets.join("\n\n")}\n\n${currentFilepathComment}\n\n`
	}

	private renderStringTemplate(
		templateString: string,
		prefix: string,
		suffix: string,
		lang: AutocompleteLanguageInfo,
		filepath: string,
		reponame: string,
	): string {
		const filename = getUriPathBasename(filepath)
		const compiledTemplate = Handlebars.compile(templateString)

		return compiledTemplate({
			prefix,
			suffix,
			filename,
			reponame,
			language: lang.name,
		})
	}

	async renderPrompt(
		document: vscode.TextDocument,
		position: vscode.Position, // This is already a vscode.Position
		codeContext: CodeContext,
		promptOptions: Partial<PromptOptions> = {},
	): Promise<string> {
		const mergedPromptOptions = { ...this.defaultOptions, ...promptOptions }

		// AutocompleteInput expects vscode.Position directly for `pos`
		// and its own RecentlyEditedRange definition for `recentlyEditedRanges`
		const autocompleteInput: AutocompleteInput = {
			filepath: document.uri.fsPath,
			pos: position, // Use vscode.Position directly from 'vscode'
			manuallyPassFileContents: document.getText(),
			isUntitledFile: document.isUntitled,
			completionId: vscode.env.sessionId + Date.now().toString(), // Create a unique ID
			recentlyEditedRanges: codeContext.recentlyEdited.ranges.map(
				(r: RecentlyEditedRangeIde): RecentlyEditedRangeCore => ({
					filepath: r.filepath,
					range: r.range,
					timestamp: r.timestamp,
					lines: r.contents.split("\n"),
					symbols: new Set<string>(),
				}),
			),
			// AutocompleteInput.recentlyVisitedRanges expects unknown[]
			// Our CodeContext.recentlyVisited is RangeInFileWithContents[]
			// For now, pass as is, as `unknown[]` can accept this.
			// If specific processing is needed later, this can be adjusted.
			recentlyVisitedRanges: codeContext.recentlyVisited,
		}

		const tabAutocompleteOptions: TabAutocompleteOptions = {
			maxPromptTokens: mergedPromptOptions.maxTokens,
			prefixPercentage: mergedPromptOptions.prefixPercentage,
			maxSuffixPercentage: mergedPromptOptions.maxSuffixPercentage,
			onlyMyCode: mergedPromptOptions.onlyMyCode,
			experimental_includeRecentlyEditedRanges: mergedPromptOptions.useRecentlyEdited ?? true,
			experimental_includeRecentlyVisitedRanges: mergedPromptOptions.useRecentlyVisited ?? true,
			experimental_includeClipboard: false,
			experimental_includeDiff: false,
			template: mergedPromptOptions.template,
		}

		const helper = await HelperVars.create(autocompleteInput, tabAutocompleteOptions, this.modelName, this.ide)
		const snippetPayload = this.convertCodeContextToSnippetPayload(codeContext)
		const workspaceDirs = await this.ide.getWorkspaceDirs()
		const templateDef = getTemplateForModel(this.modelName)

		let prefix = helper.prunedPrefix
		let suffix = helper.prunedSuffix
		if (suffix.trim() === "") {
			suffix = "\n"
		}

		const reponame = getUriPathBasename(workspaceDirs[0] ?? "myproject")
		const formattedSnippets = this.formatSnippets(helper, snippetPayload, workspaceDirs)

		if (formattedSnippets) {
			prefix = `${formattedSnippets}${prefix}`
		}

		if (templateDef.compilePrefixSuffix) {
			;[prefix, suffix] = templateDef.compilePrefixSuffix(
				prefix,
				suffix,
				helper.filepath,
				reponame,
				helper.workspaceUris,
				// Pass empty array for snippets as our current AutocompleteTemplate doesn't expect it
				// and formatSnippets already prepends.
			)
		}

		let prompt: string
		if (typeof templateDef.template === "string") {
			prompt = this.renderStringTemplate(
				templateDef.template,
				prefix,
				suffix,
				helper.lang,
				helper.filepath,
				reponame,
			)
		} else {
			// Adjust to match our AutocompleteTemplate function signature (6 args)
			prompt = templateDef.template(
				prefix,
				suffix,
				helper.filepath,
				reponame,
				helper.lang.name,
				helper.workspaceUris,
				// The 6th argument in our AutocompleteTemplate is workspaceUris.
				// The `snippets` argument from `continue` is not present in our current definition.
			)
		}

		return prompt
	}

	renderSystemPrompt(): string {
		return `You are an AI coding assistant that provides accurate and helpful code completions.
Your task is to complete the code at the cursor position.
Provide only the completion text, without any explanations or markdown formatting.
The completion should be valid, syntactically correct code that fits the context.`
	}

	getStopTokens(): string[] {
		const template = getTemplateForModel(this.modelName)
		const langInfo = getLanguageInfo(this.defaultOptions.language) // Use language from defaultOptions for now
		// Use the renamed getStopTokensForTemplate
		return getStopTokensForTemplate(template.completionOptions, langInfo, this.modelName)
	}

	/**
	 * Extract completion from model response
	 * @param response Model response
	 * @returns Extracted completion
	 */
	extractCompletion(response: string): string {
		// Remove any markdown code block formatting
		let completion = response.trim()

		// Remove markdown code blocks if present
		const codeBlockRegex = /^```[\w]*\n([\s\S]*?)\n```$/
		const match = completion.match(codeBlockRegex)
		if (match) {
			completion = match[1]
		}

		// Remove any explanations or comments that might be at the beginning
		const lines = completion.split("\n")
		let startIndex = 0

		for (let i = 0; i < lines.length; i++) {
			if (
				lines[i].trim().startsWith("//") ||
				lines[i].trim().startsWith("#") ||
				lines[i].trim().startsWith("/*")
			) {
				startIndex = i + 1
			} else if (lines[i].trim() !== "") {
				break
			}
		}

		completion = lines.slice(startIndex).join("\n")

		return completion
	}
}
