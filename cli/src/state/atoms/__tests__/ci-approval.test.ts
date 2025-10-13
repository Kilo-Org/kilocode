import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { shouldAutoApproveAtom, shouldAutoRejectAtom, setPendingApprovalAtom } from "../approval.js"
import { ciModeAtom } from "../ci.js"
import { configAtom } from "../config.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { CLIConfig } from "../../../config/types.js"
import { DEFAULT_CONFIG } from "../../../config/defaults.js"

describe("CI Mode Auto Approval", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	const createMockMessage = (ask: string, text: string): ExtensionChatMessage => ({
		ts: Date.now(),
		type: "ask",
		ask: ask as any,
		text,
		partial: false,
	})

	describe("CI Mode Detection", () => {
		it("should not affect approval when CI mode is disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: false },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, false)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)
		})

		it("should enable auto-reject in CI mode when operation is not allowed", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: false },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})
	})

	describe("CI Mode Read Operations", () => {
		it("should auto-approve read operations in CI mode when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: true },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)
		})

		it("should auto-reject read operations in CI mode when disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: false },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})

		it("should auto-reject outside workspace reads in CI mode when disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: true, outside: false },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile", isOutsideWorkspace: true }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})
	})

	describe("CI Mode Write Operations", () => {
		it("should auto-approve write operations in CI mode when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					write: { enabled: true },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "editedExistingFile" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)
		})

		it("should auto-reject protected file writes in CI mode when disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					write: { enabled: true, protected: false },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "editedExistingFile", isProtected: true }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})

		it("should auto-approve protected file writes in CI mode when explicitly enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					write: { enabled: true, protected: true },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "editedExistingFile", isProtected: true }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)
		})
	})

	describe("CI Mode Command Execution", () => {
		it("should auto-reject commands in CI mode when allowed list is empty", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: [], denied: [] },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("command", "npm install")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})

		it("should auto-approve allowed commands in CI mode", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: ["npm", "git"], denied: [] },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("command", "npm install")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)
		})

		it("should auto-reject denied commands in CI mode", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: ["*"], denied: ["rm -rf"] },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("command", "rm -rf /")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})
	})

	describe("CI Mode Followup Questions", () => {
		it("should handle followup questions in CI mode (approval logic in hook)", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					question: { enabled: false }, // Even if disabled, CI mode should handle it
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("followup", "What should I do next?")
			store.set(setPendingApprovalAtom, message)

			// In CI mode, followup questions are handled specially by the hook
			// The atom logic shows it would be rejected based on config
			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			// But the hook will override this and approve with a special message
		})

		it("should auto-approve followup questions when enabled in config", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					question: { enabled: true },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("followup", "What should I do next?")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)
		})
	})

	describe("CI Mode Browser Operations", () => {
		it("should auto-approve browser operations in CI mode when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					browser: { enabled: true },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "browser_action" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)
		})

		it("should auto-reject browser operations in CI mode when disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					browser: { enabled: false },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "browser_action" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})
	})

	describe("CI Mode MCP Operations", () => {
		it("should auto-approve MCP operations in CI mode when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					mcp: { enabled: true },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "use_mcp_tool" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)
		})

		it("should auto-reject MCP operations in CI mode when disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					mcp: { enabled: false },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "use_mcp_tool" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})
	})

	describe("CI Mode Complex Scenarios", () => {
		it("should handle multiple operations with mixed approval settings", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: true },
					write: { enabled: false },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			// Read should be approved
			const readMessage = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, readMessage)
			expect(store.get(shouldAutoApproveAtom)).toBe(true)
			expect(store.get(shouldAutoRejectAtom)).toBe(false)

			// Write should be rejected
			const writeMessage = createMockMessage("tool", JSON.stringify({ tool: "editedExistingFile" }))
			store.set(setPendingApprovalAtom, writeMessage)
			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})

		it("should handle global auto-approval disabled in CI mode", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: false,
					read: { enabled: true },
				},
			}
			store.set(configAtom, config)
			store.set(ciModeAtom, true)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			// Even in CI mode, if global auto-approval is disabled, nothing should be approved
			expect(store.get(shouldAutoApproveAtom)).toBe(false)
			expect(store.get(shouldAutoRejectAtom)).toBe(true)
		})
	})
})
