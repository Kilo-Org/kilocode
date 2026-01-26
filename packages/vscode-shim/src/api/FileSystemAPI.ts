/**
 * FileSystemAPI class for VSCode API
 */

import * as fs from "fs"
import * as path from "path"
import { Uri } from "../classes/Uri.js"
import { FileSystemError } from "../classes/Additional.js"
import { ensureDirectoryExists } from "../utils/paths.js"
import type { FileStat } from "../types.js"

/**
 * File system API mock for CLI mode
 * Provides file operations using Node.js fs module
 */
export class FileSystemAPI {
	async stat(uri: Uri): Promise<FileStat> {
		try {
			const stats = fs.statSync(uri.fsPath)
			return {
				type: stats.isDirectory() ? 2 : 1, // Directory = 2, File = 1
				ctime: stats.ctimeMs,
				mtime: stats.mtimeMs,
				size: stats.size,
			}
		} catch {
			// If file doesn't exist, assume it's a file for CLI purposes
			return {
				type: 1, // File
				ctime: Date.now(),
				mtime: Date.now(),
				size: 0,
			}
		}
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		try {
			const content = fs.readFileSync(uri.fsPath)
			return new Uint8Array(content)
		} catch (error) {
			// Check if it's a file not found error (ENOENT)
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw FileSystemError.FileNotFound(uri)
			}
			// For other errors, throw a generic FileSystemError
			throw new FileSystemError(`Failed to read file: ${uri.fsPath}`)
		}
	}

	async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
		try {
			// Ensure directory exists
			const dir = path.dirname(uri.fsPath)
			ensureDirectoryExists(dir)
			fs.writeFileSync(uri.fsPath, content)
		} catch {
			throw new Error(`Failed to write file: ${uri.fsPath}`)
		}
	}

	async delete(uri: Uri): Promise<void> {
		try {
			fs.unlinkSync(uri.fsPath)
		} catch {
			throw new Error(`Failed to delete file: ${uri.fsPath}`)
		}
	}

	async createDirectory(uri: Uri): Promise<void> {
		try {
			fs.mkdirSync(uri.fsPath, { recursive: true })
		} catch {
			throw new Error(`Failed to create directory: ${uri.fsPath}`)
		}
	}
}
