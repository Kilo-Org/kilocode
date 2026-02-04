// npx vitest src/components/chat/__tests__/TaskHeader.spec.tsx

import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { ProviderSettings } from "@roo-code/types"

import TaskHeader, { TaskHeaderProps } from "../TaskHeader"

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key, // Simple mock that returns the key
	}),
	// Mock initReactI18next to prevent initialization errors in tests
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
}))

// Mock the vscode API - use vi.hoisted to ensure the mock is available when vi.mock is hoisted
const { mockPostMessage } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
}))
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

// Mock the VSCodeBadge component
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children }: { children: React.ReactNode }) => <div data-testid="vscode-badge">{children}</div>,
}))

// Create a variable to hold the mock state
let mockExtensionState: {
	apiConfiguration: ProviderSettings
	currentTaskItem: { id: string } | null
	clineMessages: any[]
} = {
	apiConfiguration: {
		apiProvider: "anthropic",
		apiKey: "test-api-key",
		apiModelId: "claude-3-opus-20240229",
	} as ProviderSettings,
	currentTaskItem: { id: "test-task-id" },
	clineMessages: [],
}

// Mock the ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

// Mock the useCloudUpsell hook
vi.mock("@src/hooks/useCloudUpsell", () => ({
	useCloudUpsell: () => ({
		isOpen: false,
		openUpsell: vi.fn(),
		closeUpsell: vi.fn(),
		handleConnect: vi.fn(),
	}),
}))

// Mock DismissibleUpsell component
vi.mock("@src/components/common/DismissibleUpsell", () => ({
	default: ({ children, ...props }: any) => (
		<div data-testid="dismissible-upsell" {...props}>
			{children}
		</div>
	),
}))

// Mock CloudUpsellDialog component
vi.mock("@src/components/cloud/CloudUpsellDialog", () => ({
	CloudUpsellDialog: () => null,
}))

// Mock findLastIndex from @roo/array
vi.mock("@roo/array", () => ({
	findLastIndex: (array: any[], predicate: (item: any) => boolean) => {
		for (let i = array.length - 1; i >= 0; i--) {
			if (predicate(array[i])) {
				return i
			}
		}
		return -1
	},
}))

// Create a variable to hold the mock model info for useSelectedModel
let mockModelInfo: { contextWindow: number; maxTokens: number } | undefined = undefined

// Mock useSelectedModel hook
vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({
		provider: "anthropic",
		id: "test-model",
		info: mockModelInfo,
		isLoading: false,
		isError: false,
	}),
}))

// Mock getModelMaxOutputTokens from @roo/api
let mockMaxOutputTokens = 0
vi.mock("@roo/api", () => ({
	getModelMaxOutputTokens: () => mockMaxOutputTokens,
}))

