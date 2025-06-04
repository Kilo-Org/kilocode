import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import EditableCodeBlock from "../EditableCodeBlock"

// Mock the highlighter module
jest.mock("@src/utils/highlighter", () => ({
	getHighlighter: jest.fn().mockImplementation(() => ({
		codeToHtml: jest.fn().mockImplementation((code, options) => {
			return Promise.resolve(`<pre><code class="hljs language-${options.lang}">${code}</code></pre>`)
		}),
	})),
	isLanguageLoaded: jest.fn().mockReturnValue(true),
	normalizeLanguage: jest.fn().mockImplementation((lang) => lang),
}))

describe("EditableCodeBlock", () => {
	it("renders with default props", () => {
		const onChange = jest.fn()
		render(<EditableCodeBlock value="" onChange={onChange} language="javascript" />)

		// Check if textarea exists
		const textarea = screen.getByRole("textbox")
		expect(textarea).toBeInTheDocument()
	})

	it("handles input changes", () => {
		const onChange = jest.fn()
		render(<EditableCodeBlock value="" onChange={onChange} language="javascript" />)

		const textarea = screen.getByRole("textbox")
		fireEvent.change(textarea, { target: { value: "const x = 1;" } })

		expect(onChange).toHaveBeenCalledWith("const x = 1;")
	})

	it("handles tab key for indentation", () => {
		const onChange = jest.fn()
		render(<EditableCodeBlock value="function test() {" onChange={onChange} language="javascript" />)

		const textarea = screen.getByRole("textbox")
		fireEvent.keyDown(textarea, { key: "Tab" })

		expect(onChange).toHaveBeenCalledWith("function test() {    ")
	})

	it("displays placeholder when value is empty", () => {
		const onChange = jest.fn()
		const placeholder = "Custom placeholder"
		render(<EditableCodeBlock value="" onChange={onChange} language="javascript" placeholder={placeholder} />)

		expect(screen.getByText(placeholder)).toBeInTheDocument()
	})
})
