#!/usr/bin/env tsx

import { Command } from "commander"
import chalk from "chalk"
import ora from "ora"
import { BenchmarkRunner } from "../runner/BenchmarkRunner"
import { TestCaseLoader } from "../runner/TestCaseLoader"
import type { BenchmarkOptions, BenchmarkSummary } from "../types/BenchmarkTypes"

const program = new Command()

program.name("ghost-benchmark").description("Ghost autocomplete benchmarking system").version("1.0.0")

// Default command - run all tests (like vitest)
program
	.option("-p, --profile <profile>", "Ghost profile to test", "mercury-coder")
	.option("-t, --tests <tests...>", "Specific test cases to run")
	.option("-c, --categories <categories...>", "Test categories to run")
	.option("--timeout <ms>", "Timeout per test in milliseconds", "30000")
	.option("-v, --verbose", "Verbose output")
	.option("-o, --output <file>", "Output file for results")
	.option("--format <format>", "Output format: table, json", "table")
	.option("--no-save", "Disable automatic result persistence")
	.action(async (options) => {
		await runBenchmarks(options)
	})

// List command
program
	.command("list")
	.description("List available test cases")
	.option("-c, --category <category>", "Filter by category")
	.action(async (options) => {
		await listTestCases(options)
	})

// Results commands
program
	.command("results")
	.description("Manage benchmark results")
	.addCommand(
		new Command("list")
			.description("List stored benchmark results")
			.option("-p, --profile <profile>", "Filter by profile")
			.action(async (options) => {
				await listResults(options)
			}),
	)
	.addCommand(
		new Command("show")
			.description("Show specific benchmark result")
			.argument("<id>", "Result ID to show")
			.option("-v, --verbose", "Verbose output")
			.action(async (id, options) => {
				await showResult(id, options)
			}),
	)
	.addCommand(
		new Command("latest")
			.description("Show latest benchmark result")
			.option("-v, --verbose", "Verbose output")
			.action(async (options) => {
				await showLatestResult(options)
			}),
	)
	.addCommand(
		new Command("clear")
			.description("Clear all stored results")
			.option("-f, --force", "Force clear without confirmation")
			.action(async (options) => {
				await clearResults(options)
			}),
	)

// Matrix command - run tests against multiple profiles
program
	.command("matrix")
	.description("Run tests against multiple profiles")
	.option("-t, --tests <tests...>", "Specific test cases to run (default: all)")
	.option("-p, --profiles <profiles...>", "Profiles to test against", ["mercury-coder", "gpt4o-mini"])
	.option("--timeout <ms>", "Timeout per test in milliseconds", "30000")
	.option("-v, --verbose", "Verbose output")
	.option("-o, --output <file>", "Output file for results")
	.option("--format <format>", "Output format: table, json", "table")
	.option("--no-save", "Disable automatic result persistence")
	.action(async (options) => {
		await runMatrix(options)
	})

/**
 * Run benchmarks with specified options
 */
async function runBenchmarks(options: any) {
	const spinner = ora("Initializing benchmark runner...").start()

	try {
		// Validate API key for live mode
		if (!process.env.OPENROUTER_API_KEY) {
			throw new Error("OPENROUTER_API_KEY environment variable required")
		}

		// Create benchmark runner
		const runner = new BenchmarkRunner()

		spinner.text = "Loading test cases..."

		// Build benchmark options
		const benchmarkOptions: BenchmarkOptions = {
			profile: options.profile,
			testCases: options.tests,
			categories: options.categories,
			timeout: parseInt(options.timeout),
			verbose: options.verbose,
			outputFormat: options.format,
			outputFile: options.output,
			autoSave: !options.noSave, // Enable auto-save unless --no-save is specified
		}

		spinner.succeed("Benchmark runner initialized")

		// Only show startup info if not JSON format
		if (options.format !== "json") {
			// Run benchmarks
			console.log(chalk.blue("\n🚀 Starting Ghost Benchmark Run"))
			console.log(chalk.gray(`Profile: ${options.profile}`))

			if (options.tests) {
				console.log(chalk.gray(`Test cases: ${options.tests.join(", ")}`))
			}
			if (options.categories) {
				console.log(chalk.gray(`Categories: ${options.categories.join(", ")}`))
			}
		}

		const summary = await runner.runAllTests(benchmarkOptions)

		// Display results
		displayResults(summary, options)

		// Save output to specific file if requested (in addition to auto-save)
		if (options.output) {
			await saveResults(summary, options.output, options.format)
		}

		// Exit with appropriate code
		process.exit(summary.failedTests > 0 ? 1 : 0)
	} catch (error) {
		spinner.fail(`Benchmark failed: ${error instanceof Error ? error.message : error}`)
		process.exit(1)
	}
}

