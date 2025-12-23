import { describe, it, expect } from "vitest"
import {
	extractAutoApprovalConfig,
	buildAutoApprovalEnv,
	KILO_AUTO_APPROVAL_ENV_KEY,
	type AutoApprovalEnvConfig,
} from "../autoApprovalEnv"

describe("autoApprovalEnv", () => {
	describe("extractAutoApprovalConfig", () => {
		it("extracts enabled state from autoApprovalEnabled", () => {
			const config = extractAutoApprovalConfig({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: false,
				alwaysAllowReadOnlyOutsideWorkspace: false,
				alwaysAllowWrite: false,
				alwaysAllowWriteOutsideWorkspace: false,
				alwaysAllowWriteProtected: false,
				alwaysAllowBrowser: false,
				alwaysApproveResubmit: false,
				requestDelaySeconds: 10,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysAllowExecute: false,
				allowedCommands: [],
				deniedCommands: [],
				alwaysAllowFollowupQuestions: false,
				followupAutoApproveTimeoutMs: 60000,
				alwaysAllowUpdateTodoList: false,
			})

			expect(config.enabled).toBe(true)
		})

		it("maps read permissions correctly", () => {
			const config = extractAutoApprovalConfig({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: true,
				alwaysAllowReadOnlyOutsideWorkspace: true,
				alwaysAllowWrite: false,
				alwaysAllowWriteOutsideWorkspace: false,
				alwaysAllowWriteProtected: false,
				alwaysAllowBrowser: false,
				alwaysApproveResubmit: false,
				requestDelaySeconds: 10,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysAllowExecute: false,
				allowedCommands: [],
				deniedCommands: [],
				alwaysAllowFollowupQuestions: false,
				followupAutoApproveTimeoutMs: 60000,
				alwaysAllowUpdateTodoList: false,
			})

			expect(config.read).toEqual({
				enabled: true,
				outside: true,
			})
		})

		it("maps write permissions correctly", () => {
			const config = extractAutoApprovalConfig({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: false,
				alwaysAllowReadOnlyOutsideWorkspace: false,
				alwaysAllowWrite: true,
				alwaysAllowWriteOutsideWorkspace: true,
				alwaysAllowWriteProtected: true,
				alwaysAllowBrowser: false,
				alwaysApproveResubmit: false,
				requestDelaySeconds: 10,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysAllowExecute: false,
				allowedCommands: [],
				deniedCommands: [],
				alwaysAllowFollowupQuestions: false,
				followupAutoApproveTimeoutMs: 60000,
				alwaysAllowUpdateTodoList: false,
			})

			expect(config.write).toEqual({
				enabled: true,
				outside: true,
				protected: true,
			})
		})

		it("maps execute permissions with allowed/denied commands", () => {
			const config = extractAutoApprovalConfig({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: false,
				alwaysAllowReadOnlyOutsideWorkspace: false,
				alwaysAllowWrite: false,
				alwaysAllowWriteOutsideWorkspace: false,
				alwaysAllowWriteProtected: false,
				alwaysAllowBrowser: false,
				alwaysApproveResubmit: false,
				requestDelaySeconds: 10,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysAllowExecute: true,
				allowedCommands: ["npm test", "npm run build"],
				deniedCommands: ["rm -rf"],
				alwaysAllowFollowupQuestions: false,
				followupAutoApproveTimeoutMs: 60000,
				alwaysAllowUpdateTodoList: false,
			})

			expect(config.execute).toEqual({
				enabled: true,
				allowed: ["npm test", "npm run build"],
				denied: ["rm -rf"],
			})
		})

		it("maps retry settings correctly", () => {
			const config = extractAutoApprovalConfig({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: false,
				alwaysAllowReadOnlyOutsideWorkspace: false,
				alwaysAllowWrite: false,
				alwaysAllowWriteOutsideWorkspace: false,
				alwaysAllowWriteProtected: false,
				alwaysAllowBrowser: false,
				alwaysApproveResubmit: true,
				requestDelaySeconds: 30,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysAllowExecute: false,
				allowedCommands: [],
				deniedCommands: [],
				alwaysAllowFollowupQuestions: false,
				followupAutoApproveTimeoutMs: 60000,
				alwaysAllowUpdateTodoList: false,
			})

			expect(config.retry).toEqual({
				enabled: true,
				delay: 30,
			})
		})

		it("defaults undefined values to false/empty", () => {
			const config = extractAutoApprovalConfig({
				autoApprovalEnabled: undefined as unknown as boolean,
				alwaysAllowReadOnly: undefined as unknown as boolean,
				alwaysAllowReadOnlyOutsideWorkspace: undefined as unknown as boolean,
				alwaysAllowWrite: undefined as unknown as boolean,
				alwaysAllowWriteOutsideWorkspace: undefined as unknown as boolean,
				alwaysAllowWriteProtected: undefined as unknown as boolean,
				alwaysAllowBrowser: undefined as unknown as boolean,
				alwaysApproveResubmit: undefined as unknown as boolean,
				requestDelaySeconds: undefined as unknown as number,
				alwaysAllowMcp: undefined as unknown as boolean,
				alwaysAllowModeSwitch: undefined as unknown as boolean,
				alwaysAllowSubtasks: undefined as unknown as boolean,
				alwaysAllowExecute: undefined as unknown as boolean,
				allowedCommands: undefined as unknown as string[],
				deniedCommands: undefined as unknown as string[],
				alwaysAllowFollowupQuestions: undefined as unknown as boolean,
				followupAutoApproveTimeoutMs: undefined as unknown as number,
				alwaysAllowUpdateTodoList: undefined as unknown as boolean,
			})

			expect(config.enabled).toBe(false)
			expect(config.read?.enabled).toBe(false)
			expect(config.write?.enabled).toBe(false)
			expect(config.execute?.allowed).toEqual([])
			expect(config.execute?.denied).toEqual([])
		})
	})

	describe("buildAutoApprovalEnv", () => {
		it("returns object with KILO_AUTO_APPROVAL_JSON key", () => {
			const config: AutoApprovalEnvConfig = {
				enabled: true,
				read: { enabled: true },
			}

			const env = buildAutoApprovalEnv(config)

			expect(env).toHaveProperty(KILO_AUTO_APPROVAL_ENV_KEY)
		})

		it("serializes config as JSON", () => {
			const config: AutoApprovalEnvConfig = {
				enabled: true,
				read: { enabled: true, outside: false },
				write: { enabled: false },
			}

			const env = buildAutoApprovalEnv(config)
			const parsed = JSON.parse(env[KILO_AUTO_APPROVAL_ENV_KEY])

			expect(parsed).toEqual(config)
		})

		it("handles complete config with all options", () => {
			const config: AutoApprovalEnvConfig = {
				enabled: true,
				read: { enabled: true, outside: true },
				write: { enabled: true, outside: true, protected: false },
				browser: { enabled: true },
				retry: { enabled: true, delay: 15 },
				mcp: { enabled: true },
				mode: { enabled: true },
				subtasks: { enabled: true },
				execute: { enabled: true, allowed: ["npm"], denied: ["rm"] },
				question: { enabled: false, timeout: 30000 },
				todo: { enabled: true },
			}

			const env = buildAutoApprovalEnv(config)
			const parsed = JSON.parse(env[KILO_AUTO_APPROVAL_ENV_KEY])

			expect(parsed).toEqual(config)
		})
	})

	describe("KILO_AUTO_APPROVAL_ENV_KEY", () => {
		it("has correct value", () => {
			expect(KILO_AUTO_APPROVAL_ENV_KEY).toBe("KILO_AUTO_APPROVAL_JSON")
		})
	})
})
