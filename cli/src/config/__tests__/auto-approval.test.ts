import { describe, it, expect } from "vitest"
import { DEFAULT_AUTO_APPROVAL } from "../defaults.js"
import type { AutoApprovalConfig } from "../types.js"

describe("Auto Approval Configuration", () => {
	describe("DEFAULT_AUTO_APPROVAL", () => {
		it("should have correct default values", () => {
			expect(DEFAULT_AUTO_APPROVAL).toEqual({
				enabled: true,
				read: {
					enabled: true,
					outside: false,
				},
				write: {
					enabled: true,
					outside: true,
					protected: false,
				},
				browser: {
					enabled: false,
				},
				retry: {
					enabled: false,
					delay: 10,
				},
				mcp: {
					enabled: true,
				},
				mode: {
					enabled: true,
				},
				subtasks: {
					enabled: true,
				},
				execute: {
					enabled: true,
					allowed: ["ls", "cat", "echo", "pwd"],
					denied: ["rm -rf", "sudo rm", "mkfs", "dd if="],
				},
				question: {
					enabled: false,
					timeout: 60,
				},
				todo: {
					enabled: true,
				},
			})
		})

		it("should have global enabled set to true by default", () => {
			expect(DEFAULT_AUTO_APPROVAL.enabled).toBe(true)
		})

		it("should have safe defaults for write operations", () => {
			expect(DEFAULT_AUTO_APPROVAL.write?.protected).toBe(false)
		})

		it("should have safe defaults for browser operations", () => {
			expect(DEFAULT_AUTO_APPROVAL.browser?.enabled).toBe(false)
		})

		it("should have safe defaults for followup questions", () => {
			expect(DEFAULT_AUTO_APPROVAL.question?.enabled).toBe(false)
		})
	})

	describe("Configuration Validation", () => {
		it("should accept valid minimal configuration", () => {
			const config: AutoApprovalConfig = {
				enabled: true,
			}
			expect(config).toBeDefined()
		})

		it("should accept valid complete configuration", () => {
			const config: AutoApprovalConfig = {
				enabled: true,
				read: {
					enabled: true,
					outside: false,
				},
				write: {
					enabled: true,
					outside: false,
					protected: false,
				},
				browser: {
					enabled: true,
				},
				retry: {
					enabled: true,
					delay: 15,
				},
				mcp: {
					enabled: true,
				},
				mode: {
					enabled: true,
				},
				subtasks: {
					enabled: true,
				},
				execute: {
					enabled: true,
					allowed: ["npm", "git"],
					denied: ["rm -rf"],
				},
				question: {
					enabled: true,
					timeout: 30,
				},
				todo: {
					enabled: true,
				},
			}
			expect(config).toBeDefined()
		})

		it("should accept partial configurations", () => {
			const config: AutoApprovalConfig = {
				enabled: true,
				read: {
					enabled: true,
				},
				execute: {
					allowed: ["npm"],
				},
			}
			expect(config).toBeDefined()
		})
	})

	describe("Execute Configuration", () => {
		it("should support empty allowed list (allow all)", () => {
			const config: AutoApprovalConfig = {
				execute: {
					enabled: true,
					allowed: [],
					denied: ["rm -rf"],
				},
			}
			expect(config.execute?.allowed).toEqual([])
		})

		it("should support specific allowed commands", () => {
			const config: AutoApprovalConfig = {
				execute: {
					enabled: true,
					allowed: ["npm", "git", "ls"],
					denied: [],
				},
			}
			expect(config.execute?.allowed).toHaveLength(3)
		})

		it("should support denied commands", () => {
			const config: AutoApprovalConfig = {
				execute: {
					enabled: true,
					allowed: [],
					denied: ["rm -rf", "sudo", "dd"],
				},
			}
			expect(config.execute?.denied).toHaveLength(3)
		})
	})

	describe("Retry Configuration", () => {
		it("should have valid delay (minimum 0)", () => {
			const config: AutoApprovalConfig = {
				retry: {
					enabled: true,
					delay: 10,
				},
			}
			expect(config.retry?.delay).toBeGreaterThanOrEqual(0)
		})
	})

	describe("Question Configuration", () => {
		it("should have valid timeout (minimum 0)", () => {
			const config: AutoApprovalConfig = {
				question: {
					enabled: true,
					timeout: 60,
				},
			}
			expect(config.question?.timeout).toBeGreaterThanOrEqual(0)
		})
	})
})
