// kilocode_change - new file
import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import { PLAN_SCHEME_NAME, filenameToPlanPath, planPathToFilename } from "./planPaths"

/**
 * Generate a unique plan ID similar to Cursor's plan IDs.
 * Uses 7 random hex characters for collision avoidance.
 */
function generatePlanId(): string {
	const hexChars = "0123456789abcdef"
	let result = ""
	for (let i = 0; i < 7; i++) {
		result += hexChars[Math.floor(Math.random() * 16)]
	}
	return result
}

/**
 * File system provider for plan:// documents.
 * Stores documents on disk at ~/.kilocode/plans/ and makes them available as editor tabs.
 */
export class PlanFileSystemProvider implements vscode.FileSystemProvider {
	private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
	private readonly _plansDir: string

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event

	constructor() {
		this._plansDir = path.join(os.homedir(), ".kilocode", "plans")
		console.log("📝 [PlanFSP] constructor - plansDir:", this._plansDir)
		fs.mkdir(this._plansDir, { recursive: true })
			.then(() => {
				console.log("📝 [PlanFSP] constructor - plans directory created/verified")
			})
			.catch((error) => {
				console.error("📝 [PlanFSP] constructor - Failed to create plans directory:", error)
			})
	}

	/**
	 * Get the real filesystem path for a plan filename.
	 * @param filename - The filename (e.g., "my-document.md")
	 * @returns The absolute path to the file on disk
	 */
	private getRealPath(filename: string): string {
		return path.join(this._plansDir, filename)
	}

	/**
	 * Convert a plan URI path to filename (internal storage key).
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
	 * Convert a filename to VS Code URI for the plan scheme.
	 * Always produces the canonical form: plan:/filename (single slash).
	 * @param filename - The filename (without leading slash)
	 * @returns The VS Code URI with plan:// scheme
	 */
	private filenameToUri(filename: string): vscode.Uri {
		// Always use / prefix for the URI path - produces canonical plan:/filename
		return vscode.Uri.parse(`${PLAN_SCHEME_NAME}:/${filename}`)
	}

	watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
		// No-op: we don't support watching plan documents
		return new vscode.Disposable(() => {})
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const filename = this.uriToFilename(uri)
		const realPath = this.getRealPath(filename)
		console.log("📝 [PlanFSP] stat - uri:", uri.toString(), "filename:", filename, "realPath:", realPath)

