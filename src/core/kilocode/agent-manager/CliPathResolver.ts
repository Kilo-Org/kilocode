import * as path from "node:path"
import { execSync } from "node:child_process"
import { fileExistsAtPath } from "../../../utils/fs"

/**
 * Find the kilocode CLI executable.
 *
 * Resolution order:
 * 1. VS Code setting `kiloCode.agentManager.cliPath`
 * 2. Workspace-local build at <workspace>/cli/dist/index.js
 * 3. PATH using `which`/`where`
 * 4. Common npm installation paths
 */
export async function findKilocodeCli(log?: (msg: string) => void): Promise<string | null> {
	// 1) Explicit override from settings
	try {
		// Lazy import avoids hard dep when running in non-extension contexts
		const vscode = await import("vscode")
		const config = vscode.workspace.getConfiguration("kiloCode")
		const overridePath = config.get<string>("agentManager.cliPath")
		if (overridePath) {
			log?.(`Using CLI path override from settings: ${overridePath}`)
			if (await fileExistsAtPath(overridePath)) {
				return overridePath
			}
			log?.(`WARNING: Override path does not exist: ${overridePath}`)
		}

		// 2) Workspace-local build (useful during development)
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (workspacePath) {
			const localCli = path.join(workspacePath, "cli", "dist", "index.js")
			if (await fileExistsAtPath(localCli)) {
				log?.(`Using workspace CLI: ${localCli}`)
				return localCli
			}
		}
	} catch (error) {
		log?.(`findKilocodeCli: vscode lookup failed, falling back to PATH. Error: ${String(error)}`)
	}

	// 3) PATH
	const pathResult = findInPath(log)
	if (pathResult) return pathResult

	// 4) Common npm installation paths
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
