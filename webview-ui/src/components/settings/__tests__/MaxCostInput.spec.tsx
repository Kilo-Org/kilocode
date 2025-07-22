import { render, screen, fireEvent } from "@testing-library/react"
import { vi } from "vitest"
import { MaxCostInput } from "../MaxCostInput"

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => {
		const translations: Record<string, string> = {
			"settings:autoApprove.apiCostLimit.title": "Max API Cost",
			"settings:autoApprove.apiCostLimit.unlimited": "Unlimited",
			"settings:autoApprove.apiCostLimit.description": "Limit the total API cost",
		}
		return { t: (key: string) => translations[key] || key }
	},
}))

describe("MaxCostInput", () => {
	const mockOnValueChange = vi.fn()

	beforeEach(() => {
		mockOnValueChange.mockClear()
	})

	it("shows empty input when allowedMaxCost is undefined", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		expect(input).toHaveValue("")
	})

	it("shows formatted cost value when allowedMaxCost is provided", () => {
		render(<MaxCostInput allowedMaxCost={5.5} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		expect(input).toHaveValue("5.5")
	})

	it("calls onValueChange when input loses focus", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "10.25" } })
		fireEvent.blur(input)

		expect(mockOnValueChange).toHaveBeenCalledWith(10.25)
	})

	it("calls onValueChange when Enter key is pressed", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "5.50" } })
		fireEvent.keyDown(input, { key: "Enter" })

		expect(mockOnValueChange).toHaveBeenCalledWith(5.5)
	})

	it("calls onValueChange with undefined when input is cleared and blurred", () => {
		render(<MaxCostInput allowedMaxCost={5.0} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "" } })
		fireEvent.blur(input)

		expect(mockOnValueChange).toHaveBeenCalledWith(undefined)
	})

	it("handles decimal input correctly on blur", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "2.99" } })
		fireEvent.blur(input)

		expect(mockOnValueChange).toHaveBeenCalledWith(2.99)
	})

	it("allows typing zero without immediate parsing", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "0" } })

		// Should not call onValueChange during typing
		expect(mockOnValueChange).not.toHaveBeenCalled()
		expect(input).toHaveValue("0")
	})

	it("accepts zero as a valid value on blur", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "0" } })
		fireEvent.blur(input)

		expect(mockOnValueChange).toHaveBeenCalledWith(0)
	})

	it("allows typing decimal values starting with zero", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "0.15" } })
		fireEvent.blur(input)

		expect(mockOnValueChange).toHaveBeenCalledWith(0.15)
	})
})
