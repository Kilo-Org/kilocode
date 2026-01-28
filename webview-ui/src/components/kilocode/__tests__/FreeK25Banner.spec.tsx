// kilocode_change - new file
import { render, screen, fireEvent } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { FreeK25Banner } from "../FreeK25Banner"

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"kilocode:freeK25Banner.new": "FREE:",
				"kilocode:freeK25Banner.message": "Try K2.5 - our most capable model, now free to use!",
			}
			return translations[key] || key
		},
	}),
}))

// Mock telemetry client
vi.mock("@/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
	},
}))

// Mock vscode
const mockPostMessage = vi.fn()
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

describe("FreeK25Banner", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the banner with correct text", () => {
		render(<FreeK25Banner />)

		expect(screen.getByText("FREE:")).toBeInTheDocument()
		expect(screen.getByText("Try K2.5 - our most capable model, now free to use!")).toBeInTheDocument()
	})

	it("opens browser when clicked", () => {
		render(<FreeK25Banner />)

		const button = screen.getByRole("button")
		fireEvent.click(button)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openInBrowser",
			url: "https://kilo.love/freek25",
		})
	})

	it("applies custom className when provided", () => {
		render(<FreeK25Banner className="custom-class" />)

		const button = screen.getByRole("button")
		expect(button).toHaveClass("custom-class")
	})
})
