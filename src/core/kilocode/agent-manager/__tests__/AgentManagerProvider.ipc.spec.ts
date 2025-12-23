import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest"
import * as vscode from "vscode"
import { AgentManagerProvider } from "../AgentManagerProvider"
import { AgentRegistry } from "../AgentRegistry"
import type { CliProcessHandler } from "../CliProcessHandler"

// Minimal mocks for VS Code APIs
vi.mock("vscode", () => {
	const window = {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
		createTerminal: vi.fn(() => ({ show: vi.fn(), dispose: vi.fn() })),
	}
	const Uri = {
		joinPath: vi.fn(),
	}
	const workspace = {
		workspaceFolders: [],
		getConfiguration: vi.fn(() => ({ get: vi.fn() })),
	}
	const ExtensionMode = {
		Development: 1,
		Production: 2,
		Test: 3,
	}
	const ThemeIcon = vi.fn()
	return { window, Uri, workspace, ExtensionMode, ThemeIcon }
})

describe("AgentManagerProvider IPC paths", () => {
	let provider: AgentManagerProvider
	let mockProcessHandler: Mocked<CliProcessHandler>
	let mockPanel: any
	let output: string[]
	let registry: AgentRegistry
	let providerStub: { getState: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		output = []
		registry = new AgentRegistry()

		mockProcessHandler = {
			hasStdin: vi.fn(),
			writeToStdin: vi.fn(),
			stopProcess: vi.fn(),
			hasProcess: vi.fn(),
		} as unknown as Mocked<CliProcessHandler>

		mockPanel = {
			webview: { postMessage: vi.fn() },
			dispose: vi.fn(),
		}

		const outputChannel: vscode.OutputChannel = {
			name: "test",
			append: (value: string) => output.push(value),
			appendLine: (value: string) => output.push(value),
			clear: vi.fn(),
			dispose: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			replace: vi.fn(),
		} as unknown as vscode.OutputChannel

		const context = {
			extensionUri: vscode.Uri.joinPath({} as any, "") as any,
			asAbsolutePath: (p: string) => p,
			extensionMode: 1, // Development mode
		} as unknown as vscode.ExtensionContext
		providerStub = {
			getState: vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "kilocode" } }),
		}

		provider = new AgentManagerProvider(context, outputChannel, providerStub as any)

		// Inject mocks
		;(provider as any).processHandler = mockProcessHandler
		;(provider as any).panel = mockPanel
		;(provider as any).registry = registry
	})

	it("sendMessage surfaces stdin errors", async () => {
		mockProcessHandler.hasStdin.mockReturnValue(true)
		mockProcessHandler.writeToStdin.mockRejectedValue(new Error("boom"))

		await expect(provider.sendMessage("sess", "hello")).rejects.toThrow("boom")

		expect(mockProcessHandler.writeToStdin).toHaveBeenCalled()
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Failed to send message to agent: boom")
	})

	it("cancelSession falls back to stopProcess when stdin missing", async () => {
		mockProcessHandler.hasStdin.mockReturnValue(false)

		await provider.cancelSession("sess")

		expect(mockProcessHandler.stopProcess).toHaveBeenCalledWith("sess")
	})

	it("respondToApproval surfaces stdin errors", async () => {
		mockProcessHandler.hasStdin.mockReturnValue(true)
		mockProcessHandler.writeToStdin.mockRejectedValue(new Error("denied"))

		await expect(provider.respondToApproval("sess", true, "ok")).rejects.toThrow("denied")

		expect(vscode.window.showErrorMessage).toHaveBeenLastCalledWith("Failed to send approval-yes to agent: denied")
	})

	it("syncPermissionConfigToRunningSessions sends updates only when config changes", async () => {
		registry.createSession("sess", "prompt")
		mockProcessHandler.hasStdin.mockImplementation((id) => id === "sess")

		providerStub.getState.mockResolvedValue({
			autoApprovalEnabled: false,
			alwaysAllowReadOnly: true,
			alwaysAllowReadOnlyOutsideWorkspace: false,
			alwaysAllowWrite: true,
			alwaysAllowWriteOutsideWorkspace: false,
			alwaysAllowWriteProtected: false,
			alwaysAllowBrowser: false,
			alwaysApproveResubmit: false,
			requestDelaySeconds: 10,
			alwaysAllowMcp: false,
			alwaysAllowModeSwitch: false,
			alwaysAllowSubtasks: false,
			alwaysAllowExecute: false,
			allowedCommands: ["npm test"],
			deniedCommands: ["rm -rf"],
			alwaysAllowFollowupQuestions: false,
			followupAutoApproveTimeoutMs: 60000,
			alwaysAllowUpdateTodoList: false,
		})

		await (provider as any).syncPermissionConfigToRunningSessions()

		expect(mockProcessHandler.writeToStdin).toHaveBeenCalledWith("sess", {
			type: "permissionConfigUpdate",
			config: {
				enabled: false,
				read: { enabled: true, outside: false },
				write: { enabled: true, outside: false, protected: false },
				browser: { enabled: false },
				retry: { enabled: false, delay: 10 },
				mcp: { enabled: false },
				mode: { enabled: false },
				subtasks: { enabled: false },
				execute: { enabled: false, allowed: ["npm test"], denied: ["rm -rf"] },
				question: { enabled: false, timeout: 60000 },
				todo: { enabled: false },
			},
		})

		mockProcessHandler.writeToStdin.mockClear()

		// Same config => no-op
		await (provider as any).syncPermissionConfigToRunningSessions()
		expect(mockProcessHandler.writeToStdin).not.toHaveBeenCalled()

		// Change config => broadcast
		providerStub.getState.mockResolvedValue({
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
			allowedCommands: ["npm test"],
			deniedCommands: ["rm -rf"],
			alwaysAllowFollowupQuestions: false,
			followupAutoApproveTimeoutMs: 60000,
			alwaysAllowUpdateTodoList: false,
		})

		await (provider as any).syncPermissionConfigToRunningSessions()
		expect(mockProcessHandler.writeToStdin).toHaveBeenCalledTimes(1)
	})
})
