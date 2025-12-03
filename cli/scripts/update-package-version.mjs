#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, renameSync } from "fs"
import { execSync } from "child_process"
import { resolve } from "path"

// Read version from package.json
function getPackageVersion() {
	const packagePath = resolve(process.cwd(), "package.json")
	if (!existsSync(packagePath)) {
		throw new Error("package.json not found")
	}

	const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))
	return packageJson.version
}

// Update version in package.dist.json
function updatePackageDistVersion(newVersion) {
	const distPath = resolve(process.cwd(), "package.dist.json")
	if (!existsSync(distPath)) {
		throw new Error("package.dist.json not found")
	}

	const distJson = JSON.parse(readFileSync(distPath, "utf8"))
	distJson.version = newVersion

	// Write to temp file first with unique name
	const tempPath = resolve(process.cwd(), `tmp-${Date.now()}.json`)
	writeFileSync(tempPath, JSON.stringify(distJson, null, 2))

	// Move temp file to final location using Node.js
	renameSync(tempPath, distPath)

	// Format with prettier
	execSync("prettier --write package.dist.json")
}

try {
	const version = getPackageVersion()
	console.log(`Updating package.dist.json with version: ${version}`)
	updatePackageDistVersion(version)
	console.log("Successfully updated package.dist.json")
} catch (error) {
	console.error("Error updating package version:", error.message)
	process.exit(1)
}
