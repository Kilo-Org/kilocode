import { IFileSystemAdapter } from "../adapters/FileSystemAdapter"
import { IUserInterfaceAdapter } from "../adapters/UserInterfaceAdapter"

// Simple logging function that only logs in verbose mode
const mockLog = (message: string) => {
	// Only log if KILO_CLI_VERBOSE is set or if we're in verbose mode
	if (process.env.KILO_CLI_VERBOSE === "true") {
		console.log(message)
	}
}

// Define VSCode types inline to avoid import issues
type VSCodeWorkspaceFolder = any
type VSCodeConfiguration = any
type VSCodeTextDocument = any
type VSCodeProgressOptions = any
type VSCodeProgress<T> = any
type VSCodeCancellationToken = any
type VSCodeQuickPickItem = any
type VSCodeInputBoxOptions = any
type VSCodeQuickPickOptions = any
type VSCodeMessageOptions = any
type VSCodeExtensionContext = any
type VSCodeUri = any
type VSCodeRange = any
type VSCodePosition = any
type VSCodeSelection = any
type VSCodeTextLine = any
type VSCodeTextEditor = any
type VSCodeWorkspaceEdit = any
type VSCodeTextEdit = any
type VSCodeDiagnostic = any
type VSCodeDiagnosticSeverity = any
type VSCodeCodeAction = any
type VSCodeCodeActionContext = any
type VSCodeCodeActionKind = any
type VSCodeCodeLens = any
type VSCodeCommand = any
type VSCodeStatusBarItem = any
type VSCodeStatusBarAlignment = any
type VSCodeTextEditorDecorationType = any
type VSCodeDecorationOptions = any
type VSCodeDecorationRenderOptions = any
type VSCodeThemeColor = any
type VSCodeOverviewRulerLane = any
type VSCodeTextDocumentChangeEvent = any
type VSCodeFileSystemWatcher = any
type VSCodeRelativePattern = any
type VSCodeFileStat = any
type VSCodeFileType = any
type VSCodeEndOfLine = any
type VSCodeTextDocumentShowOptions = any
type VSCodeViewColumn = any
type VSCodeWebviewPanel = any
type VSCodeWebviewView = any
type VSCodeWebviewOptions = any
type VSCodeProgressLocation = any
type VSCodeTextEditorRevealType = any
type VSCodeLanguageModelChat = any
type VSCodeLanguageModelChatMessage = any
type VSCodeLanguageModelChatResponse = any
type VSCodeLanguageModelTextPart = any
type VSCodeLanguageModelToolCallPart = any
type VSCodeLanguageModelToolResultPart = any
type VSCodeCancellationTokenSource = any
type VSCodeEventEmitter<T> = any
type VSCodeEvent<T> = any
type VSCodeDisposable = any
type VSCodeExtension<T> = any
type VSCodeTabGroup = any
type VSCodeTab = any
type VSCodeTerminal = any

export interface VSCodeWorkspace {
	workspaceFolders?: VSCodeWorkspaceFolder[]
	textDocuments: VSCodeTextDocument[]
	getConfiguration(section?: string): VSCodeConfiguration
	findFiles(include: string, exclude?: string): Promise<VSCodeUri[]>
	openTextDocument(uri: VSCodeUri | string): Promise<VSCodeTextDocument>
	applyEdit(edit: VSCodeWorkspaceEdit): Promise<boolean>
	asRelativePath(pathOrUri: string | VSCodeUri, includeWorkspaceFolder?: boolean): string
	getWorkspaceFolder(uri: VSCodeUri): VSCodeWorkspaceFolder | undefined
	createFileSystemWatcher(globPattern: string | VSCodeRelativePattern): VSCodeFileSystemWatcher
	onDidChangeWorkspaceFolders: VSCodeEvent<any>
	onDidChangeTextDocument: VSCodeEvent<VSCodeTextDocumentChangeEvent>
	onDidOpenTextDocument: VSCodeEvent<VSCodeTextDocument>
	onDidCloseTextDocument: VSCodeEvent<VSCodeTextDocument>
	onDidChangeConfiguration: VSCodeEvent<any>
	registerTextDocumentContentProvider(scheme: string, provider: any): VSCodeDisposable
	fs: {
		readFile(uri: VSCodeUri): Promise<Uint8Array>
		writeFile(uri: VSCodeUri, content: Uint8Array): Promise<void>
		stat(uri: VSCodeUri): Promise<VSCodeFileStat>
		delete(uri: VSCodeUri): Promise<void>
	}
}

