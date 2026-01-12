import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { GhostStatusBar } from "../GhostStatusBar"
import type { GhostStatusBarStateProps } from "../types"

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		createStatusBarItem: vi.fn(() => ({
			text: "",
			tooltip: "",
			command: undefined,
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		})),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
	commands: {
		registerCommand: vi.fn(() => ({
			dispose: vi.fn(),
		})),
	},
	StatusBarAlignment: {
		Right: 1,
	},
	MarkdownString: vi.fn().mockImplementation((text: string) => ({
		value: text,
		isTrusted: false,
	})),
}))

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, params?: Record<string, unknown>) => {
		if (params) {
			return `${key}: ${JSON.stringify(params)}`
		}
		return key
	}),
}))

// Mock PROVIDERS
vi.mock("../../../../webview-ui/src/components/settings/constants", () => ({
	PROVIDERS: [
		{ value: "openai", label: "OpenAI" },
		{ value: "anthropic", label: "Anthropic" },
	],
}))

describe("GhostStatusBar", () => {
	let statusBar: GhostStatusBar
	let defaultProps: GhostStatusBarStateProps
	let registeredCommandCallback: () => void

	beforeEach(() => {
		vi.clearAllMocks()

		// Capture the command callback when registerCommand is called
		vi.mocked(vscode.commands.registerCommand).mockImplementation((commandId, callback) => {
			registeredCommandCallback = callback as () => void
			return { dispose: vi.fn() }
		})

		defaultProps = {
			enabled: true,
			completionCount: 5,
			totalSessionCost: 0.05,
			sessionStartTime: Date.now() - 3600000, // 1 hour ago
			snoozed: false,
			model: "gpt-4",
			provider: "openai",
			hasKilocodeProfileWithNoBalance: false,
			hasNoUsableProvider: false,
		}

		statusBar = new GhostStatusBar(defaultProps)
	})

	afterEach(() => {
		statusBar.dispose()
	})

	describe("initialization", () => {
		it("should create a status bar item", () => {
			expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Right, 100)
		})

		it("should register a command for click handling", () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"kilocode.ghost.showStatus",
				expect.any(Function),
			)
		})

		it("should set the command on the status bar item", () => {
			expect(statusBar.statusBar.command).toBe("kilocode.ghost.showStatus")
		})

		it("should show the status bar", () => {
			expect(statusBar.statusBar.show).toHaveBeenCalled()
		})
	})

	describe("click behavior", () => {
		it("should show information message with completion summary when clicked", () => {
			statusBar.update(defaultProps)
			registeredCommandCallback()

			expect(vscode.window.showInformationMessage).toHaveBeenCalled()
		})

		it("should show warning message when no credits", () => {
			statusBar.update({ ...defaultProps, hasKilocodeProfileWithNoBalance: true })
			registeredCommandCallback()

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("kilocode:ghost.statusBar.tooltip.noCredits")
		})

		it("should show warning message when no usable provider", () => {
			statusBar.update({ ...defaultProps, hasNoUsableProvider: true })
			registeredCommandCallback()

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				expect.stringContaining("kilocode:ghost.statusBar.tooltip.noUsableProvider"),
			)
		})
	})

	describe("dispose", () => {
		it("should dispose the command registration", () => {
			const commandDisposable = { dispose: vi.fn() }
			vi.mocked(vscode.commands.registerCommand).mockReturnValue(commandDisposable)

			const newStatusBar = new GhostStatusBar(defaultProps)
			newStatusBar.dispose()

			expect(commandDisposable.dispose).toHaveBeenCalled()
		})

		it("should dispose the status bar item", () => {
			statusBar.dispose()
			expect(statusBar.statusBar.dispose).toHaveBeenCalled()
		})
	})
})
