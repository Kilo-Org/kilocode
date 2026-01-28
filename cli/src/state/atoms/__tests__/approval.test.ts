/**
 * Tests for approval atoms
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { approvalOptionsAtom, pendingApprovalAtom } from "../approval.js"
import { configAtom } from "../config.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { KiloCodeConfig } from "../../../config/types.js"

// Helper to create a config with specific allowed commands
const createConfigWithAllowedCommands = (allowedCommands: string[]): KiloCodeConfig => ({
	version: "1.0.0",
	mode: "ask",
	provider: "anthropic",
	providers: [],
	telemetry: true,
	autoApproval: {
		enabled: true,
		read: { enabled: false, outside: false },
		write: { enabled: false, outside: false, protected: false },
		browser: { enabled: false },
		retry: { enabled: false, delay: 5 },
		mcp: { enabled: false },
		mode: { enabled: false },
		subtasks: { enabled: false },
		todo: { enabled: false },
		execute: { enabled: true, allowed: allowedCommands, denied: [] },
		question: { enabled: false, timeout: 30 },
	},
})

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

			describe("filtering already allowed commands", () => {
				it("should not show 'Always Run' options for commands already in allowed list", () => {
					const store = createStore()
					// Set up config with "git" already allowed
					store.set(configAtom, createConfigWithAllowedCommands(["git"]))

					const message = createMessage("command", "git status")
					store.set(pendingApprovalAtom, message)

					const options = store.get(approvalOptionsAtom)
					// parseCommandHierarchy("git status") generates: ["git", "git status"]
					// matchesCommandPattern("git", ["git"]) returns true (exact match) - filtered
					// matchesCommandPattern("git status", ["git"]) returns true (hierarchical) - filtered
					// So all patterns should be filtered
					expect(options).toHaveLength(2)
					expect(options[0].label).toBe("Run Command")
					expect(options[1].label).toBe("Reject")
				})

				it("should filter all hierarchical patterns that are already allowed", () => {
					const store = createStore()
					// Set up config with "git" already allowed
					store.set(configAtom, createConfigWithAllowedCommands(["git"]))

					const message = createMessage("command", "git status --short --branch")
					store.set(pendingApprovalAtom, message)

					const options = store.get(approvalOptionsAtom)
					// parseCommandHierarchy generates: ["git", "git status", "git status --short --branch"]
					// matchesCommandPattern("git", ["git"]) returns true (exact match) - filtered
					// matchesCommandPattern("git status", ["git"]) returns true (hierarchical) - filtered
					// matchesCommandPattern("git status --short --branch", ["git"]) returns true (hierarchical) - filtered
					// So all patterns should be filtered
					expect(options).toHaveLength(2)
					expect(options[0].label).toBe("Run Command")
					expect(options[1].label).toBe("Reject")
				})

				it("should show no 'Always Run' options when entire hierarchy is already allowed", () => {
					const store = createStore()
					// Set up config with the full command already allowed
					store.set(configAtom, createConfigWithAllowedCommands(["git", "git status", "git status --short"]))

					const message = createMessage("command", "git status --short")
					store.set(pendingApprovalAtom, message)

					const options = store.get(approvalOptionsAtom)
					// Should only have: Run Command, Reject (no Always Run options)
					expect(options).toHaveLength(2)
					expect(options[0].label).toBe("Run Command")
					expect(options[1].label).toBe("Reject")
				})

				it("should handle wildcard in allowed commands list", () => {
					const store = createStore()
					// Set up config with wildcard
					store.set(configAtom, createConfigWithAllowedCommands(["*"]))

					const message = createMessage("command", "ls -la")
					store.set(pendingApprovalAtom, message)

					const options = store.get(approvalOptionsAtom)
					// Wildcard matches everything, so no Always Run options should appear
					expect(options).toHaveLength(2)
					expect(options[0].label).toBe("Run Command")
					expect(options[1].label).toBe("Reject")
				})

				it("should show 'Always Run' options for commands not covered by allowed list", () => {
					const store = createStore()
					// "git" is allowed, "npm run" is allowed, but "npm test" is not
					store.set(configAtom, createConfigWithAllowedCommands(["git", "npm run"]))

					const message = createMessage("command", "npm test")
					store.set(pendingApprovalAtom, message)

					const options = store.get(approvalOptionsAtom)
					// parseCommandHierarchy("npm test") generates: ["npm", "npm test"]
					// "git", "npm run" does NOT cover "npm" or "npm test"
					// So both patterns should appear as Always Run options
					const alwaysRunOptions = options.filter((opt) => opt.action === "approve-and-remember")
					expect(alwaysRunOptions.length).toBe(2)
					// Verify "npm" is in the options
					const npmOption = alwaysRunOptions.find((opt) => opt.commandPattern === "npm")
					expect(npmOption).toBeDefined()
					// Verify "npm test" is in the options
					const npmTestOption = alwaysRunOptions.find((opt) => opt.commandPattern === "npm test")
					expect(npmTestOption).toBeDefined()
				})

				it("should handle empty allowed commands list", () => {
					const store = createStore()
					// Empty allowed list - nothing should be filtered
					store.set(configAtom, createConfigWithAllowedCommands([]))

					const message = createMessage("command", "git status")
					store.set(pendingApprovalAtom, message)

					const options = store.get(approvalOptionsAtom)
					// Should show all options: Run Command, Always Run "git", Always Run "git status", Reject
					expect(options).toHaveLength(4)
					expect(options[1].label).toBe('Always Run "git"')
					expect(options[2].label).toBe('Always Run "git status"')
				})
	
				describe("chained commands", () => {
					it("should generate options for all commands in && chain", () => {
						const store = createStore()
						// Set up config with empty allowed list so all commands need approval
						store.set(configAtom, createConfigWithAllowedCommands([]))
						const message = createMessage("command", "ls . && cat README.md")
						store.set(pendingApprovalAtom, message)
	
						const options = store.get(approvalOptionsAtom)
						const alwaysRunOptions = options.filter((opt) => opt.action === "approve-and-remember")
	
						// Should have options for: ls, ls ., cat, cat README.md
						expect(alwaysRunOptions.length).toBe(4)
						expect(alwaysRunOptions[0].commandPattern).toBe("ls")
						expect(alwaysRunOptions[1].commandPattern).toBe("ls .")
						expect(alwaysRunOptions[2].commandPattern).toBe("cat")
						expect(alwaysRunOptions[3].commandPattern).toBe("cat README.md")
					})
	
					it("should generate options for all commands in | pipe chain", () => {
						const store = createStore()
						// Set up config with empty allowed list so all commands need approval
						store.set(configAtom, createConfigWithAllowedCommands([]))
						const message = createMessage("command", "cat README.md | tail -20")
						store.set(pendingApprovalAtom, message)
	
						const options = store.get(approvalOptionsAtom)
						const alwaysRunOptions = options.filter((opt) => opt.action === "approve-and-remember")
	
						// Should have options for: cat, cat README.md, tail, tail -20
						expect(alwaysRunOptions.length).toBe(4)
						expect(alwaysRunOptions[0].commandPattern).toBe("cat")
						expect(alwaysRunOptions[1].commandPattern).toBe("cat README.md")
						expect(alwaysRunOptions[2].commandPattern).toBe("tail")
						expect(alwaysRunOptions[3].commandPattern).toBe("tail -20")
					})
	
					it("should generate options for complex chained command with && and |", () => {
						const store = createStore()
						// Set up config with empty allowed list so all commands need approval
						store.set(configAtom, createConfigWithAllowedCommands([]))
						const message = createMessage("command", "ls . && cat README.md | tail -20")
						store.set(pendingApprovalAtom, message)
	
						const options = store.get(approvalOptionsAtom)
						const alwaysRunOptions = options.filter((opt) => opt.action === "approve-and-remember")
	
						// Should have options for: ls, ls ., cat, cat README.md, tail, tail -20
						expect(alwaysRunOptions.length).toBe(6)
						expect(alwaysRunOptions[0].commandPattern).toBe("ls")
						expect(alwaysRunOptions[1].commandPattern).toBe("ls .")
						expect(alwaysRunOptions[2].commandPattern).toBe("cat")
						expect(alwaysRunOptions[3].commandPattern).toBe("cat README.md")
						expect(alwaysRunOptions[4].commandPattern).toBe("tail")
						expect(alwaysRunOptions[5].commandPattern).toBe("tail -20")
					})
	
					it("should filter already allowed commands in chained commands", () => {
						const store = createStore()
						// Set up config with "ls" and "cat" already allowed
						store.set(configAtom, createConfigWithAllowedCommands(["ls", "cat"]))
	
						const message = createMessage("command", "ls . && cat README.md | tail -20")
						store.set(pendingApprovalAtom, message)
	
						const options = store.get(approvalOptionsAtom)
						const alwaysRunOptions = options.filter((opt) => opt.action === "approve-and-remember")
	
						// Should only have options for tail and tail -20 (ls and cat are filtered)
						expect(alwaysRunOptions.length).toBe(2)
						expect(alwaysRunOptions[0].commandPattern).toBe("tail")
						expect(alwaysRunOptions[1].commandPattern).toBe("tail -20")
					})
	
					it("should handle || chain", () => {
						const store = createStore()
						// Set up config with empty allowed list so all commands need approval
						store.set(configAtom, createConfigWithAllowedCommands([]))
						const message = createMessage("command", "git pull || echo 'Pull failed'")
						store.set(pendingApprovalAtom, message)
	
						const options = store.get(approvalOptionsAtom)
						const alwaysRunOptions = options.filter((opt) => opt.action === "approve-and-remember")
	
						// Should have options for: git, git pull, echo, echo Pull, echo Pull failed
						// Note: shell-quote parses "echo 'Pull failed'" and joins tokens back,
						// so we get "echo", "echo Pull", and "echo Pull failed"
						expect(alwaysRunOptions.length).toBe(5)
						expect(alwaysRunOptions[0].commandPattern).toBe("git")
						expect(alwaysRunOptions[1].commandPattern).toBe("git pull")
						expect(alwaysRunOptions[2].commandPattern).toBe("echo")
						expect(alwaysRunOptions[3].commandPattern).toBe("echo Pull")
						expect(alwaysRunOptions[4].commandPattern).toBe("echo Pull failed")
					})
	
					it("should handle ; chain", () => {
						const store = createStore()
						// Set up config with empty allowed list so all commands need approval
						store.set(configAtom, createConfigWithAllowedCommands([]))
						const message = createMessage("command", "npm install ; npm test")
						store.set(pendingApprovalAtom, message)
	
						const options = store.get(approvalOptionsAtom)
						const alwaysRunOptions = options.filter((opt) => opt.action === "approve-and-remember")
	
						// Should have options for: npm, npm install, npm, npm test (npm appears twice but deduplicated)
						expect(alwaysRunOptions.length).toBe(3)
						expect(alwaysRunOptions[0].commandPattern).toBe("npm")
						expect(alwaysRunOptions[1].commandPattern).toBe("npm install")
						expect(alwaysRunOptions[2].commandPattern).toBe("npm test")
					})
	
					it("should handle chained command with JSON format", () => {
						const store = createStore()
						// Set up config with empty allowed list so all commands need approval
						store.set(configAtom, createConfigWithAllowedCommands([]))
						const message = createMessage("command", JSON.stringify({ command: "ls . && cat README.md" }))
						store.set(pendingApprovalAtom, message)
	
						const options = store.get(approvalOptionsAtom)
						const alwaysRunOptions = options.filter((opt) => opt.action === "approve-and-remember")
	
						// Should have options for: ls, ls ., cat, cat README.md
						expect(alwaysRunOptions.length).toBe(4)
						expect(alwaysRunOptions[0].commandPattern).toBe("ls")
						expect(alwaysRunOptions[1].commandPattern).toBe("ls .")
						expect(alwaysRunOptions[2].commandPattern).toBe("cat")
						expect(alwaysRunOptions[3].commandPattern).toBe("cat README.md")
					})
	
					it("should assign sequential hotkeys for chained command options", () => {
						const store = createStore()
						// Set up config with empty allowed list so all commands need approval
						store.set(configAtom, createConfigWithAllowedCommands([]))
						const message = createMessage("command", "ls && cat | tail")
						store.set(pendingApprovalAtom, message)
	
						const options = store.get(approvalOptionsAtom)
						expect(options[0].hotkey).toBe("y") // Run Command
						expect(options[1].hotkey).toBe("1") // Always Run "ls"
						expect(options[2].hotkey).toBe("2") // Always Run "cat"
						expect(options[3].hotkey).toBe("3") // Always Run "tail"
						expect(options[4].hotkey).toBe("n") // Reject
					})
				})
			})
		})
	})
})
