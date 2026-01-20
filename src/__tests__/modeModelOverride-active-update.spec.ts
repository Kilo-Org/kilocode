// kilocode_change new file
import { webviewMessageHandler } from "../core/webview/webviewMessageHandler"

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		createOutputChannel: vi.fn().mockReturnValue({ appendLine: vi.fn() }),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({ get: vi.fn(), update: vi.fn() }),
		workspaceFolders: [],
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		}),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		uiKind: 1,
		appName: "Visual Studio Code",
	},
	UIKind: {
		Desktop: 1,
		Web: 2,
		1: "Desktop",
		2: "Web",
	},
	commands: {
		executeCommand: vi.fn(),
	},
	Uri: {
		parse: vi.fn(),
		file: vi.fn(),
	},
}))

// Prevent loading/initializing unrelated infrastructure when importing webviewMessageHandler.
vi.mock("../services/roo-config/index.js", () => ({
	getRooDirectoriesForCwd: vi.fn().mockReturnValue([]),
}))

vi.mock("../i18n", () => ({
	changeLanguage: vi.fn(),
	t: vi.fn((key: string) => key),
}))

describe("webviewMessageHandler: setModeModelOverride", () => {
	const makeProvider = (overrides?: {
		apiProvider?: string
		gatewayModelsAvailable?: boolean
		mode?: string
		modeModelOverrides?: Record<string, string>
	}) => {
		const apiProvider = overrides?.apiProvider ?? "kilocode"
		const gatewayModelsAvailable = overrides?.gatewayModelsAvailable ?? true
		const mode = overrides?.mode ?? "code"
		const modeModelOverrides = overrides?.modeModelOverrides ?? {}

		const getValue = vi.fn().mockImplementation((key: string) => {
			if (key === "modeModelOverrides") return modeModelOverrides
			if (key === "mode") return mode
			return undefined
		})

		const setValue = vi.fn().mockResolvedValue(undefined)

		return {
			contextProxy: {
				getValue,
				setValue,
				getProviderSettings: vi.fn().mockReturnValue({ apiProvider }),
			},
			getKilocodeGatewayModelsAvailable: vi.fn().mockReturnValue(gatewayModelsAvailable),
			applyCanonicalModelIdToActiveProviderConfiguration: vi.fn().mockResolvedValue(undefined),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
		} as any
	}

	it("applies the per-mode override immediately when updating the current mode", async () => {
		const provider = makeProvider({ apiProvider: "kilocode", gatewayModelsAvailable: true, mode: "code" })

		await webviewMessageHandler(provider, {
			type: "setModeModelOverride",
			payload: { mode: "code", modelId: "kilocode/model-x" },
		} as any)

		expect(provider.contextProxy.setValue).toHaveBeenCalledWith("modeModelOverrides", {
			code: "kilocode/model-x",
		})
		expect(provider.applyCanonicalModelIdToActiveProviderConfiguration).toHaveBeenCalledWith("kilocode/model-x")
	})

	it("does not apply immediately when provider is not kilocode", async () => {
		const provider = makeProvider({ apiProvider: "openrouter", gatewayModelsAvailable: true, mode: "code" })

		await webviewMessageHandler(provider, {
			type: "setModeModelOverride",
			payload: { mode: "code", modelId: "kilocode/model-x" },
		} as any)

		expect(provider.applyCanonicalModelIdToActiveProviderConfiguration).not.toHaveBeenCalled()
	})

	it("does not apply immediately when setting to default (modelId=null)", async () => {
		const provider = makeProvider({
			apiProvider: "kilocode",
			gatewayModelsAvailable: true,
			mode: "code",
			modeModelOverrides: { code: "kilocode/model-y" },
		})

		await webviewMessageHandler(provider, {
			type: "setModeModelOverride",
			payload: { mode: "code", modelId: null },
		} as any)

		expect(provider.contextProxy.setValue).toHaveBeenCalledWith("modeModelOverrides", {})
		expect(provider.applyCanonicalModelIdToActiveProviderConfiguration).not.toHaveBeenCalled()
	})
})
