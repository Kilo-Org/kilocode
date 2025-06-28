import * as vscode from "vscode"
import { AutocompleteStatusBar } from "../AutocompleteStatusBar"
import { AutocompleteState } from "../types"

// Mock VSCode API
jest.mock("vscode", () => ({
	window: {
		createStatusBarItem: jest.fn(),
	},
	StatusBarAlignment: {
		Right: 2,
	},
}))

describe("AutocompleteStatusBar", () => {
	let mockStatusBarItem: any
	let statusBar: AutocompleteStatusBar

	beforeEach(() => {
		mockStatusBarItem = {
			text: "",
			tooltip: "",
			command: "",
			show: jest.fn(),
			dispose: jest.fn(),
		}
		;(vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(mockStatusBarItem)

		statusBar = new AutocompleteStatusBar()
	})

	afterEach(() => {
		statusBar.dispose()
		jest.clearAllMocks()
	})

	describe("updateDisplay", () => {
		it("should show disabled state when enabled is false", () => {
			const state: AutocompleteState = {
				enabled: false,
				lastCompletionCost: 0,
				totalSessionCost: 0,
				lastCompletionTime: 0,
				model: "test-model",
				hasValidToken: true,
			}

			statusBar.updateDisplay(state)

			expect(mockStatusBarItem.text).toBe("$(circle-slash) Kilo Complete")
			expect(mockStatusBarItem.tooltip).toBe("Kilo Code Autocomplete (disabled)")
		})

		it("should show warning state when token is invalid", () => {
			const state: AutocompleteState = {
				enabled: true,
				lastCompletionCost: 0,
				totalSessionCost: 0,
				lastCompletionTime: 0,
				model: "test-model",
				hasValidToken: false,
			}

			statusBar.updateDisplay(state)

			expect(mockStatusBarItem.text).toBe("$(warning) Kilo Complete")
			expect(mockStatusBarItem.tooltip).toBe("A valid Kilocode token must be set to use autocomplete")
		})

		it("should show enabled state with cost information", () => {
			const state: AutocompleteState = {
				enabled: true,
				lastCompletionCost: 0.00123,
				totalSessionCost: 0.05,
				lastCompletionTime: 1.5,
				model: "test-model",
				hasValidToken: true,
			}

			statusBar.updateDisplay(state)

			expect(mockStatusBarItem.text).toBe("$(sparkle) Kilo Complete ($0.05 1.5s)")
			expect(mockStatusBarItem.tooltip).toContain("Last completion: $0.00123 (1.5s)")
			expect(mockStatusBarItem.tooltip).toContain("Session total cost: $0.05")
			expect(mockStatusBarItem.tooltip).toContain("Model: test-model")
		})

		it("should format small costs correctly", () => {
			const state: AutocompleteState = {
				enabled: true,
				lastCompletionCost: 0.005,
				totalSessionCost: 0.002,
				lastCompletionTime: 2.3,
				model: "test-model",
				hasValidToken: true,
			}

			statusBar.updateDisplay(state)
			expect(mockStatusBarItem.text).toBe("$(sparkle) Kilo Complete (<$0.01 2.3s)")
		})

		it("should format zero cost correctly", () => {
			const state: AutocompleteState = {
				enabled: true,
				lastCompletionCost: 0,
				totalSessionCost: 0,
				lastCompletionTime: 0,
				model: "test-model",
				hasValidToken: true,
			}

			statusBar.updateDisplay(state)
			expect(mockStatusBarItem.text).toBe("$(sparkle) Kilo Complete ($0.00)")
		})

		it("should show timing information when available", () => {
			const state: AutocompleteState = {
				enabled: true,
				lastCompletionCost: 0.001,
				totalSessionCost: 0.01,
				lastCompletionTime: 2.7,
				model: "test-model",
				hasValidToken: true,
			}

			statusBar.updateDisplay(state)
			expect(mockStatusBarItem.text).toBe("$(sparkle) Kilo Complete ($0.01 2.7s)")
			expect(mockStatusBarItem.tooltip).toContain("Last completion: $0.00100 (2.7s)")
		})

		it("should not show timing when lastCompletionTime is 0", () => {
			const state: AutocompleteState = {
				enabled: true,
				lastCompletionCost: 0.001,
				totalSessionCost: 0.01,
				lastCompletionTime: 0,
				model: "test-model",
				hasValidToken: true,
			}

			statusBar.updateDisplay(state)
			expect(mockStatusBarItem.text).toBe("$(sparkle) Kilo Complete ($0.01)")
			expect(mockStatusBarItem.tooltip).toContain("Last completion: $0.00100")
			expect(mockStatusBarItem.tooltip).not.toContain("(0.0s)")
		})
	})

	describe("disposal", () => {
		it("should dispose of status bar item", () => {
			statusBar.dispose()
			expect(mockStatusBarItem.dispose).toHaveBeenCalled()
		})
	})
})
