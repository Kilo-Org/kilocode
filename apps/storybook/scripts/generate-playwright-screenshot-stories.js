#!/usr/bin/env node

import { readdir, readFile, writeFile, mkdir, copyFile } from "fs/promises"
import { join, basename } from "path"
import { fileURLToPath } from "url"
import { camelCase } from "lodash"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const playwrightDir = join(__dirname, "../../playwright-e2e")
const storiesDir = join(__dirname, "../stories/generated")
const testResultsDir = join(playwrightDir, "test-results")

async function findPlaywrightScreenshots() {
	console.log("🔍 Finding Playwright screenshots in test results...")
	const screenshots = []

	try {
		const testDirs = await readdir(testResultsDir)

		for (const testDir of testDirs) {
			const testPath = join(testResultsDir, testDir)
			try {
				const files = await readdir(testPath)
				for (const file of files) {
					if (isScreenshotFile(file)) {
						const screenshotInfo = parseScreenshotName(file)
						screenshots.push({
							path: join(testPath, file),
							fileName: file,
							...screenshotInfo,
						})
					}
				}
			} catch (err) {
				// Skip directories that can't be read
				continue
			}
		}
	} catch (error) {
		console.error("❌ Error finding screenshots:", error)
		return []
	}

	console.log(`📸 Found ${screenshots.length} Playwright screenshots`)
	return screenshots
}

function isScreenshotFile(filename) {
	return (
		filename.endsWith(".png") &&
		(filename.includes("__") || filename.endsWith("-actual.png") || filename.endsWith("-expected.png"))
	)
}

function parseScreenshotName(filename) {
	// Remove file extension
	let name = basename(filename, ".png")

	// Handle new hierarchical format: TestSuite__TestName__ScreenshotName
	if (name.includes("__")) {
		const parts = name.split("__")
		if (parts.length >= 3) {
			return {
				testSuite: camelCase(parts[0]),
				testName: camelCase(parts[1]),
				screenshotName: camelCase(parts.slice(2).join("__")),
				hierarchical: true,
			}
		}
	}

	// Fallback for legacy format
	return {
		testSuite: "Legacy Tests",
		testName: "Unknown Test",
		screenshotName: camelCase(name.replace(/-actual$|-expected$/, "")),
		hierarchical: false,
	}
}

async function generateScreenshotStories(screenshots) {
	console.log("📝 Generating Storybook stories from Playwright screenshots...")

	await mkdir(storiesDir, { recursive: true })

	// Group screenshots by test suite for better organization
	const groupedScreenshots = groupScreenshotsByTestSuite(screenshots)

	for (const [testSuite, suiteScreenshots] of Object.entries(groupedScreenshots)) {
		const storyContent = createStoryContent(testSuite, suiteScreenshots)
		const storyFileName = `${sanitizeFileName(testSuite)}.stories.tsx`
		const storyPath = join(storiesDir, storyFileName)

		await writeFile(storyPath, storyContent)
		console.log(`✅ Generated story: ${storyFileName}`)
	}
}

function groupScreenshotsByTestSuite(screenshots) {
	return screenshots.reduce((acc, screenshot) => {
		const key = screenshot.testSuite
		if (!acc[key]) acc[key] = []
		acc[key].push(screenshot)
		return acc
	}, {})
}

function sanitizeFileName(name) {
	return name
		.replace(/[^a-zA-Z0-9\s]/g, "")
		.replace(/\s+/g, "")
		.replace(/^./, (str) => str.toLowerCase())
}

function createStoryContent(testSuite, screenshots) {
	// Group screenshots by test name within the suite
	const testGroups = screenshots.reduce((acc, screenshot) => {
		const key = screenshot.testName
		if (!acc[key]) acc[key] = []
		acc[key].push(screenshot)
		return acc
	}, {})

	const storyExports = []
	let storyIndex = 1

	for (const [testName, testScreenshots] of Object.entries(testGroups)) {
		for (const screenshot of testScreenshots) {
			const storyName = `${testName} - ${screenshot.screenshotName}`
			const exportName = `Story${storyIndex}`

			storyExports.push(createScreenshotStory(exportName, storyName, screenshot, testSuite))
			storyIndex++
		}
	}

	return `import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta = {
  title: 'E2E Screenshots/${testSuite}',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Screenshots captured from Playwright E2E tests for visual regression testing.',
      },
    },
    // Disable Chromatic snapshots for screenshot stories to avoid recursion
    chromatic: { disableSnapshot: false },
    // Disable automatic multi-mode snapshotting for screenshot stories
    disableChromaticDualThemeSnapshot: true,
  },
}

export default meta
type Story = StoryObj<typeof meta>

${storyExports.join("\n\n")}
`
}

function createScreenshotStory(exportName, storyName, screenshot, testSuite) {
	return `export const ${exportName} = {
  name: '${storyName}',
  render: () => (
    <div className="size-full">
      <img
          src="/screenshots/${screenshot.fileName}"
          alt="${storyName}"
          className="max-w-full h-auto"
          style={{ maxHeight: '80vh' }}
        />
    </div>
  ),
}`
}

async function copyScreenshotsToStorybook(screenshots) {
	console.log("📋 Copying screenshots to Storybook static directory...")
	const staticDir = join(__dirname, "../public/screenshots")
	await mkdir(staticDir, { recursive: true })

	for (const screenshot of screenshots) {
		const destPath = join(staticDir, screenshot.fileName)
		await copyFile(screenshot.path, destPath)
		console.log(`  ✅ Copied: ${screenshot.fileName}`)
	}
}

async function main() {
	try {
		console.log("🚀 Starting Playwright screenshot-to-story generation...")
		const screenshots = await findPlaywrightScreenshots()

		if (screenshots.length === 0) {
			console.log(
				"⚠️ No Playwright screenshots found. Make sure Playwright tests have run and captured screenshots.",
			)
			return
		}

		await copyScreenshotsToStorybook(screenshots)
		await generateScreenshotStories(screenshots)

		console.log("✅ Playwright screenshot-to-story generation completed successfully!")

		// Log summary of what was generated
		const suites = [...new Set(screenshots.map((s) => s.testSuite))]
		console.log(`📊 Generated stories for ${suites.length} test suite(s): ${suites.join(", ")}`)
	} catch (error) {
		console.error("❌ Error in Playwright screenshot-to-story generation:", error)
		process.exit(1)
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main()
}
