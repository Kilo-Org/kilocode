#!/usr/bin/env node

/**
 * VS Code theme extraction using Playwright
 * Extracts comprehensive CSS variables from running VS Code instance
 * Replaces the old theme generation script with complete variable extraction
 */

import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PLAYWRIGHT_E2E_DIR = path.resolve(__dirname, "..")
const STORYBOOK_OUTPUT_DIR = path.resolve(__dirname, "../../storybook/generated-theme-styles")

async function extractThemeVariables() {
	console.log("🎨 Extracting VS Code themes using Playwright...\n")

	try {
		// Run the Playwright extraction test
		console.log("🚀 Running Playwright CSS extraction...")
		const playwrightCommand = `cd "${PLAYWRIGHT_E2E_DIR}" && npx playwright test --config=scripts/theme-extraction.config.ts --reporter=line`
		execSync(playwrightCommand, { stdio: "inherit", cwd: PLAYWRIGHT_E2E_DIR })

		// Verify the files were created directly in the storybook directory
		const darkOutputPath = path.join(STORYBOOK_OUTPUT_DIR, "dark-modern.css")
		const lightOutputPath = path.join(STORYBOOK_OUTPUT_DIR, "light-modern.css")

		if (!fs.existsSync(darkOutputPath) || !fs.existsSync(lightOutputPath)) {
			throw new Error("Playwright extraction failed - CSS files not found in storybook directory")
		}

		console.log(`✅ Generated dark-modern.css`)
		console.log(`✅ Generated light-modern.css`)
		console.log(`\n🎉 Theme extraction complete! Files saved to ${STORYBOOK_OUTPUT_DIR}`)
	} catch (error) {
		console.error("❌ Theme extraction failed:", error.message)
		process.exit(1)
	}
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	extractThemeVariables().catch((error) => {
		console.error("Fatal error:", error)
		process.exit(1)
	})
}

export { extractThemeVariables }
