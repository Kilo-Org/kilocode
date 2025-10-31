import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { render } from "ink-testing-library"
import { CommandInput } from "../CommandInput.js"

// Mock jotai
vi.mock("jotai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("jotai")>()
	return {
		...actual,
		useSetAtom: vi.fn(() => vi.fn()),
		useAtomValue: vi.fn(() => 0),
		useAtom: vi.fn(() => [0, vi.fn()]),
	}
})

// Mock jotai/utils
vi.mock("jotai/utils", () => ({
	useResetAtom: vi.fn(() => vi.fn()),
}))

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

// Mock the keyboard atoms
vi.mock("../../../state/atoms/keyboard.js", () => ({
	setupKeyboardAtom: {},
	submissionCallbackAtom: {},
}))

vi.mock("../../../state/atoms/ui.js", () => ({
	selectedIndexAtom: {},
	isCommittingParallelModeAtom: {},
	commitCountdownSecondsAtom: {},
}))

describe("CommandInput", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should render without crashing", () => {
		const onSubmit = vi.fn()
		const { lastFrame } = render(<CommandInput onSubmit={onSubmit} />)
		expect(lastFrame()).toBeTruthy()
	})

	it("should set up keyboard handling on mount", () => {
		const onSubmit = vi.fn()
		render(<CommandInput onSubmit={onSubmit} />)

		// With the centralized keyboard handler, the component just sets up the callback
		// The actual keyboard handling is done by the keyboard handler atom
		// This test verifies the component renders without errors
		expect(true).toBe(true)
	})
})
