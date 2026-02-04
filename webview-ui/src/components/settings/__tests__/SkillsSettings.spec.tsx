import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { SkillMetadata } from "@roo-code/types"

import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

import { SkillsSettings } from "../SkillsSettings"

// Mock vscode
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the translation hook
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, params?: any) => {
			if (params?.name) {
				return `${key} ${params.name}`
			}
			return key
		},
	}),
}))

// Mock the doc links utility
vi.mock("@/utils/docLinks", () => ({
	buildDocLink: (path: string, anchor?: string) => `https://docs.example.com/${path}${anchor ? `#${anchor}` : ""}`,
}))

// Mock modes
vi.mock("@roo/modes", () => ({
	getAllModes: () => [
		{ slug: "code", name: "Code" },
		{ slug: "architect", name: "Architect" },
	],
}))

// Mock UI components
vi.mock("@/components/ui", () => ({
	AlertDialog: ({ children, open }: any) => (
		<div data-testid="alert-dialog" data-open={open}>
			{open && children}
		</div>
	),
	AlertDialogContent: ({ children }: any) => <div data-testid="alert-dialog-content">{children}</div>,
	AlertDialogHeader: ({ children }: any) => <div data-testid="alert-dialog-header">{children}</div>,
	AlertDialogTitle: ({ children }: any) => <div data-testid="alert-dialog-title">{children}</div>,
	AlertDialogDescription: ({ children }: any) => <div data-testid="alert-dialog-description">{children}</div>,
	AlertDialogFooter: ({ children }: any) => <div data-testid="alert-dialog-footer">{children}</div>,
	AlertDialogAction: ({ children, onClick }: any) => (
		<button data-testid="alert-dialog-action" onClick={onClick}>
			{children}
		</button>
	),
	AlertDialogCancel: ({ children, onClick }: any) => (
		<button data-testid="alert-dialog-cancel" onClick={onClick}>
			{children}
		</button>
	),
	Button: ({ children, onClick, disabled, className, variant, size }: any) => (
		<button
			onClick={onClick}
			disabled={disabled}
			className={className}
			data-variant={variant}
			data-size={size}
			data-testid="button">
			{children}
		</button>
	),
	StandardTooltip: ({ children }: any) => <>{children}</>,
	Dialog: ({ children, open, _onOpenChange }: any) => (
		<div data-testid="mode-dialog" data-open={open}>
			{open && children}
		</div>
	),
	DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
	DialogHeader: ({ children }: any) => <div data-testid="dialog-header">{children}</div>,
	DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
	DialogDescription: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
	DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
	Checkbox: ({ id, checked, onCheckedChange }: any) => (
		<input
			type="checkbox"
			id={id}
			checked={checked}
			onChange={(e) => onCheckedChange?.(e.target.checked)}
			data-testid={`checkbox-${id}`}
		/>
	),
	Select: ({ children, value, _onValueChange }: any) => (
		<div data-testid="select" data-value={value}>
			{children}
		</div>
	),
	SelectTrigger: ({ children, className }: any) => (
		<button data-testid="select-trigger" className={className}>
			{children}
		</button>
	),
	SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
	SelectItem: ({ children, value }: any) => (
		<div data-testid={`select-item-${value}`} data-value={value}>
			{children}
		</div>
	),
	SelectValue: () => <span data-testid="select-value" />,
}))

// Mock CreateSkillDialog component
vi.mock("../CreateSkillDialog", () => ({
	CreateSkillDialog: ({ open, onOpenChange, onSkillCreated }: any) => (
		<div data-testid="create-skill-dialog" data-open={open}>
			{open && (
				<>
					<button onClick={() => onOpenChange(false)} data-testid="close-dialog">
						Close
					</button>
					<button onClick={onSkillCreated} data-testid="create-skill-button">
						Create
					</button>
				</>
			)}
		</div>
	),
}))

// Mock SectionHeader component
vi.mock("../SectionHeader", () => ({
	SectionHeader: ({ children }: any) => <div data-testid="section-header">{children}</div>,
}))

const mockSkills: SkillMetadata[] = [
	{
		name: "project-skill",
		description: "A project skill",
		path: "/workspace/.roo/skills/project-skill/SKILL.md",
		source: "project",
	},
	{
		name: "project-mode-skill",
		description: "A project mode-specific skill",
		path: "/workspace/.roo/skills/project-mode-skill/SKILL.md",
		source: "project",
		modeSlugs: ["architect"],
	},
	{
		name: "global-skill",
		description: "A global skill",
		path: "/home/.roo/skills/global-skill/SKILL.md",
		source: "global",
	},
]

// Create a variable to hold the mock state
let mockExtensionState: any = {}

