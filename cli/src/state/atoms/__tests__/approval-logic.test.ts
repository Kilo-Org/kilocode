import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { pendingApprovalAtom, shouldAutoApproveAtom, setPendingApprovalAtom } from "../approval.js"
import {
	configAtom,
	autoApprovalEnabledAtom,
	autoApproveReadAtom,
	autoApproveWriteAtom,
	autoApproveExecuteAtom,
	autoApproveExecuteAllowedAtom,
	autoApproveExecuteDeniedAtom,
} from "../config.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { CLIConfig } from "../../../config/types.js"
import { DEFAULT_CONFIG } from "../../../config/defaults.js"

describe("Auto Approval Logic", () => {
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

	describe("Global Auto Approval Toggle", () => {
		it("should not auto-approve when global enabled is false", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: false,
					read: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			const shouldApprove = store.get(shouldAutoApproveAtom)
			expect(shouldApprove).toBe(false)
		})

		it("should check specific settings when global enabled is true", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			const shouldApprove = store.get(shouldAutoApproveAtom)
			expect(shouldApprove).toBe(true)
		})
	})

	describe("Read Operations", () => {
		it("should auto-approve read operations when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})

		it("should not auto-approve read operations when disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: false },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})

		it("should respect outside workspace setting", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: true, outside: false },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "readFile", isOutsideWorkspace: true }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})
	})

	describe("Write Operations", () => {
		it("should auto-approve write operations when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					write: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "editedExistingFile" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})

		it("should not auto-approve protected files when disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					write: { enabled: true, protected: false },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "editedExistingFile", isProtected: true }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})

		it("should auto-approve protected files when explicitly enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					write: { enabled: true, protected: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "editedExistingFile", isProtected: true }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})
	})

	describe("Command Execution", () => {
		it("should not auto-approve when allowed list is empty", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: [], denied: [] },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("command", "npm install")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})

		it("should auto-approve commands in allowed list", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: ["npm", "git"], denied: [] },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("command", "npm install")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})

		it("should not auto-approve commands not in allowed list", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: ["npm", "git"], denied: [] },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("command", "rm -rf /")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})

		it("should not auto-approve commands in denied list", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: [], denied: ["rm -rf"] },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("command", "rm -rf /")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})

		it("should auto-approve with wildcard in allowed list", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: ["*"], denied: [] },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("command", "any command")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})

		it("denied list should take precedence over wildcard allowed", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					execute: { enabled: true, allowed: ["*"], denied: ["rm -rf"] },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("command", "rm -rf /")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})
	})

	describe("Browser Operations", () => {
		it("should auto-approve browser operations when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					browser: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "browser_action" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})

		it("should not auto-approve browser operations when disabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					browser: { enabled: false },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "browser_action" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})
	})

	describe("MCP Operations", () => {
		it("should auto-approve MCP tool usage when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					mcp: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "use_mcp_tool" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})

		it("should auto-approve MCP resource access when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					mcp: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "access_mcp_resource" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})
	})

	describe("Mode Switching", () => {
		it("should auto-approve mode switching when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					mode: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "switchMode" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})
	})

	describe("Subtasks", () => {
		it("should auto-approve subtask creation when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					subtasks: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "newTask" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})
	})

	describe("Todo List Updates", () => {
		it("should auto-approve todo updates when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					todo: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", JSON.stringify({ tool: "updateTodoList" }))
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})
	})

	describe("Followup Questions", () => {
		it("should auto-approve followup questions when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					question: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("followup", "What should I do next?")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})
	})

	describe("Retry Operations", () => {
		it("should auto-approve retry when enabled", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					retry: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("api_req_failed", "API request failed")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(true)
		})
	})

	describe("Error Handling", () => {
		it("should not auto-approve when message parsing fails", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
					read: { enabled: true },
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("tool", "invalid json")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})

		it("should not auto-approve unknown ask types", () => {
			const config: CLIConfig = {
				...DEFAULT_CONFIG,
				autoApproval: {
					enabled: true,
				},
			}
			store.set(configAtom, config)

			const message = createMockMessage("unknown_type", "some text")
			store.set(setPendingApprovalAtom, message)

			expect(store.get(shouldAutoApproveAtom)).toBe(false)
		})
	})
})
