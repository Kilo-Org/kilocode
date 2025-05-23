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
interface CompletionSuggestion {
	firstLine: string
	remainingLines: string
	rawCompletion: string
}
const emptyCompletion: CompletionSuggestion = {
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
const processCompletionText = (rawText: string): CompletionSuggestion => {
	// Clean markdown code blocks once
	const cleanedText = rawText
		.replace(/```[\w-]*\n([\s\S]*?)\n```/g, "$1") // Handle complete code blocks
		.replace(/^```[\w-]*\n/g, "") // Handle opening code block markers at the beginning of a chunk
		.replace(/\n```[\w-]*\n/g, "\n") // Handle opening code block markers in the middle of a chunk
		.replace(/\n```$/g, "") // Handle closing code block markers
		.replace(/```[\w-]*$/g, "") // Handle any remaining backticks that might be part of incomplete code blocks
		.trim() // Trim any leading/trailing whitespace that might be left over

	// Split into first line and remaining lines
	const firstLine = cleanedText.split(/\r?\n/, 1)[0]

	return {
		firstLine,
		remainingLines: cleanedText.substring(firstLine.length),
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

function setUpStatusBarToggleButton(context: vscode.ExtensionContext, toggleEnabled: () => boolean) {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBarItem.text = "$(sparkle) Autocomplete"
	statusBarItem.tooltip = "Kilo Code Autocomplete"
	statusBarItem.command = "kilo-code.toggleAutocomplete"
	statusBarItem.show()
	context.subscriptions.push(statusBarItem)

	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.toggleAutocomplete", () => {
			const enabled = toggleEnabled()
			statusBarItem.text = enabled ? "$(sparkle) Autocomplete" : "$(circle-slash) Autocomplete"
			vscode.window.showInformationMessage(`Autocomplete ${enabled ? "enabled" : "disabled"}`)
		}),
	)
}

async function acceptSuggestion(isShowingAutocompletePreview: boolean) {
	if (isShowingAutocompletePreview) {
		await vscode.commands.executeCommand("kilo-code.acceptAutocompletePreview")
	} else {
		// not sure if this is needed: leaving it here for now
		await vscode.commands.executeCommand("default:editor.action.inlineSuggest.commit")
	}
}

function logCompletionResult(
	result: CompletionSuggestion | null,
	completionId: string,
	duration: number,
	promptString: string,
) {
	if (!result) {
		console.info(`Completion ${completionId} CANCELLED in ${duration} ms`)
	} else {
		console.info(`
Completion ${completionId} generated in ${duration} ms.

🙈 Prompt:
${promptString}


🤖 Completion:
${result.rawCompletion}

🤖 first line:
${result.firstLine}

🤖 remaining:
${result.remainingLines}
				`)
	}
}

