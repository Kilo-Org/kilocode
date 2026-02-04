/**
 * WindowAPI class for VSCode API
 */

import { logs } from "../utils/logger.js"
import { Uri } from "../classes/Uri.js"
import { Position } from "../classes/Position.js"
import { Range } from "../classes/Range.js"
import { Selection } from "../classes/Selection.js"
import { EventEmitter } from "../classes/EventEmitter.js"
import { ThemeIcon } from "../classes/Additional.js"
import { OutputChannel } from "../classes/OutputChannel.js"
import { StatusBarItem } from "../classes/StatusBarItem.js"
import { TextEditorDecorationType } from "../classes/TextEditorDecorationType.js"
import { TabGroupsAPI } from "./TabGroupsAPI.js"
import { StatusBarAlignment, ViewColumn } from "../types.js"
import type { WorkspaceAPI } from "./WorkspaceAPI.js"
import type { Thenable } from "../types.js"
import type {
	TextEditor,
	TextEditorSelectionChangeEvent,
	TextDocumentShowOptions,
	DecorationRenderOptions,
} from "../interfaces/editor.js"
import type { TextDocument } from "../interfaces/document.js"
import type { Terminal, TerminalDimensionsChangeEvent, TerminalDataWriteEvent } from "../interfaces/terminal.js"
import type {
	WebviewViewProvider,
	WebviewView,
	Webview,
	ViewBadge,
	WebviewViewProviderOptions,
	UriHandler,
} from "../interfaces/webview.js"
import type { QuickPickOptions, InputBoxOptions, OpenDialogOptions, Disposable } from "../interfaces/workspace.js"
import type { CancellationToken } from "../interfaces/document.js"

/**
 * Window API mock for CLI mode
 */
export class WindowAPI {
	public tabGroups: TabGroupsAPI
	public visibleTextEditors: TextEditor[] = []
	public _onDidChangeVisibleTextEditors = new EventEmitter<TextEditor[]>()
	private _workspace?: WorkspaceAPI
	private static _decorationCounter = 0

	constructor() {
		this.tabGroups = new TabGroupsAPI()
	}

	setWorkspace(workspace: WorkspaceAPI) {
		this._workspace = workspace
	}

	createOutputChannel(name: string): OutputChannel {
		return new OutputChannel(name)
	}

	createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem
	createStatusBarItem(id?: string, alignment?: StatusBarAlignment, priority?: number): StatusBarItem
	createStatusBarItem(
		idOrAlignment?: string | StatusBarAlignment,
		alignmentOrPriority?: StatusBarAlignment | number,
		priority?: number,
	): StatusBarItem {
		// Handle overloaded signatures
		let actualAlignment: StatusBarAlignment
		let actualPriority: number | undefined

		if (typeof idOrAlignment === "string") {
			// Called with id, alignment, priority
			actualAlignment = (alignmentOrPriority as StatusBarAlignment) ?? StatusBarAlignment.Left
			actualPriority = priority
		} else {
			// Called with alignment, priority
			actualAlignment = (idOrAlignment as StatusBarAlignment) ?? StatusBarAlignment.Left
			actualPriority = alignmentOrPriority as number | undefined
		}

		return new StatusBarItem(actualAlignment, actualPriority)
	}

	createTextEditorDecorationType(_options: DecorationRenderOptions): TextEditorDecorationType {
		return new TextEditorDecorationType(`decoration-${++WindowAPI._decorationCounter}`)
	}

	createTerminal(options?: {
		name?: string
		shellPath?: string
		shellArgs?: string[]
		cwd?: string
		env?: { [key: string]: string | null | undefined }
		iconPath?: ThemeIcon
		hideFromUser?: boolean
		message?: string
		strictEnv?: boolean
	}): Terminal {
		// Return a mock terminal object
		return {
			name: options?.name || "Terminal",
			processId: Promise.resolve(undefined),
			creationOptions: options || {},
			exitStatus: undefined,
			state: { isInteractedWith: false },
			sendText: (text: string, _addNewLine?: boolean) => {
				logs.debug(`Terminal sendText: ${text}`, "VSCode.Terminal")
			},
			show: (_preserveFocus?: boolean) => {
				logs.debug("Terminal show called", "VSCode.Terminal")
			},
			hide: () => {
				logs.debug("Terminal hide called", "VSCode.Terminal")
			},
			dispose: () => {
				logs.debug("Terminal disposed", "VSCode.Terminal")
			},
		}
	}

