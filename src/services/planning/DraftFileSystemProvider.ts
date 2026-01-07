// kilocode_change - new file
import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import { DRAFT_SCHEME_NAME, filenameToDraftPath, draftPathToFilename } from "./draftPaths"

/**
 * Generate a unique draft ID similar to Cursor's plan IDs.
 * Uses 7 random hex characters for collision avoidance.
 */
function generateDraftId(): string {
	const hexChars = "0123456789abcdef"
	let result = ""
	for (let i = 0; i < 7; i++) {
		result += hexChars[Math.floor(Math.random() * 16)]
	}
	return result
}

/**
 * File system provider for draft:// documents.
 * Stores documents on disk at ~/.kilocode/plans/ and makes them available as editor tabs.
 */
export class DraftFileSystemProvider implements vscode.FileSystemProvider {
	private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
	private readonly _plansDir: string

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event

	constructor() {
		this._plansDir = path.join(os.homedir(), ".kilocode", "plans")
		console.log("📝 [DraftFSP] constructor - plansDir:", this._plansDir)
		fs.mkdir(this._plansDir, { recursive: true })
			.then(() => {
				console.log("📝 [DraftFSP] constructor - plans directory created/verified")
			})
			.catch((error) => {
				console.error("📝 [DraftFSP] constructor - Failed to create plans directory:", error)
			})
	}

	/**
	 * Get the real filesystem path for a draft filename.
	 * @param filename - The filename (e.g., "my-document.md")
	 * @returns The absolute path to the file on disk
	 */
	private getRealPath(filename: string): string {
		return path.join(this._plansDir, filename)
	}

	/**
	 * Convert a draft URI path to filename (internal storage key).
	 * Handles all URI variants consistently by stripping scheme and leading slashes.
	 * @param uri - The VS Code URI
	 * @returns The filename without leading slash
	 */
	private uriToFilename(uri: vscode.Uri): string {
		// URI path always starts with / for non-empty paths
		const path = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path
		return path
	}

	/**
	 * Convert a filename to VS Code URI for the draft scheme.
	 * Always produces the canonical form: draft:/filename (single slash).
	 * @param filename - The filename (without leading slash)
	 * @returns The VS Code URI with draft:// scheme
	 */
	private filenameToUri(filename: string): vscode.Uri {
		// Always use / prefix for the URI path - produces canonical draft:/filename
		return vscode.Uri.parse(`${DRAFT_SCHEME_NAME}:/${filename}`)
	}

	watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
		// No-op: we don't support watching draft documents
		return new vscode.Disposable(() => {})
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const filename = this.uriToFilename(uri)
		const realPath = this.getRealPath(filename)
		console.log("📝 [DraftFSP] stat - uri:", uri.toString(), "filename:", filename, "realPath:", realPath)