		try {
			const stats = await fs.stat(realPath)
			console.log("📝 [PlanFSP] stat - SUCCESS, size:", stats.size)
			return {
				type: vscode.FileType.File,
				ctime: stats.birthtimeMs,
				mtime: stats.mtimeMs,
				size: stats.size,
			}
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.log("📝 [PlanFSP] stat - ERROR:", err.code, err.message)
			if (err.code === "ENOENT") {
				throw vscode.FileSystemError.FileNotFound(uri)
			}
			throw vscode.FileSystemError.Unavailable(uri)
		}
	}

	readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
		// Plan documents don't support directories
		throw vscode.FileSystemError.FileNotFound()
	}

	createDirectory(_uri: vscode.Uri): void {
		// Plan documents don't support directories
		throw vscode.FileSystemError.NoPermissions()
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const filename = this.uriToFilename(uri)
		const realPath = this.getRealPath(filename)
		console.log("📝 [PlanFSP] readFile - uri:", uri.toString(), "filename:", filename, "realPath:", realPath)

		try {
			const content = await fs.readFile(realPath)
			console.log("📝 [PlanFSP] readFile - SUCCESS, size:", content.length)
			return content
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.log("📝 [PlanFSP] readFile - ERROR:", err.code, err.message)
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
			"📝 [PlanFSP] writeFile - START - uri:",
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
			console.log("📝 [PlanFSP] writeFile - file exists, will update")
		} catch {
			wasNew = true
			console.log("📝 [PlanFSP] writeFile - file does not exist, will create")
		}

		// Ensure plans directory exists before writing
		try {
			await fs.mkdir(this._plansDir, { recursive: true })
			console.log("📝 [PlanFSP] writeFile - plans directory verified")
		} catch (error) {
			console.error("📝 [PlanFSP] writeFile - ERROR creating plans directory:", error)
			throw error
		}

		// Write to disk
		try {
			await fs.writeFile(realPath, content)
			console.log("📝 [PlanFSP] writeFile - SUCCESS writing to disk")
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.error("📝 [PlanFSP] writeFile - ERROR writing file:", err.code, err.message, err.stack)
			throw error
		}

		// Emit file change event with canonical URI
		const canonicalUri = this.filenameToUri(filename)
		const event: vscode.FileChangeEvent = {
			type: wasNew ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed,
			uri: canonicalUri,
		}
		this._emitter.fire([event])
		console.log("📝 [PlanFSP] writeFile - fired event, type:", wasNew ? "Created" : "Changed")
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
		// Plan documents don't support rename
		throw vscode.FileSystemError.NoPermissions()
	}

	/**
	 * Create a new plan document and open it in the editor.
	 * @param name - The name/title of the document (will be used as filename with unique ID suffix)
	 * @param content - Initial content of the document
	 * @returns The plan:// URI path (e.g., "plan://filename_7313f09d.plan.md")
	 */
	async createAndOpen(name: string, content: string): Promise<string> {
		// Generate unique plan ID and ensure name has .plan.md extension
		const planId = generatePlanId()
		let baseName = name
		if (name.endsWith(".plan.md")) {
			baseName = name.slice(0, -8) // Remove ".plan.md"
		}
		const filename = `${baseName}_${planId}.plan.md`
		console.log(
			"📝 [PlanFSP] createAndOpen - START - name:",
			name,
			"planId:",
			planId,
			"filename:",
			filename,
			"contentLength:",
			content.length,
		)

		// Ensure plans directory exists
		try {
			await fs.mkdir(this._plansDir, { recursive: true })
			console.log("📝 [PlanFSP] createAndOpen - plans directory verified")
		} catch (error) {
			console.error("📝 [PlanFSP] createAndOpen - ERROR creating plans directory:", error)
			throw error
		}

		// Store the document on disk
		const contentBytes = new TextEncoder().encode(content)
		const realPath = this.getRealPath(filename)
		console.log("📝 [PlanFSP] createAndOpen - writing to realPath:", realPath)
		try {
			await fs.writeFile(realPath, contentBytes)
			console.log("📝 [PlanFSP] createAndOpen - SUCCESS writing to disk")
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.error("📝 [PlanFSP] createAndOpen - ERROR writing file:", err.code, err.message, err.stack)
			throw error
		}

		// Create URI using consistent formatting
		const uri = this.filenameToUri(filename)
		console.log("📝 [PlanFSP] createAndOpen - created URI:", uri.toString())

		// Emit file change event
		const event: vscode.FileChangeEvent = {
			type: vscode.FileChangeType.Created,
			uri,
		}
		this._emitter.fire([event])
		console.log("📝 [PlanFSP] createAndOpen - fired Created event")

		// Open document in VS Code editor
		await vscode.window.showTextDocument(uri, { preview: false })
		console.log("📝 [PlanFSP] createAndOpen - opened document in editor")

		// Return the plan:// path for use in tools
		const result = filenameToPlanPath(filename)
		console.log("📝 [PlanFSP] createAndOpen - returning planPath:", result)
		return result
	}

	/**
	 * Get plan content for RPC access.
	 * @param planPath - The plan path (e.g., "plan://filename.md")
	 * @returns Content as Uint8Array, or undefined if not found
	 */
	async getPlanContent(planPath: string): Promise<Uint8Array | undefined> {
		const filename = planPathToFilename(planPath)
		const realPath = this.getRealPath(filename)

		try {
			const buffer = await fs.readFile(realPath)
			return new Uint8Array(buffer)
		} catch {
			return undefined
		}
	}

	/**
	 * Set plan content from RPC (user edits from JetBrains).
	 * @param planPath - The plan path
	 * @param content - New content
	 */
	async setPlanContent(planPath: string, content: Uint8Array): Promise<void> {
		const filename = planPathToFilename(planPath)
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
	 * Check if a plan exists.
	 * @param planPath - The plan path
	 * @returns true if exists
	 */
	async planExists(planPath: string): Promise<boolean> {
		const filename = planPathToFilename(planPath)
		const realPath = this.getRealPath(filename)
		console.log("📝 [PlanFSP] planExists - planPath:", planPath, "filename:", filename, "realPath:", realPath)

		try {
			await fs.stat(realPath)
			console.log("📝 [PlanFSP] planExists - file exists")
			return true
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			console.log("📝 [PlanFSP] planExists - file does not exist, error:", err.code)
			return false
		}
	}

	/**
	 * Delete a plan.
	 * @param planPath - The plan path
	 */
	async deletePlan(planPath: string): Promise<void> {
		const filename = planPathToFilename(planPath)
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
	 * List all plan paths.
	 * @returns Array of plan:// paths
	 */
	async listPlans(): Promise<string[]> {
		try {
			await fs.mkdir(this._plansDir, { recursive: true })
			const files = await fs.readdir(this._plansDir)
			return files.filter((file) => file.endsWith(".plan.md")).map((filename) => filenameToPlanPath(filename))
		} catch {
			return []
		}
	}
}

// Singleton instance
let planFileSystemProvider: PlanFileSystemProvider | undefined

/**
 * Get the singleton plan file system provider instance.
 */
export function getPlanFileSystem(): PlanFileSystemProvider {
	if (!planFileSystemProvider) {
		planFileSystemProvider = new PlanFileSystemProvider()
	}
	return planFileSystemProvider
}

/**
 * Register the plan file system provider with VS Code.
 * @param context - VS Code extension context
 */
export function registerPlanFileSystem(context: vscode.ExtensionContext): void {
	const provider = getPlanFileSystem()
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider(PLAN_SCHEME_NAME, provider, {
			isCaseSensitive: true,
		}),
	)

	// Note: We no longer delete plans when tabs close - they persist on disk
	// Users can manually delete them if needed
}
