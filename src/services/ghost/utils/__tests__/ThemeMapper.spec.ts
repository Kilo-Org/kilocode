import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		activeColorTheme: {
			kind: 1, // Dark theme
		},
	},
	ColorThemeKind: {
		Dark: 1,
		Light: 2,
		HighContrast: 3,
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue("Dark+ (default dark)"),
		}),
	},
}))

import { getShikiTheme, getThemeColors } from "../ThemeMapper"
import * as vscode from "vscode"

describe("ThemeMapper", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getShikiTheme", () => {
		it("should map known VS Code themes to Shiki themes", () => {
			const mockConfig = { get: vi.fn().mockReturnValue("Dark+ (default dark)") }
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

			const result = getShikiTheme()
			expect(result).toBe("dark-plus")
		})

		it("should fallback to appropriate default for unknown themes", () => {
			const mockConfig = { get: vi.fn().mockReturnValue("Unknown Theme") }
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any)

			const result = getShikiTheme()
			expect(result).toBe("dark-plus") // Should fallback to dark-plus for dark theme
		})
	})

	describe("getThemeColors", () => {
		it("should return appropriate colors based on theme type", () => {
			const colors = getThemeColors()
			expect(colors).toHaveProperty("background")
			expect(colors).toHaveProperty("foreground")
			expect(colors).toHaveProperty("modifiedBackground")
		})
	})
})
