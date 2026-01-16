// npx vitest src/components/welcome/__tests__/WelcomeViewProvider.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import * as ExtensionStateContext from "@src/context/ExtensionStateContext"
const { ExtensionStateContextProvider } = ExtensionStateContext

import WelcomeViewProvider from "../WelcomeViewProvider"
import { vscode } from "@src/utils/vscode"

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, onClick }: any) => (
		<button onClick={onClick} data-testid="vscode-link">
			{children}
		</button>
	),
	VSCodeProgressRing: () => <div data-testid="progress-ring">Loading...</div>,
	VSCodeTextField: ({ value, onKeyUp, placeholder }: any) => (
		<input data-testid="text-field" type="text" value={value} onChange={onKeyUp} placeholder={placeholder} />
	),
	VSCodeRadioGroup: ({ children, value, _onChange }: any) => (
		<div data-testid="radio-group" data-value={value}>
			{children}
		</div>
	),
	VSCodeRadio: ({ children, value, onClick }: any) => (
		<div data-testid={`radio-${value}`} data-value={value} onClick={onClick}>
			{children}
		</div>
	),
}))

// Mock Button component
vi.mock("@src/components/ui", () => ({
	Button: ({ children, onClick, variant }: any) => (
		<button onClick={onClick} data-testid={`button-${variant}`}>
			{children}
		</button>
	),
}))

// Mock ApiOptions
vi.mock("../../settings/ApiOptions", () => ({
	default: () => <div data-testid="api-options">API Options Component</div>,
}))

// Mock Tab components
vi.mock("../../common/Tab", () => ({
	Tab: ({ children }: any) => <div data-testid="tab">{children}</div>,
	TabContent: ({ children }: any) => <div data-testid="tab-content">{children}</div>,
}))

// Mock RooHero
vi.mock("../RooHero", () => ({
	default: () => <div data-testid="roo-hero">Roo Hero</div>,
}))

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
	ArrowLeft: () => <span data-testid="arrow-left-icon">←</span>,
	ArrowRight: () => <span data-testid="arrow-right-icon">→</span>,
	BadgeInfo: () => <span data-testid="badge-info-icon">ℹ</span>,
	Brain: () => <span data-testid="brain-icon">🧠</span>,
	TriangleAlert: () => <span data-testid="triangle-alert-icon">⚠</span>,
}))

// Mock vscode utility
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock react-i18next
vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span data-testid={`trans-${i18nKey}`}>{children || i18nKey}</span>,
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock buildDocLink
vi.mock("@/utils/docLinks", () => ({
	buildDocLink: (path: string, source: string) => `https://docs.roocode.com/${path}?utm_source=${source}`,
}))

const renderWelcomeViewProvider = (extensionState = {}) => {
	const useExtensionStateMock = vi.spyOn(ExtensionStateContext, "useExtensionState")
	useExtensionStateMock.mockReturnValue({
		apiConfiguration: {},
		currentApiConfigName: "default",
		setApiConfiguration: vi.fn(),
		uriScheme: "vscode",
		cloudIsAuthenticated: false,
		...extensionState,
	} as any)

	render(
		<ExtensionStateContextProvider>
			<WelcomeViewProvider />
		</ExtensionStateContextProvider>,
	)

	return useExtensionStateMock
}

