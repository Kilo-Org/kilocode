import * as vscode from "vscode"
import { buildApiHandler } from "../../api"
import { ContextGatherer } from "./ContextGatherer"
import { holeFillerTemplate } from "./templating/AutocompleteTemplate"
import { ContextProxy } from "../../core/config/ContextProxy"
import { generateImportSnippets, generateDefinitionSnippets } from "./context/snippetProvider"

// Configuration
export const UI_UPDATE_DEBOUNCE_MS = 150
//const DEFAULT_MODEL = "mistralai/codestral-2501"
const DEFAULT_MODEL = "google/gemini-2.5-flash-preview-05-20"
const PREVIEW_CONTEXT_KEY = "kilo-code.autocompletePreviewVisible"

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

export function processModelResponse(responseText: string): string {
	const fullMatch = /(<COMPLETION>)?([\s\S]*?)(<\/COMPLETION>|$)/.exec(responseText)
	if (!fullMatch) {
		console.warn("No valid completion found in response:", responseText)
		return responseText
	}
	if (fullMatch[2].endsWith("</COMPLETION>")) {
		console.warn("Completion ends with </COMPLETION>, removing it:", fullMatch[2])
		return fullMatch[2].slice(0, -"</COMPLETION>".length)
	}
	console.warn("Returning completion without </COMPLETION> tag:", fullMatch[2])
	return fullMatch[2]
}

function splitFirstLine(text: string) {
	const firstLine = text.split(/\r?\n/, 1)[0]
	return { firstLine, remaining: text.slice(firstLine.length) }
}

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
	vscode.commands.executeCommand("setContext", PREVIEW_CONTEXT_KEY, false)

	// State
	let enabled = true
	let activeRequest: string | null = null
	let pendingCompletion = ""
	let acceptedFirstLine = false
	let isAcceptingCompletion = false

	// Services
	const contextGatherer = new ContextGatherer()
	const apiHandler = buildApiHandler({
		apiProvider: "kilocode",
		kilocodeToken: ContextProxy.instance.getProviderSettings().kilocodeToken,
		kilocodeModel: DEFAULT_MODEL,
	})

	const clearState = () => {
		pendingCompletion = ""
		acceptedFirstLine = false
		isAcceptingCompletion = false
		vscode.commands.executeCommand("setContext", PREVIEW_CONTEXT_KEY, false)
		vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
		vscode.window.activeTextEditor?.setDecorations(loadingDecoration, [])
	}

	const provider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, context, token) {
			if (!enabled || isFileDisabled(document)) {
				return null
			}

			// Handle multi-line completion flow
			if (acceptedFirstLine && pendingCompletion) {
				const { remaining } = splitFirstLine(pendingCompletion)
				if (remaining) {
					vscode.commands.executeCommand("setContext", PREVIEW_CONTEXT_KEY, true)
					return [new vscode.InlineCompletionItem(remaining)]
				}
				clearState()
				return null
			}

			// New completion request
			const requestId = crypto.randomUUID()
			activeRequest = requestId
			acceptedFirstLine = false

			try {
				const editor = vscode.window.activeTextEditor
				if (!editor) return null

				// Show loading indicator
				editor.setDecorations(loadingDecoration, [
					{
						range: new vscode.Range(position, position),
					},
				])

				// Gather context and build prompt
				const codeContext = await contextGatherer.gatherContext(document, position, true, true)
				const snippets = [
					...generateImportSnippets(true, codeContext.imports, document.uri.fsPath),
					...generateDefinitionSnippets(true, codeContext.definitions),
				]

				// Assume new PromptRenderer methods that use the holeFillerTemplate
				// These methods would internally construct `currentFileWithFillPlaceholder`
				// from codeContext, document, and position, then use the template.
				const systemPrompt = holeFillerTemplate.getSystemPrompt()
				const userPrompt = holeFillerTemplate.template(codeContext, document, position, snippets)

				console.log(`🚀🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶🧶\n` + userPrompt)

				// Stream completion
				const stream = apiHandler.createMessage(systemPrompt, [
					{ role: "user", content: [{ type: "text", text: userPrompt }] },
				])

				let completion = ""
				let throttleTimer: NodeJS.Timeout | null = null

				for await (const chunk of stream) {
					if (activeRequest !== requestId) break

					if (chunk.type === "text") {
						completion += chunk.text
						pendingCompletion = processModelResponse(completion)
						// Throttle UI updates
						if (throttleTimer) clearTimeout(throttleTimer)
						throttleTimer = setTimeout(() => {
							console.log(completion)
							console.log(pendingCompletion)
							vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
						}, UI_UPDATE_DEBOUNCE_MS)
					}
				}

				if (throttleTimer) clearTimeout(throttleTimer)
				editor.setDecorations(loadingDecoration, [])
				console.log(`🚀🚀🚀🚀🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖🤖 \n`, completion, pendingCompletion)

				if (activeRequest !== requestId || token.isCancellationRequested || !pendingCompletion) return null

				vscode.commands.executeCommand("setContext", PREVIEW_CONTEXT_KEY, true)

				const item = new vscode.InlineCompletionItem(splitFirstLine(pendingCompletion).firstLine)
				item.command = {
					command: "kilo-code.acceptAutocompletePreview",
					title: "Accept Completion",
				}
				return [item]
			} catch (error) {
				console.error("Completion error:", error)
				return null
			} finally {
				if (activeRequest === requestId) {
					activeRequest = null
				}
			}
		},
	}

	// Register provider and commands
	const providerDisposable = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider)

	const acceptCommand = vscode.commands.registerCommand("kilo-code.acceptAutocompletePreview", async () => {
		const editor = vscode.window.activeTextEditor
		if (!editor || !pendingCompletion) return

		isAcceptingCompletion = true

		if (!acceptedFirstLine) {
			// Accept first line
			const { firstLine, remaining } = splitFirstLine(pendingCompletion)
			await editor.edit((edit) => edit.insert(editor.selection.active, firstLine))
			acceptedFirstLine = true

			if (remaining) {
				// Trigger for remaining lines
				setTimeout(() => {
					isAcceptingCompletion = false
					vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
				}, 50)
			} else {
				clearState()
			}
		} else {
			// Accept remaining lines
			const { remaining } = splitFirstLine(pendingCompletion)
			if (remaining) {
				await editor.edit((edit) => edit.insert(editor.selection.active, remaining))
			}
			clearState()
		}
	})

	const dismissCommand = vscode.commands.registerCommand("kilo-code.dismissAutocompletePreview", clearState)

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

	// Event handlers
	const selectionHandler = vscode.window.onDidChangeTextEditorSelection(() => {
		// Don't clear state if we're in the middle of accepting a completion
		if (!isAcceptingCompletion) {
			clearState()
		}
	})
	const documentHandler = vscode.workspace.onDidChangeTextDocument((e) => {
		const editor = vscode.window.activeTextEditor
		if (editor?.document === e.document) {
			editor.setDecorations(loadingDecoration, [])
		}
	})

	// Register disposables
	context.subscriptions.push(
		providerDisposable,
		acceptCommand,
		dismissCommand,
		toggleCommand,
		statusBar,
		selectionHandler,
		documentHandler,
		loadingDecoration,
		{ dispose: clearState },
	)
}