export interface VSCodeWindow {
	activeTextEditor?: VSCodeTextEditor
	visibleTextEditors: VSCodeTextEditor[]
	terminals: VSCodeTerminal[]
	tabGroups: {
		all: VSCodeTabGroup[]
		onDidChangeTabs: VSCodeEvent<any>
	}
	showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>
	showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>
	showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>
	showQuickPick(
		items: string[] | VSCodeQuickPickItem[],
		options?: VSCodeQuickPickOptions,
	): Promise<string | VSCodeQuickPickItem | undefined>
	showInputBox(options?: VSCodeInputBoxOptions): Promise<string | undefined>
	showSaveDialog(options?: any): Promise<VSCodeUri | undefined>
	showTextDocument(document: VSCodeTextDocument, options?: VSCodeTextDocumentShowOptions): Promise<VSCodeTextEditor>
	withProgress<T>(
		options: VSCodeProgressOptions,
		task: (progress: VSCodeProgress<any>, token: VSCodeCancellationToken) => Promise<T>,
	): Promise<T>
	createStatusBarItem(alignment?: VSCodeStatusBarAlignment, priority?: number): VSCodeStatusBarItem
	createTextEditorDecorationType(options: VSCodeDecorationRenderOptions): VSCodeTextEditorDecorationType
	createWebviewPanel(
		viewType: string,
		title: string,
		showOptions: VSCodeViewColumn | { viewColumn: VSCodeViewColumn; preserveFocus?: boolean },
		options?: VSCodeWebviewOptions,
	): VSCodeWebviewPanel
	registerWebviewViewProvider(viewId: string, provider: any, options?: any): VSCodeDisposable
	registerUriHandler(handler: any): VSCodeDisposable
	onDidChangeActiveTextEditor: VSCodeEvent<VSCodeTextEditor | undefined>
	onDidOpenTerminal: VSCodeEvent<VSCodeTerminal>
	onDidCloseTerminal: VSCodeEvent<VSCodeTerminal>
	createTerminal(options?: any): VSCodeTerminal
}

export interface VSCodeCommands {
	executeCommand(command: string, ...args: any[]): Promise<any>
	registerCommand(command: string, callback: (...args: any[]) => any): VSCodeDisposable
}

export interface VSCodeLanguages {
	getDiagnostics(uri?: VSCodeUri): VSCodeDiagnostic[] | [VSCodeUri, VSCodeDiagnostic[]][]
	registerCodeActionsProvider(selector: any, provider: any, metadata?: any): VSCodeDisposable
	registerCodeLensProvider(selector: any, provider: any): VSCodeDisposable
}

export interface VSCodeExtensions {
	all: VSCodeExtension<any>[]
	getExtension(extensionId: string): VSCodeExtension<any> | undefined
}

export interface VSCodeEnv {
	machineId: string
	sessionId: string
	language: string
	appRoot: string
	clipboard: {
		writeText(text: string): Promise<void>
		readText(): Promise<string>
	}
	openExternal(target: VSCodeUri): Promise<boolean>
}

export interface VSCodeLm {
	selectChatModels(selector: any): Promise<VSCodeLanguageModelChat[]>
	registerTool(name: string, tool: any): VSCodeDisposable
}

export class VSCodeAPI {
	private fileSystem: IFileSystemAdapter
	private userInterface: IUserInterfaceAdapter
	private workingDirectory: string
	private configStore: Map<string, any> = new Map()
	private appRoot?: string

	constructor(fileSystem: IFileSystemAdapter, userInterface: IUserInterfaceAdapter, appRoot?: string) {
		this.fileSystem = fileSystem
		this.userInterface = userInterface
		this.workingDirectory = fileSystem.getWorkingDirectory()
		this.appRoot = appRoot

		// Initialize configuration store with proper defaults from package.json
		this.initializeDefaultConfiguration()

		// console.log(`[VSCODE-MOCK] VSCodeAPI initialized with working directory: ${this.workingDirectory}`)
	}

	private initializeDefaultConfiguration(): void {
		// Set default configuration values based on package.json schema and code usage
		const defaults = {
			// kilo-code configuration defaults (from package.json schema)
			"kilo-code.allowedCommands": ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
			"kilo-code.deniedCommands": [],
			"kilo-code.customStoragePath": "",
			"kilo-code.enableCodeActions": true,
			"kilo-code.autoImportSettingsPath": "",
			"kilo-code.useAgentRules": true,
			"kilo-code.commandExecutionTimeout": 0,
			"kilo-code.commandTimeoutAllowlist": [],
			"kilo-code.preventCompletionWithOpenTodos": false,
			"kilo-code.vsCodeLmModelSelector": {},

			// roo-cline configuration defaults (used in generateSystemPrompt.ts and Task.ts)
			"roo-cline.useAgentRules": true,

			// terminal configuration defaults
			"terminal.integrated.defaultProfile.osx": undefined,
			"terminal.integrated.profiles.osx": undefined,
			"terminal.integrated.defaultProfile.windows": undefined,
			"terminal.integrated.profiles.windows": undefined,
			"terminal.integrated.defaultProfile.linux": undefined,
			"terminal.integrated.profiles.linux": undefined,

			// workbench configuration defaults
			"workbench.colorTheme": "Default Dark Modern",
		}

		// Populate the config store with defaults
		for (const [key, value] of Object.entries(defaults)) {
			this.configStore.set(key, value)
		}

		// console.log(`[VSCODE-MOCK] Initialized configuration store with ${this.configStore.size} default values`)
		// console.log(`[VSCODE-MOCK] Configuration keys:`, Array.from(this.configStore.keys()).sort())
	}

