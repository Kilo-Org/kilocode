// kilocode_change - new file
import * as vscode from "vscode"
import { OnboardingStateDetector } from "../OnboardingStateDetector"
import { HistoryItem } from "@roo-code/types"

describe("OnboardingStateDetector", () => {
	let mockContext: vscode.ExtensionContext
	let mockGlobalState: Map<string, unknown>

	beforeEach(() => {
		mockGlobalState = new Map()
		mockContext = {
			globalState: {
				get: vi.fn((key: string) => mockGlobalState.get(key)),
				update: vi.fn((key: string, value: unknown) => {
					mockGlobalState.set(key, value)
					return Promise.resolve()
				}),
			},
		} as unknown as vscode.ExtensionContext
	})

	describe("detectWorkspaceState", () => {
		it("should return hasOpenFolder=false and hasSessionHistory=false when no workspace folders", async () => {
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(undefined)

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectWorkspaceState()

			expect(result.hasOpenFolder).toBe(false)
			expect(result.hasSessionHistory).toBe(false)
		})

		it("should return hasOpenFolder=true when workspace has folders", async () => {
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
				{ uri: { fsPath: "/test/workspace" } },
			] as vscode.WorkspaceFolder[])

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectWorkspaceState()

			expect(result.hasOpenFolder).toBe(true)
		})

		it("should return hasSessionHistory=false when no task history exists", async () => {
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
				{ uri: { fsPath: "/test/workspace" } },
			] as vscode.WorkspaceFolder[])
			mockGlobalState.set("taskHistory", [])

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectWorkspaceState()

			expect(result.hasSessionHistory).toBe(false)
		})

		it("should return hasSessionHistory=false when task history exists but for different workspace", async () => {
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
				{ uri: { fsPath: "/test/workspace" } },
			] as vscode.WorkspaceFolder[])

			const taskHistory: HistoryItem[] = [
				{
					id: "task-1",
					number: 1,
					ts: Date.now(),
					task: "Test task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					workspace: "/different/workspace",
				},
			]
			mockGlobalState.set("taskHistory", taskHistory)

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectWorkspaceState()

			expect(result.hasSessionHistory).toBe(false)
		})

		it("should return hasSessionHistory=true when task history exists for current workspace", async () => {
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
				{ uri: { fsPath: "/test/workspace" } },
			] as vscode.WorkspaceFolder[])

			const taskHistory: HistoryItem[] = [
				{
					id: "task-1",
					number: 1,
					ts: Date.now(),
					task: "Test task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					workspace: "/test/workspace",
				},
			]
			mockGlobalState.set("taskHistory", taskHistory)

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectWorkspaceState()

			expect(result.hasSessionHistory).toBe(true)
		})

		it("should return hasSessionHistory=true when at least one task matches current workspace", async () => {
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
				{ uri: { fsPath: "/test/workspace" } },
			] as vscode.WorkspaceFolder[])

			const taskHistory: HistoryItem[] = [
				{
					id: "task-1",
					number: 1,
					ts: Date.now(),
					task: "Task in different workspace",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					workspace: "/different/workspace",
				},
				{
					id: "task-2",
					number: 2,
					ts: Date.now(),
					task: "Task in current workspace",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					workspace: "/test/workspace",
				},
			]
			mockGlobalState.set("taskHistory", taskHistory)

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectWorkspaceState()

			expect(result.hasSessionHistory).toBe(true)
		})

		it("should return hasSessionHistory=false when no workspace is open even if history exists", async () => {
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(undefined)

			const taskHistory: HistoryItem[] = [
				{
					id: "task-1",
					number: 1,
					ts: Date.now(),
					task: "Test task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					workspace: "/test/workspace",
				},
			]
			mockGlobalState.set("taskHistory", taskHistory)

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectWorkspaceState()

			expect(result.hasSessionHistory).toBe(false)
		})
	})

	describe("detectEditorState", () => {
		it("should return hasOpenFile=false when no active editor", async () => {
			vi.spyOn(vscode.window, "activeTextEditor", "get").mockReturnValue(undefined)

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectEditorState()

			expect(result.hasOpenFile).toBe(false)
			expect(result.hasSelectedCode).toBe(false)
		})

		it("should return hasOpenFile=true when active editor exists", async () => {
			vi.spyOn(vscode.window, "activeTextEditor", "get").mockReturnValue({
				selection: { isEmpty: true },
			} as vscode.TextEditor)

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectEditorState()

			expect(result.hasOpenFile).toBe(true)
			expect(result.hasSelectedCode).toBe(false)
		})

		it("should return hasSelectedCode=true when editor has selection", async () => {
			vi.spyOn(vscode.window, "activeTextEditor", "get").mockReturnValue({
				selection: { isEmpty: false },
			} as vscode.TextEditor)

			const detector = new OnboardingStateDetector(mockContext)
			const result = await detector.detectEditorState()

			expect(result.hasOpenFile).toBe(true)
			expect(result.hasSelectedCode).toBe(true)
		})
	})
})