function hookAutocompleteInner(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, false)

	// Shared state encapsulated in closure
	let enabled = true
	let activeCompletionId: string | null = null
	let inlineCompletionProviderDisposable: vscode.Disposable | null = null

	let suggestedCompletion = emptyCompletion
	let hasAcceptedFirstLine = false
	let isShowingAutocompletePreview = false

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
		suggestedCompletion = emptyCompletion
		hasAcceptedFirstLine = false
		isShowingAutocompletePreview = false

		// Clear loading indicators
		const editor = vscode.window.activeTextEditor
		if (editor) {
			editor.setDecorations(loadingDecorationType, [])
		}

		vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, false)
		vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
	}

	const createCompletionItems = async (
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | null> => {
		// Handle remaining lines from previously accepted first line
		if (hasAcceptedFirstLine && suggestedCompletion.remainingLines) {
			const item = new vscode.InlineCompletionItem(suggestedCompletion.remainingLines)
			item.command = { command: "editor.action.inlineSuggest.commit", title: "Accept Completion" }
			isShowingAutocompletePreview = true
			vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, true)
			return [item]
		}

		const completionId = crypto.randomUUID()
		activeCompletionId = completionId
		hasAcceptedFirstLine = false

		const useImports = true
		const useDefinitions = true
		const multilineCompletions = "auto"
		const codeContext = await contextGatherer.gatherContext(document, position, useImports, useDefinitions)
		const editor = vscode.window.activeTextEditor
		if (editor && editor.document === document) {
			showStreamingIndicator(editor)
		}

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
		const promptString = prompt.prompt
		let completion = ""
		let isCancelled = true
		let firstLineComplete = false
		let throttleTimeout: NodeJS.Timeout | null = null

		// Create the stream using the API handler's createMessage method
		// Note: Stop tokens are embedded in the prompt template format instead of passed directly
		const stream = apiHandler.createMessage(systemPrompt, [
			{ role: "user", content: [{ type: "text", text: promptString }] },
		])

		if (editor) {
			isCancelled = false
			editor.setDecorations(loadingDecorationType, [])

			for await (const chunk of stream) {
				if (activeCompletionId !== completionId) {
					isCancelled = true
					break
				}

				if (chunk.type === "text") {
					completion += chunk.text
					suggestedCompletion = processCompletionText(completion)

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
		}

		const duration = performance.now() - startTime
		logCompletionResult(isCancelled ? null : suggestedCompletion, completionId, duration, promptString)

		if (isCancelled || token.isCancellationRequested || !validateCompletionContext(context, document, position)) {
			return null
		}

		isShowingAutocompletePreview = true
		vscode.commands.executeCommand("setContext", AUTOCOMPLETE_PREVIEW_VISIBLE_CONTEXT_KEY, true)

		const item = new vscode.InlineCompletionItem(suggestedCompletion.firstLine)
		item.command = {
			command: "kilo-code.acceptAutocompletePreview",
			title: "Accept Completion",
		}
		return [item]
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
			return await createCompletionItems(document, position, context, token)
		} catch (error) {
			console.error("Error providing inline completion:", error)
			return null
		}
	}

	inlineCompletionProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(
		{ pattern: "**" }, // All files
		{ provideInlineCompletionItems: (...args) => provideInlineCompletionItems(...args) },
	)

	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(() => {
			clearAutocompletePreview()
		}),
	)

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((e) => {
			const editor = vscode.window.activeTextEditor
			if (editor && editor.document === e.document) {
				editor.setDecorations(loadingDecorationType, [])
			}
		}),
	)

	const acceptCommand = vscode.commands.registerCommand("kilo-code.acceptAutocompletePreview", async () => {
		console.log("Accepting autocomplete preview...")
		const editor = vscode.window.activeTextEditor
		if (!editor) return

		// Handle the acceptance directly without calling commit again
		if (!hasAcceptedFirstLine) {
			// First Tab press: Insert the first line
			if (suggestedCompletion.firstLine) {
				await editor.edit((editBuilder) => {
					editBuilder.insert(editor.selection.active, suggestedCompletion.firstLine)
				})

				hasAcceptedFirstLine = true

				// Wait a moment for the first line to be inserted
				setTimeout(async () => {
					await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
				}, 50)
			}
		} else if (hasAcceptedFirstLine && suggestedCompletion.remainingLines) {
			// Second Tab press: Insert the remaining lines
			await editor.edit((editBuilder) => {
				editBuilder.insert(editor.selection.active, suggestedCompletion.remainingLines)
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

	const dismissCommand = vscode.commands.registerCommand("kilo-code.dismissAutocompletePreview", () =>
		clearAutocompletePreview(),
	)

	context.subscriptions.push(acceptCommand, dismissCommand)
	setUpStatusBarToggleButton(context, () => (enabled = !enabled))

	const commitSuggestionCommand = vscode.commands.registerCommand("editor.action.inlineSuggest.commit", () =>
		acceptSuggestion(isShowingAutocompletePreview),
	)

	context.subscriptions.push(commitSuggestionCommand)
	context.subscriptions.push(inlineCompletionProviderDisposable)
	context.subscriptions.push({ dispose: () => clearAutocompletePreview() })
	context.subscriptions.push(loadingDecorationType)
}
