/**
 * Update Service for Kilo Code CLI
 *
 * Handles checking for updates, performing updates, and restarting the CLI.
 */

import { spawn, ChildProcess } from "child_process"
import { readFileSync } from "fs"
import { logs } from "./logs.js"
import semver from "semver"

const NPM_REGISTRY_URL = "https://registry.npmjs.org/@kilocode/cli"
const PACKAGE_JSON_PATH = new URL("../../package.json", import.meta.url)

/**
 * Get the current version of the CLI
 */
export function getCurrentVersion(): string {
	try {
		const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"))
		return packageJson.version || "0.0.0"
	} catch (error) {
		logs.error("Failed to read current version", "UpdateService", { error })
		return "0.0.0"
	}
}

/**
 * Fetch the latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string | null> {
	try {
		const response = await fetch(NPM_REGISTRY_URL)
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = (await response.json()) as { "dist-tags": { latest: string } }
		return data["dist-tags"]?.latest || null
	} catch (error) {
		logs.error("Failed to fetch latest version from npm", "UpdateService", { error })
		return null
	}
}

/**
 * Check if an update is available
 */
export async function checkForUpdates(): Promise<{
	currentVersion: string
	latestVersion: string | null
	updateAvailable: boolean
	message: string
}> {
	const currentVersion = getCurrentVersion()
	logs.info("Checking for updates...", "UpdateService", { currentVersion })

	const latestVersion = await fetchLatestVersion()

	if (!latestVersion) {
		return {
			currentVersion,
			latestVersion: null,
			updateAvailable: false,
			message: "Failed to check for updates. Please try again later.",
		}
	}

	const updateAvailable = semver.gt(latestVersion, currentVersion)

	if (updateAvailable) {
		logs.info("Update available", "UpdateService", {
			currentVersion,
			latestVersion,
		})
		return {
			currentVersion,
			latestVersion,
			updateAvailable: true,
			message: `Update available: ${currentVersion} → ${latestVersion}`,
		}
	}

	logs.info("Already up to date", "UpdateService", {
		currentVersion,
		latestVersion,
	})
	return {
		currentVersion,
		latestVersion,
		updateAvailable: false,
		message: `Already up to date (v${currentVersion})`,
	}
}

/**
 * Perform the update by running npm install -g @kilocode/cli@latest
 */
export async function performUpdate(): Promise<{
	success: boolean
	message: string
}> {
	logs.info("Starting update process...", "UpdateService")

	return new Promise((resolve) => {
		const npmProcess = spawn("npm", ["install", "-g", "@kilocode/cli@latest"], {
			stdio: "pipe",
			shell: true,
		})

		let stdout = ""
		let stderr = ""

		npmProcess.stdout?.on("data", (data) => {
			stdout += data.toString()
		})

		npmProcess.stderr?.on("data", (data) => {
			stderr += data.toString()
		})

		npmProcess.on("close", (code) => {
			if (code === 0) {
				logs.info("Update completed successfully", "UpdateService")
				resolve({
					success: true,
					message: "Update completed successfully. Please restart the CLI to use the new version.",
				})
			} else {
				logs.error("Update failed", "UpdateService", {
					code,
					stderr,
				})
				resolve({
					success: false,
					message: `Update failed with exit code ${code}. Please check the logs for details.`,
				})
			}
		})

		npmProcess.on("error", (error) => {
			logs.error("Failed to start update process", "UpdateService", { error })
			resolve({
				success: false,
				message: `Failed to start update process: ${error.message}`,
			})
		})
	})
}

/**
 * Restart the CLI with the same arguments
 */
export function restartCLI(): {
	success: boolean
	message: string
} {
	const args = process.argv.slice(2)
	logs.info("Restarting CLI...", "UpdateService", { args })

	try {
		// Spawn a new process with the same arguments
		const scriptPath = process.argv[1] || ""
		const child = spawn(process.execPath, [scriptPath, ...args], {
			detached: true,
			stdio: "ignore",
		})

		// kilocode_change - Type assertion to handle complex spawn return type
		;(child as ChildProcess).unref()

		// Exit the current process
		process.exit(0)

		// This return is for type safety, but the code above will exit
		return {
			success: true,
			message: "Restarting CLI...",
		}
	} catch (error) {
		logs.error("Failed to restart CLI", "UpdateService", { error })
		return {
			success: false,
			message: `Failed to restart CLI: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Compare two version strings
 */
export function compareVersions(version1: string, version2: string): number {
	return semver.compare(version1, version2)
}

/**
 * Check if version1 is greater than version2
 */
export function isVersionGreater(version1: string, version2: string): boolean {
	return semver.gt(version1, version2)
}

/**
 * Check if version1 is less than version2
 */
export function isVersionLess(version1: string, version2: string): boolean {
	return semver.lt(version1, version2)
}

/**
 * Check if two versions are equal
 */
export function isVersionEqual(version1: string, version2: string): boolean {
	return semver.eq(version1, version2)
}

/**
 * Get the timestamp for the last update check
 */
export function getLastUpdateCheckTimestamp(): string {
	return new Date().toISOString()
}
