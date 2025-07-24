// kilocode_change - new file
import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FormattedTextField, unlimitedIntegerFormatter } from "../FormattedTextField"

// Mock VSCodeTextField to render as regular HTML input for testing
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ value, onInput, placeholder, "data-testid": dataTestId }: any) => (
		<input
			type="text"
			value={value}
			onChange={(e) => onInput({ target: { value: e.target.value } })}
			placeholder={placeholder}
			data-testid={dataTestId}
		/>
	),
}))

describe("FormattedTextField", () => {
	describe("unlimitedIntegerFormatter", () => {
		it("should parse valid integers", () => {
			expect(unlimitedIntegerFormatter.parse("123")).toBe(123)
			expect(unlimitedIntegerFormatter.parse("1")).toBe(1)
		})

		it("should return undefined for empty input (unlimited)", () => {
			expect(unlimitedIntegerFormatter.parse("")).toBeUndefined()
			expect(unlimitedIntegerFormatter.parse("   ")).toBeUndefined()
		})

		it("should return undefined for invalid inputs", () => {
			expect(unlimitedIntegerFormatter.parse("0")).toBeUndefined()
			expect(unlimitedIntegerFormatter.parse("-5")).toBeUndefined()
			expect(unlimitedIntegerFormatter.parse("abc")).toBeUndefined()
		})

		it("should format numbers correctly, treating undefined/Infinity as empty", () => {
			expect(unlimitedIntegerFormatter.format(123)).toBe("123")
			expect(unlimitedIntegerFormatter.format(undefined)).toBe("")
			expect(unlimitedIntegerFormatter.format(Infinity)).toBe("")
		})

		it("should filter non-numeric characters", () => {
			expect(unlimitedIntegerFormatter.filter?.("123abc")).toBe("123")
			expect(unlimitedIntegerFormatter.filter?.("a1b2c3")).toBe("123")
		})
	})

	describe("FormattedTextField component", () => {
		it("should render with correct initial value", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={123}
					onValueChange={mockOnChange}
					formatter={unlimitedIntegerFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input") as HTMLInputElement
			expect(input.value).toBe("123")
		})

		it("should render as HTML input (mock verification)", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={123}
					onValueChange={mockOnChange}
					formatter={unlimitedIntegerFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input")
			// Verify it's an HTML input element (our mock)
			expect(input.tagName).toBe("INPUT")
			expect(input).toHaveAttribute("type", "text")
		})

		it("should call onValueChange when input changes", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={undefined}
					onValueChange={mockOnChange}
					formatter={unlimitedIntegerFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input")

			// Use fireEvent.change to trigger the onChange event in our mock
			fireEvent.change(input, { target: { value: "456" } })

			expect(mockOnChange).toHaveBeenCalledWith(456)
		})

		it("should apply input filtering", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={undefined}
					onValueChange={mockOnChange}
					formatter={unlimitedIntegerFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input") as HTMLInputElement

			// Use fireEvent.change to trigger the onChange event in our mock
			fireEvent.change(input, { target: { value: "123abc" } })

			// The filter should have removed non-numeric characters
			expect(mockOnChange).toHaveBeenCalledWith(123)
		})
	})
})
