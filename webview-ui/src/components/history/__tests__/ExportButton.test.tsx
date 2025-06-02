import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"

// Mock the vscode utility BEFORE importing the component
const mockPostMessage = jest.fn()

// Mock the module at the top level
jest.doMock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
		getState: jest.fn(),
		setState: jest.fn(),
	},
}))

// Import the component AFTER mocking
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ExportButton } = require("../ExportButton")

// Reset mocks before each test
beforeEach(() => {
	mockPostMessage.mockClear()
})

// Mock the translation context
jest.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: jest.fn((key: string) => {
			const translations: Record<string, string> = {
				"history:exportTask": "Export Task",
				"history:exportOptions": "Export Options",
				"history:exportSingleTask": "Export Single Task",
				"history:exportTaskFamily": "Export Task Family",
			}
			return translations[key] || key
		}),
	}),
}))

// Mock the Button component
jest.mock("@/components/ui", () => ({
	Button: ({ children, onClick, title, ...props }: any) => (
		<button onClick={onClick} title={title} {...props}>
			{children}
		</button>
	),
}))

describe("ExportButton", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe("Single task export (no family)", () => {
		it("should render export button for single task", () => {
			render(<ExportButton itemId="task-123" hasFamily={false} />)

			const button = screen.getByRole("button")
			expect(button).toBeInTheDocument()
			expect(button).toHaveAttribute("title", "Export Task")
		})

		it("should show download icon without chevron for single task", () => {
			render(<ExportButton itemId="task-123" hasFamily={false} />)

			const downloadIcon = screen.getByText((content, element) => {
				return element?.classList.contains("codicon-desktop-download") || false
			})
			expect(downloadIcon).toBeInTheDocument()

			const chevronIcon = screen.queryByText((content, element) => {
				return element?.classList.contains("codicon-chevron-down") || false
			})
			expect(chevronIcon).not.toBeInTheDocument()
		})

		it("should export single task when clicked", () => {
			render(<ExportButton itemId="task-123" hasFamily={false} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "exportTaskWithId",
				text: "task-123",
			})
		})

		it("should stop event propagation when clicked", () => {
			const mockParentClick = jest.fn()
			render(
				<div onClick={mockParentClick}>
					<ExportButton itemId="task-123" hasFamily={false} />
				</div>,
			)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			expect(mockParentClick).not.toHaveBeenCalled()
		})
	})

	describe("Task family export", () => {
		it("should render export button with chevron for task family", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			expect(button).toHaveAttribute("title", "Export Options")

			const downloadIcon = screen.getByText((content, element) => {
				return element?.classList.contains("codicon-desktop-download") || false
			})
			expect(downloadIcon).toBeInTheDocument()

			const chevronIcon = screen.getByText((content, element) => {
				return element?.classList.contains("codicon-chevron-down") || false
			})
			expect(chevronIcon).toBeInTheDocument()
		})

		it("should show dropdown menu when clicked", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			expect(screen.getByText("Export Single Task")).toBeInTheDocument()
			expect(screen.getByText("Export Task Family")).toBeInTheDocument()
		})

		it("should hide dropdown menu initially", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			expect(screen.queryByText("Export Single Task")).not.toBeInTheDocument()
			expect(screen.queryByText("Export Task Family")).not.toBeInTheDocument()
		})

		it("should export single task when single task option is clicked", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			const singleTaskOption = screen.getByText("Export Single Task")
			fireEvent.click(singleTaskOption)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "exportTaskWithId",
				text: "task-123",
			})
		})

		it("should export task family when family option is clicked", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			const familyOption = screen.getByText("Export Task Family")
			fireEvent.click(familyOption)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "exportTaskFamilyWithId",
				text: "task-123",
			})
		})

		it("should close menu after selecting an option", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			const singleTaskOption = screen.getByText("Export Single Task")
			fireEvent.click(singleTaskOption)

			expect(screen.queryByText("Export Single Task")).not.toBeInTheDocument()
			expect(screen.queryByText("Export Task Family")).not.toBeInTheDocument()
		})

		it("should stop event propagation for menu options", () => {
			const mockParentClick = jest.fn()
			render(
				<div onClick={mockParentClick}>
					<ExportButton itemId="task-123" hasFamily={true} />
				</div>,
			)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			const singleTaskOption = screen.getByText("Export Single Task")
			fireEvent.click(singleTaskOption)

			expect(mockParentClick).not.toHaveBeenCalled()
		})
	})

	describe("Menu interaction", () => {
		it("should close menu when clicking outside", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			expect(screen.getByText("Export Single Task")).toBeInTheDocument()

			// Click on the overlay
			const overlay = screen.getByText((content, element) => {
				return (element?.classList.contains("fixed") && element?.classList.contains("inset-0")) || false
			})
			fireEvent.click(overlay)

			expect(screen.queryByText("Export Single Task")).not.toBeInTheDocument()
		})

		it("should toggle menu when button is clicked multiple times", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")

			// First click - open menu
			fireEvent.click(button)
			expect(screen.getByText("Export Single Task")).toBeInTheDocument()

			// Second click - close menu
			fireEvent.click(button)
			expect(screen.queryByText("Export Single Task")).not.toBeInTheDocument()

			// Third click - open menu again
			fireEvent.click(button)
			expect(screen.getByText("Export Single Task")).toBeInTheDocument()
		})
	})

	describe("Accessibility", () => {
		it("should have proper test id", () => {
			render(<ExportButton itemId="task-123" hasFamily={false} />)

			const button = screen.getByTestId("export")
			expect(button).toBeInTheDocument()
		})

		it("should have proper button attributes", () => {
			render(<ExportButton itemId="task-123" hasFamily={false} />)

			const button = screen.getByRole("button")
			expect(button).toHaveAttribute("data-testid", "export")
		})

		it("should have proper menu structure", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			const menuOptions = screen.getAllByRole("button")
			expect(menuOptions).toHaveLength(3) // Main button + 2 menu options
		})
	})

	describe("Edge cases", () => {
		it("should handle undefined hasFamily prop", () => {
			render(<ExportButton itemId="task-123" />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "exportTaskWithId",
				text: "task-123",
			})
		})

		it("should handle empty itemId", () => {
			render(<ExportButton itemId="" hasFamily={false} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "exportTaskWithId",
				text: "",
			})
		})

		it("should handle special characters in itemId", () => {
			const specialId = "task-123_special@chars"
			render(<ExportButton itemId={specialId} hasFamily={false} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "exportTaskWithId",
				text: specialId,
			})
		})
	})

	describe("CSS classes and styling", () => {
		it("should apply correct CSS classes to dropdown menu", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			const menu = screen.getByText("Export Single Task").closest("div")
			expect(menu).toHaveClass("absolute")
			expect(menu).toHaveClass("right-0")
			expect(menu).toHaveClass("top-full")
			expect(menu).toHaveClass("mt-1")
			expect(menu).toHaveClass("bg-vscode-dropdown-background")
			expect(menu).toHaveClass("border")
			expect(menu).toHaveClass("border-vscode-dropdown-border")
			expect(menu).toHaveClass("rounded")
			expect(menu).toHaveClass("shadow-lg")
			expect(menu).toHaveClass("z-50")
			expect(menu).toHaveClass("min-w-48")
		})

		it("should apply hover styles to menu options", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")
			fireEvent.click(button)

			const singleTaskOption = screen.getByText("Export Single Task")
			expect(singleTaskOption).toHaveClass("w-full")
			expect(singleTaskOption).toHaveClass("px-3")
			expect(singleTaskOption).toHaveClass("py-2")
			expect(singleTaskOption).toHaveClass("text-left")
			expect(singleTaskOption).toHaveClass("text-sm")
			expect(singleTaskOption).toHaveClass("hover:bg-vscode-list-hoverBackground")
			expect(singleTaskOption).toHaveClass("text-vscode-dropdown-foreground")
		})
	})

	describe("Component state management", () => {
		it("should maintain independent state for multiple instances", () => {
			render(
				<div>
					<ExportButton itemId="task-1" hasFamily={true} />
					<ExportButton itemId="task-2" hasFamily={true} />
				</div>,
			)

			const buttons = screen.getAllByRole("button")
			const firstButton = buttons[0]
			const secondButton = buttons[1]

			// Open first menu
			fireEvent.click(firstButton)
			expect(screen.getAllByText("Export Single Task")).toHaveLength(1)

			// Open second menu
			fireEvent.click(secondButton)
			expect(screen.getAllByText("Export Single Task")).toHaveLength(2)
		})

		it("should reset state correctly after interactions", () => {
			render(<ExportButton itemId="task-123" hasFamily={true} />)

			const button = screen.getByRole("button")

			// Open and close menu multiple times
			for (let i = 0; i < 3; i++) {
				fireEvent.click(button)
				expect(screen.getByText("Export Single Task")).toBeInTheDocument()

				const singleTaskOption = screen.getByText("Export Single Task")
				fireEvent.click(singleTaskOption)
				expect(screen.queryByText("Export Single Task")).not.toBeInTheDocument()
			}
		})
	})
})
