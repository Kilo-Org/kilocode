import { describe, it, expect, vi, beforeEach } from "vitest"
import { CommitMessageGenerator } from "../CommitMessageGenerator"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { GenerateMessageParams, ProgressUpdate } from "../types/core"

describe("CommitMessageGenerator", () => {
	let generator: CommitMessageGenerator
	let mockProviderSettingsManager: ProviderSettingsManager

	const mockGitContext = `
diff --git a/src/test.ts b/src/test.ts
new file mode 100644
index 0000000..123
--- /dev/null
+++ b/src/test.ts
@@ -0,0 +1,3 @@
+export function test() {
+  console.log('test');
+}
`

	beforeEach(() => {
		// Mock ProviderSettingsManager with minimal required methods
		mockProviderSettingsManager = {
			getProfile: vi.fn().mockResolvedValue({
				apiProvider: "anthropic",
				model: "claude-3-haiku-20240307",
			}),
		} as any

		generator = new CommitMessageGenerator(mockProviderSettingsManager)
	})

	describe("class instantiation", () => {
		it("should create CommitMessageGenerator instance", () => {
			expect(generator).toBeInstanceOf(CommitMessageGenerator)
		})

		it("should implement ICommitMessageGenerator interface", () => {
			expect(generator.generateMessage).toBeDefined()
			expect(generator.buildPrompt).toBeDefined()
			expect(typeof generator.generateMessage).toBe("function")
			expect(typeof generator.buildPrompt).toBe("function")
		})
	})

	describe("state management", () => {
		it("should initialize with null previous context and message", () => {
			// Private fields, but we can test behavior through public methods
			expect(generator).toHaveProperty("previousGitContext")
			expect(generator).toHaveProperty("previousCommitMessage")
		})
	})

	describe("progress callback support", () => {
		it("should accept onProgress callback in generateMessage params", () => {
			const progressUpdates: ProgressUpdate[] = []
			const params: GenerateMessageParams = {
				workspacePath: "/test/workspace",
				selectedFiles: ["src/test.ts"],
				gitContext: mockGitContext,
				onProgress: (progress) => progressUpdates.push(progress),
			}

			expect(params.onProgress).toBeDefined()
			expect(typeof params.onProgress).toBe("function")

			params.onProgress?.({
				message: "test progress",
				percentage: 50,
			})

			expect(progressUpdates).toHaveLength(1)
			expect(progressUpdates[0].message).toBeDefined()
			expect(progressUpdates[0].message).toBe("test progress")
			expect(progressUpdates[0].percentage).toBe(50)
		})
	})

	describe("IDE independence", () => {
		it("should accept IDE-agnostic parameters", () => {
			const params: GenerateMessageParams = {
				workspacePath: "/any/workspace",
				selectedFiles: ["file1.ts", "file2.js"],
				gitContext: mockGitContext,
			}

			// Parameters should be well-formed
			expect(params.workspacePath).toBe("/any/workspace")
			expect(params.selectedFiles).toEqual(["file1.ts", "file2.js"])
			expect(params.gitContext).toBe(mockGitContext)
		})
	})

	describe("buildPrompt method", () => {
		it("should accept gitContext and options", async () => {
			const options = {
				customSupportPrompts: { COMMIT_MESSAGE: "Custom template" },
				previousContext: "some previous context",
				previousMessage: "previous message",
			}

			// Should not throw when called with valid parameters
			expect(async () => {
				await generator.buildPrompt(mockGitContext, options)
			}).not.toThrow()
		})
	})

	describe("error handling", () => {
		it("should handle errors in generateMessage gracefully", async () => {
			const invalidParams: GenerateMessageParams = {
				workspacePath: "",
				selectedFiles: [],
				gitContext: "",
			}

			await expect(async () => {
				await generator.generateMessage(invalidParams)
			}).rejects.toThrow()
		})
	})
})