	get workspace(): VSCodeWorkspace {
		return {
			workspaceFolders: [
				{
					uri: {
						fsPath: this.workingDirectory,
						scheme: "file",
						authority: "",
						path: this.workingDirectory,
						query: "",
						fragment: "",
						with: (change: any) => ({ fsPath: this.workingDirectory }),
						toString: () => `file://${this.workingDirectory}`,
					},
					name: this.fileSystem.join(this.workingDirectory).split("/").pop() || "CLI Workspace",
					index: 0,
				},
			],

			getConfiguration: (section?: string) => {
				// console.log(`[VSCODE-MOCK] workspace.getConfiguration called with section: ${section}`)
				return {
					get: <T>(key: string, defaultValue?: T): T => {
						const fullKey = section ? `${section}.${key}` : key
						let value = this.configStore.get(fullKey)

						// If value is undefined and no default provided, try to get the default from our store
						if (value === undefined && defaultValue === undefined) {
							// For kilo-code section, provide proper defaults
							if (section === "kilo-code") {
								const defaults: Record<string, any> = {
									allowedCommands: [
										"npm test",
										"npm install",
										"tsc",
										"git log",
										"git diff",
										"git show",
									],
									deniedCommands: [],
									customStoragePath: "",
									enableCodeActions: true,
									autoImportSettingsPath: "",
									useAgentRules: true,
									commandExecutionTimeout: 0,
									commandTimeoutAllowlist: [],
									preventCompletionWithOpenTodos: false,
									vsCodeLmModelSelector: {},
								}
								value = defaults[key]
							}
							// For roo-cline section, provide proper defaults
							else if (section === "roo-cline") {
								const defaults: Record<string, any> = {
									useAgentRules: true,
								}
								value = defaults[key]
							}
							// For terminal.integrated section, provide proper defaults
							else if (section === "terminal.integrated") {
								const defaults: Record<string, any> = {
									"defaultProfile.osx": undefined,
									"profiles.osx": undefined,
									"defaultProfile.windows": undefined,
									"profiles.windows": undefined,
									"defaultProfile.linux": undefined,
									"profiles.linux": undefined,
								}
								value = defaults[key]
							}
						}

						// Final fallback to provided defaultValue
						const finalValue = value ?? (defaultValue as T)
						// console.log(`[VSCODE-MOCK] config.get("${fullKey}") -> ${JSON.stringify(finalValue)}`)
						return finalValue
					},
					has: (key: string): boolean => {
						const fullKey = section ? `${section}.${key}` : key
						const hasKey = this.configStore.has(fullKey)
						// console.log(`[VSCODE-MOCK] config.has("${fullKey}") -> ${hasKey}`)
						return hasKey
					},
					update: async (key: string, value: any) => {
						const fullKey = section ? `${section}.${key}` : key
						// console.log(`[VSCODE-MOCK] config.update("${fullKey}", ${JSON.stringify(value)})`)
						this.configStore.set(fullKey, value)
					},
					inspect: (key: string) => {
						const fullKey = section ? `${section}.${key}` : key
						const value = this.configStore.get(fullKey)
						// console.log(`[VSCODE-MOCK] config.inspect("${fullKey}") -> ${JSON.stringify(value)}`)
						return {
							key,
							defaultValue: undefined,
							globalValue: value,
							workspaceValue: undefined,
							workspaceFolderValue: undefined,
						}
					},
				}
			},

			findFiles: async (include: string, exclude?: string) => {
				// console.log(`[VSCODE-MOCK] workspace.findFiles("${include}", "${exclude}")`)
				const files = await this.fileSystem.glob(include, { ignore: exclude })
				// console.log(`[VSCODE-MOCK] workspace.findFiles found ${files.length} files`)
				return files.map((file) => ({ fsPath: file }))
			},

			openTextDocument: async (uri: VSCodeUri | string) => {
				const filePath = typeof uri === "string" ? uri : uri.fsPath
				mockLog(`[VSCODE-MOCK] workspace.openTextDocument("${filePath}")`)
				try {
					const content = await this.fileSystem.readFile(filePath)
					const lines = content.split("\n")
					// console.log(
					// 	`[VSCODE-MOCK] workspace.openTextDocument successfully opened file with ${lines.length} lines`,
					// )
					return {
						uri:
							typeof uri === "string"
								? {
										fsPath: uri,
										scheme: "file",
										authority: "",
										path: uri,
										query: "",
										fragment: "",
										toString: () => `file://${uri}`,
									}
								: uri,
						getText: () => content,
						lineCount: content.split("\n").length,
						fileName: filePath,
						isUntitled: false,
						languageId: "plaintext",
						version: 1,
						isDirty: false,
						isClosed: false,
						save: async () => {
							mockLog(`[VSCODE-MOCK] textDocument.save() called for ${filePath}`)
							return true
						},
						eol: 1,
						lineAt: (line: number) => ({
							text: content.split("\n")[line] || "",
							range: {},
							rangeIncludingLineBreak: {},
							firstNonWhitespaceCharacterIndex: 0,
							isEmptyOrWhitespace: false,
						}),
					}
				} catch (error) {
					console.error(`[VSCODE-MOCK] workspace.openTextDocument failed for "${filePath}":`, error)
					throw error
				}
			},

			// File system API
			fs: {
				readFile: async (uri: any) => {
					mockLog(`[VSCODE-MOCK] workspace.fs.readFile("${uri.fsPath}")`)
					try {
						const content = await this.fileSystem.readFile(uri.fsPath)
						mockLog(`[VSCODE-MOCK] workspace.fs.readFile successfully read ${content.length} characters`)
						return Buffer.from(content)
					} catch (error) {
						console.error(`[VSCODE-MOCK] workspace.fs.readFile failed for "${uri.fsPath}":`, error)
						throw error
					}
				},
				writeFile: async (uri: any, content: Uint8Array) => {
					mockLog(`[VSCODE-MOCK] workspace.fs.writeFile("${uri.fsPath}", ${content.length} bytes)`)
					try {
						await this.fileSystem.writeFile(uri.fsPath, Buffer.from(content).toString())
						mockLog(`[VSCODE-MOCK] workspace.fs.writeFile successfully wrote to "${uri.fsPath}"`)
					} catch (error) {
						console.error(`[VSCODE-MOCK] workspace.fs.writeFile failed for "${uri.fsPath}":`, error)
						throw error
					}
				},
				stat: async (uri: any) => {
					mockLog(`[VSCODE-MOCK] workspace.fs.stat("${uri.fsPath}")`)
					try {
						const stats = await this.fileSystem.stat(uri.fsPath)
						mockLog(`[VSCODE-MOCK] workspace.fs.stat found file type: ${stats.type}`)
						return stats
					} catch (error) {
						console.error(`[VSCODE-MOCK] workspace.fs.stat failed for "${uri.fsPath}":`, error)
						throw error
					}
				},
				delete: async (uri: any) => {
					mockLog(`[VSCODE-MOCK] workspace.fs.delete("${uri.fsPath}")`)
					try {
						await this.fileSystem.delete(uri.fsPath)
						mockLog(`[VSCODE-MOCK] workspace.fs.delete successfully deleted "${uri.fsPath}"`)
					} catch (error) {
						console.error(`[VSCODE-MOCK] workspace.fs.delete failed for "${uri.fsPath}":`, error)
						throw error
					}
				},
			},

			// Additional workspace methods
			textDocuments: [],

			applyEdit: async (edit: any) => {
				mockLog(`[VSCODE-MOCK] workspace.applyEdit called with: ${JSON.stringify(edit, null, 2)}`)
				// Mock implementation - always return true
				mockLog(`[VSCODE-MOCK] workspace.applyEdit returning true (mock implementation)`)
				return true
			},

			asRelativePath: (pathOrUri: string | any, includeWorkspaceFolder?: boolean) => {
				const fsPath = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath
				const relativePath = this.fileSystem.relative(this.workingDirectory, fsPath)
				mockLog(`[VSCODE-MOCK] workspace.asRelativePath("${fsPath}") -> "${relativePath}"`)
				return relativePath
			},

			getWorkspaceFolder: (uri: any) => {
				// console.log(`[VSCODE-MOCK] workspace.getWorkspaceFolder("${uri.fsPath}")`)
				// Always return the workspace folder for CLI mode - we don't need strict path checking
				const workspaceFolder = {
					uri: {
						fsPath: this.workingDirectory,
						scheme: "file",
						authority: "",
						path: this.workingDirectory,
						query: "",
						fragment: "",
						with: (change: any) => ({ fsPath: this.workingDirectory }),
						toString: () => `file://${this.workingDirectory}`,
					},
					name: "CLI Workspace",
					index: 0,
				}
				// console.log(`[VSCODE-MOCK] workspace.getWorkspaceFolder returning workspace folder: ${workspaceFolder}`)
				return workspaceFolder
			},

			createFileSystemWatcher: (globPattern: string | any) => {
				mockLog(`[VSCODE-MOCK] workspace.createFileSystemWatcher("${globPattern}")`)
				// Create a mock file system watcher with event handlers
				const mockWatcher = {
					onDidCreate: (listener: (uri: any) => void) => {
						mockLog(`[VSCODE-MOCK] fileSystemWatcher.onDidCreate registered`)
						// Return a disposable - in CLI mode, we don't need real file watching
						return { dispose: () => mockLog(`[VSCODE-MOCK] fileSystemWatcher.onDidCreate disposed`) }
					},
					onDidChange: (listener: (uri: any) => void) => {
						mockLog(`[VSCODE-MOCK] fileSystemWatcher.onDidChange registered`)
						// Return a disposable - in CLI mode, we don't need real file watching
						return { dispose: () => mockLog(`[VSCODE-MOCK] fileSystemWatcher.onDidChange disposed`) }
					},
					onDidDelete: (listener: (uri: any) => void) => {
						mockLog(`[VSCODE-MOCK] fileSystemWatcher.onDidDelete registered`)
						// Return a disposable - in CLI mode, we don't need real file watching
						return { dispose: () => mockLog(`[VSCODE-MOCK] fileSystemWatcher.onDidDelete disposed`) }
					},
					dispose: () => {
						mockLog(`[VSCODE-MOCK] fileSystemWatcher.dispose called`)
					},
				}
				return mockWatcher
			},

			// Event handlers (return disposables)
			onDidChangeWorkspaceFolders: () => {
				mockLog(`[VSCODE-MOCK] workspace.onDidChangeWorkspaceFolders registered`)
				return { dispose: () => mockLog(`[VSCODE-MOCK] workspace.onDidChangeWorkspaceFolders disposed`) }
			},
			onDidChangeTextDocument: () => {
				mockLog(`[VSCODE-MOCK] workspace.onDidChangeTextDocument registered`)
				return { dispose: () => mockLog(`[VSCODE-MOCK] workspace.onDidChangeTextDocument disposed`) }
			},
			onDidOpenTextDocument: () => {
				mockLog(`[VSCODE-MOCK] workspace.onDidOpenTextDocument registered`)
				return { dispose: () => mockLog(`[VSCODE-MOCK] workspace.onDidOpenTextDocument disposed`) }
			},
			onDidCloseTextDocument: () => {
				mockLog(`[VSCODE-MOCK] workspace.onDidCloseTextDocument registered`)
				return { dispose: () => mockLog(`[VSCODE-MOCK] workspace.onDidCloseTextDocument disposed`) }
			},
			onDidChangeConfiguration: () => {
				mockLog(`[VSCODE-MOCK] workspace.onDidChangeConfiguration registered`)
				return { dispose: () => mockLog(`[VSCODE-MOCK] workspace.onDidChangeConfiguration disposed`) }
			},

			registerTextDocumentContentProvider: (scheme: string, provider: any) => {
				mockLog(`[VSCODE-MOCK] workspace.registerTextDocumentContentProvider("${scheme}")`)
				return { dispose: () => mockLog(`[VSCODE-MOCK] textDocumentContentProvider disposed`) }
			},
		}
	}

