// npx vitest src/core/tools/__tests__/readFileTool.spec.ts

import * as path from "path"

import { countFileLines } from "../../../integrations/misc/line-counter"
import { readLines } from "../../../integrations/misc/read-lines"
import { extractTextFromFile } from "../../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../../services/tree-sitter"
import { isBinaryFile } from "isbinaryfile"
import { ReadFileToolUse, ToolParamName, ToolResponse } from "../../../shared/tools"
import { readFileTool } from "../ReadFileTool"

vi.mock("path", async () => {
	const originalPath = await vi.importActual("path")
	return {
		default: originalPath,
		...originalPath,
		resolve: vi.fn().mockImplementation((...args) => args.join("/")),
	}
})

// Already mocked above with hoisted fsPromises

vi.mock("isbinaryfile")

vi.mock("../../../integrations/misc/line-counter")
vi.mock("../../../integrations/misc/read-lines")

// Mock fs/promises readFile for image tests
const fsPromises = vi.hoisted(() => ({
	readFile: vi.fn(),
	stat: vi.fn().mockResolvedValue({ size: 1024 }),
}))
vi.mock("fs/promises", () => fsPromises)

// Mock input content for tests
let mockInputContent = ""

// Create hoisted mocks that can be used in vi.mock factories
const { addLineNumbersMock, mockReadFileWithTokenBudget } = vi.hoisted(() => {
	const addLineNumbersMock = vi.fn().mockImplementation((text: string, startLine = 1) => {
		if (!text) return ""
		const lines = typeof text === "string" ? text.split("\n") : [text]
		return lines.map((line: string, i: number) => `${startLine + i} | ${line}`).join("\n")
	})
	const mockReadFileWithTokenBudget = vi.fn()
	return { addLineNumbersMock, mockReadFileWithTokenBudget }
})

// First create all the mocks
vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn(),
	addLineNumbers: addLineNumbersMock,
	getSupportedBinaryFormats: vi.fn(() => [".pdf", ".docx", ".ipynb"]),
}))
vi.mock("../../../services/tree-sitter")

// Mock readFileWithTokenBudget - must be mocked to prevent actual file system access
vi.mock("../../../integrations/misc/read-file-with-budget", () => ({
	readFileWithTokenBudget: (...args: any[]) => mockReadFileWithTokenBudget(...args),
}))

const extractTextFromFileMock = vi.fn()
const getSupportedBinaryFormatsMock = vi.fn(() => [".pdf", ".docx", ".ipynb"])

// Mock formatResponse - use vi.hoisted to ensure mocks are available before vi.mock
const { toolResultMock, imageBlocksMock } = vi.hoisted(() => {
	const toolResultMock = vi.fn((text: string, images?: string[]) => {
		if (images && images.length > 0) {
			return [
				{ type: "text", text },
				...images.map((img) => {
					const [header, data] = img.split(",")
					const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
					return { type: "image", source: { type: "base64", media_type, data } }
				}),
			]
		}
		return text
	})
	const imageBlocksMock = vi.fn((images?: string[]) => {
		return images
			? images.map((img) => {
					const [header, data] = img.split(",")
					const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
					return { type: "image", source: { type: "base64", media_type, data } }
				})
			: []
	})
	return { toolResultMock, imageBlocksMock }
})

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolDenied: vi.fn(() => "The user denied this operation."),
		toolDeniedWithFeedback: vi.fn(
			(feedback?: string) =>
				`The user denied this operation and provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`,
		),
		toolApprovedWithFeedback: vi.fn(
			(feedback?: string) =>
				`The user approved this operation and provided the following context:\n<feedback>\n${feedback}\n</feedback>`,
		),
		rooIgnoreError: vi.fn(
			(path: string) =>
				`Access to ${path} is blocked by the .kilocodeignore file settings. You must try to continue in the task without using this file, or ask the user to update the .kilocodeignore file.`,
		),
		toolResult: toolResultMock,
		imageBlocks: imageBlocksMock,
	},
}))

vi.mock("../../ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		initialize() {
			return Promise.resolve()
		}
		validateAccess() {
			return true
		}
	},
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockReturnValue(true),
}))

// Global beforeEach to ensure clean mock state between all test suites
beforeEach(() => {
	// NOTE: Removed vi.clearAllMocks() to prevent interference with setImageSupport calls
	// Instead, individual suites clear their specific mocks to maintain isolation

	// Explicitly reset the hoisted mock implementations to prevent cross-suite pollution
	toolResultMock.mockImplementation((text: string, images?: string[]) => {
		if (images && images.length > 0) {
			return [
				{ type: "text", text },
				...images.map((img) => {
					const [header, data] = img.split(",")
					const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
					return { type: "image", source: { type: "base64", media_type, data } }
				}),
			]
		}
		return text
	})

	imageBlocksMock.mockImplementation((images?: string[]) => {
		return images
			? images.map((img) => {
					const [header, data] = img.split(",")
					const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
					return { type: "image", source: { type: "base64", media_type, data } }
				})
			: []
	})

	// Reset addLineNumbers mock to its default implementation (prevents cross-test pollution)
	addLineNumbersMock.mockReset()
	addLineNumbersMock.mockImplementation((text: string, startLine = 1) => {
		if (!text) return ""
		const lines = typeof text === "string" ? text.split("\n") : [text]
		return lines.map((line: string, i: number) => `${startLine + i} | ${line}`).join("\n")
	})

	// Reset readFileWithTokenBudget mock with default implementation
	mockReadFileWithTokenBudget.mockClear()
	mockReadFileWithTokenBudget.mockImplementation(async (_filePath: string, _options: any) => {
		// Default: return the mockInputContent with 5 lines
		const lines = mockInputContent ? mockInputContent.split("\n") : []
		return {
			content: mockInputContent,
			tokenCount: mockInputContent.length / 4, // rough estimate
			lineCount: lines.length,
			complete: true,
		}
	})
})

// Mock i18n translation function
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, params?: Record<string, any>) => {
		// Map translation keys to English text
		const translations: Record<string, string> = {
			"tools:readFile.imageWithSize": "Image file ({{size}} KB)",
			"tools:readFile.imageTooLarge":
				"Image file is too large ({{size}}). The maximum allowed size is {{max}} MB.",
			"tools:readFile.linesRange": " (lines {{start}}-{{end}})",
			"tools:readFile.definitionsOnly": " (definitions only)",
			"tools:readFile.maxLines": " (max {{max}} lines)",
		}

		let result = translations[key] || key

		// Simple template replacement
		if (params) {
			Object.entries(params).forEach(([param, value]) => {
				result = result.replace(new RegExp(`{{${param}}}`, "g"), String(value))
			})
		}

		return result
	}),
}))

// Shared mock setup function to ensure consistent state across all test suites
function createMockCline(): any {
	const mockProvider = {
		getState: vi.fn(),
		deref: vi.fn().mockReturnThis(),
	}

	const mockCline: any = {
		cwd: "/",
		task: "Test",
		providerRef: mockProvider,
		rooIgnoreController: {
			validateAccess: vi.fn().mockReturnValue(true),
		},
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		presentAssistantMessage: vi.fn(),
		handleError: vi.fn().mockResolvedValue(undefined),
		pushToolResult: vi.fn(),
		removeClosingTag: vi.fn((tag, content) => content),
		fileContextTracker: {
			trackFileContext: vi.fn().mockResolvedValue(undefined),
		},
		recordToolUsage: vi.fn().mockReturnValue(undefined),
		recordToolError: vi.fn().mockReturnValue(undefined),
		didRejectTool: false,
		getTokenUsage: vi.fn().mockReturnValue({
			contextTokens: 10000,
		}),
		apiConfiguration: {
			apiProvider: "anthropic",
		},
		// CRITICAL: Always ensure image support is enabled
		api: {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: {
					supportsImages: true,
					contextWindow: 200000,
					maxTokens: 4096,
					supportsPromptCache: false,
					supportsNativeTools: false,
				},
			}),
			countTokens: vi.fn().mockResolvedValue(100), // Mock countTokens to return a small number
		},
	}

	return { mockCline, mockProvider }
}

