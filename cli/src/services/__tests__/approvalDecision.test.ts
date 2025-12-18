/**
 * Tests for approval decision service
 */

import { describe, it, expect } from "vitest"
import { getApprovalDecision } from "../approvalDecision.js"
import type { AutoApprovalConfig } from "../../config/types.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { CI_MODE_MESSAGES } from "../../constants/ci.js"

// Helper to create a base config with all options disabled
const createBaseConfig = (): AutoApprovalConfig => ({
	read: {
		enabled: false,
		outside: false,
	},
	write: {
		enabled: false,
		outside: false,
		protected: false,
	},
	browser: {
		enabled: false,
	},
	retry: {
		enabled: false,
		delay: 5,
	},
	mcp: {
		enabled: false,
	},
	mode: {
		enabled: false,
	},
	subtasks: {
		enabled: false,
	},
	todo: {
		enabled: false,
	},
	execute: {
		enabled: false,
		allowed: [],
		denied: [],
	},
	question: {
		enabled: false,
		timeout: 30,
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

describe("approvalDecision", () => {
	describe("getApprovalDecision", () => {
		describe("non-ask messages", () => {
			it("should return manual for non-ask messages", () => {
				const message = { ...createMessage("tool"), type: "say" } as ExtensionChatMessage
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})
		})

		describe("partial or answered messages", () => {
			it("should return manual for partial messages", () => {
				const message = { ...createMessage("tool"), partial: true }
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should return manual for answered messages", () => {
				const message = { ...createMessage("tool"), isAnswered: true }
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})
		})

		describe("tool requests - read operations", () => {
			it("should auto-approve readFile when config enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "readFile" }))
				const config = { ...createBaseConfig(), read: { enabled: true, outside: false } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			it("should require manual approval for readFile when config disabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "readFile" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should auto-reject readFile in CI mode when config disabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "readFile" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, true)
				expect(decision.action).toBe("auto-reject")
				expect(decision.message).toBe(CI_MODE_MESSAGES.AUTO_REJECTED)
			})

			it("should check autoApproveReadOutside for outside workspace reads", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "readFile", isOutsideWorkspace: true }))
				const config = { ...createBaseConfig(), read: { enabled: true, outside: false } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should auto-approve outside workspace reads when configured", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "readFile", isOutsideWorkspace: true }))
				const config = { ...createBaseConfig(), read: { enabled: false, outside: true } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})
		})

		describe("tool requests - write operations", () => {
			it("should auto-approve write when config enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "editedExistingFile" }))
				const config = { ...createBaseConfig(), write: { enabled: true, outside: false, protected: false } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			it("should check autoApproveWriteOutside for outside workspace writes", () => {
				const message = createMessage(
					"tool",
					JSON.stringify({ tool: "newFileCreated", isOutsideWorkspace: true }),
				)
				const config = { ...createBaseConfig(), write: { enabled: true, outside: false, protected: false } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should check autoApproveWriteProtected for protected files", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "editedExistingFile", isProtected: true }))
				const config = { ...createBaseConfig(), write: { enabled: true, outside: false, protected: false } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should auto-approve protected files when configured", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "editedExistingFile", isProtected: true }))
				const config = { ...createBaseConfig(), write: { enabled: false, outside: false, protected: true } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})
		})

		describe("tool requests - browser operations", () => {
			it("should auto-approve browser actions when config enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "browser_action" }))
				const config = { ...createBaseConfig(), browser: { enabled: true } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-reject browser actions in CI mode when disabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "browser_action" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, true)
				expect(decision.action).toBe("auto-reject")
			})
		})

		describe("tool requests - MCP operations", () => {
			it("should auto-approve MCP tool use when config enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "use_mcp_tool" }))
				const config = { ...createBaseConfig(), mcp: { enabled: true } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve MCP resource access when config enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "access_mcp_resource" }))
				const config = { ...createBaseConfig(), mcp: { enabled: true } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})
		})

		describe("tool requests - other operations", () => {
			it("should auto-approve mode switching when config enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "switchMode" }))
				const config = { ...createBaseConfig(), mode: { enabled: true } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve subtasks when config enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "newTask" }))
				const config = { ...createBaseConfig(), subtasks: { enabled: true } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve todo updates when config enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "updateTodoList" }))
				const config = { ...createBaseConfig(), todo: { enabled: true } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})
		})

		describe("command execution", () => {
			it("should require manual approval when execute disabled", () => {
				const message = createMessage("command", JSON.stringify({ command: "npm install" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should auto-reject in CI mode when execute disabled", () => {
				const message = createMessage("command", JSON.stringify({ command: "npm install" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, true)
				expect(decision.action).toBe("auto-reject")
			})

			it("should check denied list first", () => {
				const message = createMessage("command", JSON.stringify({ command: "rm -rf /" }))
				const config = {
					...createBaseConfig(),
					execute: {
						enabled: true,
						allowed: ["*"],
						denied: ["rm"],
					},
				}
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should require allowed list to be non-empty", () => {
				const message = createMessage("command", JSON.stringify({ command: "npm install" }))
				const config = {
					...createBaseConfig(),
					execute: {
						enabled: true,
						allowed: [],
						denied: [],
					},
				}
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should auto-approve commands matching allowed patterns", () => {
				const message = createMessage("command", JSON.stringify({ command: "npm install" }))
				const config = {
					...createBaseConfig(),
					execute: {
						enabled: true,
						allowed: ["npm"],
						denied: [],
					},
				}
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			it("should support wildcard in allowed list", () => {
				const message = createMessage("command", JSON.stringify({ command: "any command" }))
				const config = {
					...createBaseConfig(),
					execute: {
						enabled: true,
						allowed: ["*"],
						denied: [],
					},
				}
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			it("should parse command from JSON structure", () => {
				const message = createMessage("command", JSON.stringify({ command: "ls" }))
				const config = {
					...createBaseConfig(),
					execute: {
						enabled: true,
						allowed: ["ls"],
						denied: [],
					},
				}
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
			})

			describe("hierarchical command matching", () => {
				it("should match base command pattern", () => {
					const message = createMessage("command", JSON.stringify({ command: "git status --short" }))
					const config = {
						...createBaseConfig(),
						execute: {
							enabled: true,
							allowed: ["git"],
							denied: [],
						},
					}
					const decision = getApprovalDecision(message, config, false)
					expect(decision.action).toBe("auto-approve")
				})

				it("should match command with subcommand pattern", () => {
					const message = createMessage("command", JSON.stringify({ command: "git status --short --branch" }))
					const config = {
						...createBaseConfig(),
						execute: {
							enabled: true,
							allowed: ["git status"],
							denied: [],
						},
					}
					const decision = getApprovalDecision(message, config, false)
					expect(decision.action).toBe("auto-approve")
				})

				it("should match exact command pattern", () => {
					const message = createMessage("command", JSON.stringify({ command: "git status --short" }))
					const config = {
						...createBaseConfig(),
						execute: {
							enabled: true,
							allowed: ["git status --short"],
							denied: [],
						},
					}
					const decision = getApprovalDecision(message, config, false)
					expect(decision.action).toBe("auto-approve")
				})

				it("should not match partial word patterns", () => {
					const message = createMessage("command", JSON.stringify({ command: "gitignore" }))
					const config = {
						...createBaseConfig(),
						execute: {
							enabled: true,
							allowed: ["git"],
							denied: [],
						},
					}
					const decision = getApprovalDecision(message, config, false)
					expect(decision.action).toBe("manual")
				})

				it("should handle commands with multiple spaces", () => {
					const message = createMessage("command", JSON.stringify({ command: "npm  install  --save" }))
					const config = {
						...createBaseConfig(),
						execute: {
							enabled: true,
							allowed: ["npm"],
							denied: [],
						},
					}
					const decision = getApprovalDecision(message, config, false)
					expect(decision.action).toBe("auto-approve")
				})

				it("should handle commands with tabs", () => {
					const message = createMessage("command", JSON.stringify({ command: "git\tstatus" }))
					const config = {
						...createBaseConfig(),
						execute: {
							enabled: true,
							allowed: ["git"],
							denied: [],
						},
					}
					const decision = getApprovalDecision(message, config, false)
					expect(decision.action).toBe("auto-approve")
				})

				it("should respect denied patterns over allowed patterns", () => {
					const message = createMessage("command", JSON.stringify({ command: "git push --force" }))
					const config = {
						...createBaseConfig(),
						execute: {
							enabled: true,
							allowed: ["git"],
							denied: ["git push --force"],
						},
					}
					const decision = getApprovalDecision(message, config, false)
					expect(decision.action).toBe("manual")
				})
			})
		})

		describe("followup questions", () => {
			it("should auto-approve in CI mode with special message", () => {
				const message = createMessage("followup")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, true)
				expect(decision.action).toBe("auto-approve")
				expect(decision.message).toBe(CI_MODE_MESSAGES.FOLLOWUP_RESPONSE)
			})

			it("should auto-approve in non-CI mode when config enabled", () => {
				const message = createMessage("followup")
				const config = { ...createBaseConfig(), question: { enabled: true, timeout: 30 } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
				expect(decision.message).toBeUndefined()
			})

			it("should require manual approval when config disabled", () => {
				const message = createMessage("followup")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})
		})

		describe("API retry requests", () => {
			it("should auto-approve with delay in non-CI mode", () => {
				const message = createMessage("api_req_failed")
				const config = { ...createBaseConfig(), retry: { enabled: true, delay: 5 } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("auto-approve")
				expect(decision.delay).toBe(5000)
			})

			it("should auto-approve without delay in CI mode", () => {
				const message = createMessage("api_req_failed")
				const config = { ...createBaseConfig(), retry: { enabled: true, delay: 5 } }
				const decision = getApprovalDecision(message, config, true)
				expect(decision.action).toBe("auto-approve")
				expect(decision.delay).toBeUndefined()
			})

			it("should auto-reject in CI mode when retry disabled", () => {
				const message = createMessage("api_req_failed")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, true)
				expect(decision.action).toBe("auto-reject")
			})
		})

		describe("unknown ask types", () => {
			it("should require manual approval for unknown types", () => {
				const message = createMessage("unknown_type")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should auto-reject unknown types in CI mode", () => {
				const message = createMessage("unknown_type")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, true)
				expect(decision.action).toBe("auto-reject")
				expect(decision.message).toBe(CI_MODE_MESSAGES.AUTO_REJECTED)
			})
		})

		describe("invalid tool data", () => {
			it("should handle invalid JSON gracefully", () => {
				const message = createMessage("tool", "invalid json")
				const config = { ...createBaseConfig(), read: { enabled: true, outside: false } }
				const decision = getApprovalDecision(message, config, false)
				expect(decision.action).toBe("manual")
			})

			it("should auto-reject invalid JSON in CI mode", () => {
				const message = createMessage("tool", "invalid json")
				const config = { ...createBaseConfig(), read: { enabled: true, outside: false } }
				const decision = getApprovalDecision(message, config, true)
				expect(decision.action).toBe("auto-reject")
			})
		})

		describe("YOLO mode", () => {
			it("should auto-approve file write operations in YOLO mode", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "editedExistingFile" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve command execution in YOLO mode", () => {
				const message = createMessage("command", JSON.stringify({ command: "npm install" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve browser actions in YOLO mode", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "browser_action" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve MCP operations in YOLO mode", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "use_mcp_tool" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve mode switching in YOLO mode", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "switchMode" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve subtasks in YOLO mode", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "newTask" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve todo updates in YOLO mode", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "updateTodoList" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve API retry in YOLO mode", () => {
				const message = createMessage("api_req_failed")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve use_mcp_server ask type in YOLO mode", () => {
				const message = createMessage("use_mcp_server")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should NOT auto-respond to followup questions in YOLO mode", () => {
				const message = createMessage("followup")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				// In YOLO mode without CI mode, followup should require manual approval
				// because question.enabled is false in base config
				expect(decision.action).toBe("manual")
			})

			it("should auto-approve followup questions in YOLO mode when question.enabled is true", () => {
				const message = createMessage("followup")
				const config = { ...createBaseConfig(), question: { enabled: true, timeout: 30 } }
				const decision = getApprovalDecision(message, config, false, true)
				// Followup questions are handled by the normal config path, not YOLO mode
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve unknown ask types in YOLO mode", () => {
				const message = createMessage("unknown_type")
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve protected file writes in YOLO mode", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "editedExistingFile", isProtected: true }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve outside workspace writes in YOLO mode", () => {
				const message = createMessage(
					"tool",
					JSON.stringify({ tool: "newFileCreated", isOutsideWorkspace: true }),
				)
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("auto-approve")
			})

			it("should auto-approve denied commands in YOLO mode", () => {
				const message = createMessage("command", JSON.stringify({ command: "rm -rf /" }))
				const config = {
					...createBaseConfig(),
					execute: {
						enabled: true,
						allowed: ["*"],
						denied: ["rm"],
					},
				}
				const decision = getApprovalDecision(message, config, false, true)
				// YOLO mode overrides denied list
				expect(decision.action).toBe("auto-approve")
			})

			it("should work with both YOLO mode and CI mode enabled", () => {
				const message = createMessage("tool", JSON.stringify({ tool: "editedExistingFile" }))
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, true, true)
				// YOLO mode takes precedence
				expect(decision.action).toBe("auto-approve")
			})

			it("should not auto-approve partial messages in YOLO mode", () => {
				const message = {
					...createMessage("tool", JSON.stringify({ tool: "editedExistingFile" })),
					partial: true,
				}
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("manual")
			})

			it("should not auto-approve answered messages in YOLO mode", () => {
				const message = {
					...createMessage("tool", JSON.stringify({ tool: "editedExistingFile" })),
					isAnswered: true,
				}
				const config = createBaseConfig()
				const decision = getApprovalDecision(message, config, false, true)
				expect(decision.action).toBe("manual")
			})
		})
	})
})
