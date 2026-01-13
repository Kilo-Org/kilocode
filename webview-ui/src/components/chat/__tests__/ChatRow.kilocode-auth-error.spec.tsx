import React from "react"
import { render, screen, fireEvent } from "@src/utils/test-utils"
import { ChatRowContent } from "../ChatRow"
import { vscode } from "@src/utils/vscode"

// Create a variable to hold the mock state
let mockExtensionState: any = {}

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:error": "Error",
				"kilocode:settings.provider.login": "Login",
			}
			return map[key] || key
		},
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock vscode postMessage
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock CodeBlock (avoid ESM/highlighter costs)
vi.mock("@src/components/common/CodeBlock", () => ({
	default: () => null,
}))

// Mock useSelectedModel hook
vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({ info: undefined }),
}))

function renderChatRow(message: any, apiConfiguration: any = {}) {
	// Update the mock state before rendering
	mockExtensionState = {
		apiConfiguration,
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: undefined,
		mode: "code",
		clineMessages: [],
		showTimestamps: false,
		hideCostBelowThreshold: 0,
	}

	return render(
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
		/>,
	)
}

describe("ChatRow - KiloCode auth error login button", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("shows login button for KiloCode auth error", () => {
		const message: any = {
			type: "say",
			say: "error",
			ts: Date.now(),
			text: "Cannot complete request, make sure you are connected and logged in with the selected provider.\n\nKiloCode token + baseUrl is required to fetch models",
		}

		renderChatRow(message, { apiProvider: "kilocode" })

		expect(screen.getByText("Login")).toBeInTheDocument()
	})

	it("does not show login button for non-KiloCode provider", () => {
		const message: any = {
			type: "say",
			say: "error",
			ts: Date.now(),
			text: "Cannot complete request, make sure you are connected and logged in with the selected provider.\n\nKiloCode token + baseUrl is required to fetch models",
		}

		renderChatRow(message, { apiProvider: "openai" })

		expect(screen.queryByText("Login")).not.toBeInTheDocument()
	})

	it("does not show login button for non-auth errors", () => {
		const message: any = {
			type: "say",
			say: "error",
			ts: Date.now(),
			text: "Some other error message",
		}

		renderChatRow(message, { apiProvider: "kilocode" })

		expect(screen.queryByText("Login")).not.toBeInTheDocument()
	})

	it("navigates to auth tab when login button is clicked", () => {
		const message: any = {
			type: "say",
			say: "error",
			ts: Date.now(),
			text: "Cannot complete request, make sure you are connected and logged in with the selected provider.\n\nKiloCode token + baseUrl is required to fetch models",
		}

		renderChatRow(message, { apiProvider: "kilocode" })

		const loginButton = screen.getByText("Login")
		fireEvent.click(loginButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "switchTab",
			tab: "auth",
			values: { returnTo: "chat" },
		})
	})
})
