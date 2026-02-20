import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as crypto from "crypto"
import { logs } from "../utils/logger.js"
import { KiloCodePaths } from "../utils/paths.js"
import { Package } from "../constants/package.js"
// Use default import for CommonJS module compatibility
import nodeMachineId from "node-machine-id"
const { machineIdSync } = nodeMachineId

// Identity information for VSCode environment
export interface IdentityInfo {
	machineId: string
	sessionId: string
	cliUserId?: string
}

// Basic VSCode API types and enums
export type Thenable<T> = Promise<T>

// TextDocument interface for VSCode API
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

export interface TextLine {
	text: string
	range: Range
	rangeIncludingLineBreak: Range
	firstNonWhitespaceCharacterIndex: number
	isEmptyOrWhitespace: boolean
}

export interface WorkspaceFoldersChangeEvent {
	added: WorkspaceFolder[]
	removed: WorkspaceFolder[]
}

export interface TextDocumentChangeEvent {
	document: TextDocument
	contentChanges: readonly TextDocumentContentChangeEvent[]
}

export interface TextDocumentContentChangeEvent {
	range: Range
	rangeOffset: number
	rangeLength: number
	text: string
}

export interface ConfigurationChangeEvent {
	affectsConfiguration(section: string, scope?: Uri): boolean
}

export interface ConfigurationInspect<T> {
	key: string
	defaultValue?: T
	globalValue?: T
	workspaceValue?: T
	workspaceFolderValue?: T
}

export interface TextDocumentContentProvider {
	provideTextDocumentContent(uri: Uri, token: CancellationToken): Thenable<string>
	onDidChange?: (listener: (e: Uri) => void) => Disposable
}

export interface FileSystemWatcher extends Disposable {
	onDidChange: (listener: (e: Uri) => void) => Disposable
	onDidCreate: (listener: (e: Uri) => void) => Disposable
	onDidDelete: (listener: (e: Uri) => void) => Disposable
}

export interface RelativePattern {
	base: string
	pattern: string
}

// TextEditor and related interfaces
export interface TextEditor {
	document: TextDocument
	selection: Selection
	selections: Selection[]
	visibleRanges: Range[]
	options: TextEditorOptions
	viewColumn?: ViewColumn
	edit(callback: (editBuilder: TextEditorEdit) => void): Thenable<boolean>
	insertSnippet(
		snippet: unknown,
		location?: Position | Range | readonly Position[] | readonly Range[],
	): Thenable<boolean>
	setDecorations(decorationType: TextEditorDecorationType, rangesOrOptions: readonly Range[]): void
	revealRange(range: Range, revealType?: TextEditorRevealType): void
	show(column?: ViewColumn): void
	hide(): void
}

export interface TextEditorOptions {
	tabSize?: number
	insertSpaces?: boolean
	cursorStyle?: number
	lineNumbers?: number
}

export interface TextEditorEdit {
	replace(location: Position | Range | Selection, value: string): void
	insert(location: Position, value: string): void
	delete(location: Range | Selection): void
	setEndOfLine(endOfLine: EndOfLine): void
}

export interface TextEditorSelectionChangeEvent {
	textEditor: TextEditor
	selections: readonly Selection[]
	kind?: number
}

export interface TextDocumentShowOptions {
	viewColumn?: ViewColumn
	preserveFocus?: boolean
	preview?: boolean
	selection?: Range
}

export interface DecorationRenderOptions {
	backgroundColor?: string | ThemeColor
	border?: string
	borderColor?: string | ThemeColor
	borderRadius?: string
	borderSpacing?: string
	borderStyle?: string
	borderWidth?: string
	color?: string | ThemeColor
	cursor?: string
	fontStyle?: string
	fontWeight?: string
	gutterIconPath?: string | Uri
	gutterIconSize?: string
	isWholeLine?: boolean
	letterSpacing?: string
	opacity?: string
	outline?: string
	outlineColor?: string | ThemeColor
	outlineStyle?: string
	outlineWidth?: string
	overviewRulerColor?: string | ThemeColor
	overviewRulerLane?: OverviewRulerLane
	rangeBehavior?: DecorationRangeBehavior
	textDecoration?: string
}

export interface Terminal {
	name: string
	processId: Thenable<number | undefined>
	creationOptions: Readonly<TerminalOptions>
	exitStatus: TerminalExitStatus | undefined
	state: TerminalState
	sendText(text: string, addNewLine?: boolean): void
	show(preserveFocus?: boolean): void
	hide(): void
	dispose(): void
}

export interface TerminalOptions {
	name?: string
	shellPath?: string
	shellArgs?: string[] | string
	cwd?: string | Uri
	env?: { [key: string]: string | null | undefined }
	iconPath?: Uri | ThemeIcon
	hideFromUser?: boolean
	message?: string
	strictEnv?: boolean
}

export interface TerminalExitStatus {
	code: number | undefined
	reason: number
}

export interface TerminalState {
	isInteractedWith: boolean
}

export interface TerminalDimensionsChangeEvent {
	terminal: Terminal
	dimensions: TerminalDimensions
}

export interface TerminalDimensions {
	columns: number
	rows: number
}

export interface TerminalDataWriteEvent {
	terminal: Terminal
	data: string
}

export interface WebviewViewProvider {
	resolveWebviewView(
		webviewView: WebviewView,
		context: WebviewViewResolveContext,
		token: CancellationToken,
	): Thenable<void> | void
}

export interface WebviewView {
	webview: Webview
	viewType: string
	title?: string
	description?: string
	badge?: ViewBadge
	show(preserveFocus?: boolean): void
	onDidChangeVisibility: (listener: () => void) => Disposable
	onDidDispose: (listener: () => void) => Disposable
	visible: boolean
}

export interface Webview {
	html: string
	options: WebviewOptions
	cspSource: string
	postMessage(message: unknown): Thenable<boolean>
	onDidReceiveMessage: (listener: (message: unknown) => void) => Disposable
	asWebviewUri(localResource: Uri): Uri
}

export interface WebviewOptions {
	enableScripts?: boolean
	enableForms?: boolean
	localResourceRoots?: readonly Uri[]
	portMapping?: readonly WebviewPortMapping[]
}

export interface WebviewPortMapping {
	webviewPort: number
	extensionHostPort: number
}

export interface ViewBadge {
	tooltip: string
	value: number
}

export interface WebviewViewResolveContext {
	state?: unknown
}

export interface WebviewViewProviderOptions {
	retainContextWhenHidden?: boolean
}

export interface UriHandler {
	handleUri(uri: Uri): void
}

export interface QuickPickOptions {
	placeHolder?: string
	canPickMany?: boolean
	ignoreFocusOut?: boolean
	matchOnDescription?: boolean
	matchOnDetail?: boolean
}

export interface InputBoxOptions {
	value?: string
	valueSelection?: [number, number]
	prompt?: string
	placeHolder?: string
	password?: boolean
	ignoreFocusOut?: boolean
	validateInput?(value: string): string | undefined | null | Thenable<string | undefined | null>
}

export interface OpenDialogOptions {
	defaultUri?: Uri
	openLabel?: string
	canSelectFiles?: boolean
	canSelectFolders?: boolean
	canSelectMany?: boolean
	filters?: { [name: string]: string[] }
	title?: string
}

// VSCode EventEmitter implementation
export interface Disposable {
	dispose(): void
}

type Listener<T> = (e: T) => void

export class EventEmitter<T> {
	readonly #listeners = new Set<Listener<T>>()

