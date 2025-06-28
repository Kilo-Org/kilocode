import { test as base, type Page, _electron } from "@playwright/test"
import { downloadAndUnzipVSCode } from "@vscode/test-electron/out/download"
export { expect } from "@playwright/test"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"

const __dirname = path.dirname(__filename)

export type TestOptions = {
	vscodeVersion: string
}

type TestFixtures = TestOptions & {
	workbox: Page
	createProject: () => Promise<string>
	createTempDir: () => Promise<string>
}

export const test = base.extend<TestFixtures>({
	vscodeVersion: ["stable", { option: true }],

	workbox: async ({ vscodeVersion, createProject, createTempDir }, use) => {
		const defaultCachePath = await createTempDir()
		const vscodePath = await downloadAndUnzipVSCode(vscodeVersion)

		const electronApp = await _electron.launch({
			executablePath: vscodePath,
			args: [
				"--no-sandbox",
				"--disable-gpu-sandbox",
				"--disable-updates",
				"--skip-welcome",
				"--skip-release-notes",
				"--disable-workspace-trust",
				"--disable-telemetry",
				"--disable-crash-reporter",
				`--extensionDevelopmentPath=${path.resolve(__dirname, "..", "..", "..", "src")}`,
				`--extensions-dir=${path.join(defaultCachePath, "extensions")}`,
				`--user-data-dir=${path.join(defaultCachePath, "user-data")}`,
				"--enable-proposed-api=kilocode.kilo-code",
				await createProject(),
			],
		})

		const workbox = await electronApp.firstWindow()
		await workbox.waitForLoadState("domcontentloaded")

		try {
			console.log("🔄 Waiting for VS Code workbench...")
			await workbox.waitForSelector(".monaco-workbench", { timeout: 10000 })
		} catch (_error) {
			throw new Error("❌ .monaco-workbench not found!")
		}

		console.log("✅ VS Code workbox ready for testing")
		await use(workbox)
		await electronApp.close()

		const logPath = path.join(defaultCachePath, "user-data")
		if (fs.existsSync(logPath)) {
			const logOutputPath = test.info().outputPath("vscode-logs")
			await fs.promises.cp(logPath, logOutputPath, { recursive: true })
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
				description: "Test project for ai agent extension",
				main: "index.js",
				scripts: {
					test: 'echo "Error: no test specified" && exit 1',
				},
				keywords: [],
				author: "",
				license: "ISC",
			}

			await fs.promises.writeFile(path.join(projectPath, "package.json"), JSON.stringify(packageJson, null, 2))

			const testFile = `// Test file for extension
console.log('Hello from the test project!');

function greet(name) {
  return \`Hello, \${name}!\`;
}

module.exports = { greet };
`

			await fs.promises.writeFile(path.join(projectPath, "index.js"), testFile)

			const readme = `# Test Project

This is a test project created for testing the VS Code extension.

## Features

- Basic JavaScript file
- Package.json configuration
- Ready for AI assistant interaction
`

			await fs.promises.writeFile(path.join(projectPath, "README.md"), readme)

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
})
