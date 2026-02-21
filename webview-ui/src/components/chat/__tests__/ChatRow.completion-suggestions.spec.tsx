// kilocode_change - new file
import React from "react"
import { render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock CodeBlock (avoid ESM/highlighter costs)
vi.mock("@src/components/common/CodeBlock", () => ({
	default: () => null,
}))

const queryClient = new QueryClient()

function renderChatRow(message: any, props: Partial<React.ComponentProps<typeof ChatRowContent>> = {}) {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={props.onSuggestionClick ?? (() => {})}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
					{...props}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatRow - completion suggestions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders completion suggestions when completion_result ask contains suggestions", () => {
		const suggestions = [{ answer: "Start code review", mode: "review" }]

		const message = {
			type: "ask",
			ask: "completion_result",
			ts: Date.now(),
			partial: false,
			text: JSON.stringify({ suggest: suggestions }),
		}

		renderChatRow(message)

		expect(screen.getByText("Start code review")).toBeInTheDocument()
	})

	it("does not render suggestions when completion_result ask has no text", () => {
		const message = {
			type: "ask",
			ask: "completion_result",
			ts: Date.now(),
			partial: false,
			text: "",
		}

		const { container } = renderChatRow(message)

		// The component should not render any suggestion buttons
		expect(container.querySelector("button")).toBeNull()
	})

	it("does not render suggestions when completion_result ask text has no suggest field", () => {
		const message = {
			type: "ask",
			ask: "completion_result",
			ts: Date.now(),
			partial: false,
			text: JSON.stringify({}),
		}

		const { container } = renderChatRow(message)

		expect(container.querySelector("button")).toBeNull()
	})

	it("displays mode badge on suggestions with a mode", () => {
		const suggestions = [{ answer: "Start code review", mode: "review" }]

		const message = {
			type: "ask",
			ask: "completion_result",
			ts: Date.now(),
			partial: false,
			text: JSON.stringify({ suggest: suggestions }),
		}

		renderChatRow(message)

		expect(screen.getByText("review")).toBeInTheDocument()
	})

	it("calls onSuggestionClick when a suggestion button is clicked", () => {
		const mockOnSuggestionClick = vi.fn()
		const suggestions = [{ answer: "Start code review", mode: "review" }]

		const message = {
			type: "ask",
			ask: "completion_result",
			ts: Date.now(),
			partial: false,
			text: JSON.stringify({ suggest: suggestions }),
		}

		renderChatRow(message, { onSuggestionClick: mockOnSuggestionClick })

		const button = screen.getByText("Start code review")
		button.click()

		expect(mockOnSuggestionClick).toHaveBeenCalledWith(
			expect.objectContaining({ answer: "Start code review", mode: "review" }),
			expect.anything(),
		)
	})
})
