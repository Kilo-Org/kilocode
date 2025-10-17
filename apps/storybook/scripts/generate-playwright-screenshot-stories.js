#!/usr/bin/env node

import { readdir, writeFile, mkdir, copyFile } from "fs/promises"
import { join, basename } from "path"
import { fileURLToPath } from "url"
import { camelCase } from "change-case"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const playwrightDir = join(__dirname, "../../playwright-e2e")
const storiesDir = join(__dirname, "../stories/generated")
const testResultsDir = join(playwrightDir, "test-results")

const cleanTestName = (name) => camelCase(name)
const isScreenshotFile = (filename) => filename.endsWith(".png")

const parseScreenshotName = (filename) => {
	const name = basename(filename, ".png")

	if (name.includes("__")) {
		const parts = name.split("__")
		if (parts.length >= 3) {
			return {
				testSuite: camelCase(parts[0]),
				testName: cleanTestName(parts[1]),
				screenshotName: camelCase(parts.slice(2).join("__")),
				hierarchical: true,
			}
		}
	}

	return {
		testSuite: "Playwright Screenshots",
		testName: "Snapshot Test",
		screenshotName: camelCase(name),
		hierarchical: false,
	}
}

const findPlaywrightScreenshots = async () => {
	console.log("🔍 Finding Playwright screenshots in test results...")

	try {
		const testDirs = await readdir(testResultsDir)
		const screenshots = []

		await Promise.all(
			testDirs.map(async (testDir) => {
				try {
					const files = await readdir(join(testResultsDir, testDir))
					files.filter(isScreenshotFile).forEach((file) => {
						screenshots.push({
							path: join(testResultsDir, testDir, file),
							fileName: file,
							...parseScreenshotName(file),
						})
					})
				} catch {
					// Skip directories that can't be read
				}
			}),
		)

		console.log(`📸 Found ${screenshots.length} Playwright screenshots`)
		return screenshots
	} catch (error) {
		console.error("❌ Error finding screenshots:", error)
		return []
	}
}

const createStoryContent = (testSuite, screenshots) => {
	const groupedByTest = screenshots.reduce((acc, screenshot) => {
		const key = cleanTestName(screenshot.testName)
		if (!acc[key]) acc[key] = []
		acc[key].push(screenshot)
		return acc
	}, {})

	let storyIndex = 1
	const storyExports = []

	Object.entries(groupedByTest).forEach(([testName, testScreenshots]) => {
		testScreenshots.forEach((screenshot) => {
			const storyName = `${testName} - ${screenshot.screenshotName}`
			storyExports.push(`export const Story${storyIndex} = {
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
}`)
			storyIndex++
		})
	})

	return `import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta = {
  title: 'Playwight Screenshots/${testSuite}',
  parameters: {
    layout: 'fullscreen',
    disableChromaticDualThemeSnapshot: true,
  },
}

export default meta
type Story = StoryObj<typeof meta>

${storyExports.join("\n\n")}
`
}

const sanitizeFileName = (name) =>
	name
		.replace(/[^a-zA-Z0-9\s]/g, "")
		.replace(/\s+/g, "")
		.replace(/^./, (str) => str.toLowerCase())

const generateScreenshotStories = async (screenshots) => {
	console.log(`📝 Generating stories for ${screenshots.length} screenshots...`)
	await mkdir(storiesDir, { recursive: true })

	const groupedByTestSuite = screenshots.reduce((acc, screenshot) => {
		if (!acc[screenshot.testSuite]) acc[screenshot.testSuite] = []
		acc[screenshot.testSuite].push(screenshot)
		return acc
	}, {})

	await Promise.all(
		Object.entries(groupedByTestSuite).map(async ([testSuite, suiteScreenshots]) => {
			console.log(`📁 Processing ${testSuite}: ${suiteScreenshots.length} screenshots...`)

			const storyContent = createStoryContent(testSuite, suiteScreenshots)
			const storyFileName = `${sanitizeFileName(testSuite)}.stories.tsx`

			await writeFile(join(storiesDir, storyFileName), storyContent)
			console.log(`✅ Generated: ${storyFileName}`)
		}),
	)
}

const copyScreenshotsToStorybook = async (screenshots) => {
	console.log("📋 Copying screenshots to Storybook...")
	const staticDir = join(__dirname, "../public/screenshots")
	await mkdir(staticDir, { recursive: true })

	await Promise.all(
		screenshots.map(async (screenshot) => {
			await copyFile(screenshot.path, join(staticDir, screenshot.fileName))
		}),
	)
	console.log(`✅ Copied ${screenshots.length} screenshots`)
}

const main = async () => {
	try {
		console.log("🚀 Starting Playwright screenshot-to-story generation...")
		const screenshots = await findPlaywrightScreenshots()

		if (screenshots.length === 0) {
			console.log("⚠️ No screenshots found. Run Playwright tests first.")
			return
		}

		await Promise.all([copyScreenshotsToStorybook(screenshots), generateScreenshotStories(screenshots)])

		const suites = [...new Set(screenshots.map((s) => s.testSuite))]
		console.log(`✅ Generated stories for ${suites.length} test suite(s): ${suites.join(", ")}`)
	} catch (error) {
		console.error("❌ Error:", error)
		process.exit(1)
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main()
}
