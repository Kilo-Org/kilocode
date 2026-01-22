import React from "react"

import { render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:apiRequest.rateLimitWait": "Rate limiting",
			}
			return map[key] ?? key
		},
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

const queryClient = new QueryClient()

function renderChatRow(message: any) {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatRow - rate limit wait", () => {
	it("renders a non-error progress row for api_req_rate_limit_wait", () => {
		const message: any = {
			type: "say",
			say: "api_req_rate_limit_wait",
			ts: Date.now(),
			partial: true,
			text: JSON.stringify({ seconds: 1 }),
		}

		renderChatRow(message)

		expect(screen.getByText("Rate limiting")).toBeInTheDocument()
		// Should show countdown, but should NOT show the error-details affordance.
		expect(screen.getByText("1s")).toBeInTheDocument()
		expect(screen.queryByText("Details")).toBeNull()
	})

	it("renders nothing when rate limit wait is complete", () => {
		const message: any = {
			type: "say",
			say: "api_req_rate_limit_wait",
			ts: Date.now(),
			partial: false,
			text: undefined,
		}

		const { container } = renderChatRow(message)

		// The row should be hidden when rate limiting is complete
		expect(screen.queryByText("Rate limiting")).toBeNull()
		// Nothing should be rendered
		expect(container.firstChild).toBeNull()
	})
})
