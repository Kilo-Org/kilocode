import { render, screen } from "@testing-library/react"
import { defaultModeSlug } from "@roo/modes"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import ChatTextArea from "../../../chat/ChatTextArea"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")
vi.mock("@src/utils/path-mentions", () => ({
	convertToMentionPath: vi.fn((path, cwd) => {
		// Simple mock implementation that mimics the real function's behavior
		if (cwd && path.toLowerCase().startsWith(cwd.toLowerCase())) {
			const relativePath = path.substring(cwd.length)
			return "@" + (relativePath.startsWith("/") ? relativePath : "/" + relativePath)
		}
		return path
	}),
}))

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext")

vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: vi.fn(() => ({
		id: "mock-model-id",
		provider: "mock-provider",
	})),
}))

describe("ChatTextArea", () => {
	const defaultProps = {
		inputValue: "",
		setInputValue: vi.fn(),
		onSend: vi.fn(),
		sendingDisabled: false,
		selectApiConfigDisabled: false,
		onSelectImages: vi.fn(),
		shouldDisableImages: false,
		placeholderText: "Type a message...",
		selectedImages: [],
		setSelectedImages: vi.fn(),
		onHeightChange: vi.fn(),
		mode: defaultModeSlug,
		setMode: vi.fn(),
		modeShortcutText: "(⌘. for next mode)",
	}

	beforeEach(() => {
		vi.clearAllMocks()
		// Default mock implementation for useExtensionState
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			apiConfiguration: {
				apiProvider: "anthropic",
			},
			taskHistory: [],
			cwd: "/test/workspace",
		})
	})

	describe("selectApiConfig", () => {
		// Helper function to check if the API config dropdown exists
		const apiConfigDropdownExists = () => {
			return screen.queryByTitle("chat:selectApiConfig") !== null
		}

		beforeEach(() => {
			// Default mock with multiple API configs
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "anthropic",
				},
				taskHistory: [],
				cwd: "/test/workspace",
				listApiConfigMeta: [
					{ id: "config1", name: "Config 1" },
					{ id: "config2", name: "Config 2" },
				],
				pinnedApiConfigs: {},
				currentApiConfigName: "Config 1",
			})
		})

		it("should be visible when there are multiple API configs", () => {
			render(<ChatTextArea {...defaultProps} sendingDisabled={false} selectApiConfigDisabled={false} />)
			expect(apiConfigDropdownExists()).toBe(true)
		})

		it("should be hidden when there is only one API config", () => {
			// Mock with only one API config
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "anthropic",
				},
				taskHistory: [],
				cwd: "/test/workspace",
				listApiConfigMeta: [{ id: "config1", name: "Config 1" }],
				pinnedApiConfigs: {},
				currentApiConfigName: "Config 1",
			})

			render(<ChatTextArea {...defaultProps} sendingDisabled={false} selectApiConfigDisabled={false} />)
			expect(apiConfigDropdownExists()).toBe(false)
		})
	})
})
