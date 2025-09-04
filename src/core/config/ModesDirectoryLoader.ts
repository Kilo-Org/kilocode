import * as fsp from "fs/promises"
import type { Dirent } from "fs"
import * as path from "path"
import * as yaml from "yaml"

import { type ModeConfig, modeConfigSchema } from "@roo-code/types"

type FileEntry = {
	fullPath: string
	relativePath: string
}

/**
 * ModesDirectoryLoader
 *
 * Loads mode YAML files from a directory structure recursively.
 * - Supports .yaml and .yml extensions
 * - Skips hidden directories/files and common system/cache folders
 * - Validates each mode config against modeConfigSchema
 * - Detects duplicate slug conflicts
 * - Returns modes sorted by slug
 */
export class ModesDirectoryLoader {
	// Directories we never traverse into
	private static readonly EXCLUDED_DIRS = new Set([
		".git",
		".svn",
		".hg",
		"node_modules",
		"dist",
		"build",
		".next",
		".cache",
		".idea",
		".vscode",
		".DS_Store",
	])

	// Files we never consider
	private static readonly EXCLUDED_FILES = new Set([".DS_Store", "Thumbs.db"])

	// Allowed file extensions for YAML modes
	private static readonly ALLOWED_EXTENSIONS = new Set([".yaml", ".yml"])