		try {
			const stats = await fs.stat(realPath)
			console.log("📝 [DraftFSP] stat - SUCCESS, size:", stats.size)
			return {
				type: vscode.FileType.File,
				ctime: stats.birthtimeMs,
				mtime: stats.mtimeMs,
				size: stats.size,
			}
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.log("📝 [DraftFSP] stat - ERROR:", err.code, err.message)
			if (err.code === "ENOENT") {
				throw vscode.FileSystemError.FileNotFound(uri)
			}
			throw vscode.FileSystemError.Unavailable(uri)
		}
	}

	readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
		// Draft documents don't support directories
		throw vscode.FileSystemError.FileNotFound()
	}

	createDirectory(_uri: vscode.Uri): void {
		// Draft documents don't support directories
		throw vscode.FileSystemError.NoPermissions()
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const filename = this.uriToFilename(uri)
		const realPath = this.getRealPath(filename)
		console.log("📝 [DraftFSP] readFile - uri:", uri.toString(), "filename:", filename, "realPath:", realPath)

		try {
			const content = await fs.readFile(realPath)
			console.log("📝 [DraftFSP] readFile - SUCCESS, size:", content.length)
			return content
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.log("📝 [DraftFSP] readFile - ERROR:", err.code, err.message)
			if (err.code === "ENOENT") {
				throw vscode.FileSystemError.FileNotFound(uri)
			}
			throw vscode.FileSystemError.Unavailable(uri)
		}
	}

	async writeFile(
		uri: vscode.Uri,
		content: Uint8Array,
		_options: { create: boolean; overwrite: boolean },
	): Promise<void> {
		const filename = this.uriToFilename(uri)
		const realPath = this.getRealPath(filename)
		console.log(
			"📝 [DraftFSP] writeFile - START - uri:",
			uri.toString(),
			"filename:",
			filename,
			"realPath:",
			realPath,
			"contentSize:",
			content.length,
		)

		// Check if file exists to determine if this is a create or update
		let wasNew = false
		try {
			await fs.stat(realPath)
			console.log("📝 [DraftFSP] writeFile - file exists, will update")
		} catch {
			wasNew = true
			console.log("📝 [DraftFSP] writeFile - file does not exist, will create")
		}

		// Ensure plans directory exists before writing
		try {
			await fs.mkdir(this._plansDir, { recursive: true })
			console.log("📝 [DraftFSP] writeFile - plans directory verified")
		} catch (error) {
			console.error("📝 [DraftFSP] writeFile - ERROR creating plans directory:", error)
			throw error
		}

		// Write to disk
		try {
			await fs.writeFile(realPath, content)
			console.log("📝 [DraftFSP] writeFile - SUCCESS writing to disk")
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.error("📝 [DraftFSP] writeFile - ERROR writing file:", err.code, err.message, err.stack)
			throw error
		}

		// Emit file change event with canonical URI
		const canonicalUri = this.filenameToUri(filename)
		const event: vscode.FileChangeEvent = {
			type: wasNew ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed,
			uri: canonicalUri,
		}
		this._emitter.fire([event])
		console.log("📝 [DraftFSP] writeFile - fired event, type:", wasNew ? "Created" : "Changed")
	}

	async delete(uri: vscode.Uri): Promise<void> {
		const filename = this.uriToFilename(uri)
		const realPath = this.getRealPath(filename)

		try {
			await fs.unlink(realPath)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw vscode.FileSystemError.FileNotFound(uri)
			}
			throw vscode.FileSystemError.Unavailable(uri)
		}

		// Emit file change event with canonical URI
		const canonicalUri = this.filenameToUri(filename)
		const event: vscode.FileChangeEvent = {
			type: vscode.FileChangeType.Deleted,
			uri: canonicalUri,
		}
		this._emitter.fire([event])
	}

	rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean }): void {
		// Draft documents don't support rename
		throw vscode.FileSystemError.NoPermissions()
	}

	/**
	 * Create a new draft document and open it in the editor.
	 * @param name - The name/title of the document (will be used as filename with unique ID suffix)
	 * @param content - Initial content of the document
	 * @returns The draft:// URI path (e.g., "draft://filename_7313f09d.plan.md")
	 */
	async createAndOpen(name: string, content: string): Promise<string> {
		// Generate unique draft ID and ensure name has .plan.md extension
		const draftId = generateDraftId()
		let baseName = name
		if (name.endsWith(".plan.md")) {
			baseName = name.slice(0, -8) // Remove ".plan.md"
		}
		const filename = `${baseName}_${draftId}.plan.md`
		console.log(
			"📝 [DraftFSP] createAndOpen - START - name:",
			name,
			"draftId:",
			draftId,
			"filename:",
			filename,
			"contentLength:",
			content.length,
		)

		// Ensure plans directory exists
		try {
			await fs.mkdir(this._plansDir, { recursive: true })
			console.log("📝 [DraftFSP] createAndOpen - plans directory verified")
		} catch (error) {
			console.error("📝 [DraftFSP] createAndOpen - ERROR creating plans directory:", error)
			throw error
		}

		// Store the document on disk
		const contentBytes = new TextEncoder().encode(content)
		const realPath = this.getRealPath(filename)
		console.log("📝 [DraftFSP] createAndOpen - writing to realPath:", realPath)
		try {
			await fs.writeFile(realPath, contentBytes)
			console.log("📝 [DraftFSP] createAndOpen - SUCCESS writing to disk")
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.error("📝 [DraftFSP] createAndOpen - ERROR writing file:", err.code, err.message, err.stack)
			throw error
		}

		// Create URI using consistent formatting
		const uri = this.filenameToUri(filename)
		console.log("📝 [DraftFSP] createAndOpen - created URI:", uri.toString())

		// Emit file change event
		const event: vscode.FileChangeEvent = {
			type: vscode.FileChangeType.Created,
			uri,
		}
		this._emitter.fire([event])
		console.log("📝 [DraftFSP] createAndOpen - fired Created event")

		// Open document in VS Code editor
		await vscode.window.showTextDocument(uri, { preview: false })
		console.log("📝 [DraftFSP] createAndOpen - opened document in editor")

		// Return the draft:// path for use in tools
		const result = filenameToDraftPath(filename)
		console.log("📝 [DraftFSP] createAndOpen - returning draftPath:", result)
		return result
	}

	/**
	 * Get draft content for RPC access.
	 * @param draftPath - The draft path (e.g., "draft://filename.md")
	 * @returns Content as Uint8Array, or undefined if not found
	 */
	async getDraftContent(draftPath: string): Promise<Uint8Array | undefined> {
		const filename = draftPathToFilename(draftPath)
		const realPath = this.getRealPath(filename)

		try {
			const buffer = await fs.readFile(realPath)
			return new Uint8Array(buffer)
		} catch {
			return undefined
		}
	}

	/**
	 * Set draft content from RPC (user edits from JetBrains).
	 * @param draftPath - The draft path
	 * @param content - New content
	 */
	async setDraftContent(draftPath: string, content: Uint8Array): Promise<void> {
		const filename = draftPathToFilename(draftPath)
		const realPath = this.getRealPath(filename)

		// Check if file exists to determine if this is a create or update
		let wasNew = false
		try {
			await fs.stat(realPath)
		} catch {
			wasNew = true
		}

		// Ensure plans directory exists
		await fs.mkdir(this._plansDir, { recursive: true })

		// Write to disk
		await fs.writeFile(realPath, content)

		const uri = this.filenameToUri(filename)
		this._emitter.fire([
			{
				type: wasNew ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed,
				uri,
			},
		])
	}

	/**
	 * Check if a draft exists.
	 * @param draftPath - The draft path
	 * @returns true if exists
	 */
	async draftExists(draftPath: string): Promise<boolean> {
		const filename = draftPathToFilename(draftPath)
		const realPath = this.getRealPath(filename)
		console.log("📝 [DraftFSP] draftExists - draftPath:", draftPath, "filename:", filename, "realPath:", realPath)

		try {
			await fs.stat(realPath)
			console.log("📝 [DraftFSP] draftExists - file exists")
			return true
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.log("📝 [DraftFSP] draftExists - file does not exist, error:", err.code)
			return false
		}
	}

	/**
	 * Delete a draft.
	 * @param draftPath - The draft path
	 */
	async deleteDraft(draftPath: string): Promise<void> {
		const filename = draftPathToFilename(draftPath)
		const realPath = this.getRealPath(filename)

		try {
			await fs.unlink(realPath)
			const uri = this.filenameToUri(filename)
			this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }])
		} catch {
			// Ignore errors - file may not exist
		}
	}

	/**
	 * List all draft paths.
	 * @returns Array of draft:// paths
	 */
	async listDrafts(): Promise<string[]> {
		try {
			await fs.mkdir(this._plansDir, { recursive: true })
			const files = await fs.readdir(this._plansDir)
			return files.filter((file) => file.endsWith(".plan.md")).map((filename) => filenameToDraftPath(filename))
		} catch {
			return []
		}
	}
}

// Singleton instance
let draftFileSystemProvider: DraftFileSystemProvider | undefined

/**
 * Get the singleton draft file system provider instance.
 */
export function getDraftFileSystem(): DraftFileSystemProvider {
	if (!draftFileSystemProvider) {
		draftFileSystemProvider = new DraftFileSystemProvider()
	}
	return draftFileSystemProvider
}

/**
 * Register the draft file system provider with VS Code.
 * @param context - VS Code extension context
 */
export function registerDraftFileSystem(context: vscode.ExtensionContext): void {
	const provider = getDraftFileSystem()
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider(DRAFT_SCHEME_NAME, provider, {
			isCaseSensitive: true,
		}),
	)

	// Note: We no longer delete drafts when tabs close - they persist on disk
	// Users can manually delete them if needed
}
