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

		console.log(`\n🧪 Running Single Test: ${testName}\n`)
		console.log("Category:", testCase.category)
		console.log("Description:", testCase.description)
		console.log("\nInput Code:")
		console.log(testCase.input)

		const result = await this.runTest(testCase)

		console.log("\n" + "─".repeat(40))

		if (result.isApproved) {
			console.log("\n✓ TEST PASSED")
			if (result.newOutput) {
				console.log("(New output approved)")
			}
		} else {
			console.log("\n✗ TEST FAILED")
			if (result.error) {
				console.log(`Error: ${result.error}`)
			} else {
				console.log("\nExtracted value being tested:")
				console.log(`  "${result.actualValue}"`)
			}
		}

		if (result.completion) {
			const changes = this.strategyTester.parseCompletion(result.completion)
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

					// Show what was extracted for testing
					const extracted = change.replace.replace(testCase.input, "").trim()
					console.log("  Extracted for test:", extracted || "(full replacement)")
				})
			} else {
				console.log("\nNo changes were parsed from the response")
			}

			console.log("\nFull LLM Response:")
			console.log(result.completion)
		}

		process.exit(result.isApproved ? 0 : 1)
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

checkEnvironment()
main().catch(console.error)
