// npx vitest run src/context/__tests__/ExtensionStateContext.showTimestamps.spec.tsx

import { render, screen, act } from "@/utils/test-utils"
import { ExtensionStateContextProvider, useExtensionState } from "../ExtensionStateContext"

// Test component to access context
const TestComponent = () => {
	const { showTimestamps, setShowTimestamps } = useExtensionState()

	return (
		<div>
			<div data-testid="show-timestamps-value">{showTimestamps?.toString()}</div>
			<button data-testid="toggle-timestamps" onClick={() => setShowTimestamps(!showTimestamps)}>
				Toggle Timestamps
			</button>
		</div>
	)
}

describe("ExtensionStateContext showTimestamps state management", () => {
	it("initializes showTimestamps to true by default", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		const showTimestampsValue = screen.getByTestId("show-timestamps-value")
		expect(showTimestampsValue).toHaveTextContent("true")
	})

	it("allows toggling showTimestamps state", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		const showTimestampsValue = screen.getByTestId("show-timestamps-value")
		const toggleButton = screen.getByTestId("toggle-timestamps")

		// Initial state should be true
		expect(showTimestampsValue).toHaveTextContent("true")

		// Toggle to false
		act(() => {
			toggleButton.click()
		})
		expect(showTimestampsValue).toHaveTextContent("false")

		// Toggle back to true
		act(() => {
			toggleButton.click()
		})
		expect(showTimestampsValue).toHaveTextContent("true")
	})

	it("maintains showTimestamps state across re-renders", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		const showTimestampsValue = screen.getByTestId("show-timestamps-value")
		const toggleButton = screen.getByTestId("toggle-timestamps")

		// Toggle to false
		act(() => {
			toggleButton.click()
		})
		expect(showTimestampsValue).toHaveTextContent("false")

		// Force re-render by triggering another state change (no-op)
		act(() => {
			toggleButton.click()
		})
		expect(showTimestampsValue).toHaveTextContent("true")
	})

	it("provides setShowTimestamps function that updates state correctly", () => {
		const TestSetFunction = () => {
			const { showTimestamps, setShowTimestamps } = useExtensionState()

			return (
				<div>
					<div data-testid="show-timestamps-value">{showTimestamps?.toString()}</div>
					<button data-testid="set-true" onClick={() => setShowTimestamps(true)}>
						Set True
					</button>
					<button data-testid="set-false" onClick={() => setShowTimestamps(false)}>
						Set False
					</button>
				</div>
			)
		}

		render(
			<ExtensionStateContextProvider>
				<TestSetFunction />
			</ExtensionStateContextProvider>,
		)

		const showTimestampsValue = screen.getByTestId("show-timestamps-value")
		const setTrueButton = screen.getByTestId("set-true")
		const setFalseButton = screen.getByTestId("set-false")

		// Initial state should be true
		expect(showTimestampsValue).toHaveTextContent("true")

		// Set to false
		act(() => {
			setFalseButton.click()
		})
		expect(showTimestampsValue).toHaveTextContent("false")

		// Set back to true
		act(() => {
			setTrueButton.click()
		})
		expect(showTimestampsValue).toHaveTextContent("true")
	})

	it("handles multiple state updates in sequence", () => {
		const TestMultipleUpdates = () => {
			const { showTimestamps, setShowTimestamps } = useExtensionState()

			return (
				<div>
					<div data-testid="show-timestamps-value">{showTimestamps?.toString()}</div>
					<button
						data-testid="toggle-multiple"
						onClick={() => {
							setShowTimestamps(false)
							setShowTimestamps(true)
							setShowTimestamps(false)
						}}>
						Multiple Toggles
					</button>
				</div>
			)
		}

		render(
			<ExtensionStateContextProvider>
				<TestMultipleUpdates />
			</ExtensionStateContextProvider>,
		)

		const showTimestampsValue = screen.getByTestId("show-timestamps-value")
		const multipleToggleButton = screen.getByTestId("toggle-multiple")

		// Initial state should be true
		expect(showTimestampsValue).toHaveTextContent("true")

		// Multiple state changes should result in final state being false
		act(() => {
			multipleToggleButton.click()
		})
		expect(showTimestampsValue).toHaveTextContent("false")
	})

	it("throws error when useExtensionState is used outside provider", () => {
		// Mock console.error to avoid noise in test output
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		expect(() => {
			render(<TestComponent />)
		}).toThrow("useExtensionState must be used within an ExtensionStateContextProvider")

		consoleSpy.mockRestore()
	})

	it("preserves other state properties when updating showTimestamps", () => {
		const TestPreserveState = () => {
			const { showTimestamps, setShowTimestamps, showTaskTimeline } = useExtensionState()

			return (
				<div>
					<div data-testid="show-timestamps-value">{showTimestamps?.toString()}</div>
					<div data-testid="show-task-timeline-value">{showTaskTimeline?.toString()}</div>
					<button data-testid="toggle-timestamps" onClick={() => setShowTimestamps(!showTimestamps)}>
						Toggle Timestamps
					</button>
				</div>
			)
		}

		render(
			<ExtensionStateContextProvider>
				<TestPreserveState />
			</ExtensionStateContextProvider>,
		)

		const showTimestampsValue = screen.getByTestId("show-timestamps-value")
		const showTaskTimelineValue = screen.getByTestId("show-task-timeline-value")
		const toggleButton = screen.getByTestId("toggle-timestamps")

		// Both should have initial values
		expect(showTimestampsValue).toHaveTextContent("true")
		expect(showTaskTimelineValue).toHaveTextContent("true")

		// Toggle timestamps - should only affect timestamps, not task timeline
		act(() => {
			toggleButton.click()
		})

		expect(showTimestampsValue).toHaveTextContent("false")
		expect(showTaskTimelineValue).toHaveTextContent("true") // Should remain unchanged
	})

	it("handles rapid state changes correctly", async () => {
		const TestRapidChanges = () => {
			const { showTimestamps, setShowTimestamps } = useExtensionState()

			return (
				<div>
					<div data-testid="show-timestamps-value">{showTimestamps?.toString()}</div>
					<button
						data-testid="rapid-toggle"
						onClick={() => {
							// Rapidly toggle multiple times
							setShowTimestamps(false)
							setShowTimestamps(true)
							setShowTimestamps(false)
							setShowTimestamps(true)
						}}>
						Rapid Toggle
					</button>
				</div>
			)
		}

		render(
			<ExtensionStateContextProvider>
				<TestRapidChanges />
			</ExtensionStateContextProvider>,
		)

		const showTimestampsValue = screen.getByTestId("show-timestamps-value")
		const rapidToggleButton = screen.getByTestId("rapid-toggle")

		// Initial state should be true
		expect(showTimestampsValue).toHaveTextContent("true")

		// Rapid changes should result in final state being true
		act(() => {
			rapidToggleButton.click()
		})

		// Wait for state to settle
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		expect(showTimestampsValue).toHaveTextContent("true")
	})
})
