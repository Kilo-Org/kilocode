// kilocode_change - new file
import { test as base, type Page, _electron } from "@playwright/test"
export { expect } from "@playwright/test"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import { fileURLToPath } from "url"
import { camelCase } from "change-case"
import { setupConsoleLogging, cleanLogMessage } from "../helpers/console-logging"
import { closeAllTabs, executeVSCodeCommand, freezeGifs, waitForDOMStability } from "../helpers"

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export type TestOptions = {
	vscodeVersion: string
}

export type TestFixtures = TestOptions & {
	workbox: Page
	createProject: () => Promise<string>
	createTempDir: () => Promise<string>
	takeScreenshot: (name?: string) => Promise<void>
}

export const test = base.extend<TestFixtures>({
	vscodeVersion: ["stable", { option: true }],

	workbox: async ({ createProject, createTempDir }, use) => {
		// Fail early if OPENROUTER_API_KEY is not set
		if (!process.env.OPENROUTER_API_KEY) {
			throw new Error("OPENROUTER_API_KEY environment variable is required for Playwright tests")
		}

		const defaultCachePath = await createTempDir()
		const userDataDir = path.join(defaultCachePath, "user-data")
		seedUserSettings(userDataDir)

		// Use the pre-downloaded VS Code from global setup
		const vscodePath = process.env.VSCODE_EXECUTABLE_PATH
		if (!vscodePath) {
			throw new Error("VSCODE_EXECUTABLE_PATH not found. Make sure global setup ran successfully.")
		}

		const electronApp = await _electron.launch({
			executablePath: vscodePath,
			env: {
				...process.env,
				VSCODE_SKIP_GETTING_STARTED: "1",
				VSCODE_DISABLE_WORKSPACE_TRUST: "1",
				ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
			},
			args: [
				"--no-sandbox",
				"--disable-gpu-sandbox",
				"--disable-gpu",
				"--disable-dev-shm-usage",
				"--disable-setuid-sandbox",
				"--disable-renderer-backgrounding",
				"--disable-ipc-flooding-protection",
				"--disable-web-security",
				"--disable-updates",
				"--skip-welcome",
				"--skip-release-notes",
				"--skip-getting-started",
				"--disable-workspace-trust",
				"--disable-telemetry",
				"--disable-crash-reporter",
				"--enable-logging",
				"--log-level=0",
				"--disable-extensions-except=kilocode.kilo-code",
				"--disable-extension-recommendations",
				"--disable-extension-update-check",
				"--disable-default-apps",
				"--disable-background-timer-throttling",
				"--disable-renderer-backgrounding",
				"--disable-component-extensions-with-background-pages",
				`--extensionDevelopmentPath=${path.resolve(__dirname, "..", "..", "..", "src")}`,
				`--extensions-dir=${path.join(defaultCachePath, "extensions")}`,
				`--user-data-dir=${userDataDir}`,
				"--enable-proposed-api=kilocode.kilo-code",
				await createProject(),
			],
		})

		const workbox = await electronApp.firstWindow()

		// Setup pass-through logs for the core process and the webview
		if (process.env.PLAYWRIGHT_VERBOSE_LOGS === "true") {
			electronApp.process().stdout?.on("data", (data) => {
				const output = data.toString().trim()
				const cleaned = cleanLogMessage(output)
				if (cleaned) {
					console.log(`📋 [VSCode] ${cleaned}`)
				}
			})

			electronApp.process().stderr?.on("data", (data) => {
				const output = data.toString().trim()
				const cleaned = cleanLogMessage(output)
				if (cleaned) {
					// Determine severity based on content
					const isError = output.toLowerCase().includes("error") || output.toLowerCase().includes("failed")
					const icon = isError ? "❌" : "⚠️"
					console.log(`${icon} [VSCode] ${cleaned}`)
				}
			})

			// Set up comprehensive console logging for the main workbox window
			setupConsoleLogging(workbox, "WORKBOX")

			// Set up logging for any new windows/webviews that get created
			electronApp.on("window", (newWindow) => {
				console.log(`🪟 [VSCode] New window created: ${newWindow.url()}`)
				setupConsoleLogging(newWindow, "WEBVIEW")
			})
		}

		await workbox.waitForLoadState("domcontentloaded")
		await workbox.waitForSelector(".monaco-workbench")
		console.log("✅ VS Code workbox ready for testing")

		await use(workbox)
		await electronApp.close()

		try {
			const logPath = path.join(defaultCachePath, "user-data")
			const logOutputPath = test.info().outputPath("vscode-logs")
			await fs.promises.cp(logPath, logOutputPath, { recursive: true })
		} catch (error) {
			console.warn(`Failed to copy VSCode logs: ${error.message}`)
		}
	},

	createProject: async ({ createTempDir }, use) => {
		await use(async () => {
			const projectPath = await createTempDir()
			if (fs.existsSync(projectPath)) await fs.promises.rm(projectPath, { recursive: true })

			console.log(`Creating test project in ${projectPath}`)
			await fs.promises.mkdir(projectPath)

			const packageJson = {
				name: "test-project",
				version: "1.0.0",
			}

			await fs.promises.writeFile(path.join(projectPath, "package.json"), JSON.stringify(packageJson, null, 2))

			return projectPath
		})
	},

	// eslint-disable-next-line no-empty-pattern
	createTempDir: async ({}, use) => {
		const tempDirs: string[] = []
		let counter = 0

		await use(async () => {
			const testInfo = test.info()
			const fileName = testInfo.file.split("/").pop()?.replace(".test.ts", "") || "unknown"
			const sanitizedTestName = camelCase(testInfo.title)

			const dirName = `e2e-${fileName}-${sanitizedTestName}-${counter++}`
			const tempDirPath = path.join(os.tmpdir(), dirName)

			// Clean up any existing directory first
			try {
				await fs.promises.rm(tempDirPath, { recursive: true })
			} catch (_error) {
				// Directory might not exist, which is fine
			}

			// Create the directory
			await fs.promises.mkdir(tempDirPath, { recursive: true })

			// Get the real path after directory exists
			const tempDir = await fs.promises.realpath(tempDirPath)

			tempDirs.push(tempDir)
			return tempDir
		})

		for (const tempDir of tempDirs) {
			try {
				await fs.promises.rm(tempDir, { recursive: true })
			} catch (error) {
				console.warn(`Failed to cleanup temp dir ${tempDir}:`, error)
			}
		}
	},

	takeScreenshot: async ({ workbox: page }, use) => {
		await use(async (name?: string) => {
			await closeAllTabs(page)
			await executeVSCodeCommand(page, "Notifications:Clear")
			await freezeGifs(page)
			await waitForDOMStability(page)

			// Extract test suite from the test file name or use a default
			const testInfo = test.info()
			const fileName = testInfo.file.split("/").pop()?.replace(".test.ts", "") || "unknown"
			const testName = testInfo.title || "Unknown Test"
			const testSuite = camelCase(fileName)

			// Create a hierarchical name: TestSuite__TestName__ScreenshotName
			const screenshotName = name || `screenshot-${Date.now()}`
			const hierarchicalName = `${testSuite}__${testName}__${screenshotName}`
				.replace(/[^a-zA-Z0-9_-]/g, "-") // Replace special chars with dashes, keep underscores
				.replace(/-+/g, "-") // Replace multiple dashes with single dash
				.replace(/^-|-$/g, "") // Remove leading/trailing dashes

			const screenshotPath = test.info().outputPath(`${hierarchicalName}.png`)
			await page.screenshot({ path: screenshotPath, fullPage: true })
			console.log(`📸 Screenshot captured: ${hierarchicalName}`)
		})
	},
})

function seedUserSettings(userDataDir: string) {
	const userDir = path.join(userDataDir, "User")
	const settingsPath = path.join(userDir, "settings.json")
	fs.mkdirSync(userDir, { recursive: true })

	const settings = {
		"workbench.startupEditor": "none", // hides 'Get Started'
		"workbench.tips.enabled": false,
		"update.showReleaseNotes": false,
		"extensions.ignoreRecommendations": true,
		"telemetry.telemetryLevel": "off",
	}

	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}