	/**
	 * Scans a directory recursively and returns a list of YAML files to consider as mode files.
	 */
	private async scanForModeFiles(rootDir: string): Promise<FileEntry[]> {
		console.log(`[ModesDirectoryLoader] DEBUG: Scanning directory: ${rootDir}`)
		const results: FileEntry[] = []

		const walk = async (dir: string) => {
			console.log(`[ModesDirectoryLoader] DEBUG: Walking directory: ${dir}`)
			let entries: Dirent[]
			try {
				entries = await fsp.readdir(dir, { withFileTypes: true })
				console.log(
					`[ModesDirectoryLoader] DEBUG: Found ${entries.length} entries in ${dir}:`,
					entries.map((e) => `${e.name} (${e.isDirectory() ? "dir" : "file"})`),
				)
			} catch (err) {
				console.log(`[ModesDirectoryLoader] DEBUG: Cannot read directory ${dir}:`, err)
				return
			}

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)
				const relativePath = path.relative(rootDir, fullPath)
				console.log(
					`[ModesDirectoryLoader] DEBUG: Processing entry: ${entry.name} (${entry.isDirectory() ? "dir" : "file"})`,
				)

				// Skip hidden files/dirs (starting with .) unless it's the root provided
				if (entry.name.startsWith(".") && entry.name !== ".roo") {
					console.log(`[ModesDirectoryLoader] DEBUG: Skipping hidden entry: ${entry.name}`)
					// .roo may be relevant in this project for rules; keep traversable but not required
					if (entry.isDirectory()) {
						continue
					}
				}

				// Skip known excluded directories
				if (entry.isDirectory()) {
					if (ModesDirectoryLoader.EXCLUDED_DIRS.has(entry.name)) {
						console.log(`[ModesDirectoryLoader] DEBUG: Skipping excluded directory: ${entry.name}`)
						continue
					}
					console.log(`[ModesDirectoryLoader] DEBUG: Recursing into directory: ${fullPath}`)
					await walk(fullPath)
					continue
				}

				// Skip excluded files
				if (ModesDirectoryLoader.EXCLUDED_FILES.has(entry.name)) {
					console.log(`[ModesDirectoryLoader] DEBUG: Skipping excluded file: ${entry.name}`)
					continue
				}

				// Only .yaml/.yml files
				const ext = path.extname(entry.name).toLowerCase()
				console.log(`[ModesDirectoryLoader] DEBUG: File extension: ${ext}`)
				if (!ModesDirectoryLoader.ALLOWED_EXTENSIONS.has(ext)) {
					console.log(`[ModesDirectoryLoader] DEBUG: Skipping file with unsupported extension: ${entry.name}`)
					continue
				}

				console.log(`[ModesDirectoryLoader] DEBUG: Checking if should include file: ${fullPath}`)
				if (await this.shouldIncludeModeFile(fullPath, relativePath)) {
					console.log(`[ModesDirectoryLoader] DEBUG: Including file: ${relativePath}`)
					results.push({ fullPath, relativePath })
				} else {
					console.log(`[ModesDirectoryLoader] DEBUG: Excluding file: ${relativePath}`)
				}
			}
		}

		await walk(rootDir)
		console.log(`[ModesDirectoryLoader] DEBUG: Scan complete. Found ${results.length} mode files`)
		return results
	}

	/**
	 * Determines whether a discovered YAML file should be considered as a mode file.
	 * This mirrors the idea of a rules loader filter — here we simply allow any .yaml/.yml
	 * file that isn't in excluded directories and doesn't start with an underscore.
	 */
	protected async shouldIncludeModeFile(fullPath: string, relativePath: string): Promise<boolean> {
		const base = path.basename(fullPath)
		if (base.startsWith("_")) return false
		// Additional custom filters can be implemented here if needed later
		return true
	}

	/**
	 * Reads and parses a YAML mode file into a ModeConfig, validating with zod.
	 */
	protected async loadAndValidateMode(filePath: string): Promise<ModeConfig | null> {
		try {
			const raw = await fsp.readFile(filePath, "utf-8")
			const parsed = yaml.parse(raw)

			// Some files may contain a top-level object that is the mode, others could
			// theoretically export arrays — we only accept a single mode object per file.
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("Mode file must contain a single YAML object")
			}

			const result = modeConfigSchema.safeParse(parsed)
			if (!result.success) {
				const issues = result.error.issues
					.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
					.join("; ")
				throw new Error(`Schema validation failed: ${issues}`)
			}

			return result.data
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			console.error(`[ModesDirectoryLoader] Failed to parse ${filePath}: ${msg}`)
			return null
		}
	}

	/**
	 * Loads all modes from a directory recursively.
	 * - Validates each file
	 * - Ensures slugs are unique
	 * - Returns modes sorted by slug
	 */
	public async loadModesFromDirectory(rootDir: string): Promise<ModeConfig[]> {
		console.log(`[ModesDirectoryLoader] DEBUG: Loading modes from directory: ${rootDir}`)
		const files = await this.scanForModeFiles(rootDir)
		console.log(
			`[ModesDirectoryLoader] DEBUG: Found ${files.length} YAML files:`,
			files.map((f) => f.relativePath),
		)

		const modes: ModeConfig[] = []
		const slugToFile = new Map<string, string>()

		for (const f of files) {
			console.log(`[ModesDirectoryLoader] DEBUG: Processing file: ${f.fullPath}`)
			const mode = await this.loadAndValidateMode(f.fullPath)
			if (!mode) {
				console.log(`[ModesDirectoryLoader] DEBUG: Failed to load/validate mode from: ${f.fullPath}`)
				continue
			}

			console.log(`[ModesDirectoryLoader] DEBUG: Successfully loaded mode "${mode.slug}" from: ${f.fullPath}`)

			if (slugToFile.has(mode.slug)) {
				const conflictPath = slugToFile.get(mode.slug)!
				throw new Error(
					`Duplicate mode slug detected: "${mode.slug}". Files: ${conflictPath} and ${f.fullPath}`,
				)
			}

			slugToFile.set(mode.slug, f.fullPath)
			modes.push(mode)
		}

		// Sort by slug for determinism
		modes.sort((a, b) => a.slug.localeCompare(b.slug))
		console.log(
			`[ModesDirectoryLoader] DEBUG: Final modes loaded: ${modes.length}`,
			modes.map((m) => m.slug),
		)
		return modes
	}
}
