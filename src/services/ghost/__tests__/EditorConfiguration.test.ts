import { describe, it, expect, beforeEach, vi } from "vitest"
import * as vscode from "vscode"
import { getEditorConfiguration } from "../EditorConfiguration"

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
}))

describe("getEditorConfiguration", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})
	it("should convert absolute pixel lineHeight to multiplier when >= 8", () => {
		const mockConfig = {
			get: vi.fn((key: string) => {
				switch (key) {
					case "fontSize":
						return 16
					case "lineHeight":
						return 24 // Absolute pixels
					case "fontFamily":
						return "Monaco, monospace"
					default:
						return undefined
				}
			}),
		}
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

		const config = getEditorConfiguration()
		expect(config.lineHeight).toBe(1.5) // 24 / 16 = 1.5
	})

	it("should preserve multiplier lineHeight when < 8", () => {
		const mockConfig = {
			get: vi.fn((key: string) => {
				switch (key) {
					case "fontSize":
						return 14
					case "lineHeight":
						return 1.5 // Already a multiplier
					case "fontFamily":
						return "Consolas, monospace"
					default:
						return undefined
				}
			}),
		}
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

		const config = getEditorConfiguration()
		expect(config.lineHeight).toBe(1.5) // Should remain unchanged
	})

	it("should handle edge case of exactly 8 as absolute pixels", () => {
		const mockConfig = {
			get: vi.fn((key: string) => {
				switch (key) {
					case "fontSize":
						return 16
					case "lineHeight":
						return 8 // Edge case: exactly 8
					default:
						return undefined
				}
			}),
		}
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

		const config = getEditorConfiguration()
		expect(config.lineHeight).toBe(0.5) // 8 / 16 = 0.5
	})
})
