import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom"
import { ModeIndicator } from "../ModeIndicator"

// Mock the translation context
jest.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: jest.fn((key: string, options?: { defaultValue?: string; mode?: string }) => {
			// Mock translation function
			if (key.startsWith("history:modes.")) {
				const mode = key.replace("history:modes.", "")
				const modeTranslations: Record<string, string> = {
					code: "Code",
					architect: "Architect",
					ask: "Ask",
					debug: "Debug",
					orchestrator: "Orchestrator",
					translate: "Translate",
					test: "Test",
				}
				return modeTranslations[mode] || options?.defaultValue || mode
			}
			if (key === "history:filterByMode") {
				return `Filter by ${options?.mode || "mode"} mode`
			}
			return key
		}),
	}),
}))

// Mock the utils
jest.mock("@/lib/utils", () => ({
	cn: (...classes: (string | undefined)[]) => classes.filter(Boolean).join(" "),
}))

describe("ModeIndicator", () => {
	describe("Rendering", () => {
		it("should render mode badge with correct text for known modes", () => {
			const knownModes = ["code", "architect", "ask", "debug", "orchestrator", "translate", "test"]

			knownModes.forEach((mode) => {
				const { unmount } = render(<ModeIndicator mode={mode} />)

				const badge = screen.getByText(mode.charAt(0).toUpperCase() + mode.slice(1))
				expect(badge).toBeInTheDocument()

				unmount()
			})
		})

		it("should render mode badge with default styling for unknown modes", () => {
			render(<ModeIndicator mode="unknown-mode" />)

			const badge = screen.getByText("unknown-mode")
			expect(badge).toBeInTheDocument()
			expect(badge).toHaveClass("bg-vscode-descriptionForeground/20")
			expect(badge).toHaveClass("text-vscode-descriptionForeground")
			expect(badge).toHaveClass("border-vscode-descriptionForeground/30")
		})

		it("should apply correct color classes for each mode", () => {
			const modeColors = {
				code: "bg-blue-500/20 text-blue-300 border-blue-500/30",
				architect: "bg-purple-500/20 text-purple-300 border-purple-500/30",
				ask: "bg-green-500/20 text-green-300 border-green-500/30",
				debug: "bg-red-500/20 text-red-300 border-red-500/30",
				orchestrator: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
				translate: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
				test: "bg-orange-500/20 text-orange-300 border-orange-500/30",
			}

			Object.entries(modeColors).forEach(([mode, expectedClasses]) => {
				const { unmount } = render(<ModeIndicator mode={mode} />)

				const badge = screen.getByText(mode.charAt(0).toUpperCase() + mode.slice(1))
				expectedClasses.split(" ").forEach((className) => {
					expect(badge).toHaveClass(className)
				})

				unmount()
			})
		})

		it("should return null when mode is undefined", () => {
			const { container } = render(<ModeIndicator mode={undefined} />)
			expect(container.firstChild).toBeNull()
		})

		it("should return null when mode is empty string", () => {
			const { container } = render(<ModeIndicator mode="" />)
			expect(container.firstChild).toBeNull()
		})

		it("should apply custom className when provided", () => {
			render(<ModeIndicator mode="code" className="custom-class" />)

			const badge = screen.getByText("Code")
			expect(badge).toHaveClass("custom-class")
		})
	})

	describe("Clickable functionality", () => {
		it("should not be clickable by default", () => {
			render(<ModeIndicator mode="code" />)

			const badge = screen.getByText("Code")
			expect(badge).not.toHaveClass("cursor-pointer")
			expect(badge).not.toHaveAttribute("title")
		})

		it("should be clickable when clickable prop is true", () => {
			const mockOnClick = jest.fn()
			render(<ModeIndicator mode="code" clickable={true} onClick={mockOnClick} />)

			const badge = screen.getByText("Code")
			expect(badge).toHaveClass("cursor-pointer")
			expect(badge).toHaveClass("hover:opacity-80")
			expect(badge).toHaveClass("transition-opacity")
		})

		it("should call onClick when clicked and clickable", () => {
			const mockOnClick = jest.fn()
			render(<ModeIndicator mode="code" clickable={true} onClick={mockOnClick} />)

			const badge = screen.getByText("Code")
			fireEvent.click(badge)

			expect(mockOnClick).toHaveBeenCalledTimes(1)
		})

		it("should not call onClick when clicked but not clickable", () => {
			const mockOnClick = jest.fn()
			render(<ModeIndicator mode="code" clickable={false} onClick={mockOnClick} />)

			const badge = screen.getByText("Code")
			fireEvent.click(badge)

			expect(mockOnClick).not.toHaveBeenCalled()
		})

		it("should show tooltip when clickable", () => {
			render(<ModeIndicator mode="code" clickable={true} />)

			const badge = screen.getByText("Code")
			expect(badge).toHaveAttribute("title", "Filter by Code mode")
		})

		it("should not show tooltip when not clickable", () => {
			render(<ModeIndicator mode="code" clickable={false} />)

			const badge = screen.getByText("Code")
			expect(badge).not.toHaveAttribute("title")
		})
	})

	describe("Internationalization", () => {
		it("should use translated mode names", () => {
			// The mock already provides translations, so we test that they're used
			render(<ModeIndicator mode="code" />)
			expect(screen.getByText("Code")).toBeInTheDocument()

			render(<ModeIndicator mode="architect" />)
			expect(screen.getByText("Architect")).toBeInTheDocument()
		})

		it("should fall back to mode value for unknown modes", () => {
			render(<ModeIndicator mode="custom-mode" />)
			expect(screen.getByText("custom-mode")).toBeInTheDocument()
		})

		it("should use translated tooltip text when clickable", () => {
			render(<ModeIndicator mode="debug" clickable={true} />)

			const badge = screen.getByText("Debug")
			expect(badge).toHaveAttribute("title", "Filter by Debug mode")
		})
	})

	describe("Edge cases", () => {
		it("should handle mode with special characters", () => {
			render(<ModeIndicator mode="test-mode_123" />)
			expect(screen.getByText("test-mode_123")).toBeInTheDocument()
		})

		it("should handle very long mode names", () => {
			const longMode = "very-long-mode-name-that-might-cause-layout-issues"
			render(<ModeIndicator mode={longMode} />)
			expect(screen.getByText(longMode)).toBeInTheDocument()
		})

		it("should handle mode names with numbers", () => {
			render(<ModeIndicator mode="mode123" />)
			expect(screen.getByText("mode123")).toBeInTheDocument()
		})

		it("should maintain accessibility when clickable", () => {
			render(<ModeIndicator mode="code" clickable={true} />)

			const badge = screen.getByText("Code")
			expect(badge.tagName).toBe("SPAN")
			expect(badge).toHaveAttribute("title")
		})
	})

	describe("CSS classes", () => {
		it("should always include base classes", () => {
			render(<ModeIndicator mode="code" />)

			const badge = screen.getByText("Code")
			expect(badge).toHaveClass("inline-flex")
			expect(badge).toHaveClass("items-center")
			expect(badge).toHaveClass("px-2")
			expect(badge).toHaveClass("py-0.5")
			expect(badge).toHaveClass("rounded-full")
			expect(badge).toHaveClass("text-xs")
			expect(badge).toHaveClass("font-medium")
			expect(badge).toHaveClass("border")
		})

		it("should combine custom className with existing classes", () => {
			render(<ModeIndicator mode="code" className="my-custom-class another-class" />)

			const badge = screen.getByText("Code")
			expect(badge).toHaveClass("my-custom-class")
			expect(badge).toHaveClass("another-class")
			expect(badge).toHaveClass("inline-flex") // Base class should still be there
		})
	})
})
