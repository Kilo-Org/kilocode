/**
 * Mock implementation of vscode module for benchmarks
 * Provides minimal implementations to avoid import errors
 */

// Mock VSCode API objects
export const workspace = {
	getConfiguration: () => ({
		get: () => undefined,
		has: () => false,
		inspect: () => undefined,
		update: () => Promise.resolve(),
	}),
	// Provide a mock workspace folder for Mercury context collection
	workspaceFolders: [
		{
			uri: {
				fsPath: "/mock/workspace",
				scheme: "file",
				authority: "",
				path: "/mock/workspace",
				query: "",
				fragment: "",
				toString: () => "file:///mock/workspace",
			},
			name: "mock-workspace",
			index: 0,
		},
	],
	textDocuments: [], // Add missing textDocuments array for GhostContext.addOpenFiles()
	onDidChangeConfiguration: () => ({ dispose: () => {} }),
	onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
	onDidChangeTextDocument: () => ({ dispose: () => {} }), // Add missing workspace event for ImportDefinitionsService
	openTextDocument: () =>
		Promise.resolve({
			getText: () => "",
			lineAt: () => ({ text: "" }),
			lineCount: 0,
			uri: { fsPath: "", toString: () => "" },
			languageId: "plaintext",
		}), // Add missing openTextDocument method
	fs: {
		// Mock file system for snippet collection
		readDirectory: () => Promise.resolve([]),
		readFile: () => Promise.resolve(Buffer.from("")),
		stat: () =>
			Promise.resolve({
				type: 1, // FileType.File
				ctime: 0,
				mtime: 0,
				size: 0,
			}),
	},
	asRelativePath: (uri: any, includeWorkspaceFolder?: boolean) => {
		// Simple mock implementation for GhostStreamingParser
		if (typeof uri === "string") {
			return uri.split("/").pop() || "unknown.js"
		}
		if (uri && uri.fsPath) {
			return uri.fsPath.split("/").pop() || "unknown.js"
		}
		return "unknown.js"
	},
}

// Mock env object for clipboard and machine ID access
export const env = {
	machineId: "mock-machine-id",
	clipboard: {
		readText: () => Promise.resolve(""),
		writeText: (text: string) => Promise.resolve(),
	},
}

// Mock lm (Language Model) API
export const lm = {
	selectChatModels: (selector?: any) => Promise.resolve([]),
}

export const window = {
	showErrorMessage: (message: string) => {
		console.error("[VSCode Mock]", message)
		return Promise.resolve()
	},
	showWarningMessage: (message: string) => {
		console.warn("[VSCode Mock]", message)
		return Promise.resolve()
	},
	showInformationMessage: (message: string) => {
		console.info("[VSCode Mock]", message)
		return Promise.resolve()
	},
	activeTextEditor: {
		document: {
			getText: () => "",
			lineAt: () => ({ text: "" }),
			lineCount: 0,
			uri: { fsPath: "", toString: () => "" },
			languageId: "plaintext",
			fileName: "",
			version: 1,
			isDirty: false,
			isClosed: false,
			save: () => Promise.resolve(true),
			eol: 1, // EndOfLine.LF
			isUntitled: false,
		},
		selection: {
			active: { line: 0, character: 0 },
			anchor: { line: 0, character: 0 },
			start: { line: 0, character: 0 },
			end: { line: 0, character: 0 },
			isEmpty: true,
			isSingleLine: true,
			isReversed: false,
		},
		selections: [],
		visibleRanges: [],
		options: {
			tabSize: 4,
			insertSpaces: true,
		},
		viewColumn: undefined,
	},
}

export const commands = {
	registerCommand: () => ({ dispose: () => {} }),
	executeCommand: () => Promise.resolve(),
}

export const languages = {
	registerInlineCompletionItemProvider: () => ({ dispose: () => {} }),
	registerCodeActionProvider: () => ({ dispose: () => {} }),
	getDiagnostics: () => [], // Add missing getDiagnostics method for GhostContext.addDiagnostics()
}

// Mock classes
export class Uri {
	static file(path: string) {
		return { fsPath: path, toString: () => `file://${path}` }
	}
}

export class Position {
	constructor(
		public line: number,
		public character: number,
	) {}
}

export class Range {
	constructor(
		public start: Position,
		public end: Position,
	) {}
}

export class Selection extends Range {
	constructor(start: Position, end: Position) {
		super(start, end)
	}
}

// Mock enums
export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

// Mock Language Model Chat Message classes
export class LanguageModelChatMessage {
	static Assistant(content: string) {
		return new LanguageModelChatMessage("assistant", content)
	}
	static User(content: string) {
		return new LanguageModelChatMessage("user", content)
	}
	constructor(
		public role: string,
		public content: string,
	) {}
}

export class LanguageModelTextPart {
	constructor(public value: string) {}
}

export class LanguageModelToolResultPart {
	constructor(
		public toolCallId: string,
		public content: any[],
	) {}
}

export class LanguageModelToolCallPart {
	constructor(
		public name: string,
		public parameters: any,
		public callId: string,
	) {}
}

export enum LanguageModelChatMessageRole {
	User = 1,
	Assistant = 2,
}

export class CancellationError extends Error {
	constructor(message?: string) {
		super(message || "Operation cancelled")
		this.name = "CancellationError"
	}
}

export class CancellationTokenSource {
	token = {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose: () => {} }),
	}
	cancel() {
		this.token.isCancellationRequested = true
	}
	dispose() {}
}

// Export everything as default for compatibility
export default {
	workspace,
	window,
	commands,
	languages,
	env,
	lm,
	Uri,
	Position,
	Range,
	Selection,
	ConfigurationTarget,
	DiagnosticSeverity,
	FileType,
	LanguageModelChatMessage,
	LanguageModelTextPart,
	LanguageModelToolResultPart,
	LanguageModelToolCallPart,
	LanguageModelChatMessageRole,
	CancellationError,
	CancellationTokenSource,
}
