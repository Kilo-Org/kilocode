import { test as base, type Page, _electron } from "@playwright/test"
export { expect } from "@playwright/test"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import { fileURLToPath } from "url"
import { setupConsoleLogging, cleanLogMessage } from "../helpers/console-logging"

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
	setupWorkbox: Page
}

export const test = base.extend<TestFixtures>({
	vscodeVersion: ["stable", { option: true }],

	workbox: async ({ createProject, createTempDir }, use) => {
		// Fail early if OPENROUTER_API_KEY is not set
		if (!process.env.OPENROUTER_API_KEY) {
			throw new Error("OPENROUTER_API_KEY environment variable is required for Playwright tests")
		}

		const defaultCachePath = await createTempDir()

		// Use the pre-downloaded VS Code from global setup
		const vscodePath = process.env.VSCODE_EXECUTABLE_PATH
		if (!vscodePath) {
			throw new Error("VSCODE_EXECUTABLE_PATH not found. Make sure global setup ran successfully.")
		}

		const electronApp = await _electron.launch({
			executablePath: vscodePath,
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
				"--disable-workspace-trust",
				"--disable-telemetry",
				"--disable-crash-reporter",
				"--enable-logging",
				"--log-level=0",
				`--extensionDevelopmentPath=${path.resolve(__dirname, "..", "..", "..", "src")}`,
				`--extensions-dir=${path.join(defaultCachePath, "extensions")}`,
				`--user-data-dir=${path.join(defaultCachePath, "user-data")}`,
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
		await use(async () => {
			const tempDirPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "e2e-test-"))
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

	setupWorkbox: async ({ workbox }, use) => {
		const { setupTestEnvironment } = await import("../helpers/test-setup-helpers")
		await setupTestEnvironment(workbox)
		await use(workbox)
	},
})
