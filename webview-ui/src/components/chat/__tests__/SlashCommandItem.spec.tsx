// kilocode_change - new file
import React from "react"
import { render } from "@/utils/test-utils"
import { describe, it, expect, vi } from "vitest"
import { SlashCommandItem } from "../SlashCommandItem"

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"chat:slashCommand.wantsToRun": "Kilo wants to run a workflow:",
				"chat:slashCommand.didRun": "Kilo ran a workflow:",
			}
			return translations[key] || key
		},
	}),
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => {
		return <>{children || i18nKey}</>
	},
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

// Mock VSCodeBadge
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children, ...props }: { children: React.ReactNode }) => <span {...props}>{children}</span>,
}))

// Mock vscode
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock useAppTranslation
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const mockOnToggleExpand = vi.fn()
const mockOnDelete = vi.fn()
const mockOnClick = vi.fn()

describe("SlashCommandItem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Command List Mode (Original)", () => {
		it("should display command with name and description", () => {
			const command = {
				name: "test",
				description: "Test command",
				source: "project",
			}

			const { getByText } = render(
				<SlashCommandItem command={command as any} onDelete={mockOnDelete} onClick={mockOnClick} />,
			)

			expect(getByText("test")).toBeInTheDocument()
			expect(getByText("Test command")).toBeInTheDocument()
		})

		it("should display command without description", () => {
			const command = {
				name: "simple",
				source: "global",
			}

			const { getByText, queryByText } = render(
				<SlashCommandItem command={command as any} onDelete={mockOnDelete} onClick={mockOnClick} />,
			)

			expect(getByText("simple")).toBeInTheDocument()
			expect(queryByText(/description/i)).not.toBeInTheDocument()
		})

		it("should show edit and delete buttons for non-built-in commands", () => {
			const command = {
				name: "custom",
				source: "project",
			}

			const { container } = render(
				<SlashCommandItem command={command as any} onDelete={mockOnDelete} onClick={mockOnClick} />,
			)

			// Check for edit and delete buttons (they use lucide-react icons)
			expect(container.querySelector("button")).toBeInTheDocument()
		})

		it("should not show edit and delete buttons for built-in commands", () => {
			const command = {
				name: "builtin",
				source: "built-in",
			}

			const { container } = render(
				<SlashCommandItem command={command as any} onDelete={mockOnDelete} onClick={mockOnClick} />,
			)

			// Built-in commands should not have action buttons
			const buttons = container.querySelectorAll("button")
			expect(buttons.length).toBe(0)
		})

		it("should call onClick when command name is clicked", () => {
			const command = {
				name: "clickable",
				source: "project",
			}

			const { getByText } = render(
				<SlashCommandItem command={command as any} onDelete={mockOnDelete} onClick={mockOnClick} />,
			)

			getByText("clickable").click()
			expect(mockOnClick).toHaveBeenCalledTimes(1)
		})
	})

	describe("Workflow Execution Mode", () => {
		it("should display workflow execution ask message with command only", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "init",
			}

			const { getByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(getByText("Kilo wants to run a workflow:")).toBeInTheDocument()
			expect(getByText("/init")).toBeInTheDocument()
		})

		it("should display workflow execution ask message with command and args", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "test",
				args: "focus on unit tests",
				description: "Run project tests",
				source: "project",
			}

			const { getByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={true}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(getByText("Kilo wants to run a workflow:")).toBeInTheDocument()
			expect(getByText("/test")).toBeInTheDocument()
			expect(getByText("Arguments:")).toBeInTheDocument()
			expect(getByText("focus on unit tests")).toBeInTheDocument()
			expect(getByText("Run project tests")).toBeInTheDocument()
			expect(getByText("project")).toBeInTheDocument()
		})

		it("should display workflow execution say message", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "deploy",
				source: "global",
			}

			const { getByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="say"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(getByText("Kilo ran a workflow:")).toBeInTheDocument()
			expect(getByText("/deploy")).toBeInTheDocument()
			expect(getByText("global")).toBeInTheDocument()
		})

		it("should display workflow execution say message with args and description", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "build",
				args: "--production",
				description: "Build for production environment",
				source: "built-in",
			}

			const { getByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="say"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(getByText("Kilo ran a workflow:")).toBeInTheDocument()
			expect(getByText("/build")).toBeInTheDocument()
			expect(getByText("--production")).toBeInTheDocument()
			expect(getByText("Build for production environment")).toBeInTheDocument()
			expect(getByText("built-in")).toBeInTheDocument()
		})

		it("should call onToggleExpand when clicking expandable ask message", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "test",
				args: "all tests",
			}

			const { container } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			// Click on expandable container
			const expandableDiv = container.querySelector('[style*="cursor: pointer"]')
			expect(expandableDiv).toBeInTheDocument()

			if (expandableDiv && expandableDiv instanceof HTMLElement) {
				expandableDiv.click()
				expect(mockOnToggleExpand).toHaveBeenCalledTimes(1)
			}
		})

		it("should show chevron down when collapsed", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "test",
			}

			const { container } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(container.querySelector(".codicon-chevron-down")).toBeInTheDocument()
			expect(container.querySelector(".codicon-chevron-up")).not.toBeInTheDocument()
		})

		it("should show chevron up when expanded", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "test",
			}

			const { container } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={true}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(container.querySelector(".codicon-chevron-up")).toBeInTheDocument()
			expect(container.querySelector(".codicon-chevron-down")).not.toBeInTheDocument()
		})

		it("should not show expand/collapse details when collapsed and no args/description", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "simple",
			}

			const { queryByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(queryByText("Arguments:")).not.toBeInTheDocument()
		})

		it("should show expand/collapse details when expanded with args", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "test",
				args: "--verbose",
			}

			const { getByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={true}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(getByText("Arguments:")).toBeInTheDocument()
			expect(getByText("--verbose")).toBeInTheDocument()
		})

		it("should show source badge when provided", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "workflow",
				source: "project",
			}

			const { getByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(getByText("project")).toBeInTheDocument()
		})

		it("should not show source badge when not provided", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "simple",
			}

			const { container } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			// VSCodeBadge mock renders as span
			const badges = container.querySelectorAll("span")
			const sourceBadge = Array.from(badges).find(
				(badge) =>
					badge.textContent === "project" ||
					badge.textContent === "global" ||
					badge.textContent === "built-in",
			)
			expect(sourceBadge).not.toBeDefined()
		})

		it("should handle different source types", () => {
			const sources = ["project", "global", "built-in"] as const

			sources.forEach((source) => {
				const tool = {
					tool: "runSlashCommand" as const,
					command: "test",
					source,
				}

				const { getByText, unmount } = render(
					<SlashCommandItem
						isWorkflowExecution
						tool={tool}
						messageType="ask"
						isExpanded={false}
						onToggleExpand={mockOnToggleExpand}
					/>,
				)

				expect(getByText(source)).toBeInTheDocument()
				unmount()
			})
		})

		it("should display description in ask message when expanded", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "test",
				description: "This is a test workflow",
			}

			const { getByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="ask"
					isExpanded={true}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(getByText("This is a test workflow")).toBeInTheDocument()
		})

		it("should display description in say message", () => {
			const tool = {
				tool: "runSlashCommand" as const,
				command: "deploy",
				description: "Deploy to production",
			}

			const { getByText } = render(
				<SlashCommandItem
					isWorkflowExecution
					tool={tool}
					messageType="say"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			expect(getByText("Deploy to production")).toBeInTheDocument()
		})
	})

	describe("Edge Cases", () => {
		it("should return null when command is not provided in command list mode", () => {
			const { container } = render(<SlashCommandItem onDelete={mockOnDelete} onClick={mockOnClick} />)

			expect(container.firstChild).toBeNull()
		})

		it("should return null when onDelete is not provided in command list mode", () => {
			const command = {
				name: "test",
				source: "project",
			}

			const { container } = render(<SlashCommandItem command={command as any} onClick={mockOnClick} />)

			expect(container.firstChild).toBeNull()
		})

		it("should not render workflow execution when tool is not provided", () => {
			const { container } = render(
				<SlashCommandItem
					isWorkflowExecution
					messageType="ask"
					isExpanded={false}
					onToggleExpand={mockOnToggleExpand}
				/>,
			)

			// Should fall back to command list mode and return null
			expect(container.firstChild).toBeNull()
		})
	})
})
