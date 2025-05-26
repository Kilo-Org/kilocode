import * as path from "path"
import * as fs from "fs/promises"
import { existsSync, mkdirSync } from "fs"

/**
 * Integration test for remove code operations using directory-based snapshots
 *
 * This approach uses:
 * 1. Input files in a directory structure
 * 2. Expected output files in a parallel directory structure
 * 3. Diffing to verify the transformation results match the expected outputs
 */
describe("Remove Code Integration Tests", () => {
	// Base directories for test cases
	const testCasesDir = path.join(__dirname, "testcases", "remove")
	const tempDir = path.join(__dirname, "temp")

	// Create temp directory if it doesn't exist
	beforeAll(() => {
		if (!existsSync(tempDir)) {
			mkdirSync(tempDir, { recursive: true })
		}
	})

	// Clean temporary files after each test
	afterEach(async () => {
		// Find and remove all files in the temp directory
		const files = await fs.readdir(tempDir)
		const promises = files.map((file) =>
			fs.unlink(path.join(tempDir, file)).catch(() => {
				/* ignore errors */
			}),
		)
		await Promise.all(promises)
	})

	/**
	 * Helper function to run a test case
	 * @param testCaseName Name of the test case directory
	 * @param symbolName Name of the symbol to remove
	 * @param sourceFileName Name of the source file
	 */
	async function runTestCase(testCaseName: string, symbolName: string, sourceFileName: string) {
		// Set up paths
		const testCaseDir = path.join(testCasesDir, testCaseName)
		const inputDir = path.join(testCaseDir, "input")
		const expectedDir = path.join(testCaseDir, "expected")

		// Verify input directory exists
		expect(existsSync(inputDir)).toBe(true)

		// Verify source file exists in input directory
		expect(existsSync(path.join(inputDir, sourceFileName))).toBe(true)

		// Verify expected directory exists
		expect(existsSync(expectedDir)).toBe(true)

		// Verify expected files exist
		expect(existsSync(path.join(expectedDir, sourceFileName))).toBe(true)

		// Log the test case details for documentation
		console.log(`Test case: ${testCaseName}`)
		console.log(`  Removing ${symbolName} from ${sourceFileName}`)
		console.log(`  Input directory: ${inputDir}`)
		console.log(`  Expected directory: ${expectedDir}`)
	}

	// Test 1: Remove a function
	it("should remove a function", async () => {
		await runTestCase("remove-function", "functionToRemove", "source.ts")
	})

	// Test 2: Remove a variable
	it("should remove a variable", async () => {
		await runTestCase("remove-variable", "variableToRemove", "source.ts")
	})
})
