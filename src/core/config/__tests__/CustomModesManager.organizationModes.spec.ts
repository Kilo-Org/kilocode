// kilocode_change - new file
// npx vitest core/config/__tests__/CustomModesManager.organizationModes.spec.ts

import type { Mock } from "vitest"

import * as path from "path"
import * as fs from "fs/promises"

import * as yaml from "yaml"
import * as vscode from "vscode"
import axios from "axios"

import type { ModeConfig } from "@roo-code/types"

import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"
import { GlobalFileNames } from "../../../shared/globalFileNames"

import { CustomModesManager } from "../CustomModesManager"

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [],
		onDidSaveTextDocument: vi.fn(),
		createFileSystemWatcher: vi.fn(() => ({
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		})),
	},
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
}))

vi.mock("fs/promises", () => ({
	default: {
		mkdir: vi.fn(),
		readFile: vi.fn(),
		writeFile: vi.fn(),
		stat: vi.fn(),
		readdir: vi.fn(),
		rm: vi.fn(),
	},
	mkdir: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	stat: vi.fn(),
	readdir: vi.fn(),
	rm: vi.fn(),
}))

vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn(),
}))

describe("CustomModesManager - Organization Modes", () => {
	let manager: CustomModesManager
	let mockContext: vscode.ExtensionContext
	let mockOnUpdate: Mock
	let mockWorkspaceFolders: { uri: { fsPath: string } }[]

	const mockStoragePath = `${path.sep}mock${path.sep}settings`
	const mockSettingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)
	const mockWorkspacePath = path.resolve("/mock/workspace")
	const mockRoomodes = path.join(mockWorkspacePath, ".kilocodemodes")

	beforeEach(() => {
		vi.clearAllMocks()

		mockOnUpdate = vi.fn()
		mockContext = {
			globalState: {
				get: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn(() => []),
				setKeysForSync: vi.fn(),
			},
			globalStorageUri: {
				fsPath: mockStoragePath,
			},
		} as unknown as vscode.ExtensionContext

		mockWorkspaceFolders = [{ uri: { fsPath: mockWorkspacePath } }]
		;(vscode.workspace as any).workspaceFolders = mockWorkspaceFolders

		vi.mocked(getWorkspacePath).mockReturnValue(mockWorkspacePath)
		vi.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
			return path === mockSettingsPath || path === mockRoomodes
		})
		vi.mocked(fs.mkdir).mockResolvedValue(undefined)
		vi.mocked(fs.writeFile).mockResolvedValue(undefined)
		vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any)
		vi.mocked(fs.readdir).mockResolvedValue([])
		vi.mocked(fs.rm).mockResolvedValue(undefined)
		vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
			if (path === mockSettingsPath) {
				return yaml.stringify({ customModes: [] })
			}
			throw new Error("File not found")
		}) as any)

		manager = new CustomModesManager(mockContext, mockOnUpdate)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("fetchOrganizationModes", () => {
		it("should return empty array when no organization ID is provided", async () => {
			const modes = await manager.fetchOrganizationModes("test-token")

			expect(modes).toEqual([])
			expect(axios.get).not.toHaveBeenCalled()
		})

		it("should fetch organization modes from API", async () => {
			const mockOrgModes = [
				{
					id: "mode-id-1",
					organization_id: "org-123",
					name: "Org Mode 1",
					slug: "org-mode-1",
					created_by: "Test User",
					created_at: "2025-10-06 16:53:38.082127-05",
					updated_at: "2025-10-06 16:53:38.082127-05",
					config: {
						roleDefinition: "Org Role 1",
						groups: ["read"],
						source: "organization",
					},
				},
				{
					id: "mode-id-2",
					organization_id: "org-123",
					name: "Org Mode 2",
					slug: "org-mode-2",
					created_by: "Test User",
					created_at: "2025-10-06 16:53:38.082127-05",
					updated_at: "2025-10-06 16:53:38.082127-05",
					config: {
						roleDefinition: "Org Role 2",
						groups: ["edit"],
						source: "organization",
					},
				},
			]

			vi.mocked(axios.get).mockResolvedValue({
				data: { modes: mockOrgModes },
			})

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			expect(axios.get).toHaveBeenCalledWith(
				"https://api.kilo.ai/api/organizations/org-123/modes",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer test-token",
						"Content-Type": "application/json",
						"X-KiloCode-OrganizationId": "org-123",
					}),
				}),
			)

			expect(modes).toHaveLength(2)
			expect(modes[0]).toMatchObject({
				slug: "org-mode-1",
				name: "Org Mode 1",
				roleDefinition: "Org Role 1",
				source: "organization",
			})
			expect(modes[1]).toMatchObject({
				slug: "org-mode-2",
				name: "Org Mode 2",
				roleDefinition: "Org Role 2",
				source: "organization",
			})
		})

		it("should include tester suppression header when enabled", async () => {
			const futureTimestamp = Date.now() + 10000

			vi.mocked(axios.get).mockResolvedValue({
				data: { modes: [] },
			})

			await manager.fetchOrganizationModes("test-token", "org-123", futureTimestamp)

			expect(axios.get).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-KILOCODE-TESTER": "SUPPRESS",
					}),
				}),
			)
		})

		it("should not include tester suppression header when expired", async () => {
			const pastTimestamp = Date.now() - 10000

			vi.mocked(axios.get).mockResolvedValue({
				data: { modes: [] },
			})

			await manager.fetchOrganizationModes("test-token", "org-123", pastTimestamp)

			expect(axios.get).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.not.objectContaining({
						"X-KILOCODE-TESTER": expect.any(String),
					}),
				}),
			)
		})

		it("should handle API errors gracefully", async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error("Network error"))

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			expect(modes).toEqual([])
		})

		it("should handle invalid response format", async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { invalid: "format" },
			})

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			expect(modes).toEqual([])
		})

		it("should validate and filter invalid modes from API response", async () => {
			const mockOrgModes = [
				{
					id: "valid-id",
					organization_id: "org-123",
					name: "Valid Mode",
					slug: "valid-mode",
					config: {
						roleDefinition: "Valid Role",
						groups: ["read"],
					},
				},
				{
					id: "invalid-id",
					organization_id: "org-123",
					name: "", // Invalid: empty name at top level
					slug: "invalid-mode",
					config: {
						roleDefinition: "", // Invalid: empty role
						groups: ["read"],
					},
				},
			]

			vi.mocked(axios.get).mockResolvedValue({
				data: { modes: mockOrgModes },
			})

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			// Should only include the valid mode
			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("valid-mode")
		})

		it("should handle mode wrapper without config property", async () => {
			const mockOrgModes = [
				{
					id: "mode-id-1",
					organization_id: "org-123",
					name: "Mode Without Config",
					slug: "no-config-mode",
					// Missing config property
				},
				{
					id: "mode-id-2",
					organization_id: "org-123",
					name: "Valid Mode",
					slug: "valid-mode",
					config: {
						roleDefinition: "Valid Role",
						groups: ["read"],
					},
				},
			]

			vi.mocked(axios.get).mockResolvedValue({
				data: { modes: mockOrgModes },
			})

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			// Should only include the mode with valid config
			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("valid-mode")
		})
	})

	describe("refreshWithOrganizationModes", () => {
		it("should merge organization modes with existing modes", async () => {
			const settingsModes = [
				{ slug: "global-mode", name: "Global Mode", roleDefinition: "Global Role", groups: ["read"] },
			]

			const organizationModes: ModeConfig[] = [
				{
					slug: "org-mode",
					name: "Org Mode",
					roleDefinition: "Org Role",
					groups: ["edit"],
					source: "organization",
				},
			]

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			}) as any)
			vi.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			await manager.refreshWithOrganizationModes(organizationModes)

			// Verify global state was updated with merged modes
			expect(mockContext.globalState.update).toHaveBeenCalledWith(
				"customModes",
				expect.arrayContaining([
					expect.objectContaining({
						slug: "org-mode",
						source: "organization",
					}),
					expect.objectContaining({
						slug: "global-mode",
						source: "global",
					}),
				]),
			)

			// Verify onUpdate was called
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		it("should respect precedence: organization > project > global", async () => {
			const settingsModes = [
				{ slug: "mode1", name: "Global Mode 1", roleDefinition: "Global Role", groups: ["read"] },
				{ slug: "mode2", name: "Global Mode 2", roleDefinition: "Global Role", groups: ["read"] },
			]

			const roomodesModes = [
				{ slug: "mode1", name: "Project Mode 1", roleDefinition: "Project Role", groups: ["read"] },
			]

			const organizationModes: ModeConfig[] = [
				{
					slug: "mode1",
					name: "Org Mode 1",
					roleDefinition: "Org Role",
					groups: ["edit"],
					source: "organization",
				},
				{
					slug: "mode2",
					name: "Org Mode 2",
					roleDefinition: "Org Role",
					groups: ["edit"],
					source: "organization",
				},
			]

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return yaml.stringify({ customModes: roomodesModes })
				}
				throw new Error("File not found")
			}) as any)

			await manager.refreshWithOrganizationModes(organizationModes)

			// Verify the merged modes respect precedence
			const updateCall = (mockContext.globalState.update as Mock).mock.calls.find(
				(call) => call[0] === "customModes",
			)
			expect(updateCall).toBeDefined()
			const mergedModes = updateCall![1] as ModeConfig[]

			// mode1 should come from organization (highest precedence)
			const mode1 = mergedModes.find((m) => m.slug === "mode1")
			expect(mode1?.name).toBe("Org Mode 1")
			expect(mode1?.source).toBe("organization")

			// mode2 should come from organization (highest precedence, not in project)
			const mode2 = mergedModes.find((m) => m.slug === "mode2")
			expect(mode2?.name).toBe("Org Mode 2")
			expect(mode2?.source).toBe("organization")
		})

		it("should clear cache after refresh", async () => {
			const organizationModes: ModeConfig[] = []

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			}) as any)
			vi.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			// First call to populate cache
			await manager.getCustomModes()

			// Clear mocks
			vi.clearAllMocks()

			// Refresh with organization modes
			await manager.refreshWithOrganizationModes(organizationModes)

			// Setup mocks again
			vi.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			}) as any)

			// Next call should read from file (cache was cleared)
			await manager.getCustomModes()
			expect(fs.readFile).toHaveBeenCalled()
		})
	})

	describe("mergeCustomModes with organization modes", () => {
		it("should merge modes with correct precedence order", async () => {
			const projectModes = [{ slug: "mode1", name: "Project Mode 1", roleDefinition: "Role", groups: ["read"] }]

			const organizationModes: ModeConfig[] = [
				{
					slug: "mode1",
					name: "Org Mode 1",
					roleDefinition: "Role",
					groups: ["read"],
					source: "organization",
				},
				{
					slug: "mode2",
					name: "Org Mode 2",
					roleDefinition: "Role",
					groups: ["read"],
					source: "organization",
				},
			]

			const globalModes = [
				{ slug: "mode1", name: "Global Mode 1", roleDefinition: "Role", groups: ["read"] },
				{ slug: "mode2", name: "Global Mode 2", roleDefinition: "Role", groups: ["read"] },
				{ slug: "mode3", name: "Global Mode 3", roleDefinition: "Role", groups: ["read"] },
			]

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: globalModes })
				}
				if (path === mockRoomodes) {
					return yaml.stringify({ customModes: projectModes })
				}
				throw new Error("File not found")
			}) as any)

			await manager.refreshWithOrganizationModes(organizationModes)

			const updateCall = vi
				.mocked(mockContext.globalState.update)
				.mock.calls.find((call) => call[0] === "customModes")
			expect(updateCall).toBeDefined()
			const mergedModes = updateCall![1] as ModeConfig[]

			// Should have 3 unique modes
			expect(mergedModes).toHaveLength(3)

			// mode1: organization takes precedence (highest)
			const mode1 = mergedModes.find((m) => m.slug === "mode1")
			expect(mode1?.name).toBe("Org Mode 1")
			expect(mode1?.source).toBe("organization")

			// mode2: organization takes precedence over global
			const mode2 = mergedModes.find((m) => m.slug === "mode2")
			expect(mode2?.name).toBe("Org Mode 2")
			expect(mode2?.source).toBe("organization")

			// mode3: only in global
			const mode3 = mergedModes.find((m) => m.slug === "mode3")
			expect(mode3?.name).toBe("Global Mode 3")
			expect(mode3?.source).toBe("global")
		})

		it("should handle empty organization modes array", async () => {
			const globalModes = [{ slug: "mode1", name: "Global Mode 1", roleDefinition: "Role", groups: ["read"] }]

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: globalModes })
				}
				throw new Error("File not found")
			}) as any)
			vi.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			await manager.refreshWithOrganizationModes([])

			const updateCall = vi
				.mocked(mockContext.globalState.update)
				.mock.calls.find((call) => call[0] === "customModes")
			expect(updateCall).toBeDefined()
			const mergedModes = updateCall![1] as ModeConfig[]

			expect(mergedModes).toHaveLength(1)
			expect(mergedModes[0].slug).toBe("mode1")
			expect(mergedModes[0].source).toBe("global")
		})

		it("should handle organization modes when switching from personal to organization", async () => {
			const globalModes = [{ slug: "mode1", name: "Global Mode 1", roleDefinition: "Role", groups: ["read"] }]

			const organizationModes: ModeConfig[] = [
				{
					slug: "org-specific",
					name: "Org Specific Mode",
					roleDefinition: "Org Role",
					groups: ["read", "edit"],
					source: "organization",
				},
			]

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: globalModes })
				}
				throw new Error("File not found")
			}) as any)
			vi.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			await manager.refreshWithOrganizationModes(organizationModes)

			const updateCall = vi
				.mocked(mockContext.globalState.update)
				.mock.calls.find((call) => call[0] === "customModes")
			expect(updateCall).toBeDefined()
			const mergedModes = updateCall![1] as ModeConfig[]

			expect(mergedModes).toHaveLength(2)
			expect(mergedModes.some((m) => m.slug === "org-specific" && m.source === "organization")).toBe(true)
			expect(mergedModes.some((m) => m.slug === "mode1" && m.source === "global")).toBe(true)
		})

		it("should handle organization modes when switching back to personal", async () => {
			const globalModes = [{ slug: "mode1", name: "Global Mode 1", roleDefinition: "Role", groups: ["read"] }]

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: globalModes })
				}
				throw new Error("File not found")
			}) as any)
			vi.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			// Refresh with empty organization modes (personal account)
			await manager.refreshWithOrganizationModes([])

			const updateCall = vi
				.mocked(mockContext.globalState.update)
				.mock.calls.find((call) => call[0] === "customModes")
			expect(updateCall).toBeDefined()
			const mergedModes = updateCall![1] as ModeConfig[]

			// Should only have global modes
			expect(mergedModes).toHaveLength(1)
			expect(mergedModes[0].slug).toBe("mode1")
			expect(mergedModes[0].source).toBe("global")
		})
	})

	describe("updateCustomMode with organization modes", () => {
		it("should preserve organization mode precedence when creating a conflicting project mode", async () => {
			const organizationModes: ModeConfig[] = [
				{
					slug: "test-mode",
					name: "Org Test Mode",
					roleDefinition: "Org Role",
					groups: ["read"],
					source: "organization",
				},
			]

			// Set up organization modes in global state
			vi.mocked(mockContext.globalState.get).mockResolvedValue(organizationModes)

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				if (path === mockRoomodes) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			}) as any)

			// Try to create a project mode with the same slug
			const newProjectMode: ModeConfig = {
				slug: "test-mode",
				name: "Project Test Mode",
				roleDefinition: "Project Role",
				groups: ["edit"],
				source: "project",
			}

			await manager.updateCustomMode("test-mode", newProjectMode)

			// Verify that the merged modes still have organization mode taking precedence
			const updateCalls = vi
				.mocked(mockContext.globalState.update)
				.mock.calls.filter((call) => call[0] === "customModes")
			expect(updateCalls.length).toBeGreaterThan(0)

			const lastUpdateCall = updateCalls[updateCalls.length - 1]
			const mergedModes = lastUpdateCall[1] as ModeConfig[]

			// Find the test-mode in merged modes
			const testMode = mergedModes.find((m) => m.slug === "test-mode")
			expect(testMode).toBeDefined()
			expect(testMode?.name).toBe("Org Test Mode") // Organization mode should win
			expect(testMode?.source).toBe("organization")
		})

		it("should preserve organization mode precedence when creating a conflicting global mode", async () => {
			const organizationModes: ModeConfig[] = [
				{
					slug: "test-mode",
					name: "Org Test Mode",
					roleDefinition: "Org Role",
					groups: ["read"],
					source: "organization",
				},
			]

			// Set up organization modes in global state
			vi.mocked(mockContext.globalState.get).mockResolvedValue(organizationModes)

			vi.mocked(fs.readFile).mockImplementation((async (path: any) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			}) as any)
			vi.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			// Try to create a global mode with the same slug
			const newGlobalMode: ModeConfig = {
				slug: "test-mode",
				name: "Global Test Mode",
				roleDefinition: "Global Role",
				groups: ["edit"],
				source: "global",
			}

			await manager.updateCustomMode("test-mode", newGlobalMode)

			// Verify that the merged modes still have organization mode taking precedence
			const updateCalls = vi
				.mocked(mockContext.globalState.update)
				.mock.calls.filter((call) => call[0] === "customModes")
			expect(updateCalls.length).toBeGreaterThan(0)

			const lastUpdateCall = updateCalls[updateCalls.length - 1]
			const mergedModes = lastUpdateCall[1] as ModeConfig[]

			// Find the test-mode in merged modes
			const testMode = mergedModes.find((m) => m.slug === "test-mode")
			expect(testMode).toBeDefined()
			expect(testMode?.name).toBe("Org Test Mode") // Organization mode should win
			expect(testMode?.source).toBe("organization")
		})
	})

	describe("API error handling", () => {
		it("should handle network timeout", async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error("ETIMEDOUT"))

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			expect(modes).toEqual([])
		})

		it("should handle 401 unauthorized", async () => {
			vi.mocked(axios.get).mockRejectedValue({
				response: { status: 401, data: { message: "Unauthorized" } },
			})

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			expect(modes).toEqual([])
		})

		it("should handle 404 not found", async () => {
			vi.mocked(axios.get).mockRejectedValue({
				response: { status: 404, data: { message: "Organization not found" } },
			})

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			expect(modes).toEqual([])
		})

		it("should handle malformed JSON response", async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: "not a json object",
			})

			const modes = await manager.fetchOrganizationModes("test-token", "org-123")

			expect(modes).toEqual([])
		})
	})
})