	/**
	 * The event listeners can subscribe to.
	 */
	event = (listener: (e: T) => void, thisArgs?: unknown, disposables?: Disposable[]): Disposable => {
		const fn = thisArgs ? listener.bind(thisArgs) : listener
		this.#listeners.add(fn)
		const disposable = {
			dispose: () => {
				this.#listeners.delete(fn)
			},
		}

		if (disposables) {
			disposables.push(disposable)
		}

		return disposable
	}

	/**
	 * Notify all subscribers of the event. Failure
	 * of one or more listener will not fail this function call.
	 *
	 * @param data The event object.
	 */
	fire = (data: T): void => {
		for (const listener of this.#listeners) {
			try {
				listener(data)
			} catch {
				// ignore
			}
		}
	}

	/**
	 * Dispose this object and free resources.
	 */
	dispose = (): void => {
		this.#listeners.clear()
	}
}
export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3,
}

export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3,
}

export enum StatusBarAlignment {
	Left = 1,
	Right = 2,
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

// Position class
export class Position {
	constructor(
		public line: number,
		public character: number,
	) {}

	isEqual(other: Position): boolean {
		return this.line === other.line && this.character === other.character
	}

	isBefore(other: Position): boolean {
		if (this.line < other.line) {
			return true
		}
		if (this.line === other.line) {
			return this.character < other.character
		}
		return false
	}

	isBeforeOrEqual(other: Position): boolean {
		return this.isBefore(other) || this.isEqual(other)
	}

	isAfter(other: Position): boolean {
		return !this.isBeforeOrEqual(other)
	}

	isAfterOrEqual(other: Position): boolean {
		return !this.isBefore(other)
	}

	compareTo(other: Position): number {
		if (this.line < other.line) {
			return -1
		}
		if (this.line > other.line) {
			return 1
		}
		if (this.character < other.character) {
			return -1
		}
		if (this.character > other.character) {
			return 1
		}
		return 0
	}

	translate(lineDelta?: number, characterDelta?: number): Position
	translate(change: { lineDelta?: number; characterDelta?: number }): Position
	translate(
		lineDeltaOrChange?: number | { lineDelta?: number; characterDelta?: number },
		characterDelta?: number,
	): Position {
		if (typeof lineDeltaOrChange === "object") {
			return new Position(
				this.line + (lineDeltaOrChange.lineDelta || 0),
				this.character + (lineDeltaOrChange.characterDelta || 0),
			)
		}
		return new Position(this.line + (lineDeltaOrChange || 0), this.character + (characterDelta || 0))
	}

	with(line?: number, character?: number): Position
	with(change: { line?: number; character?: number }): Position
	with(lineOrChange?: number | { line?: number; character?: number }, character?: number): Position {
		if (typeof lineOrChange === "object") {
			return new Position(
				lineOrChange.line !== undefined ? lineOrChange.line : this.line,
				lineOrChange.character !== undefined ? lineOrChange.character : this.character,
			)
		}
		return new Position(
			lineOrChange !== undefined ? lineOrChange : this.line,
			character !== undefined ? character : this.character,
		)
	}
}

// Range class
export class Range {
	public start: Position
	public end: Position

	constructor(start: Position, end: Position)
	constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
	constructor(
		startOrStartLine: Position | number,
		endOrStartCharacter: Position | number,
		endLine?: number,
		endCharacter?: number,
	) {
		if (typeof startOrStartLine === "number") {
			this.start = new Position(startOrStartLine, endOrStartCharacter as number)
			this.end = new Position(endLine!, endCharacter!)
		} else {
			this.start = startOrStartLine
			this.end = endOrStartCharacter as Position
		}
	}

	get isEmpty(): boolean {
		return this.start.isEqual(this.end)
	}

	get isSingleLine(): boolean {
		return this.start.line === this.end.line
	}

	contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Range) {
			return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
		}
		return positionOrRange.isAfterOrEqual(this.start) && positionOrRange.isBeforeOrEqual(this.end)
	}

	isEqual(other: Range): boolean {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end)
	}

	intersection(other: Range): Range | undefined {
		const start = this.start.isAfter(other.start) ? this.start : other.start
		const end = this.end.isBefore(other.end) ? this.end : other.end
		if (start.isAfter(end)) {
			return undefined
		}
		return new Range(start, end)
	}

	union(other: Range): Range {
		const start = this.start.isBefore(other.start) ? this.start : other.start
		const end = this.end.isAfter(other.end) ? this.end : other.end
		return new Range(start, end)
	}

	with(start?: Position, end?: Position): Range
	with(change: { start?: Position; end?: Position }): Range
	with(startOrChange?: Position | { start?: Position; end?: Position }, end?: Position): Range {
		if (startOrChange instanceof Position) {
			return new Range(startOrChange, end || this.end)
		}
		if (typeof startOrChange === "object") {
			return new Range(startOrChange.start || this.start, startOrChange.end || this.end)
		}
		return new Range(this.start, this.end)
	}
}

// Selection class (extends Range)
export class Selection extends Range {
	public anchor: Position
	public active: Position

	constructor(anchor: Position, active: Position)
	constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number)
	constructor(
		anchorOrAnchorLine: Position | number,
		activeOrAnchorCharacter: Position | number,
		activeLine?: number,
		activeCharacter?: number,
	) {
		let anchor: Position
		let active: Position

		if (typeof anchorOrAnchorLine === "number") {
			anchor = new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number)
			active = new Position(activeLine!, activeCharacter!)
		} else {
			anchor = anchorOrAnchorLine
			active = activeOrAnchorCharacter as Position
		}

		super(anchor, active)
		this.anchor = anchor
		this.active = active
	}

	get isReversed(): boolean {
		return this.anchor.isAfter(this.active)
	}
}

// Location class
export class Location {
	constructor(
		public uri: Uri,
		public range: Range | Position,
	) {}
}

// Diagnostic-related classes
export enum DiagnosticTag {
	Unnecessary = 1,
	Deprecated = 2,
}

export class DiagnosticRelatedInformation {
	constructor(
		public location: Location,
		public message: string,
	) {}
}

export class Diagnostic {
	range: Range
	message: string
	severity: DiagnosticSeverity
	source?: string
	code?: string | number | { value: string | number; target: Uri }
	relatedInformation?: DiagnosticRelatedInformation[]
	tags?: DiagnosticTag[]

	constructor(range: Range, message: string, severity?: DiagnosticSeverity) {
		this.range = range
		this.message = message
		this.severity = severity !== undefined ? severity : DiagnosticSeverity.Error
	}
}

// DiagnosticCollection interface
export interface DiagnosticCollection extends Disposable {
	name: string
	set(uri: Uri, diagnostics: Diagnostic[] | undefined): void
	set(entries: [Uri, Diagnostic[] | undefined][]): void
	delete(uri: Uri): void
	clear(): void
	forEach(
		callback: (uri: Uri, diagnostics: Diagnostic[], collection: DiagnosticCollection) => void,
		thisArg?: unknown,
	): void
	get(uri: Uri): Diagnostic[] | undefined
	has(uri: Uri): boolean
}

// TextEdit class
export class TextEdit {
	range: Range
	newText: string

	constructor(range: Range, newText: string) {
		this.range = range
		this.newText = newText
	}

	static replace(range: Range, newText: string): TextEdit {
		return new TextEdit(range, newText)
	}

