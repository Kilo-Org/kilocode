/**
 * Tests for approval atoms
 */

import { describe, it, expect } from "vitest"
import { createStore } from "jotai"
import { approvalOptionsAtom, pendingApprovalAtom } from "../approval.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

// Helper to create a test message
const createMessage = (ask: string, text: string = "{}"): ExtensionChatMessage => ({
	type: "ask",
	ask,
	text,
	ts: Date.now(),
	partial: false,
	isAnswered: false,
	say: "assistant",
})

describe("approval atoms", () => {
	describe("approvalOptionsAtom", () => {
		it("should return empty array when no pending approval", () => {
			const store = createStore()
			const options = store.get(approvalOptionsAtom)
			expect(options).toEqual([])
		})

		it("should return basic options for tool requests", () => {
			const store = createStore()
			const message = createMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(pendingApprovalAtom, message)

			const options = store.get(approvalOptionsAtom)
			expect(options).toHaveLength(2)
			expect(options[0].action).toBe("approve")
			expect(options[1].action).toBe("reject")
		})

		it("should return Save label for file operations", () => {
			const store = createStore()
			const message = createMessage("tool", JSON.stringify({ tool: "editedExistingFile" }))
			store.set(pendingApprovalAtom, message)

			const options = store.get(approvalOptionsAtom)
			expect(options[0].label).toBe("Save")
		})

		describe("command approval options", () => {
			it("should generate hierarchical options for simple command (plain text)", () => {
				const store = createStore()
				const message = createMessage("command", "git")
				store.set(pendingApprovalAtom, message)

				const options = store.get(approvalOptionsAtom)
				expect(options).toHaveLength(3) // Run Command, Always Run "git", Reject
				expect(options[0].label).toBe("Run Command")
				expect(options[0].action).toBe("approve")
				expect(options[1].label).toBe('Always Run "git"')
				expect(options[1].action).toBe("approve-and-remember")
				expect(options[1].commandPattern).toBe("git")
				expect(options[2].label).toBe("Reject")
				expect(options[2].action).toBe("reject")
			})

			it("should generate hierarchical options for simple command (JSON format)", () => {
				const store = createStore()
				const message = createMessage("command", JSON.stringify({ command: "git" }))
				store.set(pendingApprovalAtom, message)

				const options = store.get(approvalOptionsAtom)
				expect(options).toHaveLength(3) // Run Command, Always Run "git", Reject
				expect(options[0].label).toBe("Run Command")
				expect(options[0].action).toBe("approve")
				expect(options[1].label).toBe('Always Run "git"')
				expect(options[1].action).toBe("approve-and-remember")
				expect(options[1].commandPattern).toBe("git")
				expect(options[2].label).toBe("Reject")
				expect(options[2].action).toBe("reject")
			})

			it("should generate hierarchical options for command with subcommand (plain text)", () => {
				const store = createStore()
				const message = createMessage("command", "git status")
				store.set(pendingApprovalAtom, message)

				const options = store.get(approvalOptionsAtom)
				expect(options).toHaveLength(4) // Run Command, Always Run "git", Always Run "git status", Reject
				expect(options[0].label).toBe("Run Command")
				expect(options[1].label).toBe('Always Run "git"')
				expect(options[1].commandPattern).toBe("git")
				expect(options[2].label).toBe('Always Run "git status"')
				expect(options[2].commandPattern).toBe("git status")
				expect(options[3].label).toBe("Reject")
			})

			it("should generate hierarchical options for full command with flags (plain text)", () => {
				const store = createStore()
				const message = createMessage("command", "git status --short --branch")
				store.set(pendingApprovalAtom, message)

				const options = store.get(approvalOptionsAtom)
				expect(options).toHaveLength(5) // Run Command, 3 Always Run options, Reject
				expect(options[0].label).toBe("Run Command")
				expect(options[1].label).toBe('Always Run "git"')
				expect(options[1].commandPattern).toBe("git")
				expect(options[2].label).toBe('Always Run "git status"')
				expect(options[2].commandPattern).toBe("git status")
				expect(options[3].label).toBe('Always Run "git status --short --branch"')
				expect(options[3].commandPattern).toBe("git status --short --branch")
				expect(options[4].label).toBe("Reject")
			})

			it("should assign hotkeys correctly (plain text)", () => {
				const store = createStore()
				const message = createMessage("command", "git status --short")
				store.set(pendingApprovalAtom, message)

				const options = store.get(approvalOptionsAtom)
				expect(options[0].hotkey).toBe("y") // Run Command
				expect(options[1].hotkey).toBe("1") // Always Run "git"
				expect(options[2].hotkey).toBe("2") // Always Run "git status"
				expect(options[3].hotkey).toBe("3") // Always Run "git status --short --branch"
				expect(options[4].hotkey).toBe("n") // Reject
			})

			it("should handle commands with extra whitespace (plain text)", () => {
				const store = createStore()
				const message = createMessage("command", "  npm   install  ")
				store.set(pendingApprovalAtom, message)

				const options = store.get(approvalOptionsAtom)
				expect(options).toHaveLength(4) // Run Command, Always run npm, Always run npm install, Reject
				expect(options[1].commandPattern).toBe("npm")
				expect(options[2].commandPattern).toBe("npm install")
			})

			it("should handle empty command gracefully (plain text)", () => {
				const store = createStore()
				const message = createMessage("command", "")
				store.set(pendingApprovalAtom, message)

				const options = store.get(approvalOptionsAtom)
				expect(options).toHaveLength(2) // Run Command, Reject (no Always run options)
			})

			it("should handle invalid JSON as plain text command", () => {
				const store = createStore()
				const message = createMessage("command", "invalid json")
				store.set(pendingApprovalAtom, message)

				const options = store.get(approvalOptionsAtom)
				// "invalid json" is treated as a command with two parts: "invalid" and "invalid json"
				expect(options).toHaveLength(4) // Run Command, Always run invalid, Always run invalid json, Reject
				expect(options[1].commandPattern).toBe("invalid")
				expect(options[2].commandPattern).toBe("invalid json")
			})
		})
	})
})
