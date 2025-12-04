// npx vitest src/core/tools/__tests__/listCodeDefinitionNamesTool.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { listCodeDefinitionNamesTool } from "../listCodeDefinitionNamesTool"
import { Task } from "../../task/Task"
import { ToolUse } from "../../../shared/tools"
import * as treeSitter from "../../../services/tree-sitter"
import fs from "fs/promises"

// Mock the tree-sitter service
vi.mock("../../../services/tree-sitter", () => ({
	parseSourceCodeDefinitionsForFile: vi.fn(),
	parseSourceCodeForDefinitionsTopLevel: vi.fn(),
}))

// Mock fs module
vi.mock("fs/promises", () => ({
	default: {
		stat: vi.fn(),
	},
}))

describe("listCodeDefinitionNamesTool", () => {
	let mockTask: Partial<Task>
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockTask = {
			cwd: "/test/path",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn(),
			ask: vi.fn(),
			fileContextTracker: {
				trackFileContext: vi.fn(),
			},
			providerRef: {
				deref: vi.fn(() => ({
					getState: vi.fn(async () => ({ maxReadFileLine: -1 })),
				})),
			},
			rooIgnoreController: undefined,
		} as any

		mockAskApproval = vi.fn(async () => true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag: string, value: string) => value)
	})

	describe("truncateDefinitionsToLineLimit", () => {
		it("should not truncate when maxReadFileLine is -1 (no limit)", async () => {
			const mockDefinitions = `# test.ts
10--20 | function foo() {
30--40 | function bar() {
50--60 | function baz() {`

			vi.mocked(treeSitter.parseSourceCodeDefinitionsForFile).mockResolvedValue(mockDefinitions)

			vi.mocked(fs.stat).mockResolvedValue({
				isFile: () => true,
				isDirectory: () => false,
			} as any)

			mockTask.providerRef = {
				deref: vi.fn(() => ({
					getState: vi.fn(async () => ({ maxReadFileLine: -1 })),
				})),
			} as any

			const block: ToolUse = {
				type: "tool_use",
				name: "list_code_definition_names",
				params: { path: "test.ts" },
				partial: false,
			}

			await listCodeDefinitionNamesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockPushToolResult).toHaveBeenCalledWith(mockDefinitions)
		})

		it("should not truncate when maxReadFileLine is 0 (definitions only mode)", async () => {
			const mockDefinitions = `# test.ts
10--20 | function foo() {
30--40 | function bar() {
50--60 | function baz() {`

			vi.mocked(treeSitter.parseSourceCodeDefinitionsForFile).mockResolvedValue(mockDefinitions)

			vi.mocked(fs.stat).mockResolvedValue({
				isFile: () => true,
				isDirectory: () => false,
			} as any)

			mockTask.providerRef = {
				deref: vi.fn(() => ({
					getState: vi.fn(async () => ({ maxReadFileLine: 0 })),
				})),
			} as any

			const block: ToolUse = {
				type: "tool_use",
				name: "list_code_definition_names",
				params: { path: "test.ts" },
				partial: false,
			}

			await listCodeDefinitionNamesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			expect(mockPushToolResult).toHaveBeenCalledWith(mockDefinitions)
		})

		it("should truncate definitions when maxReadFileLine is set", async () => {
			const mockDefinitions = `# test.ts
10--20 | function foo() {
30--40 | function bar() {
50--60 | function baz() {`

			vi.mocked(treeSitter.parseSourceCodeDefinitionsForFile).mockResolvedValue(mockDefinitions)

			vi.mocked(fs.stat).mockResolvedValue({
				isFile: () => true,
				isDirectory: () => false,
			} as any)

			mockTask.providerRef = {
				deref: vi.fn(() => ({
					getState: vi.fn(async () => ({ maxReadFileLine: 25 })),
				})),
			} as any

			const block: ToolUse = {
				type: "tool_use",
				name: "list_code_definition_names",
				params: { path: "test.ts" },
				partial: false,
			}

			await listCodeDefinitionNamesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should only include definitions starting at or before line 25
			const expectedResult = `# test.ts
10--20 | function foo() {`

			expect(mockPushToolResult).toHaveBeenCalledWith(expectedResult)
		})

		it("should include definitions that start within limit even if they end beyond it", async () => {
			const mockDefinitions = `# test.ts
10--50 | function foo() {
60--80 | function bar() {`

			vi.mocked(treeSitter.parseSourceCodeDefinitionsForFile).mockResolvedValue(mockDefinitions)

			vi.mocked(fs.stat).mockResolvedValue({
				isFile: () => true,
				isDirectory: () => false,
			} as any)

			mockTask.providerRef = {
				deref: vi.fn(() => ({
					getState: vi.fn(async () => ({ maxReadFileLine: 30 })),
				})),
			} as any

			const block: ToolUse = {
				type: "tool_use",
				name: "list_code_definition_names",
				params: { path: "test.ts" },
				partial: false,
			}

			await listCodeDefinitionNamesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should include foo (starts at 10) but not bar (starts at 60)
			const expectedResult = `# test.ts
10--50 | function foo() {`

			expect(mockPushToolResult).toHaveBeenCalledWith(expectedResult)
		})

		it("should handle single-line definitions", async () => {
			const mockDefinitions = `# test.ts
10 | const foo = 1
20 | const bar = 2
30 | const baz = 3`

			vi.mocked(treeSitter.parseSourceCodeDefinitionsForFile).mockResolvedValue(mockDefinitions)

			vi.mocked(fs.stat).mockResolvedValue({
				isFile: () => true,
				isDirectory: () => false,
			} as any)

			mockTask.providerRef = {
				deref: vi.fn(() => ({
					getState: vi.fn(async () => ({ maxReadFileLine: 25 })),
				})),
			} as any

			const block: ToolUse = {
				type: "tool_use",
				name: "list_code_definition_names",
				params: { path: "test.ts" },
				partial: false,
			}

			await listCodeDefinitionNamesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should include foo and bar but not baz
			const expectedResult = `# test.ts
10 | const foo = 1
20 | const bar = 2`

			expect(mockPushToolResult).toHaveBeenCalledWith(expectedResult)
		})

		it("should preserve header line when truncating", async () => {
			const mockDefinitions = `# test.ts
100--200 | function foo() {`

			vi.mocked(treeSitter.parseSourceCodeDefinitionsForFile).mockResolvedValue(mockDefinitions)

			vi.mocked(fs.stat).mockResolvedValue({
				isFile: () => true,
				isDirectory: () => false,
			} as any)

			mockTask.providerRef = {
				deref: vi.fn(() => ({
					getState: vi.fn(async () => ({ maxReadFileLine: 50 })),
				})),
			} as any

			const block: ToolUse = {
				type: "tool_use",
				name: "list_code_definition_names",
				params: { path: "test.ts" },
				partial: false,
			}

			await listCodeDefinitionNamesTool(
				mockTask as Task,
				block,
				mockAskApproval,
				mockHandleError,
				mockPushToolResult,
				mockRemoveClosingTag,
			)

			// Should keep header but exclude all definitions beyond line 50
			const expectedResult = `# test.ts`

			expect(mockPushToolResult).toHaveBeenCalledWith(expectedResult)
		})
	})

	it("should handle missing path parameter", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "list_code_definition_names",
			params: {},
			partial: false,
		}

		mockTask.sayAndCreateMissingParamError = vi.fn(async () => "Missing parameter: path")

		await listCodeDefinitionNamesTool(
			mockTask as Task,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("list_code_definition_names")
		expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter: path")
	})

	it("should handle directory path", async () => {
		const mockDefinitions = "# Directory definitions"

		vi.mocked(treeSitter.parseSourceCodeForDefinitionsTopLevel).mockResolvedValue(mockDefinitions)

		vi.mocked(fs.stat).mockResolvedValue({
			isFile: () => false,
			isDirectory: () => true,
		} as any)

		const block: ToolUse = {
			type: "tool_use",
			name: "list_code_definition_names",
			params: { path: "src" },
			partial: false,
		}

		await listCodeDefinitionNamesTool(
			mockTask as Task,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockPushToolResult).toHaveBeenCalledWith(mockDefinitions)
	})
})