	get window(): VSCodeWindow {
		return {
			showInformationMessage: async (message: string, ...items: string[]) => {
				this.userInterface.showInfo(message)
				if (items.length > 0) {
					return (await this.userInterface.askQuestion(
						`Choose an option: ${items.join(", ")}`,
						"list",
					)) as string
				}
				return undefined
			},

			showWarningMessage: async (message: string, ...items: string[]) => {
				this.userInterface.showWarning(message)
				if (items.length > 0) {
					return (await this.userInterface.askQuestion(
						`Choose an option: ${items.join(", ")}`,
						"list",
					)) as string
				}
				return undefined
			},

			showErrorMessage: async (message: string, ...items: string[]) => {
				this.userInterface.showError(message)
				if (items.length > 0) {
					return (await this.userInterface.askQuestion(
						`Choose an option: ${items.join(", ")}`,
						"list",
					)) as string
				}
				return undefined
			},

			showQuickPick: async (items: string[] | VSCodeQuickPickItem[], options?: VSCodeQuickPickOptions) => {
				const itemLabels = items.map((item) => (typeof item === "string" ? item : item.label))
				const result = (await this.userInterface.askQuestion(
					options?.placeHolder || "Select an option:",
					"list",
					itemLabels,
				)) as string

				if (typeof items[0] === "string") {
					return result
				} else {
					return (items as VSCodeQuickPickItem[]).find((item) => item.label === result)
				}
			},

			showInputBox: async (options?: VSCodeInputBoxOptions) => {
				return (await this.userInterface.askQuestion(
					options?.prompt || options?.placeHolder || "Enter value:",
					"input",
				)) as string
			},

			withProgress: async <T>(
				options: VSCodeProgressOptions,
				task: (progress: VSCodeProgress<any>, token: VSCodeCancellationToken) => Promise<T>,
			) => {
				return await this.userInterface.showProgress(options.title || "Processing...", () =>
					task(
						{
							report: (value: { message?: string; increment?: number }) => {
								if (value.message) {
									this.userInterface.updateProgress(value.message)
								}
							},
						},
						{
							isCancellationRequested: false,
							onCancellationRequested: () => {},
						},
					),
				)
			},

			createTextEditorDecorationType: (
				options: VSCodeDecorationRenderOptions,
			): VSCodeTextEditorDecorationType => {
				// Mock implementation of text editor decoration type
				return {
					key: `decoration-${Math.random().toString(36).substr(2, 9)}`,
					dispose: () => {
						// Mock dispose - no-op in CLI
					},
				}
			},

			createStatusBarItem: (alignment?: VSCodeStatusBarAlignment, priority?: number): VSCodeStatusBarItem => {
				return {
					text: "",
					tooltip: "",
					color: undefined,
					backgroundColor: undefined,
					command: undefined,
					alignment: alignment || 1, // Left alignment
					priority: priority || 0,
					show: () => {
						this.userInterface.showInfo(`Status: ${this.text || "Status item shown"}`)
					},
					hide: () => {
						// Mock hide - no-op in CLI
					},
					dispose: () => {
						// Mock dispose - no-op in CLI
					},
				} as VSCodeStatusBarItem
			},

			showSaveDialog: async (options?: any): Promise<VSCodeUri | undefined> => {
				const result = (await this.userInterface.askQuestion("Enter file path to save:", "input")) as string
				return result ? { fsPath: result } : undefined
			},

			showTextDocument: async (
				document: VSCodeTextDocument,
				options?: VSCodeTextDocumentShowOptions,
			): Promise<VSCodeTextEditor> => {
				this.userInterface.showInfo(`Opening document: ${document.fileName}`)
				// Mock text editor
				return {
					document,
					selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
					selections: [],
					visibleRanges: [],
					options: { tabSize: 4, insertSpaces: true },
					viewColumn: 1,
					edit: async () => true,
					insertSnippet: async () => true,
					setDecorations: () => {},
					revealRange: () => {},
					show: () => {},
					hide: () => {},
				} as VSCodeTextEditor
			},

			createWebviewPanel: (
				viewType: string,
				title: string,
				showOptions: VSCodeViewColumn | { viewColumn: VSCodeViewColumn; preserveFocus?: boolean },
				options?: VSCodeWebviewOptions,
			): VSCodeWebviewPanel => {
				this.userInterface.showInfo(`Creating webview panel: ${title}`)
				return {
					viewType,
					title,
					webview: {
						html: "",
						options: options || {},
						postMessage: async () => true,
						onDidReceiveMessage: () => ({ dispose: () => {} }),
					},
					visible: true,
					active: true,
					viewColumn: typeof showOptions === "number" ? showOptions : showOptions.viewColumn,
					onDidDispose: () => ({ dispose: () => {} }),
					onDidChangeViewState: () => ({ dispose: () => {} }),
					reveal: () => {},
					dispose: () => {},
				} as VSCodeWebviewPanel
			},

			registerWebviewViewProvider: (viewId: string, provider: any, options?: any): VSCodeDisposable => {
				this.userInterface.showInfo(`Registering webview view provider: ${viewId}`)
				return { dispose: () => {} }
			},

			registerUriHandler: (handler: any): VSCodeDisposable => {
				return { dispose: () => {} }
			},

			createTerminal: (options?: any): VSCodeTerminal => {
				const name = options?.name || "CLI Terminal"
				this.userInterface.showInfo(`Creating terminal: ${name}`)
				return {
					name,
					processId: Promise.resolve(Math.floor(Math.random() * 10000)),
					creationOptions: options || {},
					exitStatus: undefined,
					state: { isInteractedWith: false },
					sendText: (text: string, addNewLine?: boolean) => {
						this.userInterface.showInfo(`Terminal command: ${text}`)
					},
					show: () => {},
					hide: () => {},
					dispose: () => {},
				} as VSCodeTerminal
			},

			createOutputChannel: (name: string) => {
				return {
					name,
					append: (value: string) => {
						mockLog(`[${name}] ${value}`)
					},
					appendLine: (value: string) => {
						mockLog(`[${name}] ${value}`)
					},
					clear: () => {
						// No-op for CLI
					},
					show: (preserveFocus?: boolean) => {
						// No-op for CLI
					},
					hide: () => {
						// No-op for CLI
					},
					dispose: () => {
						// No-op for CLI
					},
				}
			},

			// Mock properties
			activeTextEditor: {
				document: {
					uri: {
						fsPath: this.workingDirectory + "/mock-file.txt",
						scheme: "file",
						authority: "",
						path: this.workingDirectory + "/mock-file.txt",
						query: "",
						fragment: "",
						with: (change: any) => ({ fsPath: this.workingDirectory + "/mock-file.txt" }),
						toString: () => `file://${this.workingDirectory}/mock-file.txt`,
					},
					getText: () => "",
					lineCount: 1,
					fileName: this.workingDirectory + "/mock-file.txt",
					isUntitled: false,
					languageId: "plaintext",
					version: 1,
					isDirty: false,
					isClosed: false,
					save: async () => true,
					eol: 1,
					lineAt: (line: number) => ({
						text: "",
						range: {},
						rangeIncludingLineBreak: {},
						firstNonWhitespaceCharacterIndex: 0,
						isEmptyOrWhitespace: true,
					}),
				},
				selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
				selections: [],
				visibleRanges: [],
				options: { tabSize: 4, insertSpaces: true },
				viewColumn: 1,
				edit: async () => true,
				insertSnippet: async () => true,
				setDecorations: () => {},
				revealRange: () => {},
				show: () => {},
				hide: () => {},
			} as any,
			visibleTextEditors: [],
			terminals: [],
			tabGroups: {
				all: [],
				onDidChangeTabs: () => ({ dispose: () => {} }),
			},

			// Mock events
			onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
			onDidChangeVisibleTextEditors: () => {
				mockLog(`[VSCODE-MOCK] window.onDidChangeVisibleTextEditors registered`)
				return { dispose: () => mockLog(`[VSCODE-MOCK] window.onDidChangeVisibleTextEditors disposed`) }
			},
			onDidOpenTerminal: () => ({ dispose: () => {} }),
			onDidCloseTerminal: () => ({ dispose: () => {} }),
		}
	}

