// kilocode_change - new file
import { render, screen, fireEvent } from "@testing-library/react"
import { vi } from "vitest"
import { MaxRequestsInput } from "../MaxRequestsInput"

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => {
		const translations: Record<string, string> = {
			"settings:autoApprove.apiRequestLimit.title": "Max API Requests",
			"settings:autoApprove.apiRequestLimit.unlimited": "Unlimited",
			"settings:autoApprove.apiRequestLimit.description": "Limit the number of API requests",
		}
		return { t: (key: string) => translations[key] || key }
	},
}))

describe("MaxRequestsInput", () => {
	const mockOnValueChange = vi.fn()

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