	static insert(position: Position, newText: string): TextEdit {
		return new TextEdit(new Range(position, position), newText)
	}

	static delete(range: Range): TextEdit {
		return new TextEdit(range, "")
	}

	static setEndOfLine(): TextEdit {
		// Simplified implementation
		return new TextEdit(new Range(new Position(0, 0), new Position(0, 0)), "")
	}
}

// EndOfLine enum
export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

// WorkspaceEdit class
export class WorkspaceEdit {
	private _edits: Map<string, TextEdit[]> = new Map()

	set(uri: Uri, edits: TextEdit[]): void {
		this._edits.set(uri.toString(), edits)
	}

	get(uri: Uri): TextEdit[] {
		return this._edits.get(uri.toString()) || []
	}

	has(uri: Uri): boolean {
		return this._edits.has(uri.toString())
	}

	delete(uri: Uri, range: Range): void {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key)!.push(TextEdit.delete(range))
	}

	insert(uri: Uri, position: Position, newText: string): void {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key)!.push(TextEdit.insert(position, newText))
	}

	replace(uri: Uri, range: Range, newText: string): void {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key)!.push(TextEdit.replace(range, newText))
	}

	get size(): number {
		return this._edits.size
	}

	entries(): [Uri, TextEdit[]][] {
		return Array.from(this._edits.entries()).map(([uriString, edits]) => [Uri.parse(uriString), edits])
	}
}

// UI Kind enum
export enum UIKind {
	Desktop = 1,
	Web = 2,
}

// Extension Mode enum
export enum ExtensionMode {
	Production = 1,
	Development = 2,
	Test = 3,
}

// Code Action Kind mock
export class CodeActionKind {
	static readonly Empty = new CodeActionKind("")
	static readonly QuickFix = new CodeActionKind("quickfix")
	static readonly Refactor = new CodeActionKind("refactor")
	static readonly RefactorExtract = new CodeActionKind("refactor.extract")
	static readonly RefactorInline = new CodeActionKind("refactor.inline")
	static readonly RefactorRewrite = new CodeActionKind("refactor.rewrite")
	static readonly Source = new CodeActionKind("source")
	static readonly SourceOrganizeImports = new CodeActionKind("source.organizeImports")

	constructor(public value: string) {}

	append(parts: string): CodeActionKind {
		return new CodeActionKind(this.value ? `${this.value}.${parts}` : parts)
	}

	intersects(other: CodeActionKind): boolean {
		return this.contains(other) || other.contains(this)
	}

	contains(other: CodeActionKind): boolean {
		return this.value === other.value || other.value.startsWith(this.value + ".")
	}
}

// Theme Color mock
export class ThemeColor {
	constructor(public id: string) {}
}

// Theme Icon mock
export class ThemeIcon {
	constructor(
		public id: string,
		public color?: ThemeColor,
	) {}
}

// Cancellation Token mock
export interface CancellationToken {
	isCancellationRequested: boolean
	onCancellationRequested: (listener: (e: unknown) => void) => Disposable
}

export class CancellationTokenSource {
	private _token: CancellationToken
	private _isCancelled = false
	private _onCancellationRequestedEmitter = new EventEmitter<void>()

	constructor() {
		this._token = {
			isCancellationRequested: false,
			onCancellationRequested: this._onCancellationRequestedEmitter.event,
		}
	}

	get token(): CancellationToken {
		return this._token
	}

	cancel(): void {
		if (!this._isCancelled) {
			this._isCancelled = true
			// Type assertion needed to modify readonly property
			;(this._token as { isCancellationRequested: boolean }).isCancellationRequested = true
			this._onCancellationRequestedEmitter.fire(undefined)
		}
	}

	dispose(): void {
		this.cancel()
		this._onCancellationRequestedEmitter.dispose()
	}
}

// CodeLens mock
export class CodeLens {
	public range: Range
	public command?: { command: string; title: string; arguments?: unknown[] } | undefined
	public isResolved: boolean = false

	constructor(range: Range, command?: { command: string; title: string; arguments?: unknown[] } | undefined) {
		this.range = range
		this.command = command
	}
}

// Language Model API mocks (for VSCode LM API)
export class LanguageModelTextPart {
	constructor(public value: string) {}
}

export class LanguageModelToolCallPart {
	constructor(
		public callId: string,
		public name: string,
		public input: unknown,
	) {}
}

export class LanguageModelToolResultPart {
	constructor(
		public callId: string,
		public content: unknown[],
	) {}
}

// Decoration Range Behavior mock
export enum DecorationRangeBehavior {
	OpenOpen = 0,
	ClosedClosed = 1,
	OpenClosed = 2,
	ClosedOpen = 3,
}

// Overview Ruler Lane mock
export enum OverviewRulerLane {
	Left = 1,
	Center = 2,
	Right = 4,
	Full = 7,
}

// URI class mock
export class Uri {
	public scheme: string
	public authority: string
	public path: string
	public query: string
	public fragment: string

	constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
		this.scheme = scheme
		this.authority = authority
		this.path = path
		this.query = query
		this.fragment = fragment
	}

	static file(path: string): Uri {
		return new Uri("file", "", path, "", "")
	}

	static parse(value: string): Uri {
		const url = new URL(value)
		return new Uri(url.protocol.slice(0, -1), url.hostname, url.pathname, url.search.slice(1), url.hash.slice(1))
	}

	static joinPath(base: Uri, ...pathSegments: string[]): Uri {
		const joinedPath = path.join(base.path, ...pathSegments)
		return new Uri(base.scheme, base.authority, joinedPath, base.query, base.fragment)
	}

	with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
		return new Uri(
			change.scheme !== undefined ? change.scheme : this.scheme,
			change.authority !== undefined ? change.authority : this.authority,
			change.path !== undefined ? change.path : this.path,
			change.query !== undefined ? change.query : this.query,
			change.fragment !== undefined ? change.fragment : this.fragment,
		)
	}

	get fsPath(): string {
		return this.path
	}

	toString(): string {
		return `${this.scheme}://${this.authority}${this.path}${this.query ? "?" + this.query : ""}${this.fragment ? "#" + this.fragment : ""}`
	}
}

// Output Channel mock
export class OutputChannel implements Disposable {
	private _name: string

	constructor(name: string) {
		this._name = name
	}

	get name(): string {
		return this._name
	}

	append(value: string): void {
		logs.info(`[${this._name}] ${value}`, "VSCode.OutputChannel")
	}

	appendLine(value: string): void {
		logs.info(`[${this._name}] ${value}`, "VSCode.OutputChannel")
	}

	clear(): void {
		// No-op for CLI
	}

	show(): void {
		// No-op for CLI
	}

	hide(): void {
		// No-op for CLI
	}

	dispose(): void {
		// No-op for CLI
	}
}

// Extension Context mock
export class ExtensionContext {
	public subscriptions: Disposable[] = []
	public workspaceState: Memento
	public globalState: Memento & { setKeysForSync(keys: readonly string[]): void }
	public secrets: SecretStorage
	public extensionUri: Uri
	public extensionPath: string
	public environmentVariableCollection: Record<string, unknown> = {}
	public storageUri: Uri | undefined
	public storagePath: string | undefined
	public globalStorageUri: Uri
	public globalStoragePath: string
	public logUri: Uri
	public logPath: string
	public extensionMode: ExtensionMode = ExtensionMode.Production