describe("TaskHeader", () => {
	const defaultProps: TaskHeaderProps = {
		task: { type: "say", ts: Date.now(), text: "Test task", images: [] },
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.05,
		contextTokens: 200,
		buttonsDisabled: false,
		handleCondenseContext: vi.fn(),
	}

	const queryClient = new QueryClient()

	const renderTaskHeader = (props: Partial<TaskHeaderProps> = {}) => {
		return render(
			<QueryClientProvider client={queryClient}>
				<TaskHeader {...defaultProps} {...props} />
			</QueryClientProvider>,
		)
	}

	it("should display cost when totalCost is greater than 0", () => {
		renderTaskHeader()
		expect(screen.getByText("$0.05")).toBeInTheDocument()
	})

	it("should not display cost when totalCost is 0", () => {
		renderTaskHeader({ totalCost: 0 })
		expect(screen.queryByText("$0.0000")).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is null", () => {
		renderTaskHeader({ totalCost: null as any })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is undefined", () => {
		renderTaskHeader({ totalCost: undefined as any })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is NaN", () => {
		renderTaskHeader({ totalCost: NaN })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should render the condense context button when expanded", () => {
		renderTaskHeader()
		// First click to expand the task header
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Now find the condense button in the expanded state
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-fold-vertical"))
		expect(condenseButton).toBeDefined()
		expect(condenseButton?.querySelector("svg")).toBeInTheDocument()
	})

	it("should call handleCondenseContext when condense context button is clicked", () => {
		const handleCondenseContext = vi.fn()
		renderTaskHeader({ handleCondenseContext })

		// First click to expand the task header
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Find the button that contains the FoldVertical icon
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-fold-vertical"))
		expect(condenseButton).toBeDefined()
		fireEvent.click(condenseButton!)
		expect(handleCondenseContext).toHaveBeenCalledWith("test-task-id")
	})

	it("should disable the condense context button when buttonsDisabled is true", () => {
		const handleCondenseContext = vi.fn()
		renderTaskHeader({ buttonsDisabled: true, handleCondenseContext })

		// First click to expand the task header
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Find the button that contains the FoldVertical icon
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-fold-vertical"))
		expect(condenseButton).toBeDefined()
		expect(condenseButton).toBeDisabled()
		fireEvent.click(condenseButton!)
		expect(handleCondenseContext).not.toHaveBeenCalled()
	})

	describe("DismissibleUpsell behavior", () => {
		beforeEach(() => {
			vi.useFakeTimers()
			// Reset the mock state before each test
			mockExtensionState = {
				apiConfiguration: {
					apiProvider: "anthropic",
					apiKey: "test-api-key",
					apiModelId: "claude-3-opus-20240229",
				} as ProviderSettings,
				currentTaskItem: { id: "test-task-id" },
				clineMessages: [],
			}
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it("should show DismissibleUpsell after 2 minutes when task is not complete", async () => {
			renderTaskHeader()

			// Initially, the upsell should not be visible
			expect(screen.queryByTestId("dismissible-upsell")).not.toBeInTheDocument()

			// Fast-forward time by 2 minutes to match component timeout
			await vi.advanceTimersByTimeAsync(120_000)

			// The upsell should now be visible
			expect(screen.getByTestId("dismissible-upsell")).toBeInTheDocument()
			expect(screen.getByText("cloud:upsell.longRunningTask")).toBeInTheDocument()
		})

		it("should not show DismissibleUpsell when task is complete", async () => {
			// Set up mock state with a completion_result message
			mockExtensionState = {
				...mockExtensionState,
				clineMessages: [
					{
						type: "ask",
						ask: "completion_result",
						ts: Date.now(),
						text: "Task completed!",
					},
				],
			}

			renderTaskHeader()

			// Fast-forward time by more than 2 minutes
			await vi.advanceTimersByTimeAsync(130_000)

			// The upsell should not appear
			expect(screen.queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		})

		it("should not show DismissibleUpsell when currentTaskItem is null", async () => {
			// Update the mock state to have null currentTaskItem
			mockExtensionState = {
				...mockExtensionState,
				currentTaskItem: null,
			}

			renderTaskHeader()

			// Fast-forward time by more than 2 minutes
			await vi.advanceTimersByTimeAsync(130_000)

			// The upsell should not appear
			expect(screen.queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		})

		it("should not show DismissibleUpsell when task has completion_result in clineMessages", async () => {
			// Set up mock state with a completion_result message from the start
			mockExtensionState = {
				...mockExtensionState,
				clineMessages: [
					{
						type: "say",
						say: "text",
						ts: Date.now() - 1000,
						text: "Working on task...",
					},
					{
						type: "ask",
						ask: "completion_result",
						ts: Date.now(),
						text: "Task completed!",
					},
				],
			}

			renderTaskHeader()

			// Fast-forward time by more than 2 minutes
			await vi.advanceTimersByTimeAsync(130_000)

			// The upsell should not appear because the task is complete
			expect(screen.queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		})

		it("should not show DismissibleUpsell when task has completion_result followed by resume messages", async () => {
			// Set up mock state with a completion_result message followed by resume messages
			mockExtensionState = {
				...mockExtensionState,
				clineMessages: [
					{
						type: "say",
						say: "text",
						ts: Date.now() - 3000,
						text: "Working on task...",
					},
					{
						type: "ask",
						ask: "completion_result",
						ts: Date.now() - 2000,
						text: "Task completed!",
					},
					{
						type: "ask",
						ask: "resume_completed_task",
						ts: Date.now() - 1000,
						text: "Resume completed task?",
					},
					{
						type: "ask",
						ask: "resume_task",
						ts: Date.now(),
						text: "Resume task?",
					},
				],
			}

			renderTaskHeader()

			// Fast-forward time by more than 2 minutes
			await vi.advanceTimersByTimeAsync(130_000)

			// The upsell should not appear because the last relevant message (skipping resume messages) is completion_result
			expect(screen.queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		})

		it("should show DismissibleUpsell when task has non-completion message followed by resume messages", async () => {
			// Set up mock state with a non-completion message followed by resume messages
			mockExtensionState = {
				...mockExtensionState,
				clineMessages: [
					{
						type: "say",
						say: "text",
						ts: Date.now() - 3000,
						text: "Working on task...",
					},
					{
						type: "ask",
						ask: "tool",
						ts: Date.now() - 2000,
						text: "Need permission to use tool",
					},
					{
						type: "ask",
						ask: "resume_task",
						ts: Date.now() - 1000,
						text: "Resume task?",
					},
				],
			}

			renderTaskHeader()

			// Fast-forward time by 2 minutes to trigger the upsell
			await vi.advanceTimersByTimeAsync(120_000)

			// The upsell should appear because the last relevant message (skipping resume messages) is not completion_result
			expect(screen.getByTestId("dismissible-upsell")).toBeInTheDocument()
		})
	})

	describe("Back to parent task button", () => {
		beforeEach(() => {
			mockPostMessage.mockClear()
		})

		it("should not show back button when parentTaskId is not provided", () => {
			renderTaskHeader()
			expect(screen.queryByText("chat:task.backToParentTask")).not.toBeInTheDocument()
		})

		it("should not show back button when parentTaskId is undefined", () => {
			renderTaskHeader({ parentTaskId: undefined })
			expect(screen.queryByText("chat:task.backToParentTask")).not.toBeInTheDocument()
		})

		it("should show back button when parentTaskId is provided", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })
			expect(screen.getByText("chat:task.backToParentTask")).toBeInTheDocument()
		})

		it("should call vscode.postMessage with showTaskWithId when back button is clicked", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })

			const backButton = screen.getByText("chat:task.backToParentTask")
			fireEvent.click(backButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "parent-task-123",
			})
		})

		it("should show back button with ArrowLeft icon", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })

			// Find the button containing the back text and verify it has the ArrowLeft icon
			const backButton = screen.getByText("chat:task.backToParentTask").closest("button")
			expect(backButton).toBeInTheDocument()
			expect(backButton?.querySelector("svg.lucide-arrow-left")).toBeInTheDocument()
		})
	})

	describe("Context window percentage calculation", () => {
		// The percentage should be calculated as:
		// contextTokens / (contextWindow - reservedForOutput) * 100
		// This represents the percentage of AVAILABLE input space used,
		// not the percentage of the total context window.

		beforeEach(() => {
			// Set up mock model with known contextWindow
			mockModelInfo = { contextWindow: 1000, maxTokens: 200 }
			// Set up mock for getModelMaxOutputTokens to return reservedForOutput
			mockMaxOutputTokens = 200
		})

		afterEach(() => {
			// Reset mocks
			mockModelInfo = undefined
			mockMaxOutputTokens = 0
		})

		it("should calculate percentage based on available input space, not total context window", () => {
			// With the formula: contextTokens / (contextWindow - reservedForOutput) * 100
			// If contextTokens = 200, contextWindow = 1000, reservedForOutput = 200
			// Then available input space = 1000 - 200 = 800
			// Percentage = 200 / 800 * 100 = 25%
			//
			// Old (incorrect) formula would have been: (200 + 200) / 1000 * 100 = 40%

			renderTaskHeader({ contextTokens: 200 })

			// The percentage should be rendered in the collapsed header state
			// Verify that 25% is displayed (correct formula) and NOT 40% (old incorrect formula)
			expect(screen.getByText("25%")).toBeInTheDocument()
			expect(screen.queryByText("40%")).not.toBeInTheDocument()
		})

		it("should handle edge case when available input space is zero", () => {
			// When contextWindow equals reservedForOutput, available space is 0
			// The percentage should be 0 to avoid division by zero
			mockModelInfo = { contextWindow: 200, maxTokens: 200 }
			mockMaxOutputTokens = 200

			renderTaskHeader({ contextTokens: 100 })

			// Should show 0% when available input space is 0
			expect(screen.getByText("0%")).toBeInTheDocument()
		})
	})
})
