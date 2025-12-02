import { execSync } from "child_process"
import path from "path"
import { fileExistsAtPath } from "../../utils/fs"

export async function checkBunPath(vscodeAppRoot: string, binName: string) {
	// For bun: resolve package and find binary (bun uses symlinks to global cache)
	try {
		const ripgrepPkg = require.resolve("@vscode/ripgrep/package.json", { paths: [vscodeAppRoot] })
		const ripgrepRoot = path.dirname(ripgrepPkg)
		const bunPath = path.join(ripgrepRoot, "bin", binName)
		if (await fileExistsAtPath(bunPath)) {
			return bunPath
		}
	} catch (error) {
		// Package not found via require.resolve
	}

	return undefined
}

export async function checkSystemPath(binName: string): Promise<string | undefined> {
	// Try to find rg in system PATH using which/where
	const command = process.platform === "win32" ? "where" : "which"
	try {
		const result = execSync(`${command} ${binName}`, {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()
		// which/where may return multiple lines on Windows, take the first
		const firstPath = result.split("\n")[0].trim()
		if (firstPath && (await fileExistsAtPath(firstPath))) {
			return firstPath
		}
	} catch {
		// Command failed, binary not in PATH
	}
	return undefined
}
