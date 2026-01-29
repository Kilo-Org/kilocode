/**
 * Update command - Check for and install CLI updates
 *
 * Usage:
 *   kilocode update           # Check and update to latest version
 *   kilocode update --check   # Only check, don't update
 */

import { spawn } from "child_process"
import { existsSync, realpathSync } from "fs"
import packageJson from "package-json"
import semver from "semver"
import { Package } from "../constants/package.js"

export type InstallMethod = "npm" | "pnpm" | "yarn" | "bun" | "npx" | "docker" | "unknown"

export interface InstallationInfo {
	method: InstallMethod
	canUpdate: boolean
	updateCommand?: string
	message?: string
}

export interface VersionInfo {
	current: string
	latest: string
	updateAvailable: boolean
}

/**
 * Detect how the CLI was installed based on the CLI script location
 */
export function detectInstallMethod(): InstallationInfo {
	// Use the CLI script path, not the Node executable path
	// process.argv[1] points to the actual kilocode script location
	// Use original path (before realpath) to detect local vs global
	// This avoids false positives when pnpm store is shared between local and global
	const originalPath = (process.argv[1] || "").toLowerCase().replace(/\\/g, "/")

	// Resolve symlinks to get the real path for global install detection
	// If realpath fails (broken symlink, permission denied), fall back to original path
	let scriptPath = process.argv[1] || ""
	try {
		scriptPath = realpathSync(scriptPath)
	} catch (error: unknown) {
		// Fall back to original path - detection will still work for most cases
		const message = error instanceof Error ? error.message : String(error)
		console.error(`Warning: Could not resolve symlink for ${scriptPath}: ${message}`)
	}
	scriptPath = scriptPath.toLowerCase().replace(/\\/g, "/")

	// Docker detection (check first as it's environment-based)
	if (existsSync("/.dockerenv")) {
		return {
			method: "docker",
			canUpdate: false,
			message: "Running in Docker. To update, pull the latest image:\n  docker pull kiloai/cli:latest",
		}
	}

	// npx/pnpx/bunx detection (temporary execution) - check before local node_modules
	if (originalPath.includes("/_npx/") || originalPath.includes("/npm/_npx")) {
		return {
			method: "npx",
			canUpdate: false,
			message: "Running via npx. Each run uses the latest version automatically.",
		}
	}
	if (
		originalPath.includes("/_pnpx/") ||
		originalPath.includes("/pnpm/dlx") ||
		originalPath.includes("/.cache/pnpm/dlx")
	) {
		return {
			method: "npx",
			canUpdate: false,
			message: "Running via pnpx. Each run uses the latest version automatically.",
		}
	}
	if (originalPath.includes("/.bun/install/cache/")) {
		return {
			method: "npx",
			canUpdate: false,
			message: "Running via bunx. Each run uses the latest version automatically.",
		}
	}

	// Yarn PnP: .yarn/cache or .yarn/unplugged are local project dependencies
	// Check this BEFORE node_modules since PnP paths may contain node_modules
	const yarnPnpMatch = originalPath.match(/^(.+)\/\.yarn\/(cache|unplugged)\/.+/)
	if (yarnPnpMatch) {
		const projectRoot = yarnPnpMatch[1]
		return {
			method: "unknown",
			canUpdate: false,
			message:
				`Running from Yarn PnP (project dependency).\n` +
				`Project: ${projectRoot}\n` +
				"To update, modify your package.json or run:\n" +
				"  yarn up @kilocode/cli",
		}
	}

	// Check if running from local dependency (project dependency, not global)
	// Exclude global paths: /usr/lib/node_modules, ~/.nvm, pnpm/global, yarn/global, etc.
	const globalPathPatterns = [
		/^\/usr\/(local\/)?lib\/node_modules\//,
		/\/\.nvm\//,
		/\/pnpm\/global\//,
		/\/\.local\/share\/pnpm\/global\//,
		/\/yarn\/global\//,
		/\/\.config\/yarn\/global\//,
		/\/appdata\/(local|roaming)\/(npm|pnpm|yarn)\//,
		/\/library\/pnpm\//,
		/\/\.bun\/install\/global\//,
	]
	const isGlobalPath = globalPathPatterns.some((pattern) => pattern.test(originalPath))

	// Match local node_modules pattern but not global paths
	const nodeModulesMatch = originalPath.match(/^(.+)\/node_modules\/.+/)
	if (nodeModulesMatch && !isGlobalPath) {
		const projectRoot = nodeModulesMatch[1]
		return {
			method: "unknown",
			canUpdate: false,
			message:
				`Running from local node_modules (project dependency).\n` +
				`Project: ${projectRoot}\n` +
				"To update, modify your package.json or run:\n" +
				"  npm update @kilocode/cli\n" +
				"  pnpm update @kilocode/cli\n" +
				"  yarn upgrade @kilocode/cli",
		}
	}

	// pnpm global - check for pnpm global store paths
	// Linux: ~/.local/share/pnpm, macOS: ~/Library/pnpm, Windows: %LOCALAPPDATA%\pnpm
	if (
		scriptPath.includes("/.pnpm/") ||
		scriptPath.includes("/pnpm/global/") ||
		scriptPath.includes("/.local/share/pnpm") ||
		scriptPath.includes("/library/pnpm") ||
		scriptPath.includes("/appdata/local/pnpm")
	) {
		return {
			method: "pnpm",
			canUpdate: true,
			updateCommand: "pnpm add -g @kilocode/cli@latest",
		}
	}

	// yarn global (Yarn 1.x only - Yarn 2+ doesn't support global)
	// Only match actual global paths, not project .yarn directories
	// Linux/macOS: ~/.yarn/bin, Windows: %APPDATA%\Yarn or %LOCALAPPDATA%\Yarn
	if (
		scriptPath.includes("/yarn/global/") ||
		scriptPath.includes("/appdata/roaming/yarn") ||
		scriptPath.includes("/appdata/local/yarn")
	) {
		return {
			method: "yarn",
			canUpdate: true,
			updateCommand: "yarn global add @kilocode/cli@latest",
		}
	}

	// bun global
	if (scriptPath.includes("/.bun/bin") || scriptPath.includes("/.bun/install/global")) {
		return {
			method: "bun",
			canUpdate: true,
			updateCommand: "bun add -g @kilocode/cli@latest",
		}
	}

	// npm global - common paths for npm global installs
	// Linux/macOS: /usr/local/lib/node_modules, /usr/lib/node_modules, ~/.npm-global
	// Windows: %APPDATA%\npm, %ProgramFiles%\nodejs
	// nvm: ~/.nvm/versions/node/*/lib/node_modules
	if (
		scriptPath.includes("/node_modules/@kilocode/cli") ||
		scriptPath.includes("/node_modules/kilocode") ||
		scriptPath.includes("/npm/node_modules/") ||
		scriptPath.includes("/.npm-global/") ||
		scriptPath.includes("/.nvm/") ||
		scriptPath.includes("/appdata/roaming/npm") ||
		scriptPath.includes("/program files/nodejs")
	) {
		return {
			method: "npm",
			canUpdate: true,
			updateCommand: "npm install -g @kilocode/cli@latest",
		}
	}

	// Unknown installation method - don't assume to avoid installing a duplicate
	return {
		method: "unknown",
		canUpdate: false,
		message:
			"Could not detect installation method. Please update manually using your package manager:\n" +
			"  npm install -g @kilocode/cli@latest\n" +
			"  pnpm add -g @kilocode/cli@latest\n" +
			"  yarn global add @kilocode/cli@latest\n" +
			"  bun add -g @kilocode/cli@latest",
	}
}