/**
 * List available test cases
 */
async function listTestCases(options: any) {
	const spinner = ora("Loading test cases...").start()

	try {
		const runner = new BenchmarkRunner()
		const testInfo = await runner.getAvailableTests()

		spinner.succeed(`Found ${testInfo.testCases.length} test cases`)

		console.log(chalk.blue("\n📋 Available Test Cases"))
		console.log(chalk.gray("─".repeat(50)))

		let testCases = testInfo.testCases

		// Filter by category if specified
		if (options.category) {
			testCases = testCases.filter((tc) => tc.category === options.category)
			console.log(chalk.yellow(`Filtered by category: ${options.category}`))
		}

		// Group by category
		const categorized = testCases.reduce(
			(acc, tc) => {
				if (!acc[tc.category]) acc[tc.category] = []
				acc[tc.category].push(tc)
				return acc
			},
			{} as Record<string, typeof testCases>,
		)

		for (const [category, tests] of Object.entries(categorized)) {
			console.log(chalk.cyan(`\n📁 ${category.toUpperCase()}`))
			for (const test of tests) {
				console.log(`  🟢 ${test.name}`)
				if (options.verbose) {
					console.log(`    ${chalk.gray(test.description)}`)
				}
			}
		}

		if (options.stats) {
			console.log(chalk.blue("\n📊 Statistics"))
			console.log(chalk.gray("─".repeat(30)))
			console.log(`Total test cases: ${testInfo.statistics.totalTestCases}`)
			console.log(`Categories: ${testInfo.categories.join(", ")}`)
			console.log(`New format: ${testInfo.statistics.formatBreakdown.newFormat}`)
			console.log(`Legacy format: ${testInfo.statistics.formatBreakdown.legacyFormat}`)
			console.log(`With cursor markers: ${testInfo.statistics.cursorMarkerStats.hasCursor}`)
			console.log(`Without cursor markers: ${testInfo.statistics.cursorMarkerStats.noCursor}`)
		}
	} catch (error) {
		spinner.fail(`Failed to list test cases: ${error instanceof Error ? error.message : error}`)
		process.exit(1)
	}
}

/**
 * Validate test case structure
 */
async function validateTestCases(testCase?: string) {
	const spinner = ora("Validating test cases...").start()

	try {
		const loader = new TestCaseLoader()

		if (testCase) {
			// Validate specific test case
			spinner.text = `Validating ${testCase}...`
			const tc = await loader.loadTestCase(testCase)
			loader.validateTestCase(tc)
			spinner.succeed(`✅ ${testCase} is valid`)
		} else {
			// Validate all test cases
			const testCases = await loader.loadAllTestCases()
			let validCount = 0
			let errorCount = 0

			for (const tc of testCases) {
				try {
					loader.validateTestCase(tc)
					validCount++
				} catch (error) {
					console.log(chalk.red(`❌ ${tc.metadata.name}: ${error instanceof Error ? error.message : error}`))
					errorCount++
				}
			}

			if (errorCount === 0) {
				spinner.succeed(`✅ All ${validCount} test cases are valid`)
			} else {
				spinner.warn(`⚠️  ${validCount} valid, ${errorCount} errors`)
				process.exit(1)
			}
		}
	} catch (error) {
		spinner.fail(`Validation failed: ${error instanceof Error ? error.message : error}`)
		process.exit(1)
	}
}

/**
 * Run matrix of tests against multiple profiles
 */
