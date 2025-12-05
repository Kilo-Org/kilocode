import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

export const CURSOR_MARKER = "<<<AUTOCOMPLETE_HERE>>>"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface CategoryTestCase {
	name: string
	input: string
	description: string
	filename: string
}

export interface TestCase extends CategoryTestCase {
	category: string
}

export interface Category {
	name: string
	testCases: CategoryTestCase[]
}

const TEST_CASES_DIR = path.join(__dirname, "test-cases")

function parseHeaders(
	lines: string[],
	filePath: string,
	requiredHeaders: string[],
): { headers: Record<string, string>; contentStartIndex: number } {
	const headers: Record<string, string> = {}
	let contentStartIndex = 0

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const headerMatch = line.match(/^#### ([^:]+):\s*(.*)$/)

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
		throw new Error(`Invalid test case file format: ${filePath}. Missing headers: ${missingHeaders.join(", ")}`)
	}

	return { headers, contentStartIndex }
}

function parseTestCaseFile(filePath: string): { description: string; filename: string; input: string } {
	const content = fs.readFileSync(filePath, "utf-8")
	// Normalize line endings to handle Windows CRLF
	const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
	const lines = normalizedContent.split("\n")

	const { headers, contentStartIndex } = parseHeaders(lines, filePath, ["description", "filename"])

	const input = lines
		.slice(contentStartIndex)
		.join("\n")
		.replace(/<<<CURSOR>>>/g, CURSOR_MARKER)

	return {
		description: headers.description,
		filename: headers.filename,
		input,
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
			const { description, filename, input } = parseTestCaseFile(testCasePath)

			testCases.push({
				name: testCaseName,
				input,
				description,
				filename,
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
