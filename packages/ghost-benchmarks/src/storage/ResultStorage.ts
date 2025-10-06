import fs from "fs"
import path from "path"
import type { BenchmarkSummary, BenchmarkResult } from "../types/BenchmarkTypes"

// Use process.cwd() for bundled environment
const __dirname = process.cwd()

export interface BenchmarkRun {
	id: string // timestamp-based
	timestamp: string
	profile: string
	testResults: BenchmarkResult[]
	summary: BenchmarkSummary
	environment: {
		kilocodeVersion: string
		nodeVersion: string
	}
}

/**
 * ResultStorage handles persistent storage of benchmark results to JSON files
 * Enables CLI-first architecture with web interface reading from stored results
 */
export class ResultStorage {
	private resultsDir: string

	constructor(resultsDir?: string) {
		this.resultsDir = resultsDir || path.join(__dirname, "results")
		this.ensureResultsDirectory()
	}

	/**
	 * Save benchmark run to JSON file with timestamp-based filename
	 */
	saveRun(summary: BenchmarkSummary, profile: string): string {
		const timestamp = new Date().toISOString()
		const id = `benchmark-${timestamp.replace(/[:.]/g, "-")}`

		const benchmarkRun: BenchmarkRun = {
			id,
			timestamp,
			profile,
			testResults: summary.results,
			summary,
			environment: {
				kilocodeVersion: this.getKilocodeVersion(),
				nodeVersion: process.version,
			},
		}

		const filename = `${id}.json`
		const filepath = path.join(this.resultsDir, filename)

		fs.writeFileSync(filepath, JSON.stringify(benchmarkRun, null, 2))

		// Save completion files for investigation
		this.saveCompletionFiles(benchmarkRun)

		// Update latest symlink/copy
		this.updateLatest(benchmarkRun)

		console.log(`💾 Results saved to ${path.relative(process.cwd(), filepath)}`)
		return filepath
	}

	/**
	 * Load benchmark run by ID
	 */
	loadRun(id: string): BenchmarkRun | null {
		const filepath = path.join(this.resultsDir, `${id}.json`)

		if (!fs.existsSync(filepath)) {
			return null
		}

		try {
			const content = fs.readFileSync(filepath, "utf-8")
			return JSON.parse(content)
		} catch (error) {
			console.warn(`Failed to load benchmark run ${id}:`, error)
			return null
		}
	}

	/**
	 * Load latest benchmark run
	 */
	loadLatest(): BenchmarkRun | null {
		const latestPath = path.join(this.resultsDir, "latest.json")

		if (!fs.existsSync(latestPath)) {
			return null
		}

		try {
			const content = fs.readFileSync(latestPath, "utf-8")
			return JSON.parse(content)
		} catch (error) {
			console.warn("Failed to load latest benchmark run:", error)
			return null
		}
	}

	/**
	 * List all available benchmark runs
	 */
	listRuns(): Array<{ id: string; timestamp: string; profile: string }> {
		if (!fs.existsSync(this.resultsDir)) {
			return []
		}

		const files = fs
			.readdirSync(this.resultsDir)
			.filter((file) => file.startsWith("benchmark-") && file.endsWith(".json"))
			.map((file) => {
				try {
					const content = fs.readFileSync(path.join(this.resultsDir, file), "utf-8")
					const run = JSON.parse(content)
					return {
						id: run.id,
						timestamp: run.timestamp,
						profile: run.profile,
					}
				} catch (error) {
					console.warn(`Failed to parse ${file}:`, error)
					return null
				}
			})
			.filter(Boolean) as Array<{ id: string; timestamp: string; profile: string }>

		// Sort by timestamp, newest first
		return files.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
	}

	/**
	 * Get historical results for a specific profile
	 */
	getProfileHistory(profileName: string): BenchmarkRun[] {
		const allRuns = this.listRuns()
		return allRuns
			.filter((run) => run.profile === profileName)
			.map((run) => this.loadRun(run.id))
			.filter(Boolean) as BenchmarkRun[]
	}

	/**
	 * Clear all stored results
	 */
	clear(): void {
		if (fs.existsSync(this.resultsDir)) {
			const files = fs.readdirSync(this.resultsDir)
			for (const file of files) {
				fs.unlinkSync(path.join(this.resultsDir, file))
			}
			console.log("🧹 All benchmark results cleared")
		}
	}

