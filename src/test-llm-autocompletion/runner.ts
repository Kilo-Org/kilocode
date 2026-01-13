#!/usr/bin/env node

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { GhostProviderTester } from "./ghost-provider-tester.js"
import { testCases, getCategories, TestCase } from "./test-cases.js"
import { checkApproval } from "./approvals.js"
import { generateHtmlReport } from "./html-report.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface TestResult {
	testCase: TestCase
	isApproved: boolean
	completion: string
	error?: string
	actualValue?: string
	newOutput?: boolean
	llmRequestDuration?: number
	strategyName?: string
}

export class TestRunner {
	private verbose: boolean
	private results: TestResult[] = []
	private skipApproval: boolean
	private useOpusApproval: boolean
	private originalConsoleLog: typeof console.log
	private originalConsoleInfo: typeof console.info

	constructor(verbose: boolean = false, skipApproval: boolean = false, useOpusApproval: boolean = false) {
		this.verbose = verbose
		this.skipApproval = skipApproval
		this.useOpusApproval = useOpusApproval
		this.originalConsoleLog = console.log
		this.originalConsoleInfo = console.info
	}

	private suppressConsole(): void {
		if (!this.verbose) {
			console.log = () => {}
			console.info = () => {}
		}
	}

	private restoreConsole(): void {
		console.log = this.originalConsoleLog
		console.info = this.originalConsoleInfo
	}

