import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import fsSync from "fs"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"
import "../../utils/path" // Import to enable String.prototype.toPosix()

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

/**
 * Supported ignore file names in order of precedence.
 * .kilocodeignore takes precedence over .kiloignore
 */
export const IGNORE_FILE_NAMES = [".kilocodeignore", ".kiloignore"] as const

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in ignore files.
 * Supports both .kilocodeignore and .kiloignore (with .kilocodeignore taking precedence).
 */
export class RooIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private disposables: vscode.Disposable[] = []
	rooIgnoreContent: string | undefined
	/** The actual ignore file name being used (for error messages) */
	activeIgnoreFileName: string | undefined

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.rooIgnoreContent = undefined
		this.activeIgnoreFileName = undefined
		// Set up file watcher for ignore files
		this.setupFileWatcher()
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadRooIgnore()
	}

	/**
	 * Set up file watchers for ignore file changes.
	 * Watches both .kilocodeignore and .kiloignore for changes.
	 */
	private setupFileWatcher(): void {
		for (const ignoreFileName of IGNORE_FILE_NAMES) {
			const ignorePattern = new vscode.RelativePattern(this.cwd, ignoreFileName)
			const fileWatcher = vscode.workspace.createFileSystemWatcher(ignorePattern)

			// Watch for changes and updates
			this.disposables.push(
				fileWatcher.onDidChange(() => {
					void this.loadRooIgnore()
				}),
				fileWatcher.onDidCreate(() => {
					void this.loadRooIgnore()
				}),
				fileWatcher.onDidDelete(() => {
					void this.loadRooIgnore()
				}),
			)

			// Add fileWatcher itself to disposables
			this.disposables.push(fileWatcher)
		}
	}

	/**
	 * Load custom patterns from ignore file if it exists.
	 * Checks for .kilocodeignore first, then falls back to .kiloignore.
	 */
	private async loadRooIgnore(): Promise<void> {
		try {
			// Reset ignore instance to prevent duplicate patterns
			this.ignoreInstance = ignore()
			this.rooIgnoreContent = undefined
			this.activeIgnoreFileName = undefined

			// Check for ignore files in order of precedence
			for (const ignoreFileName of IGNORE_FILE_NAMES) {
				const ignorePath = path.join(this.cwd, ignoreFileName)
				if (await fileExistsAtPath(ignorePath)) {
					const content = await fs.readFile(ignorePath, "utf8")
					this.rooIgnoreContent = content
					this.activeIgnoreFileName = ignoreFileName
					this.ignoreInstance.add(content)
					// Only use the first found file (precedence order)
					break
				}
			}

			// Always ignore both possible ignore filenames so neither can be read by LLM
			this.ignoreInstance.add(IGNORE_FILE_NAMES.join("\n"))
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			console.error("Unexpected error loading ignore file:", error)
		}
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * Automatically resolves symlinks
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string): boolean {
		// Always allow access if no ignore file exists
		if (!this.rooIgnoreContent) {
			return true
		}
		try {
			const absolutePath = path.resolve(this.cwd, filePath)

			// Follow symlinks to get the real path
			let realPath: string
			try {
				realPath = fsSync.realpathSync(absolutePath)
			} catch {
				// If realpath fails (file doesn't exist, broken symlink, etc.),
				// use the original path
				realPath = absolutePath
			}

			// Convert real path to relative for ignore checking
			const relativePath = path.relative(this.cwd, realPath).toPosix()

			// Check if the real path is ignored
			return !this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			// Allow access to files outside cwd or on errors (backward compatibility)
			return true
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if no ignore file exists
		if (!this.rooIgnoreContent) {
			return undefined
		}

		// Split command into parts and get the base command
		const parts = command.trim().split(/\s+/)
		const baseCommand = parts[0]?.toLowerCase()

		// If no base command, allow the command
		if (!baseCommand) {
			return undefined
		}

		// Commands that read file contents
		const fileReadingCommands = [
			// Unix commands
			"cat",
			"less",
			"more",
			"head",
			"tail",
			"grep",
			"awk",
			"sed",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]

		if (fileReadingCommands.includes(baseCommand)) {
			// Check each argument that could be a file path
			for (let i = 1; i < parts.length; i++) {
				const arg = parts[i]
				// Skip undefined arguments
				if (!arg) {
					continue
				}
				// Skip command flags/options (both Unix and PowerShell style)
				if (arg.startsWith("-") || arg.startsWith("/")) {
					continue
				}
				// Ignore PowerShell parameter names
				if (arg.includes(":")) {
					continue
				}
				// Validate file access
				if (!this.validateAccess(arg)) {
					return arg
				}
			}
		}

		return undefined
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		try {
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			console.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}

	/**
	 * Get formatted instructions about the ignore file for the LLM
	 * @returns Formatted instructions or undefined if no ignore file exists
	 */
	getInstructions(): string | undefined {
		if (!this.rooIgnoreContent || !this.activeIgnoreFileName) {
			return undefined
		}

		return `# ${this.activeIgnoreFileName}\n\n(The following is provided by a root-level ${this.activeIgnoreFileName} file where the user has specified files and directories that should not be accessed. Supports both .kilocodeignore and .kiloignore; .kilocodeignore takes precedence if both exist. When using list_files, you'll notice a ${LOCK_TEXT_SYMBOL} next to files that are blocked. Attempting to access the file's contents e.g. through read_file will result in an error.)\n\n${this.rooIgnoreContent}\n${this.activeIgnoreFileName}`
	}
}