async function runMatrix(options: any) {
	const spinner = ora("Initializing matrix benchmark...").start()

	try {
		// Validate API key for live mode
		if (!process.env.OPENROUTER_API_KEY) {
			throw new Error("OPENROUTER_API_KEY environment variable required")
		}

		// Create benchmark runner
		const runner = new BenchmarkRunner()

		spinner.text = "Loading available tests and profiles..."

		// Get available tests
		const testInfo = await runner.getAvailableTests()
		const availableTests = testInfo.testCases.map((tc) => tc.name)

		// Determine which tests to run
		const testsToRun = options.tests || availableTests
		const profilesToTest = options.profiles || ["mercury-coder"]

		// Validate test names
		const invalidTests = testsToRun.filter((test: string) => !availableTests.includes(test))
		if (invalidTests.length > 0) {
			throw new Error(`Invalid test cases: ${invalidTests.join(", ")}. Available: ${availableTests.join(", ")}`)
		}

		const totalCombinations = testsToRun.length * profilesToTest.length

		spinner.succeed("Matrix benchmark initialized")

		console.log(chalk.blue("\n🔄 Starting Matrix Benchmark Run"))
		console.log(chalk.gray(`Tests: ${testsToRun.join(", ")}`))
		console.log(chalk.gray(`Profiles: ${profilesToTest.join(", ")}`))
		console.log(chalk.gray(`Total combinations: ${totalCombinations}`))

		// Run matrix
		const results: any[] = []
		let completed = 0

		for (const testName of testsToRun) {
			for (const profile of profilesToTest) {
				const testSpinner = ora(`Running ${testName} with ${profile}...`).start()

				try {
					// Build benchmark options for this combination
					const benchmarkOptions: BenchmarkOptions = {
						profile: profile,
						testCases: [testName],
						timeout: parseInt(options.timeout),
						verbose: false, // Keep individual tests quiet
						outputFormat: "console",
						autoSave: !options.noSave, // Enable auto-save unless --no-save is specified
					}

					const summary = await runner.runAllTests(benchmarkOptions)
					const result = summary.results[0] // Should be exactly one result

					results.push({
						testName,
						profile,
						passed: result?.passed || false,
						executionTime: result?.executionTime || 0,
						error: result?.error,
					})

					completed++
					const progress = Math.round((completed / totalCombinations) * 100)

					if (result?.passed) {
						testSpinner.succeed(`✅ ${testName} + ${profile} (${result.executionTime}ms) [${progress}%]`)
					} else {
						testSpinner.fail(
							`❌ ${testName} + ${profile} - ${result?.error || "Unknown error"} [${progress}%]`,
						)
					}
				} catch (error) {
					completed++
					const progress = Math.round((completed / totalCombinations) * 100)
					testSpinner.fail(
						`❌ ${testName} + ${profile} - ${error instanceof Error ? error.message : error} [${progress}%]`,
					)

					results.push({
						testName,
						profile,
						passed: false,
						executionTime: 0,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}
		}

		// Display matrix results
		displayMatrixResults(results, testsToRun, profilesToTest, options)

		// Save output if requested
		if (options.output) {
			await saveMatrixResults(results, options.output, options.format)
		}

		// Exit with appropriate code
		const failedCount = results.filter((r) => !r.passed).length
		process.exit(failedCount > 0 ? 1 : 0)
	} catch (error) {
		spinner.fail(`Matrix benchmark failed: ${error instanceof Error ? error.message : error}`)
		process.exit(1)
	}
}

/**
 * Show test case statistics
 */
async function showStatistics() {
	const spinner = ora("Calculating statistics...").start()

	try {
		const loader = new TestCaseLoader()
		const stats = await loader.getStatistics()

		spinner.succeed("Statistics calculated")

		console.log(chalk.blue("\n📊 Test Case Statistics"))
		console.log(chalk.gray("─".repeat(40)))

		console.log(`📋 Total Test Cases: ${chalk.cyan(stats.totalTestCases)}`)

		console.log("\n📁 Categories:")
		Object.entries(stats.categoriesBreakdown)
			.sort(([, a], [, b]) => b - a)
			.forEach(([category, count]) => {
				console.log(`  ${category}: ${chalk.cyan(count)}`)
			})

		console.log("\n🏗️  Format Distribution:")
		console.log(`  New multi-file format: ${chalk.green(stats.formatBreakdown.newFormat)}`)
		console.log(`  Legacy single-file format: ${chalk.yellow(stats.formatBreakdown.legacyFormat)}`)
	} catch (error) {
		spinner.fail(`Failed to calculate statistics: ${error instanceof Error ? error.message : error}`)
		process.exit(1)
	}
}

/**
 * Display benchmark results
 */
function displayResults(summary: BenchmarkSummary, options: any) {
	if (options.format === "json") {
		// Output clean JSON for programmatic consumption
		console.log(JSON.stringify(summary, null, 2))
		return
	}

	// Human-readable format
	console.log(chalk.blue("\n📊 Benchmark Results"))
	console.log(chalk.gray("═".repeat(50)))

	// Summary stats
	console.log(`\n📈 Summary:`)
	console.log(`  ✅ Passed: ${chalk.green(summary.passedTests)}`)
	console.log(`  ❌ Failed: ${summary.failedTests > 0 ? chalk.red(summary.failedTests) : summary.failedTests}`)
	console.log(`  📊 Pass Rate: ${chalk.cyan(`${summary.passRate.toFixed(1)}%`)}`)
	console.log(`  ⏱️  Total Time: ${chalk.gray(`${summary.totalExecutionTime}ms`)}`)
	console.log(`  ⚡ Avg Time: ${chalk.gray(`${summary.averageExecutionTime.toFixed(0)}ms`)}`)

	// Semantic similarity removed - scoring approach TBD

	if (summary.totalTokensUsed > 0) {
		console.log(`  🔢 Tokens Used: ${chalk.gray(summary.totalTokensUsed)}`)
	}

	// Category breakdown
	const categoryStats = summary.results.reduce(
		(acc, result) => {
			const category = result.testCase.metadata.category
			if (!acc[category]) acc[category] = { passed: 0, failed: 0 }
			if (result.passed) {
				acc[category].passed++
			} else {
				acc[category].failed++
			}
			return acc
		},
		{} as Record<string, { passed: number; failed: number }>,
	)

	console.log(`\n📁 Category Breakdown:`)
	Object.entries(categoryStats).forEach(([category, stats]) => {
		const total = stats.passed + stats.failed
		const rate = total > 0 ? ((stats.passed / total) * 100).toFixed(0) : "0"
		const indicator = stats.failed === 0 ? "✅" : stats.passed > stats.failed ? "⚠️ " : "❌"
		console.log(`  ${indicator} ${category}: ${stats.passed}/${total} (${rate}%)`)
	})

	// Failed tests details
	if (summary.errors.length > 0) {
		console.log(chalk.red("\n❌ Failed Tests:"))
		summary.errors.forEach((error) => {
			console.log(`  • ${error.testName}: ${chalk.gray(error.error)}`)
		})
	}

	// Verbose results
	if (options.verbose && summary.results.length > 0) {
		console.log(chalk.blue("\n📋 Detailed Results:"))
		summary.results.forEach((result) => {
			const status = result.passed ? chalk.green("✅ PASS") : chalk.red("❌ FAIL")
			console.log(`\n${status} ${result.testCase.metadata.name}`)
			console.log(`  ⏱️  ${result.executionTime}ms`)

			if (result.metrics) {
				console.log(`  ⚡ Response time: ${result.metrics.responseTime}ms`)
				if (result.metrics.tokensUsed) {
					console.log(`  🔢 Tokens used: ${result.metrics.tokensUsed}`)
				}
			}

			if (!result.passed && result.error) {
				console.log(`  ❌ Error: ${chalk.gray(result.error)}`)
			}
		})
	}
}

/**
 * Save results to file
 */
async function saveResults(summary: BenchmarkSummary, outputPath: string, format: string) {
	const fs = await import("fs")

	try {
		let content: string

		switch (format) {
			case "json":
				content = JSON.stringify(summary, null, 2)
				break

			case "html":
				content = generateHTMLReport(summary)
				break

			default:
				content = generateTextReport(summary)
		}

		fs.writeFileSync(outputPath, content)
		console.log(chalk.green(`\n💾 Results saved to ${outputPath}`))
	} catch (error) {
		console.error(chalk.red(`Failed to save results: ${error}`))
	}
}

/**
 * List stored benchmark results
 */
async function listResults(options: any) {
	const runner = new BenchmarkRunner()
	const storage = runner.getResultStorage()

	try {
		const runs = storage.listRuns()

		if (runs.length === 0) {
			console.log(chalk.yellow("No stored benchmark results found."))
			console.log(chalk.gray("Run some benchmarks to generate results."))
			return
		}

		// Filter by profile if specified
		const filteredRuns = options.profile ? runs.filter((run) => run.profile === options.profile) : runs

		if (filteredRuns.length === 0) {
			console.log(chalk.yellow(`No results found for profile: ${options.profile}`))
			return
		}

		console.log(chalk.blue("\n📊 Stored Benchmark Results"))
		console.log(chalk.gray("─".repeat(60)))

		filteredRuns.forEach((run, index) => {
			const date = new Date(run.timestamp).toLocaleDateString()
			const time = new Date(run.timestamp).toLocaleTimeString()
			console.log(`${index + 1}. ${chalk.cyan(run.id)}`)
			console.log(`   Profile: ${chalk.green(run.profile)}`)
			console.log(`   Date: ${chalk.gray(`${date} ${time}`)}`)
			console.log()
		})

		const stats = storage.getStats()
		console.log(chalk.blue("📈 Statistics:"))
		console.log(`Total runs: ${stats.totalRuns}`)
		Object.entries(stats.profileCounts).forEach(([profile, count]) => {
			console.log(`${profile}: ${count} runs`)
		})
	} catch (error) {
		console.error(chalk.red("Failed to list results:"), error)
		process.exit(1)
	}
}

/**
 * Show specific benchmark result
 */
async function showResult(id: string, options: any) {
	const runner = new BenchmarkRunner()
	const storage = runner.getResultStorage()

	try {
		const run = storage.loadRun(id)

		if (!run) {
			console.error(chalk.red(`Result not found: ${id}`))
			process.exit(1)
		}

		console.log(chalk.blue(`\n📊 Benchmark Result: ${run.id}`))
		console.log(chalk.gray("═".repeat(60)))

		// Display summary using existing display function
		displayResults(run.summary, { format: "table", verbose: options.verbose })

		console.log(chalk.blue("\n🔧 Environment:"))
		console.log(`Kilo Code Version: ${run.environment.kilocodeVersion}`)
		console.log(`Node Version: ${run.environment.nodeVersion}`)
		console.log(`Timestamp: ${new Date(run.timestamp).toLocaleString()}`)
	} catch (error) {
		console.error(chalk.red("Failed to show result:"), error)
		process.exit(1)
	}
}

/**
 * Show latest benchmark result
 */
async function showLatestResult(options: any) {
	const runner = new BenchmarkRunner()
	const storage = runner.getResultStorage()

	try {
		const run = storage.loadLatest()

		if (!run) {
			console.log(chalk.yellow("No benchmark results found."))
			console.log(chalk.gray("Run some benchmarks to generate results."))
			return
		}

		console.log(chalk.blue(`\n📊 Latest Benchmark Result: ${run.id}`))
		console.log(chalk.gray("═".repeat(60)))

		// Display summary using existing display function
		displayResults(run.summary, { format: "table", verbose: options.verbose })

		console.log(chalk.blue("\n🔧 Environment:"))
		console.log(`Profile: ${chalk.green(run.profile)}`)
		console.log(`Kilo Code Version: ${run.environment.kilocodeVersion}`)
		console.log(`Node Version: ${run.environment.nodeVersion}`)
		console.log(`Timestamp: ${new Date(run.timestamp).toLocaleString()}`)
	} catch (error) {
		console.error(chalk.red("Failed to show latest result:"), error)
		process.exit(1)
	}
}

/**
 * Clear all stored results
 */
async function clearResults(options: any) {
	const runner = new BenchmarkRunner()
	const storage = runner.getResultStorage()

	try {
		if (!options.force) {
			// Simple confirmation (in a real CLI you might use inquirer)
			console.log(chalk.yellow("⚠️  This will delete all stored benchmark results."))
			console.log(chalk.gray("Use --force to skip this confirmation."))
			return
		}

		storage.clear()
		console.log(chalk.green("✅ All benchmark results cleared."))
	} catch (error) {
		console.error(chalk.red("Failed to clear results:"), error)
		process.exit(1)
	}
}

/**
 * Generate HTML report
 */
function generateHTMLReport(summary: BenchmarkSummary): string {
	// TODO: Generate comprehensive HTML report
	// For now, return basic HTML structure
	return `
<!DOCTYPE html>
<html>
<head>
  <title>Ghost Benchmark Results</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; }
    .pass { color: #22c55e; }
    .fail { color: #ef4444; }
  </style>
</head>
<body>
  <h1>Ghost Benchmark Results</h1>
  <div class="summary">
    <h2>Summary</h2>
    <p>Passed: <span class="pass">${summary.passedTests}</span></p>
    <p>Failed: <span class="fail">${summary.failedTests}</span></p>
    <p>Pass Rate: ${summary.passRate.toFixed(1)}%</p>
    <p>Total Time: ${summary.totalExecutionTime}ms</p>
  </div>
  <!-- TODO: Add detailed test results -->
</body>
</html>`
}

/**
 * Generate text report
 */
function generateTextReport(summary: BenchmarkSummary): string {
	let report = "Ghost Benchmark Results\n"
	report += "=".repeat(50) + "\n\n"
	report += `Passed: ${summary.passedTests}\n`
	report += `Failed: ${summary.failedTests}\n`
	report += `Pass Rate: ${summary.passRate.toFixed(1)}%\n`
	report += `Total Time: ${summary.totalExecutionTime}ms\n`
	report += `Average Time: ${summary.averageExecutionTime.toFixed(0)}ms\n\n`

	if (summary.errors.length > 0) {
		report += "Failed Tests:\n"
		summary.errors.forEach((error) => {
			report += `  ${error.testName}: ${error.error}\n`
		})
	}

	return report
}

/**
 * Display matrix benchmark results in a table format
 */
function displayMatrixResults(results: any[], tests: string[], profiles: string[], options: any) {
	console.log(chalk.blue("\n📊 Matrix Benchmark Results"))
	console.log(chalk.gray("═".repeat(60)))

	// Calculate summary stats
	const totalTests = results.length
	const passedTests = results.filter((r) => r.passed).length
	const failedTests = totalTests - passedTests
	const passRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0
	const avgTime = totalTests > 0 ? results.reduce((sum, r) => sum + r.executionTime, 0) / totalTests : 0

	console.log(`\n📈 Matrix Summary:`)
	console.log(`  ✅ Passed: ${chalk.green(passedTests)}/${totalTests}`)
	console.log(`  ❌ Failed: ${failedTests > 0 ? chalk.red(failedTests) : failedTests}`)
	console.log(`  📊 Pass Rate: ${chalk.cyan(`${passRate.toFixed(1)}%`)}`)
	console.log(`  ⚡ Avg Time: ${chalk.gray(`${avgTime.toFixed(0)}ms`)}`)

	// Create matrix table
	console.log(chalk.blue("\n📋 Matrix Results:"))

	// Header row
	const headerRow = ["Test Case", ...profiles, "Test Score"].map((h) => h.padEnd(15)).join(" | ")
	console.log(chalk.gray(headerRow))
	console.log(chalk.gray("─".repeat(headerRow.length)))

	// Data rows
	for (const testName of tests) {
		const testResults = results.filter((r) => r.testName === testName)
		const testPassed = testResults.filter((r) => r.passed).length
		const testTotal = testResults.length
		const testScore = testTotal > 0 ? Math.round((testPassed / testTotal) * 100) : 0

		const row = [
			testName.padEnd(15),
			...profiles.map((profile) => {
				const result = testResults.find((r) => r.profile === profile)
				const status = result?.passed ? chalk.green("✅") : chalk.red("❌")
				return status.padEnd(15)
			}),
			`${testPassed}/${testTotal} (${testScore}%)`.padEnd(15),
		].join(" | ")

		console.log(row)
	}

	// Profile summary
	console.log(chalk.blue("\n🤖 Profile Performance:"))
	for (const profile of profiles) {
		const profileResults = results.filter((r) => r.profile === profile)
		const profilePassed = profileResults.filter((r) => r.passed).length
		const profileTotal = profileResults.length
		const profileScore = profileTotal > 0 ? Math.round((profilePassed / profileTotal) * 100) : 0
		const profileAvgTime =
			profileTotal > 0 ? profileResults.reduce((sum, r) => sum + r.executionTime, 0) / profileTotal : 0

		console.log(
			`  ${profile}: ${profilePassed}/${profileTotal} (${profileScore}%) - ${profileAvgTime.toFixed(0)}ms avg`,
		)
	}

	// Failed tests details
	const failedResults = results.filter((r) => !r.passed)
	if (failedResults.length > 0) {
		console.log(chalk.red("\n❌ Failed Combinations:"))
		failedResults.forEach((result) => {
			console.log(`  • ${result.testName} + ${result.profile}: ${chalk.gray(result.error || "Unknown error")}`)
		})
	}
}

/**
 * Save matrix results to file
 */
async function saveMatrixResults(results: any[], outputPath: string, format: string) {
	const fs = await import("fs")

	try {
		let content: string

		switch (format) {
			case "json":
				content = JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2)
				break

			case "html":
				content = generateMatrixHTMLReport(results)
				break

			default:
				content = generateMatrixTextReport(results)
		}

		fs.writeFileSync(outputPath, content)
		console.log(chalk.green(`\n💾 Matrix results saved to ${outputPath}`))
	} catch (error) {
		console.error(chalk.red(`Failed to save matrix results: ${error}`))
	}
}

/**
 * Generate HTML report for matrix results
 */
function generateMatrixHTMLReport(results: any[]): string {
	const passedCount = results.filter((r) => r.passed).length
	const totalCount = results.length
	const passRate = totalCount > 0 ? (passedCount / totalCount) * 100 : 0

	return `
<!DOCTYPE html>
<html>
<head>
	 <title>Ghost Matrix Benchmark Results</title>
	 <style>
	   body { font-family: Arial, sans-serif; margin: 40px; }
	   .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
	   .matrix-table { border-collapse: collapse; width: 100%; }
	   .matrix-table th, .matrix-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
	   .matrix-table th { background-color: #f2f2f2; }
	   .pass { color: #22c55e; font-weight: bold; }
	   .fail { color: #ef4444; font-weight: bold; }
	 </style>
</head>
<body>
	 <h1>Ghost Matrix Benchmark Results</h1>
	 <div class="summary">
	   <h2>Summary</h2>
	   <p>Total Combinations: ${totalCount}</p>
	   <p>Passed: <span class="pass">${passedCount}</span></p>
	   <p>Failed: <span class="fail">${totalCount - passedCount}</span></p>
	   <p>Pass Rate: ${passRate.toFixed(1)}%</p>
	 </div>
	 <h2>Detailed Results</h2>
	 <table class="matrix-table">
	   <thead>
	     <tr><th>Test Case</th><th>Profile</th><th>Status</th><th>Time (ms)</th><th>Error</th></tr>
	   </thead>
	   <tbody>
	     ${results
				.map(
					(r) => `
	       <tr>
	         <td>${r.testName}</td>
	         <td>${r.profile}</td>
	         <td class="${r.passed ? "pass" : "fail"}">${r.passed ? "PASS" : "FAIL"}</td>
	         <td>${r.executionTime}</td>
	         <td>${r.error || ""}</td>
	       </tr>
	     `,
				)
				.join("")}
	   </tbody>
	 </table>
</body>
</html>`
}

/**
 * Generate text report for matrix results
 */
function generateMatrixTextReport(results: any[]): string {
	const passedCount = results.filter((r) => r.passed).length
	const totalCount = results.length
	const passRate = totalCount > 0 ? (passedCount / totalCount) * 100 : 0

	let report = "Ghost Matrix Benchmark Results\n"
	report += "=".repeat(50) + "\n\n"
	report += `Total Combinations: ${totalCount}\n`
	report += `Passed: ${passedCount}\n`
	report += `Failed: ${totalCount - passedCount}\n`
	report += `Pass Rate: ${passRate.toFixed(1)}%\n\n`

	report += "Detailed Results:\n"
	report += "-".repeat(50) + "\n"
	results.forEach((result) => {
		const status = result.passed ? "PASS" : "FAIL"
		report += `${result.testName} + ${result.profile}: ${status} (${result.executionTime}ms)\n`
		if (result.error) {
			report += `  Error: ${result.error}\n`
		}
	})

	return report
}

// Parse command line arguments
program.parse()
