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
	t: (key: string) => {
		const translations: Record<string, string> = {
			"kilocode:ghost.statusBar.enabled": "$(sparkle) Kilo Code Autocomplete",
			"kilocode:ghost.statusBar.warning": "$(warning) Kilo Code Autocomplete",
			"kilocode:ghost.statusBar.tooltip.basic": "Kilo Code Autocomplete",
			"kilocode:ghost.statusBar.tooltip.tokenError": "A valid token must be set to use Autocomplete",
			"kilocode:ghost.statusBar.tooltip.completionCount": "Completions:",
			"kilocode:ghost.statusBar.tooltip.sessionStartTime": "Session started at:",
			"kilocode:ghost.statusBar.tooltip.sessionDuration": "Session duration:",
			"kilocode:ghost.statusBar.tooltip.sessionTotal": "Session total cost:",
			"kilocode:ghost.statusBar.tooltip.provider": "Provider:",
			"kilocode:ghost.statusBar.tooltip.model": "Model:",
			"kilocode:ghost.statusBar.cost.zero": "$0.00",
			"kilocode:ghost.statusBar.cost.lessThanCent": "<$0.01",
		}
		return translations[key] || key
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
		expect(statusBar.enabled).toBe(true)
		expect(statusBar.model).toBe("test-model")
		expect(statusBar.provider).toBe("test-provider")
		expect(statusBar.hasValidToken).toBe(true)
		expect(statusBar.totalSessionCost).toBe(0.05)
		expect(statusBar.completionCount).toBe(5)
	})

	it("should display completion count in status bar text", () => {
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("(5)")
	})

	it("should format session duration correctly", () => {
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("1m 5s")
	})

	it("should show completion count in tooltip", () => {
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("Completions: 5")
	})

	it("should show session start time in tooltip", () => {
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("Session started at:")
		// Should contain a time string (format varies by locale)
		expect(tooltip).toMatch(/Session started at: \d{1,2}:\d{2}/)
	})

	it("should show session total cost in tooltip", () => {
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("$0.05")
	})

	it("should update completion count", () => {
		statusBar.update({ completionCount: 10 })
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("(10)")
	})

	it("should handle zero completions", () => {
		statusBar.update({ completionCount: 0 })
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("(0)")
	})

	it("should format duration in seconds when less than a minute", () => {
		statusBar.update({ sessionStartTime: Date.now() - 30000 }) // 30 seconds ago
		statusBar.render()
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("Session duration: 30s")
		expect(tooltip).not.toContain("0m")
	})

	it("should show token error when hasValidToken is false", () => {
		statusBar.update({ hasValidToken: false })
		statusBar.render()
		expect(statusBar.statusBar.text).toContain("$(warning)")
		const tooltip = statusBar.statusBar.tooltip as string
		expect(tooltip).toContain("A valid token must be set")
	})

	it("should hide status bar when disabled", () => {
		const hideSpy = vi.spyOn(statusBar.statusBar, "hide")
		statusBar.updateVisible(false)
		expect(hideSpy).toHaveBeenCalled()
	})

	it("should show status bar when enabled", () => {
		const showSpy = vi.spyOn(statusBar.statusBar, "show")
		statusBar.updateVisible(true)
		expect(showSpy).toHaveBeenCalled()
	})
})
