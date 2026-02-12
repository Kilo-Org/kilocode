import * as vscode from "vscode"
import * as URI from "uri-js"
import { DocumentSymbol, FileStatsMap, IDE, IdeInfo, Location, Range, RangeInFile, SignatureHelp } from "../.."
import { executeGotoProvider, executeSignatureHelpProvider, executeSymbolProvider } from "./autocomplete/lsp"

async function stat(uri: vscode.Uri): Promise<vscode.FileStat | null> {
	try {
		return await vscode.workspace.fs.stat(uri)
	} catch {
		return null
	}
}

function areEqualURIs(uri1: vscode.Uri, uri2: vscode.Uri): boolean {
	return URI.equal(uri1.toString(), uri2.toString())
}

async function readFile(uri: vscode.Uri): Promise<Uint8Array | null> {
	const openDocuments = vscode.workspace.textDocuments
	for (const document of openDocuments) {
		if (areEqualURIs(document.uri, uri)) {
			// Found an open document with this URI.
			// Return its current content (including any unsaved changes) as Uint8Array.
			const docText = document.getText()
			return new Uint8Array(Buffer.from(docText, "utf8"))
		}
	}

	try {
		return await vscode.workspace.fs.readFile(uri)
	} catch {
		return null
	}
}

function documentIsCode(uri: vscode.Uri): boolean {
	return uri.scheme === "file" || uri.scheme === "vscode-remote"
}

export class VsCodeIde implements IDE {
	private static MAX_BYTES = 100000
	constructor(private readonly context: vscode.ExtensionContext) {}
	getIdeInfo(): Promise<IdeInfo> {
		return Promise.resolve({
			ideType: "vscode",
			// name: vscode.env.appName,
			// version: vscode.version,
			// remoteName: vscode.env.remoteName || "local",
			// extensionVersion: getExtensionVersion(),
			// isPrerelease: isExtensionPrerelease(),
		})
	}

