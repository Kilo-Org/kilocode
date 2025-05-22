//PLANREF: continue/core/autocomplete/CompletionProvider.ts
//PLANREF: continue/extensions/vscode/src/autocomplete/completionProvider.ts
import * as vscode from "vscode"
import { AutocompleteConfig } from "./AutocompleteConfig"
import { ApiHandler, buildApiHandler } from "../../api"
import { ContextGatherer } from "./ContextGatherer"
import { PromptRenderer } from "./PromptRenderer"
import { CompletionCache } from "./utils/CompletionCache"
import { ContextProxy } from "../../core/config/ContextProxy"

// Default configuration values
const DEFAULT_DEBOUNCE_DELAY = 150
const DEFAULT_MODEL = "google/gemini-2.5-flash-preview"
const MIN_TYPED_LENGTH_FOR_COMPLETION = 4

export class AutocompleteProvider {
	// API and completion state
	private apiHandler: ApiHandler
	private enabled: boolean = true
	private activeCompletionId: string | null = null

	// Throttling and debouncing
	private throttleTimeout: NodeJS.Timeout | null = null
	private debounceDelay: number = DEFAULT_DEBOUNCE_DELAY
	private pendingEditor: vscode.TextEditor | null = null

	// Core services
	private readonly cache: CompletionCache
	private readonly contextGatherer: ContextGatherer
	private readonly promptRenderer: PromptRenderer
	private readonly config: AutocompleteConfig

	// Preview display state
	private currentAutocompletePreview: string = ""
	private isShowingAutocompletePreview: boolean = false
	private isLoadingCompletion: boolean = false
	private autocompletePreviewVisibleContextKey: string = "kilo-code.autocompletePreviewVisible"
	private onCursorMoveCallback: ((editor: vscode.TextEditor) => void) | null = null

	// Decoration for preview display
	private decorationType: vscode.TextEditorDecorationType
	private loadingDecorationType: vscode.TextEditorDecorationType

