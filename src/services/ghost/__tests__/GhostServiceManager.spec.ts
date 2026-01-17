import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as vscode from "vscode"
import { GhostServiceManager } from "../GhostServiceManager"

vi.mock("vscode", () => {
	class Position {
		constructor(
			public line: number,
			public character: number,
		) {}
	}

	class Range {
		constructor(
			public start: any,
			public end: any,
		) {}
	}

	class CancellationTokenSource {
		public token = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(),
		}

		dispose = vi.fn()
	}

	return {
		Uri: {
			parse: (uriString: string) => ({
				toString: () => uriString,
				fsPath: uriString.replace("file://", ""),
				scheme: "file",
				path: uriString.replace("file://", ""),
			}),
		},
		Position,
		Range,
		CancellationTokenSource,
		InlineCompletionTriggerKind: {
			Invoke: 1,
		},
		workspace: {
			openTextDocument: vi.fn(),
			applyEdit: vi.fn(),
			asRelativePath: vi.fn().mockImplementation((uri) => {
				if (typeof uri === "string") return uri.replace("file:///", "")
				return uri.toString().replace("file:///", "")
			}),
		},
		window: {
			activeTextEditor: null as any,
		},
		languages: {
			registerInlineCompletionItemProvider: vi.fn(),
		},
		commands: {
			executeCommand: vi.fn(),
		},
	}
})

vi.mock("../GhostModel", () => {
	class GhostModel {
		public loaded = false
		public profileName = "test-profile"

		public async reload(): Promise<void> {
			this.loaded = true
		}

		public getModelName(): string {
			return "test-model"
		}

		public getProviderDisplayName(): string {
			return "test-provider"
		}

		public hasValidCredentials(): boolean {
			return true
		}
	}

	return { GhostModel }
})

vi.mock("../GhostStatusBar", () => {
	class GhostStatusBar {
		public update = vi.fn()
		public dispose = vi.fn()
		constructor(_args: any) {}
	}
	return { GhostStatusBar }
})

vi.mock("../GhostCodeActionProvider", () => {
	class GhostCodeActionProvider {}
	return { GhostCodeActionProvider }
})

vi.mock("../classic-auto-complete/GhostInlineCompletionProvider", () => {
	class GhostInlineCompletionProvider {
		public provideInlineCompletionItems_Internal = vi.fn()
		public dispose = vi.fn()

		constructor(..._args: any[]) {}
	}
	return { GhostInlineCompletionProvider }
})

vi.mock("../classic-auto-complete/AutocompleteTelemetry", () => {
	class AutocompleteTelemetry {}
	return { AutocompleteTelemetry }
})

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

vi.mock("../../../core/config/ContextProxy", () => {
	const state: Record<string, any> = {}

	const api = {
		getGlobalState: (key: string) => state[key],
		setValues: async (values: Record<string, any>) => {
			Object.assign(state, values)
		},
	}

	class ContextProxy {
		static instance = api
	}

	const __resetState = () => {
		for (const key of Object.keys(state)) delete state[key]
	}

	const __setState = (values: Record<string, any>) => {
		Object.assign(state, values)
	}

	return { ContextProxy, __resetState, __setState }
})

type TestCline = {
	providerSettingsManager: { initialize: () => Promise<void> }
	postStateToWebview: () => Promise<void>
}

async function createManager(): Promise<GhostServiceManager> {
	const { __setState } = (await import("../../../core/config/ContextProxy")) as any

	__setState({
		ghostServiceSettings: {
			enableAutoTrigger: false,
			enableSmartInlineTaskKeybinding: true,
		},
	})

	const context = { subscriptions: [] } as unknown as vscode.ExtensionContext
	const cline: TestCline = {
		providerSettingsManager: { initialize: vi.fn().mockResolvedValue(undefined) },
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	}

	const manager = new GhostServiceManager(context, cline as any)

	await manager.load()

	return manager
}

