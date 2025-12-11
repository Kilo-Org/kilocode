import { execSync } from "node:child_process"

const CLI_PACKAGE_NAME = "@kilocode/cli"

/**
 * Get the npm install command for the CLI.
 * Useful for displaying to users or running in terminal.
 */
export function getCliInstallCommand(): string {
	return `npm install -g ${CLI_PACKAGE_NAME}`
}

/**
 * Check if Node.js is available in the system.
 * Returns the path to the node executable if found, null otherwise.
 */
export function findNodeExecutable(log?: (msg: string) => void): string | null {
	const cmd = process.platform === "win32" ? "where node" : "which node"
	try {
		const nodePath = execSync(cmd, { encoding: "utf-8" }).split(/\r?\n/)[0]?.trim()
		if (nodePath) {
			log?.(`Found Node.js at: ${nodePath}`)
			return nodePath
		}
	} catch {
		log?.("Node.js not found in PATH")
	}
	return null
}

/**
 * Check if npm is available in the system.
 * Returns the path to the npm executable if found, null otherwise.
 */
export function findNpmExecutable(log?: (msg: string) => void): string | null {
	const cmd = process.platform === "win32" ? "where npm" : "which npm"
	try {
		const npmPath = execSync(cmd, { encoding: "utf-8" }).split(/\r?\n/)[0]?.trim()
		if (npmPath) {
			log?.(`Found npm at: ${npmPath}`)
			return npmPath
		}
	} catch {
		log?.("npm not found in PATH")
	}
	return null
}

/**
 * Check if Node.js and npm are available for CLI installation.
 */
export function canInstallCli(log?: (msg: string) => void): boolean {
	const hasNode = findNodeExecutable(log) !== null
	const hasNpm = findNpmExecutable(log) !== null
	return hasNode && hasNpm
}