// Mock the useExtensionState hook
vi.mock("@/context/ExtensionStateContext", () => ({
	ExtensionStateContextProvider: ({ children }: any) => children,
	useExtensionState: () => mockExtensionState,
}))

const renderSkillsSettings = (skills: SkillMetadata[] = mockSkills, cwd?: string) => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})

	// Update the mock state before rendering
	mockExtensionState = {
		skills,
		cwd: cwd !== undefined ? cwd : "/workspace",
		customModes: [],
	}

	return render(
		<QueryClientProvider client={queryClient}>
			<ExtensionStateContextProvider>
				<SkillsSettings />
			</ExtensionStateContextProvider>
		</QueryClientProvider>,
	)
}

describe("SkillsSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders section header", () => {
		renderSkillsSettings()

		expect(screen.getByTestId("section-header")).toBeInTheDocument()
		expect(screen.getByText("settings:sections.skills")).toBeInTheDocument()
	})

	it("requests skills on mount", () => {
		renderSkillsSettings()

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "requestSkills" })
	})

	it("displays project skills section when in a workspace", () => {
		renderSkillsSettings()

		expect(screen.getByText("settings:skills.workspaceSkills")).toBeInTheDocument()
		expect(screen.getByText("project-skill")).toBeInTheDocument()
	})

	it("displays global skills section", () => {
		renderSkillsSettings()

		expect(screen.getByText("settings:skills.globalSkills")).toBeInTheDocument()
		expect(screen.getByText("global-skill")).toBeInTheDocument()
	})

	it("does not display project skills section when not in a workspace", () => {
		const globalOnlySkills = mockSkills.filter((s) => s.source === "global")
		renderSkillsSettings(globalOnlySkills, "")

		expect(screen.queryByText("settings:skills.workspaceSkills")).not.toBeInTheDocument()
	})

	it("shows empty state for project skills when none exist", () => {
		const globalOnlySkills = mockSkills.filter((s) => s.source === "global")
		renderSkillsSettings(globalOnlySkills)

		expect(screen.getByText("settings:skills.noWorkspaceSkills")).toBeInTheDocument()
	})

	it("shows empty state for global skills when none exist", () => {
		const projectOnlySkills = mockSkills.filter((s) => s.source === "project")
		renderSkillsSettings(projectOnlySkills)

		expect(screen.getByText("settings:skills.noGlobalSkills")).toBeInTheDocument()
	})

	it("groups skills by source correctly", () => {
		renderSkillsSettings()

		// Project skills
		expect(screen.getByText("project-skill")).toBeInTheDocument()
		expect(screen.getByText("project-mode-skill")).toBeInTheDocument()

		// Global skills
		expect(screen.getByText("global-skill")).toBeInTheDocument()
	})

	it("displays skill descriptions", () => {
		renderSkillsSettings()

		expect(screen.getByText("A project skill")).toBeInTheDocument()
		expect(screen.getByText("A global skill")).toBeInTheDocument()
	})

	it("opens create skill dialog when add button is clicked", () => {
		renderSkillsSettings()

		// There's now a single "Add Skill" button at the top
		const addButton = screen
			.getAllByTestId("button")
			.find((btn) => btn.textContent?.includes("settings:skills.addSkill"))
		expect(addButton).toBeInTheDocument()
		fireEvent.click(addButton!)

		expect(screen.getByTestId("create-skill-dialog")).toHaveAttribute("data-open", "true")
	})

	it("opens delete confirmation dialog when delete button is clicked", () => {
		renderSkillsSettings()

		// Find all delete buttons (buttons with Trash icon)
		const buttons = screen.getAllByTestId("button")
		// The delete button should be after the edit button for each skill
		// Find the first delete button (for project-skill)
		const deleteButtons = buttons.filter((btn) => btn.querySelector('[class*="text-destructive"]'))
		expect(deleteButtons.length).toBeGreaterThan(0)
		fireEvent.click(deleteButtons[0])

		expect(screen.getByTestId("alert-dialog")).toHaveAttribute("data-open", "true")
		expect(screen.getByText("settings:skills.deleteDialog.title")).toBeInTheDocument()
	})

	it("deletes skill when confirmation is clicked", async () => {
		renderSkillsSettings()

		// Find and click delete button
		const buttons = screen.getAllByTestId("button")
		const deleteButtons = buttons.filter((btn) => btn.querySelector('[class*="text-destructive"]'))
		fireEvent.click(deleteButtons[0])

		const confirmButton = screen.getByTestId("alert-dialog-action")
		fireEvent.click(confirmButton)

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "deleteSkill",
				skillName: "project-skill",
				source: "project",
				skillMode: undefined,
			})
		})
	})

	it("cancels deletion when cancel is clicked", () => {
		renderSkillsSettings()

		// Find and click delete button
		const buttons = screen.getAllByTestId("button")
		const deleteButtons = buttons.filter((btn) => btn.querySelector('[class*="text-destructive"]'))
		fireEvent.click(deleteButtons[0])

		const cancelButton = screen.getByTestId("alert-dialog-cancel")
		fireEvent.click(cancelButton)

		expect(screen.getByTestId("alert-dialog")).toHaveAttribute("data-open", "false")
	})

	it("opens skill file when edit button is clicked", () => {
		renderSkillsSettings()

		// Find edit buttons (buttons without destructive class that are icon size)
		const buttons = screen.getAllByTestId("button")
		// Filter to find edit buttons (the ones with Edit icon, not Add, Delete, or Settings/Gear)
		// Edit button uses lucide-square-pen icon, Settings uses lucide-settings
		const editButtons = buttons.filter(
			(btn) =>
				btn.getAttribute("data-size") === "icon" &&
				!btn.querySelector('[class*="text-destructive"]') &&
				!btn.querySelector('[class*="lucide-settings"]') &&
				btn.querySelector('[class*="lucide-square-pen"]'),
		)
		// Click the first edit button (for project-skill)
		fireEvent.click(editButtons[0])

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openSkillFile",
			skillName: "project-skill",
			source: "project",
			skillMode: undefined,
		})
	})

	it("does not manually refresh after deletion (backend sends updated skills via context)", async () => {
		renderSkillsSettings()

		// Clear mock calls after initial mount
		;(vscode.postMessage as any).mockClear()

		// Find and click delete button
		const buttons = screen.getAllByTestId("button")
		const deleteButtons = buttons.filter((btn) => btn.querySelector('[class*="text-destructive"]'))
		fireEvent.click(deleteButtons[0])

		const confirmButton = screen.getByTestId("alert-dialog-action")
		fireEvent.click(confirmButton)

		// Verify deleteSkill message was sent
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "deleteSkill",
				skillName: "project-skill",
				source: "project",
				skillMode: undefined,
			})
		})

		// Verify that requestSkills was NOT called after deletion
		// (the backend sends updated skills via ExtensionStateContext automatically)
		const calls = (vscode.postMessage as any).mock.calls
		const refreshCalls = calls.filter((call: any[]) => call[0].type === "requestSkills")
		expect(refreshCalls.length).toBe(0)
	})

	it("does not manually refresh after creating new skill (backend sends updated skills via context)", async () => {
		renderSkillsSettings()

		// Clear mock calls after initial mount
		;(vscode.postMessage as any).mockClear()

		// Open create dialog
		const addButton = screen
			.getAllByTestId("button")
			.find((btn) => btn.textContent?.includes("settings:skills.addSkill"))
		fireEvent.click(addButton!)

		// Simulate skill creation
		const createButton = screen.getByTestId("create-skill-button")
		fireEvent.click(createButton)

		// Verify that requestSkills was NOT called after creation
		// (the backend sends updated skills via ExtensionStateContext automatically)
		const calls = (vscode.postMessage as any).mock.calls
		const refreshCalls = calls.filter((call: any[]) => call[0].type === "requestSkills")
		expect(refreshCalls.length).toBe(0)
	})

	it("renders empty state when no skills exist", () => {
		renderSkillsSettings([])

		expect(screen.getByText("settings:skills.noWorkspaceSkills")).toBeInTheDocument()
		expect(screen.getByText("settings:skills.noGlobalSkills")).toBeInTheDocument()
	})

	it("handles multiple skills of the same source", () => {
		const multipleSkills: SkillMetadata[] = [
			{
				name: "skill-1",
				description: "First skill",
				path: "/path/1",
				source: "global",
			},
			{
				name: "skill-2",
				description: "Second skill",
				path: "/path/2",
				source: "global",
			},
			{
				name: "skill-3",
				description: "Third skill",
				path: "/path/3",
				source: "global",
			},
		]

		renderSkillsSettings(multipleSkills)

		expect(screen.getByText("skill-1")).toBeInTheDocument()
		expect(screen.getByText("skill-2")).toBeInTheDocument()
		expect(screen.getByText("skill-3")).toBeInTheDocument()
	})

	it("renders a single add skill button", () => {
		renderSkillsSettings()

		// Should have one "Add Skill" button at the top
		const buttons = screen.getAllByTestId("button")
		const addButtons = buttons.filter((btn) => btn.textContent?.includes("settings:skills.addSkill"))
		expect(addButtons.length).toBe(1)
	})
})
