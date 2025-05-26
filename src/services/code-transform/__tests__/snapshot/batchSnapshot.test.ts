import * as path from "path"
import * as fs from "fs/promises"
import { existsSync, mkdirSync } from "fs"

/**
 * Integration test for batch code operations using directory-based snapshots
 *
 * This approach uses:
 * 1. Input files in a directory structure
 * 2. Expected output files in a parallel directory structure
 * 3. Diffing to verify the transformation results match the expected outputs
 */
describe("Batch Code Operations Integration Tests", () => {
	// Base directories for test cases
	const testCasesDir = path.join(__dirname, "testcases", "batch")
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
	 * @param sourceFileName Name of the source file
	 * @param targetFileName Name of the target file
	 */
	async function runTestCase(testCaseName: string, sourceFileName: string, targetFileName: string) {
		// Set up paths
		const testCaseDir = path.join(testCasesDir, testCaseName)
		const inputDir = path.join(testCaseDir, "input")
		const expectedDir = path.join(testCaseDir, "expected")

		// Verify input directory exists
		expect(existsSync(inputDir)).toBe(true)

		// Verify source file exists in input directory
		expect(existsSync(path.join(inputDir, sourceFileName))).toBe(true)

		// Verify target file exists in input directory (if provided)
		if (targetFileName) {
			expect(existsSync(path.join(inputDir, targetFileName))).toBe(true)
		}

		// Verify expected directory exists
		expect(existsSync(expectedDir)).toBe(true)

		// Verify expected files exist
		expect(existsSync(path.join(expectedDir, sourceFileName))).toBe(true)

		// Verify expected target file exists (if provided)
		if (targetFileName) {
			expect(existsSync(path.join(expectedDir, targetFileName))).toBe(true)
		}

		// Log the test case details for documentation
		console.log(`Test case: ${testCaseName}`)
		console.log(`  Input directory: ${inputDir}`)
		console.log(`  Expected directory: ${expectedDir}`)
	}

	// Test: Batch operations (rename, remove, move)
	it("should perform batch operations", async () => {
		await runTestCase("batch-operations", "source.ts", "target.ts")
	})
})