describe("GhostServiceManager (less mocked logic)", () => {
	beforeEach(async () => {
		vi.clearAllMocks()

		const { __resetState } = (await import("../../../core/config/ContextProxy")) as any
		__resetState()
		;(vscode.window as any).activeTextEditor = null
		vi.mocked(vscode.languages.registerInlineCompletionItemProvider).mockReset()

		// Reset singleton instance before each test
		GhostServiceManager._resetInstance()
	})

	afterEach(() => {
		;(vscode.window as any).activeTextEditor = null
	})

	describe("codeSuggestion()", () => {
		it("calls the provider and inserts the first completion into the editor", async () => {
			const manager = await createManager()

			const document = { uri: vscode.Uri.parse("file:///test.ts") }
			const position = new vscode.Position(0, 0)
			const inserted: { position?: any; text?: string } = {}

			;(vscode.window as any).activeTextEditor = {
				document,
				selection: { active: position },
				edit: vi.fn().mockImplementation(async (cb: any) => {
					const editBuilder = {
						insert: vi.fn((pos: any, text: string) => {
							inserted.position = pos
							inserted.text = text
						}),
					}
					cb(editBuilder)
					return true
				}),
			}

			const provider = manager.inlineCompletionProvider as any
			provider.provideInlineCompletionItems_Internal.mockResolvedValueOnce([
				{
					insertText: "// suggestion",
					range: new vscode.Range(position, position),
				},
			])

			await manager.codeSuggestion()

			expect(provider.provideInlineCompletionItems_Internal).toHaveBeenCalledWith(
				document,
				position,
				expect.objectContaining({
					triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
				}),
				expect.any(Object),
			)

			expect(inserted.position).toBe(position)
			expect(inserted.text).toBe("// suggestion")
		})

		it("does nothing when there is no active editor", async () => {
			const manager = await createManager()

			;(vscode.window as any).activeTextEditor = null

			await manager.codeSuggestion()

			const provider = manager.inlineCompletionProvider as any
			expect(provider.provideInlineCompletionItems_Internal).not.toHaveBeenCalled()
		})
	})

	describe("updateInlineCompletionProviderRegistration()", () => {
		it("registers the provider when enableAutoTrigger is true and not snoozed", async () => {
			const manager = await createManager()

			const disposable = { dispose: vi.fn() }
			vi.mocked(vscode.languages.registerInlineCompletionItemProvider).mockReturnValue(disposable as any)
			;(manager as any).settings = {
				enableAutoTrigger: true,
				enableSmartInlineTaskKeybinding: true,
			}

			await (manager as any).updateInlineCompletionProviderRegistration()

			expect(vscode.languages.registerInlineCompletionItemProvider).toHaveBeenCalledWith(
				{ scheme: "file" },
				manager.inlineCompletionProvider,
			)
			expect((manager as any).inlineCompletionProviderDisposable).toBe(disposable)
		})

		it("does not register the provider when snoozed", async () => {
			const manager = await createManager()

			vi.mocked(vscode.languages.registerInlineCompletionItemProvider).mockReturnValue({
				dispose: vi.fn(),
			} as any)
			;(manager as any).settings = {
				enableAutoTrigger: true,
				snoozeUntil: Date.now() + 60_000,
				enableSmartInlineTaskKeybinding: true,
			}

			await (manager as any).updateInlineCompletionProviderRegistration()

			expect(vscode.languages.registerInlineCompletionItemProvider).not.toHaveBeenCalled()
			expect((manager as any).inlineCompletionProviderDisposable).toBeNull()
		})

		it("disposes an existing registration before applying the new registration decision", async () => {
			const manager = await createManager()

			const existingDisposable = { dispose: vi.fn() }
			;(manager as any).inlineCompletionProviderDisposable = existingDisposable
			;(manager as any).settings = {
				enableAutoTrigger: false,
				enableSmartInlineTaskKeybinding: true,
			}

			await (manager as any).updateInlineCompletionProviderRegistration()

			expect(existingDisposable.dispose).toHaveBeenCalledTimes(1)
			expect((manager as any).inlineCompletionProviderDisposable).toBeNull()
		})
	})

	describe("snooze state helpers", () => {
		it("isSnoozed() returns false when snoozeUntil is not set", async () => {
			const manager = await createManager()
			;(manager as any).settings = { enableAutoTrigger: true }

			expect(manager.isSnoozed()).toBe(false)
		})

		it("isSnoozed() returns false when snoozeUntil is in the past", async () => {
			const manager = await createManager()
			;(manager as any).settings = { snoozeUntil: Date.now() - 1000 }

			expect(manager.isSnoozed()).toBe(false)
		})

		it("isSnoozed() returns true when snoozeUntil is in the future", async () => {
			const manager = await createManager()
			;(manager as any).settings = { snoozeUntil: Date.now() + 60_000 }

			expect(manager.isSnoozed()).toBe(true)
		})

		it("getSnoozeRemainingSeconds() returns 0 when not snoozed", async () => {
			const manager = await createManager()
			;(manager as any).settings = {}

			expect(manager.getSnoozeRemainingSeconds()).toBe(0)
		})

		it("getSnoozeRemainingSeconds() returns a positive number when snoozed", async () => {
			const manager = await createManager()
			;(manager as any).settings = { snoozeUntil: Date.now() + 30_000 }

			const remaining = manager.getSnoozeRemainingSeconds()
			expect(remaining).toBeGreaterThan(0)
			expect(remaining).toBeLessThanOrEqual(30)
		})
	})
})