// Helper function to set image support without affecting shared state
function setImageSupport(mockCline: any, supportsImages: boolean | undefined): void {
	mockCline.api = {
		getModel: vi.fn().mockReturnValue({
			id: "test-model",
			info: { supportsImages },
		}),
		countTokens: vi.fn().mockResolvedValue(100), // Mock countTokens to return a small number
	}
}

describe("read_file tool with maxReadFileLine setting", () => {
	// Test data
	const testFilePath = "test/file.txt"
	const absoluteFilePath = "/test/file.txt"
	const fileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
	const numberedFileContent = "1 | Line 1\n2 | Line 2\n3 | Line 3\n4 | Line 4\n5 | Line 5\n"
	const sourceCodeDef = "\n\n# file.txt\n1--5 | Content"

	// Mocked functions with correct types
	const mockedCountFileLines = vi.mocked(countFileLines)
	const mockedReadLines = vi.mocked(readLines)
	const mockedExtractTextFromFile = vi.mocked(extractTextFromFile)
	const mockedParseSourceCodeDefinitionsForFile = vi.mocked(parseSourceCodeDefinitionsForFile)

	const mockedIsBinaryFile = vi.mocked(isBinaryFile)
	const mockedPathResolve = vi.mocked(path.resolve)

	let mockCline: any
	let mockProvider: any
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		// Clear specific mocks (not all mocks to preserve shared state)
		mockedCountFileLines.mockClear()
		mockedExtractTextFromFile.mockClear()
		mockedIsBinaryFile.mockClear()
		mockedPathResolve.mockClear()
		addLineNumbersMock.mockClear()
		extractTextFromFileMock.mockClear()
		toolResultMock.mockClear()

		// Use shared mock setup function
		const mocks = createMockCline()
		mockCline = mocks.mockCline
		mockProvider = mocks.mockProvider

		// Explicitly disable image support for text file tests to prevent cross-suite pollution
		setImageSupport(mockCline, false)

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedIsBinaryFile.mockResolvedValue(false)

		// Mock fsPromises.stat to return a file (not directory) by default
		fsPromises.stat.mockResolvedValue({
			isDirectory: () => false,
			isFile: () => true,
			isSymbolicLink: () => false,
		} as any)

		mockInputContent = fileContent

		// Setup the extractTextFromFile mock implementation with the current mockInputContent
		// Reset the spy before each test
		addLineNumbersMock.mockClear()

		// Setup the extractTextFromFile mock to call our spy
		mockedExtractTextFromFile.mockImplementation((_filePath) => {
			// Call the spy and return its result
			return Promise.resolve(addLineNumbersMock(mockInputContent))
		})

		toolResult = undefined
	})

	/**
	 * Helper function to execute the read file tool with different maxReadFileLine settings
	 */
	async function executeReadFileTool(
		params: Partial<ReadFileToolUse["params"]> = {},
		options: {
			maxReadFileLine?: number
			totalLines?: number
			skipAddLineNumbersCheck?: boolean // Flag to skip addLineNumbers check
			path?: string
			start_line?: string
			end_line?: string
		} = {},
	): Promise<ToolResponse | undefined> {
		// Configure mocks based on test scenario
		const maxReadFileLine = options.maxReadFileLine ?? 500
		const totalLines = options.totalLines ?? 5

		mockProvider.getState.mockResolvedValue({ maxReadFileLine, maxImageFileSize: 20, maxTotalImageSize: 20 })
		mockedCountFileLines.mockResolvedValue(totalLines)

		// Reset the spy before each test
		addLineNumbersMock.mockClear()

		// Format args string based on params
		let argsContent = `<file><path>${options.path || testFilePath}</path>`
		if (options.start_line && options.end_line) {
			argsContent += `<line_range>${options.start_line}-${options.end_line}</line_range>`
		}
		argsContent += `</file>`

		// Create a tool use object
		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { args: argsContent, ...params },
			partial: false,
		}

		await readFileTool.handle(mockCline, toolUse, {
			askApproval: mockCline.ask,
			handleError: vi.fn(),
			pushToolResult: (result: ToolResponse) => {
				toolResult = result
			},
			removeClosingTag: (_: ToolParamName, content?: string) => content ?? "",
			toolProtocol: "xml",
		})

		return toolResult
	}

	describe("when maxReadFileLine is negative", () => {
		it("should read the entire file using extractTextFromFile", async () => {
			// Setup - use default mockInputContent
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: -1 })

			// Verify - check that the result contains the expected native format elements
			expect(result).toContain(`File: ${testFilePath}`)
			expect(result).toContain(`Lines 1-5:`)
		})

		it("should not show line snippet in approval message when maxReadFileLine is -1", async () => {
			// This test verifies the line snippet behavior for the approval message
			// Setup - use default mockInputContent
			mockInputContent = fileContent

			// Execute - we'll reuse executeReadFileTool to run the tool
			await executeReadFileTool({}, { maxReadFileLine: -1 })

			// Verify the empty line snippet for full read was passed to the approval message
			// Look at the parameters passed to the 'ask' method in the approval message
			const askCall = mockCline.ask.mock.calls[0]
			const completeMessage = JSON.parse(askCall[1])

			// Verify the reason (lineSnippet) is empty or undefined for full read
			expect(completeMessage.reason).toBeFalsy()
		})
	})

	describe("when maxReadFileLine is 0", () => {
		it("should return an empty content with source code definitions", async () => {
			// Setup - for maxReadFileLine = 0, the implementation won't call readLines
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(sourceCodeDef)

			// Execute - skip addLineNumbers check as it's not called for maxReadFileLine=0
			const result = await executeReadFileTool(
				{},
				{
					maxReadFileLine: 0,
					totalLines: 5,
					skipAddLineNumbersCheck: true,
				},
			)

			// Verify - native format
			expect(result).toContain(`File: ${testFilePath}`)
			expect(result).toContain(`Code Definitions:`)

			// Verify native structure
			expect(result).toContain("Note: Showing only 0 of 5 total lines")
			expect(result).toContain(sourceCodeDef.trim())
			expect(result).not.toContain("Lines 1-") // No content when maxReadFileLine is 0
		})
	})

	describe("when maxReadFileLine is less than file length", () => {
		it("should read only maxReadFileLine lines and add source code definitions", async () => {
			// Setup
			const content = "Line 1\nLine 2\nLine 3"
			const numberedContent = "1 | Line 1\n2 | Line 2\n3 | Line 3"
			mockedReadLines.mockResolvedValue(content)
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(sourceCodeDef)

			// Setup addLineNumbers to always return numbered content
			addLineNumbersMock.mockReturnValue(numberedContent)

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 3 })

			// Verify - native format
			expect(result).toContain(`File: ${testFilePath}`)
			expect(result).toContain(`Lines 1-3:`)
			expect(result).toContain(`Code Definitions:`)
			expect(result).toContain("Note: Showing only 3 of 5 total lines")
		})

		it("should truncate code definitions when file exceeds maxReadFileLine", async () => {
			// Setup - file with 100 lines but we'll only read first 30
			const content = "Line 1\nLine 2\nLine 3"
			const numberedContent = "1 | Line 1\n2 | Line 2\n3 | Line 3"
			const fullDefinitions = `# file.txt
10--20 | function foo() {
50--60 | function bar() {
80--90 | function baz() {`
			const truncatedDefinitions = `# file.txt
10--20 | function foo() {`

			mockedReadLines.mockResolvedValue(content)
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(fullDefinitions)
			addLineNumbersMock.mockReturnValue(numberedContent)

			// Execute with maxReadFileLine = 30
			const result = await executeReadFileTool({}, { maxReadFileLine: 30, totalLines: 100 })

			// Verify - native format
			expect(result).toContain(`File: ${testFilePath}`)
			expect(result).toContain(`Lines 1-30:`)
			expect(result).toContain(`Code Definitions:`)

			// Should include foo (starts at line 10) but not bar (starts at line 50) or baz (starts at line 80)
			expect(result).toContain("10--20 | function foo()")
			expect(result).not.toContain("50--60 | function bar()")
			expect(result).not.toContain("80--90 | function baz()")

			expect(result).toContain("Note: Showing only 30 of 100 total lines")
		})

		it("should handle truncation when all definitions are beyond the line limit", async () => {
			// Setup - all definitions start after maxReadFileLine
			const content = "Line 1\nLine 2\nLine 3"
			const numberedContent = "1 | Line 1\n2 | Line 2\n3 | Line 3"
			const fullDefinitions = `# file.txt
50--60 | function foo() {
80--90 | function bar() {`

			mockedReadLines.mockResolvedValue(content)
			mockedParseSourceCodeDefinitionsForFile.mockResolvedValue(fullDefinitions)
			addLineNumbersMock.mockReturnValue(numberedContent)

			// Execute with maxReadFileLine = 30
			const result = await executeReadFileTool({}, { maxReadFileLine: 30, totalLines: 100 })

			// Verify - native format
			expect(result).toContain(`File: ${testFilePath}`)
			expect(result).toContain(`Lines 1-30:`)
			expect(result).toContain(`Code Definitions:`)
			expect(result).toContain("# file.txt")
			expect(result).not.toContain("50--60 | function foo()")
			expect(result).not.toContain("80--90 | function bar()")
		})
	})

	describe("when maxReadFileLine equals or exceeds file length", () => {
		it("should use extractTextFromFile when maxReadFileLine > totalLines", async () => {
			// Setup
			mockedCountFileLines.mockResolvedValue(5) // File shorter than maxReadFileLine
			mockInputContent = fileContent

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 10, totalLines: 5 })

			// Verify - native format
			expect(result).toContain(`File: ${testFilePath}`)
			expect(result).toContain(`Lines 1-5:`)
		})

		it("should read with extractTextFromFile when file has few lines", async () => {
			// Setup
			mockedCountFileLines.mockResolvedValue(3) // File shorter than maxReadFileLine
			const threeLineContent = "Line 1\nLine 2\nLine 3"
			mockInputContent = threeLineContent

			// Configure the mock to return the correct content for this test
			mockReadFileWithTokenBudget.mockResolvedValueOnce({
				content: threeLineContent,
				tokenCount: threeLineContent.length / 4,
				lineCount: 3,
				complete: true,
			})

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 5, totalLines: 3 })

			// Verify - native format
			expect(result).toContain(`File: ${testFilePath}`)
			expect(result).toContain(`Lines 1-3:`)
		})
	})

	describe("when file is binary", () => {
		it("should always use extractTextFromFile regardless of maxReadFileLine", async () => {
			// Setup
			mockedIsBinaryFile.mockResolvedValue(true)
			mockedCountFileLines.mockResolvedValue(3)
			mockedExtractTextFromFile.mockResolvedValue("")

			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: 3, totalLines: 3 })

			// Verify - native format for binary files
			expect(result).toContain(`File: ${testFilePath}`)
			expect(typeof result).toBe("string")
		})
	})

	describe("with range parameters", () => {
		it("should honor start_line and end_line when provided", async () => {
			// Setup
			mockedReadLines.mockResolvedValue("Line 2\nLine 3\nLine 4")

			// Execute using executeReadFileTool with range parameters
			const rangeResult = await executeReadFileTool(
				{},
				{
					start_line: "2",
					end_line: "4",
				},
			)

			// Verify - native format
			expect(rangeResult).toContain(`File: ${testFilePath}`)
			expect(rangeResult).toContain(`Lines 2-4:`)
		})
	})
})

