import { MercuryStrategy } from "../strategies/MercuryStrategy"
import { GhostSuggestionContext } from "../types"
import { MockWorkspace } from "./MockWorkspace"
import { GhostInlineProvider } from "../GhostInlineProvider"
import * as vscode from "vscode"
import fs from "fs"
import path from "path"

// Standard cursor marker (U+2423 OPEN BOX)
const CURSOR_MARKER = "␣"

// Legacy cursor markers for backward compatibility
const LEGACY_MARKERS = ["<|cursor|>", "<| cursor |>"]

interface TestCaseMetadata {
	name: string
	description: string
	category: string
	expectedGroupCount?: number
	expectedSelectedGroup?: number
	shouldCompile?: boolean
	hadCursorInOriginal?: boolean
}

interface FileMap {
	[filename: string]: string
}

interface TestCaseData {
	// Multi-file inputs
	inputFiles: FileMap
	activeFile: string
	inputContent: string // Content of active file with cursor removed
	cursorPosition: vscode.Position

	// Response and expected data
	mercuryResponse: string
	expectedFiles: FileMap
	expectedContent: string // Expected content for active file

	// Metadata
	metadata: TestCaseMetadata
}

/**
 * Enhanced test framework for file-based Mercury tests.
 * Supports multi-file test cases with standardized cursor markers.
 */
export class MercuryFileBasedTestFramework {
	private strategy: MercuryStrategy
	private mockWorkspace: MockWorkspace
	private inlineProvider: GhostInlineProvider

	constructor() {
		this.strategy = new MercuryStrategy()
		this.mockWorkspace = new MockWorkspace()
		this.inlineProvider = GhostInlineProvider.getInstance()
	}

	/**
	 * Find cursor position in multi-file input
	 */
	private findCursorInFiles(files: FileMap): { activeFile: string; cursorIndex: number; cursorMarker: string } {
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
	 * Load test case from new multi-file structure or legacy structure
	 */
	loadTestCase(testCaseDir: string): TestCaseData {
		// Check if this is new format (has src/ directory) or legacy format
		const srcDir = path.join(testCaseDir, "src")
		const isNewFormat = fs.existsSync(srcDir)

		if (isNewFormat) {
			return this.loadNewFormatTestCase(testCaseDir)
		} else {
			return this.loadLegacyFormatTestCase(testCaseDir)
		}
	}

	/**
	 * Load test case from new multi-file structure
	 */
	private loadNewFormatTestCase(testCaseDir: string): TestCaseData {
		// Load metadata
		const metadataPath = path.join(testCaseDir, "metadata.json")
		const metadata: TestCaseMetadata = fs.existsSync(metadataPath)
			? JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
			: { name: path.basename(testCaseDir), description: "Test case", category: "general" }

		// Load input files from src/
		const srcDir = path.join(testCaseDir, "src")
		const inputFiles: FileMap = {}

		if (fs.existsSync(srcDir)) {
			const srcFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".js") || f.endsWith(".ts"))
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
		const cursorPosition = new vscode.Position(cursorLine, cursorCharacter)

		// Update input files with clean content
		inputFiles[activeFile] = cleanContent

		// Load Mercury response (try mercury-coder.txt first, fall back to response.txt)
		const responsesDir = path.join(testCaseDir, "responses")
		let mercuryResponse = ""

		const responseFiles = ["mercury-coder.txt", "response.txt"]
		for (const responseFile of responseFiles) {
			const responsePath = path.join(responsesDir, responseFile)
			if (fs.existsSync(responsePath)) {
				mercuryResponse = fs.readFileSync(responsePath, "utf-8")
				break
			}
		}

		if (!mercuryResponse) {
			throw new Error(`No response file found in ${responsesDir}`)
		}

		// Load expected files
		const expectedDir = path.join(testCaseDir, "expected")
		const expectedFiles: FileMap = {}

		if (fs.existsSync(expectedDir)) {
			const expectedFileList = fs.readdirSync(expectedDir).filter((f) => f.endsWith(".js") || f.endsWith(".ts"))
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
			mercuryResponse,
			expectedFiles,
			expectedContent,
			metadata,
		}
	}

