import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import type { IFileSystem, FileStats, DirectoryEntry, CopyOptions, FileWatchEvent, FileWatcher } from "../types"

/**
 * CLI implementation of the IFileSystem interface using Node.js fs APIs.
 * Provides comprehensive file system operations for command-line environments.
 */
export class CLIFileSystemProvider implements IFileSystem {
	private watchers = new Map<string, fsSync.FSWatcher>()

	async readFile(filePath: string, encoding: BufferEncoding = "utf8"): Promise<string> {
		return await fs.readFile(filePath, encoding)
	}

	async readFileBuffer(filePath: string): Promise<Buffer> {
		return await fs.readFile(filePath)
	}

	async writeFile(filePath: string, content: string | Buffer, encoding: BufferEncoding = "utf8"): Promise<void> {
		await this.ensureDirectoryExists(path.dirname(filePath))
		if (Buffer.isBuffer(content)) {
			await fs.writeFile(filePath, content)
		} else {
			await fs.writeFile(filePath, content, encoding)
		}
	}

	async appendFile(filePath: string, content: string, encoding: BufferEncoding = "utf8"): Promise<void> {
		await fs.appendFile(filePath, content, encoding)
	}

	async exists(filePath: string): Promise<boolean> {
		// Check for invalid path characters
		if (filePath.includes("\0")) {
			throw new Error(`Invalid path: ${filePath}`)
		}

		try {
			await fs.access(filePath)
			return true
		} catch (error: any) {
			// Re-throw if it's a path validation error
			if (error.code === "EINVAL" || error.code === "ENOTDIR") {
				throw error
			}
			return false
		}
	}

	async stat(filePath: string): Promise<FileStats> {
		const stats = await fs.stat(filePath)
		return {
			isFile: stats.isFile(),
			isDirectory: stats.isDirectory(),
			isSymbolicLink: stats.isSymbolicLink(),
			size: stats.size,
			ctime: stats.ctime,
			mtime: stats.mtime,
			atime: stats.atime,
		}
	}

	async mkdir(dirPath: string, recursive: boolean = true): Promise<void> {
		await fs.mkdir(dirPath, { recursive })
	}

	async unlink(filePath: string): Promise<void> {
		await fs.unlink(filePath)
	}

	async rmdir(dirPath: string, recursive: boolean = false): Promise<void> {
		if (recursive) {
			await fs.rm(dirPath, { recursive: true, force: true })
		} else {
			await fs.rmdir(dirPath)
		}
	}

	async readdir(dirPath: string): Promise<DirectoryEntry[]> {
		const entries = await fs.readdir(dirPath, { withFileTypes: true })
		return entries.map((entry) => ({
			name: entry.name,
			isFile: entry.isFile(),
			isDirectory: entry.isDirectory(),
			isSymbolicLink: entry.isSymbolicLink(),
		}))
	}

	async copy(source: string, destination: string, options: CopyOptions = {}): Promise<void> {
		const { overwrite = false, preserveTimestamps = false, recursive = true } = options

		const sourceStats = await this.stat(source)

		if (sourceStats.isDirectory) {
			if (!recursive) {
				throw new Error("Cannot copy directory without recursive option")
			}
			await this.copyDirectory(source, destination, options)
		} else {
			await this.copyFile(source, destination, overwrite, preserveTimestamps)
		}
	}

	async move(source: string, destination: string): Promise<void> {
		await this.ensureDirectoryExists(path.dirname(destination))
		await fs.rename(source, destination)
	}

	watch(watchPath: string, callback: (event: FileWatchEvent) => void): FileWatcher {
		// Check if the path exists, if not, watch the parent directory
		let actualWatchPath = watchPath
		if (!fsSync.existsSync(watchPath)) {
			const parentDir = path.dirname(watchPath)
			if (fsSync.existsSync(parentDir)) {
				actualWatchPath = parentDir
			} else {
				throw new Error(`Cannot watch path: ${watchPath} - parent directory does not exist`)
			}
		}

		const watcher = fsSync.watch(actualWatchPath, { recursive: true }, (eventType, filename) => {
			if (filename) {
				const fullPath = path.join(actualWatchPath, filename)
				let type: "created" | "modified" | "deleted"

				// Simple mapping - Node.js fs.watch doesn't distinguish between created/modified well
				if (eventType === "rename") {
					// Check if file exists to determine if it was created or deleted
					const exists = fsSync.existsSync(fullPath)
					type = exists ? "created" : "deleted"
				} else {
					type = "modified"
				}

				callback({ type, path: fullPath })
			}
		})

		const watcherId = `${watchPath}-${Date.now()}`
		this.watchers.set(watcherId, watcher)

		return {
			dispose: () => {
				watcher.close()
				this.watchers.delete(watcherId)
			},
		}
	}

	resolvePath(filePath: string, basePath?: string): string {
		if (path.isAbsolute(filePath)) {
			return path.resolve(filePath)
		}
		return path.resolve(basePath || process.cwd(), filePath)
	}

	relativePath(from: string, to: string): string {
		return path.relative(from, to)
	}

	joinPath(...paths: string[]): string {
		return path.join(...paths)
	}

	dirname(filePath: string): string {
		return path.dirname(filePath)
	}

	basename(filePath: string, ext?: string): string {
		return path.basename(filePath, ext)
	}

	extname(filePath: string): string {
		return path.extname(filePath)
	}

	/**
	 * Ensure directory exists, creating it if necessary.
	 */
	private async ensureDirectoryExists(dirPath: string): Promise<void> {
		try {
			await fs.access(dirPath)
		} catch {
			await fs.mkdir(dirPath, { recursive: true })
		}
	}

	/**
	 * Copy a single file with options.
	 */
	private async copyFile(
		source: string,
		destination: string,
		overwrite: boolean,
		preserveTimestamps: boolean,
	): Promise<void> {
		if (!overwrite && (await this.exists(destination))) {
			throw new Error(`Destination file already exists: ${destination}`)
		}

		await this.ensureDirectoryExists(path.dirname(destination))
		await fs.copyFile(source, destination)

		if (preserveTimestamps) {
			const sourceStats = await fs.stat(source)
			await fs.utimes(destination, sourceStats.atime, sourceStats.mtime)
		}
	}

	/**
	 * Recursively copy a directory.
	 */
	private async copyDirectory(source: string, destination: string, options: CopyOptions): Promise<void> {
		await this.mkdir(destination, true)

		const entries = await this.readdir(source)

		for (const entry of entries) {
			const sourcePath = this.joinPath(source, entry.name)
			const destPath = this.joinPath(destination, entry.name)

			if (entry.isDirectory) {
				await this.copyDirectory(sourcePath, destPath, options)
			} else {
				await this.copyFile(
					sourcePath,
					destPath,
					options.overwrite || false,
					options.preserveTimestamps || false,
				)
			}
		}
	}

	/**
	 * Dispose all watchers and clean up resources.
	 */
	dispose(): void {
		for (const watcher of this.watchers.values()) {
			watcher.close()
		}
		this.watchers.clear()
	}
}