describe("read_file tool output structure", () => {
	// Test basic XML structure
	const testFilePath = "test/file.txt"
	const absoluteFilePath = "/test/file.txt"
	const fileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"

	const mockedCountFileLines = vi.mocked(countFileLines)
	const mockedExtractTextFromFile = vi.mocked(extractTextFromFile)
	const mockedIsBinaryFile = vi.mocked(isBinaryFile)
	const mockedPathResolve = vi.mocked(path.resolve)
	const mockedFsReadFile = vi.mocked(fsPromises.readFile)
	const imageBuffer = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		"base64",
	)

	let mockCline: any
	let mockProvider: any
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		// Clear specific mocks (not all mocks to preserve shared state)
		mockedCountFileLines.mockClear()
		mockedExtractTextFromFile.mockClear()
		mockedIsBinaryFile.mockClear()
		mockedPathResolve.mockClear()
		addLineNumbersMock.mockClear()
		extractTextFromFileMock.mockClear()
		toolResultMock.mockClear()

		// CRITICAL: Reset fsPromises mocks to prevent cross-test contamination
		fsPromises.stat.mockClear()
		fsPromises.stat.mockResolvedValue({
			size: 1024,
			isDirectory: () => false,
			isFile: () => true,
			isSymbolicLink: () => false,
		} as any)
		fsPromises.readFile.mockClear()

		// Use shared mock setup function
		const mocks = createMockCline()
		mockCline = mocks.mockCline
		mockProvider = mocks.mockProvider

		// Explicitly enable image support for this test suite (contains image memory tests)
		setImageSupport(mockCline, true)

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedIsBinaryFile.mockResolvedValue(false)

		// Set default implementation for extractTextFromFile
		mockedExtractTextFromFile.mockImplementation((filePath) => {
			return Promise.resolve(addLineNumbersMock(mockInputContent))
		})

		mockInputContent = fileContent

		// Setup mock provider with default maxReadFileLine
		mockProvider.getState.mockResolvedValue({ maxReadFileLine: -1, maxImageFileSize: 20, maxTotalImageSize: 20 }) // Default to full file read

		// Add additional properties needed for XML tests
		mockCline.sayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing required parameter")

		toolResult = undefined
	})

	async function executeReadFileTool(
		params: {
			args?: string
		} = {},
		options: {
			totalLines?: number
			maxReadFileLine?: number
			isBinary?: boolean
			validateAccess?: boolean
		} = {},
	): Promise<ToolResponse | undefined> {
		// Configure mocks based on test scenario
		const totalLines = options.totalLines ?? 5
		const maxReadFileLine = options.maxReadFileLine ?? 500
		const isBinary = options.isBinary ?? false
		const validateAccess = options.validateAccess ?? true

		mockProvider.getState.mockResolvedValue({ maxReadFileLine, maxImageFileSize: 20, maxTotalImageSize: 20 })
		mockedCountFileLines.mockResolvedValue(totalLines)
		mockedIsBinaryFile.mockResolvedValue(isBinary)
		mockCline.rooIgnoreController.validateAccess = vi.fn().mockReturnValue(validateAccess)

		let argsContent = `<file><path>${testFilePath}</path></file>`

		// Create a tool use object
		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { args: argsContent, ...params },
			partial: false,
		}

		// Execute the tool
		await readFileTool.handle(mockCline, toolUse, {
			askApproval: mockCline.ask,
			handleError: vi.fn(),
			pushToolResult: (result: ToolResponse) => {
				toolResult = result
			},
			removeClosingTag: (param: ToolParamName, content?: string) => content ?? "",
			toolProtocol: "xml",
		})

		return toolResult
	}

	describe("Basic Structure Tests", () => {
		it("should produce native output with proper format", async () => {
			// Setup
			const numberedContent = "1 | Line 1\n2 | Line 2\n3 | Line 3\n4 | Line 4\n5 | Line 5"

			// Configure mockReadFileWithTokenBudget to return the 5-line content
			mockReadFileWithTokenBudget.mockResolvedValueOnce({
				content: fileContent, // "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
				tokenCount: fileContent.length / 4,
				lineCount: 5,
				complete: true,
			})

			mockProvider.getState.mockResolvedValue({
				maxReadFileLine: -1,
				maxImageFileSize: 20,
				maxTotalImageSize: 20,
			}) // Allow up to 20MB per image and total size

			// Execute
			const result = await executeReadFileTool()

			// Verify native format
			expect(result).toBe(`File: ${testFilePath}\nLines 1-5:\n${numberedContent}`)
		})

		it("should follow the correct native structure format", async () => {
			// Setup
			mockInputContent = fileContent
			// Execute
			const result = await executeReadFileTool({}, { maxReadFileLine: -1 })

			// Verify using regex to check native structure
			const nativeStructureRegex = new RegExp(`^File: ${testFilePath}\\nLines 1-5:\\n.*$`, "s")
			expect(result).toMatch(nativeStructureRegex)
		})

		it("should handle empty files correctly", async () => {
			// Setup
			mockedCountFileLines.mockResolvedValue(0)

			// Configure mockReadFileWithTokenBudget to return empty content
			mockReadFileWithTokenBudget.mockResolvedValueOnce({
				content: "",
				tokenCount: 0,
				lineCount: 0,
				complete: true,
			})

			mockProvider.getState.mockResolvedValue({
				maxReadFileLine: -1,
				maxImageFileSize: 20,
				maxTotalImageSize: 20,
			}) // Allow up to 20MB per image and total size

			// Execute
			const result = await executeReadFileTool({}, { totalLines: 0 })

			// Verify native format for empty file
			expect(result).toBe(`File: ${testFilePath}\nNote: File is empty`)
		})

		describe("Total Image Memory Limit", () => {
			const testImages = [
				{ path: "test/image1.png", sizeKB: 5120 }, // 5MB
				{ path: "test/image2.jpg", sizeKB: 10240 }, // 10MB
				{ path: "test/image3.gif", sizeKB: 8192 }, // 8MB
			]

			// Define imageBuffer for this test suite
			const imageBuffer = Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
				"base64",
			)

			beforeEach(() => {
				// CRITICAL: Reset fsPromises mocks to prevent cross-test contamination within this suite
				fsPromises.stat.mockClear()
				fsPromises.readFile.mockClear()
			})

			async function executeReadMultipleImagesTool(imagePaths: string[]): Promise<ToolResponse | undefined> {
				// Ensure image support is enabled before calling the tool
				setImageSupport(mockCline, true)

				// Create args content for multiple files
				const filesXml = imagePaths.map((path) => `<file><path>${path}</path></file>`).join("")
				const argsContent = filesXml

				const toolUse: ReadFileToolUse = {
					type: "tool_use",
					name: "read_file",
					params: { args: argsContent },
					partial: false,
				}

				let localResult: ToolResponse | undefined
				await readFileTool.handle(mockCline, toolUse, {
					askApproval: mockCline.ask,
					handleError: vi.fn(),
					pushToolResult: (result: ToolResponse) => {
						localResult = result
					},
					removeClosingTag: (_: ToolParamName, content?: string) => content ?? "",
					toolProtocol: "xml",
				})
				// In multi-image scenarios, the result is pushed to pushToolResult, not returned directly.
				// We need to check the mock's calls to get the result.
				if (mockCline.pushToolResult.mock.calls.length > 0) {
					return mockCline.pushToolResult.mock.calls[0][0]
				}

				return localResult
			}

			it("should allow multiple images under the total memory limit", async () => {
				// Setup required mocks (don't clear all mocks - preserve API setup)
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				}) // Allow up to 20MB per image and total size

				// Setup mockCline properties (preserve existing API)
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - images that fit within 20MB limit
				const smallImages = [
					{ path: "test/small1.png", sizeKB: 2048 }, // 2MB
					{ path: "test/small2.jpg", sizeKB: 3072 }, // 3MB
					{ path: "test/small3.gif", sizeKB: 4096 }, // 4MB
				] // Total: 9MB (under 20MB limit)

				// Mock file stats for each image
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const image = smallImages.find((img) => normalizedFilePath.includes(path.normalize(img.path)))
					return Promise.resolve({ size: (image?.sizeKB || 1024) * 1024, isDirectory: () => false })
				})

				// Mock path.resolve for each image
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(smallImages.map((img) => img.path))

				// Verify all images were processed (should be a multi-part response)
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]

				// Should have text part and 3 image parts
				const textPart = parts.find((p) => p.type === "text")?.text
				const imageParts = parts.filter((p) => p.type === "image")

				expect(textPart).toBeDefined()
				expect(imageParts).toHaveLength(3)

				// Verify no memory limit notices
				expect(textPart).not.toContain("Total image memory would exceed")
			})

			it("should skip images that would exceed the total memory limit", async () => {
				// Setup required mocks (don't clear all mocks)
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 15,
					maxTotalImageSize: 20,
				}) // Allow up to 15MB per image and 20MB total size

				// Setup mockCline properties
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - images where later ones would exceed 20MB total limit
				// Each must be under 5MB per-file limit (5120KB)
				const largeImages = [
					{ path: "test/large1.png", sizeKB: 5017 }, // ~4.9MB
					{ path: "test/large2.jpg", sizeKB: 5017 }, // ~4.9MB
					{ path: "test/large3.gif", sizeKB: 5017 }, // ~4.9MB
					{ path: "test/large4.png", sizeKB: 5017 }, // ~4.9MB
					{ path: "test/large5.jpg", sizeKB: 5017 }, // ~4.9MB - This should be skipped (total would be ~24.5MB > 20MB)
				]

				// Mock file stats for each image
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const image = largeImages.find((img) => normalizedFilePath.includes(path.normalize(img.path)))
					return Promise.resolve({ size: (image?.sizeKB || 1024) * 1024, isDirectory: () => false })
				})

				// Mock path.resolve for each image
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(largeImages.map((img) => img.path))

				// Verify result structure - should be a mix of successful images and skipped notices
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]

				const textPart = Array.isArray(result) ? result.find((p) => p.type === "text")?.text : result
				const imageParts = Array.isArray(result) ? result.filter((p) => p.type === "image") : []

				expect(textPart).toBeDefined()

				// Debug: Show what we actually got vs expected
				if (imageParts.length !== 4) {
					throw new Error(
						`Expected 4 images, got ${imageParts.length}. Full result: ${JSON.stringify(result, null, 2)}. Text part: ${textPart}`,
					)
				}
				expect(imageParts).toHaveLength(4) // First 4 images should be included (~19.6MB total)

				// Verify memory limit notice for the fifth image
				expect(textPart).toContain("Image skipped to avoid size limit (20MB)")
				expect(textPart).toMatch(/Current: \d+(\.\d+)? MB/)
				expect(textPart).toMatch(/this file: \d+(\.\d+)? MB/)
			})

			it("should track memory usage correctly across multiple images", async () => {
				// Setup mocks (don't clear all mocks)

				// Setup required mocks
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 15,
					maxTotalImageSize: 20,
				}) // Allow up to 15MB per image and 20MB total size

				// Setup mockCline properties
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - images that exactly reach the limit
				const exactLimitImages = [
					{ path: "test/exact1.png", sizeKB: 10240 }, // 10MB
					{ path: "test/exact2.jpg", sizeKB: 10240 }, // 10MB - Total exactly 20MB
					{ path: "test/exact3.gif", sizeKB: 1024 }, // 1MB - This should be skipped
				]

				// Mock file stats with simpler logic
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const image = exactLimitImages.find((img) => normalizedFilePath.includes(path.normalize(img.path)))
					if (image) {
						return Promise.resolve({ size: image.sizeKB * 1024, isDirectory: () => false })
					}
					return Promise.resolve({ size: 1024 * 1024, isDirectory: () => false }) // Default 1MB
				})

				// Mock path.resolve
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(exactLimitImages.map((img) => img.path))

				// Verify
				const textPart = Array.isArray(result) ? result.find((p) => p.type === "text")?.text : result
				const imageParts = Array.isArray(result) ? result.filter((p) => p.type === "image") : []

				expect(imageParts).toHaveLength(2) // First 2 images should fit
				expect(textPart).toContain("Image skipped to avoid size limit (20MB)")
				expect(textPart).toMatch(/Current: \d+(\.\d+)? MB/)
				expect(textPart).toMatch(/this file: \d+(\.\d+)? MB/)
			})

			it("should handle individual image size limit and total memory limit together", async () => {
				// Setup mocks (don't clear all mocks)

				// Setup required mocks
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				}) // Allow up to 20MB per image and total size

				// Setup mockCline properties (complete setup)
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - mix of images with individual size violations and total memory issues
				const mixedImages = [
					{ path: "test/ok.png", sizeKB: 3072 }, // 3MB - OK
					{ path: "test/too-big.jpg", sizeKB: 6144 }, // 6MB - Exceeds individual 5MB limit
					{ path: "test/ok2.gif", sizeKB: 4096 }, // 4MB - OK individually but might exceed total
				]

				// Mock file stats
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const fileName = path.basename(filePath)
					const baseName = path.parse(fileName).name
					const image = mixedImages.find((img) => img.path.includes(baseName))
					return Promise.resolve({ size: (image?.sizeKB || 1024) * 1024, isDirectory: () => false })
				})

				// Mock provider state with 5MB individual limit
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				})

				// Mock path.resolve
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(mixedImages.map((img) => img.path))

				// Verify
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]

				const textPart = parts.find((p) => p.type === "text")?.text
				const imageParts = parts.filter((p) => p.type === "image")

				// Should have 2 images (ok.png and ok2.gif)
				expect(imageParts).toHaveLength(2)

				// Should show individual size limit violation
				expect(textPart).toMatch(
					/Image file is too large \(\d+(\.\d+)? MB\)\. The maximum allowed size is 5 MB\./,
				)
			})

			it("should correctly calculate total memory and skip the last image", async () => {
				// Setup
				const testImages = [
					{ path: "test/image1.png", sizeMB: 8 },
					{ path: "test/image2.png", sizeMB: 8 },
					{ path: "test/image3.png", sizeMB: 8 }, // This one should be skipped
				]

				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 10, // 10MB per image
					maxTotalImageSize: 20, // 20MB total
				})

				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				mockedFsReadFile.mockResolvedValue(imageBuffer)

				fsPromises.stat.mockImplementation(async (filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const file = testImages.find((f) => normalizedFilePath.includes(path.normalize(f.path)))
					if (file) {
						return { size: file.sizeMB * 1024 * 1024, isDirectory: () => false }
					}
					return { size: 1024 * 1024, isDirectory: () => false } // Default 1MB
				})

				const imagePaths = testImages.map((img) => img.path)
				const result = await executeReadMultipleImagesTool(imagePaths)

				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]
				const textPart = parts.find((p) => p.type === "text")?.text
				const imageParts = parts.filter((p) => p.type === "image")

				expect(imageParts).toHaveLength(2) // First two images should be processed
				expect(textPart).toContain("Image skipped to avoid size limit (20MB)")
				expect(textPart).toMatch(/Current: \d+(\.\d+)? MB/)
				expect(textPart).toMatch(/this file: \d+(\.\d+)? MB/)
			})

			it("should reset total memory tracking for each tool invocation", async () => {
				// Setup mocks (don't clear all mocks)

				// Setup required mocks for first batch
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)

				// Setup mockProvider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				})

				// Setup mockCline properties (complete setup)
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				// Setup - first call with images that use memory
				const firstBatch = [{ path: "test/first.png", sizeKB: 10240 }] // 10MB

				fsPromises.stat = vi.fn().mockResolvedValue({ size: 10240 * 1024, isDirectory: () => false })
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute first batch
				await executeReadMultipleImagesTool(firstBatch.map((img) => img.path))

				// Setup second batch (don't clear all mocks)
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				})

				// Reset path resolving for second batch
				mockedPathResolve.mockClear()

				// Re-setup mockCline properties for second batch (complete setup)
				mockCline.cwd = "/"
				mockCline.task = "Test"
				mockCline.providerRef = mockProvider
				mockCline.rooIgnoreController = {
					validateAccess: vi.fn().mockReturnValue(true),
				}
				mockCline.say = vi.fn().mockResolvedValue(undefined)
				mockCline.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
				mockCline.presentAssistantMessage = vi.fn()
				mockCline.handleError = vi.fn().mockResolvedValue(undefined)
				mockCline.pushToolResult = vi.fn()
				mockCline.removeClosingTag = vi.fn((tag, content) => content)
				mockCline.fileContextTracker = {
					trackFileContext: vi.fn().mockResolvedValue(undefined),
				}
				mockCline.recordToolUsage = vi.fn().mockReturnValue(undefined)
				mockCline.recordToolError = vi.fn().mockReturnValue(undefined)
				setImageSupport(mockCline, true)

				const secondBatch = [{ path: "test/second.png", sizeKB: 15360 }] // 15MB

				// Clear and reset file system mocks for second batch
				fsPromises.stat.mockClear()
				fsPromises.readFile.mockClear()
				mockedIsBinaryFile.mockClear()
				mockedCountFileLines.mockClear()

				// Reset mocks for second batch
				fsPromises.stat = vi.fn().mockResolvedValue({ size: 15360 * 1024, isDirectory: () => false })
				fsPromises.readFile.mockResolvedValue(
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						"base64",
					),
				)
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute second batch
				const result = await executeReadMultipleImagesTool(secondBatch.map((img) => img.path))

				// Verify second batch is processed successfully (memory tracking was reset)
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]
				const imageParts = parts.filter((p) => p.type === "image")

				expect(imageParts).toHaveLength(1) // Second image should be processed
			})

			it("should handle a folder with many images just under the individual size limit", async () => {
				// Setup - Create many images that are each just under the 5MB individual limit
				// but together approach the 20MB total limit
				const manyImages = [
					{ path: "test/img1.png", sizeKB: 4900 }, // 4.78MB
					{ path: "test/img2.png", sizeKB: 4900 }, // 4.78MB
					{ path: "test/img3.png", sizeKB: 4900 }, // 4.78MB
					{ path: "test/img4.png", sizeKB: 4900 }, // 4.78MB
					{ path: "test/img5.png", sizeKB: 4900 }, // 4.78MB - This should be skipped (total would be ~23.9MB)
				]

				// Setup mocks
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(imageBuffer)

				// Setup provider with 5MB individual limit and 20MB total limit
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 5,
					maxTotalImageSize: 20,
				})

				// Mock file stats for each image
				fsPromises.stat = vi.fn().mockImplementation((filePath) => {
					const normalizedFilePath = path.normalize(filePath.toString())
					const image = manyImages.find((img) => normalizedFilePath.includes(path.normalize(img.path)))
					return Promise.resolve({ size: (image?.sizeKB || 1024) * 1024, isDirectory: () => false })
				})

				// Mock path.resolve
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute
				const result = await executeReadMultipleImagesTool(manyImages.map((img) => img.path))

				// Verify
				expect(Array.isArray(result)).toBe(true)
				const parts = result as any[]
				const textPart = parts.find((p) => p.type === "text")?.text
				const imageParts = parts.filter((p) => p.type === "image")

				// Should process first 4 images (total ~19.12MB, under 20MB limit)
				expect(imageParts).toHaveLength(4)

				// Should show memory limit notice for the 5th image
				expect(textPart).toContain("Image skipped to avoid size limit (20MB)")
				expect(textPart).toContain("test/img5.png")

				// Verify memory tracking worked correctly
				// The notice should show current memory usage around 20MB (4 * 4900KB ≈ 19.14MB, displayed as 20.1MB)
				expect(textPart).toMatch(/Current: \d+(\.\d+)? MB/)
			})

			it("should reset memory tracking between separate tool invocations more explicitly", async () => {
				// This test verifies that totalImageMemoryUsed is reset between calls
				// by making two separate tool invocations and ensuring the second one
				// starts with fresh memory tracking

				// Setup mocks
				mockedIsBinaryFile.mockResolvedValue(true)
				mockedCountFileLines.mockResolvedValue(0)
				fsPromises.readFile.mockResolvedValue(imageBuffer)

				// Setup provider
				mockProvider.getState.mockResolvedValue({
					maxReadFileLine: -1,
					maxImageFileSize: 20,
					maxTotalImageSize: 20,
				})

				// First invocation - use 15MB of memory
				const firstBatch = [{ path: "test/large1.png", sizeKB: 15360 }] // 15MB

				fsPromises.stat = vi.fn().mockResolvedValue({ size: 15360 * 1024, isDirectory: () => false })
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute first batch
				const result1 = await executeReadMultipleImagesTool(firstBatch.map((img) => img.path))

				// Verify first batch processed successfully
				expect(Array.isArray(result1)).toBe(true)
				const parts1 = result1 as any[]
				const imageParts1 = parts1.filter((p) => p.type === "image")
				expect(imageParts1).toHaveLength(1)

				// Second invocation - should start with 0 memory used, not 15MB
				// If memory tracking wasn't reset, this 18MB image would be rejected
				const secondBatch = [{ path: "test/large2.png", sizeKB: 18432 }] // 18MB

				// Reset mocks for second invocation
				fsPromises.stat.mockClear()
				fsPromises.readFile.mockClear()
				mockedPathResolve.mockClear()

				fsPromises.stat = vi.fn().mockResolvedValue({ size: 18432 * 1024, isDirectory: () => false })
				fsPromises.readFile.mockResolvedValue(imageBuffer)
				mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)

				// Execute second batch
				const result2 = await executeReadMultipleImagesTool(secondBatch.map((img) => img.path))

				// Verify second batch processed successfully
				expect(Array.isArray(result2)).toBe(true)
				const parts2 = result2 as any[]
				const imageParts2 = parts2.filter((p) => p.type === "image")
				const textPart2 = parts2.find((p) => p.type === "text")?.text

				// The 18MB image should be processed successfully because memory was reset
				expect(imageParts2).toHaveLength(1)

				// Should NOT contain any memory limit notices
				expect(textPart2).not.toContain("Image skipped to avoid memory limit")

				// This proves memory tracking was reset between invocations
			})
		})
	})

	describe("Error Handling Tests", () => {
		it("should include error in output for invalid path", async () => {
			// Setup - missing path parameter
			const toolUse: ReadFileToolUse = {
				type: "tool_use",
				name: "read_file",
				params: {},
				partial: false,
			}

			// Execute the tool
			await readFileTool.handle(mockCline, toolUse, {
				askApproval: mockCline.ask,
				handleError: vi.fn(),
				pushToolResult: (result: ToolResponse) => {
					toolResult = result
				},
				removeClosingTag: (param: ToolParamName, content?: string) => content ?? "",
				toolProtocol: "xml",
			})

			// Verify - native format for error
			expect(toolResult).toBe(`Error: Missing required parameter`)
		})

		it("should include error for RooIgnore error", async () => {
			// Execute - skip addLineNumbers check as it returns early with an error
			const result = await executeReadFileTool({}, { validateAccess: false })

			// Verify - native format for error
			expect(result).toBe(
				`File: ${testFilePath}\nError: Access to ${testFilePath} is blocked by the .kilocodeignore file settings. You must try to continue in the task without using this file, or ask the user to update the .kilocodeignore file.`,
			)
		})

		it("should provide helpful error when trying to read a directory", async () => {
			// Setup - mock fsPromises.stat to indicate the path is a directory
			const dirPath = "test/my-directory"
			const absoluteDirPath = "/test/my-directory"

			mockedPathResolve.mockReturnValue(absoluteDirPath)

			// Mock fs/promises stat to return directory
			fsPromises.stat.mockResolvedValue({
				isDirectory: () => true,
				isFile: () => false,
				isSymbolicLink: () => false,
			} as any)

			// Mock isBinaryFile won't be called since we check directory first
			mockedIsBinaryFile.mockResolvedValue(false)

			// Execute
			const result = await executeReadFileTool({ args: `<file><path>${dirPath}</path></file>` })

			// Verify - native format for error
			expect(result).toContain(`File: ${dirPath}`)
			expect(result).toContain(`Error: Error reading file: Cannot read '${dirPath}' because it is a directory`)
			expect(result).toContain("use the list_files tool instead")

			// Verify that task.say was called with the error
			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Cannot read"))
			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("is a directory"))
			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("list_files tool"))
		})
	})
})