	/**
	 * Load test case from legacy single-file structure (for backward compatibility)
	 */
	private loadLegacyFormatTestCase(testCaseDir: string): TestCaseData {
		const inputContent = fs.readFileSync(path.join(testCaseDir, "input.js"), "utf-8")
		const mercuryResponse = fs.readFileSync(path.join(testCaseDir, "response.txt"), "utf-8")
		const expectedContent = fs.readFileSync(path.join(testCaseDir, "expected.js"), "utf-8")

		// Extract cursor position from input (handle legacy formats)
		const allMarkers = [CURSOR_MARKER, ...LEGACY_MARKERS]
		let cursorIndex = -1
		let cursorMarker = ""

		for (const marker of allMarkers) {
			cursorIndex = inputContent.indexOf(marker)
			if (cursorIndex !== -1) {
				cursorMarker = marker
				break
			}
		}

		const cleanInput = cursorIndex !== -1 ? inputContent.replace(cursorMarker, "") : inputContent

		// Calculate cursor line and character
		const beforeCursor = cursorIndex !== -1 ? inputContent.slice(0, cursorIndex) : ""
		const lines = beforeCursor.split("\n")
		const cursorLine = lines.length - 1
		const cursorCharacter = lines[lines.length - 1].length

		// Create metadata for legacy format
		const metadata: TestCaseMetadata = {
			name: path.basename(testCaseDir),
			description: `Legacy test case: ${path.basename(testCaseDir)}`,
			category: "legacy",
			hadCursorInOriginal: cursorIndex !== -1,
		}

		return {
			inputFiles: { "main.js": cleanInput },
			activeFile: "main.js",
			inputContent: cleanInput,
			cursorPosition: new vscode.Position(cursorLine, cursorCharacter),
			mercuryResponse,
			expectedFiles: { "main.js": expectedContent },
			expectedContent,
			metadata,
		}
	}

	/**
	 * Process Mercury response and return comprehensive analysis
	 */
	async processMercuryResponse(testCase: TestCaseData) {
		console.log("🧪 Processing Mercury Test Case")
		console.log(`📁 Test: ${testCase.metadata.name} (${testCase.metadata.category})`)
		console.log(`📄 Active File: ${testCase.activeFile}`)
		console.log(`📝 Input Content: ${testCase.inputContent.slice(0, 100)}...`)
		console.log("🤖 Mercury Response:", testCase.mercuryResponse.slice(0, 200) + "...")
		console.log(
			"📍 Cursor Position:",
			`Line ${testCase.cursorPosition.line}, Char ${testCase.cursorPosition.character}`,
		)

		// Clear previous workspace state
		this.mockWorkspace.clear()

		// Create mock documents for all input files
		const documents: { [filename: string]: vscode.TextDocument } = {}
		let activeDocument: vscode.TextDocument | null = null

		for (const [filename, content] of Object.entries(testCase.inputFiles)) {
			const uri = vscode.Uri.file(filename)
			const document = this.mockWorkspace.addDocument(uri, content)
			documents[filename] = document

			if (filename === testCase.activeFile) {
				activeDocument = document
			}
		}

		if (!activeDocument) {
			throw new Error(`Active file ${testCase.activeFile} not found in mock workspace`)
		}

		// Create context with cursor position on active document
		const context: GhostSuggestionContext = {
			document: activeDocument,
			range: new vscode.Range(testCase.cursorPosition, testCase.cursorPosition),
			diagnostics: [],
		}

		// Initialize and process Mercury response
		this.strategy.initializeProcessing(context)
		this.strategy.processResponseChunk(testCase.mercuryResponse)
		const finalResult = this.strategy.finishProcessing()

		if (!finalResult.hasNewSuggestions || !finalResult.suggestions) {
			throw new Error("Mercury processing failed - no suggestions generated")
		}

		// Get suggestion groups
		const files = finalResult.suggestions.getFiles()
		const file = files[0] // Focus on primary file
		const groups = file.getGroupsOperations()
		const selectedGroupIndex = file.getSelectedGroup()

		console.log("📊 Groups Analysis:")
		groups.forEach((group, i) => {
			console.log(`  Group ${i}: ${group.map((op) => `${op.type}@${op.line}`).join("")}`)
			console.log(`    Content: ${group.map((op) => JSON.stringify(op.content)).join(", ")}`)
		})
		console.log(`🎯 Selected Group: ${selectedGroupIndex}`)

		return {
			finalResult,
			file,
			groups,
			selectedGroupIndex,
			// Test inline vs decorator decision
			inlineDecisions: groups.map((group, index) => ({
				groupIndex: index,
				isInlineSuitable: this.inlineProvider.isGroupSuitableForInline(
					group,
					testCase.cursorPosition,
					activeDocument,
				),
				group,
			})),
		}
	}