	/**
	 * @param extensionPath - Path to the extension root
	 * @param workspacePath - Path to the workspace
	 * @param useMemoryOnlyStorage - If true, use in-memory storage only (no file I/O).
	 *        Use this for agent-manager where config comes via IPC and persistence isn't needed.
	 */
	constructor(extensionPath: string, workspacePath: string, useMemoryOnlyStorage = false) {
		this.extensionPath = extensionPath
		this.extensionUri = Uri.file(extensionPath)

		if (useMemoryOnlyStorage) {
			// Use temp directory for agent-manager mode to avoid polluting user workspace
			// Each agent gets a unique session ID for isolation
			// Config comes via IPC, so persistence isn't needed - temp dir is cleaned by OS
			const sessionId = process.env.AGENT_SESSION_ID || crypto.randomUUID()
			const tempBase = path.join(os.tmpdir(), "kilocode-agent", sessionId)

			this.globalStoragePath = tempBase
			this.globalStorageUri = Uri.file(tempBase)
			this.storagePath = path.join(tempBase, "workspace")
			this.storageUri = Uri.file(this.storagePath)
			this.logPath = path.join(tempBase, "logs")
			this.logUri = Uri.file(this.logPath)

			// Use pure in-memory mementos (no file backing)
			this.workspaceState = new InMemoryMemento()
			const globalMemento = new InMemoryMemento()
			this.globalState = Object.assign(globalMemento, {
				setKeysForSync: () => {},
			})
			this.secrets = new InMemorySecretStorage()
		} else {
			// Use file-backed storage (CLI mode)
			KiloCodePaths.initializeWorkspace(workspacePath)

			const globalStoragePath = KiloCodePaths.getGlobalStorageDir()
			const workspaceStoragePath = KiloCodePaths.getWorkspaceStorageDir(workspacePath)
			const logPath = KiloCodePaths.getLogsDir()

			this.globalStoragePath = globalStoragePath
			this.globalStorageUri = Uri.file(globalStoragePath)
			this.storagePath = workspaceStoragePath
			this.storageUri = Uri.file(workspaceStoragePath)
			this.logPath = logPath
			this.logUri = Uri.file(logPath)

			// Ensure directories exist
			this.ensureDirectoryExists(globalStoragePath)
			this.ensureDirectoryExists(workspaceStoragePath)
			this.ensureDirectoryExists(logPath)

			// Initialize state storage with file backing
			this.workspaceState = new MemoryMemento(path.join(workspaceStoragePath, "workspace-state.json"))
			const globalMemento = new MemoryMemento(path.join(globalStoragePath, "global-state.json"))
			this.globalState = Object.assign(globalMemento, {
				setKeysForSync: () => {},
			})
			this.secrets = new MockSecretStorage(globalStoragePath)
		}
	}

	private ensureDirectoryExists(dirPath: string): void {
		try {
			if (!fs.existsSync(dirPath)) {
				fs.mkdirSync(dirPath, { recursive: true })
			}
		} catch (error) {
			logs.warn(`Failed to create directory ${dirPath}`, "VSCode.ExtensionContext", { error })
		}
	}
}

// Memento (state storage) implementation
export interface Memento {
	get<T>(key: string): T | undefined
	get<T>(key: string, defaultValue: T): T
	update(key: string, value: unknown): Thenable<void>
	keys(): readonly string[]
}

class MemoryMemento implements Memento {
	private data: Record<string, unknown> = {}
	private filePath: string

	constructor(filePath: string) {
		this.filePath = filePath
		this.loadFromFile()
	}

	private loadFromFile(): void {
		try {
			if (fs.existsSync(this.filePath)) {
				const content = fs.readFileSync(this.filePath, "utf-8")
				this.data = JSON.parse(content)
			}
		} catch (error) {
			logs.warn(`Failed to load state from ${this.filePath}`, "VSCode.Memento", { error })
			this.data = {}
		}
	}

	private saveToFile(): void {
		try {
			// Ensure directory exists
			const dir = path.dirname(this.filePath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
		} catch (error) {
			logs.warn(`Failed to save state to ${this.filePath}`, "VSCode.Memento", { error })
		}
	}

	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.data[key]
		return value !== undefined && value !== null ? (value as T) : defaultValue
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			delete this.data[key]
		} else {
			this.data[key] = value
		}
		this.saveToFile()
	}

	keys(): readonly string[] {
		return Object.keys(this.data)
	}
}

/**
 * Pure in-memory Memento implementation (no file I/O).
 * Used for agent-manager where persistence isn't needed.
 */
class InMemoryMemento implements Memento {
	private data: Record<string, unknown> = {}

	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.data[key]
		return value !== undefined && value !== null ? (value as T) : defaultValue
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			delete this.data[key]
		} else {
			this.data[key] = value
		}
	}

	keys(): readonly string[] {
		return Object.keys(this.data)
	}
}

/**
 * Pure in-memory SecretStorage implementation (no file I/O).
 * Used for agent-manager where secrets come via IPC.
 */
class InMemorySecretStorage implements SecretStorage {
	private secrets: Record<string, string> = {}
	private _onDidChange = new EventEmitter<{ key: string }>()

	async get(key: string): Promise<string | undefined> {
		return this.secrets[key]
	}

	async store(key: string, value: string): Promise<void> {
		this.secrets[key] = value
		this._onDidChange.fire({ key })
	}

	async delete(key: string): Promise<void> {
		delete this.secrets[key]
		this._onDidChange.fire({ key })
	}

	get onDidChange() {
		return this._onDidChange.event
	}
}

// Secret Storage mock
export interface SecretStorage {
	get(key: string): Thenable<string | undefined>
	store(key: string, value: string): Thenable<void>
	delete(key: string): Thenable<void>
}

class MockSecretStorage implements SecretStorage {
	private secrets: Record<string, string> = {}
	private _onDidChange = new EventEmitter<{ key: string }>()
	private filePath: string

	constructor(storagePath: string) {
		this.filePath = path.join(storagePath, "secrets.json")
		this.loadFromFile()
	}

	private loadFromFile(): void {
		try {
			if (fs.existsSync(this.filePath)) {
				const content = fs.readFileSync(this.filePath, "utf-8")
				this.secrets = JSON.parse(content)
			}
		} catch (error) {
			logs.warn(`Failed to load secrets from ${this.filePath}`, "VSCode.MockSecretStorage", { error })
			this.secrets = {}
		}
	}

	private saveToFile(): void {
		try {
			// Ensure directory exists
			const dir = path.dirname(this.filePath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			fs.writeFileSync(this.filePath, JSON.stringify(this.secrets, null, 2))
		} catch (error) {
			logs.warn(`Failed to save secrets to ${this.filePath}`, "VSCode.MockSecretStorage", { error })
		}
	}

	async get(key: string): Promise<string | undefined> {
		return this.secrets[key]
	}

	async store(key: string, value: string): Promise<void> {
		this.secrets[key] = value
		this.saveToFile()
		this._onDidChange.fire({ key })
	}

	async delete(key: string): Promise<void> {
		delete this.secrets[key]
		this.saveToFile()
		this._onDidChange.fire({ key })
	}

	get onDidChange() {
		return this._onDidChange.event
	}
}

// FileSystem API mock
export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

// FileSystemError class mock
export class FileSystemError extends Error {
	public code: string

	constructor(message: string, code: string = "Unknown") {
		super(message)
		this.name = "FileSystemError"
		this.code = code
	}