describe("read_file tool with image support", () => {
	const testImagePath = "test/image.png"
	const absoluteImagePath = "/test/image.png"
	const base64ImageData =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
	const imageBuffer = Buffer.from(base64ImageData, "base64")

	const mockedCountFileLines = vi.mocked(countFileLines)
	const mockedIsBinaryFile = vi.mocked(isBinaryFile)
	const mockedPathResolve = vi.mocked(path.resolve)
	const mockedFsReadFile = vi.mocked(fsPromises.readFile)
	const mockedExtractTextFromFile = vi.mocked(extractTextFromFile)

	let localMockCline: any
	let localMockProvider: any
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		// Clear specific mocks (not all mocks to preserve shared state)
		mockedPathResolve.mockClear()
		mockedIsBinaryFile.mockClear()
		mockedCountFileLines.mockClear()
		mockedFsReadFile.mockClear()
		mockedExtractTextFromFile.mockClear()
		toolResultMock.mockClear()

		// CRITICAL: Reset fsPromises.stat to prevent cross-test contamination
		fsPromises.stat.mockClear()
		fsPromises.stat.mockResolvedValue({
			size: 1024,
			isDirectory: () => false,
			isFile: () => true,
			isSymbolicLink: () => false,
		} as any)

		// Use shared mock setup function with local variables
		const mocks = createMockCline()
		localMockCline = mocks.mockCline
		localMockProvider = mocks.mockProvider

		// CRITICAL: Explicitly ensure image support is enabled for all tests in this suite
		setImageSupport(localMockCline, true)

		mockedPathResolve.mockReturnValue(absoluteImagePath)
		mockedIsBinaryFile.mockResolvedValue(true)
		mockedCountFileLines.mockResolvedValue(0)
		mockedFsReadFile.mockResolvedValue(imageBuffer)

		// Setup mock provider with default maxReadFileLine
		localMockProvider.getState.mockResolvedValue({ maxReadFileLine: -1 })

		toolResult = undefined
	})

	async function executeReadImageTool(imagePath: string = testImagePath): Promise<ToolResponse | undefined> {
		const argsContent = `<file><path>${imagePath}</path></file>`
		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { args: argsContent },
			partial: false,
		}

		// Debug: Check if mock is working
		console.log("Mock API:", localMockCline.api)
		console.log("Supports images:", localMockCline.api?.getModel?.()?.info?.supportsImages)

		await readFileTool.handle(localMockCline, toolUse, {
			askApproval: localMockCline.ask,
			handleError: vi.fn(),
			pushToolResult: (result: ToolResponse) => {
				toolResult = result
			},
			removeClosingTag: (_: ToolParamName, content?: string) => content ?? "",
			toolProtocol: "xml",
		})

		console.log("Result type:", Array.isArray(toolResult) ? "array" : typeof toolResult)
		console.log("Result:", toolResult)

		return toolResult
	}

	describe("Image Format Detection", () => {
		it.each([
			[".png", "image.png", "image/png"],
			[".jpg", "photo.jpg", "image/jpeg"],
			[".jpeg", "picture.jpeg", "image/jpeg"],
			[".gif", "animation.gif", "image/gif"],
			[".bmp", "bitmap.bmp", "image/bmp"],
			[".svg", "vector.svg", "image/svg+xml"],
			[".webp", "modern.webp", "image/webp"],
			[".ico", "favicon.ico", "image/x-icon"],
			[".avif", "new-format.avif", "image/avif"],
		])("should detect %s as an image format", async (ext, filename, expectedMimeType) => {
			// Setup
			const imagePath = `test/${filename}`
			const absolutePath = `/test/${filename}`
			mockedPathResolve.mockReturnValue(absolutePath)

			// Ensure API mock supports images
			setImageSupport(localMockCline, true)

			// Execute
			const result = await executeReadImageTool(imagePath)

			// Verify result is a multi-part response
			expect(Array.isArray(result)).toBe(true)
			const textPart = (result as any[]).find((p) => p.type === "text")?.text
			const imagePart = (result as any[]).find((p) => p.type === "image")

			// Verify text part - native format
			expect(textPart).toContain(`File: ${imagePath}`)
			expect(textPart).not.toContain("<image_data>")
			expect(textPart).toContain(`Note: Image file`)

			// Verify image part
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe(expectedMimeType)
			expect(imagePart.source.data).toBe(base64ImageData)
		})
	})

	describe("Image Reading Functionality", () => {
		it("should read image file and return a multi-part response", async () => {
			// Execute
			const result = await executeReadImageTool()

			// Verify result is a multi-part response
			expect(Array.isArray(result)).toBe(true)
			const textPart = (result as any[]).find((p) => p.type === "text")?.text
			const imagePart = (result as any[]).find((p) => p.type === "image")

			// Verify text part - native format
			expect(textPart).toContain(`File: ${testImagePath}`)
			expect(textPart).not.toContain(`<image_data>`)
			expect(textPart).toContain(`Note: Image file`)

			// Verify image part
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
			expect(imagePart.source.data).toBe(base64ImageData)
		})

		it("should call formatResponse.toolResult with text and image data", async () => {
			// Execute
			await executeReadImageTool()

			// Verify toolResultMock was called correctly
			expect(toolResultMock).toHaveBeenCalledTimes(1)
			const callArgs = toolResultMock.mock.calls[0]
			const textArg = callArgs[0]
			const imagesArg = callArgs[1]

			// Native format
			expect(textArg).toContain(`File: ${testImagePath}`)
			expect(imagesArg).toBeDefined()
			expect(imagesArg).toBeInstanceOf(Array)
			expect(imagesArg!.length).toBe(1)
			expect(imagesArg![0]).toBe(`data:image/png;base64,${base64ImageData}`)
		})

		it("should handle large image files", async () => {
			// Setup - simulate a large image
			const largeBase64 = "A".repeat(1000000) // 1MB of base64 data
			const largeBuffer = Buffer.from(largeBase64, "base64")
			mockedFsReadFile.mockResolvedValue(largeBuffer)

			// Execute
			const result = await executeReadImageTool()

			// Verify it still works with large data
			expect(Array.isArray(result)).toBe(true)
			const imagePart = (result as any[]).find((p) => p.type === "image")
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
			expect(imagePart.source.data).toBe(largeBase64)
		})

		it("should exclude images when model does not support images", async () => {
			// Setup - mock API handler that doesn't support images
			setImageSupport(localMockCline, false)

			// Execute
			const result = await executeReadImageTool()

			// When images are not supported, the tool should return just text (not call formatResponse.toolResult)
			expect(toolResultMock).not.toHaveBeenCalled()
			expect(typeof result).toBe("string")
			// Native format
			expect(result).toContain(`File: ${testImagePath}`)
			expect(result).toContain(`Note: Image file`)
		})

		it("should include images when model supports images", async () => {
			// Setup - mock API handler that supports images
			setImageSupport(localMockCline, true)

			// Execute
			const result = await executeReadImageTool()

			// Verify toolResultMock was called with images
			expect(toolResultMock).toHaveBeenCalledTimes(1)
			const callArgs = toolResultMock.mock.calls[0]
			const textArg = callArgs[0]
			const imagesArg = callArgs[1]

			// Native format
			expect(textArg).toContain(`File: ${testImagePath}`)
			expect(imagesArg).toBeDefined() // Images should be included
			expect(imagesArg).toBeInstanceOf(Array)
			expect(imagesArg!.length).toBe(1)
			expect(imagesArg![0]).toBe(`data:image/png;base64,${base64ImageData}`)
		})

		it("should handle undefined supportsImages gracefully", async () => {
			// Setup - mock API handler with undefined supportsImages
			setImageSupport(localMockCline, undefined)

			// Execute
			const result = await executeReadImageTool()

			// When supportsImages is undefined, should default to false and return just text
			expect(toolResultMock).not.toHaveBeenCalled()
			expect(typeof result).toBe("string")
			// Native format
			expect(result).toContain(`File: ${testImagePath}`)
			expect(result).toContain(`Note: Image file`)
		})

		it("should handle errors when reading image files", async () => {
			// Setup - simulate read error
			mockedFsReadFile.mockRejectedValue(new Error("Failed to read image"))

			// Execute
			const argsContent = `<file><path>${testImagePath}</path></file>`
			const toolUse: ReadFileToolUse = {
				type: "tool_use",
				name: "read_file",
				params: { args: argsContent },
				partial: false,
			}

			await readFileTool.handle(localMockCline, toolUse, {
				askApproval: localMockCline.ask,
				handleError: vi.fn(),
				pushToolResult: (result: ToolResponse) => {
					toolResult = result
				},
				removeClosingTag: (_: ToolParamName, content?: string) => content ?? "",
				toolProtocol: "xml",
			})

			// Verify error handling - native format
			expect(toolResult).toContain("Error: Error reading image file: Failed to read image")
			// Verify that say was called to show error to user
			expect(localMockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Failed to read image"))
		})
	})

	describe("Binary File Handling", () => {
		it("should not treat non-image binary files as images", async () => {
			// Setup
			const binaryPath = "test/document.pdf"
			const absolutePath = "/test/document.pdf"
			mockedPathResolve.mockReturnValue(absolutePath)
			mockedExtractTextFromFile.mockResolvedValue("PDF content extracted")

			// Execute
			const result = await executeReadImageTool(binaryPath)

			// Verify it uses extractTextFromFile instead
			expect(result).not.toContain("<image_data>")
			// Make the test platform-agnostic by checking the call was made (path normalization can vary)
			expect(mockedExtractTextFromFile).toHaveBeenCalledTimes(1)
			const callArgs = mockedExtractTextFromFile.mock.calls[0]
			expect(callArgs[0]).toMatch(/[\\\/]test[\\\/]document\.pdf$/)
		})

		it("should handle unknown binary formats", async () => {
			// Setup
			const binaryPath = "test/unknown.bin"
			const absolutePath = "/test/unknown.bin"
			mockedPathResolve.mockReturnValue(absolutePath)
			mockedExtractTextFromFile.mockResolvedValue("")

			// Execute
			const result = await executeReadImageTool(binaryPath)

			// Verify - native format for binary files
			expect(result).not.toContain("<image_data>")
			expect(result).toContain("Binary file (bin)")
		})
	})

	describe("Edge Cases", () => {
		it("should handle case-insensitive image extensions", async () => {
			// Test uppercase extensions
			const uppercasePath = "test/IMAGE.PNG"
			const absolutePath = "/test/IMAGE.PNG"
			mockedPathResolve.mockReturnValue(absolutePath)

			// Execute
			const result = await executeReadImageTool(uppercasePath)

			// Verify
			expect(Array.isArray(result)).toBe(true)
			const imagePart = (result as any[]).find((p) => p.type === "image")
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
		})

		it("should handle files with multiple dots in name", async () => {
			// Setup
			const complexPath = "test/my.photo.backup.png"
			const absolutePath = "/test/my.photo.backup.png"
			mockedPathResolve.mockReturnValue(absolutePath)

			// Execute
			const result = await executeReadImageTool(complexPath)

			// Verify
			expect(Array.isArray(result)).toBe(true)
			const imagePart = (result as any[]).find((p) => p.type === "image")
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
		})

		it("should handle empty image files", async () => {
			// Setup - empty buffer
			mockedFsReadFile.mockResolvedValue(Buffer.from(""))

			// Execute
			const result = await executeReadImageTool()

			// Verify - should still create valid data URL
			expect(Array.isArray(result)).toBe(true)
			const imagePart = (result as any[]).find((p) => p.type === "image")
			expect(imagePart).toBeDefined()
			expect(imagePart.source.media_type).toBe("image/png")
			expect(imagePart.source.data).toBe("")
		})
	})
})