	/**
	 * Save actual completion files for investigation (separate from JSON metadata)
	 */
	private saveCompletionFiles(benchmarkRun: BenchmarkRun): void {
		const completionsDir = path.join(this.resultsDir, "completions", benchmarkRun.id)
		const profileDir = path.join(completionsDir, benchmarkRun.profile)

		// Ensure directories exist
		fs.mkdirSync(profileDir, { recursive: true })

		// Save completion files for each test result
		for (const result of benchmarkRun.testResults) {
			const testDir = path.join(profileDir, result.testCase.metadata.name)
			fs.mkdirSync(testDir, { recursive: true })

			// Save input file with cursor marker
			const inputContent = this.addCursorMarker(result.testCase.inputContent, result.testCase.cursorPosition)
			fs.writeFileSync(path.join(testDir, "input.js"), inputContent)

			// Save raw LLM response
			const rawResponse = result.rawResponse || "No response"
			fs.writeFileSync(path.join(testDir, "raw-response.md"), rawResponse)

			// Save generated content (what Ghost processed)
			const generatedContent = result.suggestions
				? `Suggestions generated: ${result.suggestions.hasSuggestions()}`
				: "No suggestions generated"
			fs.writeFileSync(path.join(testDir, "generated-content.md"), generatedContent)

			// Try to extract just the code part for comparison
			const extractedCode = this.extractCodeFromResponse(rawResponse)
			if (extractedCode) {
				fs.writeFileSync(path.join(testDir, "extracted-code.js"), extractedCode)
			}

			// Save metadata for this specific test
			const testMetadata = {
				testCase: result.testCase.metadata.name,
				profile: benchmarkRun.profile,
				passed: result.passed,
				executionTime: result.executionTime,
				inputFile: result.testCase.activeFile,
				cursorPosition: result.testCase.cursorPosition,
				timestamp: benchmarkRun.timestamp,
			}
			fs.writeFileSync(path.join(testDir, "metadata.json"), JSON.stringify(testMetadata, null, 2))
		}

		console.log(`📁 Completion files saved to completions/${benchmarkRun.id}/${benchmarkRun.profile}/`)
	}

	/**
	 * Add cursor marker back to input content for investigation
	 */
	private addCursorMarker(content: string, cursorPosition: { line: number; character: number }): string {
		const lines = content.split("\n")
		if (cursorPosition.line < lines.length) {
			const line = lines[cursorPosition.line]
			const beforeCursor = line.substring(0, cursorPosition.character)
			const afterCursor = line.substring(cursorPosition.character)
			lines[cursorPosition.line] = beforeCursor + "␣" + afterCursor // cursor marker
		}
		return lines.join("\n")
	}

	/**
	 * Try to extract just the code from LLM responses for comparison
	 */
	private extractCodeFromResponse(response: string): string | null {
		// Try to extract from ```javascript blocks
		const codeBlockMatch = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i)
		if (codeBlockMatch) {
			return codeBlockMatch[1].trim()
		}

		// Try to extract from <COMPLETION> tags (hole filler)
		const completionMatch = response.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)
		if (completionMatch) {
			return completionMatch[1].trim()
		}

		// If response looks like pure code (no explanatory text), return as-is
		if (response.trim().length < 200 && !response.includes("Here") && !response.includes("You can")) {
			return response.trim()
		}

		return null
	}

	/**
	 * Get storage statistics
	 */
	getStats(): {
		totalRuns: number
		oldestRun?: string
		newestRun?: string
		profileCounts: Record<string, number>
	} {
		const runs = this.listRuns()
		const profileCounts: Record<string, number> = {}

		for (const run of runs) {
			profileCounts[run.profile] = (profileCounts[run.profile] || 0) + 1
		}

		return {
			totalRuns: runs.length,
			oldestRun: runs.length > 0 ? runs[runs.length - 1].timestamp : undefined,
			newestRun: runs.length > 0 ? runs[0].timestamp : undefined,
			profileCounts,
		}
	}

	/**
	 * Ensure results directory exists with .gitignore
	 */
	private ensureResultsDirectory(): void {
		if (!fs.existsSync(this.resultsDir)) {
			fs.mkdirSync(this.resultsDir, { recursive: true })
		}

		// Create .gitignore to ignore result files
		const gitignorePath = path.join(this.resultsDir, ".gitignore")
		if (!fs.existsSync(gitignorePath)) {
			fs.writeFileSync(gitignorePath, "*.json\n!.gitignore\n")
		}
	}

	/**
	 * Update latest.json with most recent run
	 */
	private updateLatest(benchmarkRun: BenchmarkRun): void {
		const latestPath = path.join(this.resultsDir, "latest.json")
		fs.writeFileSync(latestPath, JSON.stringify(benchmarkRun, null, 2))
	}

	/**
	 * Get Kilo Code version (placeholder - could read from package.json)
	 */
	private getKilocodeVersion(): string {
		try {
			// Try to read version from workspace package.json
			const packagePath = path.join(__dirname, "../../../package.json")
			if (fs.existsSync(packagePath)) {
				const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"))
				return pkg.version || "unknown"
			}
		} catch (error) {
			// Fallback
		}
		return "4.97.1" // Fallback version
	}
}