	static FileNotFound(messageOrUri?: string | Uri): FileSystemError {
		const message =
			typeof messageOrUri === "string" ? messageOrUri : `File not found: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "FileNotFound")
	}

	static FileExists(messageOrUri?: string | Uri): FileSystemError {
		const message =
			typeof messageOrUri === "string" ? messageOrUri : `File exists: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "FileExists")
	}

	static FileNotADirectory(messageOrUri?: string | Uri): FileSystemError {
		const message =
			typeof messageOrUri === "string"
				? messageOrUri
				: `File is not a directory: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "FileNotADirectory")
	}

	static FileIsADirectory(messageOrUri?: string | Uri): FileSystemError {
		const message =
			typeof messageOrUri === "string"
				? messageOrUri
				: `File is a directory: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "FileIsADirectory")
	}

	static NoPermissions(messageOrUri?: string | Uri): FileSystemError {
		const message =
			typeof messageOrUri === "string" ? messageOrUri : `No permissions: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "NoPermissions")
	}

	static Unavailable(messageOrUri?: string | Uri): FileSystemError {
		const message =
			typeof messageOrUri === "string" ? messageOrUri : `Unavailable: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "Unavailable")
	}
}

export interface FileStat {
	type: FileType
	ctime: number
	mtime: number
	size: number
}

export class FileSystemAPI {
	async stat(uri: Uri): Promise<FileStat> {
		try {
			const stats = fs.statSync(uri.fsPath)
			return {
				type: stats.isDirectory() ? FileType.Directory : FileType.File,
				ctime: stats.ctimeMs,
				mtime: stats.mtimeMs,
				size: stats.size,
			}
		} catch {
			// If file doesn't exist, assume it's a file for CLI purposes
			return {
				type: FileType.File,
				ctime: Date.now(),
				mtime: Date.now(),
				size: 0,
			}
		}
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		try {
			const content = fs.readFileSync(uri.fsPath)
			return new Uint8Array(content)
		} catch (error) {
			// Check if it's a file not found error (ENOENT)
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw FileSystemError.FileNotFound(uri)
			}
			// For other errors, throw a generic FileSystemError
			throw new FileSystemError(`Failed to read file: ${uri.fsPath}`)
		}
	}

	async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
		try {
			// Use Buffer.from to ensure proper handling of Uint8Array content
			// and write with explicit encoding to handle Unicode paths on Windows
			fs.writeFileSync(uri.fsPath, Buffer.from(content))
		} catch (error) {
			throw new Error(`Failed to write file: ${uri.fsPath}: ${(error as Error).message}`)
		}
	}

	async delete(uri: Uri): Promise<void> {
		try {
			fs.unlinkSync(uri.fsPath)
		} catch {
			throw new Error(`Failed to delete file: ${uri.fsPath}`)
		}
	}

	async createDirectory(uri: Uri): Promise<void> {
		try {
			fs.mkdirSync(uri.fsPath, { recursive: true })
		} catch {
			throw new Error(`Failed to create directory: ${uri.fsPath}`)
		}
	}
}

// Workspace API mock
export class WorkspaceAPI {
	public workspaceFolders: WorkspaceFolder[] | undefined
	public name: string | undefined
	public workspaceFile: Uri | undefined
	public fs: FileSystemAPI
	public textDocuments: TextDocument[] = []
	private _onDidChangeWorkspaceFolders = new EventEmitter<WorkspaceFoldersChangeEvent>()
	private _onDidOpenTextDocument = new EventEmitter<TextDocument>()
	private _onDidChangeTextDocument = new EventEmitter<TextDocumentChangeEvent>()
	private _onDidCloseTextDocument = new EventEmitter<TextDocument>()
	private workspacePath: string
	private context: ExtensionContext

	constructor(workspacePath: string, context: ExtensionContext) {
		this.workspacePath = workspacePath
		this.context = context
		this.workspaceFolders = [
			{
				uri: Uri.file(workspacePath),
				name: path.basename(workspacePath),
				index: 0,
			},
		]
		this.name = path.basename(workspacePath)
		this.fs = new FileSystemAPI()
	}

	asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string {
		const fsPath = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath

		// If no workspace folders, return the original path
		if (!this.workspaceFolders || this.workspaceFolders.length === 0) {
			return fsPath
		}

		// Try to find a workspace folder that contains this path
		for (const folder of this.workspaceFolders) {
			const workspacePath = folder.uri.fsPath

			// Normalize paths for comparison (handle different path separators)
			const normalizedFsPath = path.normalize(fsPath)
			const normalizedWorkspacePath = path.normalize(workspacePath)

			// Check if the path is within this workspace folder
			if (normalizedFsPath.startsWith(normalizedWorkspacePath)) {
				// Get the relative path
				let relativePath = path.relative(normalizedWorkspacePath, normalizedFsPath)

				// If includeWorkspaceFolder is true and there are multiple workspace folders,
				// prepend the workspace folder name
				if (includeWorkspaceFolder && this.workspaceFolders.length > 1) {
					relativePath = path.join(folder.name, relativePath)
				}

				return relativePath
			}
		}

		// If not within any workspace folder, return the original path
		return fsPath
	}

	onDidChangeWorkspaceFolders(listener: (event: WorkspaceFoldersChangeEvent) => void): Disposable {
		return this._onDidChangeWorkspaceFolders.event(listener)
	}

	onDidChangeConfiguration(listener: (event: ConfigurationChangeEvent) => void): Disposable {
		// Create a mock configuration change event emitter
		const emitter = new EventEmitter<ConfigurationChangeEvent>()
		return emitter.event(listener)
	}

	onDidChangeTextDocument(listener: (event: TextDocumentChangeEvent) => void): Disposable {
		return this._onDidChangeTextDocument.event(listener)
	}

	onDidOpenTextDocument(listener: (event: TextDocument) => void): Disposable {
		logs.debug("Registering onDidOpenTextDocument listener", "VSCode.Workspace")
		return this._onDidOpenTextDocument.event(listener)
	}

	onDidCloseTextDocument(listener: (event: TextDocument) => void): Disposable {
		return this._onDidCloseTextDocument.event(listener)
	}

	getConfiguration(section?: string): WorkspaceConfiguration {
		return new MockWorkspaceConfiguration(section, this.context)
	}

	findFiles(_include: string, _exclude?: string): Thenable<Uri[]> {
		// Basic implementation - could be enhanced with glob patterns
		return Promise.resolve([])
	}

