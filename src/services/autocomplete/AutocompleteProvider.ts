import * as vscode from "vscode"
import { buildApiHandler } from "../../api"
import { CodeContext, ContextGatherer } from "./ContextGatherer"
import { holeFillerTemplate } from "./templating/AutocompleteTemplate"
import { ContextProxy } from "../../core/config/ContextProxy"
import { generateImportSnippets, generateDefinitionSnippets } from "./context/snippetProvider"
import { LRUCache } from "lru-cache"
import { createDebouncedFn } from "./utils/createDebouncedFn"
import { AutocompleteDecorationAnimation } from "./AutocompleteDecorationAnimation"

export const UI_UPDATE_DEBOUNCE_MS = 250
export const BAIL_OUT_TOO_MANY_LINES_LIMIT = 100
export const MAX_COMPLETIONS_PER_CONTEXT = 5 // Per-given prefix/suffix lines, how many different per-line options to cache

// const DEFAULT_MODEL = "mistralai/codestral-2501"
const DEFAULT_MODEL = "google/gemini-2.5-flash-preview-05-20"

export function registerAutocomplete(context: vscode.ExtensionContext) {
	try {
		setupAutocomplete(context)
		console.log("🚀🛑 Kilo Code autocomplete provider registered")
	} catch (error) {
		console.error("🚀🛑 Failed to register autocomplete provider:", error)
	}
}

export function processModelResponse(responseText: string): string {
	const fullMatch = /(<COMPLETION>)?([\s\S]*?)(<\/COMPLETION>|$)/.exec(responseText)
	if (!fullMatch) {
		return responseText
	}
	if (fullMatch[2].endsWith("</COMPLETION>")) {
		return fullMatch[2].slice(0, -"</COMPLETION>".length)
	}
	return fullMatch[2]
}

/**
 * Generates a cache key based on context's preceding and following lines
 * This is used to identify when we can reuse a previous completion
 */
function generateCacheKey({ precedingLines, followingLines }: CodeContext): string {
	const maxLinesToConsider = 5
	const precedingContext = precedingLines.slice(-maxLinesToConsider).join("\n")
	const followingContext = followingLines.slice(0, maxLinesToConsider).join("\n")
	return `${precedingContext}|||${followingContext}`
}

