#!/usr/bin/env node

import chalk from "chalk"
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
		console.log(chalk.bold.blue("\n🚀 Starting AutoTriggerStrategy LLM Tests\n"))
		console.log(chalk.gray("Provider:"), this.llmClient["provider"])
		console.log(chalk.gray("Model:"), this.llmClient["model"])
		console.log(chalk.gray("Total tests:"), testCases.length)
		console.log(chalk.gray("Categories:"), getCategories().join(", "))
		console.log("\n" + chalk.gray("─".repeat(80)) + "\n")

		for (const category of getCategories()) {
			console.log(chalk.bold.cyan(`\n📁 ${category}`))
			console.log(chalk.gray("─".repeat(40)))

			const categoryTests = testCases.filter((tc) => tc.category === category)

			for (const testCase of categoryTests) {
				process.stdout.write(chalk.gray(`  Running ${testCase.name}... `))

				const result = await this.runTest(testCase)
				this.results.push(result)

				if (result.passed) {
					console.log(chalk.green("✓ PASSED"))
					if (this.verbose && result.matchedPattern) {
						console.log(chalk.gray(`    Matched pattern: ${result.matchedPattern}`))
					}
				} else {
					console.log(chalk.red("✗ FAILED"))
					if (result.error) {
						console.log(chalk.red(`    Error: ${result.error}`))
					} else {
						console.log(chalk.yellow(`    Expected: ${testCase.expectedPatterns.join(" or ")}`))
						if (this.verbose && result.completion) {
							console.log(chalk.gray("    Response:"))
							console.log(
								chalk.gray(
									result.completion
										.split("\n")
										.map((l) => "      " + l)
										.join("\n"),
								),
							)
						}
					}
				}

				if (this.verbose) {
					console.log(chalk.gray(`    Description: ${testCase.description}`))
				}
			}
		}

		this.printSummary()
	}

	private printSummary(): void {
		console.log("\n" + chalk.gray("═".repeat(80)))
		console.log(chalk.bold.blue("\n📊 Test Summary\n"))

		const passed = this.results.filter((r) => r.passed).length
		const failed = this.results.filter((r) => !r.passed).length
		const passRate = ((passed / this.results.length) * 100).toFixed(1)

		console.log(chalk.green(`  ✓ Passed: ${passed}`))
		console.log(chalk.red(`  ✗ Failed: ${failed}`))
		console.log(chalk.yellow(`  📈 Pass Rate: ${passRate}%`))

		// Category breakdown
		console.log(chalk.bold.cyan("\n📁 Category Breakdown:"))
		for (const category of getCategories()) {
			const categoryResults = this.results.filter((r) => r.testCase.category === category)
			const categoryPassed = categoryResults.filter((r) => r.passed).length
			const categoryTotal = categoryResults.length
			const categoryRate = ((categoryPassed / categoryTotal) * 100).toFixed(0)

			const color = categoryRate === "100" ? chalk.green : categoryRate >= "75" ? chalk.yellow : chalk.red

			console.log(`  ${category}: ${color(`${categoryPassed}/${categoryTotal} (${categoryRate}%)`)}`)
		}

		// Failed tests details
		const failedResults = this.results.filter((r) => !r.passed)
		if (failedResults.length > 0) {
			console.log(chalk.bold.red("\n❌ Failed Tests:"))
			for (const result of failedResults) {
				console.log(chalk.red(`  • ${result.testCase.name} (${result.testCase.category})`))
				if (result.error) {
					console.log(chalk.gray(`    Error: ${result.error}`))
				}
			}
		}

		console.log("\n" + chalk.gray("═".repeat(80)) + "\n")

		// Exit with appropriate code
		process.exit(failed > 0 ? 1 : 0)
	}

	async runSingleTest(testName: string): Promise<void> {
		const testCase = testCases.find((tc) => tc.name === testName)
		if (!testCase) {
			console.error(chalk.red(`Test "${testName}" not found`))
			console.log(chalk.yellow("\nAvailable tests:"))
			testCases.forEach((tc) => console.log(`  - ${tc.name}`))
			process.exit(1)
		}

		console.log(chalk.bold.blue(`\n🧪 Running Single Test: ${testName}\n`))
		console.log(chalk.gray("Category:"), testCase.category)
		console.log(chalk.gray("Description:"), testCase.description)
		console.log(chalk.gray("\nInput Code:"))
		console.log(chalk.cyan(testCase.input))
		console.log(chalk.gray("\nExpected Patterns:"), testCase.expectedPatterns.join(" or "))

		const result = await this.runTest(testCase)

		console.log(chalk.gray("\n─".repeat(40)))

		if (result.passed) {
			console.log(chalk.green("\n✓ TEST PASSED"))
			if (result.matchedPattern) {
				console.log(chalk.green(`Matched pattern: ${result.matchedPattern}`))
			}
		} else {
			console.log(chalk.red("\n✗ TEST FAILED"))
			if (result.error) {
				console.log(chalk.red(`Error: ${result.error}`))
			}
		}

		if (result.completion) {
			console.log(chalk.gray("\nLLM Response:"))
			console.log(result.completion)

			const changes = this.strategyTester.parseCompletion(result.completion)
			if (changes.length > 0) {
				console.log(chalk.gray("\nParsed Changes:"))
				changes.forEach((change, i) => {
					console.log(chalk.yellow(`Change ${i + 1}:`))
					console.log(chalk.gray("  Search:"), change.search.replace(/\n/g, "\\n"))
					console.log(chalk.gray("  Replace:"), change.replace.replace(/\n/g, "\\n"))
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
		console.error(chalk.red("\n❌ Fatal Error:"), error)
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
		console.error(chalk.red(`\n❌ Error: ${requiredVar} is not set`))
		console.log(chalk.yellow("\nPlease create a .env file with your API credentials."))
		console.log(chalk.gray("See .env.example for configuration options.\n"))
		process.exit(1)
	}
}

checkEnvironment()
main().catch(console.error)
