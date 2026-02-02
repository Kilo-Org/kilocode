/**
 * Core VSCode API type definitions
 *
 * This file contains TypeScript type definitions that match the VSCode Extension API.
 * These types allow VSCode extensions to run in Node.js without VSCode installed.
 */

/**
 * Represents a thenable (Promise-like) value
 */
export type Thenable<T> = Promise<T>

/**
 * Represents a disposable resource that can be cleaned up
 */
export interface Disposable {
	dispose(): void
}

/**
 * Represents a Uniform Resource Identifier (URI)
 */
export interface IUri {
	scheme: string
	authority: string
	path: string
	query: string
	fragment: string
	fsPath: string
	toString(): string
}

/**
 * Represents a position in a text document (line and character)
 */
export interface IPosition {
	line: number
	character: number
	isEqual(other: IPosition): boolean
	isBefore(other: IPosition): boolean
	isBeforeOrEqual(other: IPosition): boolean
	isAfter(other: IPosition): boolean
	isAfterOrEqual(other: IPosition): boolean
	compareTo(other: IPosition): number
}

/**
 * Represents a range in a text document (start and end positions)
 */
export interface IRange {
	start: IPosition
	end: IPosition
	isEmpty: boolean
	isSingleLine: boolean
	contains(positionOrRange: IPosition | IRange): boolean
	isEqual(other: IRange): boolean
	intersection(other: IRange): IRange | undefined
	union(other: IRange): IRange
}

/**
 * Represents a selection in a text editor (extends Range with anchor and active positions)
 */
export interface ISelection extends IRange {
	anchor: IPosition
	active: IPosition
	isReversed: boolean
}

/**
 * Represents a line of text in a document
 */
export interface TextLine {
	text: string
	range: IRange
	rangeIncludingLineBreak: IRange
	firstNonWhitespaceCharacterIndex: number
	isEmptyOrWhitespace: boolean
}

/**
 * Represents a text document
 */
export interface TextDocument {
	uri: IUri
	fileName: string
	languageId: string
	version: number
	isDirty: boolean
	isClosed: boolean
	lineCount: number
	getText(range?: IRange): string
	lineAt(line: number): TextLine
	offsetAt(position: IPosition): number
	positionAt(offset: number): IPosition
	save(): Thenable<boolean>
	validateRange(range: IRange): IRange
	validatePosition(position: IPosition): IPosition
}

/**
 * Configuration target for settings
 */
export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}

/**
 * Workspace folder representation
 */
export interface WorkspaceFolder {
	uri: IUri
	name: string
	index: number
}

/**
 * Workspace configuration interface
 */
export interface WorkspaceConfiguration {
	get<T>(section: string): T | undefined
	get<T>(section: string, defaultValue: T): T
	has(section: string): boolean
	inspect<T>(section: string): ConfigurationInspect<T> | undefined
	update(section: string, value: unknown, configurationTarget?: ConfigurationTarget): Thenable<void>
}

/**
 * Configuration inspection result
 */
export interface ConfigurationInspect<T> {
	key: string
	defaultValue?: T
	globalValue?: T
	workspaceValue?: T
	workspaceFolderValue?: T
}

/**
 * Memento (state storage) interface
 */
export interface Memento {
	get<T>(key: string): T | undefined
	get<T>(key: string, defaultValue: T): T
	update(key: string, value: unknown): Thenable<void>
	keys(): readonly string[]
}

/**
 * Secret storage interface for secure credential storage
 */
export interface SecretStorage {
	get(key: string): Thenable<string | undefined>
	store(key: string, value: string): Thenable<void>
	delete(key: string): Thenable<void>
	onDidChange: Event<SecretStorageChangeEvent>
}

/**
 * Secret storage change event
 */
export interface SecretStorageChangeEvent {
	key: string
}

/**
 * Represents an extension
 */
export interface Extension<T> {
	id: string
	extensionUri: IUri
	extensionPath: string
	isActive: boolean
	packageJSON: Record<string, unknown>
	exports: T
	extensionKind: ExtensionKind
	activate(): Thenable<T>
}

/**
 * Extension kind enum
 */
export enum ExtensionKind {
	UI = 1,
	Workspace = 2,
}

/**
 * Extension context provided to extension activation
 */
export interface ExtensionContext {
	subscriptions: Disposable[]
	workspaceState: Memento
	globalState: Memento & { setKeysForSync(keys: readonly string[]): void }
	secrets: SecretStorage
	extensionUri: IUri
	extensionPath: string
	environmentVariableCollection: Record<string, unknown>
	storageUri: IUri | undefined
	storagePath: string | undefined
	globalStorageUri: IUri
	globalStoragePath: string
	logUri: IUri
	logPath: string
	extensionMode: ExtensionMode
	extension: Extension<unknown> | undefined
}

/**
 * Extension mode enum
 */
export enum ExtensionMode {
	Production = 1,
	Development = 2,
	Test = 3,
}

/**
 * Event emitter event type
 */
export type Event<T> = (listener: (e: T) => void, thisArgs?: unknown, disposables?: Disposable[]) => Disposable

/**
 * Cancellation token for async operations
 */
export interface CancellationToken {
	isCancellationRequested: boolean
	onCancellationRequested: Event<unknown>
}

/**
 * File system file type enum
 */
export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

/**
 * File system stat information
 */
export interface FileStat {
	type: FileType
	ctime: number
	mtime: number
	size: number
}

/**
 * Text editor options
 */
export interface TextEditorOptions {
	tabSize?: number
	insertSpaces?: boolean
	cursorStyle?: number
	lineNumbers?: number
}

/**
 * View column enum for editor placement
 */
export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3,
}

/**
 * UI Kind enum
 */
export enum UIKind {
	Desktop = 1,
	Web = 2,
}

/**
 * End of line sequence enum
 */
export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

/**
 * Status bar alignment
 */
export enum StatusBarAlignment {
	Left = 1,
	Right = 2,
}

/**
 * Diagnostic severity levels
 */
export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

/**
 * Diagnostic tags
 */
export enum DiagnosticTag {
	Unnecessary = 1,
	Deprecated = 2,
}

/**
 * Overview ruler lane
 */
export enum OverviewRulerLane {
	Left = 1,
	Center = 2,
	Right = 4,
	Full = 7,
}

/**
 * Decoration range behavior
 */
export enum DecorationRangeBehavior {
	OpenOpen = 0,
	ClosedClosed = 1,
	OpenClosed = 2,
	ClosedOpen = 3,
}

/**
 * Text editor reveal type
 */
export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3,
}