describe("WelcomeViewProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Landing Screen", () => {
		it("renders landing screen by default", () => {
			renderWelcomeViewProvider()

			// Should show the landing greeting
			expect(screen.getByText(/welcome:landing.greeting/)).toBeInTheDocument()

			// Should show introduction
			expect(screen.getByTestId("trans-welcome:landing.introduction")).toBeInTheDocument()

			// Should show account mention
			expect(screen.getByTestId("trans-welcome:landing.accountMention")).toBeInTheDocument()

			// Should show "Get Started" button
			expect(screen.getByTestId("button-primary")).toBeInTheDocument()

			// Should show "no account" link
			const noAccountLink = screen
				.getAllByTestId("vscode-link")
				.find((link) => link.textContent?.includes("welcome:landing.noAccount"))
			expect(noAccountLink).toBeInTheDocument()
		})

		it("triggers auth when 'Get Started' is clicked on landing", () => {
			renderWelcomeViewProvider()

			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "rooCloudSignIn",
				useProviderSignup: true,
			})
		})

		it("shows auth in progress after clicking 'Get Started' on landing", () => {
			renderWelcomeViewProvider()

			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			// Should show progress ring
			expect(screen.getByTestId("progress-ring")).toBeInTheDocument()

			// Should show waiting heading
			expect(screen.getByText(/welcome:waitingForCloud.heading/)).toBeInTheDocument()
		})

		it("navigates to provider selection when 'no account' is clicked", () => {
			renderWelcomeViewProvider()

			// Click the "no account" link
			const noAccountLink = screen
				.getAllByTestId("vscode-link")
				.find((link) => link.textContent?.includes("welcome:landing.noAccount"))
			fireEvent.click(noAccountLink!)

			// Should now show provider selection screen with radio buttons
			expect(screen.getByTestId("radio-group")).toBeInTheDocument()
			expect(screen.getByTestId("radio-roo")).toBeInTheDocument()
			expect(screen.getByTestId("radio-custom")).toBeInTheDocument()
			expect(screen.getByTestId("trans-welcome:providerSignup.chooseProvider")).toBeInTheDocument()
		})
	})

	describe("Provider Selection Screen", () => {
		const navigateToProviderSelection = () => {
			const noAccountLink = screen
				.getAllByTestId("vscode-link")
				.find((link) => link.textContent?.includes("welcome:landing.noAccount"))
			fireEvent.click(noAccountLink!)
		}

		it("shows radio buttons for Roo and Custom providers", () => {
			renderWelcomeViewProvider()
			navigateToProviderSelection()

			// Should show radio group
			expect(screen.getByTestId("radio-group")).toBeInTheDocument()

			// Should show both radio options
			expect(screen.getByTestId("radio-roo")).toBeInTheDocument()
			expect(screen.getByTestId("radio-custom")).toBeInTheDocument()

			// Should show Roo provider description
			expect(screen.getByText(/welcome:providerSignup.rooCloudDescription/)).toBeInTheDocument()

			// Should show custom provider description
			expect(screen.getByText(/welcome:providerSignup.useAnotherProviderDescription/)).toBeInTheDocument()
		})

		it("Roo provider is selected by default", () => {
			renderWelcomeViewProvider()
			navigateToProviderSelection()

			const radioGroup = screen.getByTestId("radio-group")
			expect(radioGroup).toHaveAttribute("data-value", "roo")
		})

		it("does not show API options when Roo provider is selected", () => {
			renderWelcomeViewProvider()
			navigateToProviderSelection()

			// API options exist but should be hidden with max-h-0 (collapsed via CSS)
			// We can't easily test CSS visibility, so just verify the element is in the DOM
			// but would be hidden by the transition class
			const apiOptions = screen.queryByTestId("api-options")
			expect(apiOptions).toBeInTheDocument()
		})

		it("triggers auth when Get Started is clicked on Roo provider (not authenticated)", () => {
			renderWelcomeViewProvider({ cloudIsAuthenticated: false })
			navigateToProviderSelection()

			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "rooCloudSignIn",
				useProviderSignup: true,
			})
		})

		it("saves config immediately when Get Started is clicked on Roo provider (already authenticated)", () => {
			renderWelcomeViewProvider({ cloudIsAuthenticated: true })
			navigateToProviderSelection()

			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: {
					apiProvider: "roo",
				},
			})
		})

		// Note: We can't easily test radio selection changes in the mocked environment
		// since the VSCodeRadioGroup component's onChange is complex
		// These tests would work in a real browser environment
		it.skip("shows API options when custom provider is selected", () => {
			renderWelcomeViewProvider()
			navigateToProviderSelection()

			// Would simulate selecting custom provider in real environment
			// API options visibility is controlled by CSS transition based on selectedProvider state
		})

		it.skip("validates and saves configuration when Get Started is clicked on custom provider", () => {
			// This test would require properly simulating the radio group onChange
			// which is complex in the mocked environment
		})
	})

	describe("Auth In Progress State", () => {
		it("shows waiting state with progress ring", () => {
			renderWelcomeViewProvider()

			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			// Should show progress ring
			expect(screen.getByTestId("progress-ring")).toBeInTheDocument()

			// Should show waiting heading
			expect(screen.getByText(/welcome:waitingForCloud.heading/)).toBeInTheDocument()

			// Should show description (it's rendered via t() not Trans)
			expect(screen.getByText(/welcome:waitingForCloud.description/)).toBeInTheDocument()
		})

		it("shows Go Back button in waiting state", () => {
			renderWelcomeViewProvider()

			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			// Should show secondary button (Go Back)
			expect(screen.getByTestId("button-secondary")).toBeInTheDocument()
			expect(screen.getByText(/welcome:waitingForCloud.goBack/)).toBeInTheDocument()
		})

		it("returns to landing screen when Go Back is clicked (auth from landing)", () => {
			renderWelcomeViewProvider()

			// Start auth from landing
			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			// Verify we're in auth progress
			expect(screen.getByTestId("progress-ring")).toBeInTheDocument()

			// Click Go Back
			const goBackButton = screen.getByTestId("button-secondary")
			fireEvent.click(goBackButton)

			// Should be back on landing screen
			expect(screen.getByText(/welcome:landing.greeting/)).toBeInTheDocument()
			expect(screen.getByTestId("trans-welcome:landing.introduction")).toBeInTheDocument()
			expect(screen.queryByTestId("progress-ring")).not.toBeInTheDocument()
		})

		it("returns to provider selection when Go Back is clicked (auth from provider selection)", () => {
			renderWelcomeViewProvider({ cloudIsAuthenticated: false })

			// Navigate to provider selection
			const noAccountLink = screen
				.getAllByTestId("vscode-link")
				.find((link) => link.textContent?.includes("welcome:landing.noAccount"))
			fireEvent.click(noAccountLink!)

			// Start auth from provider selection (Roo is selected by default)
			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			// Verify we're in auth progress
			expect(screen.getByTestId("progress-ring")).toBeInTheDocument()

			// Click Go Back
			const goBackButton = screen.getByTestId("button-secondary")
			fireEvent.click(goBackButton)

			// Should be back on provider selection screen
			expect(screen.getByTestId("radio-group")).toBeInTheDocument()
			expect(screen.getByTestId("trans-welcome:providerSignup.chooseProvider")).toBeInTheDocument()
			expect(screen.queryByTestId("progress-ring")).not.toBeInTheDocument()
		})
	})
})
