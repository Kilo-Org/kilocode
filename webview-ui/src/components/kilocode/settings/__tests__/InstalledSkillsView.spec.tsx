// kilocode_change - new file
import { render, screen, fireEvent, act } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import React from "react"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, string>) => {
			if (params?.skillName) {
				return key.replace("{{skillName}}", params.skillName)
			}
			return key
		},
	}),
}))

// Mock the vscode module - use vi.hoisted to ensure the mock is available before module loading
const { mockPostMessage } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

// Import after mocks are set up
import InstalledSkillsView from "../InstalledSkillsView"

// Mock VSCode webview-ui-toolkit components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, href }: any) => (
		<a href={href} data-testid="vscode-link">
			{children}
		</a>
	),
}))

// Mock the UI components
vi.mock("@src/components/ui", () => ({
	Button: ({ children, onClick, variant, size, style }: any) => (
		<button onClick={onClick} data-variant={variant} data-size={size} style={style}>
			{children}
		</button>
	),
	Dialog: ({ children, open, onOpenChange }: any) => (
		<div data-testid="dialog" data-open={open} onClick={() => onOpenChange?.(false)}>
			{open && children}
		</div>
	),
	DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
	DialogHeader: ({ children }: any) => <div data-testid="dialog-header">{children}</div>,
	DialogTitle: ({ children }: any) => <h2 data-testid="dialog-title">{children}</h2>,
	DialogDescription: ({ children }: any) => <p data-testid="dialog-description">{children}</p>,
	DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
}))

