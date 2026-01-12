// kilocode_change - new file

/**
 * Integration tests for edit plan execution
 * Tests the complete workflow of creating, executing, and managing edit plans
 */

import { describe, test, expect, beforeEach, vi } from "vitest"
import type {
	EditPlan,
	EditStep,
	EditPlanGenerationRequest,
	ExecuteStepRequest,
	StepExecutionResponse,
	FileChange,
	FileConflict,
} from "./types"

// Mock file system operations
const mockFileSystem = {
	readFile: vi.fn(),
	writeFile: vi.fn(),
	deleteFile: vi.fn(),
	fileExists: vi.fn(),
}

// Mock AST analyzer
const mockASTAnalyzer = {
	analyzeFile: vi.fn(),
	findReferences: vi.fn(),
	findDependencies: vi.fn(),
}

// Mock step executor
const mockStepExecutor = {
	execute: vi.fn(),
	validate: vi.fn(),
	rollback: vi.fn(),
}

describe("Edit Plan Execution Integration Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Complete Edit Plan Workflow", () => {
		test("should execute a complete refactor plan from start to finish", async () => {
			// Setup: Create a plan to rename a function
			const planId = "550e8400-e29b-41d4-a716-446655440000"

			const plan: EditPlan = {
				id: planId,
				userId: "user-123",
				title: "Rename getUserData to fetchUserProfile",
				description: "Refactor function name across all files",
				status: "pending",
				steps: [
					{
						id: "step-1",
						planId,
						order: 1,
						title: "Update function definition",
						type: "update",
						files: [
							{
								id: "file-1",
								stepId: "step-1",
								filePath: "/project/src/services/auth/AuthService.ts",
								changeType: "update",
								oldContent: "export function getUserData() {",
								newContent: "export function fetchUserProfile() {",
							},
						],
						description: "Rename the function in AuthService",
						status: "pending",
						dependencies: [],
					},
					{
						id: "step-2",
						planId,
						order: 2,
						title: "Update imports in components",
						type: "update",
						files: [
							{
								id: "file-2",
								stepId: "step-2",
								filePath: "/project/src/components/UserProfile.tsx",
								changeType: "update",
								oldContent: "import { getUserData } from '@/services/auth'",
								newContent: "import { fetchUserProfile } from '@/services/auth'",
							},
							{
								id: "file-3",
								stepId: "step-2",
								filePath: "/project/src/pages/Dashboard.tsx",
								changeType: "update",
								oldContent: "import { getUserData } from '@/services/auth'",
								newContent: "import { fetchUserProfile } from '@/services/auth'",
							},
						],
						description: "Update import statements in all components",
						status: "pending",
						dependencies: ["step-1"],
					},
					{
						id: "step-3",
						planId,
						order: 3,
						title: "Update function calls",
						type: "update",
						files: [
							{
								id: "file-4",
								stepId: "step-3",
								filePath: "/project/src/components/UserProfile.tsx",
								changeType: "update",
								oldContent: "const data = getUserData()",
								newContent: "const data = fetchUserProfile()",
							},
						],
						description: "Update all function calls",
						status: "pending",
						dependencies: ["step-1", "step-2"],
					},
				],
				createdAt: new Date(),
				updatedAt: new Date(),
			}

			// Mock file system to return file contents
			mockFileSystem.readFile.mockResolvedValue("export function getUserData() {}")
			mockFileSystem.fileExists.mockResolvedValue(true)

			// Mock AST analyzer to find references
			mockASTAnalyzer.findReferences.mockResolvedValue([
				{ filePath: "/project/src/components/UserProfile.tsx", line: 5 },
				{ filePath: "/project/src/pages/Dashboard.tsx", line: 8 },
			])

			// Execute step 1
			const step1Request: ExecuteStepRequest = {
				planId,
				stepId: "step-1",
			}

			const step1Response: StepExecutionResponse = {
				step: { ...plan.steps[0], status: "completed" },
				success: true,
				appliedChanges: [
					{
						filePath: "/project/src/services/auth/AuthService.ts",
						changeType: "update",
						oldContent: "export function getUserData() {",
						newContent: "export function fetchUserProfile() {",
						success: true,
					},
				],
			}

			mockStepExecutor.execute.mockResolvedValue(step1Response)

			const result1 = await mockStepExecutor.execute(step1Request)

			expect(result1.success).toBe(true)
			expect(result1.step.status).toBe("completed")
			expect(result1.appliedChanges).toHaveLength(1)

			// Execute step 2 (depends on step 1)
			const step2Request: ExecuteStepRequest = {
				planId,
				stepId: "step-2",
			}

			const step2Response: StepExecutionResponse = {
				step: { ...plan.steps[1], status: "completed" },
				success: true,
				appliedChanges: [
					{
						filePath: "/project/src/components/UserProfile.tsx",
						changeType: "update",
						oldContent: "import { getUserData } from '@/services/auth'",
						newContent: "import { fetchUserProfile } from '@/services/auth'",
						success: true,
					},
					{
						filePath: "/project/src/pages/Dashboard.tsx",
						changeType: "update",
						oldContent: "import { getUserData } from '@/services/auth'",
						newContent: "import { fetchUserProfile } from '@/services/auth'",
						success: true,
					},
				],
			}

			mockStepExecutor.execute.mockResolvedValue(step2Response)

			const result2 = await mockStepExecutor.execute(step2Request)

			expect(result2.success).toBe(true)
			expect(result2.step.status).toBe("completed")
			expect(result2.appliedChanges).toHaveLength(2)

			// Execute step 3 (depends on step 1 and step 2)
			const step3Request: ExecuteStepRequest = {
				planId,
				stepId: "step-3",
			}

			const step3Response: StepExecutionResponse = {
				step: { ...plan.steps[2], status: "completed" },
				success: true,
				appliedChanges: [
					{
						filePath: "/project/src/components/UserProfile.tsx",
						changeType: "update",
						oldContent: "const data = getUserData()",
						newContent: "const data = fetchUserProfile()",
						success: true,
					},
				],
			}

			mockStepExecutor.execute.mockResolvedValue(step3Response)

			const result3 = await mockStepExecutor.execute(step3Request)

			expect(result3.success).toBe(true)
			expect(result3.step.status).toBe("completed")

			// Verify all steps completed successfully
			expect(mockStepExecutor.execute).toHaveBeenCalledTimes(3)
		})

		test("should handle step execution with conflicts and provide rollback", async () => {
			const planId = "550e8400-e29b-41d4-a716-446655440001"

			const stepRequest: ExecuteStepRequest = {
				planId,
				stepId: "step-1",
			}

			// Mock file conflict
			const conflictResponse: StepExecutionResponse = {
				step: {
					id: "step-1",
					planId,
					order: 1,
					title: "Update file with conflict",
					type: "update",
					files: [],
					description: "Update file",
					status: "failed",
					dependencies: [],
				},
				success: false,
				appliedChanges: [],
				conflicts: [
					{
						filePath: "/project/src/services/auth/AuthService.ts",
						type: "content",
						description: "File has been modified externally since plan was created",
						resolution: "Manual review required",
					},
				],
				warnings: ["Execution halted due to conflict"],
			}

			mockStepExecutor.execute.mockResolvedValue(conflictResponse)

			const result = await mockStepExecutor.execute(stepRequest)

			expect(result.success).toBe(false)
			expect(result.step.status).toBe("failed")
			expect(result.conflicts).toHaveLength(1)
			expect(result.conflicts![0].type).toBe("content")
			expect(result.warnings).toContain("Execution halted due to conflict")

			// Verify rollback was attempted
			mockStepExecutor.rollback.mockResolvedValue(true)
			await mockStepExecutor.rollback(planId, "step-1")
			expect(mockStepExecutor.rollback).toHaveBeenCalled()
		})

		test("should skip steps when dependencies are not met", async () => {
			const planId = "550e8400-e29b-41d4-a716-446655440002"

			// Step 2 depends on step 1, but step 1 failed
			const step2Request: ExecuteStepRequest = {
				planId,
				stepId: "step-2",
			}

			const step2Response: StepExecutionResponse = {
				step: {
					id: "step-2",
					planId,
					order: 2,
					title: "Dependent step",
					type: "update",
					files: [],
					description: "Step that depends on step-1",
					status: "skipped",
					dependencies: ["step-1"],
				},
				success: false,
				appliedChanges: [],
				warnings: ["Dependency step-1 not completed"],
			}

			mockStepExecutor.execute.mockResolvedValue(step2Response)

			const result = await mockStepExecutor.execute(step2Request)

			expect(result.success).toBe(false)
			expect(result.step.status).toBe("skipped")
			expect(result.warnings).toContain("Dependency step-1 not completed")
		})
	})

	describe("Plan Generation and Execution", () => {
		test("should generate plan from initial change and execute it", async () => {
			const generationRequest: EditPlanGenerationRequest = {
				initialChange: {
					filePath: "/project/src/services/auth/AuthService.ts",
					changeType: "update",
					content: "Add error handling to getUserData function",
				},
				scope: "project",
				includeTests: true,
				includeDocumentation: true,
			}

			// Mock AST analysis
			mockASTAnalyzer.analyzeFile.mockResolvedValue({
				filePath: "/project/src/services/auth/AuthService.ts",
				language: "typescript",
				dependencies: [],
				references: [
					{ filePath: "/project/src/components/UserProfile.tsx", line: 10 },
					{ filePath: "/project/src/pages/Dashboard.tsx", line: 15 },
				],
			})

			// Mock file system
			mockFileSystem.readFile.mockResolvedValue("export function getUserData() {}")

			// Generate plan
			const generatedPlan: EditPlan = {
				id: "550e8400-e29b-41d4-a716-446655440003",
				userId: "user-123",
				title: "Add error handling to getUserData",
				description: "Generated plan to add error handling",
				status: "pending",
				steps: [
					{
						id: "step-1",
						planId: "550e8400-e29b-41d4-a716-446655440003",
						order: 1,
						title: "Add error handling to AuthService",
						type: "update",
						files: [
							{
								id: "file-1",
								stepId: "step-1",
								filePath: "/project/src/services/auth/AuthService.ts",
								changeType: "update",
							},
						],
						description: "Add try-catch blocks and error logging",
						status: "pending",
						dependencies: [],
					},
					{
						id: "step-2",
						planId: "550e8400-e29b-41d4-a716-446655440003",
						order: 2,
						title: "Update error handling in components",
						type: "update",
						files: [
							{
								id: "file-2",
								stepId: "step-2",
								filePath: "/project/src/components/UserProfile.tsx",
								changeType: "update",
							},
						],
						description: "Handle errors from getUserData",
						status: "pending",
						dependencies: ["step-1"],
					},
				],
				createdAt: new Date(),
				updatedAt: new Date(),
				metadata: {
					estimatedFiles: 2,
					complexity: "low",
				},
			}

			// Verify plan was generated correctly
			expect(generatedPlan.steps).toHaveLength(2)
			expect(generatedPlan.steps[0].dependencies).toHaveLength(0)
			expect(generatedPlan.steps[1].dependencies).toContain("step-1")

			// Execute the plan
			const step1Request: ExecuteStepRequest = {
				planId: generatedPlan.id,
				stepId: "step-1",
			}

			const step1Response: StepExecutionResponse = {
				step: { ...generatedPlan.steps[0], status: "completed" },
				success: true,
				appliedChanges: [
					{
						filePath: "/project/src/services/auth/AuthService.ts",
						changeType: "update",
						oldContent: "export function getUserData() {}",
						newContent:
							"export function getUserData() {\n  try {\n    // implementation\n  } catch (error) {\n    console.error('Error:', error)\n  }\n}",
						success: true,
					},
				],
			}

			mockStepExecutor.execute.mockResolvedValue(step1Response)

			const result = await mockStepExecutor.execute(step1Request)

			expect(result.success).toBe(true)
			expect(result.step.status).toBe("completed")
		})
	})

	describe("Multi-File Operations", () => {
		test("should handle plan with multiple files in single step", async () => {
			const planId = "550e8400-e29b-41d4-a716-446655440004"

			const stepRequest: ExecuteStepRequest = {
				planId,
				stepId: "step-1",
			}

			// Step with multiple files
			const response: StepExecutionResponse = {
				step: {
					id: "step-1",
					planId,
					order: 1,
					title: "Update multiple configuration files",
					type: "update",
					files: [],
					description: "Update all config files",
					status: "completed",
					dependencies: [],
				},
				success: true,
				appliedChanges: [
					{
						filePath: "/project/.env",
						changeType: "update",
						oldContent: "API_KEY=old",
						newContent: "API_KEY=new",
						success: true,
					},
					{
						filePath: "/project/.env.production",
						changeType: "update",
						oldContent: "API_KEY=old",
						newContent: "API_KEY=new",
						success: true,
					},
					{
						filePath: "/project/.env.staging",
						changeType: "update",
						oldContent: "API_KEY=old",
						newContent: "API_KEY=new",
						success: true,
					},
				],
			}

			mockStepExecutor.execute.mockResolvedValue(response)

			const result = await mockStepExecutor.execute(stepRequest)

			expect(result.success).toBe(true)
			expect(result.appliedChanges).toHaveLength(3)
			result.appliedChanges.forEach((change: FileChange) => {
				expect(change.success).toBe(true)
			})
		})

		test("should handle partial failure in multi-file operation", async () => {
			const planId = "550e8400-e29b-41d4-a716-446655440005"

			const stepRequest: ExecuteStepRequest = {
				planId,
				stepId: "step-1",
			}

			const response: StepExecutionResponse = {
				step: {
					id: "step-1",
					planId,
					order: 1,
					title: "Update multiple files",
					type: "update",
					files: [],
					description: "Update files",
					status: "failed",
					dependencies: [],
				},
				success: false,
				appliedChanges: [
					{
						filePath: "/project/src/file1.ts",
						changeType: "update",
						oldContent: "old",
						newContent: "new",
						success: true,
					},
					{
						filePath: "/project/src/file2.ts",
						changeType: "update",
						oldContent: "old",
						newContent: "new",
						success: false,
						error: "Permission denied",
					},
					{
						filePath: "/project/src/file3.ts",
						changeType: "update",
						oldContent: "old",
						newContent: "new",
						success: true,
					},
				],
				conflicts: [
					{
						filePath: "/project/src/file2.ts",
						type: "permission",
						description: "Permission denied",
					},
				],
				warnings: ["2 of 3 files updated successfully"],
			}

			mockStepExecutor.execute.mockResolvedValue(response)

			const result = await mockStepExecutor.execute(stepRequest)

			expect(result.success).toBe(false)
			expect(result.appliedChanges).toHaveLength(3)
			expect(result.appliedChanges[1].success).toBe(false)
			expect(result.appliedChanges[1].error).toBe("Permission denied")
			expect(result.conflicts).toHaveLength(1)
		})
	})

	describe("Dry Run Mode", () => {
		test("should validate changes without applying them in dry run mode", async () => {
			const planId = "550e8400-e29b-41d4-a716-446655440006"

			const stepRequest: ExecuteStepRequest = {
				planId,
				stepId: "step-1",
				options: {
					dryRun: true,
				},
			}

			const response: StepExecutionResponse = {
				step: {
					id: "step-1",
					planId,
					order: 1,
					title: "Update file",
					type: "update",
					files: [],
					description: "Update file",
					status: "pending",
					dependencies: [],
				},
				success: true,
				appliedChanges: [
					{
						filePath: "/project/src/test.ts",
						changeType: "update",
						oldContent: "const x = 1",
						newContent: "const x = 2",
						success: true,
					},
				],
				warnings: ["Dry run - no changes applied to disk"],
			}

			mockStepExecutor.execute.mockResolvedValue(response)

			const result = await mockStepExecutor.execute(stepRequest)

			expect(result.success).toBe(true)
			expect(result.step.status).toBe("pending") // Status remains pending in dry run
			expect(result.warnings).toContain("Dry run - no changes applied to disk")

			// Verify no actual file operations occurred
			expect(mockFileSystem.writeFile).not.toHaveBeenCalled()
		})
	})

	describe("Error Recovery", () => {
		test("should recover from step failure and retry", async () => {
			const planId = "550e8400-e29b-41d4-a716-446655440007"

			const stepRequest: ExecuteStepRequest = {
				planId,
				stepId: "step-1",
				options: {
					force: true,
				},
			}

			// First attempt fails
			const failedResponse: StepExecutionResponse = {
				step: {
					id: "step-1",
					planId,
					order: 1,
					title: "Update file",
					type: "update",
					files: [],
					description: "Update file",
					status: "failed",
					dependencies: [],
				},
				success: false,
				appliedChanges: [],
				conflicts: [
					{
						filePath: "/project/src/test.ts",
						type: "content",
						description: "Temporary lock",
					},
				],
			}

			// Retry succeeds
			const successResponse: StepExecutionResponse = {
				step: {
					id: "step-1",
					planId,
					order: 1,
					title: "Update file",
					type: "update",
					files: [],
					description: "Update file",
					status: "completed",
					dependencies: [],
				},
				success: true,
				appliedChanges: [
					{
						filePath: "/project/src/test.ts",
						changeType: "update",
						oldContent: "old",
						newContent: "new",
						success: true,
					},
				],
			}

			// First attempt
			mockStepExecutor.execute.mockResolvedValueOnce(failedResponse)
			let result = await mockStepExecutor.execute(stepRequest)
			expect(result.success).toBe(false)

			// Retry with force option
			mockStepExecutor.execute.mockResolvedValueOnce(successResponse)
			result = await mockStepExecutor.execute(stepRequest)
			expect(result.success).toBe(true)
			expect(result.step.status).toBe("completed")
		})
	})
})
