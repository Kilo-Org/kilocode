#!/usr/bin/env node

/**
 * Set rollback version automatically
 *
 * Usage: node set-rollback-version.js <source-tag>
 * Example: node set-rollback-version.js v4.115.0
 *
 * This script:
 * 1. Gets the current version from main branch
 * 2. Calculates the next appropriate rollback version
 * 3. Updates src/package.json with the new version
 * 4. Outputs the new version to stdout for the workflow
 */

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

function parseVersion(version) {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
	if (!match) {
		throw new Error(`Invalid version format: ${version}`)
	}
	return {
		major: parseInt(match[1]),
		minor: parseInt(match[2]),
		patch: parseInt(match[3]),
		prerelease: match[4] || null,
	}
}

function calculateRollbackVersion(mainVersion) {
	const current = parseVersion(mainVersion)

	// Calculate next version: increment patch and add -fix suffix
	// If current version already has -fix, increment the number
	let fixNumber = 1
	if (current.prerelease && current.prerelease.startsWith("fix")) {
		const fixMatch = current.prerelease.match(/^fix(\d*)$/)
		if (fixMatch) {
			fixNumber = fixMatch[1] ? parseInt(fixMatch[1]) + 1 : 2
		} else {
			// Unknown prerelease format, just increment patch
			current.patch++
		}
	} else if (current.prerelease) {
		// Has other prerelease, increment patch
		current.patch++
	} else {
		// No prerelease, increment patch
		current.patch++
	}

	return `${current.major}.${current.minor}.${current.patch}-fix${fixNumber > 1 ? fixNumber : ""}`
}

function setRollbackVersion(sourceTag) {
	try {
		// Get current version from main branch
		const mainPackageJson = execSync("git show origin/main:src/package.json", { encoding: "utf-8" })
		const mainVersion = JSON.parse(mainPackageJson).version

		console.error(`Current version on main: ${mainVersion}`)
		console.error(`Rolling back from source: ${sourceTag}`)

		// Calculate new rollback version
		const newVersion = calculateRollbackVersion(mainVersion)

		console.error(`Calculated rollback version: ${newVersion}`)
		console.error("")
		console.error("SemVer ordering:")
		const parsed = parseVersion(newVersion)
		console.error(`  ${mainVersion} < ${newVersion} < ${parsed.major}.${parsed.minor}.${parsed.patch}`)
		console.error("")

		// Update package.json
		const packageJsonPath = path.join(process.cwd(), "src", "package.json")
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
		packageJson.version = newVersion
		fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, "\t") + "\n")

		console.error(`✅ Updated src/package.json to version ${newVersion}`)

		// Output the version to stdout (for the workflow to capture if needed)
		console.log(newVersion)
	} catch (error) {
		console.error(`❌ Error: ${error.message}`)
		process.exit(1)
	}
}

// Main execution
if (require.main === module) {
	const sourceTag = process.argv[2]

	if (!sourceTag) {
		console.error("Usage: node set-rollback-version.js <source-tag>")
		console.error("Example: node set-rollback-version.js v4.115.0")
		process.exit(1)
	}

	setRollbackVersion(sourceTag)
}

module.exports = { setRollbackVersion, calculateRollbackVersion, parseVersion }
