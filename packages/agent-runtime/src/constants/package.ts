// Package constants - version is read from package.json at runtime
import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

function getPackageVersion(): string {
	try {
		// Navigate up from dist/ to package root
		const currentDir = dirname(fileURLToPath(import.meta.url))
		// Try multiple possible locations
		const possiblePaths = [
			join(currentDir, "..", "..", "package.json"), // from dist/constants/
			join(currentDir, "..", "package.json"), // from dist/
			join(currentDir, "package.json"), // from package root
		]

		for (const packagePath of possiblePaths) {
			try {
				const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"))
				if (packageJson.version) {
					return packageJson.version
				}
			} catch {
				// Try next path
			}
		}
	} catch {
		// Fall through to default
	}
	return "0.0.0"
}

export const Package = {
	name: "@kilocode/agent-runtime",
	version: getPackageVersion(),
}
