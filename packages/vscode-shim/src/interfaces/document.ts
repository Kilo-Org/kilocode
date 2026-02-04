/**
 * Document-related interfaces for VSCode API
 */

import type { Range } from "../classes/Range.js"
import type { Position } from "../classes/Position.js"
import type { Uri } from "../classes/Uri.js"
import type { Thenable, Disposable } from "../types.js"

/**
 * Represents a text document in VSCode
 */
export interface TextDocument {
	uri: Uri
	fileName: string
	languageId: string
	version: number
	isDirty: boolean
	isClosed: boolean
	lineCount: number
	getText(range?: Range): string
	lineAt(line: number): TextLine
	offsetAt(position: Position): number
	positionAt(offset: number): Position
	save(): Thenable<boolean>
	validateRange(range: Range): Range
	validatePosition(position: Position): Position
}

/**
 * Represents a line of text in a document
 */
export interface TextLine {
	text: string
	range: Range
	rangeIncludingLineBreak: Range
	firstNonWhitespaceCharacterIndex: number
	isEmptyOrWhitespace: boolean
}

/**
 * Event fired when workspace folders change
 */
export interface WorkspaceFoldersChangeEvent {
	added: WorkspaceFolder[]
	removed: WorkspaceFolder[]
}

/**
 * Represents a workspace folder
 */
export interface WorkspaceFolder {
	uri: Uri
	name: string
	index: number
}

/**
 * Event fired when a text document changes
 */
export interface TextDocumentChangeEvent {
	document: TextDocument
	contentChanges: readonly TextDocumentContentChangeEvent[]
}

/**
 * Represents a change in a text document
 */
export interface TextDocumentContentChangeEvent {
	range: Range
	rangeOffset: number
	rangeLength: number
	text: string
}

/**
 * Event fired when configuration changes
 */
export interface ConfigurationChangeEvent {
	affectsConfiguration(section: string, scope?: Uri): boolean
}

/**
 * Provider for text document content
 */
export interface TextDocumentContentProvider {
	provideTextDocumentContent(uri: Uri, token: CancellationToken): Thenable<string>
	onDidChange?: (listener: (e: Uri) => void) => Disposable
}

/**
 * Cancellation token interface (must be local to avoid conflict with ES2023 built-in)
 */
export interface CancellationToken {
	isCancellationRequested: boolean
	onCancellationRequested: (listener: (e: unknown) => void) => Disposable
}

/**
 * File system watcher interface
 */
export interface FileSystemWatcher extends Disposable {
	onDidChange: (listener: (e: Uri) => void) => Disposable
	onDidCreate: (listener: (e: Uri) => void) => Disposable
	onDidDelete: (listener: (e: Uri) => void) => Disposable
}

/**
 * Relative pattern for file matching
 */
export interface RelativePattern {
	base: string
	pattern: string
}
