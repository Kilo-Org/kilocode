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
}

export interface TestCase extends CategoryTestCase {
	category: string
}

export interface Category {
	name: string
	testCases: CategoryTestCase[]
}

const TEST_CASES_DIR = path.join(__dirname, "test-cases")

function parseTestCaseFile(filePath: string): { description: string; input: string } {
	const content = fs.readFileSync(filePath, "utf-8")
	const lines = content.split("\n")

	const descriptionLine = lines[0]
	if (!descriptionLine.startsWith("# Description: ")) {
		throw new Error(
			`Invalid test case file format: ${filePath}. Expected first line to start with "# Description: "`,
		)
	}

	const description = descriptionLine.replace("# Description: ", "").trim()
	const input = lines
		.slice(1)
		.join("\n")
		.replace(/<<<CURSOR>>>/g, CURSOR_MARKER)

	return { description, input }
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
			const { description, input } = parseTestCaseFile(testCasePath)

			testCases.push({
				name: testCaseName,
				input,
				description,
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
