// kilocode_change - new file
import { defaultModeSlug } from "@roo/modes"

import React from "react"

import { render, fireEvent, screen } from "@src/utils/test-utils"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useQuery } from "@tanstack/react-query"

import { ChatTextArea } from "../ChatTextArea"

vi.mock("react-textarea-autosize", () => ({
	default: (props: any) => <textarea {...props} />,
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext")

// Mock only useQuery, but keep the real QueryClient/QueryClientProvider used by test utils
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>()
	return {
		...actual,
		useQuery: vi.fn(),
	}
})

vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: vi.fn(() => ({
		id: "mock-model-id",
		provider: "mock-provider",
	})),
}))

describe("ChatTextArea - slash command Tab guard", () => {
	const setInputValue = vi.fn()
	const defaultProps = {
		inputValue: "/init",
		setInputValue,
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
		;(useQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { historyItems: [] } })
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			listApiConfigMeta: [],
			currentApiConfigName: "",
			pinnedApiConfigs: {},
			taskHistory: [],
			taskHistoryVersion: 0,
			clineMessages: [],
			cwd: "/test/workspace",
			ghostServiceSettings: {
				enableChatAutocomplete: true,
			},
			experiments: {},
		})
	})

	it("should not transform /init into mention behavior when pressing Tab in a slash token", () => {
		render(<ChatTextArea {...defaultProps} />)
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement

		// Put cursor inside the first token (end of "/init")
		textarea.focus()
		textarea.setSelectionRange(defaultProps.inputValue.length, defaultProps.inputValue.length)

		fireEvent.keyDown(textarea, { key: "Tab" })

		// The regression we are preventing is Tab falling through to ghost/mention handling
		// which caused setInputValue to be called with an '@' inserted (e.g. "/init@ ").
		expect(setInputValue).not.toHaveBeenCalledWith(expect.stringContaining("@"))
	})
})
