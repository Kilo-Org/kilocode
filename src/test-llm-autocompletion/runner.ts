#!/usr/bin/env node

import { LLMClient } from "./llm-client.js"
import { AutoTriggerStrategyTester } from "./auto-trigger-strategy.js"
import { testCases, getCategories, TestCase } from "./test-cases.js"

interface TestResult {
	testCase: TestCase
	passed: boolean
	completion: string
	error?: string
	matchedPattern?: string
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
			const completion = await this.strategyTester.getCompletion(testCase.input, testCase.cursorPosition)

			const changes = this.strategyTester.parseCompletion(completion)

			// Check if any change matches our expected patterns
			let passed = false
			let matchedPattern: string | undefined

			if (changes.length > 0) {
				const replacementText = changes[0].replace.replace(testCase.input, "").trim()

				for (const pattern of testCase.expectedPatterns) {
					const regex = new RegExp(pattern)
					if (regex.test(replacementText) || regex.test(changes[0].replace)) {
						passed = true
						matchedPattern = pattern
						break
					}
				}
			}

			return {
				testCase,
				passed,
				completion,
				matchedPattern,
			}
		} catch (error) {
			return {
				testCase,
				passed: false,
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

				if (result.passed) {
					console.log("✓ PASSED")
					if (this.verbose && result.matchedPattern) {
						console.log(`    Matched pattern: ${result.matchedPattern}`)
					}
				} else {
					console.log("✗ FAILED")
					if (result.error) {
						console.log(`    Error: ${result.error}`)
					} else {
						console.log(`    Expected: ${testCase.expectedPatterns.join(" or ")}`)
						if (this.verbose && result.completion) {
							console.log("    Response:")
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

		const passed = this.results.filter((r) => r.passed).length
		const failed = this.results.filter((r) => !r.passed).length
		const passRate = ((passed / this.results.length) * 100).toFixed(1)

		console.log(`  ✓ Passed: ${passed}`)
		console.log(`  ✗ Failed: ${failed}`)
		console.log(`  📈 Pass Rate: ${passRate}%`)

		// Category breakdown
		console.log("\n📁 Category Breakdown:")
		for (const category of getCategories()) {
			const categoryResults = this.results.filter((r) => r.testCase.category === category)
			const categoryPassed = categoryResults.filter((r) => r.passed).length
			const categoryTotal = categoryResults.length
			const categoryRate = ((categoryPassed / categoryTotal) * 100).toFixed(0)

			const statusIndicator = categoryRate === "100" ? "✓" : categoryRate >= "75" ? "⚠" : "✗"

			console.log(`  ${category}: ${statusIndicator} ${categoryPassed}/${categoryTotal} (${categoryRate}%)`)
		}

		// Failed tests details
		const failedResults = this.results.filter((r) => !r.passed)
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
		console.log("\nExpected Patterns:", testCase.expectedPatterns.join(" or "))

		const result = await this.runTest(testCase)

		console.log("\n" + "─".repeat(40))

		if (result.passed) {
			console.log("\n✓ TEST PASSED")
			if (result.matchedPattern) {
				console.log(`Matched pattern: ${result.matchedPattern}`)
			}
		} else {
			console.log("\n✗ TEST FAILED")
			if (result.error) {
				console.log(`Error: ${result.error}`)
			}
		}

		if (result.completion) {
			console.log("\nLLM Response:")
			console.log(result.completion)

			const changes = this.strategyTester.parseCompletion(result.completion)
			if (changes.length > 0) {
				console.log("\nParsed Changes:")
				changes.forEach((change, i) => {
					console.log(`Change ${i + 1}:`)
					console.log("  Search:", change.search.replace(/\n/g, "\\n"))
					console.log("  Replace:", change.replace.replace(/\n/g, "\\n"))
				})
			}
		}

		process.exit(result.passed ? 0 : 1)
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
	const provider = process.env.LLM_PROVIDER || "anthropic"

	const requiredVars: Record<string, string> = {
		anthropic: "ANTHROPIC_API_KEY",
		openai: "OPENAI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
	}

	const requiredVar = requiredVars[provider]
	if (requiredVar && !process.env[requiredVar]) {
		console.error(`\n❌ Error: ${requiredVar} is not set`)
		console.log("\nPlease create a .env file with your API credentials.")
		console.log("See .env.example for configuration options.\n")
		process.exit(1)
	}
}

checkEnvironment()
main().catch(console.error)