	async openTextDocument(uri: Uri): Promise<TextDocument> {
		logs.debug(`openTextDocument called for: ${uri.fsPath}`, "VSCode.Workspace")

		// Read file content
		let content = ""
		try {
			content = fs.readFileSync(uri.fsPath, "utf-8")
			logs.debug(`File content read successfully, length: ${content.length}`, "VSCode.Workspace")
		} catch (error) {
			logs.warn(`Failed to read file: ${uri.fsPath}`, "VSCode.Workspace", { error })
		}

		const lines = content.split("\n")
		const document = {
			uri,
			fileName: uri.fsPath,
			languageId: "plaintext",
			version: 1,
			isDirty: false,
			isClosed: false,
			lineCount: lines.length,
			getText: (range?: Range) => {
				if (!range) {
					return content
				}
				return lines.slice(range.start.line, range.end.line + 1).join("\n")
			},
			lineAt: (line: number) => {
				const text = lines[line] || ""
				return {
					text,
					range: new Range(new Position(line, 0), new Position(line, text.length)),
					rangeIncludingLineBreak: new Range(new Position(line, 0), new Position(line + 1, 0)),
					firstNonWhitespaceCharacterIndex: text.search(/\S/),
					isEmptyOrWhitespace: text.trim().length === 0,
				}
			},
			offsetAt: (position: Position) => {
				let offset = 0
				for (let i = 0; i < position.line && i < lines.length; i++) {
					offset += (lines[i]?.length || 0) + 1 // +1 for newline
				}
				offset += position.character
				return offset
			},
			positionAt: (offset: number) => {
				let currentOffset = 0
				for (let i = 0; i < lines.length; i++) {
					const lineLength = (lines[i]?.length || 0) + 1 // +1 for newline
					if (currentOffset + lineLength > offset) {
						return new Position(i, offset - currentOffset)
					}
					currentOffset += lineLength
				}
				return new Position(lines.length - 1, lines[lines.length - 1]?.length || 0)
			},
			save: () => Promise.resolve(true),
			validateRange: (range: Range) => range,
			validatePosition: (position: Position) => position,
		}

		// Add to textDocuments array
		this.textDocuments.push(document)
		logs.debug(`Document added to textDocuments array, total: ${this.textDocuments.length}`, "VSCode.Workspace")

		// Fire the event after a small delay to ensure listeners are fully registered
		logs.debug("Waiting before firing onDidOpenTextDocument", "VSCode.Workspace")
		await new Promise((resolve) => setTimeout(resolve, 10))
		logs.debug("Firing onDidOpenTextDocument event", "VSCode.Workspace")
		this._onDidOpenTextDocument.fire(document)
		logs.debug("onDidOpenTextDocument event fired", "VSCode.Workspace")

		return document
	}

	async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
		// In CLI mode, we need to apply the edits to the actual files
		try {
			for (const [uri, edits] of edit.entries()) {
				let filePath = uri.fsPath

				// On Windows, strip leading slash if present (e.g., /C:/path becomes C:/path)
				if (process.platform === "win32" && filePath.startsWith("/")) {
					filePath = filePath.slice(1)
				}

				let content = ""

				// Read existing content if file exists
				try {
					content = fs.readFileSync(filePath, "utf-8")
				} catch {
					// File doesn't exist, start with empty content
				}

				// Normalize line endings to LF for consistent offset calculation
				// This handles Windows CRLF files correctly
				const normalizedContent = content.replace(/\r\n/g, "\n")
				const originalLines = normalizedContent.split("\n")
				const getOffset = (line: number, character: number): number => {
					let offset = 0
					for (let i = 0; i < line && i < originalLines.length; i++) {
						offset += (originalLines[i]?.length || 0) + 1
					}
					return offset + character
				}

				// Apply edits in reverse order to maintain correct positions
				const sortedEdits = [...edits].sort((a, b) => {
					const lineDiff = b.range.start.line - a.range.start.line
					if (lineDiff !== 0) return lineDiff
					return b.range.start.character - a.range.start.character
				})

				let updatedContent = normalizedContent
				for (const textEdit of sortedEdits) {
					const startOffset = getOffset(textEdit.range.start.line, textEdit.range.start.character)
					const endOffset = getOffset(textEdit.range.end.line, textEdit.range.end.character)
					updatedContent =
						updatedContent.slice(0, startOffset) + textEdit.newText + updatedContent.slice(endOffset)
				}

				// Write back to file
				const newContent = updatedContent
				fs.writeFileSync(filePath, newContent, "utf-8")

				// Update the in-memory document object to reflect the new content
				// This is critical for CLI mode where DiffViewProvider reads from the document object
				const document = this.textDocuments.find((doc: TextDocument) => doc.uri.fsPath === filePath)
				if (document) {
					const newLines = newContent.split("\n")

					// Update document properties with new content
					document.lineCount = newLines.length
					document.getText = (range?: Range) => {
						if (!range) {
							return newContent
						}
						return newLines.slice(range.start.line, range.end.line + 1).join("\n")
					}
					document.lineAt = (line: number) => {
						const text = newLines[line] || ""
						return {
							text,
							range: new Range(new Position(line, 0), new Position(line, text.length)),
							rangeIncludingLineBreak: new Range(new Position(line, 0), new Position(line + 1, 0)),
							firstNonWhitespaceCharacterIndex: text.search(/\S/),
							isEmptyOrWhitespace: text.trim().length === 0,
						}
					}
					document.offsetAt = (position: Position) => {
						let offset = 0
						for (let i = 0; i < position.line && i < newLines.length; i++) {
							offset += (newLines[i]?.length || 0) + 1 // +1 for newline
						}
						offset += position.character
						return offset
					}
					document.positionAt = (offset: number) => {
						let currentOffset = 0
						for (let i = 0; i < newLines.length; i++) {
							const lineLength = (newLines[i]?.length || 0) + 1 // +1 for newline
							if (currentOffset + lineLength > offset) {
								return new Position(i, offset - currentOffset)
							}
							currentOffset += lineLength
						}
						return new Position(newLines.length - 1, newLines[newLines.length - 1]?.length || 0)
					}
				}
			}
			return true
		} catch (error) {
			logs.error("Failed to apply workspace edit", "VSCode.Workspace", { error })
			return false
		}
	}

	createFileSystemWatcher(
		_globPattern: string | RelativePattern,
		_ignoreCreateEvents?: boolean,
		_ignoreChangeEvents?: boolean,
		_ignoreDeleteEvents?: boolean,
	): FileSystemWatcher {
		const emitter = new EventEmitter<Uri>()
		return {
			onDidChange: (listener: (e: Uri) => void) => emitter.event(listener),
			onDidCreate: (listener: (e: Uri) => void) => emitter.event(listener),
			onDidDelete: (listener: (e: Uri) => void) => emitter.event(listener),
			dispose: () => emitter.dispose(),
		}
	}

	registerTextDocumentContentProvider(_scheme: string, _provider: TextDocumentContentProvider): Disposable {
		return { dispose: () => {} }
	}
}

export interface WorkspaceFolder {
	uri: Uri
	name: string
	index: number
}

export interface WorkspaceConfiguration {
	get<T>(section: string): T | undefined
	get<T>(section: string, defaultValue: T): T
	has(section: string): boolean
	inspect(section: string): ConfigurationInspect<unknown> | undefined
	update(section: string, value: unknown, configurationTarget?: ConfigurationTarget): Thenable<void>
}

export class MockWorkspaceConfiguration implements WorkspaceConfiguration {
	private section: string | undefined
	private globalMemento: MemoryMemento
	private workspaceMemento: MemoryMemento

	constructor(section?: string, context?: ExtensionContext) {
		this.section = section

		if (context) {
			// Use the extension context's mementos
			this.globalMemento = context.globalState as unknown as MemoryMemento
			this.workspaceMemento = context.workspaceState as unknown as MemoryMemento
		} else {
			// Fallback: create our own mementos (shouldn't happen in normal usage)
			const globalStoragePath = KiloCodePaths.getGlobalStorageDir()
			const workspaceStoragePath = KiloCodePaths.getWorkspaceStorageDir(process.cwd())

			this.ensureDirectoryExists(globalStoragePath)
			this.ensureDirectoryExists(workspaceStoragePath)

			this.globalMemento = new MemoryMemento(path.join(globalStoragePath, "configuration.json"))
			this.workspaceMemento = new MemoryMemento(path.join(workspaceStoragePath, "configuration.json"))
		}
	}

