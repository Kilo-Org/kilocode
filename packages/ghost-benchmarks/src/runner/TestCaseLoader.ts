import fs from "fs"
import path from "path"
import type { BenchmarkTestCase, TestCaseMetadata, FileMap } from "../types/BenchmarkTypes"

// Use process.cwd() for bundled environment
const __dirname = process.cwd()

// Standard cursor marker (U+2423 OPEN BOX)
const CURSOR_MARKER = "␣"

// Legacy cursor markers for backward compatibility
const LEGACY_MARKERS = ["<|cursor|>", "<| cursor |>"]

/**
 * Enhanced test case loader that supports both new multi-file and legacy single-file formats
 */
export class TestCaseLoader {
	private testCasesDir: string

	constructor(testCasesDir?: string) {
		// Default to test cases directory in the benchmark package
		this.testCasesDir = testCasesDir || path.join(process.cwd(), "test-cases")
	}

	/**
	 * Load all available test cases
	 */
	async loadAllTestCases(): Promise<BenchmarkTestCase[]> {
		const testCases: BenchmarkTestCase[] = []

		if (!fs.existsSync(this.testCasesDir)) {
			throw new Error(`Test cases directory not found: ${this.testCasesDir}`)
		}

		const entries = fs.readdirSync(this.testCasesDir, { withFileTypes: true })
		const testCaseDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

		for (const testCaseName of testCaseDirs) {
			try {
				const testCase = await this.loadTestCase(testCaseName)
				testCases.push(testCase)
			} catch (error) {
				console.warn(`Failed to load test case ${testCaseName}:`, error)
			}
		}

		return testCases
	}

	/**
	 * Load specific test case by name
	 */
	async loadTestCase(testCaseName: string): Promise<BenchmarkTestCase> {
		const testCaseDir = path.join(this.testCasesDir, testCaseName)

		if (!fs.existsSync(testCaseDir)) {
			throw new Error(`Test case directory not found: ${testCaseDir}`)
		}

		return this.loadMultiFileTestCase(testCaseDir)
	}

	/**
	 * Load test case from multi-file structure
	 */
	private loadMultiFileTestCase(testCaseDir: string): BenchmarkTestCase {
		// Load metadata
		const metadataPath = path.join(testCaseDir, "metadata.json")
		const metadata: TestCaseMetadata = fs.existsSync(metadataPath)
			? JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
			: {
					name: path.basename(testCaseDir),
					description: "Test case",
					category: "general",
				}

		// Load input files from src/
		const srcDir = path.join(testCaseDir, "src")
		const inputFiles: FileMap = {}

		if (fs.existsSync(srcDir)) {
			const srcFiles = fs
				.readdirSync(srcDir)
				.filter((f) => f.endsWith(".js") || f.endsWith(".ts") || f.endsWith(".jsx") || f.endsWith(".tsx"))
			for (const filename of srcFiles) {
				inputFiles[filename] = fs.readFileSync(path.join(srcDir, filename), "utf-8")
			}
		}

		if (Object.keys(inputFiles).length === 0) {
			throw new Error(`No input files found in ${srcDir}`)
		}

		// Find cursor position
		const { activeFile, cursorIndex, cursorMarker } = this.findCursorInFiles(inputFiles)
		const rawContent = inputFiles[activeFile]
		const cleanContent = rawContent.replace(cursorMarker, "")

		// Calculate cursor position
		const beforeCursor = rawContent.slice(0, cursorIndex)
		const lines = beforeCursor.split("\n")
		const cursorLine = lines.length - 1
		const cursorCharacter = lines[lines.length - 1].length
		const cursorPosition = { line: cursorLine, character: cursorCharacter }

		// Update input files with clean content
		inputFiles[activeFile] = cleanContent

		// Load expected files
		const expectedDir = path.join(testCaseDir, "expected")
		const expectedFiles: FileMap = {}

		if (fs.existsSync(expectedDir)) {
			const expectedFileList = fs
				.readdirSync(expectedDir)
				.filter((f) => f.endsWith(".js") || f.endsWith(".ts") || f.endsWith(".jsx") || f.endsWith(".tsx"))
			for (const filename of expectedFileList) {
				expectedFiles[filename] = fs.readFileSync(path.join(expectedDir, filename), "utf-8")
			}
		}

		// Get expected content for active file
		const expectedContent = expectedFiles[activeFile] || cleanContent

		return {
			inputFiles,
			activeFile,
			inputContent: cleanContent,
			cursorPosition,
			expectedFiles,
			expectedContent,
			metadata,
		}
	}

	/**
	 * Find cursor position in multi-file input
	 */
	private findCursorInFiles(files: FileMap): {
		activeFile: string
		cursorIndex: number
		cursorMarker: string
	} {
		// First check for standard cursor marker
		for (const [filename, content] of Object.entries(files)) {
			const cursorIndex = content.indexOf(CURSOR_MARKER)
			if (cursorIndex !== -1) {
				return { activeFile: filename, cursorIndex, cursorMarker: CURSOR_MARKER }
			}
		}

		// Fall back to legacy markers for backward compatibility
		for (const marker of LEGACY_MARKERS) {
			for (const [filename, content] of Object.entries(files)) {
				const cursorIndex = content.indexOf(marker)
				if (cursorIndex !== -1) {
					return { activeFile: filename, cursorIndex, cursorMarker: marker }
				}
			}
		}

		throw new Error(
			"No cursor marker found in any input file. Expected exactly one file to contain ␣ cursor marker.",
		)
	}

	/**
	 * Validate test case structure
	 */
	validateTestCase(testCase: BenchmarkTestCase): void {
		const errors: string[] = []

		// Check required fields
		if (!testCase.activeFile) {
			errors.push("Missing activeFile")
		}

		if (!testCase.inputFiles[testCase.activeFile]) {
			errors.push(`Active file ${testCase.activeFile} not found in inputFiles`)
		}

		if (!testCase.metadata?.name) {
			errors.push("Missing test case name in metadata")
		}

		if (errors.length > 0) {
			throw new Error(`Test case validation failed: ${errors.join(", ")}`)
		}
	}

	/**
	 * Get test cases by category
	 */
	async loadTestCasesByCategory(category: string): Promise<BenchmarkTestCase[]> {
		const allTestCases = await this.loadAllTestCases()
		return allTestCases.filter((tc) => tc.metadata.category === category)
	}

	/**
	 * Get available categories
	 */
	async getAvailableCategories(): Promise<string[]> {
		const allTestCases = await this.loadAllTestCases()
		const categories = new Set(allTestCases.map((tc) => tc.metadata.category))
		return Array.from(categories).sort()
	}

	/**
	 * Get test case statistics
	 */
	async getStatistics(): Promise<{
		totalTestCases: number
		categoriesBreakdown: { [category: string]: number }
		formatBreakdown: { newFormat: number; legacyFormat: number }
	}> {
		const allTestCases = await this.loadAllTestCases()

		const categoriesBreakdown: { [category: string]: number } = {}
		let newFormat = 0
		let legacyFormat = 0

		for (const testCase of allTestCases) {
			// Category breakdown
			const category = testCase.metadata.category
			categoriesBreakdown[category] = (categoriesBreakdown[category] || 0) + 1

			// Format breakdown
			if (testCase.metadata.category === "legacy") {
				legacyFormat++
			} else {
				newFormat++
			}
		}

		return {
			totalTestCases: allTestCases.length,
			categoriesBreakdown,
			formatBreakdown: { newFormat, legacyFormat },
		}
	}
}
