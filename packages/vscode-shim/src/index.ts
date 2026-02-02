/**
 * @roo-code/vscode-shim
 *
 * A production-ready VSCode API mock for running VSCode extensions in Node.js CLI applications.
 * This package provides a complete implementation of the VSCode Extension API, allowing you to
 * run VSCode extensions without VSCode installed.
 *
 * @packageDocumentation
 */

// Export the complete VSCode API implementation
export {
	// Main factory function
	createVSCodeAPIMock,

	// Classes
	Uri,
	Position,
	Range,
	Selection,
	EventEmitter,
	Location,
	Diagnostic,
	DiagnosticRelatedInformation,
	TextEdit,
	WorkspaceEdit,
	ThemeColor,
	ThemeIcon,
	CodeActionKind,
	CancellationTokenSource,
	CodeLens,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	FileSystemError,
	OutputChannel,
	StatusBarItem,
	TextEditorDecorationType,
	ExtensionContext,

	// API classes
	WorkspaceAPI,
	WindowAPI,
	CommandsAPI,
	TabGroupsAPI,
	FileSystemAPI,
	MockWorkspaceConfiguration,

	// Runtime configuration utilities
	setRuntimeConfig,
	setRuntimeConfigValues,
	clearRuntimeConfig,
	getRuntimeConfig,

	// Enums
	ConfigurationTarget,
	ViewColumn,
	TextEditorRevealType,
	StatusBarAlignment,
	DiagnosticSeverity,
	DiagnosticTag,
	EndOfLine,
	UIKind,
	ExtensionMode,
	ExtensionKind,
	FileType,
	DecorationRangeBehavior,
	OverviewRulerLane,

	// Types
	type IdentityInfo,
	type Thenable,
	type Disposable,
	type TextDocument,
	type TextLine,
	type WorkspaceFolder,
	type WorkspaceConfiguration,
	type Memento,
	type SecretStorage,
	type FileStat,
	type Terminal,
	type CancellationToken,
	type IExtensionHost,
	type ExtensionHostEventMap,
	type ExtensionHostEventName,
} from "./vscode.js"

// Export utilities
export { logs, setLogger, type Logger } from "./utils/logger.js"
export { VSCodeMockPaths } from "./utils/paths.js"
export { machineIdSync } from "./utils/machine-id.js"

// Re-export as createVSCodeAPI for simpler API
export { createVSCodeAPIMock as createVSCodeAPI } from "./vscode.js"

/**
 * Quick start function to create a complete VSCode API mock
 *
 * @example
 * ```typescript
 * import { createVSCodeAPI } from '@roo-code/vscode-shim'
 *
 * const vscode = createVSCodeAPI({
 *   extensionPath: '/path/to/extension',
 *   workspacePath: '/path/to/workspace'
 * })
 *
 * // Set global vscode for extension to use
 * global.vscode = vscode
 *
 * // Load and activate extension
 * const extension = require('/path/to/extension.js')
 * const api = await extension.activate(vscode.context)
 * ```
 */
