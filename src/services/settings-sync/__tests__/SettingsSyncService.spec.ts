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

	beforeEach(() => {
		mockGlobalState = {
			setKeysForSync: vi.fn(),
		}

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

			await SettingsSyncService.initialize(mockContext)

			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith([
				"kilo-code.allowedCommands",
				"kilo-code.deniedCommands",
				"kilo-code.autoApprovalEnabled",
				"kilo-code.fuzzyMatchThreshold",
				"kilo-code.diffEnabled",
				"kilo-code.directoryContextAddedContext",
				"kilo-code.language",
				"kilo-code.customModes",
				"kilo-code.firstInstallCompleted",
				"kilo-code.telemetrySetting",
			])
		})

		it("should clear sync keys when settings sync is disabled", async () => {
			const mockConfiguration = {
				get: vi.fn().mockReturnValue(false),
			}
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any)

			await SettingsSyncService.initialize(mockContext)

			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith([])
		})

		it("should use default value true when setting is not configured", async () => {
			const mockConfiguration = {
				get: vi.fn().mockReturnValue(undefined),
			}
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any)

			await SettingsSyncService.initialize(mockContext)

			expect(mockConfiguration.get).toHaveBeenCalledWith("enableSettingsSync", true)
			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith(
				expect.arrayContaining(["kilo-code.allowedCommands", "kilo-code.deniedCommands"]),
			)
		})
	})

	describe("updateSyncRegistration", () => {
		it("should call initialize to update sync registration", async () => {
			const mockConfiguration = {
				get: vi.fn().mockReturnValue(false),
			}
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any)

			await SettingsSyncService.updateSyncRegistration(mockContext)

			expect(mockGlobalState.setKeysForSync).toHaveBeenCalledWith([])
		})
	})

	describe("getSyncKeys", () => {
		it("should return the list of sync keys", () => {
			const syncKeys = SettingsSyncService.getSyncKeys()

			expect(syncKeys).toEqual([
				"kilo-code.allowedCommands",
				"kilo-code.deniedCommands",
				"kilo-code.autoApprovalEnabled",
				"kilo-code.fuzzyMatchThreshold",
				"kilo-code.diffEnabled",
				"kilo-code.directoryContextAddedContext",
				"kilo-code.language",
				"kilo-code.customModes",
				"kilo-code.firstInstallCompleted",
				"kilo-code.telemetrySetting",
			])
		})
	})
})
