// kilocode_change - new file
import { defineConfig } from "@playwright/test"
import { TestOptions } from "./tests/playwright-base-test"
import * as dotenv from "dotenv"
import * as path from "path"
import { fileURLToPath } from "url"

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.resolve(__dirname, ".env")
dotenv.config({ path: envPath })

export default defineConfig<void, TestOptions>({
	timeout: 120_000,
	expect: { timeout: 30_000 },
	reporter: process.env.CI ? "html" : "list",
	workers: 1,
	retries: process.env.CI ? 2 : 0, // Retry in CI, never locally
	globalSetup: "./playwright.globalSetup",
	testDir: "./tests",
	testIgnore: "**/helpers/__tests__/**",
	outputDir: "./test-results",
	projects: [
		// { name: "VSCode insiders", use: { vscodeVersion: "insiders" } },
		{ name: "VSCode stable", use: { vscodeVersion: "stable" } },
	],
	use: {
		trace: "on-first-retry",
		video: "retry-with-video", // videos only on retries
	},
})
