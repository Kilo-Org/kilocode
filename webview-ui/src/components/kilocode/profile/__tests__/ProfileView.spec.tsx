import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"
import ProfileView from "../ProfileView"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { act } from "react"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
	},
}))

const mockExtensionState = {
	apiConfiguration: {
		kilocodeToken: "test-token",
		kilocodeOrganizationId: undefined as string | undefined,
	},
	currentApiConfigName: "Default",
	uriScheme: "vscode",
	uiKind: 1,
}

describe("ProfileView", () => {
	const mockOnDone = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	function renderProfileView(extensionState = mockExtensionState) {
		return render(
			<ExtensionStateContext.Provider value={extensionState as any}>
				<ProfileView onDone={mockOnDone} />
			</ExtensionStateContext.Provider>,
		)
	}

	function simulateProfileDataResponse(
		profileData: {
			user?: { name?: string; email?: string; image?: string }
			organizations?: any[]
		} | null,
	) {
		const message = {
			data: {
				type: "profileDataResponse",
				payload: {
					success: profileData !== null,
					data: profileData,
					error: profileData === null ? "Error" : undefined,
				},
			},
		}
		act(() => {
			window.dispatchEvent(new MessageEvent("message", message))
		})
	}

	function simulateBalanceDataResponse(balance: number | null) {
		const message = {
			data: {
				type: "balanceDataResponse",
				payload: {
					success: balance !== null,
					data: { balance },
					error: balance === null ? "Error" : undefined,
				},
			},
		}
		act(() => {
			window.dispatchEvent(new MessageEvent("message", message))
		})
	}

	function simulateKiloPassStateResponse(
		subscription: {
			tier: "tier_19" | "tier_49" | "tier_199"
			cadence: "monthly" | "yearly"
			status: string
			cancelAtPeriodEnd: boolean
			currentStreakMonths: number
			nextYearlyIssueAt: string | null
			nextBonusCreditsUsd: number | null
			nextBillingAt: string | null
			currentPeriodBaseCreditsUsd: number
			currentPeriodUsageUsd: number
			currentPeriodBonusCreditsUsd: number | null
			isBonusUnlocked: boolean
			refillAt: string | null
		} | null,
	) {
		const message = {
			data: {
				type: "kiloPassStateResponse",
				payload: {
					success: true,
					data: { subscription },
				},
			},
		}
		act(() => {
			window.dispatchEvent(new MessageEvent("message", message))
		})
	}

	describe("Kilo Pass section", () => {
		test("does not show Kilo Pass section on organization/team accounts", async () => {
			const orgExtensionState = {
				...mockExtensionState,
				apiConfiguration: {
					...mockExtensionState.apiConfiguration,
					kilocodeOrganizationId: "org-123",
				},
			}

			renderProfileView(orgExtensionState)

			simulateProfileDataResponse({
				user: { name: "Test User", email: "test@example.com" },
				organizations: [{ id: "org-123", name: "Test Org" }],
			})
			simulateBalanceDataResponse(10.0)
			simulateKiloPassStateResponse(null)

			await waitFor(() => {
				expect(screen.getByText("Test User")).toBeInTheDocument()
			})

			// Kilo Pass section should not be visible for organization accounts
			expect(screen.queryByText("kilocode:profile.kiloPass.title")).not.toBeInTheDocument()
			expect(screen.queryByText("kilocode:profile.kiloPass.yourSubscription")).not.toBeInTheDocument()
		})
	})

	describe("Top-up credit packages", () => {
		test('calls shopBuyCredits when "Buy Now" button is clicked', async () => {
			renderProfileView()

			simulateProfileDataResponse({
				user: { name: "Test User", email: "test@example.com" },
				organizations: [],
			})
			simulateBalanceDataResponse(10.0)
			simulateKiloPassStateResponse(null)

			await waitFor(() => {
				expect(screen.getAllByText("kilocode:profile.shop.action").length).toBeGreaterThan(0)
			})

			const buyNowButtons = screen.getAllByText("kilocode:profile.shop.action")
			fireEvent.click(buyNowButtons[0])

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "shopBuyCredits",
				values: {
					credits: 20,
					uriScheme: "vscode",
					uiKind: 1,
				},
			})
		})
	})
})
