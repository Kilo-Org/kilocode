import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentTaskRunner, AgentTasks, type AgentTask } from "../AgentTaskRunner"

// Mock simple-git
const mockGit = {
	diff: vi.fn(),
	commit: vi.fn(),
}

vi.mock("simple-git", () => ({
	default: vi.fn(() => mockGit),
}))

// Mock vscode
vi.mock("vscode", () => ({
	default: {},
}))

describe("AgentTaskRunner", () => {
	const mockOutputChannel = {
		appendLine: vi.fn(),
	}
	let sendMessage: ReturnType<typeof vi.fn>
	let runner: AgentTaskRunner

	beforeEach(() => {
		vi.clearAllMocks()
		sendMessage = vi.fn().mockResolvedValue(undefined)
		runner = new AgentTaskRunner(mockOutputChannel as any, sendMessage)
	})

	describe("executeTask", () => {
		it("sends instruction and returns success when task completes", async () => {
			const task: AgentTask = {
				name: "test-task",
				instruction: "Do something",
				timeoutMs: 100,
				checkComplete: vi.fn().mockResolvedValue(true),
			}

			const result = await runner.executeTask("session-1", task)

			expect(sendMessage).toHaveBeenCalledWith("session-1", "Do something")
			expect(result.success).toBe(true)
			expect(result.completedByAgent).toBe(true)
		})

		it("runs fallback when agent times out", async () => {
			const fallback = vi.fn().mockResolvedValue(undefined)
			const task: AgentTask = {
				name: "test-task",
				instruction: "Do something",
				timeoutMs: 50,
				checkComplete: vi.fn().mockResolvedValue(false),
				fallback,
			}

			const result = await runner.executeTask("session-1", task)

			expect(result.success).toBe(true)
			expect(result.completedByAgent).toBe(false)
			expect(fallback).toHaveBeenCalled()
		})

		it("returns failure when agent times out and no fallback", async () => {
			const task: AgentTask = {
				name: "test-task",
				instruction: "Do something",
				timeoutMs: 50,
				checkComplete: vi.fn().mockResolvedValue(false),
			}

			const result = await runner.executeTask("session-1", task)

			expect(result.success).toBe(false)
			expect(result.completedByAgent).toBe(false)
			expect(result.error).toBe("Agent timed out")
		})

		it("returns failure when sendMessage throws", async () => {
			sendMessage.mockRejectedValue(new Error("Connection lost"))
			const task: AgentTask = {
				name: "test-task",
				instruction: "Do something",
				timeoutMs: 100,
				checkComplete: vi.fn().mockResolvedValue(true),
			}

			const result = await runner.executeTask("session-1", task)

			expect(result.success).toBe(false)
			expect(result.error).toBe("Connection lost")
		})

		it("polls until completion within timeout", async () => {
			let callCount = 0
			const task: AgentTask = {
				name: "test-task",
				instruction: "Do something",
				timeoutMs: 5000,
				checkComplete: vi.fn().mockImplementation(async () => {
					callCount++
					return callCount >= 3 // Complete on 3rd check
				}),
			}

			const result = await runner.executeTask("session-1", task)

			expect(result.success).toBe(true)
			expect(result.completedByAgent).toBe(true)
			expect(callCount).toBe(3)
		})
	})
})

describe("AgentTasks", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("createCommitTask", () => {
		it("creates task with correct instruction", () => {
			const task = AgentTasks.createCommitTask("/path/to/worktree", "fallback message")

			expect(task.name).toBe("commit-changes")
			expect(task.instruction).toContain("conventional commit message")
			expect(task.instruction).toContain("git diff --staged")
			expect(task.timeoutMs).toBe(60_000)
		})

		it("checkComplete returns true when no staged changes", async () => {
			mockGit.diff.mockResolvedValue("")
			const task = AgentTasks.createCommitTask("/path/to/worktree", "fallback message")

			const complete = await task.checkComplete()

			expect(complete).toBe(true)
			expect(mockGit.diff).toHaveBeenCalledWith(["--staged"])
		})

		it("checkComplete returns false when staged changes exist", async () => {
			mockGit.diff.mockResolvedValue("some diff content")
			const task = AgentTasks.createCommitTask("/path/to/worktree", "fallback message")

			const complete = await task.checkComplete()

			expect(complete).toBe(false)
		})

		it("fallback commits with provided message", async () => {
			mockGit.commit.mockResolvedValue(undefined)
			const task = AgentTasks.createCommitTask("/path/to/worktree", "chore: fallback")

			await task.fallback!()

			expect(mockGit.commit).toHaveBeenCalledWith("chore: fallback")
		})
	})

	describe("createPullRequestTask", () => {
		it("creates task with correct instruction", () => {
			const task = AgentTasks.createPullRequestTask("/path/to/worktree", "main")

			expect(task.name).toBe("create-pull-request")
			expect(task.instruction).toContain("pull request")
			expect(task.instruction).toContain("main")
			expect(task.timeoutMs).toBe(60_000)
		})
	})
})
