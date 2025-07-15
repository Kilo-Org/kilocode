//PLANREF: continue/extensions/vscode/src/VsCodeIde.ts
//PLANREF: continue/extensions/vscode/src/util/ideUtils.ts
// AIDIFF: Imported IdeInfo for the getIdeInfo method.
import { Range, RangeInFile, Location, IdeInfo } from "../ide-types"

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
