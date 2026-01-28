import { render, screen, waitFor } from "@/utils/test-utils"

import { OpenAICodexRateLimitDashboard } from "../OpenAICodexRateLimitDashboard"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, any>) => {
			switch (key) {
				case "settings:providers.openAiCodexRateLimits.title":
					return `Usage Limits for Codex${options?.planLabel ?? ""}`
				case "settings:providers.openAiCodexRateLimits.plan.withType":
					return ` (${options?.planType ?? ""})`
				case "settings:providers.openAiCodexRateLimits.plan.default":
					return ""
				case "settings:providers.openAiCodexRateLimits.window.fiveHour":
					return "5h limit"
				case "settings:providers.openAiCodexRateLimits.window.weekly":
					return "Weekly limit"
				case "settings:providers.openAiCodexRateLimits.usedPercent":
					return `${options?.percent ?? ""}% used`
				default:
					return key
			}
		},
	}),
}))

const { postMessageMock } = vi.hoisted(() => ({
	postMessageMock: vi.fn(),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: postMessageMock,
	},
}))

describe("OpenAICodexRateLimitDashboard", () => {
	beforeEach(() => {
		postMessageMock.mockClear()
	})

	it("hides when not authenticated", () => {
		const { container } = render(<OpenAICodexRateLimitDashboard isAuthenticated={false} />)
		expect(container.firstChild).toBeNull()
	})

	it("sends request message when authenticated", () => {
		render(<OpenAICodexRateLimitDashboard isAuthenticated={true} />)
		expect(postMessageMock).toHaveBeenCalledWith({ type: "requestOpenAiCodexRateLimits" })
	})

	it("renders usage values from payload", () => {
		render(<OpenAICodexRateLimitDashboard isAuthenticated={true} />)

		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "openAiCodexRateLimits",
					values: {
						primary: { usedPercent: 12.3, windowMinutes: 300, resetsAt: Date.now() + 60_000 },
						secondary: { usedPercent: 45.6, windowMinutes: 10080, resetsAt: Date.now() + 120_000 },
						credits: { hasCredits: true, unlimited: true },
						fetchedAt: Date.now(),
						planType: "pro",
					},
				},
			}),
		)

		return waitFor(() => {
			expect(screen.getByText(/Usage Limits for Codex \(pro\)/)).toBeInTheDocument()
			expect(screen.getByText(/5h limit/)).toBeInTheDocument()
			expect(screen.getByText(/Weekly limit/)).toBeInTheDocument()
			expect(screen.getByText(/12% used/)).toBeInTheDocument()
			expect(screen.getByText(/46% used/)).toBeInTheDocument()
		})
	})
})
