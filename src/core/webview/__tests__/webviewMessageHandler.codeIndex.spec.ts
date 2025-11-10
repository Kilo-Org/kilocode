import { describe, it, expect, vi, beforeEach } from "vitest"
import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

// Mock the getKiloConfig method
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn(() => "/test/workspace"),
}))

describe("webviewMessageHandler - requestIndexingStatus with managed indexing", () => {
	let mockProvider: any
	let mockManager: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockManager = {
			getCurrentStatus: vi.fn(() => ({
				systemStatus: "Standby",
				message: "",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
				workspacePath: "/test/workspace",
			})),
			getKiloOrgCodeIndexProps: vi.fn(() => null),
			setKiloOrgCodeIndexProps: vi.fn(),
			workspacePath: "/test/workspace",
		}

		mockProvider = {
			getCurrentWorkspaceCodeIndexManager: vi.fn(() => mockManager),
			getState: vi.fn(async () => ({
				apiConfiguration: {
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "test-org-id",
				},
			})),
			getKiloConfig: vi.fn(async () => ({
				project: {
					id: "test-project-id",
				},
			})),
			postMessageToWebview: vi.fn(),
			log: vi.fn(),
		} as unknown as ClineProvider
	})

	it("should set Kilo org props before getting status when organization credentials are available", async () => {
		await webviewMessageHandler(mockProvider, {
			type: "requestIndexingStatus",
		})

		// Verify that setKiloOrgCodeIndexProps was called with correct props
		expect(mockManager.setKiloOrgCodeIndexProps).toHaveBeenCalledWith({
			kilocodeToken: "test-token",
			organizationId: "test-org-id",
			projectId: "test-project-id",
		})

		// Verify that status was retrieved and sent to webview
		expect(mockManager.getCurrentStatus).toHaveBeenCalled()
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "indexingStatusUpdate",
			values: expect.objectContaining({
				systemStatus: "Standby",
			}),
		})
	})

	it("should not set Kilo org props if they are already set", async () => {
		// Mock that props are already set
		mockManager.getKiloOrgCodeIndexProps.mockReturnValue({
			kilocodeToken: "test-token",
			organizationId: "test-org-id",
			projectId: "test-project-id",
		})

		await webviewMessageHandler(mockProvider, {
			type: "requestIndexingStatus",
		})

		// Verify that setKiloOrgCodeIndexProps was NOT called
		expect(mockManager.setKiloOrgCodeIndexProps).not.toHaveBeenCalled()

		// Verify that status was still retrieved
		expect(mockManager.getCurrentStatus).toHaveBeenCalled()
	})

	it("should not set Kilo org props if organization credentials are missing", async () => {
		mockProvider.getState = vi.fn(async () => ({
			apiConfiguration: {
				// No kilocodeToken or kilocodeOrganizationId
			},
		}))

		await webviewMessageHandler(mockProvider, {
			type: "requestIndexingStatus",
		})

		// Verify that setKiloOrgCodeIndexProps was NOT called
		expect(mockManager.setKiloOrgCodeIndexProps).not.toHaveBeenCalled()

		// Verify that status was still retrieved
		expect(mockManager.getCurrentStatus).toHaveBeenCalled()
	})

	it("should not set Kilo org props if project ID is missing", async () => {
		mockProvider.getKiloConfig = vi.fn(async () => ({
			project: {
				// No id
			},
		}))

		await webviewMessageHandler(mockProvider, {
			type: "requestIndexingStatus",
		})

		// Verify that setKiloOrgCodeIndexProps was NOT called
		expect(mockManager.setKiloOrgCodeIndexProps).not.toHaveBeenCalled()

		// Verify that status was still retrieved
		expect(mockManager.getCurrentStatus).toHaveBeenCalled()
	})

	it("should send error status when no workspace is open", async () => {
		mockProvider.getCurrentWorkspaceCodeIndexManager = vi.fn(() => null)

		await webviewMessageHandler(mockProvider, {
			type: "requestIndexingStatus",
		})

		// Verify error status was sent
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "indexingStatusUpdate",
			values: {
				systemStatus: "Error",
				message: "orchestrator.indexingRequiresWorkspace",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
				workerspacePath: undefined,
			},
		})
	})
})
