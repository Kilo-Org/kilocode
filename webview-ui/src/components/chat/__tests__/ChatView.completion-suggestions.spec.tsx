// kilocode_change - new file
// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.completion-suggestions.spec.tsx

import React from "react"
import { render, waitFor, act } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { SuggestionItem } from "@roo-code/types"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps } from "../ChatView"

// Define minimal types needed for testing
interface ClineMessage {
	type: "say" | "ask"
	say?: string
	ask?: string
	ts: number
	text?: string
	partial?: boolean
}

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock use-sound hook
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => {
		return [vi.fn()]
	}),
}))

// Mock components that use ESM dependencies
vi.mock("../BrowserSessionRow", () => ({
	default: function MockBrowserSessionRow({ messages }: { messages: ClineMessage[] }) {
		return <div data-testid="browser-session">{JSON.stringify(messages)}</div>
	},
}))

// We need to capture onSuggestionClick to test suggestion handling
let capturedOnSuggestionClick: ((suggestion: SuggestionItem, event?: React.MouseEvent) => void) | undefined

vi.mock("../ChatRow", () => ({
	default: function MockChatRow({
		message,
		onSuggestionClick,
	}: {
		message: ClineMessage
		onSuggestionClick?: (suggestion: SuggestionItem, event?: React.MouseEvent) => void
	}) {
		// Capture the onSuggestionClick handler so tests can invoke it
		capturedOnSuggestionClick = onSuggestionClick
		return <div data-testid="chat-row">{JSON.stringify(message)}</div>
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

// Mock react-virtuoso to render items directly without virtualization
vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({
		data,
		itemContent,
	}: {
		data: ClineMessage[]
		itemContent: (index: number, item: ClineMessage) => React.ReactNode
	}) {
		return (
			<div data-testid="virtuoso-item-list">
				{data.map((item, index) => (
					<div key={item.ts} data-testid={`virtuoso-item-${index}`}>
						{itemContent(index, item)}
					</div>
				))}
			</div>
		)
	},
}))

vi.mock("../../common/VersionIndicator", () => ({
	default: vi.fn(() => null),
}))

vi.mock("../Announcement", () => ({
	default: () => null,
}))

vi.mock("@/components/common/DismissibleUpsell", () => ({
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("../QueuedMessages", () => ({
	QueuedMessages: () => null,
}))

vi.mock("@src/components/welcome/RooTips", () => ({
	default: () => null,
}))

vi.mock("@src/components/welcome/RooHero", () => ({
	default: () => null,
}))

vi.mock("../common/TelemetryBanner", () => ({
	default: () => null,
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

vi.mock("../ChatTextArea", () => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const mockReact = require("react")

	const ChatTextAreaComponent = mockReact.forwardRef(function MockChatTextArea(
		_props: any,
		ref: React.ForwardedRef<{ focus: () => void }>,
	) {
		mockReact.useImperativeHandle(ref, () => ({
			focus: vi.fn(),
		}))
		return <div data-testid="chat-textarea" />
	})

	return {
		default: ChatTextAreaComponent,
		ChatTextArea: ChatTextAreaComponent,
	}
})

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
		<button onClick={onClick}>{children}</button>
	),
	VSCodeTextField: () => <input />,
	VSCodeLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: Record<string, any>) => {
	window.postMessage(
		{
			type: "state",
			state: {
				version: "1.0.0",
				clineMessages: [],
				taskHistory: [],
				shouldShowAnnouncement: false,
				allowedCommands: [],
				alwaysAllowExecute: false,
				cloudIsAuthenticated: false,
				telemetrySetting: "enabled",
				...state,
			},
		},
		"*",
	)
}

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const queryClient = new QueryClient()

const renderChatView = (props: Partial<ChatViewProps> = {}) => {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatView {...defaultProps} {...props} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatView - Completion Suggestion Click Handling", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		capturedOnSuggestionClick = undefined
	})

	it("handles review suggestion by closing the ask and switching to review with reviewScope", async () => {
		renderChatView()

		// Hydrate state with a completed coding task
		await act(async () => {
			mockPostMessage({
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Coding task",
					},
					{
						type: "ask",
						ask: "completion_result",
						ts: Date.now(),
						text: JSON.stringify({
							suggest: [{ answer: "Start code review", mode: "review" }],
						}),
						partial: false,
					},
				],
			})
		})

		// Wait for ChatRow to be rendered
		await waitFor(() => {
			expect(capturedOnSuggestionClick).toBeDefined()
		})

		// Clear previous postMessage calls
		vi.mocked(vscode.postMessage).mockClear()

		// Simulate clicking "Start code review"
		act(() => {
			capturedOnSuggestionClick!({ answer: "Start code review", mode: "review" }, {
				shiftKey: false,
			} as React.MouseEvent)
		})

		// Should close the pending completion_result ask before switching modes
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "yesButtonClicked",
		})

		// Should switch mode to review with reviewScope to skip the dialog
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "mode",
			text: "review",
			reviewScope: "uncommitted",
		})

		// Should NOT send clearTask or newTask
		expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "clearTask" })
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "newTask" }))
	})
})
