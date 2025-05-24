import * as vscode from "vscode"
import { buildApiHandler } from "../../api"
import { ContextGatherer } from "./ContextGatherer"
import { PromptRenderer } from "./PromptRenderer"
import { ContextProxy } from "../../core/config/ContextProxy"
import { generateImportSnippets, generateDefinitionSnippets } from "./context/snippetProvider"

// Configuration
export const UI_UPDATE_DEBOUNCE_MS = 150
const DEFAULT_MODEL = "mistralai/codestral-2501"
const MIN_TYPED_LENGTH = 4
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

function cleanMarkdown(text: string): string {
	return text
		.replace(/```[\w-]*\n([\s\S]*?)\n```/g, "$1")
		.replace(/^```[\w-]*\n/g, "")
		.replace(/\n```[\w-]*\n/g, "\n")
		.replace(/\n```$/g, "")
		.replace(/```[\w-]*$/g, "")
		.trim()
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

function shouldProvideCompletion(
	context: vscode.InlineCompletionContext,
	document: vscode.TextDocument,
	position: vscode.Position,
): boolean {
	if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke) return true

	const editor = vscode.window.activeTextEditor
	const pos = editor?.document.uri === document.uri ? editor.selection.active : position
	const line = document.lineAt(context.selectedCompletionInfo?.range.start.line ?? pos.line)
	const textBefore = line.text.substring(0, context.selectedCompletionInfo?.range.start.character ?? pos.character)

	return textBefore.trim().length >= MIN_TYPED_LENGTH
}

function setupAutocomplete(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand("setContext", PREVIEW_CONTEXT_KEY, false)

	// State
	let enabled = true
	let activeRequest: string | null = null
	let pendingCompletion = ""
	let acceptedFirstLine = false

	// Services
	const contextGatherer = new ContextGatherer()
	const promptRenderer = new PromptRenderer({}, DEFAULT_MODEL)
	const apiHandler = buildApiHandler({
		apiProvider: "kilocode",
		kilocodeToken: ContextProxy.instance.getProviderSettings().kilocodeToken,
		kilocodeModel: DEFAULT_MODEL,
	})

	const clearState = () => {
		pendingCompletion = ""
		acceptedFirstLine = false
		vscode.commands.executeCommand("setContext", PREVIEW_CONTEXT_KEY, false)
		vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
		vscode.window.activeTextEditor?.setDecorations(loadingDecoration, [])
	}

	const provider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, context, token) {
			const beginT = performance.now()
			token.onCancellationRequested((e) => console.log("cancellation after ", performance.now() - beginT, e))
			console.log("trigger AAA")
			if (!enabled || isFileDisabled(document) || !shouldProvideCompletion(context, document, position)) {
				return null
			}

			// Handle multi-line completion flow
			if (acceptedFirstLine && pendingCompletion) {
				const lines = pendingCompletion.split(/\r?\n/)
				const remaining = lines.slice(1).join("\n")
				if (remaining) {
					vscode.commands.executeCommand("setContext", PREVIEW_CONTEXT_KEY, true)
					console.log("return comp-remaining ", remaining)
					return [new vscode.InlineCompletionItem(remaining)]
				}
				clearState()
				console.log("return comp-done ")
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

				const prompt = promptRenderer.renderPrompt(codeContext, snippets, {
					language: document.languageId,
					includeImports: true,
					includeDefinitions: true,
					multilineCompletions: "auto" as any,
				})
				console.log(promptRenderer.renderSystemPrompt(), prompt.prompt, token.isCancellationRequested)
				// Stream completion
				const stream = apiHandler.createMessage(promptRenderer.renderSystemPrompt(), [
					{ role: "user", content: [{ type: "text", text: prompt.prompt }] },
				])

				let completion = ""
				let throttleTimer: NodeJS.Timeout | null = null

				for await (const chunk of stream) {
					console.log("stream chunk", chunk, activeRequest !== requestId, token.isCancellationRequested)
					if (activeRequest !== requestId) break

					if (chunk.type === "text") {
						completion += chunk.text
						pendingCompletion = cleanMarkdown(completion)

						// Throttle UI updates
						console.log("update inline suggest", pendingCompletion, token.isCancellationRequested)
						if (throttleTimer) clearTimeout(throttleTimer)
						throttleTimer = setTimeout(() => {
							vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
						}, UI_UPDATE_DEBOUNCE_MS)
					}
				}

				if (throttleTimer) clearTimeout(throttleTimer)
				editor.setDecorations(loadingDecoration, [])
				console.log("return post-stream-cancelled", activeRequest !== requestId, token.isCancellationRequested)

				if (activeRequest !== requestId || token.isCancellationRequested) {
					return null
				}
				console.log("return first-line ", firstLine)

				const firstLine = pendingCompletion.split(/\r?\n/)[0]
				if (!firstLine) return null

				vscode.commands.executeCommand("setContext", PREVIEW_CONTEXT_KEY, true)

				const item = new vscode.InlineCompletionItem(firstLine)
				item.command = {
					command: "kilo-code.acceptAutocompletePreview",
					title: "Accept Completion",
				}
				console.log("return completion", item)
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

		if (!acceptedFirstLine) {
			// Accept first line
			const firstLine = pendingCompletion.split(/\r?\n/)[0]
			await editor.edit((edit) => edit.insert(editor.selection.active, firstLine))
			acceptedFirstLine = true

			// Trigger for remaining lines
			setTimeout(() => vscode.commands.executeCommand("editor.action.inlineSuggest.trigger"), 50)
		} else {
			// Accept remaining lines
			const lines = pendingCompletion.split(/\r?\n/)
			const remaining = lines.slice(1).join("\n")
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
	const selectionHandler = vscode.window.onDidChangeTextEditorSelection(clearState)
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
