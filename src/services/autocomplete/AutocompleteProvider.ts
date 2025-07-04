// kilocode_change new file

import * as vscode from "vscode"
import { buildApiHandler, ApiHandler } from "../../api"
import { CodeContext, ContextGatherer } from "./ContextGatherer"
import { holeFillerTemplate } from "./templating/AutocompleteTemplate"
import { ContextProxy } from "../../core/config/ContextProxy"
import { generateImportSnippets, generateDefinitionSnippets } from "./context/snippetProvider"
import { LRUCache } from "lru-cache"
import { createDebouncedFn } from "./utils/createDebouncedFn"
import { AutocompleteDecorationAnimation } from "./AutocompleteDecorationAnimation"
import { isHumanEdit } from "./utils/EditDetectionUtils"
import { ExperimentId, ProviderSettings } from "@roo-code/types"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"

export const UI_UPDATE_DEBOUNCE_MS = 250
export const BAIL_OUT_TOO_MANY_LINES_LIMIT = 100
export const MAX_COMPLETIONS_PER_CONTEXT = 5 // Per-given prefix/suffix lines, how many different per-line options to cache

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
 * Gets the autocomplete provider configuration from settings
 * Returns the configured provider settings for autocomplete or fallback to defaults
 */
async function getAutocompleteConfiguration(
	providerSettingsManager: ProviderSettingsManager,
): Promise<ProviderSettings | undefined> {
	const contextProxy = ContextProxy.instance
	if (!contextProxy) {
		return undefined
	}

	await providerSettingsManager.initialize()

	const autocompleteApiConfigId = contextProxy.getValues().autocompleteApiConfigId

	// If we have a specific API config ID for autocomplete, try to get the profile.
	if (autocompleteApiConfigId) {
		try {
			const providerSettings = await providerSettingsManager.getProfile({ id: autocompleteApiConfigId })
			return providerSettings
		} catch (error) {
			console.error("Failed to get autocomplete profile:", error)
		}
	}

	return undefined
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

/**
 * Sets up autocomplete with experiment flag checking.
 * This function periodically checks the experiment flag and registers/disposes
 * the autocomplete provider accordingly.
 */
export function registerAutocomplete(context: vscode.ExtensionContext): void {
	let autocompleteDisposable: vscode.Disposable | null = null
	let isCurrentlyEnabled = false

	// Function to check experiment flag and update provider
	const checkAndUpdateProvider = () => {
		const experiments =
			(ContextProxy.instance?.getGlobalState("experiments") as Record<ExperimentId, boolean>) ?? {}
		const shouldBeEnabled = experiments.autocomplete ?? false

		// Only take action if the state has changed
		if (shouldBeEnabled !== isCurrentlyEnabled) {
			console.log(`🚀🔍 Autocomplete experiment flag changed to: ${shouldBeEnabled}`)

			autocompleteDisposable?.dispose()
			autocompleteDisposable = shouldBeEnabled ? setupAutocomplete(context) : null
			isCurrentlyEnabled = shouldBeEnabled
		}
	}

	checkAndUpdateProvider()
	const experimentCheckInterval = setInterval(checkAndUpdateProvider, 5000)

	// Make sure to clean up the interval when the extension is deactivated
	context.subscriptions.push({
		dispose: () => {
			clearInterval(experimentCheckInterval)
			autocompleteDisposable?.dispose()
		},
	})
}

function setupAutocomplete(context: vscode.ExtensionContext): vscode.Disposable {
	// State
	let enabled = true // User toggle state (default to enabled)
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

	const providerSettingsManager = new ProviderSettingsManager(context)

	// Services
	const contextGatherer = new ContextGatherer()
	const animationManager = AutocompleteDecorationAnimation.getInstance()

	// Initialize API handler with autocomplete configuration
	let apiHandler: ApiHandler | null = null

	const updateApiHandler = async (providerSettingsManager: ProviderSettingsManager) => {
		const autocompleteConfig = await getAutocompleteConfiguration(providerSettingsManager)
		if (!autocompleteConfig) {
			console.warn("No autocomplete configuration found, disabling autocomplete.")
			apiHandler = null
			return
		}

		try {
			apiHandler = buildApiHandler(autocompleteConfig)
		} catch (error) {
			console.error("Failed to build API handler for autocomplete:", error)
			apiHandler = null
		}
	}

	// Initialize the API handler
	updateApiHandler(providerSettingsManager)

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
		if (!apiHandler) throw new Error("apiHandler must be set before calling generateCompletion!")

		const requestId = crypto.randomUUID()
		activeRequestId = requestId
		animationManager.startAnimation()

		const snippets = [
			...generateImportSnippets(true, codeContext.imports, document.uri.fsPath),
			...generateDefinitionSnippets(true, codeContext.definitions),
		]
		const systemPrompt = holeFillerTemplate.getSystemPrompt()
		const userPrompt = holeFillerTemplate.template(codeContext, document, position, snippets)

		console.log(`🚀🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶\n`, userPrompt)

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
		updateStatusBar()

		if (activeRequestId === requestId) {
			animationManager.stopAnimation()
		}

		return { processedCompletion, lineCount, cost: completionCost }
	}

	const debouncedGenerateCompletion = createDebouncedFn(generateCompletion, UI_UPDATE_DEBOUNCE_MS)

	const provider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, context, token) {
			if (!enabled || !vscode.window.activeTextEditor) return null

			// Update API handler in case provider configuration has changed
			await updateApiHandler(providerSettingsManager)

			if (!apiHandler) {
				return null
			}

			// Skip providing completions if this was triggered by a backspace operation of if we just accepted a suggestion
			if (isBackspaceOperation || justAcceptedSuggestion) {
				return null
			}

			// Check if we're at the start of a line with only whitespace before cursor
			const lineText = document.lineAt(position.line).text
			const textBeforeCursor = lineText.substring(0, position.character)

			// If we're in whitespace at the start of a line (e.g., indenting with tab), don't trigger autocomplete
			// But allow autocomplete if we're at the end of a line that consists only of whitespace
			if (textBeforeCursor.trim() === "" && position.character !== lineText.length) {
				console.log(`🚀⚪ Skipping autocomplete in whitespace at start of line`)
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
	statusBar.text = "$(sparkle) Kilo Complete"
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
	const updateStatusBar = () => {
		if (!enabled) {
			statusBar.text = "$(circle-slash) Kilo Complete"
			statusBar.tooltip = "Kilo Code Autocomplete (disabled)"
			return
		}

		// Check if API handler is available
		if (!apiHandler) {
			statusBar.text = "$(warning) Kilo Complete"
			statusBar.tooltip = "No valid autocomplete provider configuration found"
			return
		}

		const totalCostFormatted = humanFormatCost(totalSessionCost)
		statusBar.text = `$(sparkle) Kilo Complete (${totalCostFormatted})`
		statusBar.tooltip = `\
Kilo Code Autocomplete

Last completion: $${lastCompletionCost.toFixed(5)}
Session total cost: ${totalCostFormatted}
`
	}

	const toggleCommand = vscode.commands.registerCommand("kilo-code.toggleAutocomplete", () => {
		enabled = !enabled
		updateStatusBar()
		vscode.window.showInformationMessage(`Kilo Complete ${enabled ? "enabled" : "disabled"}`)
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

		// Check if this edit is from human typing rather than AI tools, copy-paste, etc.
		// Only trigger autocomplete for human edits to avoid interference
		const isHumanTyping = isHumanEdit(e)
		if (!isHumanTyping) {
			console.log("🚀🤖 Skipping autocomplete trigger during non-human edit")
			return
		}

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

	// Create a composite disposable to return
	const disposable = new vscode.Disposable(() => {
		providerDisposable.dispose()
		toggleCommand.dispose()
		trackAcceptedSuggestionCommand.dispose()
		statusBar.dispose()
		selectionHandler.dispose()
		documentHandler.dispose()
		animationManager.dispose()
	})

	// Still register with context for safety
	context.subscriptions.push(disposable)

	// Initialize status bar with correct state
	updateStatusBar()

	return disposable
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
