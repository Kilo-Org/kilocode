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
		const providerStub = {
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
})
