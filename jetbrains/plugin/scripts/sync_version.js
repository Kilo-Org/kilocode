#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Sync version from src/package.json to jetbrains/plugin/gradle.properties
 */
function syncVersion() {
	try {
		// Read version from src/package.json
		const srcPackageJsonPath = join(__dirname, "../../../src/package.json")
		const srcPackageJson = JSON.parse(readFileSync(srcPackageJsonPath, "utf8"))
		const version = srcPackageJson.version

		if (!version) {
			throw new Error("Version not found in src/package.json")
		}

		console.log(`Found version: ${version}`)

		// Read gradle.properties.template
		const gradlePropertiesTemplatePath = join(__dirname, "../gradle.properties.template")
		const gradlePropertiesTemplateContent = readFileSync(gradlePropertiesTemplatePath, "utf8")

		// Replace {{VERSION}} placeholder with actual version
		const updatedContent = gradlePropertiesTemplateContent.replace(/\{\{VERSION\}\}/g, version)

		// Write updated gradle.properties
		const gradlePropertiesPath = join(__dirname, "../gradle.properties")
		writeFileSync(gradlePropertiesPath, updatedContent, "utf8")

		console.log(`✅ Successfully updated pluginVersion to ${version} in gradle.properties from template`)
	} catch (error) {
		console.error("❌ Error syncing version:", error.message)
		process.exit(1)
	}
}

// Run the sync if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	syncVersion()
}

export default syncVersion
