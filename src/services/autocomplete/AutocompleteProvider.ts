import * as vscode from "vscode"
import { buildApiHandler } from "../../api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { holeFillerTemplate } from "./templating/AutocompleteTemplate"
import { stopAtStopTokens } from "./streamTransforms/charStream"
import { getDocumentTextWithPlaceholder } from "./utils/document"
import { LRUCache } from "lru-cache"

// Configuration
export const UI_UPDATE_DEBOUNCE_MS = 500
const DEFAULT_MODEL = "mistralai/codestral-2501"

export function registerAutocomplete(context: vscode.ExtensionContext) {
	try {
		setupAutocomplete(context)
		console.log("Kilo Code autocomplete provider registered")
	} catch (error) {
		console.error("Failed to register autocomplete provider:", error)
	}
}

const loadingDecoration = vscode.window.createTextEditorDecorationType({
	after: {
		color: new vscode.ThemeColor("editorGhostText.foreground"),
		fontStyle: "italic",
		contentText: "⏳",
	},
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
})

function isFileDisabled(document: vscode.TextDocument): boolean {
	const patterns = (vscode.workspace.getConfiguration("kilo-code").get<string>("autocomplete.disableInFiles") || "")
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)

	return patterns.some((pattern) => {
		const glob = new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "", pattern)
		return vscode.languages.match({ pattern: glob }, document)
	})
}

// Cache interface for storing completion results
// interface CompletionCache {
// 	response: string
// 	documentVersion: number
// }

const _COOLDOWN_PERIOD_MS = 500 // Prevent new suggestions for 500ms after accepting one

function setupAutocomplete(context: vscode.ExtensionContext) {
	let timer: NodeJS.Timeout | undefined
	let enabled = true
	let activeRequest: string | null = null
	let cache: LRUCache<string, string> = new LRUCache<string, string>({ max: 100 })

	// Cache for storing the last completion result
	// let completionCache: CompletionCache | null = null

	// Services
	const apiHandler = buildApiHandler({
		apiProvider: "kilocode",
		kilocodeToken: ContextProxy.instance.getProviderSettings().kilocodeToken,
		kilocodeModel: DEFAULT_MODEL,
	})

	const clearState = () => {
		vscode.window.activeTextEditor?.setDecorations(loadingDecoration, [])
	}

	const _generateCompletion = async (
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	) => {
		console.log(`🚀👹 Autocomplete generating...`)
		if (!enabled || isFileDisabled(document)) {
			return null
		}

		const requestId = crypto.randomUUID() // New completion request!
		activeRequest = requestId
		console.log(`🚀 provideInlineCompletionItems: ${requestId.slice(0, 4)}`)

		// Get document text with placeholder at cursor position

		const docWithPlaceholder = getDocumentTextWithPlaceholder(document, position)
		const cacheKey = `${docWithPlaceholder.linesBeforeCursor}:${docWithPlaceholder.linesAfterCursor}`
		const cachedResult = cache.get(cacheKey)

		if (cachedResult) {
			const linePrefix = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position))

			if (cachedResult.startsWith(linePrefix)) {
				const remainingText = cachedResult.substring(linePrefix.length)
				if (remainingText.length === 0) {
					return null
				}

				// Create completion item with the remaining text
				const range = new vscode.Range(position, position)
				const item = new vscode.InlineCompletionItem(remainingText, range)

				// Set the filterText to the WHOLE completion
				item.filterText = cachedResult

				return [item]
			}
		}

		const editor = vscode.window.activeTextEditor
		if (!editor) return null

		const systemPrompt = holeFillerTemplate.getSystemPrompt()
		const prompt = holeFillerTemplate.template({
			currentFileWithFillPlaceholder: docWithPlaceholder.textWithPlaceholder,
		})
		// console.log(`🚀🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶\n` + prompt)

		// Start the LLM reponse stream
		editor.setDecorations(loadingDecoration, [{ range: new vscode.Range(position, position) }])
		const stream = apiHandler.createMessage(systemPrompt, [
			{ role: "user", content: [{ type: "text", text: prompt }] },
		])

		// Convert the stream into chunks of text
		const stringGenerator = (async function* () {
			for await (const chunk of stream) {
				if (activeRequest !== requestId) break
				if (chunk.type === "text") {
					yield chunk.text
				}
			}
		})()
		if (activeRequest !== requestId || token.isCancellationRequested) {
			// console.log(`🚀🤖🤖🤖🤖❌ ABORTED ❌🤖🤖🤖🤖\n`)
			return null
		}

		// Get the stop tokens from the template
		const stopTokenArray = holeFillerTemplate.completionOptions?.stop as string[]
		const filteredStream = stopAtStopTokens(stringGenerator, stopTokenArray)

		// Continue receiving the chunks while we're not cancelled
		let rawResponse = ""
		for await (const text of filteredStream) {
			if (activeRequest !== requestId) break
			rawResponse += text
		}
		if (activeRequest !== requestId || token.isCancellationRequested) return null

		const autocompleteResponse = rawResponse.replace("<COMPLETION>", "").trim()
		// console.log(`🚀🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖 \n` + autocompleteResponse)
		editor.setDecorations(loadingDecoration, [])

		const linePrefix = document
			.getText(new vscode.Range(new vscode.Position(position.line, 0), position))
			.trimStart()

		// If the response doesn't start with what's been typed, don't show completion
		// if (!autocompleteResponse.startsWith(linePrefix)) {
		// 	return null
		// }

		// Calculate the remaining text
		const remainingText = autocompleteResponse.startsWith(linePrefix)
			? autocompleteResponse.substring(linePrefix.length)
			: autocompleteResponse
		console.log(`🚀 ~ linePrefix is '${linePrefix}'`)
		console.log(`🚀 ~ remainingText is '${remainingText}'`)
		console.log(`🚀 ~ autocompleteResponse is '${autocompleteResponse}'`)

		// Nothing left to complete?
		if (remainingText.length === 0) {
			return null
		}

		// Create completion item with the remaining text
		const range = new vscode.Range(position, position)
		const item = new vscode.InlineCompletionItem(remainingText, range)

		// Set the filterText to the WHOLE completion
		item.filterText = autocompleteResponse

		return [item]
	}

	const inlineCompletionProvider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, context, token) {
			console.log(`🚀💬 Autocomplete requested!`)

			// Get exactly what's been typed on the current line
			const linePrefix = document
				.getText(new vscode.Range(new vscode.Position(position.line, 0), position))
				.trimStart()

			// Debug logging
			console.log(`[DEBUG] Line prefix: "${linePrefix}"`)
			console.log(`[DEBUG] Line prefix length: ${linePrefix.length}`)

			return new Promise((resolve) => {
				clearTimeout(timer)
				timer = setTimeout(() => {
					resolve(_generateCompletion(document, position, token))
				}, UI_UPDATE_DEBOUNCE_MS)
			})
		},
	}

	// Register provider and commands
	const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
		{ pattern: "**" },
		inlineCompletionProvider,
	)

	// Status bar
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.text = "$(sparkle) Autocomplete"
	statusBar.tooltip = "Kilo Code Autocomplete"
	statusBar.command = "kilo-code.toggleAutocomplete"
	statusBar.show()

	const selectionHandler = vscode.window.onDidChangeTextEditorSelection(() => {
		clearState()
	})

	// Register disposables
	context.subscriptions.push(providerDisposable, statusBar, selectionHandler, loadingDecoration, {
		dispose: clearState,
	})
}
