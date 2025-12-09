import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import readline from "readline"
import { checkApproval } from "./approvals.js"

const TEST_APPROVALS_DIR = "approvals"
const TEST_CATEGORY = "test-category"
const TEST_NAME = "test-case"
const TEST_FILENAME = "test.ts"
const TEST_CONTEXT_FILES: { filepath: string; content: string }[] = []

describe("approvals", () => {
	beforeEach(() => {
		if (fs.existsSync(TEST_APPROVALS_DIR)) {
			fs.rmSync(TEST_APPROVALS_DIR, { recursive: true })
		}
	})

	afterEach(() => {
		if (fs.existsSync(TEST_APPROVALS_DIR)) {
			fs.rmSync(TEST_APPROVALS_DIR, { recursive: true })
		}
	})

	describe("file structure", () => {
		it("should create flat file structure with correct naming", async () => {
			vi.spyOn(readline, "createInterface").mockReturnValue({
				question: (_prompt: string, callback: (answer: string) => void) => {
					callback("y")
				},
				close: () => {},
			} as any)

			const input = "test input"
			const output = "test output"

			await checkApproval(TEST_CATEGORY, TEST_NAME, input, output, "completion", TEST_FILENAME, TEST_CONTEXT_FILES)

			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			expect(fs.existsSync(categoryDir)).toBe(true)

			const files = fs.readdirSync(categoryDir)
			expect(files).toContain(`${TEST_NAME}.approved.1.txt`)

			const content = fs.readFileSync(path.join(categoryDir, `${TEST_NAME}.approved.1.txt`), "utf-8")
			expect(content).toBe(output)
		})

		it("should increment file numbers for multiple approvals", async () => {
			vi.spyOn(readline, "createInterface").mockReturnValue({
				question: (_prompt: string, callback: (answer: string) => void) => {
					callback("y")
				},
				close: () => {},
			} as any)

			await checkApproval(TEST_CATEGORY, TEST_NAME, "input1", "output1", "completion1", TEST_FILENAME, TEST_CONTEXT_FILES)
			await checkApproval(TEST_CATEGORY, TEST_NAME, "input2", "output2", "completion2", TEST_FILENAME, TEST_CONTEXT_FILES)
			await checkApproval(TEST_CATEGORY, TEST_NAME, "input3", "output3", "completion3", TEST_FILENAME, TEST_CONTEXT_FILES)

			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			const files = fs.readdirSync(categoryDir)

			expect(files).toContain(`${TEST_NAME}.approved.1.txt`)
			expect(files).toContain(`${TEST_NAME}.approved.2.txt`)
			expect(files).toContain(`${TEST_NAME}.approved.3.txt`)
		})

		it("should handle rejected outputs with correct naming", async () => {
			vi.spyOn(readline, "createInterface").mockReturnValue({
				question: (_prompt: string, callback: (answer: string) => void) => {
					callback("n")
				},
				close: () => {},
			} as any)

			await checkApproval(TEST_CATEGORY, TEST_NAME, "input", "output", "completion", TEST_FILENAME, TEST_CONTEXT_FILES)

			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			const files = fs.readdirSync(categoryDir)

			expect(files).toContain(`${TEST_NAME}.rejected.1.txt`)
		})

		it("should use globally unique numbers across approved and rejected", async () => {
			let callCount = 0
			vi.spyOn(readline, "createInterface").mockReturnValue({
				question: (_prompt: string, callback: (answer: string) => void) => {
					// First call: approve, second call: reject, third call: approve
					callCount++
					callback(callCount === 2 ? "n" : "y")
				},
				close: () => {},
			} as any)

			await checkApproval(TEST_CATEGORY, TEST_NAME, "input1", "output1", "completion1", TEST_FILENAME, TEST_CONTEXT_FILES) // approved.1
			await checkApproval(TEST_CATEGORY, TEST_NAME, "input2", "output2", "completion2", TEST_FILENAME, TEST_CONTEXT_FILES) // rejected.2
			await checkApproval(TEST_CATEGORY, TEST_NAME, "input3", "output3", "completion3", TEST_FILENAME, TEST_CONTEXT_FILES) // approved.3

			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			const files = fs.readdirSync(categoryDir)

			expect(files).toContain(`${TEST_NAME}.approved.1.txt`)
			expect(files).toContain(`${TEST_NAME}.rejected.2.txt`)
			expect(files).toContain(`${TEST_NAME}.approved.3.txt`)
			expect(files).toHaveLength(3)
		})
	})

	describe("matching existing files", () => {
		it("should match approved output and not prompt user", async () => {
			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			fs.mkdirSync(categoryDir, { recursive: true })

			const output = "test output"
			fs.writeFileSync(path.join(categoryDir, `${TEST_NAME}.approved.1.txt`), output, "utf-8")

			const result = await checkApproval(
				TEST_CATEGORY,
				TEST_NAME,
				"input",
				output,
				"completion",
				TEST_FILENAME,
				TEST_CONTEXT_FILES,
			)

			expect(result.isApproved).toBe(true)
			expect(result.newOutput).toBe(false)
		})

		it("should match rejected output and not prompt user", async () => {
			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			fs.mkdirSync(categoryDir, { recursive: true })

			const output = "test output"
			fs.writeFileSync(path.join(categoryDir, `${TEST_NAME}.rejected.1.txt`), output, "utf-8")

			const result = await checkApproval(
				TEST_CATEGORY,
				TEST_NAME,
				"input",
				output,
				"completion",
				TEST_FILENAME,
				TEST_CONTEXT_FILES,
			)

			expect(result.isApproved).toBe(false)
			expect(result.newOutput).toBe(false)
		})

		it("should match with different file numbers", async () => {
			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			fs.mkdirSync(categoryDir, { recursive: true })

			const output = "test output"
			fs.writeFileSync(path.join(categoryDir, `${TEST_NAME}.approved.5.txt`), output, "utf-8")

			const result = await checkApproval(
				TEST_CATEGORY,
				TEST_NAME,
				"input",
				output,
				"completion",
				TEST_FILENAME,
				TEST_CONTEXT_FILES,
			)

			expect(result.isApproved).toBe(true)
			expect(result.newOutput).toBe(false)
		})
	})

	describe("multiple test cases in same category", () => {
		it("should keep files for different test cases separate", async () => {
			vi.spyOn(readline, "createInterface").mockReturnValue({
				question: (_prompt: string, callback: (answer: string) => void) => {
					callback("y")
				},
				close: () => {},
			} as any)

			await checkApproval(TEST_CATEGORY, "test-case-1", "input1", "output1", "completion1", TEST_FILENAME, TEST_CONTEXT_FILES)
			await checkApproval(TEST_CATEGORY, "test-case-2", "input2", "output2", "completion2", TEST_FILENAME, TEST_CONTEXT_FILES)

			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			const files = fs.readdirSync(categoryDir)

			expect(files).toContain("test-case-1.approved.1.txt")
			expect(files).toContain("test-case-2.approved.1.txt")
			expect(files).toHaveLength(2)
		})
	})

	describe("newOutput flag", () => {
		it("should set newOutput to true for new approvals", async () => {
			vi.spyOn(readline, "createInterface").mockReturnValue({
				question: (_prompt: string, callback: (answer: string) => void) => {
					callback("y")
				},
				close: () => {},
			} as any)

			const result = await checkApproval(
				TEST_CATEGORY,
				TEST_NAME,
				"input",
				"output",
				"completion",
				TEST_FILENAME,
				TEST_CONTEXT_FILES,
			)

			expect(result.newOutput).toBe(true)
		})

		it("should set newOutput to false for existing matches", async () => {
			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			fs.mkdirSync(categoryDir, { recursive: true })

			const output = "test output"
			fs.writeFileSync(path.join(categoryDir, `${TEST_NAME}.approved.1.txt`), output, "utf-8")

			const result = await checkApproval(
				TEST_CATEGORY,
				TEST_NAME,
				"input",
				output,
				"completion",
				TEST_FILENAME,
				TEST_CONTEXT_FILES,
			)

			expect(result.newOutput).toBe(false)
		})
	})

	describe("skip-approval mode", () => {
		it("should mark new outputs as unknown with newOutput=true", async () => {
			const result = await checkApproval(
				TEST_CATEGORY,
				TEST_NAME,
				"input",
				"output",
				"completion",
				TEST_FILENAME,
				TEST_CONTEXT_FILES,
				true,
			)

			expect(result.isApproved).toBe(false)
			expect(result.newOutput).toBe(true)
		})

		it("should still pass for previously approved outputs", async () => {
			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			fs.mkdirSync(categoryDir, { recursive: true })

			const output = "test output"
			fs.writeFileSync(path.join(categoryDir, `${TEST_NAME}.approved.1.txt`), output, "utf-8")

			const result = await checkApproval(
				TEST_CATEGORY,
				TEST_NAME,
				"input",
				output,
				"completion",
				TEST_FILENAME,
				TEST_CONTEXT_FILES,
				true,
			)

			expect(result.isApproved).toBe(true)
			expect(result.newOutput).toBe(false)
		})

		it("should still fail for previously rejected outputs", async () => {
			const categoryDir = path.join(TEST_APPROVALS_DIR, TEST_CATEGORY)
			fs.mkdirSync(categoryDir, { recursive: true })

			const output = "test output"
			fs.writeFileSync(path.join(categoryDir, `${TEST_NAME}.rejected.1.txt`), output, "utf-8")

			const result = await checkApproval(
				TEST_CATEGORY,
				TEST_NAME,
				"input",
				output,
				"completion",
				TEST_FILENAME,
				TEST_CONTEXT_FILES,
				true,
			)

			expect(result.isApproved).toBe(false)
			expect(result.newOutput).toBe(false)
		})
	})
})
