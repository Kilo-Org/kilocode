//PLANREF: continue/core/autocomplete/CompletionProvider.ts
//PLANREF: continue/extensions/vscode/src/autocomplete/completionProvider.ts
import * as vscode from "vscode"
import { buildApiHandler } from "../../api"
import { ContextGatherer } from "./ContextGatherer"
import { PromptRenderer } from "./PromptRenderer" // Imported PromptOptions
import { ContextProxy } from "../../core/config/ContextProxy"
import { generateImportSnippets, generateDefinitionSnippets } from "./context/snippetProvider" // Added import

// Default configuration values
export const UI_UPDATE_DEBOUNCE_MS = 150
const DEFAULT_MODEL = "mistralai/codestral-2501" // or google/gemini-2.5-flash-preview
const MIN_TYPED_LENGTH_FOR_COMPLETION = 4
const AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY = "kilo-code.autocompletePreviewVisible"

// Rich preview object to avoid primitive obsession
interface CompletionPreview {
	firstLine: string
	remainingLines: string
	rawCompletion: string
}
const emptyPreview: CompletionPreview = {
	firstLine: "",
	remainingLines: "",
	rawCompletion: "",
}

export function registerAutocomplete(context: vscode.ExtensionContext) {
	try {
		// Initialize the autocomplete preview text visibility context to false
		hookAutocompleteInner(context)
		console.log("Kilo Code autocomplete provider registered")
	} catch (error) {
		console.error("Failed to register autocomplete provider:", error)
	}
}

const loadingDecorationType = vscode.window.createTextEditorDecorationType({
	after: {
		color: new vscode.ThemeColor("editorGhostText.foreground"),
		fontStyle: "italic",
		contentText: "⏳",
	},
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
})

const showStreamingIndicator = (editor: vscode.TextEditor) => {
	const position = editor.selection.active
	const decoration: vscode.DecorationOptions = {
		range: new vscode.Range(position, position),
	}
	editor.setDecorations(loadingDecorationType, [decoration])
}

// Centralized function to clean markdown and split completion
const processCompletionText = (rawText: string): CompletionPreview => {
	// Clean markdown code blocks once
	const cleanedText = rawText
		.replace(/```[\w-]*\n([\s\S]*?)\n```/g, "$1") // Handle complete code blocks
		.replace(/^```[\w-]*\n/g, "") // Handle opening code block markers at the beginning of a chunk
		.replace(/\n```[\w-]*\n/g, "\n") // Handle opening code block markers in the middle of a chunk
		.replace(/\n```$/g, "") // Handle closing code block markers
		.replace(/```[\w-]*$/g, "") // Handle any remaining backticks that might be part of incomplete code blocks
		.trim() // Trim any leading/trailing whitespace that might be left over

	// Split into first line and remaining lines
	const firstLine = cleanedText.split("\n", 1)[0]

	return {
		firstLine,
		remainingLines: cleanedText.substring(firstLine.length + 1),
		rawCompletion: rawText,
	}
}

const isFileDisabled = (document: vscode.TextDocument): boolean => {
	const vscodeConfig = vscode.workspace.getConfiguration("kilo-code")
	const disabledPatterns = vscodeConfig.get<string>("autocomplete.disableInFiles") || ""
	const patterns = disabledPatterns
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)

	return patterns.some((pattern) => {
		const glob = new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "", pattern)
		return vscode.languages.match({ pattern: glob }, document)
	})
}

