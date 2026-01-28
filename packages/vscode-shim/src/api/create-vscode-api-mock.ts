/**
 * Main factory function for creating VSCode API mock
 */

import { machineIdSync } from "../utils/machine-id.js"
import { logs } from "../utils/logger.js"

// Import classes
import { Uri } from "../classes/Uri.js"
import { Position } from "../classes/Position.js"
import { Range } from "../classes/Range.js"
import { Selection } from "../classes/Selection.js"
import { EventEmitter } from "../classes/EventEmitter.js"
import { TextEdit, WorkspaceEdit } from "../classes/TextEdit.js"
import {
	Location,
	Diagnostic,
	DiagnosticRelatedInformation,
	ThemeColor,
	ThemeIcon,
	CodeActionKind,
	CodeLens,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	FileSystemError,
} from "../classes/Additional.js"
import { CancellationTokenSource } from "../classes/CancellationToken.js"
import { StatusBarItem } from "../classes/StatusBarItem.js"
import { ExtensionContextImpl } from "../context/ExtensionContext.js"

// Import APIs
import { WorkspaceAPI } from "./WorkspaceAPI.js"
import { WindowAPI } from "./WindowAPI.js"
import { CommandsAPI } from "./CommandsAPI.js"

// Import types and enums
import {
	ConfigurationTarget,
	ViewColumn,
	TextEditorRevealType,
	StatusBarAlignment,
	DiagnosticSeverity,
	DiagnosticTag,
	EndOfLine,
	UIKind,
	ExtensionMode,
	FileType,
	DecorationRangeBehavior,
	OverviewRulerLane,
} from "../types.js"

// Import interfaces
import type { CancellationToken } from "../interfaces/document.js"
import type { Disposable, DiagnosticCollection, IdentityInfo } from "../interfaces/workspace.js"
import type { RelativePattern } from "../interfaces/document.js"
import type { UriHandler } from "../interfaces/webview.js"

// Package version constant
const Package = { version: "1.0.0" }

/**
 * Options for creating the VSCode API mock
 */
export interface VSCodeAPIMockOptions {
	/**
	 * Custom app root path (for locating ripgrep and other VSCode resources).
	 * Defaults to the directory containing this module.
	 */
	appRoot?: string

	/**
	 * Custom storage directory for persistent state.
	 * Defaults to ~/.vscode-mock.
	 * Set to a temp directory for ephemeral/no-persist mode.
	 */
	storageDir?: string
}

/**
 * Create a complete VSCode API mock for CLI mode
 */
