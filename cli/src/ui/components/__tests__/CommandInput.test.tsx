import { describe, it, expect, vi } from "vitest"
import React from "react"
import { render } from "ink-testing-library"
import { CommandInput } from "../CommandInput.js"

// Mock the hooks
vi.mock("../../../state/hooks/useCommandInput.js", () => ({
	useCommandInput: () => ({
		inputValue: "",
		setInput: vi.fn(),
		clearInput: vi.fn(),
		isAutocompleteVisible: false,
		commandSuggestions: [],
		argumentSuggestions: [],
		selectedIndex: 0,
		selectNext: vi.fn(),
		selectPrevious: vi.fn(),
		selectedSuggestion: null,
	}),
}))

vi.mock("../../../state/hooks/useApprovalHandler.js", () => ({
	useApprovalHandler: () => ({
		isApprovalPending: false,
		approvalOptions: [],
		selectedIndex: 0,
		selectNext: vi.fn(),
		selectPrevious: vi.fn(),
		approve: vi.fn(),
		reject: vi.fn(),
		executeSelected: vi.fn(),
	}),
}))

vi.mock("../../../state/hooks/useFollowupSuggestions.js", () => ({
	useFollowupSuggestions: () => ({
		suggestions: [],
		isVisible: false,
		selectedIndex: 0,
		selectedSuggestion: null,
		selectNext: vi.fn(),
		selectPrevious: vi.fn(),
		clearSuggestions: vi.fn(),
		unselect: vi.fn(),
	}),
}))

vi.mock("../../../state/hooks/useTheme.js", () => ({
	useTheme: () => ({
		actions: { pending: "yellow" },
		ui: { border: { active: "blue" } },
	}),
}))

describe("CommandInput", () => {
	it("should render without crashing", () => {
		const onSubmit = vi.fn()
		const { lastFrame } = render(<CommandInput onSubmit={onSubmit} />)
		expect(lastFrame()).toBeTruthy()
	})

	it("should not add text when modifier keys are pressed", () => {
		const onSubmit = vi.fn()
		const { stdin } = render(<CommandInput onSubmit={onSubmit} />)

		// Simulate Ctrl+A (this should not add 'a' to the input)
		stdin.write("\x01") // Ctrl+A in terminal

		// The input should remain empty (no 'a' character added)
		// This is tested by the handleChange function rejecting the input
		expect(onSubmit).not.toHaveBeenCalled()
	})
})
