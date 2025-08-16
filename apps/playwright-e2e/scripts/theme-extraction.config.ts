import { defineConfig } from "@playwright/test"
import { TestOptions } from "../tests/playwright-base-test"
import * as path from "path"
import { fileURLToPath } from "url"

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig<void, TestOptions>({
	timeout: 120_000,
	expect: { timeout: 30_000 },
	reporter: "line",
	workers: 1,
	retries: 0,
	globalSetup: "../playwright.globalSetup",
	testDir: ".",
	testMatch: "theme-extraction-script.test.ts", // Only run this specific test
	outputDir: "../test-results",
	projects: [{ name: "VSCode stable", use: { vscodeVersion: "stable" } }],
	use: {
		trace: "on-first-retry",
		video: "retry-with-video",
	},
})