	private ensureDirectoryExists(dirPath: string): void {
		try {
			if (!fs.existsSync(dirPath)) {
				fs.mkdirSync(dirPath, { recursive: true })
			}
		} catch (error) {
			logs.warn(`Failed to create directory ${dirPath}`, "VSCode.MockWorkspaceConfiguration", { error })
		}
	}

	get<T>(section: string, defaultValue?: T): T | undefined {
		const fullSection = this.section ? `${this.section}.${section}` : section

		// Check workspace configuration first (higher priority)
		const workspaceValue = this.workspaceMemento.get(fullSection)
		if (workspaceValue !== undefined && workspaceValue !== null) {
			return workspaceValue as T
		}

		// Check global configuration
		const globalValue = this.globalMemento.get(fullSection)
		if (globalValue !== undefined && globalValue !== null) {
			return globalValue as T
		}

		// Return default value
		return defaultValue
	}

	has(section: string): boolean {
		const fullSection = this.section ? `${this.section}.${section}` : section
		return this.workspaceMemento.get(fullSection) !== undefined || this.globalMemento.get(fullSection) !== undefined
	}

	inspect(section: string): ConfigurationInspect<unknown> | undefined {
		const fullSection = this.section ? `${this.section}.${section}` : section
		const workspaceValue = this.workspaceMemento.get(fullSection)
		const globalValue = this.globalMemento.get(fullSection)

		if (workspaceValue !== undefined || globalValue !== undefined) {
			return {
				key: fullSection,
				defaultValue: undefined,
				globalValue: globalValue,
				workspaceValue: workspaceValue,
				workspaceFolderValue: undefined,
			}
		}

		return undefined
	}

	async update(section: string, value: unknown, configurationTarget?: ConfigurationTarget): Promise<void> {
		const fullSection = this.section ? `${this.section}.${section}` : section

		try {
			// Determine which memento to use based on configuration target
			const memento =
				configurationTarget === ConfigurationTarget.Workspace ? this.workspaceMemento : this.globalMemento

			const scope = configurationTarget === ConfigurationTarget.Workspace ? "workspace" : "global"

			// Update the memento (this automatically persists to disk)
			await memento.update(fullSection, value)

			logs.debug(
				`Configuration updated: ${fullSection} = ${JSON.stringify(value)} (${scope})`,
				"VSCode.MockWorkspaceConfiguration",
			)
		} catch (error) {
			logs.error(`Failed to update configuration: ${fullSection}`, "VSCode.MockWorkspaceConfiguration", {
				error,
			})
			throw error
		}
	}

	// Additional method to reload configuration from disk
	public reload(): void {
		// MemoryMemento automatically loads from disk, so we don't need to do anything special
		logs.debug("Configuration reload requested", "VSCode.MockWorkspaceConfiguration")
	}

	// Method to get all configuration data (useful for debugging and generic config loading)
	public getAllConfig(): Record<string, unknown> {
		const globalKeys = this.globalMemento.keys()
		const workspaceKeys = this.workspaceMemento.keys()
		const allConfig: Record<string, unknown> = {}

		// Add global settings first
		for (const key of globalKeys) {
			const value = this.globalMemento.get(key)
			if (value !== undefined && value !== null) {
				allConfig[key] = value
			}
		}

		// Add workspace settings (these override global)
		for (const key of workspaceKeys) {
			const value = this.workspaceMemento.get(key)
			if (value !== undefined && value !== null) {
				allConfig[key] = value
			}
		}

		return allConfig
	}
}

// Text Editor Decoration Type mock
export class TextEditorDecorationType implements Disposable {
	public key: string

	constructor(key: string) {
		this.key = key
	}

	dispose(): void {
		// No-op for CLI
	}
}

// StatusBarItem mock
export class StatusBarItem implements Disposable {
	private _text: string = ""
	private _tooltip: string | undefined
	private _command: string | undefined
	private _color: string | undefined
	private _backgroundColor: string | undefined
	private _isVisible: boolean = false

	constructor(
		public readonly alignment: StatusBarAlignment,
		public readonly priority?: number,
	) {}

	get text(): string {
		return this._text
	}

	set text(value: string) {
		this._text = value
	}

	get tooltip(): string | undefined {
		return this._tooltip
	}

	set tooltip(value: string | undefined) {
		this._tooltip = value
	}

	get command(): string | undefined {
		return this._command
	}

	set command(value: string | undefined) {
		this._command = value
	}

	get color(): string | undefined {
		return this._color
	}

	set color(value: string | undefined) {
		this._color = value
	}

	get backgroundColor(): string | undefined {
		return this._backgroundColor
	}

	set backgroundColor(value: string | undefined) {
		this._backgroundColor = value
	}

	show(): void {
		this._isVisible = true
	}

	hide(): void {
		this._isVisible = false
	}

	dispose(): void {
		this._isVisible = false
	}
}

// Tab and TabGroup interfaces for VSCode API
export interface Tab {
	input: TabInputText | unknown
	label: string
	isActive: boolean
	isDirty: boolean
}

export interface TabInputText {
	uri: Uri
}

export interface TabGroup {
	tabs: Tab[]
}

// TabGroups API mock
export class TabGroupsAPI {
	private _onDidChangeTabs = new EventEmitter<void>()
	private _tabGroups: TabGroup[] = []

	get all(): TabGroup[] {
		return this._tabGroups
	}

	onDidChangeTabs(listener: () => void): Disposable {
		return this._onDidChangeTabs.event(listener)
	}

	async close(tab: Tab): Promise<boolean> {
		// Find and remove the tab from all groups
		for (const group of this._tabGroups) {
			const index = group.tabs.indexOf(tab)
			if (index !== -1) {
				group.tabs.splice(index, 1)
				this._onDidChangeTabs.fire()
				return true
			}
		}
		return false
	}

	// Internal method to simulate tab changes for CLI
	_simulateTabChange(): void {
		this._onDidChangeTabs.fire()
	}

	dispose(): void {
		this._onDidChangeTabs.dispose()
	}
}