	constructor() {
		this.cache = new CompletionCache()
		this.config = new AutocompleteConfig()
		this.contextGatherer = new ContextGatherer()
		this.promptRenderer = new PromptRenderer({}, DEFAULT_MODEL)

		const kilocodeToken = ContextProxy.instance.getProviderSettings().kilocodeToken
		this.apiHandler = buildApiHandler({
			apiProvider: "kilocode",
			kilocodeToken: kilocodeToken,
			kilocodeModel: DEFAULT_MODEL,
		})

		this.decorationType = vscode.window.createTextEditorDecorationType({
			after: {
				color: new vscode.ThemeColor("editorGhostText.foreground"),
				fontStyle: "italic",
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
		})

		this.loadingDecorationType = vscode.window.createTextEditorDecorationType({
			after: {
				color: new vscode.ThemeColor("editorGhostText.foreground"),
				fontStyle: "italic",
				contentText: "⏳",
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
		})
	}

	/**
	 * Register the autocomplete provider with VSCode
	 */
	register(context: vscode.ExtensionContext): vscode.Disposable {
		// Register event handlers for preview text
		this.registerTextEditorEvents(context)

		// Register commands for accepting/dismissing preview
		this.registerPreviewCommands(context)

		// Register self as cursor move callback
		this.onCursorMoveCallback = (editor) => {
			this.triggerCompletion(editor.document, editor.selection.active)
		}

		// Register UI components and event handlers
		const statusBarItem = this.registerStatusBarItem(context)
		this.registerConfigurationWatcher(context)
		this.registerToggleCommand(context, statusBarItem)

		return {
			dispose: () => this.dispose(),
		}
	}

	/**
	 * Register status bar item to show autocomplete status
	 */
	private registerStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		statusBarItem.text = "$(sparkle) Autocomplete"
		statusBarItem.tooltip = "Kilo Code Autocomplete"
		statusBarItem.command = "kilo-code.toggleAutocomplete"
		statusBarItem.show()
		context.subscriptions.push(statusBarItem)
		return statusBarItem
	}

	/**
	 * Register configuration change watcher
	 */
	private registerConfigurationWatcher(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration("kilo-code.autocomplete")) {
					const config = vscode.workspace.getConfiguration("kilo-code")
					this.debounceDelay = config.get("autocomplete.debounceDelay") || DEFAULT_DEBOUNCE_DELAY
				}
			}),
		)
	}

	/**
	 * Register command to toggle autocomplete
	 */
	private registerToggleCommand(context: vscode.ExtensionContext, statusBarItem: vscode.StatusBarItem): void {
		context.subscriptions.push(
			vscode.commands.registerCommand("kilo-code.toggleAutocomplete", () => {
				this.enabled = !this.enabled
				statusBarItem.text = this.enabled ? "$(sparkle) Autocomplete" : "$(circle-slash) Autocomplete"
				vscode.window.showInformationMessage(`Autocomplete ${this.enabled ? "enabled" : "disabled"}`)
			}),
		)
	}

	/**
	 * Register editor event handlers for tracking cursor position and document changes
	 */
	private registerTextEditorEvents(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.window.onDidChangeTextEditorSelection((e) => {
				if (e.textEditor) {
					// Clear both preview and loading indicator when cursor moves
					if (this.isShowingAutocompletePreview || this.isLoadingCompletion) {
						this.clearAutocompletePreview()
					}

					if (this.onCursorMoveCallback) {
						this.onCursorMoveCallback(e.textEditor)
					}
				}
			}),
		)

		// Register document change event
		context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument((_e) => {
				if (this.isShowingAutocompletePreview || this.isLoadingCompletion) {
					this.clearAutocompletePreview()
				}
			}),
		)
	}

	/**
	 * Register commands for accepting and dismissing preview text
	 */
	private registerPreviewCommands(context: vscode.ExtensionContext): void {
		// Accept command
		const acceptCommand = vscode.commands.registerCommand("kilo-code.acceptAutocompletePreview", () => {
			const editor = vscode.window.activeTextEditor
			if (editor && this.isShowingAutocompletePreview && this.currentAutocompletePreview) {
				const pos = editor.selection.active
				editor
					.edit((editBuilder) => {
						editBuilder.insert(pos, this.currentAutocompletePreview)
					})
					.then(() => {
						this.clearAutocompletePreview()
					})
			}
		})

		// Dismiss command
		const dismissCommand = vscode.commands.registerCommand("kilo-code.dismissAutocompletePreview", () => {
			if (this.isShowingAutocompletePreview) {
				this.clearAutocompletePreview()
			}
		})

		context.subscriptions.push(acceptCommand, dismissCommand)
	}

	/**
	 * Shows the loading indicator at the current cursor position
	 */
	private showLoadingIndicator(editor: vscode.TextEditor): void {
		// Clear any existing preview first
		this.clearAutocompletePreview()

		// Set the loading state
		this.isLoadingCompletion = true

		// Show the loading decoration
		const position = editor.selection.active
		const decoration: vscode.DecorationOptions = {
			range: new vscode.Range(position, position),
		}

		editor.setDecorations(this.loadingDecorationType, [decoration])
	}

	/**
	 * Triggers a completion request when cursor moves or document changes
	 */
	private triggerCompletion(document: vscode.TextDocument, position: vscode.Position): void {
		// Don't trigger if autocomplete is disabled
		if (!this.enabled || this.isFileDisabled(document)) {
			return
		}

		const editor = vscode.window.activeTextEditor
		if (editor && editor.document === document) {
			// Clear any existing debounce timeout
			if (this.throttleTimeout) {
				clearTimeout(this.throttleTimeout)
			}

			// Set a new debounce timeout
			this.throttleTimeout = setTimeout(async () => {
				try {
					// Show loading indicator before starting the request
					this.showLoadingIndicator(editor)

					// Get completion text
					const completionText = await this.getCompletionText(
						document,
						position,
						{} as vscode.InlineCompletionContext,
						new vscode.CancellationTokenSource().token,
					)

					if (completionText) {
						const lineText = document.lineAt(position.line).text
						const textBeforeCursor = lineText.substring(0, position.character)
						const finalCompletionText = this.removeMatchingPrefix(textBeforeCursor, completionText)
						this.updateAutocompletePreview(editor, finalCompletionText)
					} else {
						// Clear the loading indicator if no completion was generated
						this.clearAutocompletePreview()
					}
				} catch (error) {
					console.error("Error triggering completion:", error)
					// Clear the loading indicator on error
					this.clearAutocompletePreview()
				}
				this.throttleTimeout = null
			}, this.debounceDelay)
		}
	}

	/**
	 * Gets the completion text for the given document and position
	 */
	private async getCompletionText(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<string | null> {
		try {
			const cursorIndex = document.offsetAt(position)

			// Get the current line text up to the cursor position
			const lineText = document.lineAt(position.line).text
			const textBeforeCursor = lineText.substring(0, position.character).trimStart()

			// Generate a new completion
			const result = await this.generateCompletionText(document, position, context, token)
			if (!result) return null

			// Remove any matching prefix from the result
			const finalCompletionText = this.removeMatchingPrefix(textBeforeCursor, result)

			// Cache the result
			this.cache.set(document.uri.toString(), document.getText(), cursorIndex, finalCompletionText)

			return finalCompletionText
		} catch (error) {
			console.error("Error getting completion text:", error)

			// Make sure to clear the loading indicator on error
			const editor = vscode.window.activeTextEditor
			if (editor && this.isLoadingCompletion) {
				editor.setDecorations(this.loadingDecorationType, [])
				this.isLoadingCompletion = false
			}

			return null
		}
	}

	/**
	 * Efficiently removes matching prefix from completion result
	 */
	private removeMatchingPrefix(textBeforeCursor: string, result: string): string {
		if (!textBeforeCursor || !result.startsWith(textBeforeCursor)) {
			return result
		}
		return result.slice(textBeforeCursor.length)
	}

	/**
	 * Generates a new completion text
	 */
	private async generateCompletionText(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<string | null> {
		// Generate a unique ID for this completion
		const completionId = crypto.randomUUID()
		this.activeCompletionId = completionId

		// Load configuration
		const conf = await this.config.loadConfig()
		const useImports = conf?.useImports || false
		const useDefinitions = conf?.onlyMyCode || false
		const multilineCompletions = conf?.multilineCompletions || "auto"

		// Gather context
		const codeContext = await this.contextGatherer.gatherContext(document, position, useImports, useDefinitions)

		// Render prompts
		const prompt = this.promptRenderer.renderPrompt(codeContext, {
			language: document.languageId,
			includeImports: useImports,
			includeDefinitions: useDefinitions,
			multilineCompletions: multilineCompletions as any,
		})
		const systemPrompt = this.promptRenderer.renderSystemPrompt()

		// Setup cancellation
		const abortController = new AbortController()
		token.onCancellationRequested(() => {
			abortController.abort()
			if (this.activeCompletionId === completionId) {
				this.activeCompletionId = null
			}
		})

		// Process the completion stream
		const result = await this.processCompletionStream(systemPrompt, prompt, completionId, document)

		if (result.isCancelled || token.isCancellationRequested) {
			// Make sure to clear the loading indicator if the completion is cancelled
			const editor = vscode.window.activeTextEditor
			if (editor && this.isLoadingCompletion) {
				editor.setDecorations(this.loadingDecorationType, [])
				this.isLoadingCompletion = false
			}
			return null
		}

		// Validate completion against selection context
		if (!this.validateCompletionContext(context, document)) {
			// Make sure to clear the loading indicator if validation fails
			const editor = vscode.window.activeTextEditor
			if (editor && this.isLoadingCompletion) {
				editor.setDecorations(this.loadingDecorationType, [])
				this.isLoadingCompletion = false
			}
			return null
		}

		return this.cleanMarkdownCodeBlocks(result.completion)
	}

	/**
	 * Updates the preview text at the current cursor position
	 */
	private updateAutocompletePreview(editor: vscode.TextEditor, text: string) {
		this.currentAutocompletePreview = text

		if (!text) {
			this.clearAutocompletePreview()
			return
		}

		// Make sure to clear the loading indicator
		this.isLoadingCompletion = false
		editor.setDecorations(this.loadingDecorationType, [])

		// Update with decorator (we're now only using decorators, not inline completion)
		const position = editor.selection.active
		const decoration: vscode.DecorationOptions = {
			range: new vscode.Range(position, position),
			renderOptions: { after: { contentText: text } },
		}

		// Apply the decoration
		editor.setDecorations(this.decorationType, [decoration])
		this.isShowingAutocompletePreview = true

		// Update the context for keybindings
		vscode.commands.executeCommand("setContext", this.autocompletePreviewVisibleContextKey, true)
	}

	/**
	 * Clears any displayed preview text and loading indicator
	 */
	public clearAutocompletePreview() {
		this.isShowingAutocompletePreview = false
		this.isLoadingCompletion = false
		this.currentAutocompletePreview = ""

		// Clear decorators
		const editor = vscode.window.activeTextEditor
		if (editor) {
			editor.setDecorations(this.decorationType, [])
			editor.setDecorations(this.loadingDecorationType, [])
		}

		// Update the context for keybindings
		vscode.commands.executeCommand("setContext", this.autocompletePreviewVisibleContextKey, false)
	}

	/**
	 * Processes the completion stream and returns the result
	 */
	private async processCompletionStream(
		systemPrompt: string,
		prompt: string,
		completionId: string,
		document: vscode.TextDocument,
	): Promise<{ completion: string; isCancelled: boolean }> {
		let completion = ""
		let isCancelled = false
		const currentCompletionId = completionId

		// Function to check if the request has been cancelled
		const checkCancellation = () => {
			if (this.activeCompletionId !== currentCompletionId) {
				isCancelled = true
				return true
			}
			return false
		}

		// Create the stream using the API handler's createMessage method
		// Note: Stop tokens are embedded in the prompt template format instead of passed directly
		const stream = this.apiHandler.createMessage(systemPrompt, [
			{ role: "user", content: [{ type: "text", text: prompt }] },
		])

		// Get the editor for streaming updates
		const editor = vscode.window.activeTextEditor

		// Stream updates to the preview display
		for await (const chunk of stream) {
			if (checkCancellation()) {
				break
			}

			if (chunk.type === "text") {
				completion += chunk.text

				// If we have a throttle timeout already, clear it
				if (this.throttleTimeout) {
					clearTimeout(this.throttleTimeout)
				}

				// Store the pending editor
				this.pendingEditor = editor || null

				// Set a new throttle timeout
				this.throttleTimeout = setTimeout(() => {
					if (this.pendingEditor && this.pendingEditor.document === document) {
						const cleanedText = this.cleanMarkdownCodeBlocks(completion)
						this.updateAutocompletePreview(this.pendingEditor, cleanedText)
					}
					this.throttleTimeout = null
				}, this.debounceDelay)
			}
		}

		return { completion, isCancelled }
	}

	/**
	 * Cleans markdown-style code blocks from text
	 */
	private cleanMarkdownCodeBlocks(text: string): string {
		// Handle complete code blocks
		let cleanedText = text.replace(/```[\w-]*\n([\s\S]*?)\n```/g, "$1")

		// Handle opening code block markers at the beginning of a chunk
		cleanedText = cleanedText.replace(/^```[\w-]*\n/g, "")

		// Handle opening code block markers in the middle of a chunk
		cleanedText = cleanedText.replace(/\n```[\w-]*\n/g, "\n")

		// Handle closing code block markers
		cleanedText = cleanedText.replace(/\n```$/g, "")

		// Handle any remaining backticks that might be part of incomplete code blocks
		cleanedText = cleanedText.replace(/```[\w-]*$/g, "")

		// Trim any leading/trailing whitespace that might be left over
		return cleanedText.trim()
	}

	/**
	 * Validates the completion context against the selected completion info
	 */
	private validateCompletionContext(context: vscode.InlineCompletionContext, document: vscode.TextDocument): boolean {
		const selectedCompletionInfo = context.selectedCompletionInfo
		if (selectedCompletionInfo) {
			const { text, range } = selectedCompletionInfo
			const typedText = document.getText(range)
			const typedLength = range.end.character - range.start.character

			if (typedLength < MIN_TYPED_LENGTH_FOR_COMPLETION || !text.startsWith(typedText)) {
				return false
			}
		}
		return true
	}

	/**
	 * Checks if autocomplete is disabled for the given document based on file patterns
	 */
	private isFileDisabled(document: vscode.TextDocument): boolean {
		const config = vscode.workspace.getConfiguration("kilo-code")
		const disabledPatterns = config.get<string>("autocomplete.disableInFiles") || ""
		const patterns = disabledPatterns
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean)

		return patterns.some((pattern) => {
			const glob = new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "", pattern)
			return vscode.languages.match({ pattern: glob }, document)
		})
	}

	/**
	 * Cleans up resources when the provider is no longer needed
	 */
	public dispose() {
		// Clear any throttle timeout
		if (this.throttleTimeout) {
			clearTimeout(this.throttleTimeout)
			this.throttleTimeout = null
		}

		// Clear any active preview text
		if (this.isShowingAutocompletePreview) {
			this.clearAutocompletePreview()
		}

		// Dispose of the decorator types
		this.decorationType.dispose()
		this.loadingDecorationType.dispose()
	}
}