describe("read_file tool concurrent file reads limit", () => {
	const mockedCountFileLines = vi.mocked(countFileLines)
	const mockedIsBinaryFile = vi.mocked(isBinaryFile)
	const mockedPathResolve = vi.mocked(path.resolve)

	let mockCline: any
	let mockProvider: any
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		// Clear specific mocks
		mockedCountFileLines.mockClear()
		mockedIsBinaryFile.mockClear()
		mockedPathResolve.mockClear()
		addLineNumbersMock.mockClear()
		toolResultMock.mockClear()

		// Use shared mock setup function
		const mocks = createMockCline()
		mockCline = mocks.mockCline
		mockProvider = mocks.mockProvider

		// Disable image support for these tests
		setImageSupport(mockCline, false)

		mockedPathResolve.mockImplementation((cwd, relPath) => `/${relPath}`)
		mockedIsBinaryFile.mockResolvedValue(false)
		mockedCountFileLines.mockResolvedValue(10)

		// Mock fsPromises.stat to return a file (not directory) by default
		fsPromises.stat.mockResolvedValue({
			isDirectory: () => false,
			isFile: () => true,
			isSymbolicLink: () => false,
		} as any)

		toolResult = undefined
	})

	async function executeReadFileToolWithLimit(
		fileCount: number,
		maxConcurrentFileReads: number,
	): Promise<ToolResponse | undefined> {
		// Setup provider state with the specified limit
		mockProvider.getState.mockResolvedValue({
			maxReadFileLine: -1,
			maxConcurrentFileReads,
			maxImageFileSize: 20,
			maxTotalImageSize: 20,
		})

		// Create args with the specified number of files
		const files = Array.from({ length: fileCount }, (_, i) => `<file><path>file${i + 1}.txt</path></file>`)
		const argsContent = files.join("")

		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { args: argsContent },
			partial: false,
		}

		// Configure mocks for successful file reads
		mockReadFileWithTokenBudget.mockResolvedValue({
			content: "test content",
			tokenCount: 10,
			lineCount: 1,
			complete: true,
		})

		await readFileTool.handle(mockCline, toolUse, {
			askApproval: mockCline.ask,
			handleError: vi.fn(),
			pushToolResult: (result: ToolResponse) => {
				toolResult = result
			},
			removeClosingTag: (_: ToolParamName, content?: string) => content ?? "",
			toolProtocol: "xml",
		})

		return toolResult
	}

	it("should reject when file count exceeds maxConcurrentFileReads", async () => {
		// Try to read 6 files when limit is 5
		const result = await executeReadFileToolWithLimit(6, 5)

		// Verify error result
		expect(result).toContain("Error: Too many files requested")
		expect(result).toContain("You attempted to read 6 files")
		expect(result).toContain("but the concurrent file reads limit is 5")
		expect(result).toContain("Please read files in batches of 5 or fewer")

		// Verify error tracking
		expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Too many files requested"))
	})

	it("should allow reading files when count equals maxConcurrentFileReads", async () => {
		// Try to read exactly 5 files when limit is 5
		const result = await executeReadFileToolWithLimit(5, 5)

		// Should not contain error
		expect(result).not.toContain("Error: Too many files requested")

		// Should contain file results
		expect(typeof result === "string" ? result : JSON.stringify(result)).toContain("file1.txt")
	})

	it("should allow reading files when count is below maxConcurrentFileReads", async () => {
		// Try to read 3 files when limit is 5
		const result = await executeReadFileToolWithLimit(3, 5)

		// Should not contain error
		expect(result).not.toContain("Error: Too many files requested")

		// Should contain file results
		expect(typeof result === "string" ? result : JSON.stringify(result)).toContain("file1.txt")
	})

	it("should respect custom maxConcurrentFileReads value of 1", async () => {
		// Try to read 2 files when limit is 1
		const result = await executeReadFileToolWithLimit(2, 1)

		// Verify error result with limit of 1
		expect(result).toContain("Error: Too many files requested")
		expect(result).toContain("You attempted to read 2 files")
		expect(result).toContain("but the concurrent file reads limit is 1")
	})

	it("should allow single file read when maxConcurrentFileReads is 1", async () => {
		// Try to read 1 file when limit is 1
		const result = await executeReadFileToolWithLimit(1, 1)

		// Should not contain error
		expect(result).not.toContain("Error: Too many files requested")

		// Should contain file result
		expect(typeof result === "string" ? result : JSON.stringify(result)).toContain("file1.txt")
	})

	it("should respect higher maxConcurrentFileReads value", async () => {
		// Try to read 15 files when limit is 10
		const result = await executeReadFileToolWithLimit(15, 10)

		// Verify error result
		expect(result).toContain("Error: Too many files requested")
		expect(result).toContain("You attempted to read 15 files")
		expect(result).toContain("but the concurrent file reads limit is 10")
	})

	it("should use default value of 5 when maxConcurrentFileReads is not set", async () => {
		// Setup provider state without maxConcurrentFileReads
		mockProvider.getState.mockResolvedValue({
			maxReadFileLine: -1,
			maxImageFileSize: 20,
			maxTotalImageSize: 20,
		})

		// Create args with 6 files
		const files = Array.from({ length: 6 }, (_, i) => `<file><path>file${i + 1}.txt</path></file>`)
		const argsContent = files.join("")

		const toolUse: ReadFileToolUse = {
			type: "tool_use",
			name: "read_file",
			params: { args: argsContent },
			partial: false,
		}

		mockReadFileWithTokenBudget.mockResolvedValue({
			content: "test content",
			tokenCount: 10,
			lineCount: 1,
			complete: true,
		})

		await readFileTool.handle(mockCline, toolUse, {
			askApproval: mockCline.ask,
			handleError: vi.fn(),
			pushToolResult: (result: ToolResponse) => {
				toolResult = result
			},
			removeClosingTag: (_: ToolParamName, content?: string) => content ?? "",
			toolProtocol: "xml",
		})

		// Should use default limit of 5 and reject 6 files
		expect(toolResult).toContain("Error: Too many files requested")
		expect(toolResult).toContain("but the concurrent file reads limit is 5")
	})
})
