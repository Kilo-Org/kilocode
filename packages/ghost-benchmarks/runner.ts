#!/usr/bin/env node

import { LLMClient } from "./llm-client.js"
import { AutoTriggerStrategyTester } from "./auto-trigger-strategy.js"
import { testCases, getCategories, TestCase } from "./test-cases.js"
import { checkApproval } from "./approvals.js"

interface TestResult {
	testCase: TestCase
	isApproved: boolean
	completion: string
	error?: string
	actualValue?: string
	newOutput?: boolean
	llmRequestDuration?: number
}

class TestRunner {
	private llmClient: LLMClient
	private strategyTester: AutoTriggerStrategyTester
	private verbose: boolean
	private results: TestResult[] = []

	constructor(verbose: boolean = false) {
		this.verbose = verbose
		this.llmClient = new LLMClient()
		this.strategyTester = new AutoTriggerStrategyTester(this.llmClient)
	}

	async runTest(testCase: TestCase): Promise<TestResult> {
		try {
			const startTime = performance.now()
			const completion = await this.strategyTester.getCompletion(testCase.input)
			const llmRequestDuration = performance.now() - startTime

			const changes = this.strategyTester.parseCompletion(completion)

			let actualValue: string

			if (changes.length > 0) {
				// Apply the change: replace search with replace in the input
				const change = changes[0]
				actualValue = testCase.input.replace(change.search, change.replace)
			} else {
				actualValue = "(no changes parsed)"
			}

			const approvalResult = await checkApproval(testCase.category, testCase.name, testCase.input, actualValue)

			return {
				...approvalResult,
				testCase,
				completion,
				actualValue,
				llmRequestDuration,
			}
		} catch (error) {
			return {
				testCase,
				isApproved: false,
				completion: "",
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	async runAllTests(): Promise<void> {
		console.log("\n🚀 Starting AutoTriggerStrategy LLM Tests\n")
		console.log("Provider:", this.llmClient["provider"])
		console.log("Model:", this.llmClient["model"])
		console.log("Total tests:", testCases.length)
		console.log("Categories:", getCategories().join(", "))
		console.log("\n" + "─".repeat(80) + "\n")

		for (const category of getCategories()) {
			console.log(`\n📁 ${category}`)
			console.log("─".repeat(40))

			const categoryTests = testCases.filter((tc) => tc.category === category)

			for (const testCase of categoryTests) {
				process.stdout.write(`  Running ${testCase.name}... `)

				const result = await this.runTest(testCase)
				this.results.push(result)

				if (result.isApproved) {
					console.log("✓ PASSED")
					if (result.newOutput) {
						console.log(`    (New output approved)`)
					}
				} else {
					console.log("✗ FAILED")
					if (result.error) {
						console.log(`    Error: ${result.error}`)
					} else {
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

						if (this.verbose && result.completion) {
							console.log("    Full XML Response:")
							console.log(
								result.completion
									.split("\n")
									.map((l) => "      " + l)
									.join("\n"),
							)
						}
					}
				}

				if (this.verbose) {
					console.log(`    Description: ${testCase.description}`)
				}
			}
		}

		this.printSummary()
	}

	private printSummary(): void {
		console.log("\n" + "═".repeat(80))
		console.log("\n📊 Test Summary\n")

		const passed = this.results.filter((r) => r.isApproved).length
		const failed = this.results.filter((r) => !r.isApproved).length
		const passRate = ((passed / this.results.length) * 100).toFixed(1)

		console.log(`  ✓ Passed: ${passed}`)
		console.log(`  ✗ Failed: ${failed}`)
		console.log(`  📈 Pass Rate: ${passRate}%`)

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
			const categoryRate = ((categoryPassed / categoryTotal) * 100).toFixed(0)

			const statusIndicator = categoryRate === "100" ? "✓" : categoryRate >= "75" ? "⚠" : "✗"

			console.log(`  ${category}: ${statusIndicator} ${categoryPassed}/${categoryTotal} (${categoryRate}%)`)
		}

		// Failed tests details
		const failedResults = this.results.filter((r) => !r.isApproved)
		if (failedResults.length > 0) {
			console.log("\n❌ Failed Tests:")
			for (const result of failedResults) {
				console.log(`  • ${result.testCase.name} (${result.testCase.category})`)
				if (result.error) {
					console.log(`    Error: ${result.error}`)
				}
			}
		}

		console.log("\n" + "═".repeat(80) + "\n")

		// Exit with appropriate code
		process.exit(failed > 0 ? 1 : 0)
	}

	async runSingleTest(testName: string): Promise<void> {
		const testCase = testCases.find((tc) => tc.name === testName)
		if (!testCase) {
			console.error(`Test "${testName}" not found`)
			console.log("\nAvailable tests:")
			testCases.forEach((tc) => console.log(`  - ${tc.name}`))
			process.exit(1)
		}

		const numRuns = 5

		console.log(`\n🧪 Running Single Test: ${testName} (${numRuns} times)\n`)
		console.log("Category:", testCase.category)
		console.log("Description:", testCase.description)
		console.log("\nInput Code:")
		console.log(testCase.input)
		console.log("\n" + "═".repeat(80))

		const results: TestResult[] = []

		for (let i = 0; i < numRuns; i++) {
			console.log(`\n🔄 Run ${i + 1}/${numRuns}...`)

			const result = await this.runTest(testCase)

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

		if (lastResult.completion) {
			const changes = this.strategyTester.parseCompletion(lastResult.completion)
			if (changes.length > 0) {
				console.log("\nParsed Changes:")
				changes.forEach((change, i) => {
					console.log(`Change ${i + 1}:`)
					console.log("  Search:")
					console.log("  " + "─".repeat(78))
					console.log(
						change.search
							.split("\n")
							.map((l) => "  " + l)
							.join("\n"),
					)
					console.log("  " + "─".repeat(78))
					console.log("  Replace:")
					console.log("  " + "─".repeat(78))
					console.log(
						change.replace
							.split("\n")
							.map((l) => "  " + l)
							.join("\n"),
					)
					console.log("  " + "─".repeat(78))

					const extracted = change.replace.replace(testCase.input, "").trim()
					console.log("  Extracted for test:", extracted || "(full replacement)")
				})
			} else {
				console.log("\nNo changes were parsed from the response")
			}

			console.log("\nFull LLM Response:")
			console.log(lastResult.completion)
		}

		console.log("\n" + "═".repeat(80) + "\n")

		process.exit(passedRuns === numRuns ? 0 : 1)
	}
}

// Main execution
async function main() {
	const args = process.argv.slice(2)
	const verbose = args.includes("--verbose") || args.includes("-v")
	const testName = args.find((arg) => !arg.startsWith("-"))

	const runner = new TestRunner(verbose)

	try {
		if (testName) {
			await runner.runSingleTest(testName)
		} else {
			await runner.runAllTests()
		}
	} catch (error) {
		console.error("\n❌ Fatal Error:", error)
		process.exit(1)
	}
}

main().catch(console.error)