describe("InstalledSkillsView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("renders without errors", () => {
		expect(() => render(<InstalledSkillsView />)).not.toThrow()
	})

	it("requests skills data on mount", () => {
		render(<InstalledSkillsView />)

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "refreshSkills" })
	})

	it("displays no skills message when skills list is empty", () => {
		render(<InstalledSkillsView />)

		expect(screen.getByText("kilocode:skills.noSkills")).toBeInTheDocument()
	})

	it("displays skills when skillsData message is received", async () => {
		render(<InstalledSkillsView />)

		// Simulate receiving skills data
		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [
							{
								name: "test-skill",
								description: "A test skill",
								path: "/path/to/skill",
								source: "project",
							},
						],
					},
				}),
			)
		})

		expect(screen.getByText("test-skill")).toBeInTheDocument()
		expect(screen.getByText("A test skill")).toBeInTheDocument()
	})

	it("groups skills by source (project and global)", async () => {
		render(<InstalledSkillsView />)

		// Simulate receiving skills data with both project and global skills
		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [
							{
								name: "project-skill",
								description: "A project skill",
								path: "/path/to/project/skill",
								source: "project",
							},
							{
								name: "global-skill",
								description: "A global skill",
								path: "/path/to/global/skill",
								source: "global",
							},
						],
					},
				}),
			)
		})

		expect(screen.getByText("kilocode:skills.projectSkills")).toBeInTheDocument()
		expect(screen.getByText("kilocode:skills.globalSkills")).toBeInTheDocument()
		expect(screen.getByText("project-skill")).toBeInTheDocument()
		expect(screen.getByText("global-skill")).toBeInTheDocument()
	})

	it("displays mode badge when skill has a mode", async () => {
		render(<InstalledSkillsView />)

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [
							{
								name: "mode-skill",
								description: "A skill with mode",
								path: "/path/to/skill",
								source: "project",
								mode: "code",
							},
						],
					},
				}),
			)
		})

		expect(screen.getByText("code")).toBeInTheDocument()
	})

	it("opens delete confirmation dialog when delete button is clicked", async () => {
		render(<InstalledSkillsView />)

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [
							{
								name: "skill-to-delete",
								description: "A skill to delete",
								path: "/path/to/skill",
								source: "project",
							},
						],
					},
				}),
			)
		})

		// Find and click the delete button (trash icon)
		const deleteButton = screen.getByRole("button")
		fireEvent.click(deleteButton)

		// Check that dialog is open
		expect(screen.getByTestId("dialog-title")).toHaveTextContent("kilocode:skills.deleteDialog.title")
		// The description contains the skill name via the translation key
		expect(screen.getByTestId("dialog-description")).toHaveTextContent("kilocode:skills.deleteDialog.description")
	})

	it("sends removeInstalledMarketplaceItem message when delete is confirmed", async () => {
		render(<InstalledSkillsView />)

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [
							{
								name: "skill-to-delete",
								description: "A skill to delete",
								path: "/path/to/skill",
								source: "project",
							},
						],
					},
				}),
			)
		})

		// Click delete button to open dialog
		const deleteButton = screen.getByRole("button")
		fireEvent.click(deleteButton)

		// Clear the mock to only track the delete message
		mockPostMessage.mockClear()

		// Find and click the confirm delete button in the dialog
		const confirmButton = screen.getByText("kilocode:skills.deleteDialog.delete")
		fireEvent.click(confirmButton)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "removeInstalledMarketplaceItem",
			mpItem: {
				type: "skill",
				id: "skill-to-delete",
				name: "skill-to-delete",
				description: "A skill to delete",
				category: "",
				githubUrl: "",
				content: "",
				displayName: "skill-to-delete",
				displayCategory: "",
			},
			mpInstallOptions: { target: "project" },
		})
	})

	it("closes dialog when cancel button is clicked", async () => {
		render(<InstalledSkillsView />)

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [
							{
								name: "skill-to-delete",
								description: "A skill to delete",
								path: "/path/to/skill",
								source: "project",
							},
						],
					},
				}),
			)
		})

		// Click delete button to open dialog
		const deleteButton = screen.getByRole("button")
		fireEvent.click(deleteButton)

		// Verify dialog is open
		expect(screen.getByTestId("dialog-title")).toBeInTheDocument()

		// Click cancel button
		const cancelButton = screen.getByText("kilocode:skills.deleteDialog.cancel")
		fireEvent.click(cancelButton)

		// Dialog should be closed (data-open should be false)
		const dialog = screen.getByTestId("dialog")
		expect(dialog).toHaveAttribute("data-open", "false")
	})

	it("renders documentation link", () => {
		render(<InstalledSkillsView />)

		const link = screen.getByTestId("vscode-link")
		expect(link).toHaveAttribute("href", "https://kilo.ai/docs/features/skills")
	})

	it("handles empty skills array in skillsData message", async () => {
		render(<InstalledSkillsView />)

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [],
					},
				}),
			)
		})

		expect(screen.getByText("kilocode:skills.noSkills")).toBeInTheDocument()
	})

	it("handles skillsData message with undefined skills", async () => {
		render(<InstalledSkillsView />)

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: undefined,
					},
				}),
			)
		})

		expect(screen.getByText("kilocode:skills.noSkills")).toBeInTheDocument()
	})

	it("only shows project section when there are only project skills", async () => {
		render(<InstalledSkillsView />)

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [
							{
								name: "project-skill",
								description: "A project skill",
								path: "/path/to/skill",
								source: "project",
							},
						],
					},
				}),
			)
		})

		expect(screen.getByText("kilocode:skills.projectSkills")).toBeInTheDocument()
		expect(screen.queryByText("kilocode:skills.globalSkills")).not.toBeInTheDocument()
	})

	it("only shows global section when there are only global skills", async () => {
		render(<InstalledSkillsView />)

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "skillsData",
						skills: [
							{
								name: "global-skill",
								description: "A global skill",
								path: "/path/to/skill",
								source: "global",
							},
						],
					},
				}),
			)
		})

		expect(screen.queryByText("kilocode:skills.projectSkills")).not.toBeInTheDocument()
		expect(screen.getByText("kilocode:skills.globalSkills")).toBeInTheDocument()
	})

	it("cleans up message listener on unmount", () => {
		const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")

		const { unmount } = render(<InstalledSkillsView />)
		unmount()

		expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function))
	})
})
