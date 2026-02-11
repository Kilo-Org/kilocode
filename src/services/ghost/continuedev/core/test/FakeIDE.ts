import type {
	DocumentSymbol,
	FileStatsMap,
	IDE,
	IdeInfo,
	Location,
	Range,
	RangeInFile,
	SignatureHelp,
} from "../index.js"

/**
 * Options for customizing FakeIDE behavior.
 * All options are optional and will use sensible defaults if not provided.
 */
interface FakeIDEOptions {
	/** File contents to return for readFile calls. Maps filepath -> content */
	fileContents?: Map<string, string>

	/** Workspace directories to return */
	workspaceDirs?: string[]

	/** IDE info to return */
	ideInfo?: IdeInfo

	/** Open files to return */
	openFiles?: string[]

	/** Current file to return */
	currentFile?: {
		isUntitled: boolean
		path: string
		contents: string
	}

	/** Clipboard content to return */
	clipboardContent?: { text: string; copiedAt: string }

	/** Unique ID to return */
	uniqueId?: string
}

export class FakeIDE implements IDE {
	private options: FakeIDEOptions

	/** Track calls to onDidChangeActiveTextEditor for assertions */
	public activeTextEditorCallbacks: Array<(fileUri: string) => void> = []

	constructor(options: FakeIDEOptions = {}) {
		this.options = options
	}

	async getIdeInfo(): Promise<IdeInfo> {
		return (
			this.options.ideInfo ?? {
				ideType: "vscode",
			}
		)
	}

	async getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
		return (
			this.options.clipboardContent ?? {
				text: "",
				copiedAt: new Date().toISOString(),
			}
		)
	}

	async getUniqueId(): Promise<string> {
		return this.options.uniqueId ?? "fake-unique-id"
	}

	async getWorkspaceDirs(): Promise<string[]> {
		return this.options.workspaceDirs ?? ["/workspace"]
	}

	async fileExists(fileUri: string): Promise<boolean> {
		if (this.options.fileContents) {
			return this.options.fileContents.has(fileUri)
		}
		return false
	}

	async writeFile(_path: string, _contents: string): Promise<void> {
		// No-op by default, tests can override if needed
	}

	async saveFile(_fileUri: string): Promise<void> {
		// No-op by default, tests can override if needed
	}

	async readFile(fileUri: string): Promise<string> {
		if (this.options.fileContents) {
			return this.options.fileContents.get(fileUri) ?? ""
		}
		return ""
	}

	async readRangeInFile(_fileUri: string, _range: Range): Promise<string> {
		// Simplified implementation - tests can override if needed
		return ""
	}

	async getOpenFiles(): Promise<string[]> {
		return this.options.openFiles ?? []
	}

	async getCurrentFile(): Promise<
		| undefined
		| {
				isUntitled: boolean
				path: string
				contents: string
		  }
	> {
		return this.options.currentFile
	}

	async getFileStats(_files: string[]): Promise<FileStatsMap> {
		// Return empty map by default
		return {}
	}

	// LSP methods - return empty arrays by default
	async gotoDefinition(_location: Location): Promise<RangeInFile[]> {
		return []
	}

	async gotoTypeDefinition(_location: Location): Promise<RangeInFile[]> {
		return []
	}

	async getSignatureHelp(_location: Location): Promise<SignatureHelp | null> {
		return null
	}

	async getReferences(_location: Location): Promise<RangeInFile[]> {
		return []
	}

	async getDocumentSymbols(_textDocumentIdentifier: string): Promise<DocumentSymbol[]> {
		return []
	}

	// Callbacks
	onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void {
		this.activeTextEditorCallbacks.push(callback)
	}
}
