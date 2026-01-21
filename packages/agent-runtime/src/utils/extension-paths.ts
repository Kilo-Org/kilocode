import * as path from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"

export interface ExtensionPaths {
	extensionBundlePath: string // Path to extension.js
	extensionRootPath: string // Path to extension root
}

/**
 * Resolves extension paths for the agent runtime.
 *
 * The extension can be located in different places:
 * 1. Via KILOCODE_DEV_CLI_PATH environment variable (development mode)
 * 2. Via KILOCODE_EXTENSION_PATH environment variable (explicit path)
 * 3. Relative to the CLI dist folder (bundled with CLI)
 * 4. In a specified custom path (for Agent Manager use)
 *
 * @param customPath - Optional custom path to the extension root
 */
export function resolveExtensionPaths(customPath?: string): ExtensionPaths {
	// If a custom path is provided, use it
	if (customPath) {
		const extensionRootPath = customPath
		const extensionBundlePath = path.join(extensionRootPath, "dist", "extension.js")
		return {
			extensionBundlePath,
			extensionRootPath,
		}
	}

	// Check for explicit extension path environment variable
	const explicitPath = process.env.KILOCODE_EXTENSION_PATH
	if (explicitPath) {
		const extensionBundlePath = path.join(explicitPath, "dist", "extension.js")
		if (existsSync(extensionBundlePath)) {
			return {
				extensionBundlePath,
				extensionRootPath: explicitPath,
			}
		}
	}

	// Get the directory where this compiled file is located
	const currentFile = fileURLToPath(import.meta.url)
	const currentDir = path.dirname(currentFile)

	// Check if we're in a utils subdirectory or directly in dist
	const isInUtilsSubdir = currentDir.endsWith("utils")

	// Navigate to dist directory
	const distDir = isInUtilsSubdir ? path.resolve(currentDir, "..") : currentDir

	// Development mode: KILOCODE_DEV_CLI_PATH is set by launch.json
	const devCliPath = process.env.KILOCODE_DEV_CLI_PATH
	if (devCliPath) {
		// Derive workspace root from the dev CLI path (cli/dist/index.js -> workspace root)
		const workspaceRoot = path.resolve(path.dirname(devCliPath), "..", "..")
		const devExtensionPath = path.join(workspaceRoot, "src", "dist", "extension.js")
		const devExtensionRoot = path.join(workspaceRoot, "src")

		if (existsSync(devExtensionPath)) {
			return {
				extensionBundlePath: devExtensionPath,
				extensionRootPath: devExtensionRoot,
			}
		}
	}

	// Production mode: extension is bundled in dist/kilocode/
	// Try multiple locations since we might be invoked from different contexts
	const possibleRoots = [
		path.join(distDir, "kilocode"), // agent-runtime dist
		path.join(distDir, "..", "kilocode"), // one level up
		path.join(distDir, "..", "..", "cli", "dist", "kilocode"), // CLI bundled
	]

	for (const extensionRootPath of possibleRoots) {
		const extensionBundlePath = path.join(extensionRootPath, "dist", "extension.js")
		if (existsSync(extensionBundlePath)) {
			return {
				extensionBundlePath,
				extensionRootPath,
			}
		}
	}

	// Fallback: return default CLI structure (may not exist)
	const extensionRootPath = path.join(distDir, "kilocode")
	const extensionBundlePath = path.join(extensionRootPath, "dist", "extension.js")

	return {
		extensionBundlePath,
		extensionRootPath,
	}
}