	async getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
		return {
			text: await vscode.env.clipboard.readText(),
			copiedAt: new Date().toISOString(),
		}
	}

	getUniqueId(): Promise<string> {
		return Promise.resolve(vscode.env.machineId)
	}

	private _workspaceDirectories: vscode.Uri[] | undefined = undefined
	async getWorkspaceDirs(): Promise<string[]> {
		if (!this._workspaceDirectories) {
			this._workspaceDirectories = vscode.workspace.workspaceFolders?.map((folder) => folder.uri)
		}
		return this._workspaceDirectories?.map((uri) => uri.toString()) ?? []
	}

	async fileExists(fileUri: string): Promise<boolean> {
		try {
			await stat(vscode.Uri.file(fileUri))
			return true
		} catch {
			console.error(`File does not exist: ${fileUri}`)
			return false
		}
	}

	async writeFile(path: string, contents: string): Promise<void> {
		await vscode.workspace.fs.writeFile(vscode.Uri.file(path), Buffer.from(contents))
	}

	async saveFile(fileUri: string): Promise<void> {
		console.log(`Saving file: ${fileUri}`)
		const uri = vscode.Uri.parse(fileUri)
		vscode.window.visibleTextEditors.forEach(async (editor) => {
			if (areEqualURIs(uri, editor.document.uri)) {
				await editor.document.save()
			}
		})
	}

	async readFile(fileUri: string): Promise<string> {
		try {
			const uri = vscode.Uri.parse(fileUri)

			// First, check whether it's a notebook document
			// Need to iterate over the cells to get full contents
			const notebook =
				vscode.workspace.notebookDocuments.find((doc) => URI.equal(doc.uri.toString(), uri.toString())) ??
				(uri.path.endsWith("ipynb") ? await vscode.workspace.openNotebookDocument(uri) : undefined)
			if (notebook) {
				return notebook
					.getCells()
					.map((cell) => cell.document.getText())
					.join("\n\n")
			}

			// Check whether it's an open document
			const openTextDocument = vscode.workspace.textDocuments.find((doc) =>
				URI.equal(doc.uri.toString(), uri.toString()),
			)
			if (openTextDocument !== undefined) {
				return openTextDocument.getText()
			}

			const fileStats = await stat(uri)
			if (fileStats === null || fileStats.size > 10 * VsCodeIde.MAX_BYTES) {
				return ""
			}

			const bytes = await readFile(uri)
			if (bytes === null) {
				return ""
			}

			// Truncate the buffer to the first MAX_BYTES
			const truncatedBytes = bytes.slice(0, VsCodeIde.MAX_BYTES)
			const contents = new TextDecoder().decode(truncatedBytes)
			return contents
		} catch (e) {
			return ""
		}
	}

	async readRangeInFile(fileUri: string, range: Range): Promise<string> {
		const buffer = await readFile(vscode.Uri.parse(fileUri))
		if (buffer === null) {
			return ""
		}
		const contents = new TextDecoder().decode(buffer)
		const lines = contents.split("\n")
		return `${lines.slice(range.start.line, range.end.line).join("\n")}\n${lines[
			range.end.line < lines.length - 1 ? range.end.line : lines.length - 1
		].slice(0, range.end.character)}`
	}

	async getOpenFiles(): Promise<string[]> {
		return vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.filter(
				(tab) =>
					tab.input instanceof vscode.TabInputText && documentIsCode((tab.input as vscode.TabInputText).uri),
			)
			.map((tab) => (tab.input as vscode.TabInputText).uri.toString())
	}

	async getCurrentFile(): Promise<undefined | { isUntitled: boolean; path: string; contents: string }> {
		if (!vscode.window.activeTextEditor) {
			return undefined
		}
		return {
			isUntitled: vscode.window.activeTextEditor.document.isUntitled,
			path: vscode.window.activeTextEditor.document.uri.toString(),
			contents: vscode.window.activeTextEditor.document.getText(),
		}
	}

	async getFileStats(files: string[]): Promise<FileStatsMap> {
		const pathToLastModified: FileStatsMap = {}
		await Promise.all(
			files.map(async (file) => {
				const statx = await stat(vscode.Uri.parse(file))
				pathToLastModified[file] = {
					lastModified: statx!.mtime,
					size: statx!.size,
				}
			}),
		)

		return pathToLastModified
	}

	async gotoDefinition(location: Location): Promise<RangeInFile[]> {
		const result = await executeGotoProvider({
			uri: vscode.Uri.parse(location.filepath),
			line: location.position.line,
			character: location.position.character,
			name: "vscode.executeDefinitionProvider",
		})

		return result
	}

	async gotoTypeDefinition(location: Location): Promise<RangeInFile[]> {
		const result = await executeGotoProvider({
			uri: vscode.Uri.parse(location.filepath),
			line: location.position.line,
			character: location.position.character,
			name: "vscode.executeTypeDefinitionProvider",
		})

		return result
	}

	async getSignatureHelp(location: Location): Promise<SignatureHelp | null> {
		const result = await executeSignatureHelpProvider({
			uri: vscode.Uri.parse(location.filepath),
			line: location.position.line,
			character: location.position.character,
			name: "vscode.executeSignatureHelpProvider",
		})

		return result
	}

	async getReferences(location: Location): Promise<RangeInFile[]> {
		const result = await executeGotoProvider({
			uri: vscode.Uri.parse(location.filepath),
			line: location.position.line,
			character: location.position.character,
			name: "vscode.executeReferenceProvider",
		})

		return result
	}

	async getDocumentSymbols(textDocumentIdentifier: string): Promise<DocumentSymbol[]> {
		const result = await executeSymbolProvider({
			uri: vscode.Uri.parse(textDocumentIdentifier),
			name: "vscode.executeDocumentSymbolProvider",
		})

		return result
	}

	onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void {
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor) {
				callback(editor.document.uri.toString())
			}
		})
	}
}
