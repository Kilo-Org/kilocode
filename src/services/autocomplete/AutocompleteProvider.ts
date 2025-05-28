import * as vscode from "vscode"
import { buildApiHandler } from "../../api"
import { ContextGatherer } from "./ContextGatherer"
import { holeFillerTemplate } from "./templating/AutocompleteTemplate"
import { ContextProxy } from "../../core/config/ContextProxy"
import { generateImportSnippets, generateDefinitionSnippets } from "./context/snippetProvider"
import { LRUCache } from "lru-cache"
import { CompletionStreamHandler } from "./utils/CompletionStreamHandler"
import { AutocompleteDecorationAnimation } from "./utils/AutocompleteDecorationAnimation"

// Configuration
export const UI_UPDATE_DEBOUNCE_MS = 500
export const BAIL_OUT_TOO_MANY_LINES_LIMIT = 100
//const DEFAULT_MODEL = "mistralai/codestral-2501"
const DEFAULT_MODEL = "google/gemini-2.5-flash-preview-05-20"

export function registerAutocomplete(context: vscode.ExtensionContext) {
	try {
		setupAutocomplete(context)
		console.log("� Kilo Code autocomplete provider registered")
	} catch (error) {
		console.error("Failed to register autocomplete provider:", error)
	}
}

// Animation manager for the loading indicator
const animationManager = AutocompleteDecorationAnimation.getInstance()

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
function generateCacheKey(precedingLines: string[], followingLines: string[]): string {
	// Use a limited number of lines to ensure the key isn't too large
	const maxLinesToConsider = 10
	const precedingContext = precedingLines.slice(-maxLinesToConsider).join("\n")
	const followingContext = followingLines.slice(0, maxLinesToConsider).join("\n")
	return `${precedingContext}|||${followingContext}`
}

/**
 * Handles the streaming of completions from the API
 */