/**
 * Fetch the latest version from npm registry
 * Uses package-json which respects npm registry configuration
 */
export async function fetchLatestVersion(): Promise<string> {
	const data = await packageJson(Package.name)
	return data.version
}

/**
 * Check for available updates
 */
export async function checkForUpdates(): Promise<VersionInfo> {
	const current = Package.version
	const latest = await fetchLatestVersion()
	const updateAvailable = semver.gt(latest, current)

	return { current, latest, updateAvailable }
}

/**
 * Execute the update command
 */
export function executeUpdate(command: string): Promise<{ success: boolean; error?: string }> {
	return new Promise((resolve) => {
		// shell: true is required for Windows where npm/pnpm/yarn are .cmd files
		// We pass the full command string to spawn when using shell: true to avoid
		// issues with argument parsing (e.g. spaces in paths)
		const child = spawn(command, {
			stdio: "inherit",
			shell: true,
		})

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ success: true })
			} else {
				resolve({ success: false, error: `Update command exited with code ${code}` })
			}
		})

		child.on("error", (err) => {
			resolve({ success: false, error: err.message })
		})
	})
}

/**
 * Main update command handler
 */
export async function updateCommand(options: { check?: boolean } = {}): Promise<void> {
	const installInfo = detectInstallMethod()

	// Check for updates
	console.log("Checking for updates...")
	let versionInfo: VersionInfo
	try {
		versionInfo = await checkForUpdates()
	} catch (error) {
		console.error(`Failed to check for updates: ${error instanceof Error ? error.message : error}`)
		process.exit(1)
	}

	console.log(`Current version: ${versionInfo.current}`)
	console.log(`Latest version:  ${versionInfo.latest}`)

	if (!versionInfo.updateAvailable) {
		console.log("\n✓ You are already on the latest version.")
		process.exit(0)
	}

	console.log("\n⬆ Update available!")

	// If can't update automatically, show message
	if (!installInfo.canUpdate) {
		if (installInfo.message) {
			console.log(`\n${installInfo.message}`)
		}
		process.exit(0)
	}

	// Check-only mode
	if (options.check) {
		console.log(`\nTo update, run:\n  ${installInfo.updateCommand}`)
		process.exit(0)
	}

	// Execute update
	console.log(`\nUpdating via ${installInfo.method}...`)
	console.log(`Running: ${installInfo.updateCommand}\n`)

	const result = await executeUpdate(installInfo.updateCommand!)
	if (result.success) {
		console.log("\n✓ Update complete! Restart the CLI to use the new version.")
		process.exit(0)
	} else {
		console.error(`\n✗ Update failed: ${result.error}`)
		console.error(`\nYou can try updating manually:\n  ${installInfo.updateCommand}`)
		process.exit(1)
	}
}
