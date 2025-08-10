import React from "react"
import { render, screen } from "@/utils/test-utils"
import { describe, it, expect, vi } from "vitest"
import KiloTaskHeader from "../KiloTaskHeader"
import type { TaskHeaderProps } from "../KiloTaskHeader"

// Mock the translation hook
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"chat:task.condenseContext": "Condense Context",
				"chat:task.closeAndStart": "Close and Start New Task",
				"chat:task.title": "Task",
				"chat:task.contextWindow": "Context Window",
				"chat:task.tokens": "Tokens",
				"chat:task.cache": "Cache",
				"chat:task.apiCost": "API Cost",
			}
			return translations[key] || key
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

// Mock other dependencies
vi.mock("react-use", () => ({
	useWindowSize: () => ({ width: 1200, height: 800 }),
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		showTaskTimeline: true,
		apiConfiguration: {},
		currentTaskItem: { id: "test-task" },
		customModes: [],
	}),
}))

vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({
		id: "test-model",
		info: { contextWindow: 4096 },
	}),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock child components
vi.mock("../common/Thumbnails", () => ({
	default: () => <div data-testid="thumbnails" />,
}))

vi.mock("../chat/TaskActions", () => ({
	TaskActions: () => <div data-testid="task-actions" />,
}))

vi.mock("../chat/ShareButton", () => ({
	ShareButton: () => <div data-testid="share-button" />,
}))

vi.mock("../chat/ContextWindowProgress", () => ({
	ContextWindowProgress: () => <div data-testid="context-window-progress" />,
}))

vi.mock("../chat/TaskTimeline", () => ({
	TaskTimeline: () => <div data-testid="task-timeline" />,
}))

vi.mock("../chat/TodoListDisplay", () => ({
	TodoListDisplay: () => <div data-testid="todo-list-display" />,
}))

const mockProps: TaskHeaderProps = {
	task: {
		text: "Test task description",
		images: [],
		type: "ask",
	} as any,
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.05,
	contextTokens: 150,
	buttonsDisabled: false,
	handleCondenseContext: vi.fn(),
	onClose: vi.fn(),
	groupedMessages: [],
	onMessageClick: vi.fn(),
	isTaskActive: true,
	todos: [],
}

describe("KiloTaskHeader Accessibility", () => {
	it("should have aria-label and title attributes on condense context button", () => {
		render(<KiloTaskHeader {...mockProps} />)

		// Find the condense context button by its aria-label
		const condenseButton = screen.getByLabelText("Condense Context")

		expect(condenseButton).toBeInTheDocument()
		expect(condenseButton).toHaveAttribute("aria-label", "Condense Context")
		expect(condenseButton).toHaveAttribute("title", "Condense Context")
	})

	it("should have aria-label and title attributes on close button", () => {
		render(<KiloTaskHeader {...mockProps} />)

		// Find the close button by its aria-label
		const closeButton = screen.getByLabelText("Close and Start New Task")

		expect(closeButton).toBeInTheDocument()
		expect(closeButton).toHaveAttribute("aria-label", "Close and Start New Task")
		expect(closeButton).toHaveAttribute("title", "Close and Start New Task")
	})

	it("should have proper button roles for screen readers", () => {
		render(<KiloTaskHeader {...mockProps} />)

		const condenseButton = screen.getByLabelText("Condense Context")
		const closeButton = screen.getByLabelText("Close and Start New Task")

		// HTML button elements have implicit role="button", so we check the tagName
		expect(condenseButton.tagName).toBe("BUTTON")
		expect(closeButton.tagName).toBe("BUTTON")
	})

	it("should handle disabled state properly for accessibility", () => {
		const disabledProps = { ...mockProps, buttonsDisabled: true }
		render(<KiloTaskHeader {...disabledProps} />)

		const condenseButton = screen.getByLabelText("Condense Context")

		expect(condenseButton).toBeDisabled()
		expect(condenseButton).toHaveAttribute("aria-label", "Condense Context")
	})

	it("should maintain accessibility when task is expanded", () => {
		render(<KiloTaskHeader {...mockProps} />)

		// Verify buttons are accessible (no need to expand since buttons are always visible)
		const condenseButton = screen.getByLabelText("Condense Context")
		const closeButton = screen.getByLabelText("Close and Start New Task")

		expect(condenseButton).toHaveAttribute("aria-label", "Condense Context")
		expect(condenseButton).toHaveAttribute("title", "Condense Context")
		expect(closeButton).toHaveAttribute("aria-label", "Close and Start New Task")
		expect(closeButton).toHaveAttribute("title", "Close and Start New Task")
	})
})
