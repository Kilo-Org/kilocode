#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Update change-notes in plugin.xml based on version from gradle.properties and CHANGELOG.md
 */
function updateChangeNotes() {
	try {
		// Read version from gradle.properties
		const gradlePropertiesPath = join(__dirname, "../gradle.properties")
		const gradlePropertiesContent = readFileSync(gradlePropertiesPath, "utf8")

		const gradleVersionMatch = gradlePropertiesContent.match(/^pluginVersion=(.+)$/m)
		if (!gradleVersionMatch) {
			throw new Error("pluginVersion not found in gradle.properties")
		}

		const version = gradleVersionMatch[1].trim()
		console.log(`Found plugin version: ${version}`)

		// Read CHANGELOG.md
		const changelogPath = join(__dirname, "../../../CHANGELOG.md")
		const changelogContent = readFileSync(changelogPath, "utf8")

		// Find the version section in changelog
		// Support multiple formats: ## [vX.X.X], ## [X.X.X], ## X.X.X
		const escapedVersion = version.replaceAll(".", "\\.")
		const versionPattern = new RegExp(`## \\[?v?${escapedVersion}\\]?([\\s\\S]*?)(?=## \\[?v?\\d|$)`)
		const changelogVersionMatch = changelogContent.match(versionPattern)

		if (!changelogVersionMatch) {
			throw new Error(`Version ${version} not found in CHANGELOG.md`)
		}

		const changelogSection = changelogVersionMatch[1].trim()
		console.log(`Found changelog section for version ${version}`)

		// Convert markdown to HTML format suitable for plugin.xml
		const changeNotesHtml = convertMarkdownToHtml(changelogSection, version)

		// Read plugin.xml.template
		const pluginXmlTemplatePath = join(__dirname, "../src/main/resources/META-INF/plugin.xml.template")
		const pluginXmlTemplateContent = readFileSync(pluginXmlTemplatePath, "utf8")

		// Replace {{CHANGE_NOTES}} placeholder with generated HTML
		const updatedPluginXml = pluginXmlTemplateContent.replace(/\{\{CHANGE_NOTES\}\}/g, changeNotesHtml)

		// Write updated plugin.xml
		const pluginXmlPath = join(__dirname, "../src/main/resources/META-INF/plugin.xml")
		writeFileSync(pluginXmlPath, updatedPluginXml, "utf8")

		console.log(`✅ Successfully updated change-notes for version ${version} in plugin.xml`)
	} catch (error) {
		console.error("❌ Error updating change-notes:", error.message)
		process.exit(1)
	}
}

/**
 * Convert markdown changelog to HTML format suitable for plugin.xml
 */
function convertMarkdownToHtml(markdown, version) {
	let html = `        <h3>Version ${version}</h3>\n        <ul>`

	// Split into lines and process
	const lines = markdown.split("\n").filter((line) => line.trim())

	for (const line of lines) {
		const trimmedLine = line.trim()

		// Skip empty lines and section headers
		if (!trimmedLine || trimmedLine.startsWith("##") || trimmedLine.startsWith("###")) {
			continue
		}

		// Handle main bullet points (features/changes)
		if (trimmedLine.startsWith("- ")) {
			const content = trimmedLine.substring(2).trim()
			const cleanContent = cleanMarkdownContent(content)

			if (cleanContent) {
				html += `\n            <li>${escapeHtml(cleanContent)}</li>`
			}
		}

		// Handle sub-bullet points (patch changes, etc.)
		else if (trimmedLine.match(/^\s*-\s/)) {
			const content = trimmedLine.replace(/^\s*-\s/, "").trim()
			const cleanContent = cleanMarkdownContent(content)

			if (cleanContent) {
				html += `\n            <li>${escapeHtml(cleanContent)}</li>`
			}
		}
	}

	html += "\n        </ul>"
	return html
}

/**
 * Clean markdown content by removing links, PR references, and contributor mentions
 */
function cleanMarkdownContent(content) {
	return (
		content
			// Remove PR links like [#2012](https://github.com/...)
			.replace(/\[#\d+\]\([^)]+\)\s*/g, "")
			// Remove commit hash links like [`1fd698a`](https://github.com/...)
			.replace(/\[`[^`]+`\]\([^)]+\)\s*/g, "")
			// Remove GitHub user links like [@catrielmuller](https://github.com/catrielmuller)
			.replace(/\[@[^\]]+\]\([^)]+\)\s*/g, "")
			// Remove "Thanks @username!" mentions at the beginning
			.replace(/^Thanks\s+@[^!]+!\s*-?\s*/g, "")
			// Remove "Thanks @username!" mentions anywhere
			.replace(/Thanks\s+@[^!]+!\s*-?\s*/g, "")
			// Remove "Thanks @username" mentions (without exclamation)
			.replace(/Thanks\s+@[^,)]+[,)]\s*/g, "")
			// Remove standalone contributor mentions like "(thanks @username!)"
			.replace(/\(thanks\s+@[^)]+\)\s*/g, "")
			// Remove leftover "Thanks !" patterns
			.replace(/Thanks\s*!\s*-?\s*/g, "")
			// Remove leading dashes and spaces
			.replace(/^[-\s]+/g, "")
			// Clean up multiple spaces
			.replace(/\s+/g, " ")
			.trim()
	)
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
}

// Run the update if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	updateChangeNotes()
}

export default updateChangeNotes
