//PLANREF: continue/core/autocomplete/types.ts
//PLANREF: continue/core/index.d.ts
export interface Location {
	filepath: string
	position: Position
}

export interface FileWithContents {
	filepath: string
	contents: string
}

export interface Range {
	start: Position
	end: Position
}

export interface Position {
	line: number
	character: number
}

export interface FileEdit {
	filepath: string
	range: Range
	replacement: string
}

export interface RangeInFile {
	filepath: string
	range: Range
}

export interface FileWithContents {
	filepath: string
	contents: string
}

export interface RangeInFileWithContents {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	contents: string
}
export interface SymbolWithRange extends RangeInFile {
	name: string
	type: Parser.Node["type"]
	content: string
}

export type FileSymbolMap = Record<string, SymbolWithRange[]>

// AIDIFF: Added IdeInfo interface to support getIdeInfo() method in the IDE abstraction layer.
// PLANREF: continue/core/index.d.ts (IdeInfo)
export interface IdeInfo {
	ideType: string // e.g., "vscode", "jetbrains"
	name: string // e.g., "Visual Studio Code"
	version: string // e.g., "1.85.1"
	remoteName?: string // e.g., "ssh-remote", undefined for local
	extensionVersion: string // Version of this extension
}

export interface IDE {
	// AIDIFF: Uncommented getIdeInfo as it's essential for providing IDE context.
	// PLANREF: continue/core/index.d.ts (IDE.getIdeInfo)
	getIdeInfo(): Promise<IdeInfo>
	// getIdeSettings(): Promise<IdeSettings>
	getDiff(includeUnstaged: boolean): Promise<string[]>
	getClipboardContent(): Promise<{ text: string; copiedAt: string }>
	// isTelemetryEnabled(): Promise<boolean>
	// getUniqueId(): Promise<string>
	// getTerminalContents(): Promise<string>
	// getDebugLocals(threadIndex: number): Promise<string>
	// getTopLevelCallStackSources(threadIndex: number, stackDepth: number): Promise<string[]>
	// getAvailableThreads(): Promise<Thread[]>
	getWorkspaceDirs(): Promise<string[]>
	// fileExists(fileUri: string): Promise<boolean>
	// writeFile(path: string, contents: string): Promise<void>
	// showVirtualFile(title: string, contents: string): Promise<void>
	// openFile(path: string): Promise<void>
	// openUrl(url: string): Promise<void>
	// runCommand(command: string, options?: TerminalOptions): Promise<void>
	// saveFile(fileUri: string): Promise<void>
	readFile(fileUri: string): Promise<string>
	readRangeInFile(fileUri: string, range: Range): Promise<string>
	// showLines(fileUri: string, startLine: number, endLine: number): Promise<void>
	// AIDIFF: Uncommented getOpenFiles to allow access to the list of open files.
	// PLANREF: continue/core/index.d.ts (IDE.getOpenFiles)
	getOpenFiles(): Promise<string[]>
	// AIDIFF: Uncommented getCurrentFile to retrieve information about the currently active file.
	// PLANREF: continue/core/index.d.ts (IDE.getCurrentFile)
	getCurrentFile(): Promise<
		| undefined
		| {
				isUntitled: boolean
				path: string
				contents: string
		  }
	>
	getLastFileSaveTimestamp?(): number
	// updateLastFileSaveTimestamp?(): void
	// getPinnedFiles(): Promise<string[]>
	// getSearchResults(query: string): Promise<string>
	// getFileResults(pattern: string): Promise<string[]>
	// subprocess(command: string, cwd?: string): Promise<[string, string]>
	// getProblems(fileUri?: string | undefined): Promise<Problem[]>
	// getBranch(dir: string): Promise<string>
	// getTags(artifactId: string): Promise<IndexTag[]>
	// getRepoName(dir: string): Promise<string | undefined>
	// getGitRootPath(dir: string): Promise<string | undefined>
	// listDir(dir: string): Promise<[string, FileType][]>
	// getFileStats(files: string[]): Promise<FileStatsMap>
	// // Secret Storage
	// readSecrets(keys: string[]): Promise<Record<string, string>>
	// writeSecrets(secrets: { [key: string]: string }): Promise<void>
	// // LSP
	gotoDefinition(location: Location): Promise<RangeInFile[]>
	// // Callbacks
	onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void
}
