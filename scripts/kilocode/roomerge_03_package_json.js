#!/usr/bin/env node

/**
 * This script resolves merge conflicts in package.json, specifically for
 * publisher, version, and icon fields, always keeping the HEAD version.
 * It only resolves conflicts if these three fields are the only fields
 * with conflicts in package.json.
 */

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

// Constants
const PACKAGE_JSON_PATH = path.join(process.cwd(), "src/package.json")

// Helper functions
function isGitRepository() {
	try {
		execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" })
		return true
	} catch (error) {
		return false
	}
}

function getConflictedFiles() {
	try {
		const output = execSync("git diff --name-only --diff-filter=U", { encoding: "utf8" })
		return output
			.trim()
			.split("\n")
			.filter((line) => line.trim() !== "")
	} catch (error) {
		return []
	}
}

// Main function
function main() {
	// Check if we're in a git repository
	if (!isGitRepository()) {
		console.error("Error: Not in a git repository")
		process.exit(1)
	}

	// Check if package.json exists
	if (!fs.existsSync(PACKAGE_JSON_PATH)) {
		console.error("Error: src/package.json not found")
		process.exit(1)
	}

	// Get list of files with merge conflicts
	const conflictedFiles = getConflictedFiles()

	// Check if package.json has conflicts
	const packageJsonRelativePath = "src/package.json"
	if (!conflictedFiles.includes(packageJsonRelativePath)) {
		console.log("No merge conflicts found in package.json")
		process.exit(0)
	}

	// Read the package.json file with conflicts
	const content = fs.readFileSync(PACKAGE_JSON_PATH, "utf8")

	// Check if the content has merge conflicts
	if (!content.includes("<<<<<<< HEAD")) {
		console.log("No merge conflicts found in package.json content")
		process.exit(0)
	}

	// Split the content by lines
	const lines = content.split("\n")

	// Find all conflict blocks
	const conflictBlocks = []
	let currentBlock = null

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		if (line.includes("<<<<<<< HEAD")) {
			currentBlock = {
				start: i,
				separator: -1,
				end: -1,
				content: [line],
			}
		} else if (currentBlock && line.includes("=======")) {
			currentBlock.separator = i
			currentBlock.content.push(line)
		} else if (currentBlock && line.includes(">>>>>>>")) {
			currentBlock.end = i
			currentBlock.content.push(line)
			conflictBlocks.push(currentBlock)
			currentBlock = null
		} else if (currentBlock) {
			currentBlock.content.push(line)
		}
	}

	// Check if we found any conflict blocks
	if (conflictBlocks.length === 0) {
		console.error("Could not find any conflict blocks")
		process.exit(1)
	}

	// Check if there's only one conflict block
	if (conflictBlocks.length > 1) {
		console.error("Multiple conflict blocks found in package.json")
		console.error("This script only handles a single conflict block with publisher, version, and icon fields")
		process.exit(1)
	}

	// Get the single conflict block
	const block = conflictBlocks[0]
	const blockContent = block.content.join("\n")

	// Check if the conflict block contains our target fields
	if (
		!blockContent.includes('"publisher"') ||
		!blockContent.includes('"version"') ||
		!blockContent.includes('"icon"')
	) {
		console.error("Conflict block doesn't contain all target fields (publisher, version, icon)")
		console.error("Manual resolution required.")
		process.exit(1)
	}

	// Check if the conflict block contains ONLY our target fields
	// Extract the HEAD section (between start+1 and separator)
	const headSection = lines.slice(block.start + 1, block.separator)

	// Check if the HEAD section contains only publisher, version, and icon fields
	const fieldPattern = /^\s*"([^"]+)":/
	const fieldsInHead = headSection
		.map((line) => {
			const match = line.match(fieldPattern)
			return match ? match[1] : null
		})
		.filter((field) => field !== null)

	// Check if the fields are exactly publisher, version, and icon
	const expectedFields = ["publisher", "version", "icon"]
	const hasOnlyExpectedFields =
		fieldsInHead.length === expectedFields.length && expectedFields.every((field) => fieldsInHead.includes(field))

	if (!hasOnlyExpectedFields) {
		console.error("Conflict block contains fields other than publisher, version, and icon")
		console.error("Fields found:", fieldsInHead.join(", "))
		console.error("Manual resolution required.")
		process.exit(1)
	}

	console.log("Resolving conflicts in package.json...")

	// Extract the HEAD version (lines between start+1 and separator)
	const headLines = lines.slice(block.start + 1, block.separator)

	// Create the new content by replacing the conflict block with the HEAD version
	const newLines = [...lines.slice(0, block.start), ...headLines, ...lines.slice(block.end + 1)]

	// Write the new content back to the file
	fs.writeFileSync(PACKAGE_JSON_PATH, newLines.join("\n"))

	console.log("Successfully resolved conflicts in package.json, keeping the HEAD version for:")
	console.log("- publisher")
	console.log("- version")
	console.log("- icon")

	// Stage the changes
	try {
		execSync(`git add ${PACKAGE_JSON_PATH}`, { stdio: "ignore" })
		console.log("Changes staged. You can now continue with your merge.")
	} catch (error) {
		console.error("Failed to stage changes:", error.message)
		console.log("Please review and stage the changes manually if satisfied.")
	}
}

// Run the main function
main().catch((error) => {
	console.error("Error:", error)
	process.exit(1)
})
