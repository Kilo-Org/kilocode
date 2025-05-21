//PLANREF: continue/extensions/vscode/src/VsCodeIde.ts
//PLANREF: continue/extensions/vscode/src/util/ideUtils.ts
import { Range, RangeInFile, Location } from "../ide-types"

export interface IDE {
	// getIdeInfo(): Promise<IdeInfo>
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
	// getOpenFiles(): Promise<string[]>
	// getCurrentFile(): Promise<
	// 	| undefined
	// 	| {
	// 			isUntitled: boolean
	// 			path: string
	// 			contents: string
	// 	  }
	// >
	getLastFileSaveTimestamp?(): number | undefined
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

// Basic VsCodeIde implementation
import * as vscode from "vscode"

export class VsCodeIde implements IDE {
	async getDiff(includeUnstaged: boolean): Promise<string[]> {
		// Placeholder implementation
		console.warn("VsCodeIde.getDiff not fully implemented", includeUnstaged)
		return []
	}

	async getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
		const text = await vscode.env.clipboard.readText()
		return { text, copiedAt: new Date().toISOString() }
	}

	async getWorkspaceDirs(): Promise<string[]> {
		return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) || []
	}

	async readFile(fileUri: string): Promise<string> {
		try {
			const uri = vscode.Uri.file(fileUri)
			const content = await vscode.workspace.fs.readFile(uri)
			return new TextDecoder().decode(content)
		} catch (e) {
			console.error(`Error reading file ${fileUri}:`, e)
			return ""
		}
	}

	async readRangeInFile(fileUri: string, range: Range): Promise<string> {
		// Placeholder implementation
		console.warn("VsCodeIde.readRangeInFile not fully implemented", fileUri, range)
		const fullContent = await this.readFile(fileUri)
		const lines = fullContent.split("\n")
		return lines.slice(range.start.line, range.end.line + 1).join("\n") // Basic slicing
	}

	getLastFileSaveTimestamp?(): number | undefined {
		// Explicitly type return as number | undefined
		// Placeholder
		return undefined
	}

	async gotoDefinition(location: Location): Promise<RangeInFile[]> {
		// Placeholder implementation
		console.warn("VsCodeIde.gotoDefinition not fully implemented", location)
		return []
	}

	onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void {
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor) {
				callback(editor.document.uri.fsPath)
			}
		})
	}
}
