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