	get commands(): VSCodeCommands {
		return {
			executeCommand: async (command: string, ...args: any[]) => {
				this.userInterface.showInfo(`Executing command: ${command}`)

				// Handle specific VS Code commands that are used by the diff editor
				if (command === "vscode.diff") {
					mockLog(`[VSCODE-MOCK] Handling vscode.diff command - returning immediately to prevent hanging`)
					// In CLI mode, we don't actually open a diff editor, just return success
					return Promise.resolve()
				}

				// Handle other common VS Code commands
				if (command.startsWith("vscode.")) {
					mockLog(`[VSCODE-MOCK] Handling VS Code built-in command: ${command}`)
					return Promise.resolve()
				}

				// For unknown commands, return undefined
				return undefined
			},
		}
	}

	get languages(): VSCodeLanguages {
		return {
			getDiagnostics: (uri?: VSCodeUri) => {
				mockLog(`[VSCODE-MOCK] languages.getDiagnostics called${uri ? ` for ${uri.fsPath}` : ""}`)
				// Return empty diagnostics array for CLI mode - we don't need real diagnostics
				if (uri) {
					return []
				} else {
					// Return empty array of [Uri, Diagnostic[]] tuples when no URI specified
					return []
				}
			},
			registerCodeActionsProvider: (selector: any, provider: any, metadata?: any) => {
				mockLog(`[VSCODE-MOCK] languages.registerCodeActionsProvider called`)
				// Return a disposable
				return { dispose: () => mockLog(`[VSCODE-MOCK] codeActionsProvider disposed`) }
			},
		}
	}

