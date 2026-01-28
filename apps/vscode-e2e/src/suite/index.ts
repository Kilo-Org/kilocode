import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as vscode from "vscode"

import type { RooCodeAPI } from "@roo-code/types"

import { waitFor } from "./utils"

/**
 * Models to test against - high-performing models from different providers
 */
const MODELS_TO_TEST = ["openai/gpt-5.2", "anthropic/claude-sonnet-4.5", "google/gemini-3-pro-preview"]

interface ModelTestResult {
	model: string
	failures: number
	passes: number
	duration: number
}

export async function run() {
	const extension = vscode.extensions.getExtension<RooCodeAPI>("kilocode.kilo-code")

	if (!extension) {
		throw new Error("Extension not found")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	// Initial configuration with first model (will be reconfigured per model)
	await api.setConfiguration({
		apiProvider: "openrouter" as const,
		openRouterApiKey: process.env.OPENROUTER_API_KEY!,
		openRouterModelId: MODELS_TO_TEST[0],
	})

	await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
	await waitFor(() => api.isReady())

	globalThis.api = api

	const cwd = path.resolve(__dirname, "..")

	let testFiles: string[]

	if (process.env.TEST_FILE) {
		const specificFile = process.env.TEST_FILE.endsWith(".js")
			? process.env.TEST_FILE
			: `${process.env.TEST_FILE}.js`

		testFiles = await glob(`**/${specificFile}`, { cwd })
		console.log(`Running specific test file: ${specificFile}`)
	} else {
		testFiles = await glob("**/**.test.js", { cwd })
	}

	if (testFiles.length === 0) {
		throw new Error(`No test files found matching criteria: ${process.env.TEST_FILE || "all tests"}`)
	}

	const results: ModelTestResult[] = []
	let totalFailures = 0

	// Run tests for each model sequentially
	for (const model of MODELS_TO_TEST) {
		console.log(`\n${"=".repeat(60)}`)
		console.log(`  TESTING WITH MODEL: ${model}`)
		console.log(`${"=".repeat(60)}\n`)

		// Reconfigure API for this model
		await api.setConfiguration({
			apiProvider: "openrouter" as const,
			openRouterApiKey: process.env.OPENROUTER_API_KEY!,
			openRouterModelId: model,
		})

		// Wait for API to be ready with new configuration
		await waitFor(() => api.isReady())

		const startTime = Date.now()

		const mochaOptions: Mocha.MochaOptions = {
			ui: "tdd",
			timeout: 20 * 60 * 1_000, // 20m
		}

		if (process.env.TEST_GREP) {
			mochaOptions.grep = process.env.TEST_GREP
			console.log(`Running tests matching pattern: ${process.env.TEST_GREP}`)
		}

		const mocha = new Mocha(mochaOptions)

		// Add test files fresh for each model run
		testFiles.forEach((testFile) => mocha.addFile(path.resolve(cwd, testFile)))

		// Run tests for this model
		const modelResult = await new Promise<{ failures: number; passes: number }>((resolve) => {
			const runner = mocha.run((failures) => {
				resolve({
					failures,
					passes: runner.stats?.passes ?? 0,
				})
			})
		})

		const duration = Date.now() - startTime

		results.push({
			model,
			failures: modelResult.failures,
			passes: modelResult.passes,
			duration,
		})

		totalFailures += modelResult.failures

		console.log(
			`\n[${model}] Completed: ${modelResult.passes} passed, ${modelResult.failures} failed (${(duration / 1000).toFixed(1)}s)\n`,
		)

		// Clear mocha's require cache to allow re-running tests
		mocha.dispose()
		testFiles.forEach((testFile) => {
			const fullPath = path.resolve(cwd, testFile)
			delete require.cache[require.resolve(fullPath)]
		})
	}

	// Print summary
	console.log(`\n${"=".repeat(60)}`)
	console.log(`  MULTI-MODEL TEST SUMMARY`)
	console.log(`${"=".repeat(60)}`)

	for (const result of results) {
		const status = result.failures === 0 ? "✓ PASS" : "✗ FAIL"
		console.log(`  ${status} ${result.model}`)
		console.log(
			`       ${result.passes} passed, ${result.failures} failed (${(result.duration / 1000).toFixed(1)}s)`,
		)
	}

	console.log(`${"=".repeat(60)}\n`)

	if (totalFailures > 0) {
		throw new Error(`${totalFailures} total test failures across all models.`)
	}
}
