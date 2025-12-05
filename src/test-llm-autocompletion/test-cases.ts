import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

export const CURSOR_MARKER = "<<<AUTOCOMPLETE_HERE>>>"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface ContextFile {
	filepath: string
	content: string
}

interface CategoryTestCase {
	name: string
	input: string
	description: string
	filename: string
	contextFiles: ContextFile[]
}

export interface TestCase extends CategoryTestCase {
	category: string
}

export interface Category {
	name: string
	testCases: CategoryTestCase[]
}

const TEST_CASES_DIR = path.join(__dirname, "test-cases")

// Header pattern: #### key: value
const HEADER_PATTERN = /^#### ([^:]+):\s*(.*)$/

function parseHeaders(
	lines: string[],
	startIndex: number,
	requiredHeaders: string[],
	filePath?: string,
): { headers: Record<string, string>; contentStartIndex: number } {
	const headers: Record<string, string> = {}
	let contentStartIndex = startIndex

	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i]
		const headerMatch = line.match(HEADER_PATTERN)

		if (headerMatch) {
			const [, name, value] = headerMatch
			headers[name.toLowerCase()] = value.trim()
			contentStartIndex = i + 1
		} else {
			// Stop parsing headers when we hit a non-header line
			break
		}
	}

	// Validate required headers
	const missingHeaders = requiredHeaders.filter((header) => !headers[header])
	if (missingHeaders.length > 0) {
		const location = filePath ? `: ${filePath}` : ""
		throw new Error(`Invalid test case file format${location}. Missing headers: ${missingHeaders.join(", ")}`)
	}

	return { headers, contentStartIndex }
}

/**
 * Reads lines from startIndex until the next header pattern is found or end of file.
 * Returns the content and the index where the next header starts (or lines.length if none found).
 */
function readUntilHeaders(lines: string[], startIndex: number): { content: string; nextHeaderIndex: number } {
	const contentLines: string[] = []

	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i]
		if (HEADER_PATTERN.test(line)) {
			return { content: contentLines.join("\n"), nextHeaderIndex: i }
		}
		contentLines.push(line)
	}

	return { content: contentLines.join("\n"), nextHeaderIndex: lines.length }
}

function parseTestCaseFile(filePath: string): {
	description: string
	filename: string
	input: string
	contextFiles: ContextFile[]
} {
	const content = fs.readFileSync(filePath, "utf-8")
	// Normalize line endings to handle Windows CRLF
	const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
	const lines = normalizedContent.split("\n")

	// Parse main headers (#### Description:, #### Filename:)
	const { headers, contentStartIndex } = parseHeaders(lines, 0, ["description", "filename"], filePath)

	// Parse main content and context files (inlined from parseContextFiles)
	const contextFiles: ContextFile[] = []

	// Read main content until we hit a context file header (#### Filename: value)
	const { content: mainContent, nextHeaderIndex } = readUntilHeaders(lines, contentStartIndex)

	// Parse remaining context files
	let currentIndex = nextHeaderIndex
	while (currentIndex < lines.length) {
		// Parse the context file header (#### Filename: path/to/file)
		const { headers: contextHeaders, contentStartIndex: contextContentStartIndex } = parseHeaders(
			lines,
			currentIndex,
			["filename"],
		)

		// Read content until next context file header or end of file
		const { content: fileContent, nextHeaderIndex: nextIndex } = readUntilHeaders(lines, contextContentStartIndex)

		contextFiles.push({
			filepath: contextHeaders.filename,
			content: fileContent,
		})

		currentIndex = nextIndex
	}

	return {
		description: headers.description,
		filename: headers.filename,
		input: mainContent,
		contextFiles,
	}
}

function loadTestCases(): Category[] {
	if (!fs.existsSync(TEST_CASES_DIR)) {
		return []
	}

	const categories: Category[] = []
	const categoryDirs = fs.readdirSync(TEST_CASES_DIR, { withFileTypes: true })

	for (const categoryDir of categoryDirs) {
		if (!categoryDir.isDirectory()) continue

		const categoryName = categoryDir.name
		const categoryPath = path.join(TEST_CASES_DIR, categoryName)
		const testCaseFiles = fs.readdirSync(categoryPath).filter((f) => f.endsWith(".txt"))

		const testCases: CategoryTestCase[] = []

		for (const testCaseFile of testCaseFiles) {
			const testCaseName = testCaseFile.replace(".txt", "")
			const testCasePath = path.join(categoryPath, testCaseFile)
			const { description, filename, input, contextFiles } = parseTestCaseFile(testCasePath)

			testCases.push({
				name: testCaseName,
				input,
				description,
				filename,
				contextFiles,
			})
		}

		if (testCases.length > 0) {
			categories.push({
				name: categoryName,
				testCases,
			})
		}
	}

	return categories
}

export const categories: Category[] = loadTestCases()

export const testCases: TestCase[] = categories.flatMap((category) =>
	category.testCases.map((tc) => ({
		...tc,
		category: category.name,
	})),
)

export function getTestCasesByCategory(categoryName: string): TestCase[] {
	const category = categories.find((c) => c.name === categoryName)
	return category
		? category.testCases.map((tc) => ({
				...tc,
				category: category.name,
			}))
		: []
}

export function getCategories(): string[] {
	return categories.map((c) => c.name)
}