	get env(): VSCodeEnv {
		return {
			machineId: "cli-machine-id",
			sessionId: "cli-session-id",
			language: "en",
			appRoot: this.appRoot || this.workingDirectory,
			uriScheme: "vscode",
			uiKind: 1, // Desktop
			clipboard: {
				writeText: async (text: string) => {
					this.userInterface.showInfo("Text copied to clipboard (CLI mock)")
				},
				readText: async () => {
					return ""
				},
			},
		}
	}

	createExtensionContext(): VSCodeExtensionContext {
		const extensionPath = this.workingDirectory
		const storagePath = this.fileSystem.join(this.workingDirectory, ".kilo-cli-storage")
		const globalStoragePath = this.fileSystem.join(this.workingDirectory, ".kilo-cli-global-storage")

		return {
			subscriptions: [],
			workspaceState: {
				get: <T>(key: string, defaultValue?: T): T => {
					const value = this.configStore.get(`workspace.${key}`)
					mockLog(
						`[VSCODE-MOCK] workspaceState.get("${key}") -> ${JSON.stringify(value)} (default: ${JSON.stringify(defaultValue)})`,
					)
					return value ?? (defaultValue as T)
				},
				update: async (key: string, value: any) => {
					mockLog(`[VSCODE-MOCK] workspaceState.update("${key}", ${JSON.stringify(value)})`)
					this.configStore.set(`workspace.${key}`, value)
				},
			},
			globalState: {
				get: <T>(key: string, defaultValue?: T): T => {
					const value = this.configStore.get(`global.${key}`)
					mockLog(
						`[VSCODE-MOCK] globalState.get("${key}") -> ${JSON.stringify(value)} (default: ${JSON.stringify(defaultValue)})`,
					)
					return value ?? (defaultValue as T)
				},
				update: async (key: string, value: any) => {
					mockLog(`[VSCODE-MOCK] globalState.update("${key}", ${JSON.stringify(value)})`)
					this.configStore.set(`global.${key}`, value)
				},
				keys: (): readonly string[] => {
					const allKeys: string[] = []
					this.configStore.forEach((value, key) => {
						if (key.startsWith("global.")) {
							allKeys.push(key.replace("global.", ""))
						}
					})
					return allKeys
				},
				setKeysForSync: (keys: readonly string[]) => {
					// Mock implementation - no-op in CLI
				},
			},
			secrets: {
				get: async (key: string): Promise<string | undefined> => {
					return this.configStore.get(`secrets.${key}`)
				},
				store: async (key: string, value: string): Promise<void> => {
					this.configStore.set(`secrets.${key}`, value)
				},
				delete: async (key: string): Promise<void> => {
					this.configStore.delete(`secrets.${key}`)
				},
			},
			extensionPath,
			storagePath,
			globalStoragePath,
			// Add missing URI properties that Task constructor expects
			extensionUri: {
				scheme: "file",
				authority: "",
				path: extensionPath,
				query: "",
				fragment: "",
				fsPath: extensionPath,
				toString: () => `file://${extensionPath}`,
				with: (change: any) => ({ ...this, ...change }),
			},
			globalStorageUri: {
				scheme: "file",
				authority: "",
				path: globalStoragePath,
				query: "",
				fragment: "",
				fsPath: globalStoragePath,
				toString: () => `file://${globalStoragePath}`,
				with: (change: any) => ({ ...this, ...change }),
			},
			storageUri: {
				scheme: "file",
				authority: "",
				path: storagePath,
				query: "",
				fragment: "",
				fsPath: storagePath,
				toString: () => `file://${storagePath}`,
				with: (change: any) => ({ ...this, ...change }),
			},
			// Add extension property that getStateToPostToWebview expects
			extension: {
				packageJSON: {
					version: "1.0.0-cli",
					name: "kilo-code-cli",
					displayName: "Kilo Code CLI",
				},
				extensionPath: extensionPath,
				isActive: true,
				exports: {},
				activate: () => Promise.resolve(),
			},
		}
	}

