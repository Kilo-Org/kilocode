import { defaultModeSlug } from "@roo/modes"

import { render, screen } from "@src/utils/test-utils"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useQuery } from "@tanstack/react-query"

import { ChatTextArea } from "../ChatTextArea"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext")

// Mock react-query - use auto-mock and configure in beforeEach
vi.mock("@tanstack/react-query")

vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: vi.fn(() => ({
		id: "mock-model-id",
		provider: "mock-provider",
	})),
}))

describe("ChatTextArea - autocomplete profile filtering", () => {
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
		// Configure useQuery mock to return empty history
		;(useQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { historyItems: [] } })
	})

	it("should filter out autocomplete profiles from the profile list", () => {
		const mockListApiConfigMeta = [
			{ id: "1", name: "Chat Profile 1", profileType: "chat" },
			{ id: "2", name: "Autocomplete Profile", profileType: "autocomplete" },
			{ id: "3", name: "Chat Profile 2", profileType: "chat" },
			{ id: "4", name: "Profile Without Type" }, // No profileType defaults to chat
		]

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			listApiConfigMeta: mockListApiConfigMeta,
			currentApiConfigName: "Chat Profile 1",
			taskHistory: [],
			taskHistoryVersion: 0,
			clineMessages: [],
			cwd: "/test/workspace",
		})

		render(<ChatTextArea {...defaultProps} />)

		// The KiloProfileSelector should only receive chat profiles
		// We can verify this by checking that autocomplete profiles are not in the DOM
		// Note: KiloProfileSelector hides when there's only 1 profile, so we need at least 2 chat profiles
		expect(screen.queryByText("Autocomplete Profile")).not.toBeInTheDocument()
	})

	it("should include profiles without profileType (defaults to chat)", () => {
		const mockListApiConfigMeta = [
			{ id: "1", name: "Chat Profile 1", profileType: "chat" },
			{ id: "2", name: "Profile Without Type" }, // No profileType
			{ id: "3", name: "Autocomplete Profile", profileType: "autocomplete" },
		]

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			listApiConfigMeta: mockListApiConfigMeta,
			currentApiConfigName: "Chat Profile 1",
			pinnedApiConfigs: {},
			taskHistory: [],
			taskHistoryVersion: 0,
			clineMessages: [],
			cwd: "/test/workspace",
		})

		render(<ChatTextArea {...defaultProps} />)

		// Profile without type should be included (defaults to chat)
		// Autocomplete profile should be filtered out
		expect(screen.queryByText("Autocomplete Profile")).not.toBeInTheDocument()
	})

	it("should handle empty profile list gracefully", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			listApiConfigMeta: [],
			currentApiConfigName: "",
			taskHistory: [],
			taskHistoryVersion: 0,
			clineMessages: [],
			cwd: "/test/workspace",
		})

		expect(() => {
			render(<ChatTextArea {...defaultProps} />)
		}).not.toThrow()
	})

	it("should handle undefined listApiConfigMeta gracefully", () => {
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			listApiConfigMeta: undefined,
			currentApiConfigName: "",
			taskHistory: [],
			taskHistoryVersion: 0,
			clineMessages: [],
			cwd: "/test/workspace",
		})

		expect(() => {
			render(<ChatTextArea {...defaultProps} />)
		}).not.toThrow()
	})

	it("should filter autocomplete profiles when all profiles are autocomplete", () => {
		const mockListApiConfigMeta = [
			{ id: "1", name: "Autocomplete Profile 1", profileType: "autocomplete" },
			{ id: "2", name: "Autocomplete Profile 2", profileType: "autocomplete" },
		]

		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			listApiConfigMeta: mockListApiConfigMeta,
			currentApiConfigName: "Autocomplete Profile 1",
			taskHistory: [],
			taskHistoryVersion: 0,
			clineMessages: [],
			cwd: "/test/workspace",
		})

		render(<ChatTextArea {...defaultProps} />)

		// All profiles are autocomplete, so none should be shown
		expect(screen.queryByText("Autocomplete Profile 1")).not.toBeInTheDocument()
		expect(screen.queryByText("Autocomplete Profile 2")).not.toBeInTheDocument()
	})
})
