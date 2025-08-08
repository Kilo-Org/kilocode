import fs from "fs-extra"
import path from "path"
import { glob } from "glob"

export interface IFileSystemAdapter {
	readFile(filePath: string): Promise<string>
	writeFile(filePath: string, content: string): Promise<void>
	exists(filePath: string): Promise<boolean>
	mkdir(dirPath: string): Promise<void>
	readdir(dirPath: string): Promise<string[]>
	stat(filePath: string): Promise<any>
	delete(filePath: string): Promise<void>
	join(...paths: string[]): string
	glob(pattern: string, options?: { ignore?: string }): Promise<string[]>
	getWorkingDirectory(): string
	setWorkingDirectory(directory: string): void
	relative(from: string, to: string): string
}

export class FileSystemAdapter implements IFileSystemAdapter {
	private workingDirectory: string

	constructor(workingDirectory?: string) {
		this.workingDirectory = workingDirectory || process.cwd()
	}

	initialize(workingDirectory: string): void {
		this.workingDirectory = workingDirectory
	}

	private resolvePath(filePath: string): string {
		if (path.isAbsolute(filePath)) {
			return filePath
		}
		return path.resolve(this.workingDirectory, filePath)
	}

	async readFile(filePath: string): Promise<string> {
		try {
			const resolvedPath = this.resolvePath(filePath)
			return await fs.readFile(resolvedPath, "utf-8")
		} catch (error) {
			throw new Error(
				`Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	async writeFile(filePath: string, content: string): Promise<void> {
		try {
			const resolvedPath = this.resolvePath(filePath)
			await fs.ensureDir(path.dirname(resolvedPath))
			await fs.writeFile(resolvedPath, content, "utf-8")
		} catch (error) {
			throw new Error(
				`Failed to write file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	async exists(filePath: string): Promise<boolean> {
		try {
			const resolvedPath = this.resolvePath(filePath)
			return await fs.pathExists(resolvedPath)
		} catch (error) {
			return false
		}
	}

	async mkdir(dirPath: string): Promise<void> {
		try {
			const resolvedPath = this.resolvePath(dirPath)
			await fs.ensureDir(resolvedPath)
		} catch (error) {
			throw new Error(
				`Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	async readdir(dirPath: string): Promise<string[]> {
		try {
			const resolvedPath = this.resolvePath(dirPath)
			return await fs.readdir(resolvedPath)
		} catch (error) {
			throw new Error(
				`Failed to read directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	async stat(filePath: string): Promise<any> {
		try {
			const resolvedPath = this.resolvePath(filePath)
			const stats = await fs.stat(resolvedPath)
			return {
				type: stats.isFile() ? 1 : stats.isDirectory() ? 2 : 0,
				ctime: Math.floor(stats.ctimeMs),
				mtime: Math.floor(stats.mtimeMs),
				size: stats.size,
			}
		} catch (error) {
			throw new Error(`Failed to stat ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	async delete(filePath: string): Promise<void> {
		try {
			const resolvedPath = this.resolvePath(filePath)
			// Check if file exists first
			await fs.access(resolvedPath)
			await fs.remove(resolvedPath)
		} catch (error) {
			throw new Error(`Failed to delete ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	join(...paths: string[]): string {
		return path.join(...paths)
	}

	async glob(pattern: string, options?: { ignore?: string }): Promise<string[]> {
		try {
			const globOptions: any = {
				cwd: this.workingDirectory,
				absolute: true,
			}

			if (options?.ignore) {
				globOptions.ignore = options.ignore
			}

			return await glob(pattern, globOptions)
		} catch (error) {
			throw new Error(`Failed to glob ${pattern}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	getWorkingDirectory(): string {
		return this.workingDirectory
	}

	setWorkingDirectory(directory: string): void {
		this.workingDirectory = directory
	}

	relative(from: string, to: string): string {
		return path.relative(from, to)
	}
}