function setupAutocomplete(context: vscode.ExtensionContext) {
	// State
	let enabled = true
	let activeRequestId: string | null = null
	let isBackspaceOperation = false // Flag to track backspace operations
	let justAcceptedSuggestion = false // Flag to track if a suggestion was just accepted
	let lastCompletionCost = 0 // Track the cost of the last completion
	let totalSessionCost = 0 // Track the total cost of all completions in the session

	// LRU Cache for completions
	const completionsCache = new LRUCache<string, string[]>({
		max: 50,
		ttl: 1000 * 60 * 60 * 24, // Cache for 24 hours
	})

	// Services
	const contextGatherer = new ContextGatherer()
	const animationManager = AutocompleteDecorationAnimation.getInstance()

	const apiHandler = buildApiHandler({
		apiProvider: "kilocode",
		kilocodeToken: ContextProxy.instance.getProviderSettings().kilocodeToken,
		kilocodeModel: DEFAULT_MODEL,
	})

	const clearState = () => {
		vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
		animationManager.stopAnimation()

		isBackspaceOperation = false
		justAcceptedSuggestion = false
		activeRequestId = null
	}

	const generateCompletion = async ({
		codeContext,
		document,
		position,
	}: {
		codeContext: CodeContext
		document: vscode.TextDocument
		position: vscode.Position
	}) => {
		const requestId = crypto.randomUUID()
		activeRequestId = requestId
		animationManager.startAnimation()

		const snippets = [
			...generateImportSnippets(true, codeContext.imports, document.uri.fsPath),
			...generateDefinitionSnippets(true, codeContext.definitions),
		]
		const systemPrompt = holeFillerTemplate.getSystemPrompt()
		const userPrompt = holeFillerTemplate.template(codeContext, document, position, snippets)

		console.log(`🚀🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶\n`, { userPrompt })

		const stream = apiHandler.createMessage(systemPrompt, [
			{ role: "user", content: [{ type: "text", text: userPrompt }] },
		])

		let completion = ""
		let processedCompletion = ""
		let lineCount = 0
		let completionCost = 0

		try {
			for await (const chunk of stream) {
				if (activeRequestId !== requestId) {
					break // This request is no longer active
				}

				if (chunk.type === "text") {
					completion += chunk.text
					processedCompletion = processModelResponse(completion)
					lineCount += processedCompletion.split("/n").length
				} else if (chunk.type === "usage") {
					completionCost = chunk.totalCost ?? 0
				}

				if (lineCount > BAIL_OUT_TOO_MANY_LINES_LIMIT) {
					processedCompletion = ""
					break
				}
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			processedCompletion = ""
		}

		// Update cost tracking variables
		totalSessionCost += completionCost
		lastCompletionCost = completionCost
		console.log(`🚀💰 Completion cost: ${humanFormatCost(completionCost)}`)

		// Update status bar with cost information
		updateStatusBarWithCost(statusBar, lastCompletionCost, totalSessionCost, enabled)

		if (activeRequestId === requestId) {
			animationManager.stopAnimation()
		}

		return { processedCompletion, lineCount, cost: completionCost }
	}

	const debouncedGenerateCompletion = createDebouncedFn(generateCompletion, UI_UPDATE_DEBOUNCE_MS)

	const provider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, context, token) {
			if (!enabled || !vscode.window.activeTextEditor) return null

			// Skip providing completions if this was triggered by a backspace operation of if we just accepted a suggestion
			if (isBackspaceOperation || justAcceptedSuggestion) {
				return null
			}

			// Get exactly what's been typed on the current line
			const linePrefix = document
				.getText(new vscode.Range(new vscode.Position(position.line, 0), position))
				.trimStart()
			console.log(`🚀🛑 Autocomplete for line with prefix: "${linePrefix}"!`)

			const codeContext = await contextGatherer.gatherContext(document, position, true, true)

			// Check if we have a cached completion for this context
			const cacheKey = generateCacheKey(codeContext)
			const cachedCompletions = completionsCache.get(cacheKey) ?? []
			for (const completion of cachedCompletions) {
				if (completion.startsWith(linePrefix)) {
					// Only show the remaining part of the completion
					const remainingSuffix = completion.substring(linePrefix.length)
					if (remainingSuffix.length > 0) {
						console.log(`🚀🎯 Using cached completions (${cachedCompletions.length} options)`)
						animationManager.stopAnimation()
						return [createInlineCompletionItem(remainingSuffix, position)]
					}
				}
			}

			const result = await debouncedGenerateCompletion({ document, codeContext, position })
			if (!result || token.isCancellationRequested) {
				return null
			}
			const { processedCompletion, cost } = result
			console.log(`🚀🛑🚀🛑🚀🛑🚀🛑🚀🛑 \n`, {
				processedCompletion,
				cost: humanFormatCost(cost || 0),
			})

			// Cache the successful completion for future use
			if (processedCompletion) {
				const completions = completionsCache.get(cacheKey) ?? []

				// Add the new completion if it's not already in the list
				if (!completions.includes(processedCompletion)) {
					completions.push(linePrefix + processedCompletion)
					console.log(`🚀🛑 Saved new cache entry '${linePrefix + processedCompletion}'`)

					// Prune the array if it exceeds the maximum size
					// Keep the most recent completions (remove from the beginning)
					if (completions.length > MAX_COMPLETIONS_PER_CONTEXT) {
						completions.splice(0, completions.length - MAX_COMPLETIONS_PER_CONTEXT)
					}
				}
				completionsCache.set(cacheKey, completions)
			}

			return [createInlineCompletionItem(processedCompletion, position)]
		},
	}

	// Register provider and commands
	const providerDisposable = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider)

	// Status bar
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.text = "$(sparkle) Kilo-complete"
	statusBar.tooltip = "Kilo Code Autocomplete"
	statusBar.command = "kilo-code.toggleAutocomplete"
	statusBar.show()

	// Helper function to format cost with special handling for small amounts
	const humanFormatCost = (cost: number): string => {
		if (cost === 0) return "$0.00"
		if (cost > 0 && cost < 0.01) return "<$0.01" // Less than one cent
		return `$${cost.toFixed(2)}`
	}

	// Helper function to update status bar with cost information
	const updateStatusBarWithCost = (
		statusBar: vscode.StatusBarItem,
		lastCost: number,
		totalCost: number,
		isEnabled: boolean,
	) => {
		if (!isEnabled) {
			statusBar.text = "$(circle-slash) Kilo-complete"
			statusBar.tooltip = "Kilo Code Autocomplete (disabled)"
			return
		}

		const totalCostFormatted = humanFormatCost(totalCost)
		statusBar.text = `$(sparkle) Kilo-complete (${totalCostFormatted})`
		statusBar.tooltip = `Kilo Code Autocomplete\nLast completion: ${lastCost.toFixed(5)}\nSession total: ${totalCostFormatted}`
	}

	const toggleCommand = vscode.commands.registerCommand("kilo-code.toggleAutocomplete", () => {
		enabled = !enabled
		updateStatusBarWithCost(statusBar, lastCompletionCost, totalSessionCost, enabled)
		vscode.window.showInformationMessage(`Kilo-complete ${enabled ? "enabled" : "disabled"}`)
	})

	// Command to track when a suggestion is accepted
	const trackAcceptedSuggestionCommand = vscode.commands.registerCommand("kilo-code.trackAcceptedSuggestion", () => {
		justAcceptedSuggestion = true
	})

	// Event handlers
	const selectionHandler = vscode.window.onDidChangeTextEditorSelection((_e) => {
		// Reset the flag when selection changes
		// This ensures we only skip one completion request after accepting a suggestion
		justAcceptedSuggestion = false
	})
	const documentHandler = vscode.workspace.onDidChangeTextDocument((e) => {
		const editor = vscode.window.activeTextEditor
		if (!editor || editor.document !== e.document || !e.contentChanges.length) return

		clearState()

		// Reset the justAcceptedSuggestion flag when the user makes any edit
		// This ensures we only skip one completion request after accepting a suggestion
		justAcceptedSuggestion = false

		// Detect backspace operations by checking content changes
		const change = e.contentChanges[0]
		if (change.rangeLength > 0 && change.text === "") {
			isBackspaceOperation = true
		}

		// Force inlineSuggestions to appear, even for whitespace changes
		// without this, hitting keys like spacebar won't show the completion
		vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
	})

	context.subscriptions.push(
		providerDisposable,
		toggleCommand,
		trackAcceptedSuggestionCommand,
		statusBar,
		selectionHandler,
		documentHandler,
		{ dispose: animationManager.dispose },
	)
}

/**
 * Creates an inline completion item with tracking command
 * @param completionText The text to be inserted as completion
 * @param insertRange The range where the completion should be inserted
 * @param position The position in the document
 * @returns A configured vscode.InlineCompletionItem
 */
function createInlineCompletionItem(completionText: string, position: vscode.Position): vscode.InlineCompletionItem {
	const insertRange = new vscode.Range(position, position)

	return Object.assign(new vscode.InlineCompletionItem(completionText, insertRange), {
		command: {
			command: "kilo-code.trackAcceptedSuggestion",
			title: "Track Accepted Suggestion",
			arguments: [completionText, position],
		},
	})
}
