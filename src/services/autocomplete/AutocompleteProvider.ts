import * as vscode from "vscode"
import { buildApiHandler } from "../../api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { holeFillerTemplate } from "./templating/AutocompleteTemplate"
import { stopAtStopTokens } from "./streamTransforms/charStream"
import { getDocumentTextWithPlaceholder } from "./utils/document"
import { LRUCache } from "lru-cache"

// Configuration
const DEBUG_FULL_PROMPT_CYCLE = false
export const UI_UPDATE_DEBOUNCE_MS = 2000
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

function setupAutocomplete(context: vscode.ExtensionContext) {
	let timer: NodeJS.Timeout | undefined
	let enabled = true
	let activeRequest: string | null = null
	let cache: LRUCache<string, string> = new LRUCache<string, string>({ max: 100 })

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
		if (!vscode.window.activeTextEditor) return null

		const requestId = crypto.randomUUID() // New completion request!
		const docWithPlaceholder = getDocumentTextWithPlaceholder(document, position)
		activeRequest = requestId

		const systemPrompt = holeFillerTemplate.getSystemPrompt()
		const prompt = holeFillerTemplate.template({
			currentFileWithFillPlaceholder: docWithPlaceholder.textWithPlaceholder,
		})
		if (DEBUG_FULL_PROMPT_CYCLE) {
			console.log(`🚀🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶\n` + prompt)
		}

		// Start the LLM reponse stream
		// Place loading decoration at the end of the current line instead of at cursor position
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
			if (DEBUG_FULL_PROMPT_CYCLE) {
				console.log(`🚀🤖🤖🤖🤖❌ ABORTED ❌🤖🤖🤖🤖\n`)
			}
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
		if (DEBUG_FULL_PROMPT_CYCLE) {
			console.log(`🚀🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖 \n` + autocompleteResponse)
		}

		return autocompleteResponse
	}

	const maybeGenerateCompletion = async (
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | null> => {
		if (!vscode.window.activeTextEditor) return null

		console.log(`🚀👹 Autocomplete generating...`)
		if (!enabled || isFileDisabled(document)) {
			return null
		}

		const requestId = crypto.randomUUID() // New completion request!
		const docWithPlaceholder = getDocumentTextWithPlaceholder(document, position)
		activeRequest = requestId

		const cacheKey = `${docWithPlaceholder.linesBeforeCursor}:${docWithPlaceholder.linesAfterCursor}`
		const cachedResult = cache.get(cacheKey)
		console.log(`🚀 provideInlineCompletionItems: ${requestId.slice(0, 4)} ${cachedResult ? "CACHED" : ""}`)

		if (cachedResult) {
			return cachedResult
		}

		const lineEndPosition = new vscode.Position(position.line, document.lineAt(position.line).text.length)
		vscode.window.activeTextEditor.setDecorations(loadingDecoration, [
			{ range: new vscode.Range(lineEndPosition, lineEndPosition) },
		])

		const autocompleteResponse = await _generateCompletion(document, position, token)
		if (autocompleteResponse === null) return

		vscode.window.activeTextEditor.setDecorations(loadingDecoration, [])
		cache.set(cacheKey, autocompleteResponse)

		// Actually insert the suggestion

		const linePrefix = document
			.getText(new vscode.Range(new vscode.Position(position.line, 0), position))
			.trimStart()
		const remainingText = autocompleteResponse.startsWith(linePrefix)
			? autocompleteResponse.substring(linePrefix.length)
			: autocompleteResponse
		console.log(`🚀 ~ linePrefix is '${linePrefix}'`)
		console.log(`🚀 ~ remainingText is '${remainingText}'`)
		console.log(`🚀 ~ autocompleteResponse is '${autocompleteResponse}'`)

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
					maybeGenerateCompletion(document, position, token).then(resolve)
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