	/**
	 * Run complete test analysis with expectations - supports both new and legacy test formats
	 */
	async runTestCase(
		testCaseName: string,
		expectations?: {
			expectedGroupCount?: number
			expectedSelectedGroup?: number
			expectedInlineGroups?: number[]
			expectedDecoratorGroups?: number[]
			expectedFirstGroupContent?: string
		},
	) {
		// Try migrated test cases first, fall back to legacy
		let testCaseDir = path.join(__dirname, "__test_cases_migrated__", testCaseName)
		if (!fs.existsSync(testCaseDir)) {
			testCaseDir = path.join(__dirname, "__test_cases__", testCaseName)
			console.log(`📋 Loading legacy test case: ${testCaseName}`)
		} else {
			console.log(`📋 Loading migrated test case: ${testCaseName}`)
		}

		const testCase = this.loadTestCase(testCaseDir)
		const analysis = await this.processMercuryResponse(testCase)

		console.log("🔍 Test Analysis Complete:")
		console.log(`  Test: ${testCase.metadata.name}`)
		console.log(`  Category: ${testCase.metadata.category}`)
		console.log(`  Active File: ${testCase.activeFile}`)
		console.log(`  Total Groups: ${analysis.groups.length}`)
		console.log(`  Selected Group: ${analysis.selectedGroupIndex}`)
		console.log(
			`  Inline Suitable Groups: ${analysis.inlineDecisions.filter((d) => d.isInlineSuitable).map((d) => d.groupIndex)}`,
		)
		console.log(
			`  Decorator Groups: ${analysis.inlineDecisions.filter((d) => !d.isInlineSuitable).map((d) => d.groupIndex)}`,
		)

		// Validate expectations from metadata if provided
		const metadataExpectations = testCase.metadata
		if (metadataExpectations.expectedGroupCount !== undefined) {
			console.log(
				`✓ Expected Group Count: ${metadataExpectations.expectedGroupCount} (actual: ${analysis.groups.length})`,
			)
		}
		if (metadataExpectations.expectedSelectedGroup !== undefined) {
			console.log(
				`✓ Expected Selected Group: ${metadataExpectations.expectedSelectedGroup} (actual: ${analysis.selectedGroupIndex})`,
			)
		}

		// Return results for testing
		return {
			testCase,
			analysis,
			expectations: expectations || metadataExpectations,
		}
	}

	/**
	 * Run test case from specific directory (for direct testing)
	 */
	async runTestCaseFromDirectory(testCaseDir: string, expectations?: any) {
		console.log(`📋 Loading test case from: ${testCaseDir}`)

		const testCase = this.loadTestCase(testCaseDir)
		const analysis = await this.processMercuryResponse(testCase)

		console.log("🔍 Direct Test Analysis Complete:")
		console.log(`  Test: ${testCase.metadata.name}`)
		console.log(
			`  Format: ${fs.existsSync(path.join(testCaseDir, "src")) ? "New Multi-file" : "Legacy Single-file"}`,
		)
		console.log(`  Active File: ${testCase.activeFile}`)
		console.log(`  Total Groups: ${analysis.groups.length}`)
		console.log(`  Selected Group: ${analysis.selectedGroupIndex}`)

		return {
			testCase,
			analysis,
			expectations,
		}
	}
}
