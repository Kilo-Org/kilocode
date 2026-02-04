import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { Command } from "@roo-code/types"

import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

import { SlashCommandsSettings } from "../SlashCommandsSettings"

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
		<div data-testid="dialog" data-open={open}>
			{open && children}
		</div>
	),
	DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
	DialogHeader: ({ children }: any) => <div data-testid="dialog-header">{children}</div>,
	DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
	DialogDescription: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
	DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
	Input: ({ id, value, onChange, placeholder, maxLength, className }: any) => (
		<input
			id={id}
			value={value}
			onChange={onChange}
			placeholder={placeholder}
			maxLength={maxLength}
			className={className}
			data-testid={`input-${id}`}
		/>
	),
	Select: ({ children, value, onValueChange }: any) => (
		<div data-testid="select" data-value={value} onClick={() => onValueChange?.("global")}>
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

// Mock CreateSlashCommandDialog component
vi.mock("../CreateSlashCommandDialog", () => ({
	CreateSlashCommandDialog: ({ open, onOpenChange, onCommandCreated }: any) => (
		<div data-testid="create-command-dialog" data-open={open}>
			{open && (
				<>
					<button onClick={() => onOpenChange(false)} data-testid="close-dialog">
						Close
					</button>
					<button onClick={onCommandCreated} data-testid="create-command-button">
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

const mockCommands: Command[] = [
	{
		name: "global-command",
		description: "A global command",
		source: "global",
		filePath: "/path/to/global.md",
	},
	{
		name: "project-command",
		description: "A project command",
		source: "project",
		filePath: "/path/to/project.md",
	},
]

// Create a variable to hold the mock state
let mockExtensionState: any = {}

// Mock the useExtensionState hook
vi.mock("@/context/ExtensionStateContext", () => ({
	ExtensionStateContextProvider: ({ children }: any) => children,
	useExtensionState: () => mockExtensionState,
}))

const renderSlashCommandsSettings = (commands: Command[] = mockCommands, cwd?: string) => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})

	// Update the mock state before rendering
	mockExtensionState = {
		commands,
		cwd: cwd !== undefined ? cwd : "/workspace",
	}

	return render(
		<QueryClientProvider client={queryClient}>
			<ExtensionStateContextProvider>
				<SlashCommandsSettings />
			</ExtensionStateContextProvider>
		</QueryClientProvider>,
	)
}

describe("SlashCommandsSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders section header", () => {
		renderSlashCommandsSettings()

		expect(screen.getByTestId("section-header")).toBeInTheDocument()
		expect(screen.getByText("settings:sections.slashCommands")).toBeInTheDocument()
	})

	it("requests commands on mount", () => {
		renderSlashCommandsSettings()

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "requestCommands" })
	})

	it("displays project commands section when in a workspace", () => {
		renderSlashCommandsSettings()

		expect(screen.getByText("settings:slashCommands.workspaceCommands")).toBeInTheDocument()
	})

	it("displays global commands section", () => {
		renderSlashCommandsSettings()

		expect(screen.getByText("settings:slashCommands.globalCommands")).toBeInTheDocument()
	})

	it("hides project commands section when not in workspace", () => {
		const globalOnlyCommands = mockCommands.filter((c) => c.source === "global")
		renderSlashCommandsSettings(globalOnlyCommands, "")

		expect(screen.queryByText("settings:slashCommands.workspaceCommands")).not.toBeInTheDocument()
	})

	it("shows empty state message for global commands when none exist", () => {
		const projectOnlyCommands = mockCommands.filter((c) => c.source === "project")
		renderSlashCommandsSettings(projectOnlyCommands)

		expect(screen.getByText("settings:slashCommands.noGlobalCommands")).toBeInTheDocument()
	})

	it("shows empty state message for workspace commands when none exist", () => {
		const globalOnlyCommands = mockCommands.filter((c) => c.source === "global")
		renderSlashCommandsSettings(globalOnlyCommands)

		expect(screen.getByText("settings:slashCommands.noWorkspaceCommands")).toBeInTheDocument()
	})

	it("groups commands by source correctly", () => {
		renderSlashCommandsSettings()

		// Should show both sections
		expect(screen.getByText("settings:slashCommands.workspaceCommands")).toBeInTheDocument()
		expect(screen.getByText("settings:slashCommands.globalCommands")).toBeInTheDocument()

		// Should show command names
		expect(screen.getByText("global-command")).toBeInTheDocument()
		expect(screen.getByText("project-command")).toBeInTheDocument()
	})

	it("displays command descriptions", () => {
		renderSlashCommandsSettings()

		expect(screen.getByText("A global command")).toBeInTheDocument()
		expect(screen.getByText("A project command")).toBeInTheDocument()
	})

	it("opens create command dialog when add button is clicked", () => {
		renderSlashCommandsSettings()

		// Find the "Add Slash Command" button and click it
		const addButton = screen.getByText("settings:slashCommands.addCommand").closest("button")
		expect(addButton).toBeInTheDocument()
		fireEvent.click(addButton!)

		// Dialog should now be open
		expect(screen.getByTestId("create-command-dialog")).toHaveAttribute("data-open", "true")
	})

	it("opens delete confirmation dialog when delete button is clicked", () => {
		renderSlashCommandsSettings()

		// Find the delete button for the global command (using the button with Trash2 icon)
		const deleteButtons = screen.getAllByTestId("button").filter((btn) => btn.querySelector(".text-destructive"))
		fireEvent.click(deleteButtons[0])

		// Alert dialog should be open with delete confirmation
		expect(screen.getByTestId("alert-dialog")).toHaveAttribute("data-open", "true")
		expect(screen.getByText("settings:slashCommands.deleteDialog.title")).toBeInTheDocument()
	})

	it("deletes command when confirmation is clicked", async () => {
		renderSlashCommandsSettings()

		// Click delete button for global command
		const deleteButtons = screen.getAllByTestId("button").filter((btn) => btn.querySelector(".text-destructive"))
		fireEvent.click(deleteButtons[0])

		// Click confirm delete
		const confirmButton = screen.getByTestId("alert-dialog-action")
		fireEvent.click(confirmButton)

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "deleteCommand",
				text: expect.any(String),
				values: { source: expect.any(String) },
			})
		})
	})

	it("cancels deletion when cancel is clicked", () => {
		renderSlashCommandsSettings()

		// Click delete button
		const deleteButtons = screen.getAllByTestId("button").filter((btn) => btn.querySelector(".text-destructive"))
		fireEvent.click(deleteButtons[0])

		// Click cancel
		const cancelButton = screen.getByTestId("alert-dialog-cancel")
		fireEvent.click(cancelButton)

		// Dialog should be closed and no delete message sent
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({
				type: "deleteCommand",
			}),
		)
	})

	it("opens command file when edit button is clicked", () => {
		renderSlashCommandsSettings()

		// Clear mocks after initial mount
		vi.clearAllMocks()

		// Find edit buttons (icon size buttons without text-destructive, with lucide-square-pen icon)
		const allButtons = screen.getAllByTestId("button")
		const editButtons = allButtons.filter(
			(btn) =>
				btn.getAttribute("data-size") === "icon" &&
				!btn.querySelector('[class*="text-destructive"]') &&
				btn.querySelector('[class*="lucide-square-pen"]'),
		)

		// Click the first edit button
		fireEvent.click(editButtons[0])

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openFile",
			text: expect.any(String),
		})
	})

	it("refreshes commands after deletion", async () => {
		renderSlashCommandsSettings()

		// Click delete button
		const deleteButtons = screen.getAllByTestId("button").filter((btn) => btn.querySelector(".text-destructive"))
		fireEvent.click(deleteButtons[0])

		// Click confirm delete
		const confirmButton = screen.getByTestId("alert-dialog-action")
		fireEvent.click(confirmButton)

		// Wait for refresh to be called after timeout
		await waitFor(
			() => {
				// Initial mount call + refresh after deletion
				const requestCommandsCalls = (vscode.postMessage as any).mock.calls.filter(
					(call: any) => call[0].type === "requestCommands",
				)
				expect(requestCommandsCalls.length).toBeGreaterThanOrEqual(2)
			},
			{ timeout: 200 },
		)
	})

	it("refreshes commands after creating new command", async () => {
		renderSlashCommandsSettings()

		// Open create dialog
		const addButton = screen.getByText("settings:slashCommands.addCommand").closest("button")
		fireEvent.click(addButton!)

		// Click create button in dialog
		const createButton = screen.getByTestId("create-command-button")
		fireEvent.click(createButton)

		// Wait for refresh to be called after timeout
		await waitFor(
			() => {
				// Initial mount call + refresh after creation
				const requestCommandsCalls = (vscode.postMessage as any).mock.calls.filter(
					(call: any) => call[0].type === "requestCommands",
				)
				expect(requestCommandsCalls.length).toBeGreaterThanOrEqual(2)
			},
			{ timeout: 600 },
		)
	})

	it("renders empty state when no commands exist", () => {
		renderSlashCommandsSettings([])

		expect(screen.getByText("settings:slashCommands.noGlobalCommands")).toBeInTheDocument()
		expect(screen.getByText("settings:slashCommands.noWorkspaceCommands")).toBeInTheDocument()
	})

	it("handles multiple commands of the same type", () => {
		const multipleCommands: Command[] = [
			{ name: "global-1", description: "First global", source: "global" },
			{ name: "global-2", description: "Second global", source: "global" },
			{ name: "project-1", description: "First project", source: "project" },
		]

		renderSlashCommandsSettings(multipleCommands)

		expect(screen.getByText("global-1")).toBeInTheDocument()
		expect(screen.getByText("global-2")).toBeInTheDocument()
		expect(screen.getByText("project-1")).toBeInTheDocument()
	})

	it("renders a single add command button", () => {
		renderSlashCommandsSettings()

		// Should only have one "Add Slash Command" button
		const addButtons = screen.getAllByText("settings:slashCommands.addCommand")
		expect(addButtons.length).toBe(1)
	})

	it("renders footer text", () => {
		renderSlashCommandsSettings()

		expect(screen.getByText("settings:slashCommands.footer")).toBeInTheDocument()
	})
})
