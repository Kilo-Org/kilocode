/**
 * Tests for hooks execution runner
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { HooksConfig } from "../../config/types.js"

// Mock child_process
const mockSpawn = vi.fn()

vi.mock("child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}))

vi.mock("../../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

// Import after mocks
const {
	matchesPattern,
	runHooks,
	runPreToolUseHooks,
	runPostToolUseHooks,
	runUserPromptSubmitHooks,
	runStopHooks,
	runSessionStartHooks,
	runSessionEndHooks,
} = await import("../runner.js")

describe("Hooks Runner", () => {
	describe("matchesPattern", () => {
		it("should match empty string to any target", () => {
			expect(matchesPattern("", "Bash")).toBe(true)
			expect(matchesPattern("", "Edit")).toBe(true)
			expect(matchesPattern("", "")).toBe(true)
		})

		it("should match asterisk to any target", () => {
			expect(matchesPattern("*", "Bash")).toBe(true)
			expect(matchesPattern("*", "Edit")).toBe(true)
			expect(matchesPattern("*", "anything")).toBe(true)
		})

		it("should match exact string", () => {
			expect(matchesPattern("Bash", "Bash")).toBe(true)
			expect(matchesPattern("Bash", "Edit")).toBe(false)
		})

		it("should be case-sensitive", () => {
			expect(matchesPattern("bash", "Bash")).toBe(false)
			expect(matchesPattern("Bash", "bash")).toBe(false)
		})

		it("should match pipe-separated patterns (OR)", () => {
			expect(matchesPattern("Edit|Write", "Edit")).toBe(true)
			expect(matchesPattern("Edit|Write", "Write")).toBe(true)
			expect(matchesPattern("Edit|Write", "Bash")).toBe(false)
		})

		it("should handle multiple pipe-separated patterns", () => {
			expect(matchesPattern("Edit|Write|Bash", "Bash")).toBe(true)
			expect(matchesPattern("Edit|Write|Bash", "Read")).toBe(false)
		})

		it("should trim whitespace in pipe patterns", () => {
			expect(matchesPattern("Edit | Write", "Edit")).toBe(true)
			expect(matchesPattern("Edit | Write", "Write")).toBe(true)
		})
	})

	describe("runHooks", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("should return not blocked when no hooks configured", async () => {
			const hooks: HooksConfig = {}
			const result = await runHooks(hooks, "PreToolUse", "Bash", {})

			expect(result.blocked).toBe(false)
			expect(result.results).toEqual([])
		})

		it("should return not blocked when no matchers match", async () => {
			const hooks: HooksConfig = {
				PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo test" }] }],
			}

			const result = await runHooks(hooks, "PreToolUse", "Bash", {})

			expect(result.blocked).toBe(false)
			expect(result.results).toEqual([])
		})

		it("should execute matching hooks", async () => {
			const hooks: HooksConfig = {
				PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo test" }] }],
			}

			// Mock spawn to simulate successful execution
			let stdinWrite = ""
			mockSpawn.mockImplementation(() => {
				const mockChild = {
					stdout: {
						on: vi.fn((event, callback) => {
							if (event === "data") {
								callback(Buffer.from(""))
							}
						}),
					},
					stderr: {
						on: vi.fn((event, callback) => {
							if (event === "data") {
								callback(Buffer.from(""))
							}
						}),
					},
					stdin: {
						write: vi.fn((data: string) => {
							stdinWrite = data
						}),
						end: vi.fn(),
					},
					on: vi.fn((event, callback) => {
						if (event === "close") {
							// Simulate successful exit
							setTimeout(() => callback(0), 10)
						}
					}),
					kill: vi.fn(),
				}
				return mockChild
			})

			const result = await runHooks(hooks, "PreToolUse", "Bash", { tool_name: "Bash" })

			expect(result.blocked).toBe(false)
			expect(result.results).toHaveLength(1)
			expect(result.results[0].exitCode).toBe(0)

			// Verify stdin received JSON input
			const input = JSON.parse(stdinWrite)
			expect(input.hook_event).toBe("PreToolUse")
			expect(input.tool_name).toBe("Bash")
		})

		it("should block when exit code is 2", async () => {
			const hooks: HooksConfig = {
				PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "exit 2" }] }],
			}

			mockSpawn.mockImplementation(() => {
				const mockChild = {
					stdout: { on: vi.fn() },
					stderr: {
						on: vi.fn((event, callback) => {
							if (event === "data") {
								callback(Buffer.from("Blocked by policy"))
							}
						}),
					},
					stdin: { write: vi.fn(), end: vi.fn() },
					on: vi.fn((event, callback) => {
						if (event === "close") {
							setTimeout(() => callback(2), 10)
						}
					}),
					kill: vi.fn(),
				}
				return mockChild
			})

			const result = await runHooks(hooks, "PreToolUse", "Bash", {})

			expect(result.blocked).toBe(true)
			expect(result.blockReason).toContain("Blocked")
		})

		it("should block when JSON decision denies permission", async () => {
			const hooks: HooksConfig = {
				PermissionRequest: [{ matcher: "", hooks: [{ type: "command", command: "check-permission" }] }],
			}

			mockSpawn.mockImplementation(() => {
				const mockChild = {
					stdout: {
						on: vi.fn((event, callback) => {
							if (event === "data") {
								callback(
									Buffer.from(
										JSON.stringify({
											permissionDecision: "deny",
											permissionDecisionReason: "Not allowed",
										}),
									),
								)
							}
						}),
					},
					stderr: { on: vi.fn() },
					stdin: { write: vi.fn(), end: vi.fn() },
					on: vi.fn((event, callback) => {
						if (event === "close") {
							setTimeout(() => callback(0), 10)
						}
					}),
					kill: vi.fn(),
				}
				return mockChild
			})

			const result = await runHooks(hooks, "PermissionRequest", "tool", {})

			expect(result.blocked).toBe(true)
			expect(result.blockReason).toBe("Not allowed")
			expect(result.decision?.permissionDecision).toBe("deny")
		})
	})

	describe("Helper functions", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("runPreToolUseHooks should pass correct input", async () => {
			const hooks: HooksConfig = {}
			const result = await runPreToolUseHooks(
				hooks,
				"Bash",
				{ command: "ls" },
				{ workspace: "/test", session_id: "123" },
			)

			expect(result.blocked).toBe(false)
		})

		it("runPostToolUseHooks should pass correct input", async () => {
			const hooks: HooksConfig = {}
			const result = await runPostToolUseHooks(
				hooks,
				"Bash",
				{ command: "ls" },
				{ output: "file.txt" },
				{ workspace: "/test" },
			)

			expect(result.blocked).toBe(false)
		})

		it("runUserPromptSubmitHooks should pass correct input", async () => {
			const hooks: HooksConfig = {}
			const result = await runUserPromptSubmitHooks(hooks, "Fix the bug", { workspace: "/test" })

			expect(result.blocked).toBe(false)
		})

		it("runStopHooks should pass correct input", async () => {
			const hooks: HooksConfig = {}
			const result = await runStopHooks(hooks, "completion_result", { workspace: "/test" })

			expect(result.blocked).toBe(false)
		})

		it("runSessionStartHooks should pass correct input", async () => {
			const hooks: HooksConfig = {}
			const result = await runSessionStartHooks(hooks, {
				workspace: "/test",
				session_id: "123",
				isResume: false,
			})

			expect(result.blocked).toBe(false)
		})

		it("runSessionEndHooks should pass correct input", async () => {
			const hooks: HooksConfig = {}
			const result = await runSessionEndHooks(hooks, {
				workspace: "/test",
				session_id: "123",
				reason: "user_exit",
			})

			expect(result.blocked).toBe(false)
		})
	})
})
