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

export function registerAutocomplete(context: vscode.ExtensionContext) {
	try {
		setupAutocomplete(context)
		console.log("� Kilo Code autocomplete provider registered")
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
		return responseText
	}
	if (fullMatch[2].endsWith("</COMPLETION>")) {
		return fullMatch[2].slice(0, -"</COMPLETION>".length)
	}
	return fullMatch[2]
}

function setupAutocomplete(context: vscode.ExtensionContext) {
	// State
	let enabled = true
	// let timer: NodeJS.Timeout | undefined
	let activeRequest: string | null = null
	let processedCompletion = ""

	// Services
	const contextGatherer = new ContextGatherer()
	const apiHandler = buildApiHandler({
		apiProvider: "kilocode",
		kilocodeToken: ContextProxy.instance.getProviderSettings().kilocodeToken,
		kilocodeModel: DEFAULT_MODEL,
	})

	const clearState = () => {
		processedCompletion = ""
		vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
		vscode.window.activeTextEditor?.setDecorations(loadingDecoration, [])
	}

	const provider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, context, token) {
			if (!enabled || !vscode.window.activeTextEditor) return null

			// Get exactly what's been typed on the current line
			const linePrefix = document
				.getText(new vscode.Range(new vscode.Position(position.line, 0), position))
				.trimStart()
			console.log(`�� Autocomplete for line with prefix: "${linePrefix}"!`)

			// New completion request
			const requestId = crypto.randomUUID()
			activeRequest = requestId
			vscode.window.activeTextEditor.setDecorations(loadingDecoration, [])

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
			// Stream completion
			const stream = apiHandler.createMessage(systemPrompt, [
				{ role: "user", content: [{ type: "text", text: userPrompt }] },
			])

			let completion = ""
			for await (const chunk of stream) {
				if (activeRequest !== requestId) break

				if (chunk.type === "text") {
					completion += chunk.text
					processedCompletion = processModelResponse(completion)
				}
			}

			console.log(`����������������� \n` + processedCompletion)

			if (activeRequest !== requestId || token.isCancellationRequested || !processedCompletion) return null

			const item = new vscode.InlineCompletionItem(processedCompletion)
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

	// Event handlers
	const selectionHandler = vscode.window.onDidChangeTextEditorSelection(() => {
		clearState()
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
		toggleCommand,
		statusBar,
		selectionHandler,
		documentHandler,
		loadingDecoration,
		{ dispose: clearState },
	)
}