	showInformationMessage(message: string, ..._items: string[]): Thenable<string | undefined> {
		logs.info(message, "VSCode.Window")
		return Promise.resolve(undefined)
	}

	showWarningMessage(message: string, ..._items: string[]): Thenable<string | undefined> {
		logs.warn(message, "VSCode.Window")
		return Promise.resolve(undefined)
	}

	showErrorMessage(message: string, ..._items: string[]): Thenable<string | undefined> {
		logs.error(message, "VSCode.Window")
		return Promise.resolve(undefined)
	}

	showQuickPick(items: string[], _options?: QuickPickOptions): Thenable<string | undefined> {
		// Return first item for CLI
		return Promise.resolve(items[0])
	}

	showInputBox(_options?: InputBoxOptions): Thenable<string | undefined> {
		// Return empty string for CLI
		return Promise.resolve("")
	}

	showOpenDialog(_options?: OpenDialogOptions): Thenable<Uri[] | undefined> {
		// Return empty array for CLI
		return Promise.resolve([])
	}

	async showTextDocument(
		documentOrUri: TextDocument | Uri,
		columnOrOptions?: ViewColumn | TextDocumentShowOptions,
		_preserveFocus?: boolean,
	): Promise<TextEditor> {
		// Mock implementation for CLI
		// In a real VSCode environment, this would open the document in an editor
		const uri = documentOrUri instanceof Uri ? documentOrUri : documentOrUri.uri
		logs.debug(`showTextDocument called for: ${uri?.toString() || "unknown"}`, "VSCode.Window")

		// Create a placeholder editor first so it's in visibleTextEditors when onDidOpenTextDocument fires
		const placeholderEditor: TextEditor = {
			document: { uri } as TextDocument,
			selection: new Selection(new Position(0, 0), new Position(0, 0)),
			selections: [new Selection(new Position(0, 0), new Position(0, 0))],
			visibleRanges: [new Range(new Position(0, 0), new Position(0, 0))],
			options: {},
			viewColumn: typeof columnOrOptions === "number" ? columnOrOptions : ViewColumn.One,
			edit: () => Promise.resolve(true),
			insertSnippet: () => Promise.resolve(true),
			setDecorations: () => {},
			revealRange: () => {},
			show: () => {},
			hide: () => {},
		}

		// Add placeholder to visible editors BEFORE opening document
		this.visibleTextEditors.push(placeholderEditor)
		logs.debug(
			`Placeholder editor added to visibleTextEditors, total: ${this.visibleTextEditors.length}`,
			"VSCode.Window",
		)

		// If we have a URI, open the document (this will fire onDidOpenTextDocument)
		let document: TextDocument | Uri = documentOrUri
		if (documentOrUri instanceof Uri && this._workspace) {
			logs.debug("Opening document via workspace.openTextDocument", "VSCode.Window")
			document = await this._workspace.openTextDocument(uri)
			logs.debug("Document opened successfully", "VSCode.Window")

			// Update the placeholder editor with the real document
			placeholderEditor.document = document
		}

		// Fire events immediately using setImmediate
		setImmediate(() => {
			logs.debug("Firing onDidChangeVisibleTextEditors event", "VSCode.Window")
			this._onDidChangeVisibleTextEditors.fire(this.visibleTextEditors)
			logs.debug("onDidChangeVisibleTextEditors event fired", "VSCode.Window")
		})

		logs.debug("Returning editor from showTextDocument", "VSCode.Window")
		return placeholderEditor
	}

