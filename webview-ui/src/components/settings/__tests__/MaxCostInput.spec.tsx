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

	it("calls onValueChange when input value changes", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "10.25" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(10.25)
	})

	it("calls onValueChange with undefined when input is cleared", () => {
		render(<MaxCostInput allowedMaxCost={5.0} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(undefined)
	})

	it("handles decimal input correctly", () => {
		render(<MaxCostInput allowedMaxCost={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "2.99" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(2.99)
	})
})