	async runTest(testCase: TestCase, tester: GhostProviderTester): Promise<TestResult> {
		try {
			this.suppressConsole()
			const startTime = performance.now()
			const { prefix, completion, suffix } = await tester.getCompletion(
				testCase.input,
				testCase.name,
				testCase.contextFiles,
			)
			const llmRequestDuration = performance.now() - startTime
			this.restoreConsole()
			let actualValue: string = prefix + completion + suffix

			if (completion === "") {
				actualValue = "(no changes parsed)"
			}

			// Auto-reject if no changes were parsed
			if (actualValue === "(no changes parsed)") {
				return {
					testCase,
					isApproved: false,
					completion,
					actualValue,
					llmRequestDuration,
				}
			}

			const approvalResult = await checkApproval(
				testCase.category,
				testCase.name,
				testCase.input,
				actualValue,
				completion,
				testCase.filename,
				testCase.contextFiles,
				this.skipApproval,
				this.useOpusApproval,
			)

			return {
				...approvalResult,
				testCase,
				completion,
				actualValue,
				llmRequestDuration,
			}
		} catch (error) {
			this.restoreConsole()
			return {
				testCase,
				isApproved: false,
				completion: "",
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	private isUnknownResult(result: TestResult): boolean {
		return !result.isApproved && result.newOutput === true && this.skipApproval
	}

	async runAllTests(numRuns: number = 1): Promise<void> {
		const tester = new GhostProviderTester()
		const model = process.env.LLM_MODEL || "mistralai/codestral-2508"
		const strategyName = tester.getName()

		console.log("\n🚀 Starting LLM Autocompletion Tests\n")
		console.log("Provider: kilocode")
		console.log("Model:", model)
		console.log("Strategy:", strategyName)
		if (numRuns > 1) {
			console.log("Runs per test:", numRuns)
		}
		if (this.skipApproval) {
			console.log("Skip Approval: enabled (tests will fail if not already approved)")
		}
		if (this.useOpusApproval) {
			console.log("Opus Auto-Approval: enabled (using Claude Opus to judge completions)")
		}
		console.log("Total tests:", testCases.length)
		console.log("Categories:", getCategories().join(", "))
		console.log("\n" + "─".repeat(80) + "\n")

		for (const category of getCategories()) {
			console.log(`\n📁 ${category}`)
			console.log("─".repeat(40))

			const categoryTests = testCases.filter((tc) => tc.category === category)

			for (const testCase of categoryTests) {
				if (numRuns > 1) {
					console.log(`  Running ${testCase.name} [${strategyName}] (${numRuns} runs)...`)
				} else {
					process.stdout.write(`  Running ${testCase.name} [${strategyName}]... `)
				}

				const runResults: TestResult[] = []
				for (let run = 0; run < numRuns; run++) {
					const result = await this.runTest(testCase, tester)
					result.strategyName = strategyName
					runResults.push(result)
					this.results.push(result)

					if (numRuns > 1) {
						const status = result.isApproved ? "✓" : this.isUnknownResult(result) ? "?" : "✗"
						process.stdout.write(`    Run ${run + 1}/${numRuns}: ${status}`)
						if (result.llmRequestDuration) {
							process.stdout.write(` (${result.llmRequestDuration.toFixed(0)}ms)`)
						}
						console.log()
					}
				}

				// For single run, show result inline; for multiple runs, show summary
				if (numRuns === 1) {
					const result = runResults[0]
					if (result.isApproved) {
						console.log("✓ PASSED")
						if (result.newOutput) {
							console.log(`    (New output approved)`)
						}
					} else if (this.isUnknownResult(result)) {
						console.log("? UNKNOWN")
						console.log(`    (New output without approval)`)
					} else {
						console.log("✗ FAILED")
						if (result.error) {
							console.log(`    Error: ${result.error}`)
						} else if (this.verbose) {
							console.log(`    Input:`)
							console.log("    " + "─".repeat(76))
							console.log(
								testCase.input
									.split("\n")
									.map((l) => "    " + l)
									.join("\n"),
							)
							console.log("    " + "─".repeat(76))
							console.log(`    Got:`)
							console.log("    " + "─".repeat(76))
							console.log(
								(result.actualValue || "")
									.split("\n")
									.map((l) => "    " + l)
									.join("\n"),
							)
							console.log("    " + "─".repeat(76))

							if (result.completion) {
								console.log("    Full LLM Response:")
								console.log(
									result.completion
										.split("\n")
										.map((l) => "      " + l)
										.join("\n"),
								)
							}
						}
					}
				} else {
					// Summary for multiple runs
					const passed = runResults.filter((r) => r.isApproved).length
					const failed = runResults.filter((r) => !r.isApproved && !this.isUnknownResult(r)).length
					const unknown = runResults.filter((r) => this.isUnknownResult(r)).length
					const passRate = ((passed / numRuns) * 100).toFixed(0)
					console.log(`    Summary: ${passed}/${numRuns} passed (${passRate}%)`)
					if (failed > 0) {
						console.log(`    Failed: ${failed}, Unknown: ${unknown}`)
					}
				}

				if (this.verbose) {
					console.log(`    Description: ${testCase.description}`)
				}
			}
		}

		tester.dispose()
		this.printSummary()
	}

	private printSummary(): void {
		console.log("\n" + "═".repeat(80))
		console.log("\n📊 Test Summary\n")

		const unknownResults = this.results.filter((r) => this.isUnknownResult(r))
		const failedResults = this.results.filter((r) => !r.isApproved && !this.isUnknownResult(r))
		const passedResults = this.results.filter((r) => r.isApproved)

		const passed = passedResults.length
		const unknown = unknownResults.length
		const failed = failedResults.length
		const knownTotal = passed + failed
		const passRate = knownTotal > 0 ? ((passed / knownTotal) * 100).toFixed(1) : "0.0"

		console.log(`  ✓ Passed: ${passed}`)
		console.log(`  ✗ Failed: ${failed}`)
		if (unknown > 0) {
			console.log(`  ? Unknown: ${unknown}`)
		}
		console.log(`  📈 Accuracy: ${passRate}% (${passed}/${knownTotal})`)

		const requestDurations = this.results
			.filter((r) => r.llmRequestDuration !== undefined)
			.map((r) => r.llmRequestDuration!)
		if (requestDurations.length > 0) {
			const avgTime = (
				requestDurations.reduce((sum, duration) => sum + duration, 0) / requestDurations.length
			).toFixed(0)
			console.log(`  ⏱️  Avg LLM Request Time: ${avgTime}ms`)
		}

		// Category breakdown
		console.log("\n📁 Category Breakdown:")
		for (const category of getCategories()) {
			const categoryResults = this.results.filter((r) => r.testCase.category === category)
			const categoryPassed = categoryResults.filter((r) => r.isApproved).length
			const categoryTotal = categoryResults.length
			const categoryRateNum = (categoryPassed / categoryTotal) * 100
			const categoryRate = categoryRateNum.toFixed(0)

			const statusIndicator = categoryRateNum === 100 ? "✓" : categoryRateNum >= 75 ? "⚠" : "✗"

			console.log(`  ${category}: ${statusIndicator} ${categoryPassed}/${categoryTotal} (${categoryRate}%)`)
		}

		// Strategy usage statistics
		const strategyUsage = new Map<string, number>()
		for (const result of this.results) {
			if (result.strategyName) {
				strategyUsage.set(result.strategyName, (strategyUsage.get(result.strategyName) || 0) + 1)
			}
		}

		if (strategyUsage.size > 0) {
			console.log("\n🎯 Strategy Usage:")
			const sortedStrategies = Array.from(strategyUsage.entries()).sort((a, b) => b[1] - a[1])
			for (const [strategyName, count] of sortedStrategies) {
				const percentage = ((count / this.results.length) * 100).toFixed(0)
				console.log(`  ${strategyName}: ${count} (${percentage}%)`)
			}
		}

		// Unknown tests details
		if (unknown > 0) {
			console.log("\n❓ Unknown Tests (new outputs without approval):")
			for (const result of unknownResults) {
				console.log(`  • ${result.testCase.name} (${result.testCase.category})`)
			}
		}

		console.log("\n" + "═".repeat(80) + "\n")

		// Exit with appropriate code
		process.exit(failed > 0 ? 1 : 0)
	}

	async runSingleTest(testName: string, numRuns: number = 10): Promise<void> {
		const tester = new GhostProviderTester()
		const testCase = testCases.find((tc) => tc.name === testName)
		if (!testCase) {
			console.error(`Test "${testName}" not found`)
			console.log("\nAvailable tests:")
			testCases.forEach((tc) => console.log(`  - ${tc.name}`))
			tester.dispose()
			process.exit(1)
		}

		console.log(`\n🧪 Running Single Test: ${testName} (${numRuns} times)\n`)
		console.log("Category:", testCase.category)
		console.log("Description:", testCase.description)
		console.log("\nInput Code:")
		console.log(testCase.input)
		console.log("\n" + "═".repeat(80))

		const results: TestResult[] = []

		for (let i = 0; i < numRuns; i++) {
			console.log(`\n🔄 Run ${i + 1}/${numRuns}...`)

			const result = await this.runTest(testCase, tester)

			results.push(result)

			const status = result.isApproved ? "✓ PASSED" : "✗ FAILED"
			const llmTime = result.llmRequestDuration ? `${result.llmRequestDuration.toFixed(0)}ms LLM` : "N/A"
			console.log(`   ${status} - ${llmTime}`)
		}

		console.log("\n" + "═".repeat(80))
		console.log("\n📊 Test Statistics\n")

		const passedRuns = results.filter((r) => r.isApproved).length
		const failedRuns = numRuns - passedRuns
		console.log(`  ✓ Passed: ${passedRuns}/${numRuns}`)
		console.log(`  ✗ Failed: ${failedRuns}/${numRuns}`)

		const llmTimes = results.filter((r) => r.llmRequestDuration !== undefined).map((r) => r.llmRequestDuration!)
		if (llmTimes.length > 0) {
			const sortedLlmTimes = [...llmTimes].sort((a, b) => a - b)
			const avgLlmTime = llmTimes.reduce((sum, time) => sum + time, 0) / llmTimes.length
			const minLlmTime = sortedLlmTimes[0]
			const maxLlmTime = sortedLlmTimes[sortedLlmTimes.length - 1]
			const medianLlmTime = sortedLlmTimes[Math.floor(llmTimes.length / 2)]

			console.log("\n⚡ LLM Request Time:")
			console.log(`  Average: ${avgLlmTime.toFixed(0)}ms`)
			console.log(`  Median:  ${medianLlmTime.toFixed(0)}ms`)
			console.log(`  Min:     ${minLlmTime.toFixed(0)}ms`)
			console.log(`  Max:     ${maxLlmTime.toFixed(0)}ms`)
		}

		const lastResult = results[results.length - 1]

		console.log("\n" + "═".repeat(80))
		console.log("\n📝 Last Run Details\n")

		if (lastResult.isApproved) {
			console.log("✓ TEST PASSED")
			if (lastResult.newOutput) {
				console.log("(New output approved)")
			}
		} else {
			console.log("✗ TEST FAILED")
			if (lastResult.error) {
				console.log(`Error: ${lastResult.error}`)
			} else {
				console.log("\nExtracted value being tested:")
				console.log(`  "${lastResult.actualValue}"`)
			}
		}

		if (this.verbose && lastResult.completion) {
			console.log("\nCompletion:")
			console.log("  " + "─".repeat(78))
			console.log(
				lastResult.completion
					.split("\n")
					.map((l) => "  " + l)
					.join("\n"),
			)
			console.log("  " + "─".repeat(78))
		}

		console.log("\n" + "═".repeat(80) + "\n")

		tester.dispose()
		process.exit(passedRuns === numRuns ? 0 : 1)
	}

	async cleanApprovals(): Promise<void> {
		console.log("\n🧹 Cleaning approvals for non-existent test cases...\n")

		// Create a set of existing test case identifiers
		const existingTestCases = new Set(testCases.map((tc) => `${tc.category}/${tc.name}`))

		const approvalsDir = "approvals"
		let cleanedCount = 0
		let totalFiles = 0

		if (!fs.existsSync(approvalsDir)) {
			console.log("No approvals directory found.")
			return
		}

		// Recursively scan approvals directory
		function scanDirectory(dirPath: string, currentCategory?: string): void {
			const items = fs.readdirSync(dirPath, { withFileTypes: true })

			for (const item of items) {
				const fullPath = path.join(dirPath, item.name)

				if (item.isDirectory()) {
					// Category directory
					scanDirectory(fullPath, item.name)
				} else if (item.isFile() && item.name.endsWith(".txt")) {
					totalFiles++

					// Parse filename: testName.approved.1.txt or testName.rejected.1.txt
					const match = item.name.match(/^(.+)\.(approved|rejected)\.\d+\.txt$/)
					if (match) {
						const testName = match[1]
						const category = currentCategory || path.basename(path.dirname(fullPath))
						const testCaseId = `${category}/${testName}`

						if (!existingTestCases.has(testCaseId)) {
							console.log(`Removing approval for non-existent test case: ${testCaseId}`)
							fs.unlinkSync(fullPath)
							cleanedCount++
						}
					}
				}
			}
		}

		scanDirectory(approvalsDir)

		console.log(`\n✅ Cleaned ${cleanedCount} approval files out of ${totalFiles} total files.`)
		if (cleanedCount > 0) {
			console.log("Removed approvals for test cases that no longer exist.")
		} else {
			console.log("No orphaned approval files found.")
		}
	}
}

// Main execution
async function main() {
	const args = process.argv.slice(2)
	const verbose = args.includes("--verbose") || args.includes("-v")
	const skipApproval = args.includes("--skip-approval") || args.includes("-sa")
	const useOpusApproval = args.includes("--opus-approval") || args.includes("-oa")

	// Parse --runs or -r option
	let numRuns = 1
	const runsIndex = args.findIndex((arg) => arg === "--runs" || arg === "-r")
	if (runsIndex !== -1 && args[runsIndex + 1]) {
		const parsedRuns = parseInt(args[runsIndex + 1], 10)
		if (!isNaN(parsedRuns) && parsedRuns > 0) {
			numRuns = parsedRuns
		}
	}

	const command = args.find((arg, index) => !arg.startsWith("-") && (runsIndex === -1 || index !== runsIndex + 1))

	try {
		if (command === "report") {
			await generateHtmlReport()
			return
		}

		// Only create TestRunner for commands that need it
		const runner = new TestRunner(verbose, skipApproval, useOpusApproval)

		if (command === "clean") {
			await runner.cleanApprovals()
		} else if (command) {
			await runner.runSingleTest(command, numRuns)
		} else {
			await runner.runAllTests(numRuns)
		}
	} catch (error) {
		console.error("\n❌ Fatal Error:", error)
		process.exit(1)
	}
}

// Check for required environment variables
function checkEnvironment() {
	const provider = process.env.LLM_PROVIDER || "kilocode"

	if (provider !== "kilocode") {
		console.error(`\n❌ Error: Only kilocode provider is supported. Got: ${provider}`)
		process.exit(1)
	}

	if (!process.env.KILOCODE_API_KEY) {
		console.error(`\n❌ Error: KILOCODE_API_KEY is not set`)
		console.log("\nPlease create a .env file with your API credentials.")
		console.log("Example: KILOCODE_API_KEY=your-api-key-here\n")
		process.exit(1)
	}
}

// Check if running a command that doesn't need API keys
const argsForCheck = process.argv.slice(2)
const commandForCheck = argsForCheck.find((arg) => !arg.startsWith("-"))
if (commandForCheck !== "report" && commandForCheck !== "clean") {
	checkEnvironment()
}
main().catch(console.error)
