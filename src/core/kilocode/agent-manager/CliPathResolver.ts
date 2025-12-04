import * as path from "node:path"
import { execSync } from "node:child_process"
import { fileExistsAtPath } from "../../../utils/fs"

/**
 * Find the kilocode CLI executable.
 *
 * Resolution order:
 * 1. Check PATH using `which` (Unix) or `where` (Windows)
 * 2. Check common npm installation paths as fallback
 */
export async function findKilocodeCli(log?: (msg: string) => void): Promise<string | null> {
	// Try PATH first
	const pathResult = findInPath(log)
	if (pathResult) return pathResult

	// Fallback to common npm installation paths
	for (const candidate of getNpmPaths()) {
		try {
			if (await fileExistsAtPath(candidate)) return candidate
		} catch (error) {
			log?.(`Error checking path ${candidate}: ${error}`)
		}
	}

	log?.("kilocode CLI not found")
	return null
}

function findInPath(log?: (msg: string) => void): string | null {
	const cmd = process.platform === "win32" ? "where kilocode" : "which kilocode"
	try {
		return execSync(cmd, { encoding: "utf-8" }).split(/\r?\n/)[0]?.trim() || null
	} catch {
		log?.("kilocode not in PATH")
		return null
	}
}

function getNpmPaths(): string[] {
	const home = process.env.HOME || process.env.USERPROFILE || ""

	if (process.platform === "win32") {
		const appData = process.env.APPDATA || ""
		return appData ? [path.join(appData, "npm", "kilocode.cmd")] : []
	}

	return [
		"/opt/homebrew/bin/kilocode",
		"/usr/local/bin/kilocode",
		path.join(home, ".npm-global", "bin", "kilocode"),
	].filter(Boolean)
}
