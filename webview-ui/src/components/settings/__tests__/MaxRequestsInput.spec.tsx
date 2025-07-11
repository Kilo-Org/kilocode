// kilocode_change - new file
import { render, screen, fireEvent } from "@testing-library/react"
import { vi } from "vitest"
import { MaxRequestsInput } from "../MaxRequestsInput"

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

const translations: Record<string, string> = {
	"settings:autoApprove.apiRequestLimit.title": "Max API Requests",
	"settings:autoApprove.apiRequestLimit.unlimited": "Unlimited",
	"settings:autoApprove.apiRequestLimit.description": "Limit the number of API requests",
}
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => translations[key] || key,
	}),
	Trans: ({ i18nKey }: { i18nKey: string; children?: React.ReactNode }) => (
		<span>{translations[i18nKey] || i18nKey}</span>
	),
}))

describe("MaxRequestsInput", () => {
	const mockOnValueChange = vi.fn()

	it("renders with settings variant by default", () => {
		render(<MaxRequestsInput allowedMaxRequests={10} onValueChange={mockOnValueChange} />)

		expect(screen.getByText("Max API Requests")).toBeInTheDocument()
		expect(screen.getByText("Limit the number of API requests")).toBeInTheDocument()
		expect(screen.getByDisplayValue("10")).toBeInTheDocument()
	})

	it("renders with menu variant styling", () => {
		render(<MaxRequestsInput allowedMaxRequests={5} onValueChange={mockOnValueChange} variant="menu" />)

		expect(screen.getByText("Max API Requests")).toBeInTheDocument()
		expect(screen.getByText("Limit the number of API requests")).toBeInTheDocument()
		expect(screen.getByDisplayValue("5")).toBeInTheDocument()
	})

	it("shows empty input when allowedMaxRequests is undefined", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		expect(input).toHaveValue("")
	})

	it("shows empty input when allowedMaxRequests is Infinity", () => {
		render(<MaxRequestsInput allowedMaxRequests={Infinity} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		expect(input).toHaveValue("")
	})

	it("filters non-numeric input and calls onValueChange", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "abc123def" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(123)
	})

	it("calls onValueChange with undefined for invalid input", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "abc" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(undefined)
	})

	it("calls onValueChange with undefined for zero input", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "0" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(undefined)
	})
})