export function createVSCodeAPIMock(
	extensionRootPath: string,
	workspacePath: string,
	identity?: IdentityInfo,
	options?: VSCodeAPIMockOptions,
) {
	const context = new ExtensionContextImpl({
		extensionPath: extensionRootPath,
		workspacePath: workspacePath,
		storageDir: options?.storageDir,
	})
	const workspace = new WorkspaceAPI(workspacePath, context)
	const window = new WindowAPI()
	const commands = new CommandsAPI()

	// Link window and workspace for cross-API calls
	window.setWorkspace(workspace)

	// Environment mock with identity values
	const env = {
		appName: `wrapper|cli|cli|${Package.version}`,
		appRoot: options?.appRoot || import.meta.dirname,
		language: "en",
		machineId: identity?.machineId || machineIdSync(),
		sessionId: identity?.sessionId || "cli-session-id",
		remoteName: undefined,
		shell: process.env.SHELL || "/bin/bash",
		uriScheme: "vscode",
		uiKind: 1, // Desktop
		openExternal: async (uri: Uri): Promise<boolean> => {
			logs.info(`Would open external URL: ${uri.toString()}`, "VSCode.Env")
			return true
		},
		clipboard: {
			readText: async (): Promise<string> => {
				logs.debug("Clipboard read requested", "VSCode.Clipboard")
				return ""
			},
			writeText: async (text: string): Promise<void> => {
				logs.debug(
					`Clipboard write: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`,
					"VSCode.Clipboard",
				)
			},
		},
	}

	return {
		version: "1.84.0",
		Uri,
		EventEmitter,
		ConfigurationTarget,
		ViewColumn,
		TextEditorRevealType,
		StatusBarAlignment,
		DiagnosticSeverity,
		DiagnosticTag,
		Position,
		Range,
		Selection,
		Location,
		Diagnostic,
		DiagnosticRelatedInformation,
		TextEdit,
		WorkspaceEdit,
		EndOfLine,
		UIKind,
		ExtensionMode,
		CodeActionKind,
		ThemeColor,
		ThemeIcon,
		DecorationRangeBehavior,
		OverviewRulerLane,
		StatusBarItem,
		CancellationToken: class CancellationTokenClass implements CancellationToken {
			isCancellationRequested = false
			onCancellationRequested = (_listener: (e: unknown) => void) => ({ dispose: () => {} })
		},
		CancellationTokenSource,
		CodeLens,
		LanguageModelTextPart,
		LanguageModelToolCallPart,
		LanguageModelToolResultPart,
		ExtensionContext: ExtensionContextImpl,
		FileType,
		FileSystemError,
		Disposable: class DisposableClass implements Disposable {
			dispose(): void {
				// No-op for CLI
			}

			static from(...disposables: Disposable[]): Disposable {
				return {
					dispose: () => {
						disposables.forEach((d) => d.dispose())
					},
				}
			}
		},
		TabInputText: class TabInputText {
			constructor(public uri: Uri) {}
		},
		TabInputTextDiff: class TabInputTextDiff {
			constructor(
				public original: Uri,
				public modified: Uri,
			) {}
		},
		workspace,
		window,
		commands,
		env,
		context,
		// Add more APIs as needed
		languages: {
			registerCodeActionsProvider: () => ({ dispose: () => {} }),
			registerCodeLensProvider: () => ({ dispose: () => {} }),
			registerCompletionItemProvider: () => ({ dispose: () => {} }),
			registerHoverProvider: () => ({ dispose: () => {} }),
			registerDefinitionProvider: () => ({ dispose: () => {} }),
			registerReferenceProvider: () => ({ dispose: () => {} }),
			registerDocumentSymbolProvider: () => ({ dispose: () => {} }),
			registerWorkspaceSymbolProvider: () => ({ dispose: () => {} }),
			registerRenameProvider: () => ({ dispose: () => {} }),
			registerDocumentFormattingEditProvider: () => ({ dispose: () => {} }),
			registerDocumentRangeFormattingEditProvider: () => ({ dispose: () => {} }),
			registerSignatureHelpProvider: () => ({ dispose: () => {} }),
			getDiagnostics: (uri?: Uri): [Uri, Diagnostic[]][] | Diagnostic[] => {
				// In CLI mode, we don't have real diagnostics
				// Return empty array or empty diagnostics for the specific URI
				if (uri) {
					return []
				}
				return []
			},
			createDiagnosticCollection: (name?: string): DiagnosticCollection => {
				const diagnostics = new Map<string, Diagnostic[]>()
				const collection: DiagnosticCollection = {
					name: name || "default",
					set: (
						uriOrEntries: Uri | [Uri, Diagnostic[] | undefined][],
						diagnosticsOrUndefined?: Diagnostic[] | undefined,
					) => {
						if (Array.isArray(uriOrEntries)) {
							// Handle array of entries
							for (const [uri, diags] of uriOrEntries) {
								if (diags === undefined) {
									diagnostics.delete(uri.toString())
								} else {
									diagnostics.set(uri.toString(), diags)
								}
							}
						} else {
							// Handle single URI
							if (diagnosticsOrUndefined === undefined) {
								diagnostics.delete(uriOrEntries.toString())
							} else {
								diagnostics.set(uriOrEntries.toString(), diagnosticsOrUndefined)
							}
						}
					},
					delete: (uri: Uri) => {
						diagnostics.delete(uri.toString())
					},
					clear: () => {
						diagnostics.clear()
					},
					forEach: (
						callback: (uri: Uri, diagnostics: Diagnostic[], collection: DiagnosticCollection) => void,
						thisArg?: unknown,
					) => {
						diagnostics.forEach((diags, uriString) => {
							callback.call(thisArg, Uri.parse(uriString), diags, collection)
						})
					},
					get: (uri: Uri) => {
						return diagnostics.get(uri.toString())
					},
					has: (uri: Uri) => {
						return diagnostics.has(uri.toString())
					},
					dispose: () => {
						diagnostics.clear()
					},
				}
				return collection
			},
		},
		debug: {
			onDidStartDebugSession: () => ({ dispose: () => {} }),
			onDidTerminateDebugSession: () => ({ dispose: () => {} }),
		},
		tasks: {
			onDidStartTask: () => ({ dispose: () => {} }),
			onDidEndTask: () => ({ dispose: () => {} }),
		},
		extensions: {
			all: [],
			getExtension: (extensionId: string) => {
				// Mock the extension object with extensionUri for theme loading
				if (extensionId === "RooVeterinaryInc.roo-cline") {
					return {
						id: extensionId,
						extensionUri: context.extensionUri,
						extensionPath: context.extensionPath,
						isActive: true,
						packageJSON: {},
						exports: undefined,
						activate: () => Promise.resolve(),
					}
				}
				return undefined
			},
			onDidChange: () => ({ dispose: () => {} }),
		},
		// Add file system watcher
		FileSystemWatcher: class {
			onDidChange = () => ({ dispose: () => {} })
			onDidCreate = () => ({ dispose: () => {} })
			onDidDelete = () => ({ dispose: () => {} })
			dispose = () => {}
		},
		// Add relative pattern
		RelativePattern: class implements RelativePattern {
			constructor(
				public base: string,
				public pattern: string,
			) {}
		},
		// Add progress location
		ProgressLocation: {
			SourceControl: 1,
			Window: 10,
			Notification: 15,
		},
		// Add URI handler
		UriHandler: class implements UriHandler {
			handleUri = (_uri: Uri) => {}
		},
	}
}
