import { describe, it, expect, beforeEach, vi } from "vitest"
import { GhostStatusBar } from "../GhostStatusBar"

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		createStatusBarItem: vi.fn(() => ({
			text: "",
			tooltip: "",
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	StatusBarAlignment: {
		Right: 2,
	},
}))

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: (key: string, params?: Record<string, string | number>) => {
		const translations: Record<string, string> = {
			"kilocode:ghost.statusBar.enabled": "$(kilo-logo) Autocomplete",
			"kilocode:ghost.statusBar.warning": "$(warning) Autocomplete",
			"kilocode:ghost.statusBar.tooltip.basic": "Autocomplete",
			"kilocode:ghost.statusBar.tooltip.tokenError": "A valid token must be set to use Autocomplete",
			"kilocode:ghost.statusBar.tooltip.completionCount": "Completions:",
			"kilocode:ghost.statusBar.tooltip.sessionStartTime": "Session started at:",
			"kilocode:ghost.statusBar.tooltip.sessionDuration": "Session duration:",
			"kilocode:ghost.statusBar.tooltip.sessionTotal": "Session total cost:",
			"kilocode:ghost.statusBar.tooltip.provider": "Provider:",
			"kilocode:ghost.statusBar.tooltip.model": "Model:",
			"kilocode:ghost.statusBar.tooltip.completionSummary":
				"Performed {{count}} completions between {{startTime}} and {{endTime}}, for a total cost of {{cost}}.",
			"kilocode:ghost.statusBar.tooltip.providerInfo": "Autocompletions provided by {{model}} via {{provider}}.",
			"kilocode:ghost.statusBar.cost.zero": "$0.00",
			"kilocode:ghost.statusBar.cost.lessThanCent": "<$0.01",
		}
		let result = translations[key] || key
		if (params) {
			Object.entries(params).forEach(([paramKey, value]) => {
				result = result.replace(new RegExp(`{{${paramKey}}}`, "g"), String(value))
			})
		}
		return result
	},
}))

describe("GhostStatusBar", () => {
	let statusBar: GhostStatusBar

	beforeEach(() => {
		statusBar = new GhostStatusBar({
			enabled: true,
			model: "test-model",
			provider: "test-provider",
			hasValidToken: true,
			totalSessionCost: 0.05,
			completionCount: 5,
			sessionStartTime: Date.now() - 65000, // 1 minute and 5 seconds ago
		})
	})

	it("should initialize with correct properties", () => {
		// Verify initialization through rendered output
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("(5)")
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("test-model")
		expect(tooltip).toContain("test-provider")
		expect(tooltip).toContain("$0.05")
	})

	it("should display completion count in status bar text", () => {
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("(5)")
	})

	it("should show completion count in tooltip", () => {
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("Performed 5 completions")
	})

	it("should show time range in tooltip", () => {
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toMatch(/between \d{1,2}:\d{2}/)
		expect(tooltip).toMatch(/and \d{1,2}:\d{2}/)
	})

	it("should show session total cost in tooltip", () => {
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("$0.05")
	})

	it("should show provider and model in tooltip", () => {
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("test-model")
		expect(tooltip).toContain("test-provider")
	})

	it("should update completion count", () => {
		statusBar.update({
			completionCount: 10,
			hasValidToken: true,
			totalSessionCost: 0.05,
			sessionStartTime: Date.now(),
		})
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("(10)")
	})

	it("should handle zero completions", () => {
		statusBar.update({
			completionCount: 0,
			hasValidToken: true,
			totalSessionCost: 0.05,
			sessionStartTime: Date.now(),
		})
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("(0)")
	})

	it("should show time range format", () => {
		statusBar.update({
			sessionStartTime: Date.now() - 30000,
			hasValidToken: true,
			totalSessionCost: 0.05,
			completionCount: 5,
		}) // 30 seconds ago
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toMatch(/Performed \d+ completions between/)
		expect(tooltip).toContain("for a total cost of")
	})

	it("should show token error when hasValidToken is false", () => {
		statusBar.update({
			hasValidToken: false,
			totalSessionCost: 0.05,
			completionCount: 5,
			sessionStartTime: Date.now(),
		})
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("$(warning)")
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("A valid token must be set")
	})
})
