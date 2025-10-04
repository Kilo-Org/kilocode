// Mock VSCode API for Vitest tests
const mockEventEmitter = () => ({
	event: () => () => {},
	fire: () => {},
	dispose: () => {},
})

const mockDisposable = {
	dispose: () => {},
}

const mockUri = {
	file: (path) => ({ fsPath: path, path, scheme: "file", toString: () => path }),
	parse: (path) => ({ fsPath: path, path, scheme: "file", toString: () => path }),
}

const mockRange = class {
	constructor(startLineOrPosition, startCharacterOrEnd, endLine, endCharacter) {
		if (typeof startLineOrPosition === "number" && typeof startCharacterOrEnd === "number") {
			// Constructor called with (startLine, startCharacter, endLine, endCharacter)
			this.start = new mockPosition(startLineOrPosition, startCharacterOrEnd)
			this.end = new mockPosition(endLine, endCharacter)
		} else {
			// Constructor called with (start: Position, end: Position)
			this.start = startLineOrPosition
			this.end = startCharacterOrEnd
		}
	}
}

const mockPosition = class {
	constructor(line, character) {
		this.line = line
		this.character = character
	}
}

const mockSelection = class extends mockRange {
	constructor(startLineOrPosition, startCharacterOrEnd, endLine, endCharacter) {
		super(startLineOrPosition, startCharacterOrEnd, endLine, endCharacter)
		this.anchor = this.start
		this.active = this.end
	}
}

export const workspace = {
	workspaceFolders: [],
	getWorkspaceFolder: () => null,
	onDidChangeWorkspaceFolders: () => mockDisposable,
	getConfiguration: () => ({
		get: () => null,
	}),
	createFileSystemWatcher: () => ({
		onDidCreate: () => mockDisposable,
		onDidChange: () => mockDisposable,
		onDidDelete: () => mockDisposable,
		dispose: () => {},
	}),
	fs: {
		readFile: () => Promise.resolve(new Uint8Array()),
		writeFile: () => Promise.resolve(),
		stat: () => Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 }),
	},
	workspaceState: {
		get: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		keys: vi.fn().mockReturnValue([]),
	},
	openTextDocument: vi.fn(),
	applyEdit: vi.fn().mockResolvedValue(true),
}

export const window = {
	activeTextEditor: null,
	onDidChangeActiveTextEditor: () => mockDisposable,
	showErrorMessage: () => Promise.resolve(),
	showWarningMessage: () => Promise.resolve(),
	showInformationMessage: () => Promise.resolve(),
	createOutputChannel: () => ({
		appendLine: () => {},
		append: () => {},
		clear: () => {},
		show: () => {},
		dispose: () => {},
	}),
	createTerminal: () => ({
		exitStatus: undefined,
		name: "Roo Code",
		processId: Promise.resolve(123),
		creationOptions: {},
		state: { isInteractedWith: true },
		dispose: () => {},
		hide: () => {},
		show: () => {},
		sendText: () => {},
	}),
	onDidCloseTerminal: () => mockDisposable,
	createTextEditorDecorationType: () => ({ dispose: () => {} }),
}

export const commands = {
	registerCommand: () => mockDisposable,
	executeCommand: () => Promise.resolve(),
}

export const languages = {
	createDiagnosticCollection: () => ({
		set: () => {},
		delete: () => {},
		clear: () => {},
		dispose: () => {},
	}),
}

export const extensions = {
	getExtension: () => null,
}

export const env = {
	openExternal: () => Promise.resolve(),
}

export const Uri = mockUri
export const Range = mockRange
export const Position = mockPosition
export const Selection = mockSelection
export const Disposable = mockDisposable
export const ThemeIcon = class {
	constructor(id) {
		this.id = id
	}
}

export const FileType = {
	File: 1,
	Directory: 2,
	SymbolicLink: 64,
}

export const DiagnosticSeverity = {
	Error: 0,
	Warning: 1,
	Information: 2,
	Hint: 3,
}

export const OverviewRulerLane = {
	Left: 1,
	Center: 2,
	Right: 4,
	Full: 7,
}

export const CodeAction = class {
	constructor(title, kind) {
		this.title = title
		this.kind = kind
		this.command = undefined
	}
}

export const CodeActionKind = {
	QuickFix: { value: "quickfix" },
	RefactorRewrite: { value: "refactor.rewrite" },
}

export const WorkspaceEdit = class {
	constructor() {
		this._edits = new Map()
	}

	entries() {
		return this._edits.entries()
	}

	insert(uri, position, newText) {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key).push({
			range: new mockRange(position, position),
			newText: newText,
		})
	}

	delete(uri, range) {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key).push({
			range: range,
			newText: "",
		})
	}

	replace(uri, range, newText) {
		const key = uri.toString()
		if (!this._edits.has(key)) {
			this._edits.set(key, [])
		}
		this._edits.get(key).push({
			range: range,
			newText: newText,
		})
	}
}

export const EventEmitter = mockEventEmitter

export default {
	workspace,
	window,
	commands,
	languages,
	extensions,
	env,
	Uri,
	Range,
	Position,
	Selection,
	Disposable,
	ThemeIcon,
	FileType,
	DiagnosticSeverity,
	OverviewRulerLane,
	EventEmitter,
	CodeAction,
	CodeActionKind,
	WorkspaceEdit,
}
