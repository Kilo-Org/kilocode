import * as path from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"

export interface ExtensionPaths {
	extensionBundlePath: string
	extensionRootPath: string
}

/**
 * Resolves extension paths for CLI.
 *
 * In development mode (KILOCODE_DEV_CLI_PATH is set):
 * - Uses src/dist/extension.js directly from the source workspace
 *
 * In production mode (npm installed CLI):
 * - Uses cli/dist/kilocode/dist/extension.js (bundled with CLI)
 */
export function resolveExtensionPaths(): ExtensionPaths {
	const currentFile = fileURLToPath(import.meta.url)
	const currentDir = path.dirname(currentFile)

	// When bundled with esbuild, all code is in dist/index.js
	// Navigate to the dist directory
	const isInSubdir = currentDir.endsWith("utils")
	const distDir = isInSubdir ? path.resolve(currentDir, "..") : currentDir

	// Development mode: KILOCODE_DEV_CLI_PATH is set by launch.json
	const devCliPath = process.env.KILOCODE_DEV_CLI_PATH
	if (devCliPath) {
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
	const extensionRootPath = path.join(distDir, "kilocode")
	const extensionBundlePath = path.join(extensionRootPath, "dist", "extension.js")

	return {
		extensionBundlePath,
		extensionRootPath,
	}
}
