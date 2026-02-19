// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { SettingsSyncService } from "../SettingsSyncService"

// Mock VS Code API
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

describe("SettingsSyncService", () => {
	let mockContext: vscode.ExtensionContext
	let mockGlobalState: any
	let mockOutputChannel: vscode.OutputChannel

	beforeEach(() => {
		mockGlobalState = {
			setKeysForSync: vi.fn(),
		}

		mockOutputChannel = {
			appendLine: vi.fn(),
		} as any

		mockContext = {
			globalState: mockGlobalState,
		} as any

		vi.clearAllMocks()
	})

	describe("initialize", () => {
		it("should register sync keys when settings sync is enabled", async () => {
			const mockConfiguration = {
				get: vi.fn().mockReturnValue(true),
			}
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any)

			await SettingsSyncService.initialize(mockContext, mockOutputChannel)

			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith([
				"cmbt-agent.allowedCommands",
				"cmbt-agent.deniedCommands",
				"cmbt-agent.autoApprovalEnabled",
				"cmbt-agent.fuzzyMatchThreshold",
				"cmbt-agent.diffEnabled",
				"cmbt-agent.directoryContextAddedContext",
				"cmbt-agent.language",
				"cmbt-agent.customModes",
				"cmbt-agent.firstInstallCompleted",
				"cmbt-agent.telemetrySetting",
			])
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("[SettingsSyncService] Registered 10 keys for synchronization"),
			)
		})

		it("should clear sync keys when settings sync is disabled", async () => {
			const mockConfiguration = {
				get: vi.fn().mockReturnValue(false),
			}
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any)

			await SettingsSyncService.initialize(mockContext, mockOutputChannel)

			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith([])
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				"[SettingsSyncService] Settings sync disabled - cleared sync keys",
			)
		})

		it("should use default value true when setting is not configured", async () => {
			const mockConfiguration = {
				get: vi.fn((key: string, defaultValue: boolean) => defaultValue),
			}
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any)

			await SettingsSyncService.initialize(mockContext, mockOutputChannel)

			expect(mockConfiguration.get).toHaveBeenCalledWith("enableSettingsSync", true)
			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith(
				expect.arrayContaining(["cmbt-agent.allowedCommands", "cmbt-agent.deniedCommands"]),
			)
		})

		it("should work without outputChannel parameter", async () => {
			const mockConfiguration = {
				get: vi.fn().mockReturnValue(true),
			}
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any)

			await SettingsSyncService.initialize(mockContext)

			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith(
				expect.arrayContaining(["cmbt-agent.allowedCommands"]),
			)
		})
	})

	describe("updateSyncRegistration", () => {
		it("should call initialize to update sync registration", async () => {
			const mockConfiguration = {
				get: vi.fn().mockReturnValue(false),
			}
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any)

			await SettingsSyncService.updateSyncRegistration(mockContext, mockOutputChannel)

			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith([])
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				"[SettingsSyncService] Settings sync disabled - cleared sync keys",
			)
		})
	})

	describe("getSyncKeys", () => {
		it("should return the list of sync keys", () => {
			const syncKeys = SettingsSyncService.getSyncKeys()

			expect(syncKeys).toEqual([
				"cmbt-agent.allowedCommands",
				"cmbt-agent.deniedCommands",
				"cmbt-agent.autoApprovalEnabled",
				"cmbt-agent.fuzzyMatchThreshold",
				"cmbt-agent.diffEnabled",
				"cmbt-agent.directoryContextAddedContext",
				"cmbt-agent.language",
				"cmbt-agent.customModes",
				"cmbt-agent.firstInstallCompleted",
				"cmbt-agent.telemetrySetting",
			])
		})
	})
})