// Window API mock
export class WindowAPI {
	public tabGroups: TabGroupsAPI
	public visibleTextEditors: TextEditor[] = []
	public _onDidChangeVisibleTextEditors = new EventEmitter<TextEditor[]>()
	private _workspace?: WorkspaceAPI

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
		return new TextEditorDecorationType(`decoration-${Date.now()}`)
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
		let document = documentOrUri
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
					// Debug: log what messages are being posted
					const msgObj = message as {
						type?: string
						state?: { chatMessages?: unknown[]; clineMessages?: unknown[] }
					}
					if (msgObj.type === "state" && msgObj.state) {
						const chatCount = msgObj.state.chatMessages?.length || 0
						const clineCount = msgObj.state.clineMessages?.length || 0
						const lastMsg =
							msgObj.state.chatMessages?.[chatCount - 1] || msgObj.state.clineMessages?.[clineCount - 1]
						logs.info(
							`[WEBVIEW postMessage] state: chatMessages=${chatCount}, clineMessages=${clineCount}, lastType=${(lastMsg as { type?: string; say?: string; ask?: string })?.type}, lastSay=${(lastMsg as { say?: string })?.say}, lastAsk=${(lastMsg as { ask?: string })?.ask}`,
							"VSCode.Window",
						)
					}

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
				asWebviewUri: (uri: Uri) => {
					// Convert file URIs to webview-compatible URIs
					// For CLI, we can just return a mock webview URI
					return Uri.parse(`vscode-webview://webview/${uri.path}`)
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

export interface WorkspaceFolder {
	uri: Uri
	name: string
	index: number
}

export interface WorkspaceConfiguration {
	get<T>(section: string): T | undefined
	get<T>(section: string, defaultValue: T): T
	has(section: string): boolean
	inspect(_section: string): ConfigurationInspect<unknown> | undefined
	update(section: string, value: unknown, configurationTarget?: ConfigurationTarget): Thenable<void>
}

// Commands API mock

// Commands API mock
export class CommandsAPI {
	private commands: Map<string, (...args: unknown[]) => unknown> = new Map()

	registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable {
		this.commands.set(command, callback)
		return {
			dispose: () => {
				this.commands.delete(command)
			},
		}
	}

	executeCommand<T = unknown>(command: string, ...rest: unknown[]): Thenable<T> {
		const handler = this.commands.get(command)
		if (handler) {
			try {
				const result = handler(...rest)
				return Promise.resolve(result as T)
			} catch (error) {
				return Promise.reject(error)
			}
		}

		// Handle built-in commands
		switch (command) {
			case "workbench.action.files.saveFiles":
			case "workbench.action.closeWindow":
			case "workbench.action.reloadWindow":
				return Promise.resolve(undefined as T)
			case "vscode.diff":
				// Simulate opening a diff view for the CLI
				// The extension's DiffViewProvider expects this to create a diff editor
				return this.handleDiffCommand(
					rest[0] as Uri,
					rest[1] as Uri,
					rest[2] as string | undefined,
					rest[3],
				) as Thenable<T>
			default:
				logs.warn(`Unknown command: ${command}`, "VSCode.Commands")
				return Promise.resolve(undefined as T)
		}
	}

	private async handleDiffCommand(
		originalUri: Uri,
		modifiedUri: Uri,
		title?: string,
		_options?: unknown,
	): Promise<void> {
		// The DiffViewProvider is waiting for the modified document to appear in visibleTextEditors
		// We need to simulate this by opening the document and adding it to visible editors

		logs.info(`[DIFF] Handling vscode.diff command`, "VSCode.Commands", {
			originalUri: originalUri?.toString(),
			modifiedUri: modifiedUri?.toString(),
			title,
		})

		if (!modifiedUri) {
			logs.warn("[DIFF] vscode.diff called without modified URI", "VSCode.Commands")
			return
		}

		// Get the workspace API to open the document
		const workspace = (global as unknown as { vscode?: { workspace?: WorkspaceAPI } }).vscode?.workspace
		const window = (global as unknown as { vscode?: { window?: WindowAPI } }).vscode?.window

		if (!workspace || !window) {
			logs.warn("[DIFF] VSCode APIs not available for diff command", "VSCode.Commands")
			return
		}

		logs.info(
			`[DIFF] Current visibleTextEditors count: ${window.visibleTextEditors?.length || 0}`,
			"VSCode.Commands",
		)

		try {
			// The document should already be open from the showTextDocument call
			// Find it in the existing textDocuments
			logs.info(`[DIFF] Looking for already-opened document: ${modifiedUri.fsPath}`, "VSCode.Commands")
			let document = workspace.textDocuments.find((doc: TextDocument) => doc.uri.fsPath === modifiedUri.fsPath)

			if (!document) {
				// If not found, open it now
				logs.info(`[DIFF] Document not found, opening: ${modifiedUri.fsPath}`, "VSCode.Commands")
				document = await workspace.openTextDocument(modifiedUri)
				logs.info(`[DIFF] Document opened successfully, lineCount: ${document.lineCount}`, "VSCode.Commands")
			} else {
				logs.info(`[DIFF] Found existing document, lineCount: ${document.lineCount}`, "VSCode.Commands")
			}

			// Create a mock editor for the diff view
			const mockEditor = {
				document,
				selection: new Selection(new Position(0, 0), new Position(0, 0)),
				selections: [new Selection(new Position(0, 0), new Position(0, 0))],
				visibleRanges: [new Range(new Position(0, 0), new Position(0, 0))],
				options: {},
				viewColumn: ViewColumn.One,
				edit: async (callback: (editBuilder: TextEditorEdit) => void) => {
					// Create a mock edit builder
					const editBuilder: TextEditorEdit = {
						replace: (_range: Range, _text: string) => {
							// In CLI mode, we don't actually edit here
							// The DiffViewProvider will handle the actual edits
							logs.debug("Mock edit builder replace called", "VSCode.Commands")
						},
						insert: (_position: Position, _text: string) => {
							logs.debug("Mock edit builder insert called", "VSCode.Commands")
						},
						delete: (_range: Range) => {
							logs.debug("Mock edit builder delete called", "VSCode.Commands")
						},
						setEndOfLine: (_endOfLine: EndOfLine) => {
							logs.debug("Mock edit builder setEndOfLine called", "VSCode.Commands")
						},
					}
					callback(editBuilder)
					return true
				},
				insertSnippet: () => Promise.resolve(true),
				setDecorations: () => {},
				revealRange: () => {},
				show: () => {},
				hide: () => {},
			}

			// Add the editor to visible editors
			if (!window.visibleTextEditors) {
				window.visibleTextEditors = []
			}

			// Check if this editor is already in visibleTextEditors (from showTextDocument)
			const existingEditor = window.visibleTextEditors.find(
				(e: TextEditor) => e.document.uri.fsPath === modifiedUri.fsPath,
			)

			if (existingEditor) {
				logs.info(`[DIFF] Editor already in visibleTextEditors, updating it`, "VSCode.Commands")
				// Update the existing editor with the mock editor properties
				Object.assign(existingEditor, mockEditor)
			} else {
				logs.info(`[DIFF] Adding new mock editor to visibleTextEditors`, "VSCode.Commands")
				window.visibleTextEditors.push(mockEditor)
			}

			logs.info(`[DIFF] visibleTextEditors count: ${window.visibleTextEditors.length}`, "VSCode.Commands")

			// The onDidChangeVisibleTextEditors event was already fired by showTextDocument
			// We don't need to fire it again here
			logs.info(
				`[DIFF] Diff view simulation complete (events already fired by showTextDocument)`,
				"VSCode.Commands",
			)
		} catch (error) {
			logs.error("[DIFF] Error simulating diff view", "VSCode.Commands", { error })
		}
	}
}

// Main VSCode API mock
export function createVSCodeAPIMock(
	extensionRootPath: string,
	workspacePath: string,
	identity?: IdentityInfo,
	vscodeAppRoot?: string,
	appName?: string,
	useMemoryOnlyStorage = false,
) {
	const context = new ExtensionContext(extensionRootPath, workspacePath, useMemoryOnlyStorage)
	const workspace = new WorkspaceAPI(workspacePath, context)
	const window = new WindowAPI()
	const commands = new CommandsAPI()

	// Link window and workspace for cross-API calls
	window.setWorkspace(workspace)

	// Environment mock with identity values
	// Use vscodeAppRoot if provided (for finding bundled binaries like ripgrep)
	// appName format: wrapper|<source>|<type>|<version>
	// - source: 'cli' for direct CLI, 'agent-manager' for spawned agents
	// - type: 'cli' for CLI process
	const resolvedAppName = appName || `wrapper|cli|cli|${Package.version}`
	const env = {
		appName: resolvedAppName,
		appRoot: vscodeAppRoot || import.meta.dirname,
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
		ExtensionContext,
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
				if (extensionId === "kilocode.kilo-code") {
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