const validateCompletionContext = (
	context: vscode.InlineCompletionContext,
	document: vscode.TextDocument,
	position: vscode.Position,
): boolean => {
	if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke) {
		return true
	}
	const activeEditor = vscode.window.activeTextEditor
	const currentPosition =
		activeEditor && activeEditor.document.uri === document.uri ? activeEditor.selection.active : position

	const lineText = document.lineAt(context.selectedCompletionInfo?.range.start.line ?? currentPosition.line).text
	const textBeforeCursor = lineText.substring(
		0,
		context.selectedCompletionInfo?.range.start.character ?? currentPosition.character,
	)
	if (
		context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
		textBeforeCursor.trim().length < MIN_TYPED_LENGTH_FOR_COMPLETION
	) {
		return false
	}
	return true
}
function hookAutocompleteInner(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, false)

	// Shared state encapsulated in closure
	let enabled = true
	let activeCompletionId: string | null = null
	let preview = emptyPreview
	let hasAcceptedFirstLine = false
	let isShowingAutocompletePreview = false
	let isLoadingCompletion = false
	let inlineCompletionProviderDisposable: vscode.Disposable | null = null

	// Core services - created once
	const contextGatherer = new ContextGatherer()
	const promptRenderer = new PromptRenderer({}, DEFAULT_MODEL)
	const kilocodeToken = ContextProxy.instance.getProviderSettings().kilocodeToken
	const apiHandler = buildApiHandler({
		apiProvider: "kilocode",
		kilocodeToken: kilocodeToken,
		kilocodeModel: DEFAULT_MODEL,
	})

	const clearAutocompletePreview = () => {
		isShowingAutocompletePreview = false
		isLoadingCompletion = false
		preview = emptyPreview
		hasAcceptedFirstLine = false

		// Clear loading indicators
		const editor = vscode.window.activeTextEditor
		if (editor) {
			editor.setDecorations(loadingDecorationType, [])
		}

		vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, false)
		vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
	}

	const processCompletionStream = async (
		systemPrompt: string,
		prompt: string,
		completionId: string,
		document: vscode.TextDocument,
	): Promise<CompletionPreview | null> => {
		let completion = ""
		let isCancelled = false
		let firstLineComplete = false
		let throttleTimeout: NodeJS.Timeout | null = null

		// Create the stream using the API handler's createMessage method
		// Note: Stop tokens are embedded in the prompt template format instead of passed directly
		const stream = apiHandler.createMessage(systemPrompt, [
			{ role: "user", content: [{ type: "text", text: prompt }] },
		])

		const editor = vscode.window.activeTextEditor
		if (!editor) return null

		isLoadingCompletion = false
		editor.setDecorations(loadingDecorationType, [])

		for await (const chunk of stream) {
			if (activeCompletionId !== completionId) {
				isCancelled = true
				break
			}

			if (chunk.type === "text") {
				completion += chunk.text
				preview = processCompletionText(completion)

				if (throttleTimeout) clearTimeout(throttleTimeout)

				if (!firstLineComplete && completion.includes("\n")) {
					firstLineComplete = true
					isShowingAutocompletePreview = true
					vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
				} else {
					// Set a new throttle timeout
					throttleTimeout = setTimeout(() => {
						if (editor.document === document) {
							if (isShowingAutocompletePreview) {
								vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
							}
						}
						throttleTimeout = null
					}, UI_UPDATE_DEBOUNCE_MS)
				}
			}
		}

		editor.setDecorations(loadingDecorationType, [])

		if (throttleTimeout) clearTimeout(throttleTimeout)

		// Set context for keybindings
		vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, true)

		return isCancelled ? null : preview
	}

	const generateCompletionText = async (
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<CompletionPreview | null> => {
		const editor = vscode.window.activeTextEditor
		if (editor && editor.document === document) {
			showStreamingIndicator(editor)
		}
		const completionId = crypto.randomUUID()
		activeCompletionId = completionId
		hasAcceptedFirstLine = false

		const useImports = true
		const useDefinitions = true
		const multilineCompletions = "auto"
		const codeContext = await contextGatherer.gatherContext(document, position, useImports, useDefinitions)

		const snippets = [
			...generateImportSnippets(useImports, codeContext.imports, document.uri.fsPath),
			...generateDefinitionSnippets(useDefinitions, codeContext.definitions),
		]

		const promptOptions = {
			language: document.languageId,
			includeImports: useImports,
			includeDefinitions: useDefinitions,
			multilineCompletions: multilineCompletions as any, // Keep as any if type is complex or from external lib
		}

		const prompt = promptRenderer.renderPrompt(codeContext, snippets, promptOptions)
		const systemPrompt = promptRenderer.renderSystemPrompt()

		token.onCancellationRequested(() => {
			if (activeCompletionId === completionId) {
				activeCompletionId = null
			}
		})

		// Process the completion stream
		const startTime = performance.now()
		const result = await processCompletionStream(systemPrompt, prompt.prompt, completionId, document)
		const duration = performance.now() - startTime
		if (!result) {
			console.info(`Completion ${completionId} CANCELLED in ${duration} ms`)
		} else {
			console.info(`
Completion ${completionId} generated in ${duration} ms.

🙈 Prompt:
${prompt.prompt}


🤖 Completion:
${result.rawCompletion}

🤖 first line:
${result.firstLine}

🤖 remaining:
${result.remainingLines}
				`)
		}

		if (!result || token.isCancellationRequested || !validateCompletionContext(context, document, position)) {
			const editor = vscode.window.activeTextEditor
			if (editor && isLoadingCompletion) {
				editor.setDecorations(loadingDecorationType, [])
				isLoadingCompletion = false
			}
			return null
		}

		return result
	}

	const provideInlineCompletionItems = async (
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> => {
		if (!enabled || isFileDisabled(document)) {
			return null
		}

		try {
			if (hasAcceptedFirstLine && preview.remainingLines) {
				const item = new vscode.InlineCompletionItem(preview.remainingLines)
				item.command = { command: "editor.action.inlineSuggest.commit", title: "Accept Completion" }
				isShowingAutocompletePreview = true
				vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, true)
				return [item]
			}

			// Otherwise, generate a new completion
			const completionPreview = await generateCompletionText(document, position, context, token)
			if (!completionPreview) return null

			preview = completionPreview

			isShowingAutocompletePreview = true
			vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, true)

			const item = new vscode.InlineCompletionItem(preview.firstLine)
			item.command = {
				command: "kilo-code.acceptAutocompletePreview",
				title: "Accept Completion",
			}
			return [item]
		} catch (error) {
			console.error("Error providing inline completion:", error)
			return null
		}
	}

	const registerStatusBarItem = (context: vscode.ExtensionContext): vscode.StatusBarItem => {
		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		statusBarItem.text = "$(sparkle) Autocomplete"
		statusBarItem.tooltip = "Kilo Code Autocomplete"
		statusBarItem.command = "kilo-code.toggleAutocomplete"
		statusBarItem.show()
		context.subscriptions.push(statusBarItem)
		return statusBarItem
	}

	const registerToggleCommand = (context: vscode.ExtensionContext, statusBarItem: vscode.StatusBarItem): void => {
		context.subscriptions.push(
			vscode.commands.registerCommand("kilo-code.toggleAutocomplete", () => {
				enabled = !enabled
				statusBarItem.text = enabled ? "$(sparkle) Autocomplete" : "$(circle-slash) Autocomplete"
				vscode.window.showInformationMessage(`Autocomplete ${enabled ? "enabled" : "disabled"}`)
			}),
		)
	}

	const registerTextEditorEvents = (context: vscode.ExtensionContext): void => {
		context.subscriptions.push(
			vscode.window.onDidChangeTextEditorSelection((e) => {
				if (e.textEditor) {
					// Clear loading indicator when cursor moves
					if (isLoadingCompletion) {
						clearAutocompletePreview()
					}

					// Always hide the streaming decorator when cursor moves
					e.textEditor.setDecorations(loadingDecorationType, [])

					// If we've accepted the first line and cursor moves, reset state
					// This prevents showing remaining lines if user moves cursor after accepting first line
					if (hasAcceptedFirstLine && e.kind !== vscode.TextEditorSelectionChangeKind.Command) {
						clearAutocompletePreview()
					}
				}
			}),
		)

		context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (isLoadingCompletion) {
					clearAutocompletePreview()
				} else {
					const editor = vscode.window.activeTextEditor
					if (editor && editor.document === e.document) {
						editor.setDecorations(loadingDecorationType, [])
						editor.setDecorations(loadingDecorationType, [])
					}
				}
			}),
		)
	}

	const registerPreviewCommands = (context: vscode.ExtensionContext): void => {
		const acceptCommand = vscode.commands.registerCommand("kilo-code.acceptAutocompletePreview", async () => {
			console.log("Accepting autocomplete preview...")
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			// Handle the acceptance directly without calling commit again
			if (!hasAcceptedFirstLine && preview.remainingLines) {
				// First Tab press: Insert the first line
				if (preview.firstLine) {
					await editor.edit((editBuilder) => {
						editBuilder.insert(editor.selection.active, preview.firstLine)
					})

					hasAcceptedFirstLine = true

					// Wait a moment for the first line to be inserted
					setTimeout(async () => {
						await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
					}, 50)
				}
			} else if (hasAcceptedFirstLine && preview.remainingLines) {
				// Second Tab press: Insert the remaining lines
				await editor.edit((editBuilder) => {
					editBuilder.insert(editor.selection.active, preview.remainingLines)
				})

				clearAutocompletePreview()
			} else {
				// For single line completion or when preview.remainingLines is empty after first line acceptance
				// We need to ensure the full preview (which might be just the preview.firstLine if it was a single line)
				// is inserted if it hasn't been fully by VS Code's default commit.
				// However, the default commit (`editor.action.inlineSuggest.commit`) should handle this.
				// So, just clearing our state should be enough.
				clearAutocompletePreview()
			}
		})

		const dismissCommand = vscode.commands.registerCommand("kilo-code.dismissAutocompletePreview", () => {
			clearAutocompletePreview()
		})

		context.subscriptions.push(acceptCommand, dismissCommand)
	}

	const dispose = () => {
		if (isShowingAutocompletePreview) {
			clearAutocompletePreview()
		}

		if (inlineCompletionProviderDisposable) {
			inlineCompletionProviderDisposable.dispose()
			inlineCompletionProviderDisposable = null
		}

		loadingDecorationType.dispose()
		loadingDecorationType.dispose()
		vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, false)
	}

	const register = (context: vscode.ExtensionContext) => {
		inlineCompletionProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(
			{ pattern: "**" }, // All files
			{ provideInlineCompletionItems: (...args) => provideInlineCompletionItems(...args) },
		)
		context.subscriptions.push(inlineCompletionProviderDisposable)
		registerTextEditorEvents(context)
		registerPreviewCommands(context)

		context.subscriptions.push(
			vscode.commands.registerCommand("editor.action.inlineSuggest.commit", async () => {
				if (isShowingAutocompletePreview) {
					await vscode.commands.executeCommand("kilo-code.acceptAutocompletePreview")
				} else {
					// not sure if this is needed: leaving it here for now
					await vscode.commands.executeCommand("default:editor.action.inlineSuggest.commit")
				}
			}),
		)

		const statusBarItem = registerStatusBarItem(context)
		registerToggleCommand(context, statusBarItem)
	}

	register(context)
	context.subscriptions.push({ dispose })
}
