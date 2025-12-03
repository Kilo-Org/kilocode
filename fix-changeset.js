#!/usr/bin/env node

const fs = require("fs")
const path = require("path")

// Simple script to manually process changesets and update versions
// This bypasses the GitHub API requirement

function getWorkspacePackages() {
	const packages = {}

	// Read main package.json
	const mainPackage = JSON.parse(fs.readFileSync("package.json", "utf8"))
	packages["kilo-code"] = mainPackage

	// Read cli package.json
	const cliPackage = JSON.parse(fs.readFileSync("cli/package.json", "utf8"))
	packages["@involvex/kilocode-cli"] = cliPackage

	return packages
}

function readChangesets() {
	const changesetDir = ".changeset"
	const files = fs
		.readdirSync(changesetDir)
		.filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "config.json")

	const changesets = []
	for (const file of files) {
		const content = fs.readFileSync(path.join(changesetDir, file), "utf8")
		const lines = content
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l)

		// Parse the frontmatter
		const frontmatterStart = lines.findIndex((l) => l === "---")
		const frontmatterEnd = lines.findIndex((l, i) => i > frontmatterStart && l === "---")

		if (frontmatterStart !== -1 && frontmatterEnd !== -1) {
			const frontmatter = lines.slice(frontmatterStart + 1, frontmatterEnd)
			const packages = {}

			for (const line of frontmatter) {
				if (line.includes(":")) {
					const [pkg, version] = line.split(":").map((s) => s.trim().replace(/"/g, ""))
					packages[pkg] = version
				}
			}

			const description = lines
				.slice(frontmatterEnd + 1)
				.join(" ")
				.trim()

			changesets.push({
				file,
				packages,
				description,
				hasChanges: Object.keys(packages).length > 0,
			})
		}
	}

	return changesets
}

function updatePackageVersions(packages, changesets) {
	const updated = {}

	for (const changeset of changesets) {
		if (!changeset.hasChanges) continue

		for (const [pkgName, changeType] of Object.entries(changeset.packages)) {
			if (!packages[pkgName]) {
				console.warn(`Warning: Package ${pkgName} not found in workspace`)
				continue
			}

			const pkg = packages[pkgName]
			const currentVersion = pkg.version
			const [major, minor, patch] = currentVersion.split(".").map(Number)

			let newVersion
			switch (changeType) {
				case "major":
					newVersion = `${major + 1}.0.0`
					break
				case "minor":
					newVersion = `${major}.${minor + 1}.0`
					break
				case "patch":
				default:
					newVersion = `${major}.${minor}.${patch + 1}`
					break
			}

			pkg.version = newVersion
			updated[pkgName] = {
				from: currentVersion,
				to: newVersion,
				changeType,
			}

			console.log(`Updated ${pkgName}: ${currentVersion} → ${newVersion} (${changeType})`)
		}
	}

	return updated
}

function writeUpdatedPackages(packages, updated) {
	for (const [pkgName, pkg] of Object.entries(packages)) {
		if (updated[pkgName]) {
			const filePath =
				pkgName === "kilo-code" ? "package.json" : `${pkgName.replace("@involvex/", "")}/package.json`
			fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + "\n")
		}
	}
}

function main() {
	console.log("Processing changesets manually...")

	const packages = getWorkspacePackages()
	const changesets = readChangesets()

	console.log(`Found ${changesets.length} changeset files`)

	const updated = updatePackageVersions(packages, changesets)

	if (Object.keys(updated).length > 0) {
		writeUpdatedPackages(packages, updated)
		console.log("\nUpdated package versions successfully!")

		// Clean up processed changesets
		for (const changeset of changesets) {
			if (changeset.hasChanges) {
				fs.unlinkSync(path.join(".changeset", changeset.file))
				console.log(`Removed processed changeset: ${changeset.file}`)
			}
		}
	} else {
		console.log("No changes to apply.")
	}
}

if (require.main === module) {
	main()
}

module.exports = { main }