	// Static classes that should be available on the vscode module
	static Uri = class {
		scheme: string
		authority: string
		path: string
		query: string
		fragment: string
		fsPath: string

		constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
			this.scheme = scheme
			this.authority = authority
			this.path = path
			this.query = query
			this.fragment = fragment
			this.fsPath = scheme === "file" ? path : path
		}

		static file(path: string): VSCodeUri {
			return {
				scheme: "file",
				authority: "",
				path: path,
				query: "",
				fragment: "",
				fsPath: path,
				toString: () => `file://${path}`,
			}
		}

		static parse(value: string): VSCodeUri {
			// Simple URI parsing for file:// URIs
			if (value.startsWith("file://")) {
				const path = value.substring(7)
				return {
					scheme: "file",
					authority: "",
					path: path,
					query: "",
					fragment: "",
					fsPath: path,
					toString: () => `file://${path}`,
					with: (change: any) => {
						return {
							scheme: change.scheme || "file",
							authority: change.authority || "",
							path: change.path || path,
							query: change.query || "",
							fragment: change.fragment || "",
							fsPath: change.path || path,
							toString: () =>
								`${change.scheme || "file"}://${change.authority || ""}${change.path || path}${change.query ? "?" + change.query : ""}${change.fragment ? "#" + change.fragment : ""}`,
							with: (nextChange: any) => this.parse(value).with({ ...change, ...nextChange }),
						}
					},
				}
			}
			return {
				scheme: "file",
				authority: "",
				path: value,
				query: "",
				fragment: "",
				fsPath: value,
				toString: () => `file://${value}`,
				with: (change: any) => {
					return {
						scheme: change.scheme || "file",
						authority: change.authority || "",
						path: change.path || value,
						query: change.query || "",
						fragment: change.fragment || "",
						fsPath: change.path || value,
						toString: () =>
							`${change.scheme || "file"}://${change.authority || ""}${change.path || value}${change.query ? "?" + change.query : ""}${change.fragment ? "#" + change.fragment : ""}`,
						with: (nextChange: any) => this.parse(value).with({ ...change, ...nextChange }),
					}
				},
			}
		}