async function streamCompletion(
	stream: any, // Using 'any' for now to avoid type issues with the API stream
	activeRequestId: string,
	getCurrentRequestId: () => string | null,
): Promise<{ processedCompletion: string; lineCount: number }> {
	let completion = ""
	let processedCompletion = ""
	let lineCount = 0

	try {
		for await (const chunk of stream) {
			// Check if this request is still active
			if (getCurrentRequestId() !== activeRequestId) {
				break
			}

			if (chunk.type === "text") {
				completion += chunk.text
				processedCompletion = processModelResponse(completion)
				lineCount += processedCompletion.split("/n").length
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

	return { processedCompletion, lineCount }
}

function setupAutocomplete(context: vscode.ExtensionContext) {
	// State
	let enabled = true
	let activeRequest: string | null = null

	// Track accepted suggestions to prevent immediate re-triggering
	let lastAcceptedSuggestion: string | null = null
	let lastAcceptedPosition: vscode.Position | null = null
	let lastAcceptedTimestamp: number = 0
	const SUGGESTION_COOLDOWN_MS = 300 // Time window to ignore subsequent requests

	// LRU Cache for completions
	// Keep up to 50 completions in memory
	const completionsCache = new LRUCache<string, string>({
		max: 50,
		// Cache for 24 hours since code and models don't change frequently
		ttl: 1000 * 60 * 60 * 24,
	})

	// Services
	const contextGatherer = new ContextGatherer()
	const apiHandler = buildApiHandler({
		apiProvider: "kilocode",
		kilocodeToken: ContextProxy.instance.getProviderSettings().kilocodeToken,
		kilocodeModel: DEFAULT_MODEL,
	})

	const clearState = () => {
		vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
		animationManager.stopAnimation()

		// Also clear the accepted suggestion tracking state
		lastAcceptedSuggestion = null
		lastAcceptedPosition = null

		// Cancel any active request
		if (activeRequest) {
			console.log(`🚀🛑 Cancelling active request: ${activeRequest}`)
			CompletionStreamHandler.cancelRequest(activeRequest)
			activeRequest = null
		}
	}

	const provider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, context, token) {
			if (!enabled || !vscode.window.activeTextEditor) return null

			// Check if this request is immediately after accepting a suggestion
			const now = Date.now()
			if (
				lastAcceptedSuggestion !== null &&
				lastAcceptedPosition !== null &&
				now - lastAcceptedTimestamp < SUGGESTION_COOLDOWN_MS
			) {
				// If the cursor is at the expected position after accepting a suggestion,
				// ignore this request to prevent cascading suggestions
				if (
					position.line === lastAcceptedPosition.line &&
					position.character === lastAcceptedPosition.character
				) {
					console.log("🚀🛑 Ignoring autocomplete request immediately after accepting suggestion")
					return null
				}
			}

			// Get exactly what's been typed on the current line
			const linePrefix = document
				.getText(new vscode.Range(new vscode.Position(position.line, 0), position))
				.trimStart()
			console.log(`�� Autocomplete for line with prefix: "${linePrefix}"!`)

			// New completion request
			const requestId = crypto.randomUUID()
			activeRequest = requestId

			// Apply animated loading indicator at the end of the line
			const lineEndPosition = new vscode.Position(position.line, document.lineAt(position.line).text.length)
			const loadingRange = new vscode.Range(lineEndPosition, lineEndPosition)
			animationManager.startAnimation(vscode.window.activeTextEditor, loadingRange)

			// Gather context and build prompt
			const codeContext = await contextGatherer.gatherContext(document, position, true, true)

			// Check if we have a cached completion for this context
			const cacheKey = generateCacheKey(codeContext.precedingLines, codeContext.followingLines)
			const cachedCompletion = completionsCache.get(cacheKey)

			if (cachedCompletion) {
				console.log("🚀🎯 Using cached completion")
				animationManager.stopAnimation()
				const item = new vscode.InlineCompletionItem(cachedCompletion)
				return [item]
			}

			const snippets = [
				...generateImportSnippets(true, codeContext.imports, document.uri.fsPath),
				...generateDefinitionSnippets(true, codeContext.definitions),
			]

			// Prepare the prompts
			const systemPrompt = holeFillerTemplate.getSystemPrompt()
			const userPrompt = holeFillerTemplate.template(codeContext, document, position, snippets)

			// Use debouncing for the API call
			const result = await CompletionStreamHandler.streamWithDebounce(requestId, async () => {
				// Create the stream only after debounce period
				console.log(`🚀🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶\n` + userPrompt)

				// Check if the request was cancelled during debounce
				if (activeRequest !== requestId) {
					console.log("🚀🛑 Request cancelled during debounce")
					return { processedCompletion: "", lineCount: 0 }
				}

				const stream = apiHandler.createMessage(systemPrompt, [
					{ role: "user", content: [{ type: "text", text: userPrompt }] },
				])

				// Stream the completion
				return streamCompletion(stream, requestId, () => activeRequest)
			})

			// Clear loading indicator when completion is done
			if (activeRequest === requestId) {
				animationManager.stopAnimation()
			}

			// If no result or request was cancelled
			if (!result || activeRequest !== requestId || token.isCancellationRequested) {
				return null
			}

			const { processedCompletion, lineCount } = result

			if (!processedCompletion) {
				return null
			}

			console.log(`����������������� \n` + processedCompletion)

			// Cache the successful completion for future use
			if (processedCompletion && lineCount <= BAIL_OUT_TOO_MANY_LINES_LIMIT) {
				completionsCache.set(cacheKey, processedCompletion)
			}

			const item = new vscode.InlineCompletionItem(processedCompletion)

			// Store information about this suggestion so we can track if it's accepted
			item.command = {
				command: "kilo-code.trackAcceptedSuggestion",
				title: "Track Accepted Suggestion",
				arguments: [processedCompletion, position],
			}

			return [item]
		},
	}

	// Register provider and commands
	const providerDisposable = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider)

	// Status bar
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.text = "$(sparkle) Autocomplete"
	statusBar.tooltip = "Kilo Code Autocomplete"
	statusBar.command = "kilo-code.toggleAutocomplete"
	statusBar.show()

	const toggleCommand = vscode.commands.registerCommand("kilo-code.toggleAutocomplete", () => {
		enabled = !enabled
		statusBar.text = enabled ? "$(sparkle) Autocomplete" : "$(circle-slash) Autocomplete"
		vscode.window.showInformationMessage(`Autocomplete ${enabled ? "enabled" : "disabled"}`)
	})

	// Command to track when a suggestion is accepted
	const trackAcceptedSuggestionCommand = vscode.commands.registerCommand(
		"kilo-code.trackAcceptedSuggestion",
		(suggestion: string, position: vscode.Position) => {
			lastAcceptedSuggestion = suggestion
			// Calculate the expected position after accepting the suggestion
			const lines = suggestion.split("\n") // Check if multiline
			if (lines.length > 1) {
				const lastLine = lines[lines.length - 1]
				lastAcceptedPosition = new vscode.Position(position.line + lines.length - 1, lastLine.length)
			} else {
				lastAcceptedPosition = new vscode.Position(position.line, position.character + suggestion.length)
			}
			lastAcceptedTimestamp = Date.now()
			console.log(`🚀✅ Tracked accepted suggestion: "${suggestion}"`)
		},
	)

	// Event handlers
	const selectionHandler = vscode.window.onDidChangeTextEditorSelection((e) => {
		// If this selection change is not from accepting a suggestion, clear the state
		const now = Date.now()
		if (
			lastAcceptedPosition === null ||
			now - lastAcceptedTimestamp > SUGGESTION_COOLDOWN_MS ||
			!e.selections.length ||
			(e.selections[0].active.line === lastAcceptedPosition.line &&
				e.selections[0].active.character !== lastAcceptedPosition.character)
		) {
			// Clear state when selection changes (this handles Escape key naturally)
			clearState()
		}
	})
	const documentHandler = vscode.workspace.onDidChangeTextDocument((e) => {
		const editor = vscode.window.activeTextEditor
		if (editor?.document === e.document) {
			// Animation will be stopped by clearState when selection changes
		}
	})

	// Register disposables
	context.subscriptions.push(
		providerDisposable,
		toggleCommand,
		trackAcceptedSuggestionCommand,
		statusBar,
		selectionHandler,
		documentHandler,
		{
			dispose: () => {
				clearState()
				animationManager.dispose()
			},
		},
	)
}