	registerWebviewViewProvider(
		viewId: string,
		provider: WebviewViewProvider,
		_options?: WebviewViewProviderOptions,
	): Disposable {
		// Store the provider for later use by ExtensionHost
		if ((global as unknown as { __extensionHost?: unknown }).__extensionHost) {
			const extensionHost = (
				global as unknown as {
					__extensionHost: {
						registerWebviewProvider: (viewId: string, provider: WebviewViewProvider) => void
						isInInitialSetup: () => boolean
						markWebviewReady: () => void
					}
				}
			).__extensionHost
			extensionHost.registerWebviewProvider(viewId, provider)

			// Set up webview mock that captures messages from the extension
			const mockWebview = {
				postMessage: (message: unknown): Thenable<boolean> => {
					// Forward extension messages to ExtensionHost for CLI consumption
					if ((global as unknown as { __extensionHost?: unknown }).__extensionHost) {
						;(
							global as unknown as {
								__extensionHost: { emit: (event: string, message: unknown) => void }
							}
						).__extensionHost.emit("extensionWebviewMessage", message)
					}
					return Promise.resolve(true)
				},
				onDidReceiveMessage: (listener: (message: unknown) => void) => {
					// This is how the extension listens for messages from the webview
					// We need to connect this to our message bridge
					if ((global as unknown as { __extensionHost?: unknown }).__extensionHost) {
						;(
							global as unknown as {
								__extensionHost: { on: (event: string, listener: (message: unknown) => void) => void }
							}
						).__extensionHost.on("webviewMessage", listener)
					}
					return { dispose: () => {} }
				},
				asWebviewUri: (uriArg: Uri) => {
					// Convert file URIs to webview-compatible URIs
					// For CLI, we can just return a mock webview URI
					return Uri.parse(`vscode-webview://webview/${uriArg.path}`)
				},
				html: "",
				options: {},
				cspSource: "vscode-webview:",
			}

			// Provide the mock webview to the provider
			if (provider.resolveWebviewView) {
				const mockWebviewView = {
					webview: mockWebview as Webview,
					viewType: viewId,
					title: viewId,
					description: undefined as string | undefined,
					badge: undefined as ViewBadge | undefined,
					show: () => {},
					onDidChangeVisibility: () => ({ dispose: () => {} }),
					onDidDispose: () => ({ dispose: () => {} }),
					visible: true,
				}

				// Call resolveWebviewView immediately with initialization context
				// No setTimeout needed - use event-based synchronization instead
				;(async () => {
					try {
						// Pass isInitialSetup flag in context to prevent task abortion
						const context = {
							preserveFocus: false,
							isInitialSetup: extensionHost.isInInitialSetup(),
						}

						logs.debug(
							`Calling resolveWebviewView with isInitialSetup=${context.isInitialSetup}`,
							"VSCode.Window",
						)

						// Await the result to ensure webview is fully initialized before marking ready
						await provider.resolveWebviewView(mockWebviewView as WebviewView, {}, {} as CancellationToken)

						// Mark webview as ready after resolution completes
						extensionHost.markWebviewReady()
						logs.debug("Webview resolution complete, marked as ready", "VSCode.Window")
					} catch (error) {
						logs.error("Error resolving webview view", "VSCode.Window", { error })
					}
				})()
			}
		}
		return {
			dispose: () => {
				if ((global as unknown as { __extensionHost?: unknown }).__extensionHost) {
					;(
						global as unknown as {
							__extensionHost: { unregisterWebviewProvider: (viewId: string) => void }
						}
					).__extensionHost.unregisterWebviewProvider(viewId)
				}
			},
		}
	}

	registerUriHandler(_handler: UriHandler): Disposable {
		// Store the URI handler for later use
		return {
			dispose: () => {},
		}
	}

	onDidChangeTextEditorSelection(listener: (event: TextEditorSelectionChangeEvent) => void): Disposable {
		const emitter = new EventEmitter<TextEditorSelectionChangeEvent>()
		return emitter.event(listener)
	}

	onDidChangeActiveTextEditor(listener: (event: TextEditor | undefined) => void): Disposable {
		const emitter = new EventEmitter<TextEditor | undefined>()
		return emitter.event(listener)
	}

	onDidChangeVisibleTextEditors(listener: (editors: TextEditor[]) => void): Disposable {
		return this._onDidChangeVisibleTextEditors.event(listener)
	}

	// Terminal event handlers
	onDidCloseTerminal(_listener: (terminal: Terminal) => void): Disposable {
		return { dispose: () => {} }
	}

	onDidOpenTerminal(_listener: (terminal: Terminal) => void): Disposable {
		return { dispose: () => {} }
	}

	onDidChangeActiveTerminal(_listener: (terminal: Terminal | undefined) => void): Disposable {
		return { dispose: () => {} }
	}

	onDidChangeTerminalDimensions(_listener: (event: TerminalDimensionsChangeEvent) => void): Disposable {
		return { dispose: () => {} }
	}

	onDidWriteTerminalData(_listener: (event: TerminalDataWriteEvent) => void): Disposable {
		return { dispose: () => {} }
	}

	get activeTerminal(): Terminal | undefined {
		return undefined
	}

	get terminals(): Terminal[] {
		return []
	}
}