		toString(): string {
			return `${this.scheme}://${this.authority}${this.path}${this.query ? "?" + this.query : ""}${this.fragment ? "#" + this.fragment : ""}`
		}

		with(change: any): VSCodeUri {
			return {
				scheme: change.scheme || this.scheme,
				authority: change.authority || this.authority,
				path: change.path || this.path,
				query: change.query || this.query,
				fragment: change.fragment || this.fragment,
				fsPath: change.path || this.fsPath,
				toString: () =>
					`${change.scheme || this.scheme}://${change.authority || this.authority}${change.path || this.path}${change.query ? "?" + change.query : ""}${change.fragment ? "#" + change.fragment : ""}`,
				with: (nextChange: any) => this.with({ ...change, ...nextChange }),
			}
		}
	}

	static Disposable = class {
		static from(...disposables: VSCodeDisposable[]): VSCodeDisposable {
			return {
				dispose: () => {
					disposables.forEach((d) => d.dispose())
				},
			}
		}
	}

	static RelativePattern = class {
		base: string
		pattern: string

		constructor(base: string, pattern: string) {
			this.base = base
			this.pattern = pattern
		}
	}

	// Expose static classes as instance properties for compatibility
	get Uri() {
		return VSCodeAPI.Uri
	}
	get Disposable() {
		return VSCodeAPI.Disposable
	}
	get RelativePattern() {
		return VSCodeAPI.RelativePattern
	}
}
